import { Router, Request, Response } from 'express';
import { pool } from './db.js';
import { CLASSIFICACAO_NA_NFE, CST_PIS_COFINS, UFS } from './schema.js';

/**
 * NF-e do romaneio. As regras fiscais ficam em sys_empresas.config (JSON, chave "nfe"); o "Gerar NFe"
 * monta a nota e manda ao nfeWeb (concentrador, POST /api/emitir com transmitir: false), que numera,
 * calcula os tributos, assina e valida. A nota fica "assinada" no nfeWeb, pronta para o Enviar de lá:
 * nada vai à SEFAZ a partir daqui.
 */

const erro = (mensagem: string, status = 400) => Object.assign(new Error(mensagem), { status });
const num = (v: unknown) => Number(v) || 0;
/** Arredonda como o `num` do nfeWeb (pela notação "e": 1,005 → 1,01, que v * 100 erraria) */
const arred = (v: number, casas: number) => Number(`${Math.round(Number(`${v}e${casas}`))}e-${casas}`);
const q4 = (v: number) => arred(v, 4);
const so = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const fmt = (v: number, casas: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

export interface ConfigNFe {
  naturezaOperacao: string;
  serie: number;
  /** indPres: 1=Presencial, 2=Internet, 3=Teleatendimento, 4=Entrega a domicílio, 5=Presencial fora, 9=Outros */
  presencial: string;
  formaPagamento: string;
  /** CFOP padrão da venda dentro da UF do emitente (5xxx) e para outra UF (6xxx); o grupo tributário pode trocar */
  cfopDentroUF: string;
  cfopForaUF: string;
  /** Grupo tributário do produto que não tem grupo (0 = nenhum: o produto fica pendente) */
  grupoPadraoId: number;
  /** Reforma tributária (NT 2025.002): cClassTrib padrão (o grupo pode trocar; o CST sai dele) e as alíquotas */
  ibscbs: boolean;
  ibscbsClassificacao: string;
  aliquotaIBSUF: number;
  aliquotaIBSMun: number;
  aliquotaCBS: number;
  informacoesComplementares: string;
  /** DIFAL por UF de destino (venda a não contribuinte de outra UF); UF fora daqui vira pendência */
  difal: Record<string, AliquotasUF>;
}

export interface AliquotasUF {
  /** pICMSInter: 4, 7 ou 12 */
  interestadual: number;
  /** pICMSUFDest */
  interna: number;
  /** pFCPUFDest (0 = sem FCP) */
  fcp: number;
}

/** Os códigos fiscais vêm vazios: quem define é a empresa. IBS/CBS no padrão de teste 2026 do nfeWeb */
export const CONFIG_PADRAO: ConfigNFe = {
  naturezaOperacao: '',
  serie: 1,
  presencial: '',
  formaPagamento: '',
  cfopDentroUF: '',
  cfopForaUF: '',
  grupoPadraoId: 0,
  ibscbs: true,
  ibscbsClassificacao: '000001',
  aliquotaIBSUF: 0.1,
  aliquotaIBSMun: 0,
  aliquotaCBS: 0.9,
  informacoesComplementares: '',
  difal: {},
};

// ponytail: só os códigos sem substituição tributária; ST pede MVA, base e alíquota próprias
export const CSOSN_ACEITOS = ['101', '102', '103', '300', '400'];
export const CST_ACEITOS = ['00', '40', '41', '50'];
export const PRESENCIAL = ['1', '2', '3', '4', '5', '9'];
export const PIS_COFINS_ACEITOS = CST_PIS_COFINS.map((o) => o.value);
export const FORMAS_PAGAMENTO = ['01', '02', '03', '04', '05', '10', '11', '12', '13', '15', '16', '17', '18', '19', '90', '99'];

const foraDe0a100 = (v: number, nome: string) => (v < 0 || v > 100 ? [`${nome} deve ficar entre 0 e 100%.`] : []);

/** Confere e normaliza a configuração recebida da tela; lança todos os problemas juntos */
export function validarConfig(entrada: object): ConfigNFe {
  const e = entrada as Record<string, any>;
  const c: ConfigNFe = { ...CONFIG_PADRAO };
  for (const k of Object.keys(CONFIG_PADRAO) as (keyof ConfigNFe)[]) {
    if (!(k in e) || k === 'difal') continue;
    const padrao = CONFIG_PADRAO[k];
    (c as any)[k] = typeof padrao === 'number' ? num(e[k]) : typeof padrao === 'boolean' ? Boolean(e[k]) : String(e[k] ?? '').trim();
  }
  c.naturezaOperacao = c.naturezaOperacao.toUpperCase();

  const erros: string[] = [];
  const aliquota = (v: number, nome: string) => erros.push(...foraDe0a100(v, nome));
  if (!c.naturezaOperacao || c.naturezaOperacao.length > 60) erros.push('Natureza da operação: obrigatória, até 60 caracteres.');
  if (!Number.isInteger(c.serie) || c.serie < 0 || c.serie > 999) erros.push('Série: de 0 a 999.');
  if (!PRESENCIAL.includes(c.presencial)) erros.push('Escolha a indicação de presença.');
  if (!FORMAS_PAGAMENTO.includes(c.formaPagamento)) erros.push('Escolha a forma de pagamento.');
  if (!/^5\d{3}$/.test(c.cfopDentroUF)) erros.push('CFOP dentro da UF: 4 dígitos começando por 5.');
  if (!/^6\d{3}$/.test(c.cfopForaUF)) erros.push('CFOP para outra UF: 4 dígitos começando por 6.');
  if (!Number.isInteger(c.grupoPadraoId) || c.grupoPadraoId < 0) erros.push('Grupo tributário padrão inválido.');
  if (c.ibscbs) {
    if (!/^\d{6}$/.test(c.ibscbsClassificacao)) erros.push('Escolha a classificação tributária (cClassTrib) do IBS/CBS.');
    aliquota(c.aliquotaIBSUF, 'Alíquota do IBS estadual');
    aliquota(c.aliquotaIBSMun, 'Alíquota do IBS municipal');
    aliquota(c.aliquotaCBS, 'Alíquota da CBS');
  }
  if (c.informacoesComplementares.length > 2000) erros.push('Informações complementares: até 2000 caracteres.');
  c.difal = {};
  for (const [uf, a] of Object.entries((e.difal ?? {}) as Record<string, any>)) {
    const l: AliquotasUF = { interestadual: num(a?.interestadual), interna: num(a?.interna), fcp: num(a?.fcp) };
    // Linha em branco na tela = UF sem DIFAL configurado
    if (!l.interestadual && !l.interna && !l.fcp) continue;
    if (!UFS.includes(uf)) erros.push(`DIFAL: UF ${uf} inválida.`);
    if (![4, 7, 12].includes(l.interestadual)) erros.push(`DIFAL ${uf}: escolha a alíquota interestadual (4, 7 ou 12%).`);
    if (!(l.interna > 0)) erros.push(`DIFAL ${uf}: informe a alíquota interna.`);
    aliquota(l.interna, `Alíquota interna de ${uf}`);
    aliquota(l.fcp, `FCP de ${uf}`);
    c.difal[uf] = l;
  }
  if (erros.length) throw erro(erros.join('\n'));
  return c;
}

/** Tributação do item, tirada de uma linha de fis_grupos_tributarios (CFOP e cClassTrib vazios = os da configuração) */
export interface Tributacao {
  origem: string;
  cfopDentroUF: string;
  cfopForaUF: string;
  /** Simples Nacional (CRT 1 e 4); o nfeWeb escolhe CSOSN ou CST pelo CRT do emitente */
  csosn: string;
  aliquotaCreditoSN: number;
  /** Regime normal */
  cst: string;
  aliquotaICMS: number;
  pisCst: string;
  aliquotaPIS: number;
  cofinsCst: string;
  aliquotaCOFINS: number;
  ibscbsClassificacao: string;
}

export const tributacaoDoGrupo = (g: Record<string, any>): Tributacao => ({
  origem: String(g.origem ?? ''),
  cfopDentroUF: so(g.cfop_dentro_uf),
  cfopForaUF: so(g.cfop_fora_uf),
  csosn: String(g.csosn ?? ''),
  aliquotaCreditoSN: num(g.aliquota_credito_sn),
  cst: String(g.cst_icms ?? ''),
  aliquotaICMS: num(g.aliquota_icms),
  pisCst: so(g.cst_pis),
  aliquotaPIS: num(g.aliquota_pis),
  cofinsCst: so(g.cst_cofins),
  aliquotaCOFINS: num(g.aliquota_cofins),
  ibscbsClassificacao: so(g.cclass_trib),
});

/** Problemas de um grupo tributário: barra a gravação do grupo e vira pendência ao gerar a nota */
export function errosTributacao(t: Tributacao): string[] {
  const erros: string[] = [];
  if (!/^[0-8]$/.test(t.origem)) erros.push('Origem da mercadoria: de 0 a 8.');
  if (t.cfopDentroUF && !/^5\d{3}$/.test(t.cfopDentroUF)) erros.push('CFOP dentro da UF: 4 dígitos começando por 5.');
  if (t.cfopForaUF && !/^6\d{3}$/.test(t.cfopForaUF)) erros.push('CFOP para outra UF: 4 dígitos começando por 6.');
  if (!t.csosn && !t.cst) erros.push('Informe o CSOSN (Simples Nacional) ou o CST do ICMS (regime normal).');
  if (t.csosn && !CSOSN_ACEITOS.includes(t.csosn)) erros.push(`CSOSN aceitos: ${CSOSN_ACEITOS.join(', ')}.`);
  if (t.csosn === '101' && !(t.aliquotaCreditoSN > 0)) erros.push('CSOSN 101: informe a alíquota de crédito do Simples.');
  if (t.cst && !CST_ACEITOS.includes(t.cst)) erros.push(`CST do ICMS aceitos: ${CST_ACEITOS.join(', ')}.`);
  if (t.cst === '00' && !(t.aliquotaICMS > 0)) erros.push('CST 00: informe a alíquota do ICMS.');
  for (const [cst, aliq, nome] of [[t.pisCst, t.aliquotaPIS, 'do PIS'], [t.cofinsCst, t.aliquotaCOFINS, 'da COFINS']] as const) {
    if (!PIS_COFINS_ACEITOS.includes(cst)) erros.push(`Escolha o CST ${nome}.`);
    if (['01', '02'].includes(cst) && !(aliq > 0)) erros.push(`CST ${cst} ${nome}: informe a alíquota.`);
    erros.push(...foraDe0a100(aliq, `Alíquota ${nome}`));
  }
  erros.push(...foraDe0a100(t.aliquotaCreditoSN, 'Alíquota de crédito do Simples'), ...foraDe0a100(t.aliquotaICMS, 'Alíquota do ICMS'));
  return erros;
}

/** Linha da tabela oficial do cClassTrib (fis_classificacao_tributaria) que a nota usa */
export interface Classificacao {
  cst: string;
  /** % de redução das alíquotas do IBS e da CBS (iguais: ver CLASSIFICACAO_NA_NFE) */
  reducao: number;
  /** A nota do romaneio consegue montar (CLASSIFICACAO_NA_NFE) */
  usavel: boolean;
}

const semTabela = (err: any) =>
  err?.code === 'ER_NO_SUCH_TABLE' ? erro('Falta a tabela fis_classificacao_tributaria (ver o SQL no CLAUDE.md do projeto).') : err;

export async function lerClassificacoes(codigos: string[]): Promise<Record<string, Classificacao>> {
  if (!codigos.length) return {};
  try {
    const [linhas] = await pool.query<any[]>(
      `SELECT t.cclass_trib, t.cst, t.p_red_ibs, (${CLASSIFICACAO_NA_NFE}) AS usavel
         FROM fis_classificacao_tributaria t WHERE t.cclass_trib IN (?)`,
      [codigos],
    );
    return Object.fromEntries(linhas.map((l) => [l.cclass_trib, { cst: l.cst, reducao: num(l.p_red_ibs), usavel: Boolean(Number(l.usavel)) }]));
  } catch (err: any) {
    throw semTabela(err);
  }
}

const COLUNAS_CLASSIFICACAO = [
  'cst', 'nome_cst', 'nome', 'descricao', 'p_red_ibs', 'p_red_cbs', 'ind_nfe', 'ind_nfce', 'ind_trib_regular',
  'ind_monofasica', 'ind_estorno_cred', 'inicio_vigencia', 'fim_vigencia', 'publicado_em', 'atualizado_em',
];

/**
 * Tabela oficial do cClassTrib (IT 2025.002) gravada em fis_classificacao_tributaria (inclui as novas, atualiza
 * pelo cClassTrib). A API da SVRS exige certificado digital: quem consulta é o nfeWeb, com o da empresa
 */
async function atualizarClassificacoes(empresaId: unknown) {
  const { emp } = await lerConfigEmpresa(empresaId);
  const csts = await chamarNfeWeb(String(emp.cnpj ?? ''), '/api/tabelas/classificacao-tributaria');
  const sim = (v: unknown) => (v === true ? 1 : 0);
  const data = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
  // A API não traz nome curto: o combo mostra o começo da descrição oficial (a íntegra fica em descricao)
  const curto = (t: string) => (t.length > 150 ? `${t.slice(0, 149).trimEnd()}…` : t);
  const [[{ agora }]] = await pool.query<any[]>('SELECT NOW() AS agora');
  const linhas = (Array.isArray(csts) ? csts : [])
    .flatMap((c) =>
      (c?.classificacoesTributarias ?? []).map((k: any) => [
        String(k.cClassTrib ?? ''),
        String(c.CST ?? ''),
        String(c.DescricaoCST ?? '').slice(0, 100),
        curto(String(k.DescricaoClassTrib ?? '')),
        k.DescricaoClassTrib ?? null,
        num(k.pRedIBS),
        num(k.pRedCBS),
        sim(k.IndNFe),
        sim(k.IndNFCe),
        sim(k.IndTribRegular),
        sim(c.IndIBSCBSMono || k.MonofasiaSujeitaRetencao || k.MonofasiaRetidaAnt || k.MonofasiaDiferimento || k.MonofasiaPadrao),
        sim(k.IndEstornoCred),
        data(k.InicioVigencia),
        data(k.FimVigencia),
        data(k.Publicacao),
        agora,
        agora,
      ]),
    )
    .filter((l: any[]) => /^\d{6}$/.test(l[0]) && /^\d{3}$/.test(l[1]));
  if (!linhas.length) throw erro('A API da SVRS mudou de formato e as classificações não foram lidas: avise o suporte.', 502);
  try {
    await pool.query(
      `INSERT INTO fis_classificacao_tributaria (cclass_trib, ${COLUNAS_CLASSIFICACAO.join(', ')}, criado_em) VALUES ?
       ON DUPLICATE KEY UPDATE ${COLUNAS_CLASSIFICACAO.map((c) => `${c} = VALUES(${c})`).join(', ')}`,
      [linhas],
    );
  } catch (err: any) {
    throw semTabela(err);
  }
  return linhas.length;
}

export function errosClassificacao(codigo: string, c: Classificacao | undefined): string[] {
  if (!c) return [`Classificação tributária ${codigo} não está na tabela oficial (Configuração da NF-e, "Atualizar pela tabela oficial").`];
  if (!c.usavel) return [`Classificação tributária ${codigo} não serve para a nota do romaneio: escolha outra.`];
  return [];
}

/** JSON inteiro de sys_empresas.config (as outras chaves são de outros sistemas e ficam como estão) */
async function lerConfigEmpresa(empresaId: unknown) {
  const [[emp]] = await pool.query<any[]>('SELECT id, cnpj, uf, config FROM sys_empresas WHERE id = ?', [empresaId]);
  if (!emp) throw erro('Empresa não encontrada em sys_empresas.', 404);
  let json: Record<string, any> = {};
  try {
    json = JSON.parse(emp.config || '{}') || {};
  } catch {
    // conteúdo inválido não impede a tela de abrir; gravar substitui
  }
  return { emp, json, nfe: { ...CONFIG_PADRAO, ...(json.nfe || {}) } as ConfigNFe };
}

// ---------------------------------------------------------------------------
// Montagem da nota (DocumentoNFe do nfeWeb, server/nfe/gerarNFe.ts)
// ---------------------------------------------------------------------------

export interface DadosNota {
  romaneio: { id: number; pedido?: string | null; placa_transp?: string | null };
  /** m3 somado por produto e medidas (itens iguais viram um item da nota), na ordem do romaneio */
  itens: { id_produto: number; espessura: number; un_espessura?: string | null; largura: number; comprimento: number; m3: number }[];
  produtos: Record<
    number,
    { sku: string; nome: string; ncm?: string | null; preco_venda: number; sigla?: string | null; grupo_tributario_id?: number | null }
  >;
  /** Linhas de fis_grupos_tributarios dos produtos e do grupo padrão, por id */
  grupos: Record<number, Record<string, any>>;
  /** cClassTrib dos grupos e da configuração */
  classificacoes: Record<string, Classificacao>;
  destinatario: Record<string, any> | null;
  transportador: Record<string, any> | null;
  config: ConfigNFe;
  ufEmitente: string;
  /** 0=Emitente, 1=Destinatário, 2=Terceiros, 9=Sem frete */
  modalidadeFrete: number;
}

/** Nota em JSON e o que falta para gerá-la (vazio = pode mandar ao nfeWeb) */
export function montarDocumento(d: DadosNota) {
  const p: string[] = [];
  const cfg = d.config;
  try {
    validarConfig(cfg);
  } catch (e: any) {
    p.push(`Configuração da NF-e incompleta (menu Configuração da NF-e): ${e.message.replace(/\n/g, ' ')}`);
  }

  const dest = d.destinatario;
  const doc = so(dest?.cpf_cnpj) || String(dest?.cpf_cnpj ?? '');
  if (!dest) p.push('Cliente do romaneio não encontrado.');
  else {
    const nome = `Cliente ${dest.nome}`;
    if (!dest.cpf_cnpj) p.push(`${nome}: falta o CPF/CNPJ.`);
    if (!dest.logradouro || !dest.numero || !dest.bairro) p.push(`${nome}: falta o endereço (logradouro, número e bairro).`);
    if (!/^\d{7}$/.test(String(dest.cidade_ibge ?? ''))) p.push(`${nome}: falta o código IBGE do município (7 dígitos).`);
    if (!dest.cidade_nome || !dest.cidade_uf) p.push(`${nome}: falta a cidade e a UF.`);
    if (!/^\d{8}$/.test(String(dest.cep ?? ''))) p.push(`${nome}: falta o CEP.`);
    if (String(dest.ind_ie_dest) === '1' && !dest.ie) p.push(`${nome}: contribuinte do ICMS sem inscrição estadual.`);
  }

  const interna = !dest?.cidade_uf || dest.cidade_uf === d.ufEmitente;
  // Outra UF + não contribuinte (indFinal 1, indIEDest 9): o nfeWeb exige o grupo ICMSUFDest (rejeição 694)
  const difal = !interna && String(dest?.ind_ie_dest ?? '9') === '9';
  const aliqUF = difal ? cfg.difal?.[dest!.cidade_uf] : undefined;
  if (difal && !aliqUF) p.push(`Venda para ${dest!.cidade_uf} a não contribuinte exige o DIFAL: informe as alíquotas de ${dest!.cidade_uf} na Configuração da NF-e.`);
  const itens = d.itens.map((i) => {
    const pro = d.produtos[i.id_produto];
    if (!pro) {
      p.push(`Produto ${i.id_produto} não encontrado.`);
      return null;
    }
    if (!/^\d{8}$/.test(String(pro.ncm ?? ''))) p.push(`Produto ${pro.sku} (${pro.nome}): falta o NCM.`);
    if (!(num(pro.preco_venda) > 0)) p.push(`Produto ${pro.sku} (${pro.nome}): falta o preço de venda.`);
    if (!pro.sigla) p.push(`Produto ${pro.sku} (${pro.nome}): falta a unidade.`);
    const idGrupo = num(pro.grupo_tributario_id) || cfg.grupoPadraoId;
    const grupo = d.grupos[idGrupo];
    if (!grupo) {
      p.push(
        idGrupo
          ? `Grupo tributário ${idGrupo} não encontrado.`
          : `Produto ${pro.sku} (${pro.nome}): sem grupo tributário (ligue um no produto ou escolha o grupo padrão na Configuração da NF-e).`,
      );
    }
    const t = tributacaoDoGrupo(grupo ?? {});
    if (grupo) for (const e of errosTributacao(t)) p.push(`Grupo tributário ${grupo.descricao}: ${e}`);
    const cClass = t.ibscbsClassificacao || cfg.ibscbsClassificacao;
    const classe = d.classificacoes[cClass];
    if (cfg.ibscbs) p.push(...errosClassificacao(cClass, classe));
    // As medidas distinguem itens do mesmo produto; o nome é que cede para caber nos 120 do xProd
    const un = i.un_espessura ? ` ${String(i.un_espessura).toUpperCase()}` : '';
    const medidas = `${fmt(i.espessura, 3)}${un} X ${fmt(i.largura, 3)} X ${fmt(i.comprimento, 3)}`;
    return {
      codigo: pro.sku,
      descricao: `${String(pro.nome).slice(0, 119 - medidas.length).trim()} ${medidas}`,
      ncm: String(pro.ncm ?? ''),
      cfop: interna ? t.cfopDentroUF || cfg.cfopDentroUF : t.cfopForaUF || cfg.cfopForaUF,
      unidade: String(pro.sigla ?? '').slice(0, 6),
      quantidade: q4(i.m3),
      valorUnitario: num(pro.preco_venda),
      imposto: {
        origem: Number(t.origem),
        ...(t.csosn && { csosn: t.csosn, ...(t.aliquotaCreditoSN > 0 && { aliquotaCredito: t.aliquotaCreditoSN }) }),
        ...(t.cst && { cst: t.cst, ...(t.aliquotaICMS > 0 && { modBC: 3, aliquota: t.aliquotaICMS }) }),
        pis: { cst: t.pisCst, ...(t.aliquotaPIS > 0 && { aliquota: t.aliquotaPIS }) },
        cofins: { cst: t.cofinsCst, ...(t.aliquotaCOFINS > 0 && { aliquota: t.aliquotaCOFINS }) },
        ...(aliqUF && {
          difal: {
            aliquotaInterna: aliqUF.interna,
            aliquotaInterestadual: aliqUF.interestadual,
            ...(aliqUF.fcp > 0 && { aliquotaFCP: aliqUF.fcp }),
          },
        }),
        ...(cfg.ibscbs && {
          ibscbs: {
            cst: classe?.cst ?? '',
            classificacao: cClass,
            ...(classe?.reducao && { reducao: classe.reducao }),
            aliquotaIBSUF: cfg.aliquotaIBSUF,
            aliquotaIBSMun: cfg.aliquotaIBSMun,
            aliquotaCBS: cfg.aliquotaCBS,
          },
        }),
      },
    };
  });
  if (!itens.length) p.push('O romaneio não tem itens.');
  itens.forEach((i) => i && !(i.quantidade > 0) && p.push(`Produto ${i.codigo}: m³ zerado.`));

  const transp = d.modalidadeFrete !== 9 ? d.transportador : null;
  const docTransp = so(transp?.cpf_cnpj) || String(transp?.cpf_cnpj ?? '');
  const id6 = String(d.romaneio.id).padStart(6, '0');
  const complementar = [
    cfg.informacoesComplementares,
    `ROMANEIO ${id6}`,
    d.romaneio.pedido ? `PEDIDO ${d.romaneio.pedido}` : '',
    d.romaneio.placa_transp ? `PLACA ${String(d.romaneio.placa_transp).toUpperCase()}` : '',
  ].filter(Boolean).join(' - ');

  const documento = {
    ide: {
      naturezaOperacao: cfg.naturezaOperacao,
      serie: cfg.serie,
      tipoDocumento: 1,
      idDestino: interna ? 1 : 2,
      finalidade: 1,
      consumidorFinal: String(dest?.ind_ie_dest ?? '9') === '9' ? 1 : 0,
      presencial: Number(cfg.presencial),
    },
    destinatario: dest && {
      ...(doc.length === 11 ? { cpf: doc } : { cnpj: doc }),
      nome: String(dest.nome ?? '').slice(0, 60),
      indIEDest: Number(dest.ind_ie_dest ?? 9),
      ...(dest.ie && String(dest.ind_ie_dest) !== '2' && { inscricaoEstadual: so(dest.ie) }),
      ...(dest.email_principal && { email: dest.email_principal }),
      endereco: {
        logradouro: dest.logradouro,
        numero: dest.numero,
        ...(dest.complemento && { complemento: dest.complemento }),
        bairro: dest.bairro,
        codigoMunicipio: String(dest.cidade_ibge ?? ''),
        municipio: dest.cidade_nome,
        uf: dest.cidade_uf,
        cep: String(dest.cep ?? ''),
        ...(dest.fone_principal && { fone: so(dest.fone_principal) }),
      },
    },
    itens: itens.filter(Boolean),
    transporte: {
      modalidadeFrete: d.modalidadeFrete,
      ...(transp && {
        transportadora: {
          ...(docTransp.length === 11 ? { cpf: docTransp } : docTransp ? { cnpj: docTransp } : {}),
          nome: String(transp.nome ?? '').slice(0, 60),
          ...(transp.ie && { ie: so(transp.ie) }),
          ...(transp.logradouro && { endereco: [transp.logradouro, transp.numero].filter(Boolean).join(', ').slice(0, 60) }),
          ...(transp.cidade_nome && { municipio: transp.cidade_nome }),
          ...(transp.cidade_uf && { uf: transp.cidade_uf }),
        },
      }),
    },
    pagamentos: [{ forma: cfg.formaPagamento }],
    informacoesAdicionais: { contribuinte: complementar.slice(0, 5000) },
  };
  return { documento, pendencias: [...new Set(p)] };
}

/** Referência do romaneio no nfeWeb: a mesma referência nunca gera uma segunda nota */
export const referenciaNFe = (id: unknown) => `ROM-${String(id).padStart(6, '0')}`;

/**
 * A NF-e gerada do romaneio no BMNFe (nfe_documentos, pela referência), ou null. Rascunho (a geração não
 * terminou) e rejeitada (corrige e gera de novo) não contam: o romaneio continua livre.
 */
export async function nfeGerada(idRom: unknown): Promise<{ numero: number; situacao: string } | null> {
  // O filtro das empresas do BMNFe faz a busca usar a chave única (empresa_id, referencia)
  const [[n]] = await pool.query<any[]>(
    "SELECT numero, situacao FROM nfe_documentos WHERE empresa_id IN (SELECT id FROM nfe_empresas) AND referencia = ? AND situacao NOT IN ('rascunho', 'rejeitada') LIMIT 1",
    [referenciaNFe(idRom)],
  );
  return n ?? null;
}

async function dadosDaNota(id: unknown, empresaId: unknown, modalidadeFrete: number): Promise<DadosNota & { cnpjEmitente: string }> {
  const [[m]] = await pool.query<any[]>('SELECT * FROM lam_romaneiosm WHERE id = ?', [id]);
  if (!m) throw erro('Romaneio não encontrado.', 404);
  const gerada = await nfeGerada(m.id);
  if (gerada) throw erro(`O romaneio ${m.id} já tem a NF-e ${gerada.numero} gerada (${gerada.situacao}).`, 409);
  const [itens] = await pool.query<any[]>(
    `SELECT d.id_produto, d.espessura, d.largura, d.comprimento, SUM(d.m3) AS m3,
            (SELECT e.un_espessura FROM lam_romaneiose e WHERE e.id_pro_lamina = d.id_produto ORDER BY e.id LIMIT 1) AS un_espessura
       FROM lam_romaneiosd d WHERE d.id_rom = ?
      GROUP BY d.id_produto, d.espessura, d.largura, d.comprimento ORDER BY MIN(d.id)`,
    [id],
  );
  const ids = itens.map((i) => i.id_produto);
  let produtos: any[] = [];
  if (ids.length) {
    try {
      [produtos] = await pool.query<any[]>(
        `SELECT p.id, p.sku, p.nome, p.ncm, p.preco_venda, p.grupo_tributario_id, u.sigla
           FROM cad_produtos p LEFT JOIN cad_produtos_unidades_medida u ON u.id = p.unidade_id
          WHERE p.id IN (?)`,
        [ids],
      );
    } catch (err: any) {
      if (err?.code === 'ER_BAD_FIELD_ERROR') throw erro('Falta a coluna ncm ou grupo_tributario_id em cad_produtos (ver o SQL no CLAUDE.md do projeto).');
      throw err;
    }
  }
  const pessoa = async (pid: unknown) =>
    num(pid) ? ((await pool.query<any[]>('SELECT * FROM cad_pessoas WHERE id = ?', [pid]))[0][0] ?? null) : null;
  const { emp, nfe } = await lerConfigEmpresa(empresaId);
  const idsGrupo = [...new Set([...produtos.map((p) => num(p.grupo_tributario_id)), nfe.grupoPadraoId].filter(Boolean))];
  const [grupos] = idsGrupo.length
    ? await pool.query<any[]>('SELECT * FROM fis_grupos_tributarios WHERE id IN (?)', [idsGrupo])
    : [[] as any[]];
  const codigos = nfe.ibscbs ? [...new Set([...grupos.map((g) => so(g.cclass_trib)), nfe.ibscbsClassificacao].filter(Boolean))] : [];
  return {
    romaneio: m,
    itens: itens.map((i) => ({
      id_produto: Number(i.id_produto),
      espessura: num(i.espessura),
      un_espessura: i.un_espessura,
      largura: num(i.largura),
      comprimento: num(i.comprimento),
      m3: num(i.m3),
    })),
    produtos: Object.fromEntries(produtos.map((p) => [Number(p.id), p])),
    grupos: Object.fromEntries(grupos.map((g) => [Number(g.id), g])),
    classificacoes: await lerClassificacoes(codigos),
    destinatario: await pessoa(m.id_cliente),
    transportador: await pessoa(m.id_transp),
    config: nfe,
    ufEmitente: String(emp.uf ?? ''),
    modalidadeFrete,
    cnpjEmitente: String(emp.cnpj ?? ''),
  };
}

/**
 * Login no nfeWeb; devolve quem chama as rotas com o token (POST com corpo, GET sem; pdf = corpo em bytes).
 * O token vale 12 h, mas um login por operação basta. 404 e 409 do BMNFe passam; o resto vira 502.
 */
async function entrarNfeWeb(cnpj: string) {
  const bruto = String(process.env.BMNFE_URL || '').trim().replace(/\/+$/, '');
  // Endereço sem protocolo (ex.: nfe.bmsoft.com.br) vale como https
  const url = bruto && !/^https?:\/\//i.test(bruto) ? `https://${bruto}` : bruto;
  if (!url || !process.env.BMNFE_USUARIO) throw erro('Configure BMNFE_URL, BMNFE_USUARIO e BMNFE_SENHA no .env do romaneio.');
  const chamar = async (rota: string, body: unknown, token?: string, pdf = false) => {
    try {
      const r = await fetch(`${url}${rota}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
      const dados: any = pdf && r.ok ? Buffer.from(await r.arrayBuffer()) : await r.json().catch(() => ({}));
      return { ok: r.ok, status: r.status, dados };
    } catch (e: any) {
      throw erro(`Não foi possível falar com o BMNFe em ${url}: ${e.cause?.code || e.message}`, 502);
    }
  };
  const login = await chamar('/api/login', { cnpj, usuario: process.env.BMNFE_USUARIO, senha: process.env.BMNFE_SENHA || '' });
  if (!login.ok || !login.dados?.token) throw erro(`O BMNFe recusou o login: ${login.dados?.error || `HTTP ${login.status}`}`, 502);
  return async (caminho: string, corpo?: unknown, pdf = false) => {
    const r = await chamar(caminho, corpo, login.dados.token, pdf);
    if (!r.ok) throw erro(`BMNFe: ${r.dados?.error || `HTTP ${r.status}`}`, [404, 409].includes(r.status) ? r.status : 502);
    return r.dados;
  };
}

const chamarNfeWeb = async (cnpj: string, caminho: string, corpo?: unknown) => (await entrarNfeWeb(cnpj))(caminho, corpo);

const MODALIDADES = [0, 1, 2, 9];

export function createNFeRouter() {
  const router = Router();
  const responder = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
    try {
      const r = await fn(req, res);
      // Quem já respondeu (o PDF do DANFE) não passa pelo JSON
      if (!res.headersSent) res.json(r);
    } catch (err: any) {
      res.status(err.status || 400).json({ error: err.message || String(err) });
    }
  };

  router.get(
    '/nfe/config',
    responder(async (_req, res) => {
      const { emp, nfe } = await lerConfigEmpresa(res.locals.empresaId);
      // Situação da tabela oficial do cClassTrib (null = a tabela ainda não foi criada)
      const classificacoes = await pool
        .query<any[]>(
          "SELECT COUNT(*) AS total, DATE_FORMAT(MAX(atualizado_em), '%d/%m/%Y %H:%i') AS atualizadoEm FROM fis_classificacao_tributaria",
        )
        .then(([[l]]) => ({ total: Number(l.total), atualizadoEm: l.atualizadoEm as string | null }))
        .catch(() => null);
      return { config: nfe, ufEmitente: emp.uf, ufs: UFS.filter((uf) => uf !== emp.uf), nfeweb: Boolean(process.env.BMNFE_URL), classificacoes };
    }),
  );

  router.post(
    '/nfe/classificacoes',
    responder(async (_req, res) => ({ total: await atualizarClassificacoes(res.locals.empresaId) })),
  );

  // Séries ativas no BMNFe (tela Séries de lá): as opções da série na Configuração da NF-e
  router.get(
    '/nfe/series',
    responder(async (_req, res) => {
      const { emp } = await lerConfigEmpresa(res.locals.empresaId);
      // BMNFe antigo: rota inexistente (404) ou a página do app no lugar do JSON
      const r = await chamarNfeWeb(String(emp.cnpj ?? ''), '/api/series/ativas').catch((e) => {
        if (/HTTP 404$/.test(e.message)) return null;
        throw e;
      });
      if (!Array.isArray(r?.series)) throw erro('o BMNFe em uso ainda não tem o cadastro de Séries (publique a versão nova dele).', 502);
      return r;
    }),
  );

  router.put(
    '/nfe/config',
    responder(async (req, res) => {
      const nfe = validarConfig(req.body || {});
      const { json } = await lerConfigEmpresa(res.locals.empresaId);
      const [r] = await pool.query<any>('UPDATE sys_empresas SET config = ? WHERE id = ?', [JSON.stringify({ ...json, nfe }), res.locals.empresaId]);
      if (!r.affectedRows) throw erro('Empresa não encontrada.', 404);
      return { success: true, config: nfe };
    }),
  );

  /** Prévia do Gerar NFe: itens com m³, preço e total, e o que falta para gerar */
  router.get(
    '/romaneios/:id/nfe',
    responder(async (req, res) => {
      const d = await dadosDaNota(req.params.id, res.locals.empresaId, 9);
      const { documento, pendencias } = montarDocumento(d);
      return {
        referencia: referenciaNFe(d.romaneio.id),
        temTransportador: Boolean(d.transportador),
        itens: documento.itens.map((i: any) => ({
          codigo: i.codigo,
          descricao: i.descricao,
          unidade: i.unidade,
          quantidade: i.quantidade,
          valorUnitario: i.valorUnitario,
          valorTotal: arred(i.quantidade * i.valorUnitario, 2),
        })),
        pendencias,
      };
    }),
  );

  /** Gera a nota no nfeWeb (numerada, calculada, assinada e validada), sem transmitir */
  router.post(
    '/romaneios/:id/nfe',
    responder(async (req, res) => {
      const modalidade = Number(req.body?.modalidadeFrete);
      if (!MODALIDADES.includes(modalidade)) throw erro('Escolha a modalidade do frete.');
      const d = await dadosDaNota(req.params.id, res.locals.empresaId, modalidade);
      const { documento, pendencias } = montarDocumento(d);
      if (pendencias.length) throw erro(pendencias.join('\n'));
      return chamarNfeWeb(d.cnpjEmitente, '/api/emitir', { referencia: referenciaNFe(d.romaneio.id), documento, transmitir: false });
    }),
  );

  /** A NF-e do romaneio no BMNFe (achada pela referência ROM-000123) e quem chama o BMNFe com o login feito */
  async function notaDoRomaneio(req: Request, res: Response) {
    const id = String(req.params.id);
    if (!/^\d+$/.test(id)) throw erro('Romaneio inválido.');
    const { emp } = await lerConfigEmpresa(res.locals.empresaId);
    const chamar = await entrarNfeWeb(String(emp.cnpj ?? ''));
    const buscar = () =>
      chamar(`/api/emitir/${referenciaNFe(id)}`).catch((e) => {
        throw e.status === 404 ? erro(`O romaneio ${id} ainda não tem NF-e: use o Gerar NFe.`, 404) : e;
      });
    return { id, chamar, buscar, nota: await buscar() };
  }

  /** Enviar SEFAZ: transmite a nota já gerada (o Enviar da tela de notas do BMNFe) e devolve a situação nova */
  router.post(
    '/romaneios/:id/nfe/enviar',
    responder(async (req, res) => {
      const { id, chamar, buscar, nota } = await notaDoRomaneio(req, res);
      if (!['assinada', 'rejeitada'].includes(nota.situacao) || !nota.chave) {
        throw erro(`A NF-e ${nota.numero} do romaneio ${id} está ${nota.situacao}: só nota assinada ou rejeitada vai para a SEFAZ.`, 409);
      }
      await chamar('/api/enviar', { chave: nota.chave });
      const n = await buscar();
      return { situacao: n.situacao, numero: n.numero, serie: n.serie, protocolo: n.protocolo, cStat: n.cStat, motivo: n.motivo };
    }),
  );

  /** DANFE da NF-e do romaneio: o PDF vem do BMNFe */
  router.get(
    '/romaneios/:id/nfe/danfe',
    responder(async (req, res) => {
      const { id, chamar, nota } = await notaDoRomaneio(req, res);
      if (!nota.chave) throw erro(`A NF-e do romaneio ${id} ainda não foi assinada no BMNFe (situação: ${nota.situacao}).`);
      const pdf: Buffer = await chamar('/api/danfe', { chave: nota.chave }, true);
      res.type('application/pdf').setHeader('Content-Disposition', `inline; filename="DANFE-${nota.chave}.pdf"`);
      res.send(pdf);
    }),
  );

  return router;
}

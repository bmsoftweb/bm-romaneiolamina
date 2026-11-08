import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { pool } from './db.js';
import { TODOS_CLIENTES } from './schema.js';
import { gerarPdf } from './pdf.js';
import { enviarEmail } from './email.js';
import { errosClassificacao, errosTributacao, lerClassificacoes, nfeGerada, tributacaoDoGrupo } from './nfe.js';

/**
 * Regras do romaneio de lâminas, as mesmas do sistema Delphi (ufrmRomaneio.pas):
 * cálculo do m3, perda por produto/cliente, item novo copiado do anterior, trava do concluído,
 * Concluir (estoque por lote) e a impressão (Relat\romaneio.fr3).
 */

const erro = (mensagem: string, status = 400) => Object.assign(new Error(mensagem), { status });
const num = (v: unknown) => Number(v) || 0;

export interface MedidasItem {
  espessura: number;
  largura: number;
  comprimento: number;
  perda: number;
  qtdade: number;
}

/**
 * m3 do item = ((espessura / conversão da espessura) × largura × comprimento) × (1 − perda / 100) × qtdade,
 * arredondado nas 6 casas da coluna (decimal(20,6)).
 */
export function calcularM3(i: MedidasItem, conversaoEspessura: number): number {
  const m3 = (i.espessura / conversaoEspessura) * i.largura * i.comprimento * (1 - i.perda / 100) * i.qtdade;
  return Math.round(m3 * 1e6) / 1e6;
}

/** Erros do item, todos juntos como no Delphi (vazio = pode gravar) */
export function errosDoItem(i: MedidasItem & { pilha: number; id_maq: number }, conversaoEspessura: number, maquinaExiste: boolean): string[] {
  const erros: string[] = [];
  if (i.espessura <= 0) erros.push('Espessura deve ser maior que zero');
  if (i.largura <= 0) erros.push('Largura deve ser maior que zero');
  if (i.comprimento <= 0) erros.push('Comprimento deve ser maior que zero');
  if (i.perda < 0) erros.push('Perda deve ser maior ou igual a zero');
  // No Delphi a mensagem dizia "Perda": é a quantidade
  if (i.qtdade <= 0) erros.push('Quantidade deve ser maior que zero');
  if (i.pilha <= 0) erros.push('Você deve informar o número da pilha');
  if (!(conversaoEspessura > 0)) erros.push('Espessura do produto deve ter unidade de conversão. Utilize a tela de "Conversão"');
  if (i.id_maq && !maquinaExiste) erros.push('Código da máquina não encontrado!');
  return erros;
}

/** Perda (%) do produto para o cliente; sem perda própria, a do cliente 999999 (todos); sem nenhuma, 0 */
export async function perdaDe(idProduto: unknown, idCliente: unknown): Promise<number> {
  if (!num(idProduto)) return 0;
  const [rows] = await pool.query<any[]>(
    'SELECT perda FROM lam_romaneiosp WHERE id_produto = ? AND id_cliente IN (?, ?) ORDER BY id_cliente = ? DESC, id LIMIT 1',
    [idProduto, num(idCliente), TODOS_CLIENTES, num(idCliente)],
  );
  return rows.length ? num(rows[0].perda) : 0;
}

async function romaneio(id: unknown) {
  const [rows] = await pool.query<any[]>('SELECT * FROM lam_romaneiosm WHERE id = ?', [id]);
  if (!rows.length) throw erro('Romaneio não encontrado.', 404);
  return rows[0];
}

/** Recusa alterar romaneio concluído ou com NF-e gerada no BMNFe (nfeGerada) */
async function travar(idRom: unknown) {
  const m = await romaneio(idRom);
  if (m.status === 'C') throw erro('Romaneio concluído: não é mais possível alterá-lo.');
  const n = await nfeGerada(m.id);
  if (n) throw erro(`Romaneio com a NF-e ${n.numero} gerada (${n.situacao}): não é mais possível alterá-lo.`);
  return m;
}

/** Dígitos verificadores de CPF (11 dígitos) ou CNPJ (14: numérico ou alfanumérico, com letras nas 12 primeiras posições) */
export function cpfCnpjValido(doc: string): boolean {
  if (!/^(\d{11}|[0-9A-Z]{12}\d{2})$/.test(doc) || /^(\d)\1+$/.test(doc)) return false;
  const dv = (base: string) => {
    // Valor de cada posição = código ASCII − 48 (dígito = ele mesmo, A = 17 ... Z = 42)
    // CPF: pesos 2, 3, 4... da direita para a esquerda; CNPJ: 2 a 9, recomeçando
    const soma = [...base].reverse().reduce((s, c, i) => s + (c.charCodeAt(0) - 48) * (doc.length === 11 ? i + 2 : (i % 8) + 2), 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const corpo = doc.slice(0, -2);
  const d1 = dv(corpo);
  return `${d1}${dv(corpo + d1)}` === doc.slice(-2);
}

/** Antes do INSERT/UPDATE do CRUD genérico (server/crud.ts); id null = inclusão */
export async function antesDeGravar(recurso: string, payload: Record<string, any>, id: string | null) {
  if (recurso === 'pessoas') {
    for (const c of ['cep', 'cidade_ibge', 'fone_principal']) if (payload[c]) payload[c] = String(payload[c]).replace(/\D/g, '');
    if (payload.cep && payload.cep.length !== 8) throw erro('CEP: 8 dígitos.');
    if (payload.cidade_ibge && payload.cidade_ibge.length !== 7) throw erro('Código IBGE do município: 7 dígitos.');
    // Cidade, UF e cidade_id (FK) vêm do município escolhido; sem município, o que já está gravado fica
    if (payload.cidade_ibge) {
      const [[c]] = await pool.query<any[]>('SELECT id, nome, uf FROM cad_cidades WHERE codigo_ibge = ?', [payload.cidade_ibge]);
      if (!c) throw erro(`Município ${payload.cidade_ibge} não está na tabela do IBGE (BMNFe › Tabelas Fiscais › Municípios).`);
      Object.assign(payload, { cidade_id: c.id, cidade_nome: c.nome, cidade_uf: c.uf });
    }
    if (payload.cpf_cnpj) {
      if (!cpfCnpjValido(payload.cpf_cnpj)) throw erro('CPF/CNPJ inválido: confira os dígitos verificadores.');
      payload.tipo_pessoa = payload.cpf_cnpj.length === 11 ? 'F' : 'J';
    }
    return;
  }
  if (recurso === 'grupos_tributarios') {
    for (const c of ['cfop_dentro_uf', 'cfop_fora_uf', 'cst_pis', 'cst_cofins', 'cclass_trib']) {
      if (payload[c]) payload[c] = String(payload[c]).replace(/\D/g, '');
    }
    // Colunas NOT NULL DEFAULT 0: alíquota apagada na tela grava zero
    for (const c of ['aliquota_credito_sn', 'aliquota_icms', 'aliquota_pis', 'aliquota_cofins']) if (c in payload && payload[c] === null) payload[c] = 0;
    const atual = id === null ? {} : ((await pool.query<any[]>('SELECT * FROM fis_grupos_tributarios WHERE id = ?', [id]))[0][0] ?? {});
    const grupo = { ...atual, ...payload };
    const erros = errosTributacao(tributacaoDoGrupo(grupo));
    // O CST do IBS/CBS sai da classificação (tabela oficial)
    const cClass = String(grupo.cclass_trib ?? '');
    const classe = cClass ? (await lerClassificacoes([cClass]))[cClass] : undefined;
    if (cClass) erros.push(...errosClassificacao(cClass, classe));
    payload.cst_ibscbs = classe?.cst ?? null;
    if (erros.length) throw erro(erros.join('\n'));
    const [[{ agora }]] = await pool.query<any[]>('SELECT NOW() AS agora');
    if (id === null) payload.criado_em = agora;
    payload.atualizado_em = agora;
    return;
  }
  if (recurso === 'produtos') {
    // O padrão da coluna (categoria 0) fere a chave estrangeira para cad_produtos_categorias: sem categoria = NULL
    if (id === null) payload.categoria_id = null;
    if (payload.ncm) {
      payload.ncm = String(payload.ncm).replace(/\D/g, '');
      if (payload.ncm.length !== 8) throw erro('NCM: 8 dígitos.');
    }
    return;
  }
  if (recurso === 'romaneios') {
    if (id === null) payload.status = 'A';
    else await travar(id);
    return;
  }
  if (recurso !== 'romaneio_itens') return;

  // O romaneio do item: o gravado (alteração) e o informado, se mudou
  const [atual] = id === null ? [null] : (await pool.query<any[]>('SELECT * FROM lam_romaneiosd WHERE id = ?', [id]))[0];
  if (id !== null && !atual) throw erro('Item não encontrado.', 404);
  const idRom = payload.id_rom ?? atual?.id_rom;
  if (!num(idRom)) throw erro('Grave primeiro o romaneio!');
  for (const r of new Set([atual?.id_rom, idRom].filter(Boolean))) await travar(r);

  const item = { ...atual, ...payload };
  const [[conv]] = await pool.query<any[]>('SELECT conversao_espessura FROM lam_romaneiose WHERE id_pro_lamina = ? ORDER BY id LIMIT 1', [num(item.id_produto)]);
  const [maq] = num(item.id_maq) ? await pool.query<any[]>('SELECT 1 FROM fin_centro_custo WHERE id = ?', [item.id_maq]) : [[]];
  const medidas = {
    pilha: num(item.pilha),
    espessura: num(item.espessura),
    largura: num(item.largura),
    comprimento: num(item.comprimento),
    perda: num(item.perda),
    qtdade: num(item.qtdade),
    id_maq: num(item.id_maq),
  };
  const conversao = num(conv?.conversao_espessura);
  const erros = errosDoItem(medidas, conversao, (maq as any[]).length > 0);
  if (erros.length) throw erro(erros.join('\n'));
  payload.perda = medidas.perda;
  payload.id_maq = medidas.id_maq || null;
  payload.m3 = calcularM3(medidas, conversao);
}

/** Antes do DELETE do CRUD genérico: item de romaneio concluído ou com NF-e gerada não sai */
export async function antesDeExcluir(recurso: string, id: string) {
  if (recurso !== 'romaneio_itens') return;
  const [[item]] = await pool.query<any[]>('SELECT id_rom FROM lam_romaneiosd WHERE id = ?', [id]);
  if (item) await travar(item.id_rom);
}

/** Números no padrão brasileiro com casas fixas; "%g" do FastReport = sem zeros à direita */
const fmt = (v: unknown, casas: number) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }).format(num(v));
const fmtG = (v: unknown) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 6 }).format(num(v));
const dataBR = (d: unknown) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

let logo: string | null | undefined;
/** Logo do relatório original (public/logo.jpg), embutido para sair também no PDF */
async function logoDataUri() {
  if (logo === undefined) {
    logo = await fs
      .readFile(path.join(process.cwd(), 'public', 'logo.jpg'))
      .then((b) => `data:image/jpeg;base64,${b.toString('base64')}`)
      .catch(() => null);
  }
  return logo;
}

/** HTML de impressão no layout do Relat\romaneio.fr3: itens agrupados por produto, total por produto e geral */
export async function htmlRomaneio(id: unknown, empresaId: unknown): Promise<string> {
  const [[m]] = await pool.query<any[]>(
    `SELECT t.*, (SELECT p.nome FROM cad_pessoas p WHERE p.id = t.id_cliente) AS cli_nome,
            (SELECT p.nome FROM cad_produtos p WHERE p.id = t.id_produto) AS pro_desc,
            (SELECT p.nome FROM cad_pessoas p WHERE p.id = t.id_transp) AS tra_nome
       FROM lam_romaneiosm t WHERE t.id = ?`,
    [id],
  );
  if (!m) throw erro('Romaneio não encontrado.', 404);
  const [itens] = await pool.query<any[]>(
    `SELECT t.*, (SELECT p.nome FROM cad_produtos p WHERE p.id = t.id_produto) AS pro_desc,
            (SELECT e.un_espessura FROM lam_romaneiose e WHERE e.id_pro_lamina = t.id_produto ORDER BY e.id LIMIT 1) AS un_espessura
       FROM lam_romaneiosd t WHERE t.id_rom = ? ORDER BY t.id_produto, t.id`,
    [id],
  );
  const [[emp]] = await pool.query<any[]>('SELECT * FROM sys_empresas WHERE id = ?', [empresaId]);
  const img = await logoDataUri();

  const empresa = emp
    ? [
        emp.razao_social,
        [emp.logradouro, emp.numero, emp.bairro].filter(Boolean).join(', '),
        `${emp.cidade ?? ''} - ${emp.uf ?? ''}${emp.cep ? ` - CEP ${String(emp.cep).replace(/^(\d{2})(\d{3})(\d{3})$/, '$1.$2-$3')}` : ''}`,
        emp.telefone ? `Fone: ${emp.telefone}` : '',
        emp.email ? `e-mail: ${emp.email}` : '',
      ].filter(Boolean)
    : [];

  let linhas = '';
  let total = 0;
  for (let i = 0; i < itens.length; i++) {
    const it = itens[i];
    total += num(it.m3);
    linhas += `<tr>
      <td class="c">${esc(it.pilha)}</td><td>${esc(it.id_produto)}-${esc(it.pro_desc)}</td>
      <td class="c">${fmt(it.espessura, 3)}</td><td class="c un">${esc(it.un_espessura)}</td>
      <td class="c">${fmt(it.largura, 2)}</td><td class="c">${fmt(it.comprimento, 2)}</td>
      <td class="c">${fmtG(it.perda)}%</td><td class="c">${fmtG(it.qtdade)}</td><td class="c ult">${fmt(it.m3, 3)}</td></tr>`;
    // Rodapé do grupo (produto): soma do m3
    if (itens[i + 1]?.id_produto !== it.id_produto) {
      const doGrupo = itens.filter((x) => x.id_produto === it.id_produto).reduce((s, x) => s + num(x.m3), 0);
      linhas += `<tr class="grupo"><td colspan="8"></td><td class="c"><b>${fmt(doGrupo, 3)}</b></td></tr>`;
    }
  }

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Romaneio ${String(m.id).padStart(6, '0')}</title>
<style>
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10pt; color: #000; margin: 0; }
  .topo { display: flex; justify-content: space-between; align-items: flex-start; }
  .topo img { width: 55mm; }
  .empresa { text-align: right; white-space: pre-line; line-height: 1.35; }
  h1 { text-align: right; font-size: 14pt; margin: 4mm 0 1mm; }
  .cab { border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 2mm 0; display: grid; grid-template-columns: 27mm 1fr auto; gap: 1.5mm 2mm; }
  .cab b { text-align: right; }
  .dir { text-align: right; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 1mm 1.5mm; border-right: 1px solid #000; border-bottom: 1px solid #000; }
  th { font-weight: bold; text-align: center; }
  th:last-child, td.ult { border-right: 0; }
  td.c { text-align: center; }
  td.un { padding: 1mm 0.5mm; }
  tr.grupo td { border-right: 0; border-bottom: 1px solid #000; }
  .total { display: flex; justify-content: flex-end; gap: 6mm; border-top: 1px solid #000; margin-top: 2mm; padding-top: 1mm; }
  .total b { width: 28mm; text-align: center; }
</style></head><body>
<div class="topo">${img ? `<img src="${img}" alt="">` : '<span></span>'}<div class="empresa">${empresa.map(esc).join('\n')}</div></div>
<h1>ROMANEIO DE LÂMINA</h1>
<div class="cab">
  <b>Cliente:</b><span>${esc(m.cli_nome)}</span><span class="dir">${dataBR(m.data)}</span>
  <b>Produto:</b><span>${esc(m.pro_desc)}</span><b class="dir">CONTROLE: ${esc(m.id)}</b>
  <b>Transportador:</b><span>${m.id_transp ? `${esc(m.id_transp)}-${esc(m.tra_nome)}` : ''}</span><span class="dir">Pedido de Venda: ${esc(m.pedido ?? '')}</span>
</div>
<table>
  <thead><tr><th style="width:11mm">Pilha</th><th>Descrição</th><th colspan="2" style="width:24mm">Esp.</th><th style="width:18mm">Larg.</th>
  <th style="width:18mm">Comp.</th><th style="width:15mm">Perda</th><th style="width:14mm">Qtdade.</th><th style="width:28mm">m3</th></tr></thead>
  <tbody>${linhas}</tbody>
</table>
<div class="total"><span>TOTAL GERAL:</span><b>${fmt(total, 3)}</b></div>
<script>window.onload = () => { window.focus(); window.print(); };</script>
</body></html>`;
}

/** Documento do romaneio no estoque (código do lote e observação dos movimentos): ROM/ + id com 5 dígitos */
export const documentoRomaneio = (id: unknown) => `ROM/${String(id).padStart(5, '0')}`;

/** Quantidades do estoque: decimal(15,4) */
const q4 = (v: number) => Math.round(v * 1e4) / 1e4;

/**
 * PEPS: tira a quantidade dos lotes na ordem recebida (mais antigo primeiro), até o saldo de cada um;
 * o que faltar sai do lote mais novo, que fica negativo. `lotes` não pode vir vazio.
 */
export function distribuirPeps(lotes: { id: number; saldo: number }[], quantidade: number): { lote: number; quantidade: number }[] {
  const partes: { lote: number; quantidade: number }[] = [];
  let resta = q4(quantidade);
  for (const l of lotes) {
    const tira = Math.min(resta, q4(l.saldo));
    if (tira <= 0) continue;
    partes.push({ lote: l.id, quantidade: tira });
    resta = q4(resta - tira);
  }
  if (resta > 0) {
    const ultimo = lotes[lotes.length - 1].id;
    const parte = partes.find((p) => p.lote === ultimo);
    if (parte) parte.quantidade = q4(parte.quantidade + resta);
    else partes.push({ lote: ultimo, quantidade: resta });
  }
  return partes;
}

type Conexao = Awaited<ReturnType<typeof pool.getConnection>>;

/** Soma no saldo do lote na localização */
async function somarSaldo(conn: Conexao, lote: number, localizacao: number, quantidade: number) {
  // ponytail: est_estoque_saldo não tem chave única (lote_id, localizacao_id), então UPDATE e, sem linha, INSERT;
  // com a chave, trocar por INSERT ... ON DUPLICATE KEY UPDATE
  const [r] = await conn.query<any>('UPDATE est_estoque_saldo SET quantidade = quantidade + ? WHERE lote_id = ? AND localizacao_id = ? LIMIT 1', [
    quantidade,
    lote,
    localizacao,
  ]);
  if (!r.affectedRows) await conn.query('INSERT INTO est_estoque_saldo (lote_id, localizacao_id, quantidade) VALUES (?, ?, ?)', [lote, localizacao, quantidade]);
}

/**
 * Concluir: quando baixar_estoque = 'S', dá entrada (m3) de cada lâmina num lote novo do romaneio e baixa
 * as toras (m3 × conversão) dos lotes por PEPS, na localização ESTOQUE_LOCALIZACAO_ID; depois marca o
 * romaneio como concluído. Tudo numa transação.
 */
async function concluir(id: string, usuario: string) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[m]] = await conn.query<any[]>(
      'SELECT t.*, (SELECT p.nome FROM cad_pessoas p WHERE p.id = t.id_cliente) AS cli_nome FROM lam_romaneiosm t WHERE t.id = ? FOR UPDATE',
      [id],
    );
    if (!m) throw erro('Romaneio não encontrado.', 404);
    if (m.status === 'C') throw erro('Romaneio já está concluído!');

    const [itens] = await conn.query<any[]>('SELECT * FROM lam_romaneiosd WHERE id_rom = ? ORDER BY id', [id]);
    // Por produto, na ordem em que aparecem (como a tabela temporária do Delphi)
    const movimentos = new Map<number, { tipo: 'E' | 'S'; qtdade: number }>();
    const somar = (produto: number, tipo: 'E' | 'S', qtdade: number) => {
      const mov = movimentos.get(produto) ?? movimentos.set(produto, { tipo, qtdade: 0 }).get(produto)!;
      mov.qtdade += qtdade;
    };
    for (const it of itens) {
      somar(num(it.id_produto), 'E', num(it.m3));
      const [[conv]] = await conn.query<any[]>('SELECT id_pro_tora, conversao FROM lam_romaneiose WHERE id_pro_lamina = ? ORDER BY id LIMIT 1', [it.id_produto]);
      if (!conv) {
        throw erro(
          `Produto (Lâmina) com ID ${it.id_produto} não encontrado na tabela de conversão.\nRotina será abortada!\nCorrija o problema e repita a operação!`,
        );
      }
      somar(num(conv.id_pro_tora), 'S', num(it.m3) * num(conv.conversao));
    }

    let lancamentos = 0;
    if (m.baixar_estoque === 'S') {
      const loc = num(process.env.ESTOQUE_LOCALIZACAO_ID);
      const [[existe]] = loc ? await conn.query<any[]>('SELECT 1 AS ok FROM cad_produtos_localizacoes WHERE id = ?', [loc]) : [[]];
      if (!existe) throw erro(`Localização do estoque (ESTOQUE_LOCALIZACAO_ID = ${loc || 'vazio'} no .env) não encontrada em cad_produtos_localizacoes.`);

      const documento = documentoRomaneio(m.id);
      const novoLote = async (produto: number, custo: unknown) => {
        const [r] = await conn.query<any>(
          `INSERT INTO cad_produtos_lotes (codigo, numero_lote, produto_id, data_entrada, preco_custo, custo_unitario, observacao)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [documento, documento, produto, m.data, custo ?? 0, custo ?? 0, `ROMANEIO ${documento} - ${m.cli_nome ?? ''}`],
        );
        return Number(r.insertId);
      };
      const lancar = async (tipo: 'E' | 'S', produto: number, lote: number, quantidade: number, custo: unknown) => {
        await conn.query(
          `INSERT INTO est_estoque_movimentacoes
             (tipo, lote_id, localizacao_orig_id, localizacao_dest_id, quantidade, custo_unitario, referencia_tipo, referencia_id, produto_id, usuario, observacao)
           VALUES (?, ?, ?, ?, ?, ?, 'romaneio', ?, ?, ?, ?)`,
          [
            tipo === 'E' ? 'producao_entrada' : 'producao_saida',
            lote,
            tipo === 'S' ? loc : null,
            tipo === 'E' ? loc : null,
            quantidade,
            custo ?? null,
            m.id,
            produto,
            usuario,
            `${tipo === 'E' ? 'ENTRADA' : 'SAIDA'} POR ROMANEIO ${documento} - ${m.cli_nome ?? ''}`,
          ],
        );
        await somarSaldo(conn, lote, loc, tipo === 'E' ? quantidade : -quantidade);
        lancamentos++;
      };

      for (const [produto, mov] of movimentos) {
        const quantidade = q4(mov.qtdade);
        if (quantidade <= 0) continue;
        const [[pro]] = await conn.query<any[]>('SELECT preco_custo FROM cad_produtos WHERE id = ?', [produto]);
        const custo = pro?.preco_custo;
        if (mov.tipo === 'E') {
          await lancar('E', produto, await novoLote(produto, custo), quantidade, custo);
          continue;
        }
        // Tora: lotes ativos com o saldo na localização, do mais antigo para o mais novo (travados até o fim da transação)
        const [lotes] = await conn.query<any[]>(
          `SELECT l.id, COALESCE((SELECT SUM(s.quantidade) FROM est_estoque_saldo s WHERE s.lote_id = l.id AND s.localizacao_id = ?), 0) AS saldo
             FROM cad_produtos_lotes l WHERE l.produto_id = ? AND l.ativo = 1 ORDER BY l.data_entrada, l.id FOR UPDATE`,
          [loc, produto],
        );
        const doPeps = lotes.length ? lotes.map((l) => ({ id: Number(l.id), saldo: num(l.saldo) })) : [{ id: await novoLote(produto, custo), saldo: 0 }];
        for (const p of distribuirPeps(doPeps, quantidade)) await lancar('S', produto, p.lote, p.quantidade, custo);
      }
    }
    await conn.query("UPDATE lam_romaneiosm SET status = 'C' WHERE id = ?", [id]);
    await conn.commit();
    return { lancamentos };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

export function createRomaneioRouter() {
  const router = Router();
  const responder = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
    try {
      const r = await fn(req, res);
      if (!res.headersSent) res.json(r ?? { success: true });
    } catch (err: any) {
      res.status(err.status || 400).json({ error: err.message || String(err) });
    }
  };

  /** Perda do produto para o cliente do romaneio (ao trocar o produto do item) */
  router.get(
    '/romaneios/:id/perda',
    responder(async (req) => ({ perda: await perdaDe(req.query.produto, (await romaneio(req.params.id)).id_cliente) })),
  );

  /** Valores do item novo: copia o último item do romaneio, pilha + 1, e a perda do produto para o cliente */
  router.get(
    '/romaneios/:id/novo-item',
    responder(async (req) => {
      const m = await travar(req.params.id);
      const [[ult]] = await pool.query<any[]>('SELECT * FROM lam_romaneiosd WHERE id_rom = ? ORDER BY id DESC LIMIT 1', [m.id]);
      const produto = ult?.id_produto ?? m.id_produto ?? null;
      return {
        pilha: num(ult?.pilha) + 1,
        id_produto: produto,
        espessura: ult?.espessura ?? null,
        largura: ult?.largura ?? null,
        comprimento: ult?.comprimento ?? null,
        qtdade: ult?.qtdade ?? null,
        perda: await perdaDe(produto, m.id_cliente),
        id_maq: ult?.id_maq ?? null,
      };
    }),
  );

  router.post(
    '/romaneios/:id/concluir',
    responder(async (req, res) => concluir(req.params.id, String(res.locals.usuario?.login ?? ''))),
  );

  /** Página de impressão (abre numa janela e chama a impressão do navegador) */
  router.get(
    '/romaneios/:id/impressao',
    responder(async (req, res) => {
      res.type('html').send(await htmlRomaneio(req.params.id, res.locals.empresaId));
    }),
  );

  /** Dados que o diálogo do e-mail já traz preenchidos */
  router.get(
    '/romaneios/:id/email',
    responder(async (req, res) => {
      const m = await romaneio(req.params.id);
      const [[emp]] = await pool.query<any[]>('SELECT razao_social, nome_fantasia FROM sys_empresas WHERE id = ?', [res.locals.empresaId]);
      return {
        para: process.env.ROMANEIO_EMAIL_PARA || '',
        assunto: `Romaneio nr.${String(m.id).padStart(6, '0')}`,
        mensagem: emp?.nome_fantasia || emp?.razao_social || '',
        anexo: `romaneio${String(m.id).padStart(6, '0')}.pdf`,
      };
    }),
  );

  /** e-Mail: PDF do romaneio anexado (romaneio000123.pdf) */
  router.post(
    '/romaneios/:id/email',
    responder(async (req, res) => {
      const para = String(req.body?.para ?? '').trim();
      if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+(\s*[,;]\s*[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+)*$/.test(para)) throw erro('Informe um e-mail válido em "Para".');
      const m = await romaneio(req.params.id);
      const nome = `romaneio${String(m.id).padStart(6, '0')}`;
      const pdf = await gerarPdf(await htmlRomaneio(m.id, res.locals.empresaId));
      await enviarEmail({
        para: para.replace(/;/g, ','),
        assunto: String(req.body?.assunto || `Romaneio nr.${String(m.id).padStart(6, '0')}`).slice(0, 200),
        texto: String(req.body?.mensagem ?? '').slice(0, 5000),
        anexos: [{ nome: `${nome}.pdf`, conteudo: pdf }],
      });
      return { success: true };
    }),
  );

  return router;
}

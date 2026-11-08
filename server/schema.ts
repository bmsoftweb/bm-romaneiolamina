/**
 * Registro central de metadados das tabelas do romaneio de lâminas (banco do ERP BMsoft).
 *
 * Este arquivo é a ÚNICA fonte de verdade das telas de manutenção:
 *  - o backend usa para montar SQL com whitelist de colunas (evita SQL injection);
 *  - o frontend consome via GET /api/meta/resources para desenhar as telas de CRUD.
 *
 * Tabelas próprias: lam_romaneiosm/d/e/p. Do ERP: cad_pessoas, cad_produtos e fin_centro_custo (máquinas).
 * Como no sistema Delphi, nenhuma delas é separada por empresa: a empresa ativa só vale no cardex.
 */

export type FieldType = 'text' | 'textarea' | 'number' | 'decimal' | 'date' | 'datetime' | 'time' | 'enum' | 'boolean' | 'password' | 'cnpj';

export interface FieldDef {
  /** Nome da coluna no MySQL */
  name: string;
  /** Rótulo exibido na interface */
  label: string;
  type: FieldType;
  /** Texto auxiliar exibido abaixo do campo no formulário */
  hint?: string;
  placeholder?: string;
  required?: boolean;
  /** Campo apenas leitura (gerado pelo banco ou pelo sistema): nunca vai em INSERT/UPDATE */
  readOnly?: boolean;
  /** Exibido na grade de listagem */
  listed?: boolean;
  /** Participa da busca textual (LIKE) da barra de busca rápida */
  searchable?: boolean;
  /** Aparece no painel de busca avançada */
  filterable?: boolean;
  /** Opções para type === 'enum' */
  options?: { value: string; label: string }[];
  /** type === 'boolean' numa coluna char(1) 'S'/'N': grava 'S'/'N' (a leitura vem do sql, como 1/0) */
  simNao?: boolean;
  /** Chave estrangeira: carrega o combo a partir de outro recurso */
  ref?: { resource: string; labelField: string };
  /** Opções do combo além das do recurso ligado, aceitas sem existir na tabela (ex.: cliente 999999 = todos) */
  opcoesExtras?: { value: string; label: string }[];
  /** Casas decimais para type === 'decimal' */
  scale?: number;
  /** Inteiro com zeros à esquerda na lista (ex.: pilha "01") */
  digitos?: number;
  /** Texto depois do número na lista (ex.: "%" da perda) */
  sufixo?: string;
  /** Texto digitado em maiúsculas */
  maiusculas?: boolean;
  maxLength?: number;
  /** Valor inicial na inclusão ("hoje" em campo de data = a data do dia) */
  default?: string | number | boolean;
  /** Largura sugerida da coluna na grade */
  width?: 'xs' | 'sm' | 'md' | 'lg';
  /** Colunas que o campo ocupa no formulário (de 4); sem isto vale a regra padrão */
  span?: number;
  /**
   * Coluna calculada: expressão SQL sobre o alias "t" (ex.: subconsulta do nome do cliente).
   * Com readOnly, não existe na tabela e não aparece no formulário.
   */
  sql?: string;
  /** type === 'enum': na lista vira um ícone com a cor da situação, e o nome dela fica no tooltip */
  icone?: boolean;
}

/** Grade filha exibida no rodapé da listagem quando uma linha é selecionada (mestre-detalhe) */
export interface DetailDef {
  resource: string;
  foreignKey: string;
  label: string;
  /** Campo decimal do filho totalizado no rodapé do painel */
  totalField?: string;
  /** Casas do total no rodapé */
  totalScale?: number;
  /** Painel com incluir, editar e excluir (formulário numa janela), com a chave do pai preenchida */
  editavel?: boolean;
}

export interface ResourceDef {
  /** Identificador usado nas rotas: /api/crud/:resource */
  name: string;
  table: string;
  label: string;
  labelSingular: string;
  description: string;
  /** Ícone lucide-react renderizado na sidebar */
  icon: string;
  /** Agrupamento na sidebar */
  group: 'romaneio' | 'cadastros';
  /** Não aparece no menu (só como detalhe ou combo de outro recurso) */
  oculto?: boolean;
  /** Chave primária */
  pk: string[];
  autoIncrement: boolean;
  /** Campo usado como rótulo em combos de chave estrangeira */
  labelField: string;
  /** SELECT próprio para os combos (colunas value e label) */
  optionsSql?: string;
  defaultSort: { field: string; dir: 'asc' | 'desc' };
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  /** Toggle na barra da lista: desligado, acrescenta estes filtros (ex.: só as máquinas) */
  toggleMostrar?: { label: string; dica: string; ocultar: { field: string; op: 'eq' | 'ne' | 'contains'; value: string }[] };
  details?: DetailDef[];
  /** O formulário não mostra a caixa "Dados gerados pelo banco" */
  semDadosDoBanco?: boolean;
  fields: FieldDef[];
}

/** Cliente da perda que vale para todos os clientes sem perda própria (como no Delphi) */
export const TODOS_CLIENTES = 999999;

const ID: FieldDef = { name: 'id', label: 'ID', type: 'number', readOnly: true, listed: true, width: 'xs' };

/** Nome de um registro do ERP pela chave (coluna calculada da lista) */
export const UFS = 'AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' ');

const opcoes = (lista: [string, string][]) => lista.map(([value, label]) => ({ value, label: `${value} - ${label}` }));
const ORIGENS = opcoes([
  ['0', 'Nacional'],
  ['1', 'Estrangeira, importação direta'],
  ['2', 'Estrangeira, adquirida no mercado interno'],
  ['3', 'Nacional, importação acima de 40% e até 70%'],
  ['4', 'Nacional, processos produtivos básicos'],
  ['5', 'Nacional, importação até 40%'],
  ['6', 'Estrangeira, importação direta sem similar'],
  ['7', 'Estrangeira, mercado interno sem similar'],
  ['8', 'Nacional, importação acima de 70%'],
]);
// ponytail: só os códigos sem substituição tributária (os que a nota do romaneio monta: CSOSN_ACEITOS/CST_ACEITOS em nfe.ts)
const CSOSN = opcoes([
  ['101', 'Tributada com permissão de crédito'],
  ['102', 'Tributada sem permissão de crédito'],
  ['103', 'Isenção por faixa de receita bruta'],
  ['300', 'Imune'],
  ['400', 'Não tributada'],
]);
const CST_ICMS = opcoes([
  ['00', 'Tributada integralmente'],
  ['40', 'Isenta'],
  ['41', 'Não tributada'],
  ['50', 'Suspensão'],
]);

// CST do PIS e da COFINS (tabela do Manual da NF-e); o mesmo código serve aos dois.
// ponytail: sem o 03 (alíquota por unidade de medida): a nota do romaneio não monta o PISQtde
export const CST_PIS_COFINS = opcoes([
  ['01', 'Tributável com alíquota básica'],
  ['02', 'Tributável com alíquota diferenciada'],
  ['04', 'Monofásica, revenda a alíquota zero'],
  ['05', 'Substituição tributária'],
  ['06', 'Alíquota zero'],
  ['07', 'Isenta da contribuição'],
  ['08', 'Sem incidência da contribuição'],
  ['09', 'Suspensão da contribuição'],
  ['49', 'Outras operações de saída'],
  ['50', 'Direito a crédito, receita tributada no mercado interno'],
  ['51', 'Direito a crédito, receita não tributada no mercado interno'],
  ['52', 'Direito a crédito, receita de exportação'],
  ['53', 'Direito a crédito, receitas tributadas e não tributadas no mercado interno'],
  ['54', 'Direito a crédito, receitas tributadas no mercado interno e de exportação'],
  ['55', 'Direito a crédito, receitas não tributadas no mercado interno e de exportação'],
  ['56', 'Direito a crédito, receitas tributadas e não tributadas no mercado interno e de exportação'],
  ['60', 'Crédito presumido, receita tributada no mercado interno'],
  ['61', 'Crédito presumido, receita não tributada no mercado interno'],
  ['62', 'Crédito presumido, receita de exportação'],
  ['63', 'Crédito presumido, receitas tributadas e não tributadas no mercado interno'],
  ['64', 'Crédito presumido, receitas tributadas no mercado interno e de exportação'],
  ['65', 'Crédito presumido, receitas não tributadas no mercado interno e de exportação'],
  ['66', 'Crédito presumido, receitas tributadas e não tributadas no mercado interno e de exportação'],
  ['67', 'Crédito presumido, outras operações'],
  ['70', 'Aquisição sem direito a crédito'],
  ['71', 'Aquisição com isenção'],
  ['72', 'Aquisição com suspensão'],
  ['73', 'Aquisição a alíquota zero'],
  ['74', 'Aquisição sem incidência da contribuição'],
  ['75', 'Aquisição por substituição tributária'],
  ['98', 'Outras operações de entrada'],
  ['99', 'Outras operações'],
]);

/**
 * cClassTrib que a nota do romaneio consegue montar (condição SQL sobre o alias "t" de fis_classificacao_tributaria):
 * de NF-e, em vigor, CST 000/200/400/410 e sem grupo especial (tributação regular, monofasia, estorno de crédito)
 * nem redução diferente entre IBS e CBS (o nfeWeb leva uma redução só)
 */
export const CLASSIFICACAO_NA_NFE = `t.ind_nfe = 1 AND t.cst IN ('000', '200', '400', '410') AND t.ind_trib_regular = 0
  AND t.ind_monofasica = 0 AND t.ind_estorno_cred = 0 AND t.p_red_ibs = t.p_red_cbs
  AND (t.fim_vigencia IS NULL OR t.fim_vigencia >= CURDATE())`;

const nomePessoa = (campo: string) => `(SELECT p.nome FROM cad_pessoas p WHERE p.id = t.${campo})`;
const descProduto = (campo: string) => `(SELECT p.nome FROM cad_produtos p WHERE p.id = t.${campo})`;

/** Tabela oficial de CFOP (IT 2023.002, baixada no BMNFe › Tabelas Fiscais): só alimenta os combos, com os de saída aceitos na NF-e e em vigor */
const cfops = (name: string, inicio: '5' | '6', label: string): ResourceDef => ({
  name,
  table: 'fis_cfop',
  label,
  labelSingular: 'CFOP',
  description: 'CFOP da tabela oficial',
  icon: 'Receipt',
  group: 'cadastros',
  oculto: true,
  pk: ['cfop'],
  autoIncrement: false,
  labelField: 'titulo',
  optionsSql: `SELECT t.cfop AS value, t.titulo AS label FROM fis_cfop t
                WHERE t.cfop LIKE '${inicio}%' AND t.ind_nfe = 1 AND (t.fim_vigencia IS NULL OR t.fim_vigencia >= CURDATE())
                ORDER BY t.cfop`,
  defaultSort: { field: 'cfop', dir: 'asc' },
  canCreate: false,
  canUpdate: false,
  canDelete: false,
  fields: [
    { name: 'cfop', label: 'CFOP', type: 'text', listed: true },
    { name: 'titulo', label: 'Título', type: 'text', listed: true, searchable: true },
  ],
});

export const RESOURCES: ResourceDef[] = [
  // ============================================================
  // ROMANEIO
  // ============================================================
  {
    name: 'romaneios',
    table: 'lam_romaneiosm',
    label: 'Romaneios',
    labelSingular: 'Romaneio',
    description: 'Romaneios de lâminas: pilhas, medidas, perda e m3; Concluir baixa o estoque',
    icon: 'ClipboardList',
    group: 'romaneio',
    pk: ['id'],
    autoIncrement: true,
    labelField: 'id',
    defaultSort: { field: 'id', dir: 'desc' },
    canCreate: true,
    canUpdate: true,
    // Como no Delphi (grade com Deleting=False): romaneio não se exclui
    canDelete: false,
    details: [{ resource: 'romaneio_itens', foreignKey: 'id_rom', label: 'Itens', totalField: 'm3', totalScale: 4, editavel: true }],
    fields: [
      // Situação: A = aberto (padrão na inclusão), C = concluído (pelo botão Concluir, não pelo formulário)
      { name: 'status', label: 'Situação', type: 'enum', readOnly: true, listed: true, filterable: true, width: 'xs', options: [{ value: 'A', label: 'Aberto' }, { value: 'C', label: 'Concluído' }] },
      // NF-e do Gerar NFe: a nota do BMNFe com a referência do romaneio (referenciaNFe, ROM-000123), vazia sem nota
      {
        name: 'nfe_situacao',
        label: 'NF-e',
        type: 'enum',
        readOnly: true,
        listed: true,
        filterable: true,
        width: 'xs',
        icone: true,
        options: ['rascunho', 'assinada', 'enviada', 'processando', 'autorizada', 'rejeitada', 'cancelada', 'denegada'].map((s) => ({
          value: s,
          label: s[0].toUpperCase() + s.slice(1),
        })),
        // O filtro das empresas do BMNFe faz a busca usar a chave única (empresa_id, referencia) em vez de varrer as notas
        sql: "(SELECT n.situacao FROM nfe_documentos n WHERE n.empresa_id IN (SELECT e.id FROM nfe_empresas e) AND n.referencia = CONCAT('ROM-', LPAD(t.id, GREATEST(6, LENGTH(t.id)), '0')) LIMIT 1)",
      },
      {
        name: 'baixar_estoque',
        label: 'Baixar estoque',
        type: 'boolean',
        simNao: true,
        listed: true,
        filterable: true,
        width: 'xs',
        default: true,
        sql: "IF(t.baixar_estoque = 'S', 1, 0)",
        hint: 'Ao concluir, lança no estoque a entrada das lâminas e a saída das toras',
      },
      { ...ID, label: 'Rom.' },
      { name: 'pedido', label: 'Pedido', type: 'number', listed: true, filterable: true, width: 'xs' },
      { name: 'id_cliente', label: 'ID/Cli', type: 'number', required: true, listed: true, filterable: true, width: 'xs', ref: { resource: 'pessoas', labelField: 'nome' } },
      { name: 'cliente_nome', label: 'Cliente', type: 'text', readOnly: true, listed: true, searchable: true, filterable: true, sql: nomePessoa('id_cliente') },
      { name: 'cliente_cidade', label: 'Cidade', type: 'text', readOnly: true, listed: true, filterable: true, sql: '(SELECT p.cidade_nome FROM cad_pessoas p WHERE p.id = t.id_cliente)' },
      { name: 'data', label: 'Data', type: 'date', required: true, listed: true, filterable: true, default: 'hoje' },
      { name: 'id_produto', label: 'ID/Produto', type: 'number', listed: true, filterable: true, width: 'xs', ref: { resource: 'produtos', labelField: 'nome' } },
      { name: 'produto_desc', label: 'Produto', type: 'text', readOnly: true, listed: true, filterable: true, sql: descProduto('id_produto') },
      { name: 'id_transp', label: 'ID/Transp', type: 'number', listed: true, filterable: true, width: 'xs', ref: { resource: 'pessoas', labelField: 'nome' } },
      { name: 'transp_nome', label: 'Transportador', type: 'text', readOnly: true, listed: true, filterable: true, sql: nomePessoa('id_transp') },
      { name: 'placa_transp', label: 'Placa', type: 'text', listed: true, filterable: true, maxLength: 8, maiusculas: true, width: 'xs' },
      { name: 'obs', label: 'Observação', type: 'textarea', span: 4 },
    ],
  },
  {
    name: 'romaneio_itens',
    table: 'lam_romaneiosd',
    label: 'Itens do Romaneio',
    labelSingular: 'Item',
    description: 'Pilhas do romaneio',
    icon: 'Layers',
    group: 'romaneio',
    oculto: true,
    pk: ['id'],
    autoIncrement: true,
    labelField: 'pilha',
    // Ordem do Delphi: id_rom + id (a ordem em que as pilhas foram lançadas)
    defaultSort: { field: 'id', dir: 'asc' },
    canCreate: true,
    canUpdate: true,
    canDelete: true,
    semDadosDoBanco: true,
    fields: [
      { ...ID, listed: false },
      { name: 'id_rom', label: 'Romaneio', type: 'number', required: true },
      { name: 'pilha', label: 'Pilha', type: 'number', required: true, listed: true, digitos: 2, width: 'xs' },
      { name: 'id_produto', label: 'ID/Produto', type: 'number', required: true, listed: true, width: 'xs', span: 2, ref: { resource: 'produtos', labelField: 'nome' } },
      { name: 'produto_desc', label: 'Produto', type: 'text', readOnly: true, listed: true, sql: descProduto('id_produto') },
      { name: 'espessura', label: 'Esp', type: 'decimal', scale: 4, required: true, listed: true },
      // Unidade da espessura vem da conversão de estoque da lâmina
      { name: 'un_espessura', label: 'Un.', type: 'text', readOnly: true, listed: true, width: 'xs', sql: '(SELECT e.un_espessura FROM lam_romaneiose e WHERE e.id_pro_lamina = t.id_produto ORDER BY e.id LIMIT 1)' },
      { name: 'largura', label: 'Largura', type: 'decimal', scale: 3, required: true, listed: true },
      { name: 'comprimento', label: 'Comprim.', type: 'decimal', scale: 3, required: true, listed: true },
      { name: 'perda', label: 'Perda (%)', type: 'decimal', scale: 3, listed: true, sufixo: '%', hint: 'Vem da tela Perdas (produto e cliente do romaneio)' },
      { name: 'qtdade', label: 'Qtdade.', type: 'decimal', scale: 3, required: true, listed: true },
      // Calculado no servidor ao gravar (server/romaneio.ts)
      { name: 'm3', label: 'M3', type: 'decimal', scale: 3, readOnly: true, listed: true },
      { name: 'id_maq', label: 'Maq', type: 'number', listed: true, width: 'xs', ref: { resource: 'maquinas', labelField: 'descricao' } },
      { name: 'maq_desc', label: 'Descrição Maq.', type: 'text', readOnly: true, listed: true, sql: '(SELECT c.descricao FROM fin_centro_custo c WHERE c.id = t.id_maq)' },
    ],
  },
  {
    name: 'conversao',
    table: 'lam_romaneiose',
    label: 'Conversão',
    labelSingular: 'Conversão',
    description: 'Conversão de estoque: unidade e fator da espessura da lâmina e quanto de tora ela consome',
    icon: 'Repeat',
    group: 'romaneio',
    pk: ['id'],
    autoIncrement: true,
    labelField: 'id',
    defaultSort: { field: 'id', dir: 'asc' },
    canCreate: true,
    canUpdate: true,
    canDelete: true,
    fields: [
      ID,
      { name: 'id_pro_lamina', label: 'ID/Lâmina', type: 'number', required: true, listed: true, filterable: true, width: 'xs', span: 2, ref: { resource: 'produtos', labelField: 'nome' } },
      { name: 'lamina_desc', label: 'Lâmina', type: 'text', readOnly: true, listed: true, searchable: true, filterable: true, sql: descProduto('id_pro_lamina') },
      { name: 'un_espessura', label: 'Un/Espessura', type: 'text', listed: true, maxLength: 3, width: 'xs', hint: 'Ex.: mm' },
      { name: 'conversao_espessura', label: 'Conversão/Espessura', type: 'decimal', scale: 5, required: true, listed: true, hint: 'A espessura do item é dividida por este fator no cálculo do m3' },
      { name: 'id_pro_tora', label: 'ID/Tora', type: 'number', listed: true, filterable: true, width: 'xs', span: 2, ref: { resource: 'produtos', labelField: 'nome' } },
      { name: 'tora_desc', label: 'Tora', type: 'text', readOnly: true, listed: true, searchable: true, filterable: true, sql: descProduto('id_pro_tora') },
      { name: 'conversao', label: 'Conversão', type: 'decimal', scale: 3, listed: true, hint: 'm3 de tora baixados por m3 de lâmina' },
    ],
  },
  {
    name: 'perdas',
    table: 'lam_romaneiosp',
    label: 'Perdas',
    labelSingular: 'Perda',
    description: 'Percentual de perda por produto e cliente (cliente 999999 = todos)',
    icon: 'Percent',
    group: 'romaneio',
    pk: ['id'],
    autoIncrement: true,
    labelField: 'id',
    defaultSort: { field: 'id', dir: 'asc' },
    canCreate: true,
    canUpdate: true,
    canDelete: true,
    fields: [
      ID,
      { name: 'id_produto', label: 'ID/Produto', type: 'number', required: true, listed: true, filterable: true, width: 'xs', span: 2, ref: { resource: 'produtos', labelField: 'nome' } },
      { name: 'produto_desc', label: 'Produto', type: 'text', readOnly: true, listed: true, searchable: true, filterable: true, sql: descProduto('id_produto') },
      {
        name: 'id_cliente',
        label: 'ID/Cliente',
        type: 'number',
        required: true,
        listed: true,
        filterable: true,
        width: 'xs',
        span: 2,
        ref: { resource: 'pessoas', labelField: 'nome' },
        opcoesExtras: [{ value: String(TODOS_CLIENTES), label: 'TODOS OS CLIENTES' }],
        hint: `Cliente ${TODOS_CLIENTES}: perda do produto para os clientes sem perda própria`,
      },
      {
        name: 'cliente_nome',
        label: 'Cliente',
        type: 'text',
        readOnly: true,
        listed: true,
        searchable: true,
        filterable: true,
        sql: `COALESCE(${nomePessoa('id_cliente')}, IF(t.id_cliente = ${TODOS_CLIENTES}, 'TODOS OS CLIENTES', NULL))`,
      },
      { name: 'cliente_cidade', label: 'Cidade', type: 'text', readOnly: true, listed: true, filterable: true, sql: '(SELECT p.cidade_nome FROM cad_pessoas p WHERE p.id = t.id_cliente)' },
      { name: 'perda', label: '% Perda', type: 'decimal', scale: 3, required: true, listed: true },
    ],
  },
  {
    // Máquinas = centros de custo com "*" na descrição (changeLog do Delphi)
    name: 'maquinas',
    table: 'fin_centro_custo',
    label: 'Máquinas',
    labelSingular: 'Máquina',
    description: 'Centros de custo: as máquinas são os que têm "*" na descrição',
    icon: 'Cog',
    group: 'romaneio',
    pk: ['id'],
    autoIncrement: true,
    labelField: 'descricao',
    defaultSort: { field: 'id', dir: 'asc' },
    canCreate: true,
    canUpdate: true,
    canDelete: true,
    toggleMostrar: {
      label: 'Mostrar tudo',
      dica: 'Ligado: todos os centros de custo. Desligado: somente as máquinas (com "*" na descrição)',
      ocultar: [{ field: 'descricao', op: 'contains', value: '*' }],
    },
    fields: [
      { name: 'id', label: 'ID', type: 'number', readOnly: true, listed: true, width: 'xs' },
      { name: 'descricao', label: 'Descrição', type: 'text', required: true, listed: true, searchable: true, filterable: true, maxLength: 150, span: 2, hint: 'Com "*" na descrição o centro de custo é uma máquina' },
      {
        name: 'tipo_referencia',
        label: 'Tipo',
        type: 'enum',
        required: true,
        listed: true,
        filterable: true,
        default: 'ADMINISTRATIVO',
        options: [
          { value: 'ADMINISTRATIVO', label: 'Administrativo' },
          { value: 'EMPREENDIMENTO', label: 'Empreendimento' },
          { value: 'OBRA', label: 'Obra' },
        ],
      },
    ],
  },

  // ============================================================
  // CADASTROS DO ERP (dados básicos; sem exclusão: inativar no lugar)
  // ============================================================
  {
    name: 'pessoas',
    table: 'cad_pessoas',
    label: 'Clientes',
    labelSingular: 'Cliente',
    description: 'Clientes e transportadores',
    icon: 'Users',
    group: 'cadastros',
    pk: ['id'],
    autoIncrement: true,
    labelField: 'nome',
    // Nome + cidade: há homônimos em cidades diferentes; inativas e excluídas (date_delete) não entram no combo
    optionsSql:
      "SELECT t.id AS value, CONCAT(t.nome, IF(COALESCE(t.cidade_nome, '') = '', '', CONCAT(' — ', t.cidade_nome))) AS label FROM cad_pessoas t WHERE t.ativo = 1 AND t.date_delete IS NULL ORDER BY t.nome",
    defaultSort: { field: 'nome', dir: 'asc' },
    canCreate: true,
    canUpdate: true,
    canDelete: false,
    fields: [
      ID,
      { name: 'nome', label: 'Nome / Razão social', type: 'text', required: true, listed: true, searchable: true, filterable: true, maxLength: 50, span: 2 },
      { name: 'nome_fantasia', label: 'Nome fantasia', type: 'text', listed: true, searchable: true, filterable: true, maxLength: 150, span: 2 },
      { name: 'cpf_cnpj', label: 'CPF/CNPJ', type: 'cnpj', listed: true, searchable: true, filterable: true },
      { name: 'ie', label: 'Inscrição estadual', type: 'text', maxLength: 20, hint: 'Só para contribuinte do ICMS' },
      {
        name: 'ind_ie_dest',
        label: 'Contribuinte ICMS',
        type: 'enum',
        required: true,
        default: '9',
        options: [
          { value: '1', label: 'Contribuinte' },
          { value: '2', label: 'Isento de inscrição' },
          { value: '9', label: 'Não contribuinte' },
        ],
      },
      { name: 'cep', label: 'CEP', type: 'text', maxLength: 9, hint: '8 dígitos' },
      { name: 'logradouro', label: 'Logradouro', type: 'text', maxLength: 100, span: 2 },
      { name: 'numero', label: 'Número', type: 'text', maxLength: 7 },
      { name: 'complemento', label: 'Complemento', type: 'text', maxLength: 60 },
      { name: 'bairro', label: 'Bairro', type: 'text', maxLength: 50 },
      // Cidade e UF saem do município escolhido no combo (antesDeGravar), junto com o cidade_id
      { name: 'cidade_nome', label: 'Cidade', type: 'text', readOnly: true, listed: true, searchable: true, filterable: true, maxLength: 100 },
      { name: 'cidade_uf', label: 'UF', type: 'enum', readOnly: true, listed: true, filterable: true, width: 'xs', options: UFS.map((uf) => ({ value: uf, label: uf })) },
      {
        name: 'cidade_ibge',
        label: 'Cidade',
        type: 'text',
        maxLength: 7,
        ref: { resource: 'cidades', labelField: 'nome' },
        hint: 'Município do IBGE: digite o nome ou o código (obrigatório na NF-e)',
        span: 2,
      },
      { name: 'fone_principal', label: 'Telefone', type: 'text', maxLength: 20 },
      { name: 'email_principal', label: 'E-mail', type: 'text', maxLength: 120, span: 2 },
      { name: 'is_cliente', label: 'Cliente', type: 'boolean', listed: true, filterable: true, default: true, width: 'xs' },
      { name: 'is_transportadora', label: 'Transportador', type: 'boolean', listed: true, filterable: true, default: false, width: 'xs' },
      { name: 'ativo', label: 'Ativo', type: 'boolean', listed: true, filterable: true, default: true, width: 'xs' },
    ],
  },
  {
    name: 'produtos',
    table: 'cad_produtos',
    label: 'Produtos',
    labelSingular: 'Produto',
    description: 'Lâminas e toras',
    icon: 'Package',
    group: 'cadastros',
    pk: ['id'],
    autoIncrement: true,
    labelField: 'nome',
    optionsSql: 'SELECT t.id AS value, t.nome AS label FROM cad_produtos t WHERE t.ativo = 1 ORDER BY t.nome',
    defaultSort: { field: 'nome', dir: 'asc' },
    canCreate: true,
    canUpdate: true,
    canDelete: false,
    fields: [
      ID,
      { name: 'sku', label: 'Código', type: 'text', required: true, listed: true, searchable: true, filterable: true, maxLength: 60 },
      { name: 'nome', label: 'Descrição', type: 'text', required: true, listed: true, searchable: true, filterable: true, maxLength: 200, span: 2 },
      { name: 'unidade_id', label: 'Unidade', type: 'number', required: true, listed: true, filterable: true, width: 'xs', ref: { resource: 'unidades', labelField: 'sigla' } },
      { name: 'ncm', label: 'NCM', type: 'text', listed: true, filterable: true, ref: { resource: 'ncms', labelField: 'nome' }, hint: 'Tabela oficial do Siscomex (obrigatório na NF-e)', span: 2 },
      { name: 'preco_venda', label: 'Preço de venda (m³)', type: 'decimal', scale: 4, listed: true, hint: 'Valor unitário da NF-e do romaneio' },
      {
        name: 'grupo_tributario_id',
        label: 'Grupo tributário',
        type: 'number',
        listed: true,
        filterable: true,
        span: 2,
        ref: { resource: 'grupos_tributarios', labelField: 'descricao' },
        hint: 'Vazio = o grupo padrão da Configuração da NF-e',
      },
      { name: 'preco_custo', label: 'Custo (m³)', type: 'decimal', scale: 4, listed: true, hint: 'Custo unitário usado nos lançamentos de estoque do Concluir' },
      { name: 'ativo', label: 'Ativo', type: 'boolean', listed: true, filterable: true, default: true, width: 'xs' },
    ],
  },
  {
    // unidade_id do produto é chave estrangeira para esta tabela
    name: 'unidades',
    table: 'cad_produtos_unidades_medida',
    label: 'Unidades',
    labelSingular: 'Unidade',
    description: 'Unidades de medida dos produtos',
    icon: 'Ruler',
    group: 'cadastros',
    pk: ['id'],
    autoIncrement: true,
    labelField: 'sigla',
    optionsSql: "SELECT t.id AS value, CONCAT(t.sigla, ' — ', t.nome) AS label FROM cad_produtos_unidades_medida t WHERE t.ativo = 1 ORDER BY t.sigla",
    defaultSort: { field: 'sigla', dir: 'asc' },
    canCreate: true,
    canUpdate: true,
    canDelete: false,
    fields: [
      ID,
      { name: 'sigla', label: 'Sigla', type: 'text', required: true, listed: true, searchable: true, maxLength: 10 },
      { name: 'nome', label: 'Nome', type: 'text', required: true, listed: true, searchable: true, maxLength: 60, span: 2 },
      {
        name: 'tipo',
        label: 'Tipo',
        type: 'enum',
        required: true,
        listed: true,
        default: 'volume',
        options: [
          { value: 'unidade', label: 'Unidade' },
          { value: 'peso', label: 'Peso' },
          { value: 'volume', label: 'Volume' },
          { value: 'comprimento', label: 'Comprimento' },
          { value: 'area', label: 'Área' },
        ],
      },
      { name: 'ativo', label: 'Ativo', type: 'boolean', listed: true, default: true, width: 'xs' },
    ],
  },
  {
    // cad_produtos.grupo_tributario_id aponta para cá; o produto sem grupo usa o padrão da Configuração da NF-e
    name: 'grupos_tributarios',
    table: 'fis_grupos_tributarios',
    label: 'Grupos tributários',
    labelSingular: 'Grupo tributário',
    description: 'Tributação dos produtos na NF-e: ICMS, PIS/COFINS, IBS/CBS e CFOP',
    icon: 'Receipt',
    group: 'cadastros',
    pk: ['id'],
    autoIncrement: true,
    labelField: 'descricao',
    optionsSql: 'SELECT t.id AS value, t.descricao AS label FROM fis_grupos_tributarios t WHERE t.ativo = 1 ORDER BY t.descricao',
    defaultSort: { field: 'descricao', dir: 'asc' },
    canCreate: true,
    canUpdate: true,
    canDelete: false,
    fields: [
      ID,
      { name: 'descricao', label: 'Descrição', type: 'text', required: true, listed: true, searchable: true, maxLength: 60, span: 2 },
      { name: 'origem', label: 'Origem da mercadoria', type: 'enum', required: true, listed: true, default: '0', options: ORIGENS, span: 2 },
      { name: 'cfop_dentro_uf', label: 'CFOP dentro da UF', type: 'text', listed: true, ref: { resource: 'cfops_dentro_uf', labelField: 'titulo' }, hint: 'Vazio = o da Configuração da NF-e', span: 2 },
      { name: 'cfop_fora_uf', label: 'CFOP para outra UF', type: 'text', listed: true, ref: { resource: 'cfops_fora_uf', labelField: 'titulo' }, hint: 'Vazio = o da Configuração da NF-e', span: 2 },
      { name: 'csosn', label: 'CSOSN', type: 'enum', listed: true, options: CSOSN, hint: 'Simples Nacional', span: 2 },
      { name: 'aliquota_credito_sn', label: 'Alíquota de crédito do Simples', type: 'decimal', scale: 4, default: 0, sufixo: '%', hint: 'Só no CSOSN 101' },
      { name: 'cst_icms', label: 'CST do ICMS', type: 'enum', listed: true, options: CST_ICMS, hint: 'Regime normal', span: 2 },
      { name: 'aliquota_icms', label: 'Alíquota do ICMS', type: 'decimal', scale: 4, default: 0, sufixo: '%', hint: 'Só no CST 00' },
      { name: 'cst_pis', label: 'CST do PIS', type: 'enum', required: true, listed: true, options: CST_PIS_COFINS, span: 2 },
      { name: 'aliquota_pis', label: 'Alíquota do PIS', type: 'decimal', scale: 4, default: 0, sufixo: '%' },
      { name: 'cst_cofins', label: 'CST da COFINS', type: 'enum', required: true, listed: true, options: CST_PIS_COFINS, span: 2 },
      { name: 'aliquota_cofins', label: 'Alíquota da COFINS', type: 'decimal', scale: 4, default: 0, sufixo: '%' },
      // cst_ibscbs sai da classificação ao gravar (romaneio.ts)
      {
        name: 'cclass_trib',
        label: 'Classificação tributária do IBS/CBS (cClassTrib)',
        type: 'text',
        ref: { resource: 'classificacoes_tributarias', labelField: 'nome' },
        hint: 'Vazio = a da Configuração da NF-e. O CST e a redução saem da classificação',
        span: 4,
      },
      { name: 'ativo', label: 'Ativo', type: 'boolean', listed: true, filterable: true, default: true, width: 'xs' },
    ],
  },
  {
    // Tabela oficial do cClassTrib (IT 2025.002), carregada pelo "Atualizar pela tabela oficial" da Configuração da NF-e;
    // só alimenta o combo (o combo mostra as que a nota do romaneio consegue montar)
    name: 'classificacoes_tributarias',
    table: 'fis_classificacao_tributaria',
    label: 'Classificações tributárias',
    labelSingular: 'Classificação tributária',
    description: 'cClassTrib do IBS/CBS (tabela oficial)',
    icon: 'Receipt',
    group: 'cadastros',
    oculto: true,
    pk: ['cclass_trib'],
    autoIncrement: false,
    labelField: 'nome',
    optionsSql: `SELECT t.cclass_trib AS value, t.nome AS label
                   FROM fis_classificacao_tributaria t WHERE ${CLASSIFICACAO_NA_NFE} ORDER BY t.cclass_trib`,
    defaultSort: { field: 'cclass_trib', dir: 'asc' },
    canCreate: false,
    canUpdate: false,
    canDelete: false,
    fields: [
      { name: 'cclass_trib', label: 'cClassTrib', type: 'text', listed: true },
      { name: 'cst', label: 'CST', type: 'text', listed: true },
      { name: 'nome', label: 'Nome', type: 'text', listed: true, searchable: true },
      { name: 'p_red_ibs', label: 'Redução do IBS', type: 'decimal', scale: 4, listed: true, sufixo: '%' },
      { name: 'p_red_cbs', label: 'Redução da CBS', type: 'decimal', scale: 4, listed: true, sufixo: '%' },
    ],
  },
  cfops('cfops_dentro_uf', '5', 'CFOP dentro da UF'),
  cfops('cfops_fora_uf', '6', 'CFOP para outra UF'),
  {
    // Tabela NCM oficial (Portal Único Siscomex, baixada no BMNFe › Tabelas Fiscais): só alimenta o combo do produto (~10,5 mil, filtrado no navegador)
    name: 'ncms',
    table: 'fis_ncm',
    label: 'NCM',
    labelSingular: 'NCM',
    description: 'NCM da tabela oficial',
    icon: 'Receipt',
    group: 'cadastros',
    oculto: true,
    pk: ['ncm'],
    autoIncrement: false,
    labelField: 'nome',
    optionsSql: `SELECT t.ncm AS value, t.nome AS label FROM fis_ncm t
                  WHERE t.fim_vigencia IS NULL OR t.fim_vigencia >= CURDATE() ORDER BY t.ncm`,
    defaultSort: { field: 'ncm', dir: 'asc' },
    canCreate: false,
    canUpdate: false,
    canDelete: false,
    fields: [
      { name: 'ncm', label: 'NCM', type: 'text', listed: true },
      { name: 'nome', label: 'Nome', type: 'text', listed: true, searchable: true },
    ],
  },
  {
    // Municípios do IBGE na cad_cidades do ERP, baixados no BMNFe › Tabelas Fiscais: só alimenta o combo do cliente
    name: 'cidades',
    table: 'cad_cidades',
    label: 'Cidades',
    labelSingular: 'Cidade',
    description: 'Municípios do IBGE',
    icon: 'MapPin',
    group: 'cadastros',
    oculto: true,
    pk: ['codigo_ibge'],
    autoIncrement: false,
    labelField: 'nome',
    optionsSql: "SELECT t.codigo_ibge AS value, CONCAT(t.nome, ' - ', t.uf) AS label FROM cad_cidades t ORDER BY t.nome, t.uf",
    defaultSort: { field: 'nome', dir: 'asc' },
    canCreate: false,
    canUpdate: false,
    canDelete: false,
    fields: [
      { name: 'codigo_ibge', label: 'Código IBGE', type: 'text', listed: true },
      { name: 'nome', label: 'Município', type: 'text', listed: true, searchable: true },
      { name: 'uf', label: 'UF', type: 'text', listed: true },
    ],
  },
];

export const RESOURCE_MAP: Record<string, ResourceDef> = Object.fromEntries(RESOURCES.map((r) => [r.name, r]));

export function getResource(name: string): ResourceDef | null {
  return Object.prototype.hasOwnProperty.call(RESOURCE_MAP, name) ? RESOURCE_MAP[name] : null;
}

/** Colunas graváveis: exclui readOnly e a PK */
export function writableFields(resource: ResourceDef): FieldDef[] {
  return resource.fields.filter((f) => !f.readOnly && !resource.pk.includes(f.name));
}

/** Expressão SQL da coluna: a própria coluna da tabela ou a expressão da coluna calculada */
export function colunaSql(resource: ResourceDef, nome: string): string {
  return resource.fields.find((f) => f.name === nome)?.sql ?? `t.${nome}`;
}

/** Todas as colunas conhecidas — whitelist de ordenação e filtros */
export function columnNames(resource: ResourceDef): string[] {
  return resource.fields.map((f) => f.name);
}

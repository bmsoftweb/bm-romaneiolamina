export type FieldType = 'text' | 'textarea' | 'number' | 'decimal' | 'date' | 'datetime' | 'time' | 'enum' | 'boolean' | 'password' | 'cnpj';

export interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  hint?: string;
  placeholder?: string;
  required?: boolean;
  readOnly?: boolean;
  /** Só na alteração: o formulário de inclusão não mostra */
  soNaAlteracao?: boolean;
  /** Campo só leitura mostrado dentro do formulário na edição (bloqueado), em vez da caixa de dados do banco */
  mostrarNaEdicao?: boolean;
  listed?: boolean;
  searchable?: boolean;
  /** Aparece no painel de busca avançada */
  filterable?: boolean;
  options?: { value: string; label: string }[];
  /** type === 'enum': na lista vira um ícone com a cor da situação, e o nome dela fica no tooltip */
  icone?: boolean;
  /** type === 'boolean' numa coluna char(1) 'S'/'N' */
  simNao?: boolean;
  ref?: { resource: string; labelField: string };
  /** Opções do combo além das do recurso ligado (ex.: cliente 999999 = todos) */
  opcoesExtras?: OpcaoRef[];
  scale?: number;
  /** Inteiro com zeros à esquerda na lista (ex.: pilha "01") */
  digitos?: number;
  /** Texto depois do número na lista (ex.: "%" da perda) */
  sufixo?: string;
  /** Texto digitado em maiúsculas */
  maiusculas?: boolean;
  maxLength?: number;
  /** Desabilita (e zera) o campo quando outro campo tiver o valor indicado */
  disabledWhen?: { field: string; equals: string };
  /** Campo numérico que aceita valor negativo */
  allowNegative?: boolean;
  /** Valor inicial na inclusão */
  default?: string | number | boolean;
  width?: 'xs' | 'sm' | 'md' | 'lg';
  /** Colunas que o campo ocupa no formulário (de 4); sem isto vale a regra padrão */
  span?: number;
}

export type ResourceGroup = 'romaneio' | 'cadastros';

/** Grade filha exibida ao selecionar uma linha da listagem (mestre-detalhe) */
export interface DetailDef {
  resource: string;
  foreignKey: string;
  label: string;
  totalField?: string;
  /** Casas do total no rodapé */
  totalScale?: number;
  editavel?: boolean;
}

export interface ResourceDef {
  name: string;
  table: string;
  label: string;
  labelSingular: string;
  description: string;
  icon: string;
  group: ResourceGroup;
  oculto?: boolean;
  pk: string[];
  autoIncrement: boolean;
  labelField: string;
  defaultSort: { field: string; dir: 'asc' | 'desc' };
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  details?: DetailDef[];
  /** Toggle na barra da lista: desligado, acrescenta estes filtros (ex.: só as máquinas) */
  toggleMostrar?: { label: string; dica: string; ocultar: FiltroAvancado[] };
  /** O formulário não mostra a caixa "Dados gerados pelo banco" */
  semDadosDoBanco?: boolean;
  fields: FieldDef[];
}

/** Empresa ativa (sys_empresas): a do usuário logado */
export interface EmpresaSessao {
  id: string;
  nome: string;
}

export interface Usuario {
  /** sys_usuarios.id */
  id: string;
  /** sys_usuarios.login */
  nome: string;
  /** sys_perfis.nome */
  cargo: string;
}

/** Chave primária: INT AUTO_INCREMENT (chega como número do servidor) */
export type Id = number | string;

export type RegistroCrud = Record<string, any>;

/** Operadores aceitos pela busca avançada */
export type FiltroOp = 'contains' | 'eq' | 'ne' | 'gte' | 'lte';

export interface FiltroAvancado {
  field: string;
  op: FiltroOp;
  value: string;
}

export interface ListaPaginada {
  data: RegistroCrud[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface OpcaoRef {
  value: string;
  label: string;
}

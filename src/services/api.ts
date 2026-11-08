import { ResourceDef, ListaPaginada, FiltroAvancado, RegistroCrud, OpcaoRef, Usuario, EmpresaSessao, Id } from '../types';

/** O token da sessão acompanha toda requisição no header Authorization */
let tokenAtual: string | null = null;
let aoExpirar: ((msg: string) => void) | null = null;

export function setTokenSessao(token: string | null) {
  tokenAtual = token;
}

/** Chamado quando o servidor recusa o token (sessão expirada ou usuário apagado) */
export function setAoExpirarSessao(fn: ((msg: string) => void) | null) {
  aoExpirar = fn;
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { ...extra };
  if (tokenAtual) h.Authorization = `Bearer ${tokenAtual}`;
  return h;
}

async function parseOrThrow(res: Response): Promise<any> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error || `Falha na requisição (HTTP ${res.status}).`;
    if (res.status === 401 && aoExpirar) aoExpirar(msg);
    throw new Error(msg);
  }
  return data;
}

const get = (url: string) => fetch(url, { headers: headers() }).then(parseOrThrow);
const enviar = (method: string, url: string, corpo?: unknown) =>
  fetch(url, {
    method,
    headers: headers({ 'Content-Type': 'application/json' }),
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  }).then(parseOrThrow);

// ------------------------------------------------------------
// Autenticação e preferências
// ------------------------------------------------------------
export async function login(payload: { login: string; senha: string }): Promise<{
  success: boolean;
  primeiroAcesso?: boolean;
  message?: string;
  token: string;
  usuario: Usuario;
  empresa: EmpresaSessao;
}> {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Falha no login (HTTP ${res.status}).`);
  return data;
}

/**
 * Confere se a sessão guardada no navegador ainda vale.
 * Retorna false só quando o servidor recusa; falha de rede ou de banco devolve null,
 * para não deslogar ninguém por instabilidade. base = banco em uso (barra de status).
 */
export async function validarSessao(): Promise<{ valida: boolean | null; error?: string; usuario?: Usuario; empresa?: EmpresaSessao; base?: string }> {
  try {
    const res = await fetch('/api/sessao', { headers: headers() });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) return { valida: false, error: data?.error };
    return res.ok ? { valida: true, usuario: data.usuario, empresa: data.empresa, base: data.base } : { valida: null, error: data?.error };
  } catch {
    return { valida: null };
  }
}

/** Preferências das listas (sys_usuarios.config_listas) */
export const fetchConfigListas = (): Promise<Record<string, unknown>> => get('/api/config-listas');
export const saveConfigListas = (config: Record<string, unknown>): Promise<void> => enviar('PUT', '/api/config-listas', config);

// ------------------------------------------------------------
// Metadados
// ------------------------------------------------------------
export const fetchResources = (): Promise<ResourceDef[]> => get('/api/meta/resources');

// ------------------------------------------------------------
// CRUD genérico
// ------------------------------------------------------------
export function listRecords(
  resource: string,
  params: {
    page?: number;
    limit?: number;
    search?: string;
    sort?: string;
    dir?: 'asc' | 'desc';
    filterField?: string;
    filterValue?: string;
    filters?: FiltroAvancado[];
  } = {},
): Promise<ListaPaginada> {
  const qs = new URLSearchParams();
  if (params.page) qs.set('page', String(params.page));
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.search) qs.set('search', params.search);
  if (params.sort) qs.set('sort', params.sort);
  if (params.dir) qs.set('dir', params.dir);
  if (params.filterField && params.filterValue) {
    qs.set('filter_field', params.filterField);
    qs.set('filter_value', params.filterValue);
  }
  if (params.filters && params.filters.length) qs.set('filters', JSON.stringify(params.filters));
  return get(`/api/crud/${resource}?${qs.toString()}`);
}

export const getRecord = (resource: string, id: Id): Promise<RegistroCrud> => get(`/api/crud/${resource}/${encodeURIComponent(String(id))}`);

// Gravar muda a lista do recurso: os combos dele são relidos
export const createRecord = (resource: string, payload: RegistroCrud): Promise<{ success: boolean; id: string }> =>
  enviar('POST', `/api/crud/${resource}`, payload).then((r: any) => {
    invalidateOptions(resource);
    return r;
  });

export const updateRecord = (resource: string, id: Id, payload: RegistroCrud): Promise<{ success: boolean }> =>
  enviar('PUT', `/api/crud/${resource}/${encodeURIComponent(String(id))}`, payload).then((r: any) => {
    invalidateOptions(resource);
    return r;
  });

export const deleteRecord = (resource: string, id: Id): Promise<{ success: boolean }> =>
  enviar('DELETE', `/api/crud/${resource}/${encodeURIComponent(String(id))}`).then((r: any) => {
    invalidateOptions(resource);
    return r;
  });

// ------------------------------------------------------------
// Combos de chave estrangeira, com cache em memória
// ------------------------------------------------------------
const optionsCache = new Map<string, Promise<OpcaoRef[]>>();

export function fetchOptions(resource: string, labelField: string): Promise<OpcaoRef[]> {
  const key = `${resource}:${labelField}`;
  // A promessa fica no cache: vários campos ligados ao mesmo cadastro (cliente, transportador) buscam uma vez só
  let p = optionsCache.get(key);
  if (!p) {
    p = get(`/api/options/${resource}?label_field=${encodeURIComponent(labelField)}`) as Promise<OpcaoRef[]>;
    optionsCache.set(key, p);
    p.catch(() => optionsCache.delete(key));
  }
  return p;
}

/** Invalida o cache de combos após gravações que alteram listas de referência */
export function invalidateOptions(resource?: string) {
  if (!resource) {
    optionsCache.clear();
    return;
  }
  for (const key of Array.from(optionsCache.keys())) {
    if (key.startsWith(`${resource}:`)) optionsCache.delete(key);
  }
}

// ------------------------------------------------------------
// Romaneio (server/romaneio.ts)
// ------------------------------------------------------------
const rom = (id: Id) => `/api/romaneios/${encodeURIComponent(String(id))}`;

/** Valores do item novo: cópia do último item, pilha + 1 e a perda do produto para o cliente */
export const novoItemRomaneio = (id: Id): Promise<RegistroCrud> => get(`${rom(id)}/novo-item`);

/** Perda (%) do produto para o cliente do romaneio (sem perda própria: a do cliente 999999) */
export const perdaRomaneio = (id: Id, produto: Id): Promise<{ perda: number }> => get(`${rom(id)}/perda?produto=${encodeURIComponent(String(produto))}`);

export const concluirRomaneio = (id: Id): Promise<{ lancamentos: number }> => enviar('POST', `${rom(id)}/concluir`);

/** HTML de impressão do romaneio (layout do relatório do Delphi) */
export async function impressaoRomaneio(id: Id): Promise<string> {
  const res = await fetch(`${rom(id)}/impressao`, { headers: headers() });
  if (!res.ok) await parseOrThrow(res);
  return res.text();
}

export interface EmailRomaneio {
  para: string;
  assunto: string;
  mensagem: string;
  anexo?: string;
}
export const dadosEmailRomaneio = (id: Id): Promise<EmailRomaneio> => get(`${rom(id)}/email`);
export const enviarEmailRomaneio = (id: Id, dados: EmailRomaneio): Promise<{ success: boolean }> => enviar('POST', `${rom(id)}/email`, dados);

// ------------------------------------------------------------
// NF-e do romaneio (server/nfe.ts): regras fiscais e o Gerar NFe (vai ao nfeWeb)
// ------------------------------------------------------------
export interface AliquotasUF {
  interestadual: number;
  interna: number;
  fcp: number;
}
export type ConfigNFe = Record<string, string | number | boolean> & { difal?: Record<string, AliquotasUF> };
/** Situação da tabela oficial do cClassTrib (null = a tabela ainda não existe no banco) */
export type TabelaClassificacoes = { total: number; atualizadoEm: string | null } | null;
export const fetchConfigNFe = (): Promise<{
  config: ConfigNFe;
  ufEmitente: string;
  ufs: string[];
  nfeweb: boolean;
  classificacoes: TabelaClassificacoes;
}> => get('/api/nfe/config');
export const saveConfigNFe = (config: ConfigNFe): Promise<{ success: boolean; config: ConfigNFe }> => enviar('PUT', '/api/nfe/config', config);
/** Baixa a tabela oficial do cClassTrib (portal da SVRS) e grava no banco */
export const atualizarClassificacoes = (): Promise<{ total: number }> => enviar('POST', '/api/nfe/classificacoes');
/** Séries ativas no BMNFe para o modelo que ele emite (a emissão recusa série não cadastrada lá) */
export const fetchSeriesNFe = (): Promise<{ modelo: string; series: { serie: number; descricao: string | null }[] }> =>
  get('/api/nfe/series');

export interface PreviaNFe {
  referencia: string;
  temTransportador: boolean;
  itens: { codigo: string; descricao: string; unidade: string; quantidade: number; valorUnitario: number; valorTotal: number }[];
  /** O que falta (cadastro ou configuração) para gerar a nota */
  pendencias: string[];
}
export const previaNFe = (id: Id): Promise<PreviaNFe> => get(`${rom(id)}/nfe`);

/** Resposta do concentrador do nfeWeb (POST /api/emitir) */
export interface NFeGerada {
  referencia: string;
  situacao: string;
  numero: number;
  serie: number;
  chave: string | null;
  repetida: boolean;
  totais?: Record<string, number>;
}
export const gerarNFeRomaneio = (id: Id, modalidadeFrete: string): Promise<NFeGerada> =>
  enviar('POST', `${rom(id)}/nfe`, { modalidadeFrete: Number(modalidadeFrete) });

/** Transmite à SEFAZ a NF-e já gerada do romaneio (pelo BMNFe) e devolve a situação dela depois */
export const enviarNFeSefaz = (
  id: Id,
): Promise<{ situacao: string; numero: number; serie: number; protocolo: string | null; cStat: number | null; motivo: string | null }> =>
  enviar('POST', `${rom(id)}/nfe/enviar`);

/** PDF do DANFE da NF-e do romaneio (vem do BMNFe) */
export async function danfeRomaneio(id: Id): Promise<Blob> {
  const res = await fetch(`${rom(id)}/nfe/danfe`, { headers: headers() });
  if (!res.ok) await parseOrThrow(res);
  return res.blob();
}

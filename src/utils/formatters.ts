import { FieldDef } from '../types.js';

/** CPF (11 dígitos) ou CNPJ (14, numérico ou alfanumérico) formatado; outro tamanho volta como veio */
export function formatCNPJ(cnpj: string): string {
  const raw = cleanCNPJ(cnpj);
  if (/^\d{11}$/.test(raw)) return raw.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  if (raw.length !== 14) return cnpj || '';
  return raw.replace(/^(.{2})(.{3})(.{3})(.{4})(.{2})$/, '$1.$2.$3/$4-$5');
}

/** Só letras (maiúsculas) e dígitos: o CNPJ alfanumérico tem letras nas 12 primeiras posições */
export function cleanCNPJ(cnpj: string): string {
  return String(cnpj || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

/** Aplica a máscara conforme o operador digita: CPF até 11 dígitos, CNPJ a partir do 12º ou com letra */
export function maskCNPJ(value: string): string {
  const raw = cleanCNPJ(value).slice(0, 14);
  if (raw.length <= 11 && /^\d*$/.test(raw)) {
    if (raw.length > 9) return `${raw.slice(0, 3)}.${raw.slice(3, 6)}.${raw.slice(6, 9)}-${raw.slice(9)}`;
    if (raw.length > 6) return `${raw.slice(0, 3)}.${raw.slice(3, 6)}.${raw.slice(6)}`;
    if (raw.length > 3) return `${raw.slice(0, 3)}.${raw.slice(3)}`;
    return raw;
  }
  if (raw.length > 12) {
    return `${raw.slice(0, 2)}.${raw.slice(2, 5)}.${raw.slice(5, 8)}/${raw.slice(8, 12)}-${raw.slice(12)}`;
  }
  if (raw.length > 8) return `${raw.slice(0, 2)}.${raw.slice(2, 5)}.${raw.slice(5, 8)}/${raw.slice(8)}`;
  if (raw.length > 5) return `${raw.slice(0, 2)}.${raw.slice(2, 5)}.${raw.slice(5)}`;
  if (raw.length > 2) return `${raw.slice(0, 2)}.${raw.slice(2)}`;
  return raw;
}

export function formatDateBR(dateStr: string): string {
  if (!dateStr) return '—';
  const parts = String(dateStr).split('T')[0].split(' ')[0].split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return dateStr;
}

export function formatDateTimeBR(dateStr: string): string {
  if (!dateStr) return '—';
  const normalized = String(dateStr).replace(' ', 'T');
  const date = new Date(normalized);
  if (isNaN(date.getTime())) return String(dateStr);
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Converte o valor do MySQL para o formato aceito por <input type="date" | "datetime-local"> */
export function toInputDate(value: any): string {
  if (!value) return '';
  return String(value).replace(' ', 'T').slice(0, 10);
}

export function toInputDateTime(value: any): string {
  if (!value) return '';
  return String(value).replace(' ', 'T').slice(0, 16);
}

/** Renderização de uma célula da grade conforme o tipo do campo */
export function formatCellValue(field: FieldDef, value: any): string {
  if (value === null || value === undefined || value === '') return '—';

  switch (field.type) {
    case 'cnpj':
      return formatCNPJ(String(value));
    case 'boolean':
      return Number(value) === 1 ? 'Sim' : 'Não';
    case 'date':
      return formatDateBR(String(value));
    case 'datetime':
      return formatDateTimeBR(String(value));
    case 'decimal': {
      const n = Number(value);
      if (!Number.isFinite(n)) return String(value);
      return formatDecimalBR(n, field.scale ?? 2) + (field.sufixo ?? '');
    }
    case 'number': {
      // Códigos (ID, pedido, pilha): sem separador de milhar, como no ERP
      const n = String(Math.trunc(Number(value)));
      return (field.digitos ? n.padStart(field.digitos, '0') : n) + (field.sufixo ?? '');
    }
    case 'enum': {
      const opt = field.options?.find((o) => o.value === String(value));
      return opt ? opt.label : String(value);
    }
    case 'password':
      return '••••••••';
    case 'time':
      return String(value).slice(0, 5);
    default: {
      const text = String(value);
      return text.length > 80 ? `${text.slice(0, 80)}…` : text;
    }
  }
}

/** Número com casas fixas no padrão brasileiro (1.234,5600) */
export function formatDecimalBR(n: number, casas: number): string {
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }).format(n);
}

const VERDE = 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800';
const AZUL = 'bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-800';
const AMBAR = 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800';
const VERMELHO = 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800';

/** Cores dos selos das situações (romaneio: A = aberto, C = concluído; NF-e: as do BMNFe; sem cor = cinza) */
export const STATUS_COLORS: Record<string, string> = {
  A: AZUL,
  C: VERDE,
  rascunho: AMBAR,
  assinada: AZUL,
  enviada: AMBAR,
  processando: AMBAR,
  autorizada: VERDE,
  rejeitada: VERMELHO,
  denegada: VERMELHO,
};

export const GROUP_LABELS: Record<string, string> = {
  romaneio: 'Romaneio de Lâminas',
  cadastros: 'Cadastros',
};

/** Data de hoje no fuso local (Brasília), em ISO "aaaa-mm-dd" — nunca toISOString() */
export function hojeIso(): string {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-${String(h.getDate()).padStart(2, '0')}`;
}

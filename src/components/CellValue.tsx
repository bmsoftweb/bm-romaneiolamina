import React from 'react';
import { FileText } from 'lucide-react';
import { FieldDef, OpcaoRef, RegistroCrud } from '../types';
import { formatCellValue, STATUS_COLORS } from '../utils/formatters';

interface CellValueProps {
  field: FieldDef;
  row: RegistroCrud;
  /** Opções já carregadas dos campos de chave estrangeira, por nome de campo */
  refOptions: Record<string, OpcaoRef[]>;
}

/**
 * Renderiza uma célula de grade conforme o tipo do campo: resolve o rótulo das
 * chaves estrangeiras e desenha selos para enumerações e booleanos.
 * Compartilhado pela listagem principal e pelas grades de detalhe.
 */
export const CellValue: React.FC<CellValueProps> = ({ field, row, refOptions }) => {
  const value = row[field.name];

  // Chave estrangeira numérica (ID/Cli, ID/Produto...) mostra o código, como no ERP: o nome vem em outra coluna
  if (field.ref && field.type !== 'number') {
    if (value === null || value === undefined || value === '') {
      return <span className="text-stone-400">—</span>;
    }
    const opt = refOptions[field.name]?.find((o) => o.value === String(value));
    // Fora dos combos (cadastro grande): o nome que a lista já traz do servidor
    const rotulo = opt ? opt.label : row[`${field.name}__rotulo`];
    // Código (CFOP, cClassTrib) antes do nome, como no combo
    return <span className="truncate">{rotulo != null ? `${value} - ${rotulo}` : String(value)}</span>;
  }

  if (field.type === 'enum' && value) {
    const badge = STATUS_COLORS[String(value)];
    const label = field.options?.find((o) => o.value === String(value))?.label || String(value);
    if (field.icone) {
      return (
        <span
          title={`${field.label}: ${label}`}
          className={`inline-flex p-[3px] rounded-full border align-middle ${
            badge || 'bg-stone-100 text-stone-600 border-stone-300 dark:bg-stone-800 dark:text-stone-300 dark:border-stone-700'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
        </span>
      );
    }
    return (
      <span
        className={`inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${
          badge ||
          'bg-stone-100 text-stone-700 border-stone-300 dark:bg-stone-800 dark:text-stone-300 dark:border-stone-700'
        }`}
      >
        {label}
      </span>
    );
  }

  if (field.type === 'boolean') {
    const on = value === true || Number(value) === 1 || value === 'S';
    return (
      <span
        className={`inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
          on
            ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
            : 'bg-stone-100 text-stone-600 border-stone-300 dark:bg-stone-800 dark:text-stone-400 dark:border-stone-700'
        }`}
      >
        {on ? 'Sim' : 'Não'}
      </span>
    );
  }

  return <span>{formatCellValue(field, value)}</span>;
};

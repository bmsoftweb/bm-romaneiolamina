import { ClipboardList, Cog, Database, FileCog, Package, Percent, Receipt, Repeat, Ruler, Users, type LucideIcon } from 'lucide-react';
import { ResourceDef, ResourceGroup } from '../types';
import { GROUP_LABELS } from './formatters';

/** Mapa dos ícones declarados no registro de metadados do servidor */
const ICONS: Record<string, LucideIcon> = { ClipboardList, Repeat, Percent, Cog, Users, Package, Ruler, Receipt };

const GROUP_ORDER: ResourceGroup[] = ['romaneio', 'cadastros'];

export interface ItemMenu {
  id: string;
  label: string;
  descricao: string;
  icone: LucideIcon;
}

/** Telas que não são recurso do CRUD (o App desenha cada uma) */
export const TELAS_EXTRAS: (ItemMenu & { group: ResourceGroup })[] = [
  { id: 'config_nfe', label: 'Configuração da NF-e', descricao: 'Regras fiscais da nota gerada pelo romaneio', icone: FileCog, group: 'cadastros' },
];

/** Opções do menu (as do ufrmMenu do Delphi: Romaneios, Conversão, Perdas e Máquinas, mais Clientes e Produtos), agrupadas como na barra lateral */
export function gruposDoMenu(resources: ResourceDef[]): { titulo: string; itens: ItemMenu[] }[] {
  return GROUP_ORDER.map((group) => ({
    titulo: GROUP_LABELS[group] || group,
    itens: resources
      .filter((r) => r.group === group && !r.oculto)
      .map((r): ItemMenu => ({ id: r.name, label: r.label, descricao: r.description, icone: ICONS[r.icon] || Database }))
      .concat(resources.length ? TELAS_EXTRAS.filter((t) => t.group === group) : []),
  })).filter((g) => g.itens.length);
}

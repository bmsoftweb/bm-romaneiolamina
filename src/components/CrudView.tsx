import { createPortal } from 'react-dom';
import { SelectAuto } from './SelectAuto';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Grade, ModoLargura, TamanhoCampo, lerConfigLista, salvarConfigLista } from '../utils/configListas';
import {
  Search,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ArrowUp,
  ArrowDown,
  Loader2,
  Inbox,
  Plus,
  X,
  List,
  FilePlus2,
  FileText,
  SlidersHorizontal,
  Menu,
} from 'lucide-react';
import { FieldDef, FiltroAvancado, OpcaoRef, RegistroCrud, ResourceDef } from '../types';
import {
  listRecords,
  createRecord,
  updateRecord,
  deleteRecord,
  fetchOptions,
  invalidateOptions,
} from '../services/api';
import { RecordForm } from './RecordForm';
import { Toggle } from './Toggle';
import { CellValue } from './CellValue';
import { DetailPanel } from './DetailPanel';
import { AdvancedSearch } from './AdvancedSearch';
import { BotaoAcao, MenuAcoes, SeparadorAcoes } from './MenuAcoes';
import { ConfirmDialog } from './ConfirmDialog';
import { INPUT_CLASS } from '../utils/formStyles';
import { AvisoErro } from './AvisoErro';

interface CrudViewProps {
  resource: ResourceDef;
  /** Definições de todos os recursos, usadas pelas grades de detalhe */
  allResources: ResourceDef[];
  /** Incrementado pelo Header para forçar recarga */
  refreshToken: number;
  onToast: (msg: string) => void;
  onCountChange: (resourceName: string, total: number) => void;
  /** Navegação para outra tela, usada pelo atalho do painel de detalhe */
  onNavigate: (resourceName: string) => void;
  /** Botões extras da coluna Ações de cada linha (ex.: Imprimir o romaneio) */
  acoesLinha?: (row: RegistroCrud, ctx: { abrir: (row: RegistroCrud) => void; recarregar: () => void }) => React.ReactNode;
  /** Ações da linha (as de acoesLinha, Editar e Excluir) num menu "...", em vez de ícones soltos */
  acoesEmMenu?: boolean;
  /** Motivo de o registro estar travado (ex.: romaneio concluído): formulário e grades de detalhe só para consulta */
  travado?: (row: RegistroCrud) => string | null;
}

/** Uma aba aberta sobre um registro (inclusão ou edição) */
interface AbaRegistro {
  /** 'novo' para inclusão, ou 'edit:<id>' para edição */
  key: string;
  /** `null` quando é uma inclusão */
  record: RegistroCrud | null;
  titulo: string;
}

const LIST_TAB = 'lista';

const WIDTH_CLASS: Record<string, string> = {
  xs: 'w-16',
  sm: 'w-32',
  md: 'w-48',
  lg: 'w-80',
};

export const CrudView: React.FC<CrudViewProps> = ({
  resource,
  allResources,
  refreshToken,
  onToast,
  onCountChange,
  onNavigate,
  acoesLinha,
  acoesEmMenu,
  travado,
}) => {
  const camposProprios = resource.fields;

  // Colunas visíveis: as escolhidas pelo usuário (preferências da lista) ou, sem escolha, as marcadas como listed
  const [visiveis, setVisiveis] = useState<string[] | null>(null);
  const listedFields = useMemo(
    () => camposProprios.filter((f) => (f.type === 'password' ? false : visiveis ? visiveis.includes(f.name) : f.listed)),
    [camposProprios, visiveis],
  );

  const alternarColuna = (nome: string) =>
    setVisiveis((atual) => {
      const base = atual ?? camposProprios.filter((f) => f.listed).map((f) => f.name);
      return base.includes(nome) ? base.filter((n) => n !== nome) : [...base, nome];
    });

  // Ordem das colunas depois de arrastadas pelo usuário (só nesta sessão)
  const [ordem, setOrdem] = useState<string[]>([]);
  const arrastando = useRef<string | null>(null);

  const colunas = useMemo(() => {
    if (!ordem.length) return listedFields;
    const posicao = (nome: string) => {
      const i = ordem.indexOf(nome);
      return i < 0 ? ordem.length : i;
    };
    return [...listedFields].sort((a, b) => posicao(a.name) - posicao(b.name));
  }, [listedFields, ordem]);

  const soltarColuna = (destino: string) => {
    const origem = arrastando.current;
    arrastando.current = null;
    if (!origem || origem === destino) return;
    const nomes = colunas.map((f) => f.name).filter((n) => n !== origem);
    nomes.splice(nomes.indexOf(destino), 0, origem);
    setOrdem(nomes);
  };
  const refFields = useMemo(() => resource.fields.filter((f) => f.ref), [resource]);
  const isSearchable = useMemo(() => resource.fields.some((f) => f.searchable), [resource]);
  // Campos da busca avançada: os escolhidos pelo usuário (config_listas) ou, sem escolha, os filterable
  const [camposBusca, setCamposBusca] = useState<string[] | null>(null);
  const [ordemForm, setOrdemForm] = useState<string[]>([]);
  const [tamanhosForm, setTamanhosForm] = useState<Record<string, TamanhoCampo>>({});
  const camposBuscaAtuais = useMemo(
    () =>
      resource.fields
        .filter((f) => f.type !== 'password')
        .filter((f) => (camposBusca ? camposBusca.includes(f.name) : f.filterable))
        .map((f) => f.name),
    [resource, camposBusca],
  );
  const alternarCampoBusca = (nome: string) =>
    setCamposBusca(() =>
      camposBuscaAtuais.includes(nome)
        ? camposBuscaAtuais.filter((n) => n !== nome)
        : [...camposBuscaAtuais, nome],
    );
  const temBuscaAvancada = camposBuscaAtuais.length > 0;

  /**
   * Recursos que possuem a coluna "ativo" abrem listando somente os ativos.
   * O operador pode ver os inativos (ou todos) pela busca avançada.
   */
  const filtroPadrao = useMemo<FiltroAvancado[]>(() => {
    const temAtivo = resource.fields.some((f) => f.name === 'ativo' && f.type === 'boolean');
    return temAtivo ? [{ field: 'ativo', op: 'eq', value: '1' }] : [];
  }, [resource]);

  /** Indica que os filtros atuais são exatamente o padrão "somente ativos" */
  const ehFiltroPadrao = (lista: FiltroAvancado[]) =>
    lista.length === 1 && lista[0].field === 'ativo' && lista[0].op === 'eq' && lista[0].value === '1';

  const [rows, setRows] = useState<RegistroCrud[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [sort, setSort] = useState(resource.defaultSort.field);

  // Larguras ajustadas pelo usuário ao arrastar a divisa do cabeçalho (só nesta sessão)
  const [larguras, setLarguras] = useState<Record<string, number>>({});
  const [menuColunas, setMenuColunas] = useState(false);
  /** Posição do submenu Colunas (fixa na tela; null = fechado) */
  const [subColunas, setSubColunas] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  /** Fechar com uma pequena espera: levar o mouse na diagonal até o submenu não o fecha */
  const fecharSubColunasTimer = useRef<number | null>(null);
  const cancelarFechamentoSubColunas = () => {
    if (fecharSubColunasTimer.current) window.clearTimeout(fecharSubColunasTimer.current);
    fecharSubColunasTimer.current = null;
  };
  const abrirSubColunas = (el: HTMLElement) => {
    cancelarFechamentoSubColunas();
    const r = el.getBoundingClientRect();
    const LARGURA = 288; // tem que bater com o w-72 do submenu
    // À direita do item; sem espaço, à esquerda. Altura até o pé da tela (mínimo 240px, subindo se preciso)
    const left = r.right - 4 + LARGURA > window.innerWidth ? Math.max(8, r.left - LARGURA + 4) : r.right - 4;
    const top = Math.max(8, Math.min(r.top, window.innerHeight - 248));
    setSubColunas({ top, left, maxHeight: window.innerHeight - top - 8 });
  };
  const [grade, setGrade] = useState<Grade>('horizontais');
  const [comSobra, setComSobra] = useState(true);
  const [modoLargura, setModoLargura] = useState<ModoLargura>('manual');

  // A borda existe sempre (só fica transparente), senão a altura da linha muda junto com a grade
  const bordasCelula = `border-b border-r ${
    grade === 'ambas' || grade === 'horizontais'
      ? 'border-b-stone-100 dark:border-b-stone-800/60'
      : 'border-b-transparent'
  } ${
    grade === 'ambas' || grade === 'verticais'
      ? 'border-r-stone-100 dark:border-r-stone-800/60'
      : 'border-r-transparent'
  }`;

  /** Números/moeda à direita, datas, Sim/Não e ícones centralizados, o resto à esquerda */
  const alinhamento = ({ type: tipo, icone }: FieldDef) =>
    tipo === 'number' || tipo === 'decimal'
      ? 'text-right'
      : tipo === 'date' || tipo === 'datetime' || tipo === 'boolean' || icone
      ? 'text-center'
      : 'text-left';

  // Larguras/ordem vêm das preferências da lista (neste navegador) e voltam para lá ao salvar
  const configCarregada = useRef(false);
  useEffect(() => {
    configCarregada.current = false;
    let vivo = true;
    lerConfigLista(resource.name).then((cfg) => {
      if (!vivo) return;
      setLarguras(cfg.larguras || {});
      setOrdem(cfg.ordem || []);
      // Coluna criada depois da configuração salva: entra se for das listadas por padrão. Configuração antiga,
      // sem "conhecidas": vale o que estava visível (uma coluna padrão escondida volta até salvar de novo)
      const conhecidas = new Set(cfg.conhecidas ?? cfg.visiveis ?? []);
      setVisiveis(
        cfg.visiveis
          ? [...cfg.visiveis, ...camposProprios.filter((f) => f.listed && !conhecidas.has(f.name)).map((f) => f.name)]
          : null,
      );
      setCamposBusca(cfg.busca || null);
      setOrdemForm(cfg.ordemForm || []);
      setTamanhosForm(cfg.tamanhosForm || {});
      setGrade(cfg.grade || 'horizontais');
      setComSobra(cfg.sobra !== false);
      setModoLargura(cfg.modo || 'manual');
      configCarregada.current = true;
    });
    return () => {
      vivo = false;
    };
  }, [resource.name]);

  const salvarConfiguracao = () => {
    setMenuColunas(false);
    // Nos modos automáticos a largura é recalculada ao abrir, então não vale guardá-la:
    // a mesma lista pode abrir em outro monitor, com outra largura de tela.
    salvarConfigLista(resource.name, {
      visiveis: listedFields.map((f) => f.name),
      conhecidas: camposProprios.map((f) => f.name),
      busca: camposBuscaAtuais,
      ordemForm: ordemForm.length ? ordemForm : undefined,
      tamanhosForm: Object.keys(tamanhosForm).length ? tamanhosForm : undefined,
      larguras: modoLargura === 'manual' ? larguras : undefined,
      ordem,
      grade,
      sobra: comSobra,
      modo: modoLargura,
    });
    onToast('Configuração salva.');
  };

  const tabelaRef = useRef<HTMLTableElement>(null);
  /** Posição da 1ª coluna de dados no cabeçalho: depois do indicador */
  const inicioColunas = 1;

  /**
   * Mede a largura que cada coluna teria só pelo conteúdo, ignorando as larguras
   * já aplicadas e o esticamento do w-full. Devolve [fixaEsquerda, ...colunas, acoes].
   */
  const medirColunas = (): number[] | null => {
    const tabela = tabelaRef.current;
    if (!tabela) return null;
    const cabecalhos = Array.from(tabela.querySelectorAll('thead th')) as HTMLElement[];
    // Todas as linhas: qualquer célula com a largura (mínima) de antes seguraria a coluna larga na medição
    const celulas = Array.from(tabela.querySelectorAll('tbody td')) as HTMLElement[];
    const anteriores = [...cabecalhos, ...celulas].map((c) => [c.style.width, c.style.minWidth, c.style.maxWidth]);
    [...cabecalhos, ...celulas].forEach((c) => {
      c.style.width = '';
      c.style.minWidth = '';
      c.style.maxWidth = '';
    });
    const larguraTabela = tabela.style.width;
    tabela.style.width = 'max-content';
    const medidas = cabecalhos.map((th) => th.offsetWidth);
    tabela.style.width = larguraTabela;
    [...cabecalhos, ...celulas].forEach((c, i) => {
      [c.style.width, c.style.minWidth, c.style.maxWidth] = anteriores[i];
    });
    return medidas;
  };

  /** Cada coluna com a largura do seu conteúdo (a de Ações e a do indicador ficam como estão) */
  const aplicarMelhorLargura = () => {
    setComSobra(true);
    const medidas = medirColunas();
    if (!medidas) return;
    // +10px de folga: a medida arredonda para baixo e o texto no limite ainda saía cortado com "..."
    setLarguras(
      Object.fromEntries(colunas.map((f, i) => [f.name, Math.max(60, medidas[i + inicioColunas] + 10)])),
    );
  };

  /**
   * Divide todo o espaço livre entre as colunas, na proporção do que cada uma ocupa hoje:
   * lista com poucas colunas fica com colunas largas; com muitas, colunas estreitas (mín. 50px).
   * Mede como está na tela (e não o conteúdo), porque a sobra vive na coluna vazia do fim.
   */
  const aplicarAjustarLargura = () => {
    setComSobra(false);
    const tabela = tabelaRef.current;
    const area = tabela?.parentElement;
    if (!tabela || !area) return;
    const cabecalhos = Array.from(tabela.querySelectorAll('thead th')) as HTMLElement[];
    const atuais = cabecalhos.slice(inicioColunas, inicioColunas + colunas.length).map((th) => th.offsetWidth);
    const soma = atuais.reduce((a, b) => a + b, 0);
    const fixas = cabecalhos.slice(0, inicioColunas).reduce((a, th) => a + th.offsetWidth, 0) + cabecalhos[cabecalhos.length - 1].offsetWidth;
    const disponivel = area.clientWidth - fixas - 1;
    if (soma <= 0 || disponivel <= 0) return;
    const fator = disponivel / soma;
    const finais = atuais.map((largura) => Math.max(50, Math.floor(largura * fator)));
    const resto = disponivel - finais.reduce((a, b) => a + b, 0);
    if (resto > 0) finais[finais.length - 1] += resto;
    setLarguras(Object.fromEntries(colunas.map((f, i) => [f.name, finais[i]])));
  };

  // Nos modos automáticos a largura é recalculada: ao abrir a lista, quando as linhas
  // chegam e quando a janela muda de tamanho (outro monitor, por exemplo).
  useEffect(() => {
    if (modoLargura === 'manual') return;
    const aplicar = () =>
      modoLargura === 'ajustar' ? aplicarAjustarLargura() : aplicarMelhorLargura();
    const id = requestAnimationFrame(aplicar);
    window.addEventListener('resize', aplicar);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener('resize', aplicar);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modoLargura, colunas, rows]);

  const iniciarRedimensionamento = (e: React.PointerEvent, campo: string) => {
    e.preventDefault();
    e.stopPropagation();
    setModoLargura('manual');
    // Só a coluna arrastada muda: a coluna vazia do fim volta (também depois do "Ajustar largura") e fica com a
    // diferença; passando da tela, a lista rola para o lado
    setComSobra(true);

    const tabela = tabelaRef.current;
    if (!tabela) return;
    const cabecalhos = Array.from(tabela.querySelectorAll('thead th')) as HTMLElement[];
    // Congela as larguras atuais: sem isso o navegador redistribui a sobra e o arraste "escorrega"
    const base = cabecalhos.slice(inicioColunas, inicioColunas + colunas.length).map((th) => th.offsetWidth);
    const indice = colunas.findIndex((f) => f.name === campo);
    const xInicial = e.clientX;

    const mover = (ev: PointerEvent) => {
      const finais = [...base];
      finais[indice] = Math.max(50, base[indice] + ev.clientX - xInicial);
      setLarguras(Object.fromEntries(colunas.map((f, i) => [f.name, finais[i]])));
    };

    const soltar = () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
  };
  const [dir, setDir] = useState<'asc' | 'desc'>(resource.defaultSort.dir);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Busca avançada: painel aberto e filtros aplicados
  const [buscaAvancadaAberta, setBuscaAvancadaAberta] = useState(false);
  const [filtros, setFiltros] = useState<FiltroAvancado[]>(filtroPadrao);
  /** Toggle "mostrar" (ex.: Mostrar tudo nas máquinas): a última escolha fica lembrada neste navegador */
  const lerLocal = (chave: string, padrao: string): string => {
    try {
      return localStorage.getItem(`romaneio.${chave}.${resource.name}`) ?? padrao;
    } catch {
      return padrao;
    }
  };
  const gravarLocal = (chave: string, valor: string) => {
    try {
      localStorage.setItem(`romaneio.${chave}.${resource.name}`, valor);
    } catch {
      /* sem armazenamento: vale só nesta tela */
    }
  };
  const [mostrar, setMostrar] = useState(() => lerLocal('mostrar', '1') !== '0');
  /** Painel das grades de detalhe recolhido: aberto ou fechado, fica assim ao escolher outros registros */
  const [detalheRecolhido, setDetalheRecolhido] = useState(false);

  const [refOptions, setRefOptions] = useState<Record<string, OpcaoRef[]>>({});

  // Abas abertas e aba ativa
  const [abas, setAbas] = useState<AbaRegistro[]>([]);
  const [abaAtiva, setAbaAtiva] = useState<string>(LIST_TAB);

  const [deleting, setDeleting] = useState<RegistroCrud | null>(null);

  // Linha selecionada que alimenta o painel mestre-detalhe
  const [selecionado, setSelecionado] = useState<RegistroCrud | null>(null);

  /** O mestre-detalhe exige detalhes declarados e chave primária simples */
  const temGrades = Boolean(resource.details?.length) && resource.pk.length === 1;

  const recordId = useCallback(
    (row: RegistroCrud) => resource.pk.map((c) => row[c]).join('~'),
    [resource.pk],
  );

  /** Rótulo curto do registro, usado no título da aba */
  const recordLabel = useCallback(
    (row: RegistroCrud) => {
      const raw = row[resource.labelField];
      const texto = raw === null || raw === undefined || raw === '' ? `#${recordId(row)}` : String(raw);
      return texto.length > 28 ? `${texto.slice(0, 28)}…` : texto;
    },
    [resource.labelField, recordId],
  );

  // Ao trocar de recurso, reinicia a grade e fecha as abas do recurso anterior
  useEffect(() => {
    setPage(1);
    setSearch('');
    setSearchInput('');
    setSort(resource.defaultSort.field);
    setDir(resource.defaultSort.dir);
    setError(null);
    setAbas([]);
    setAbaAtiva(LIST_TAB);
    setSelecionado(null);
    setFiltros(filtroPadrao);
    setMostrar(lerLocal('mostrar', '1') !== '0');
    setBuscaAvancadaAberta(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource.name, resource.defaultSort.field, resource.defaultSort.dir, filtroPadrao]);

  // A seleção do mestre-detalhe não sobrevive a uma troca de página ou de busca
  useEffect(() => {
    setSelecionado(null);
  }, [page, search, filtros]);

  // Lista com detalhe já abre com o painel: sem seleção, vale a primeira linha.
  // Fechado no X, o painel só volta quando o usuário escolhe uma linha.
  const painelFechado = useRef(false);
  useEffect(() => {
    if (temGrades && !selecionado && !painelFechado.current && rows.length) setSelecionado(rows[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, temGrades]);

  /** Botão de atualizar de um combo: limpa o cache do recurso ligado e busca de novo só as opções dele */
  const atualizarOpcoes = useCallback(
    async (campo: string) => {
      const f = refFields.find((x) => x.name === campo);
      if (!f) return;
      invalidateOptions(f.ref!.resource);
      const opcoes = await fetchOptions(f.ref!.resource, f.ref!.labelField);
      setRefOptions((m) => ({ ...m, [campo]: opcoes }));
    },
    [refFields],
  );

  // Carrega os combos de chave estrangeira do recurso
  useEffect(() => {
    let alive = true;
    if (!refFields.length) {
      setRefOptions({});
      return;
    }

    (async () => {
      const map: Record<string, OpcaoRef[]> = {};
      for (const f of refFields) {
        try {
          map[f.name] = await fetchOptions(f.ref!.resource, f.ref!.labelField);
        } catch {
          map[f.name] = [];
        }
      }
      if (alive) setRefOptions(map);
    })();

    return () => {
      alive = false;
    };
  }, [refFields, refreshToken]);

  /** Filtros da busca avançada + os do toggle "mostrar" desligado */
  const filtrosEfetivos = useMemo<FiltroAvancado[]>(
    () => [...filtros, ...(resource.toggleMostrar && !mostrar ? resource.toggleMostrar.ocultar : [])],
    [filtros, resource.toggleMostrar, mostrar],
  );

  /** Número da carga mais recente: uma resposta atrasada (ex.: a de antes de um filtro mudar) não sobrescreve a nova */
  const ultimaCarga = useRef(0);

  const load = useCallback(async () => {
    const carga = ++ultimaCarga.current;
    const valeAinda = () => carga === ultimaCarga.current;
    setIsLoading(true);
    setError(null);
    try {
      const data = await listRecords(resource.name, {
        page,
        limit,
        search,
        sort,
        dir,
        filters: filtrosEfetivos,
      });
      if (!valeAinda()) return;
      setRows(data.data);
      setTotal(data.total);
      setTotalPages(data.totalPages);
      onCountChange(resource.name, data.total);
    } catch (err: any) {
      if (!valeAinda()) return;
      setError(err.message || 'Falha ao carregar os registros.');
      setRows([]);
    } finally {
      if (valeAinda()) setIsLoading(false);
    }
  }, [resource.name, page, limit, search, sort, dir, filtrosEfetivos, onCountChange]);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  /** Ação da linha (ex.: Gerar disparos) mudou algo: recarrega a lista e também o painel de detalhe */
  const [versaoDetalhe, setVersaoDetalhe] = useState(0);
  const recarregarComDetalhe = useCallback(() => {
    load();
    setVersaoDetalhe((v) => v + 1);
  }, [load]);

  // ----------------------------------------------------------
  // Gestão das abas
  // ----------------------------------------------------------
  /** Reaproveita a inclusão já aberta */
  const abrirAbaNovo = useCallback(
    () => {
      setAbas((prev) =>
        prev.some((a) => a.key === 'novo') ? prev : [...prev, { key: 'novo', record: null, titulo: `Novo ${resource.labelSingular}` }],
      );
      setAbaAtiva('novo');
    },
    [resource.labelSingular],
  );

  const abrirAbaEdicao = useCallback(
    (row: RegistroCrud) => {
      const key = `edit:${recordId(row)}`;
      setAbas((prev) => {
        const existente = prev.find((a) => a.key === key);
        // Reabre com os dados mais recentes da grade
        if (existente) return prev.map((a) => (a.key === key ? { ...a, record: row } : a));
        return [...prev, { key, record: row, titulo: recordLabel(row) }];
      });
      setAbaAtiva(key);
    },
    [recordId, recordLabel],
  );

  const fecharAba = useCallback(
    (key: string) => {
      setAbas((prev) => {
        const idx = prev.findIndex((a) => a.key === key);
        const restantes = prev.filter((a) => a.key !== key);
        // Ao fechar a aba ativa, foca a vizinha à esquerda (ou a listagem)
        setAbaAtiva((atual) => {
          if (atual !== key) return atual;
          if (!restantes.length) return LIST_TAB;
          return restantes[Math.max(0, idx - 1)].key;
        });
        return restantes;
      });
    },
    [],
  );

  const handleSort = (fieldName: string) => {
    if (sort === fieldName) {
      setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort(fieldName);
      setDir('asc');
    }
    setPage(1);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput.trim());
    setPage(1);
  };

  const handleSave = async (aba: AbaRegistro, payload: RegistroCrud) => {
    if (aba.record) {
      await updateRecord(resource.name, recordId(aba.record), payload);
      onToast(`${resource.labelSingular} atualizado com sucesso.`);
    } else {
      await createRecord(resource.name, payload);
      onToast(`${resource.labelSingular} incluído com sucesso.`);
    }
    invalidateOptions(resource.name);
    fecharAba(aba.key);
    await load();
  };

  const handleDelete = async () => {
    if (!deleting) return;
    const id = recordId(deleting);
    await deleteRecord(resource.name, id);
    invalidateOptions(resource.name);
    onToast(`${resource.labelSingular} excluído com sucesso.`);
    setDeleting(null);
    // Fecha a aba do registro excluído, se estiver aberta, e a ficha dele embaixo da lista
    fecharAba(`edit:${id}`);
    if (selecionado && recordId(selecionado) === id) setSelecionado(null);
    if (rows.length === 1 && page > 1) setPage((p) => p - 1);
    else await load();
  };

  // Largura do conteúdo (w-px + nowrap): cada tela tem uma quantidade de ícones de ação
  const larguraAcoes = 'w-px whitespace-nowrap';
  const firstRecord = (page - 1) * limit + 1;
  const lastRecord = Math.min(page * limit, total);
  const abaAtual = abas.find((a) => a.key === abaAtiva) || null;
  // A linha recarregada (ex.: depois de concluir o romaneio), não a cópia do clique
  const linhaSelecionada = selecionado && (rows.find((r) => recordId(r) === recordId(selecionado)) ?? selecionado);

  // ----------------------------------------------------------
  // Barra de abas — só aparece quando há algum registro aberto,
  // para a listagem não exibir uma "orelha" solitária.
  // ----------------------------------------------------------
  const tabBar = (
    <div className="flex items-stretch bg-stone-100 dark:bg-stone-950 border-b border-stone-200 dark:border-stone-800 overflow-x-auto overflow-y-hidden shrink-0">
      {/* Aba fixa da listagem */}
      <button
        onClick={() => setAbaAtiva(LIST_TAB)}
        className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold whitespace-nowrap border-r border-stone-200 dark:border-stone-800 border-b-2 transition-colors cursor-pointer ${
          abaAtiva === LIST_TAB
            ? 'bg-white dark:bg-stone-900 text-blue-700 dark:text-blue-400 border-b-blue-600'
            : 'border-b-transparent text-stone-600 dark:text-stone-400 hover:bg-stone-200/60 dark:hover:bg-stone-800/60'
        }`}
      >
        <List className="w-3.5 h-3.5" />
        <span>{resource.label}</span>
        <span className="text-[10px] font-mono text-stone-400">{total}</span>
      </button>

      {/* Abas de registro */}
      {abas.map((aba) => {
        const ativa = abaAtiva === aba.key;
        const isNovo = aba.record === null;
        return (
          <div
            key={aba.key}
            className={`flex items-center gap-1.5 pl-4 pr-2 border-r border-stone-200 dark:border-stone-800 border-b-2 transition-colors ${
              ativa
                ? 'bg-white dark:bg-stone-900 border-b-blue-600'
                : 'border-b-transparent hover:bg-stone-200/60 dark:hover:bg-stone-800/60'
            }`}
          >
            <button
              onClick={() => setAbaAtiva(aba.key)}
              className={`flex items-center gap-2 py-2.5 text-xs font-semibold whitespace-nowrap cursor-pointer ${
                ativa
                  ? 'text-blue-700 dark:text-blue-400'
                  : 'text-stone-600 dark:text-stone-400'
              }`}
            >
              {isNovo ? <FilePlus2 className="w-3.5 h-3.5" /> : <FileText className="w-3.5 h-3.5" />}
              <span>{aba.titulo}</span>
            </button>
            <button
              onClick={() => fecharAba(aba.key)}
              title="Fechar aba"
              className="p-1 rounded text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:text-rose-400 dark:hover:bg-rose-950/40 transition-colors cursor-pointer shrink-0"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}
    </div>
  );

  // ----------------------------------------------------------
  // Painel de listagem
  // ----------------------------------------------------------
  /** Uma linha da grade */
  const linhaGrade = (row: RegistroCrud) => {
                const id = recordId(row);
                const abertaEmAba = abas.some((a) => a.key === `edit:${id}`);
                const estaSelecionada = temGrades && selecionado !== null && recordId(selecionado) === id;
                return (
                  <tr
                    key={id}
                    onClick={
                      temGrades
                        ? () => {
                            painelFechado.current = false;
                            setSelecionado(row);
                          }
                        : undefined
                    }
                    onDoubleClick={() => resource.canUpdate && abrirAbaEdicao(row)}
                    className={`group transition-colors ${temGrades ? 'cursor-pointer' : ''} ${
                      estaSelecionada
                        ? 'bg-blue-100 dark:bg-blue-950'
                        : abertaEmAba
                        ? 'bg-blue-50 dark:bg-stone-800'
                        : 'bg-white dark:bg-stone-900 hover:bg-stone-50 dark:hover:bg-stone-800'
                    }`}
                  >
                    <td className={`sticky left-0 z-[5] w-[30px] min-w-[30px] max-w-[30px] px-0 text-center align-middle bg-inherit border-r border-stone-200 dark:border-stone-800 ${bordasCelula}`}>
                      <ChevronRight
                        className={`w-3.5 h-3.5 mx-auto ${
                          estaSelecionada || abertaEmAba
                            ? 'text-blue-600 dark:text-blue-400'
                            : 'text-stone-300 opacity-0 group-hover:opacity-100 dark:text-stone-600'
                        }`}
                      />
                    </td>
                    {colunas.map((f) => (
                      <td
                        key={f.name}
                        style={larguras[f.name] ? { width: larguras[f.name], minWidth: larguras[f.name], maxWidth: larguras[f.name] } : undefined}
                        className={`px-3 py-[7.5px] text-stone-700 dark:text-stone-300 align-middle max-w-xs truncate ${bordasCelula} ${alinhamento(f)}`}
                      >
                        <CellValue field={f} row={row} refOptions={refOptions} />
                      </td>
                    ))}
                    {comSobra && <td className={`w-full ${bordasCelula}`} />}
                    <td className={`sticky right-0 z-[5] ${larguraAcoes} px-3 py-[7.5px] text-center whitespace-nowrap bg-inherit border-l border-stone-200 dark:border-stone-800 ${bordasCelula}`}>
                      {acoesEmMenu ? (
                        <MenuAcoes>
                          {acoesLinha?.(row, { abrir: abrirAbaEdicao, recarregar: recarregarComDetalhe })}
                          {(resource.canUpdate || resource.canDelete) && <SeparadorAcoes />}
                          {resource.canUpdate && (
                            <BotaoAcao icone={Pencil} titulo="Editar" descricao="Abre o registro numa aba de edição" onClick={() => abrirAbaEdicao(row)} />
                          )}
                          {resource.canDelete && (
                            <BotaoAcao icone={Trash2} titulo="Excluir" descricao="Apaga o registro (pede confirmação)" tom="perigo" onClick={() => setDeleting(row)} />
                          )}
                        </MenuAcoes>
                      ) : (
                      <div className="inline-flex items-center gap-1">
                        {acoesLinha?.(row, { abrir: abrirAbaEdicao, recarregar: recarregarComDetalhe })}
                        {resource.canUpdate && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              abrirAbaEdicao(row);
                            }}
                            title="Editar em nova aba"
                            className="p-1 rounded text-stone-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:text-blue-400 dark:hover:bg-blue-950/40 transition-colors cursor-pointer"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {resource.canDelete && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleting(row);
                            }}
                            title="Excluir registro"
                            className="p-1 rounded text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:text-rose-400 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      )}
                    </td>
                  </tr>
                );
  };

  const listPanel = (
    <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-stone-900">
      {/* Barra de ferramentas, encostada na barra de abas */}
      <div className="px-4 py-2.5 border-b border-stone-200 dark:border-stone-800 flex items-center justify-between gap-3 shrink-0 bg-white dark:bg-stone-900 overflow-x-auto overflow-y-hidden">
        <div className="text-[11px] text-stone-500 dark:text-stone-400 truncate min-w-0">
          {isLoading
            ? 'Carregando registros…'
            : total === 0
            ? 'Nenhum registro encontrado'
            : `${firstRecord}–${lastRecord} de ${total} registro(s) • tabela ${resource.table}`}
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {isSearchable && (
            <form onSubmit={handleSearchSubmit} className="relative w-52 sm:w-64 shrink-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none" />
              <input
                id={`busca-${resource.name}`}
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Buscar…"
                className={`${INPUT_CLASS} w-full pl-9 pr-8`}
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchInput('');
                    setSearch('');
                    setPage(1);
                  }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </form>
          )}

          {temBuscaAvancada && (
            <button
              onClick={() => setBuscaAvancadaAberta((a) => !a)}
              title="Filtrar por categoria, situação, faixa de preço e outros campos"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer shrink-0 whitespace-nowrap ${
                buscaAvancadaAberta || filtros.length > 0
                  ? 'bg-blue-50 border-blue-300 text-blue-700 dark:bg-blue-950/40 dark:border-blue-800 dark:text-blue-300'
                  : 'border-stone-300 text-stone-600 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Busca avançada</span>
              {filtros.length > 0 && (
                <span className="bg-blue-600 text-white text-[10px] font-bold px-1.5 rounded-full">
                  {filtros.length}
                </span>
              )}
            </button>
          )}

          {resource.toggleMostrar && (
            <span title={resource.toggleMostrar.dica} className="shrink-0 flex items-center pl-3 border-l border-stone-200 dark:border-stone-700">
              <Toggle
                size="sm"
                checked={mostrar}
                onChange={(v) => {
                  setMostrar(v);
                  setPage(1);
                  gravarLocal('mostrar', v ? '1' : '0');
                }}
                label={resource.toggleMostrar.label}
              />
            </span>
          )}

            <SelectAuto
              value={limit}
              onChange={(e) => {
                setLimit(Number(e.target.value));
                setPage(1);
              }}
              title="Registros por página"
              className={`${INPUT_CLASS} shrink-0 cursor-pointer`}
            >
              {[10, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n} por página
                </option>
              ))}
            </SelectAuto>

          {resource.canCreate && (
            <button
              onClick={() => abrirAbaNovo()}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shadow-xs cursor-pointer shrink-0 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Novo</span>
            </button>
          )}
        </div>
      </div>

      {/* Painel de busca avançada, logo abaixo da barra de ferramentas */}
      {temBuscaAvancada && buscaAvancadaAberta && (
        <AdvancedSearch
          resource={resource}
          camposVisiveis={camposBuscaAtuais}
          refOptions={refOptions}
          onAtualizarOpcoes={atualizarOpcoes}
          aplicados={filtros}
          onAplicar={(novos, fechar) => {
            setFiltros(novos);
            setPage(1);
            // Aplicar: o painel fecha (com filtros, fica o resumo). Limpar mantém aberto para montar outro
            if (fechar) setBuscaAvancadaAberta(false);
          }}
          onFechar={() => setBuscaAvancadaAberta(false)}
        />
      )}

      {/* Resumo dos filtros quando o painel está recolhido */}
      {temBuscaAvancada && !buscaAvancadaAberta && filtros.length > 0 && (
        <div className="px-4 py-2 border-b border-stone-200 dark:border-stone-800 bg-blue-50/60 dark:bg-blue-950/20 flex items-center justify-between gap-3 shrink-0">
          <span className="text-[11px] text-blue-800 dark:text-blue-300 truncate">
            {ehFiltroPadrao(filtros) ? (
              <>
                Exibindo <strong>somente os registros ativos</strong> (padrão da tela)
              </>
            ) : (
              <>
                <strong>{filtros.length}</strong> filtro(s) de busca avançada aplicado(s)
              </>
            )}
          </span>
          <button
            onClick={() => setFiltros([])}
            className="text-[11px] font-semibold text-blue-700 dark:text-blue-400 hover:underline cursor-pointer shrink-0"
          >
            {ehFiltroPadrao(filtros) ? 'Ver todos' : 'Limpar'}
          </button>
        </div>
      )}

      {error && (
        <AvisoErro mensagem={error} onFechar={() => setError(null)} />
      )}

      {/* Grade ocupando toda a altura restante */}
      <div className="flex-1 overflow-auto min-h-0">
        <table ref={tabelaRef} className="w-full text-xs border-separate border-spacing-0">
          <thead className="sticky top-0 z-10">
            <tr className="bg-stone-50 dark:bg-stone-950/90 backdrop-blur-xs">
              <th className="sticky left-0 z-20 w-[30px] min-w-[30px] max-w-[30px] px-0 text-center border-b border-r border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950">
                <div className="relative">
                  <button
                    onClick={() => {
                      setMenuColunas((v) => !v);
                      setSubColunas(null);
                    }}
                    title="Opções das colunas"
                    className="p-1 mx-auto block text-stone-400 hover:text-blue-600 dark:text-stone-500 dark:hover:text-blue-400 cursor-pointer"
                  >
                    <Menu className="w-3.5 h-3.5" />
                  </button>
                  {menuColunas && (
                    <>
                      <div className="fixed inset-0 z-30" onClick={() => setMenuColunas(false)} />
                      <div className="absolute left-0 top-full z-40 mt-1 w-44 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 shadow-lg py-1 text-left font-normal">
                        <button
                          onClick={() => {
                            setMenuColunas(false);
                            setModoLargura('ajustar');
                            aplicarAjustarLargura();
                          }}
                          className="w-full px-3 py-2 text-xs text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer text-left"
                        >
                          Ajustar largura
                        </button>
                        <button
                          onClick={() => {
                            setMenuColunas(false);
                            setModoLargura('melhor');
                            aplicarMelhorLargura();
                          }}
                          className="w-full px-3 py-2 text-xs text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer text-left"
                        >
                          Melhor largura
                        </button>
                        <div className="my-1 border-t border-stone-200 dark:border-stone-700" />
                        {(
                          [
                            ['ambas', 'Mostrar linhas da grade'],
                            ['horizontais', 'Mostrar linhas horizontais'],
                            ['verticais', 'Mostrar linhas verticais'],
                            ['nenhuma', 'Não mostrar linhas da grade'],
                          ] as [Grade, string][]
                        ).map(([valor, rotulo]) => (
                          <button
                            key={valor}
                            onClick={() => {
                              setGrade(valor);
                              setMenuColunas(false);
                            }}
                            className={`w-full px-3 py-2 text-xs hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer text-left ${
                              grade === valor
                                ? 'text-blue-700 dark:text-blue-300 font-semibold'
                                : 'text-stone-700 dark:text-stone-200'
                            }`}
                          >
                            {rotulo}
                          </button>
                        ))}
                        <div className="my-1 border-t border-stone-200 dark:border-stone-700" />
                        {/* Submenu das colunas da lista (inclusive as que não estão no formulário, como Cidade/UF):
                            abre ao passar o mouse ou ao clicar (toque) */}
                        <div
                          className="relative"
                          onMouseEnter={(e) => (subColunas ? cancelarFechamentoSubColunas() : abrirSubColunas(e.currentTarget))}
                          onMouseLeave={() => {
                            cancelarFechamentoSubColunas();
                            fecharSubColunasTimer.current = window.setTimeout(() => setSubColunas(null), 350);
                          }}
                        >
                          <button
                            onClick={(e) => (subColunas ? setSubColunas(null) : abrirSubColunas(e.currentTarget))}
                            className={`w-full px-3 py-2 text-xs text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer text-left flex items-center justify-between ${
                              subColunas ? 'bg-stone-100 dark:bg-stone-800' : ''
                            }`}
                          >
                            Colunas
                            <ChevronRight className="w-3.5 h-3.5 text-stone-400" />
                          </button>
                          {subColunas &&
                            // Portal no body: dentro da grade (que rola e corta) o submenu ficava por trás e cortado.
                            // No React ele continua "dentro" deste item, então passar o mouse para ele não o fecha.
                            createPortal(
                            <div
                              onMouseEnter={cancelarFechamentoSubColunas}
                              style={{ top: subColunas.top, left: subColunas.left, maxHeight: subColunas.maxHeight }}
                              className="fixed z-[70] w-72 overflow-y-auto rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 shadow-lg py-1 text-left font-normal"
                            >
                              {camposProprios
                                .filter((f) => f.type !== 'password')
                                .map((f) => (
                                  <div key={f.name} className="px-3 py-1.5 hover:bg-stone-100 dark:hover:bg-stone-800">
                                    <Toggle
                                      checked={listedFields.some((l) => l.name === f.name)}
                                      onChange={() => alternarColuna(f.name)}
                                      size="sm"
                                      label={<span className="text-xs text-stone-700 dark:text-stone-200">{f.label}</span>}
                                    />
                                  </div>
                                ))}
                            </div>,
                            document.body,
                          )}
                        </div>
                        <div className="my-1 border-t border-stone-200 dark:border-stone-700" />
                        <button
                          onClick={salvarConfiguracao}
                          className="w-full px-3 py-2 text-xs text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer text-left"
                        >
                          Salvar Configuração
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </th>
              {colunas.map((f) => {
                const isSorted = sort === f.name;
                return (
                  <th
                    key={f.name}
                    draggable
                    onDragStart={(e) => {
                      arrastando.current = f.name;
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      soltarColuna(f.name);
                    }}
                    onClick={() => handleSort(f.name)}
                    // minWidth: sem ele, a coluna vazia do fim (w-full) tira um pouco de cada coluna
                    style={larguras[f.name] ? { width: larguras[f.name], minWidth: larguras[f.name] } : undefined}
                    className={`relative px-3 py-2.5 text-center font-semibold text-stone-600 dark:text-stone-300 whitespace-nowrap cursor-pointer select-none hover:bg-stone-100 dark:hover:bg-stone-800/60 transition-colors border-b border-r border-stone-200 dark:border-stone-800 ${
                      grade === 'ambas' || grade === 'verticais' ? '' : 'border-r-transparent'
                    } ${
                      larguras[f.name] ? '' : f.width ? WIDTH_CLASS[f.width] : ''
                    }`}
                    title={`Ordenar por ${f.label}`}
                  >
                    <span
                      draggable={false}
                      onDragStart={(e) => e.preventDefault()}
                      onPointerDown={(e) => iniciarRedimensionamento(e, f.name)}
                      onClick={(e) => e.stopPropagation()}
                      title={`Arrastar para redimensionar ${f.label}`}
                      className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-blue-400/60"
                    />
                    <span className="inline-flex items-center gap-1 justify-center">
                      {f.label}
                      {isSorted &&
                        (dir === 'asc' ? (
                          <ArrowUp className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                        ) : (
                          <ArrowDown className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                        ))}
                    </span>
                  </th>
                );
              })}
              {/* Coluna de sobra: fica com o espaço livre, para que arrastar uma coluna mude mesmo a largura */}
              {comSobra && <th className="w-full border-b border-stone-200 dark:border-stone-800" />}
              <th className={`sticky right-0 z-20 px-3 py-2.5 text-center font-semibold text-stone-600 dark:text-stone-300 ${larguraAcoes} border-b border-l border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950`}>
                Ações
              </th>
            </tr>
          </thead>

          <tbody className={isLoading && rows.length > 0 ? 'opacity-60' : undefined}>
            {isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={colunas.length + 2 + inicioColunas} className="px-3 py-12 text-center">
                  <div className="flex items-center justify-center gap-2 text-stone-500 dark:text-stone-400">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Carregando registros…</span>
                  </div>
                </td>
              </tr>
            )}

            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={colunas.length + 2 + inicioColunas} className="px-3 py-16 text-center">
                  <div className="flex flex-col items-center gap-2 text-stone-400">
                    <Inbox className="w-8 h-8" />
                    <span className="text-sm font-medium text-stone-600 dark:text-stone-300">
                      {search || filtros.length > 0
                        ? 'Nenhum registro corresponde aos filtros informados'
                        : `Nenhum registro em ${resource.label}`}
                    </span>
                    {filtros.length > 0 && (
                      <button
                        onClick={() => setFiltros([])}
                        className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                      >
                        {ehFiltroPadrao(filtros)
                          ? 'Ver também os inativos'
                          : 'Limpar a busca avançada'}
                      </button>
                    )}
                    {resource.canCreate && !search && filtros.length === 0 && (
                      <button
                        onClick={() => abrirAbaNovo()}
                        className="mt-1 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                      >
                        Incluir o primeiro {resource.labelSingular.toLowerCase()}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            )}

            {rows.map((row) => linhaGrade(row))}
          </tbody>
        </table>
      </div>

      {/* Paginação fixa ao pé */}
      {totalPages > 1 && (
        <div className="px-4 py-2.5 border-t border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950/40 flex items-center justify-between gap-3 shrink-0">
          <span className="text-[11px] text-stone-500 dark:text-stone-400">
            Página {page} de {totalPages} ({total.toLocaleString('pt-BR')} {total === 1 ? 'registro' : 'registros'})
          </span>
          <div className="flex items-center gap-1.5">
            {/* Primeira, anterior, próxima e última página */}
            {(
              [
                [ChevronsLeft, 'Primeira página', 1, page <= 1],
                [ChevronLeft, 'Página anterior', Math.max(1, page - 1), page <= 1],
                [ChevronRight, 'Próxima página', Math.min(totalPages, page + 1), page >= totalPages],
                [ChevronsRight, 'Última página', totalPages, page >= totalPages],
              ] as const
            ).map(([Icone, titulo, destino, desabilitado]) => (
              <button
                key={titulo}
                type="button"
                onClick={() => setPage(destino)}
                disabled={desabilitado}
                title={titulo}
                className="p-1.5 rounded-lg border border-stone-300 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
              >
                <Icone className="w-4 h-4" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Mestre-detalhe: grades filhas do registro selecionado */}
      {temGrades && linhaSelecionada && (
        <DetailPanel
          key={recordId(linhaSelecionada)}
          parent={resource}
          parentRow={linhaSelecionada}
          travado={travado?.(linhaSelecionada) ?? null}
          details={resource.details!}
          allResources={allResources}
          parentLabel={recordLabel(linhaSelecionada)}
          refreshToken={refreshToken + versaoDetalhe}
          onClose={() => {
            painelFechado.current = true;
            setSelecionado(null);
          }}
          onOpenResource={onNavigate}
          recolhido={detalheRecolhido}
          onRecolhidoChange={setDetalheRecolhido}
        />
      )}

      {/* Dica exibida enquanto nenhuma linha foi selecionada */}
      {temGrades && !selecionado && rows.length > 0 && (
        <div className="px-4 py-2 border-t border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950/40 text-[11px] text-stone-500 dark:text-stone-400 shrink-0">
          Clique em um {resource.labelSingular.toLowerCase()} para ver{' '}
          {temGrades ? resource.details!.map((d) => d.label.toLowerCase()).join(' e ') : 'os detalhes'} aqui embaixo. Duplo clique
          abre o registro para edição.
        </div>
      )}
    </div>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {abas.length > 0 && tabBar}

      {/* Somente o painel da aba ativa é montado */}
      {abaAtual ? (
        <RecordForm
          key={abaAtual.key}
          resource={resource}
          record={abaAtual.record}
          travado={abaAtual.record ? travado?.(abaAtual.record) : null}
          refOptions={refOptions}
          onAtualizarOpcoes={atualizarOpcoes}
          onCancel={() => fecharAba(abaAtual.key)}
          onSave={(payload) => handleSave(abaAtual, payload)}
          colunasVisiveis={listedFields.map((f) => f.name)}
          onAlternarColuna={alternarColuna}
          camposBusca={camposBuscaAtuais}
          onAlternarBusca={alternarCampoBusca}
          ordemCampos={ordemForm}
          onReordenarCampos={setOrdemForm}
          tamanhosCampos={tamanhosForm}
          onRedimensionarCampo={(campo, tamanho) =>
            setTamanhosForm((atual) => ({ ...atual, [campo]: { ...atual[campo], ...tamanho } }))
          }
          onSalvarLayout={salvarConfiguracao}
          onRestaurarPadrao={() => {
            setTamanhosForm({});
            setOrdemForm([]);
          }}
        />
      ) : (
        listPanel
      )}

      {/* Confirmação de exclusão */}
      {deleting && (
        <ConfirmDialog
          titulo={`Excluir ${resource.labelSingular}?`}
          mensagem={
            <>
              <strong className="text-stone-700 dark:text-stone-200">{recordLabel(deleting)}</strong> será removido
              definitivamente. Esta ação não pode ser desfeita.
            </>
          }
          onConfirmar={handleDelete}
          onCancelar={() => setDeleting(null)}
        />
      )}
    </div>
  );
};

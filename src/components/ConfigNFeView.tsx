import React, { useEffect, useState } from 'react';
import { Loader2, RefreshCw, Save } from 'lucide-react';
import {
  atualizarClassificacoes,
  fetchConfigNFe,
  fetchOptions,
  fetchSeriesNFe,
  invalidateOptions,
  saveConfigNFe,
  type AliquotasUF,
  type ConfigNFe,
  type TabelaClassificacoes,
} from '../services/api';
import { AvisoErro } from './AvisoErro';
import { FIELD_CLASS, HINT_CLASS, INPUT_CLASS, LABEL_CLASS } from '../utils/formStyles';
import { NumberField } from './NumberField';
import { SelectBusca } from './SelectBusca';
import { Toggle } from './Toggle';
import type { OpcaoRef } from '../types';

type Opcoes = [string, string][];

const PRESENCIAL: Opcoes = [
  ['1', '1 - Operação presencial'],
  ['2', '2 - Internet'],
  ['3', '3 - Teleatendimento'],
  ['4', '4 - Entrega em domicílio'],
  ['5', '5 - Presencial, fora do estabelecimento'],
  ['9', '9 - Outros'],
];
const FORMAS: Opcoes = [
  ['01', '01 - Dinheiro'],
  ['02', '02 - Cheque'],
  ['03', '03 - Cartão de crédito'],
  ['04', '04 - Cartão de débito'],
  ['05', '05 - Crédito loja'],
  ['10', '10 - Vale alimentação'],
  ['11', '11 - Vale refeição'],
  ['12', '12 - Vale presente'],
  ['13', '13 - Vale combustível'],
  ['15', '15 - Boleto bancário'],
  ['16', '16 - Depósito bancário'],
  ['17', '17 - PIX'],
  ['18', '18 - Transferência / carteira digital'],
  ['19', '19 - Fidelidade / cashback'],
  ['90', '90 - Sem pagamento'],
  ['99', '99 - Outros'],
];

interface Props {
  onToast: (msg: string) => void;
}

/** Regras fiscais da NF-e do romaneio, gravadas em sys_empresas.config (chave "nfe") */
export const ConfigNFeView: React.FC<Props> = ({ onToast }) => {
  const [config, setConfig] = useState<ConfigNFe | null>(null);
  const [nfeweb, setNfeweb] = useState(true);
  const [ufEmitente, setUfEmitente] = useState('');
  const [ufs, setUfs] = useState<string[]>([]);
  const [grupos, setGrupos] = useState<Opcoes>([]);
  const [classes, setClasses] = useState<Opcoes>([]);
  /** CFOP da tabela oficial, por recurso (cfops_dentro_uf: 5xxx, cfops_fora_uf: 6xxx) */
  const [cfops, setCfops] = useState<Record<string, OpcaoRef[]>>({});
  /** Séries ativas no BMNFe (null = ainda lendo ou não veio) */
  const [series, setSeries] = useState<Opcoes | null>(null);
  const [erroSeries, setErroSeries] = useState<string | null>(null);
  const [tabela, setTabela] = useState<TabelaClassificacoes>(null);
  const [atualizando, setAtualizando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const lerClasses = () =>
    fetchOptions('classificacoes_tributarias', 'nome')
      .then((l) => setClasses(l.map((o) => [String(o.value), `${o.value} - ${o.label}`])))
      .catch(() => setClasses([]));

  useEffect(() => {
    fetchConfigNFe()
      .then((r) => {
        setConfig(r.config);
        setNfeweb(r.nfeweb);
        setUfEmitente(r.ufEmitente || '');
        setUfs(r.ufs || []);
        setTabela(r.classificacoes);
      })
      .catch((err) => setErro(err.message || 'Falha ao ler a configuração.'));
    fetchOptions('grupos_tributarios', 'descricao')
      .then((l) => setGrupos(l.map((o) => [String(o.value), o.label])))
      .catch(() => setGrupos([]));
    lerClasses();
    fetchSeriesNFe()
      .then((r) => setSeries(r.series.map((s) => [String(s.serie), s.descricao ? `${s.serie} - ${s.descricao}` : String(s.serie)])))
      .catch((err) => setErroSeries(err.message || 'falha ao consultar'));
    for (const r of ['cfops_dentro_uf', 'cfops_fora_uf']) {
      fetchOptions(r, 'titulo')
        .then((l) => setCfops((c) => ({ ...c, [r]: l })))
        .catch(() => {});
    }
  }, []);

  if (!config) {
    return (
      <div className="py-24 text-center text-sm text-stone-500 dark:text-stone-400">
        {erro || <Loader2 className="w-5 h-5 animate-spin inline" />}
      </div>
    );
  }

  const set = (k: string, v: string | number | boolean) => setConfig({ ...config, [k]: v });
  const setDifal = (uf: string, k: keyof AliquotasUF, v: number) =>
    setConfig({ ...config, difal: { ...config.difal, [uf]: { interestadual: 0, interna: 0, fcp: 0, ...config.difal?.[uf], [k]: v } } });

  const rotulo = (k: string, texto: string, dica?: string, el?: React.ReactNode, span = '') => (
    <div className={`${FIELD_CLASS} ${span}`}>
      <label htmlFor={`nfe-${k}`} className={LABEL_CLASS}>
        {texto}
      </label>
      {el}
      {dica && <span className={HINT_CLASS}>{dica}</span>}
    </div>
  );

  const texto = (k: string, nome: string, o: { dica?: string; max?: number; required?: boolean; span?: string } = {}) =>
    rotulo(
      k,
      nome,
      o.dica,
      <input
        id={`nfe-${k}`}
        type="text"
        required={o.required}
        maxLength={o.max}
        autoFocus={k === 'naturezaOperacao' && !config.naturezaOperacao}
        value={String(config[k] ?? '')}
        onChange={(e) => set(k, e.target.value)}
        onFocus={(e) => e.target.select()}
        className={`${INPUT_CLASS} w-full`}
      />,
      o.span,
    );

  const lista = (k: string, nome: string, opcoes: Opcoes, o: { dica?: string; required?: boolean; span?: string } = {}) =>
    rotulo(
      k,
      nome,
      o.dica,
      <select id={`nfe-${k}`} required={o.required} value={String(config[k] ?? '')} onChange={(e) => set(k, e.target.value)} className={`${INPUT_CLASS} w-full`}>
        {o.required && !config[k] && <option value="">Escolha…</option>}
        {opcoes.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>,
      o.span,
    );

  // CFOP gravado fora da lista (tabela não criada, fora de vigência): aparece marcado, não some
  const cfop = (k: string, nome: string, recurso: string, dica: string) => {
    const v = String(config[k] ?? '');
    const opcoes = cfops[recurso] || [];
    return rotulo(
      k,
      nome,
      dica,
      <SelectBusca
        id={`nfe-${k}`}
        value={v}
        options={v && !opcoes.some((o) => o.value === v) ? [{ value: v, label: '(não está na tabela oficial)' }, ...opcoes] : opcoes}
        onChange={(x) => set(k, x)}
        required
        vazioLabel="— Selecione —"
        className={`${INPUT_CLASS} w-full`}
      />,
      'sm:col-span-2',
    );
  };

  // Série das séries ativas no BMNFe; a gravada que não está entre elas aparece marcada, não some
  const serie = () => {
    const v = String(config.serie ?? '');
    const opcoes = series ?? [];
    const todas: Opcoes = v && !opcoes.some(([s]) => s === v) ? [[v, series ? `${v} (não está ativa no BMNFe)` : v], ...opcoes] : opcoes;
    return rotulo(
      'serie',
      'Série',
      erroSeries ? `Não foi possível ler as séries do BMNFe: ${erroSeries}` : 'Séries ativas no BMNFe (menu Séries de lá)',
      <select id="nfe-serie" required value={v} onChange={(e) => set('serie', Number(e.target.value))} className={`${INPUT_CLASS} w-full`}>
        {!v && <option value="">Escolha…</option>}
        {todas.map(([s, l]) => (
          <option key={s} value={s}>
            {l}
          </option>
        ))}
      </select>,
    );
  };

  const numero = (k: string, nome: string, scale = 4, dica = '%') =>
    rotulo(k, nome, dica, <NumberField id={`nfe-${k}`} value={config[k] as number} scale={scale} onChange={(v) => set(k, v === '' ? 0 : Number(v))} />);

  const secao = (titulo: string) => <h3 className="col-span-full pt-2 text-xs font-bold uppercase tracking-wide text-stone-400 dark:text-stone-500">{titulo}</h3>;

  const atualizarTabela = async () => {
    setAtualizando(true);
    setErro(null);
    try {
      const { total } = await atualizarClassificacoes();
      invalidateOptions('classificacoes_tributarias');
      await lerClasses();
      setTabela((await fetchConfigNFe()).classificacoes);
      onToast(`Tabela oficial atualizada: ${total} classificações.`);
    } catch (err: any) {
      setErro(err.message || 'Falha ao atualizar a tabela oficial.');
    } finally {
      setAtualizando(false);
    }
  };

  // Classificação gravada que saiu da lista (fora de vigência, tabela não carregada): aparece marcada, não some
  const cClass = String(config.ibscbsClassificacao ?? '');
  const opcoesClasse: Opcoes = cClass && !classes.some(([v]) => v === cClass) ? [[cClass, `${cClass} (não está na tabela oficial)`], ...classes] : classes;

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      const r = await saveConfigNFe(config);
      setConfig(r.config);
      onToast('Configuração da NF-e salva.');
    } catch (err: any) {
      setErro(err.message || 'Falha ao salvar.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <form onSubmit={salvar} className="flex-1 flex flex-col min-h-0 bg-white dark:bg-stone-900">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl px-5 py-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-3">
          {!nfeweb && (
            <div className="col-span-full p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-300">
              O servidor ainda não tem o endereço do BMNFe (BMNFE_URL no .env): dá para configurar, mas o "Gerar NFe" não vai conseguir criar a nota.
            </div>
          )}

          {secao('Nota')}
          {texto('naturezaOperacao', 'Natureza da operação', { max: 60, required: true, span: 'sm:col-span-2' })}
          {serie()}
          {lista('presencial', 'Indicação de presença', PRESENCIAL, { required: true })}
          {lista('formaPagamento', 'Forma de pagamento', FORMAS, { required: true, span: 'sm:col-span-2' })}
          {cfop('cfopDentroUF', 'CFOP dentro da UF', 'cfops_dentro_uf', `Cliente em ${ufEmitente || 'sua UF'}; o grupo do produto pode trocar`)}
          {cfop('cfopForaUF', 'CFOP para outra UF', 'cfops_fora_uf', 'Cliente de outra UF; o grupo do produto pode trocar')}

          {secao('Tributação dos produtos')}
          {lista('grupoPadraoId', 'Grupo tributário padrão', [['0', '(nenhum)'], ...grupos], {
            dica: 'Para o produto sem grupo tributário. ICMS, PIS/COFINS e origem vêm do grupo (menu Grupos tributários).',
            span: 'sm:col-span-2',
          })}

          {secao('IBS e CBS (reforma tributária)')}
          <div className="col-span-full">
            <Toggle id="nfe-ibscbs" checked={Boolean(config.ibscbs)} onChange={(v) => set('ibscbs', v)} label="Destacar IBS e CBS na nota" />
          </div>
          {config.ibscbs && (
            <>
              {lista('ibscbsClassificacao', 'Classificação tributária padrão (cClassTrib)', opcoesClasse, {
                required: true,
                dica: 'O CST e a redução das alíquotas saem dela; o grupo do produto pode trocar',
                span: 'col-span-full',
              })}
              <div className="col-span-full flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={atualizarTabela}
                  disabled={atualizando}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-stone-600 dark:text-stone-300 border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer disabled:opacity-40"
                >
                  {atualizando ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  <span>{atualizando ? 'Baixando…' : 'Atualizar pela tabela oficial'}</span>
                </button>
                <span className={HINT_CLASS}>
                  {!tabela
                    ? 'Falta criar a tabela fis_classificacao_tributaria no banco.'
                    : tabela.total
                      ? `Tabela do Informe Técnico 2025.002 (API da SVRS, pelo BMNFe com o certificado da empresa): ${tabela.total} classificações, atualizada em ${tabela.atualizadoEm}. A lista mostra as que a nota do romaneio monta.`
                      : 'Tabela oficial ainda não carregada.'}
                </span>
              </div>
              {numero('aliquotaIBSUF', 'IBS estadual')}
              {numero('aliquotaIBSMun', 'IBS municipal')}
              {numero('aliquotaCBS', 'CBS')}
            </>
          )}

          {secao('DIFAL (venda a não contribuinte de outra UF)')}
          <div className="col-span-full flex flex-col gap-1">
            <span className={HINT_CLASS}>
              Preencha só as UFs para onde vende a não contribuinte (CPF ou empresa sem IE). UF em branco: a nota para ela fica pendente.
            </span>
            <table className="w-fit text-xs">
              <thead className="text-stone-500 dark:text-stone-400">
                <tr>
                  {['UF', 'Interestadual', 'Interna (%)', 'FCP (%)'].map((t) => (
                    <th key={t} className="px-2 py-1.5 text-center font-semibold">
                      {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ufs.map((uf) => {
                  const a = config.difal?.[uf];
                  return (
                    <tr key={uf}>
                      <td className="px-2 py-1 text-center font-semibold">{uf}</td>
                      <td className="px-2 py-1">
                        <select
                          aria-label={`Alíquota interestadual para ${uf}`}
                          value={String(a?.interestadual || '')}
                          onChange={(e) => setDifal(uf, 'interestadual', Number(e.target.value))}
                          className={`${INPUT_CLASS} w-24`}
                        >
                          <option value="" />
                          {[4, 7, 12].map((v) => (
                            <option key={v} value={v}>
                              {v}%
                            </option>
                          ))}
                        </select>
                      </td>
                      {(['interna', 'fcp'] as const).map((k) => (
                        <td key={k} className="px-2 py-1 w-28">
                          <NumberField value={a?.[k] || ''} scale={2} onChange={(v) => setDifal(uf, k, v === '' ? 0 : Number(v))} />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {secao('Informações complementares')}
          {rotulo(
            'informacoesComplementares',
            'Texto fixo da nota',
            'O número do romaneio, o pedido e a placa entram sozinhos depois deste texto.',
            <textarea
              id="nfe-informacoesComplementares"
              rows={3}
              maxLength={2000}
              value={String(config.informacoesComplementares ?? '')}
              onChange={(e) => set('informacoesComplementares', e.target.value)}
              className={`${INPUT_CLASS} w-full resize-y`}
            />,
            'col-span-full',
          )}

          {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}
        </div>
      </div>

      <div className="px-5 py-3 border-t border-stone-200 dark:border-stone-800 flex items-center justify-between gap-2.5 bg-stone-50 dark:bg-stone-950/40 shrink-0">
        <span className="text-[11px] text-stone-500 dark:text-stone-400 truncate">Gravado em sys_empresas.config (chave nfe)</span>
        <button
          type="submit"
          disabled={salvando}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white shadow-xs transition-all cursor-pointer disabled:opacity-50"
        >
          {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          <span>{salvando ? 'Salvando…' : 'Salvar'}</span>
        </button>
      </div>
    </form>
  );
};

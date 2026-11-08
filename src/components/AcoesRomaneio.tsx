import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, FileText, Mail, Printer, Receipt, Send } from 'lucide-react';
import { RegistroCrud } from '../types';
import {
  concluirRomaneio,
  dadosEmailRomaneio,
  danfeRomaneio,
  enviarEmailRomaneio,
  enviarNFeSefaz,
  gerarNFeRomaneio,
  impressaoRomaneio,
  previaNFe,
  type EmailRomaneio,
  type NFeGerada,
  type PreviaNFe,
} from '../services/api';
import { BotaoAcao } from './MenuAcoes';
import { ConfirmDialog } from './ConfirmDialog';
import { AvisoErro } from './AvisoErro';
import { FIELD_CLASS, INPUT_CLASS, LABEL_CLASS } from '../utils/formStyles';
import { formatDecimalBR } from '../utils/formatters';

/**
 * Diálogo no body: dentro do menu "..." (que fecha ao escolher) ou da célula fixa da coluna Ações ele sumiria.
 * O span segura os cliques, que no React sobem até a linha mesmo pelo portal.
 */
const noBody = (conteudo: React.ReactNode) =>
  createPortal(
    <span onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      {conteudo}
    </span>,
    document.body,
  );

interface Props {
  row: RegistroCrud;
  recarregar: () => void;
  onToast: (msg: string) => void;
}

/** modFrete da NF-e */
const FRETES: [string, string][] = [
  ['0', '0 - Por conta do emitente (CIF)'],
  ['1', '1 - Por conta do destinatário (FOB)'],
  ['2', '2 - Por conta de terceiros'],
  ['9', '9 - Sem frete'],
];

/** Tributos devolvidos pelo nfeWeb, na ordem em que aparecem no resultado */
const TRIBUTOS: [string, string][] = [
  ['vICMS', 'ICMS'],
  ['vPIS', 'PIS'],
  ['vCOFINS', 'COFINS'],
  ['vIBSUF', 'IBS estadual'],
  ['vIBSMun', 'IBS municipal'],
  ['vCBS', 'CBS'],
  ['vICMSUFDest', 'DIFAL (UF de destino)'],
  ['vFCPUFDest', 'FCP (UF de destino)'],
];

const celula = 'px-2 py-1.5 border-b border-stone-100 dark:border-stone-800';

/** Botões do romaneio (os do ufrmRomaneio do Delphi): Imprimir, Concluir e e-Mail, mais Gerar NFe, Enviar SEFAZ e Imprimir NFe */
export const AcoesRomaneio: React.FC<Props> = ({ row, recarregar, onToast }) => {
  const [concluindo, setConcluindo] = useState(false);
  const [enviandoSefaz, setEnviandoSefaz] = useState(false);
  const [email, setEmail] = useState<EmailRomaneio | null>(null);
  const [lendoEmail, setLendoEmail] = useState(false);
  const [nfe, setNfe] = useState<PreviaNFe | null>(null);
  const [lendoNfe, setLendoNfe] = useState(false);
  const [frete, setFrete] = useState('');
  const [gerada, setGerada] = useState<NFeGerada | null>(null);
  /** Aviso no canto: erro (vermelho) ou alerta (âmbar, a ação não cabe na situação da NF-e) */
  const [aviso, setAviso] = useState<{ mensagem: string; tom: 'erro' | 'alerta' } | null>(null);
  const falhar = (err: any, padrao: string) => setAviso({ mensagem: err?.message || padrao, tom: 'erro' });
  const alertar = (mensagem: string) => setAviso({ mensagem, tom: 'alerta' });

  // Situação da NF-e que a lista já traz (coluna NF-e): as opções avisam na hora, e o servidor confere de novo.
  // Rascunho = a geração não terminou; rejeitada = corrige e gera de novo (a mesma regra do nfeGerada do servidor)
  const situacaoNfe = row.nfe_situacao ? String(row.nfe_situacao) : '';
  const semNfe = !situacaoNfe || situacaoNfe === 'rascunho';
  const nfeGerada = !semNfe && situacaoNfe !== 'rejeitada';
  const SEM_NFE = `O romaneio ${row.id} ainda não tem NF-e: use o Gerar NFe.`;

  /** A janela abre já no clique (senão o navegador bloqueia como popup) e recebe o HTML depois */
  const imprimir = async () => {
    const janela = window.open('', '_blank');
    if (!janela) return alertar('O navegador bloqueou a janela de impressão: libere os popups deste site.');
    janela.document.write('<p style="font-family:sans-serif">Gerando o romaneio…</p>');
    try {
      const html = await impressaoRomaneio(row.id);
      janela.document.open();
      janela.document.write(html);
      janela.document.close();
    } catch (err: any) {
      janela.close();
      falhar(err, 'Falha ao gerar a impressão.');
    }
  };

  /** DANFE do BMNFe: mesma ideia do imprimir (janela aberta no clique), recebendo o PDF */
  const imprimirNfe = async () => {
    if (semNfe) return alertar(SEM_NFE);
    const janela = window.open('', '_blank');
    if (!janela) return alertar('O navegador bloqueou a janela do DANFE: libere os popups deste site.');
    janela.document.write('<p style="font-family:sans-serif">Buscando o DANFE no BMNFe…</p>');
    try {
      const url = URL.createObjectURL(await danfeRomaneio(row.id));
      janela.location.href = url;
      // O objeto só pode ser liberado depois que a janela carregou
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err: any) {
      janela.close();
      falhar(err, 'Falha ao buscar o DANFE.');
    }
  };

  const abrirEmail = async () => {
    setLendoEmail(true);
    try {
      setEmail(await dadosEmailRomaneio(row.id));
    } catch (err: any) {
      falhar(err, 'Falha ao preparar o e-mail.');
    } finally {
      setLendoEmail(false);
    }
  };

  const abrirNfe = async () => {
    if (nfeGerada) return alertar(`O romaneio ${row.id} já tem NF-e gerada (${situacaoNfe}).`);
    setLendoNfe(true);
    try {
      const previa = await previaNFe(row.id);
      // Sem transportador no romaneio o comum é "sem frete"; com ele, quem decide é o usuário
      setFrete(previa.temTransportador ? '' : '9');
      setNfe(previa);
    } catch (err: any) {
      falhar(err, 'Falha ao preparar a NF-e.');
    } finally {
      setLendoNfe(false);
    }
  };

  const abrirEnvio = () => {
    if (semNfe) return alertar(SEM_NFE);
    if (!['assinada', 'rejeitada'].includes(situacaoNfe)) return alertar(`A NF-e do romaneio ${row.id} já está ${situacaoNfe}: não há o que enviar.`);
    setEnviandoSefaz(true);
  };

  const campoEmail = (k: 'para' | 'assunto' | 'mensagem', rotulo: string) => (
    <div className={FIELD_CLASS}>
      <label htmlFor={`email-${k}`} className={LABEL_CLASS}>
        {rotulo}
      </label>
      {k === 'mensagem' ? (
        <textarea
          id={`email-${k}`}
          rows={4}
          value={email![k]}
          onChange={(e) => setEmail({ ...email!, [k]: e.target.value })}
          className={`${INPUT_CLASS} w-full resize-y`}
        />
      ) : (
        <input
          id={`email-${k}`}
          type={k === 'para' ? 'email' : 'text'}
          required
          autoFocus={k === 'para' && !email!.para}
          value={email![k]}
          onChange={(e) => setEmail({ ...email!, [k]: e.target.value })}
          onFocus={(e) => e.target.select()}
          className={`${INPUT_CLASS} w-full`}
        />
      )}
    </div>
  );

  return (
    <>
      <BotaoAcao icone={Printer} titulo="Imprimir" descricao="Abre o romaneio para imprimir ou salvar em PDF" onClick={imprimir} />
      {row.status !== 'C' && (
        <BotaoAcao icone={CheckCircle2} titulo="Concluir" descricao="Trava o romaneio e lança a entrada e a saída no estoque" tom="verde" onClick={() => setConcluindo(true)} />
      )}
      <BotaoAcao icone={Mail} titulo="e-Mail" descricao="Envia o romaneio em PDF por e-mail" carregando={lendoEmail} onClick={abrirEmail} />
      <BotaoAcao icone={FileText} titulo="Gerar NFe" descricao="Cria a NF-e no BMNFe, com os tributos calculados, pronta para enviar" carregando={lendoNfe} onClick={abrirNfe} />
      <BotaoAcao icone={Send} titulo="Enviar SEFAZ" descricao="Transmite à SEFAZ a NF-e já gerada deste romaneio" onClick={abrirEnvio} />
      <BotaoAcao icone={Receipt} titulo="Imprimir NFe" descricao="Abre o DANFE da NF-e deste romaneio, gerado no BMNFe" onClick={imprimirNfe} />

      {aviso && noBody(<AvisoErro mensagem={aviso.mensagem} tom={aviso.tom} onFechar={() => setAviso(null)} />)}

      {enviandoSefaz &&
        noBody(
          <ConfirmDialog
            titulo={`Enviar a NF-e do romaneio ${row.id} à SEFAZ?`}
            mensagem="A nota gerada no BMNFe vai para a SEFAZ, no ambiente configurado lá. Depois de autorizada ela não pode mais ser alterada, só cancelada."
            confirmar="Enviar"
            tom="normal"
            onConfirmar={async () => {
              const r = await enviarNFeSefaz(row.id);
              recarregar();
              if (r.situacao === 'autorizada' || r.situacao === 'enviada') {
                setEnviandoSefaz(false);
                return onToast(
                  r.situacao === 'autorizada'
                    ? `NF-e ${r.numero} autorizada pela SEFAZ (protocolo ${r.protocolo}).`
                    : `NF-e ${r.numero} enviada: a SEFAZ ainda está processando. Acompanhe na coluna NF-e.`,
                );
              }
              throw new Error(`A SEFAZ não autorizou a NF-e ${r.numero}: ${r.cStat ? `${r.cStat} - ` : ''}${r.motivo || r.situacao}`);
            }}
            onCancelar={() => setEnviandoSefaz(false)}
          />,
        )}

      {nfe &&
        noBody(
          <ConfirmDialog
            titulo={`Gerar a NF-e do romaneio ${row.id}`}
            mensagem="O BMNFe numera, calcula os tributos e assina a nota. Ela não vai para a SEFAZ agora: o envio é feito no BMNFe."
            confirmar="Gerar NF-e"
            tom="normal"
            onConfirmar={async () => {
              if (nfe.pendencias.length) throw new Error('Resolva as pendências acima antes de gerar a nota.');
              if (!frete) throw new Error('Escolha a modalidade do frete.');
              const r = await gerarNFeRomaneio(row.id, frete);
              setNfe(null);
              setGerada(r);
              // A coluna NF-e da lista passa a mostrar a nota
              recarregar();
            }}
            onCancelar={() => setNfe(null)}
          >
            <div className="flex flex-col gap-3">
              <table className="w-full text-xs">
                <thead className="text-stone-500 dark:text-stone-400">
                  <tr>
                    <th className={`${celula} text-center font-semibold`}>Produto</th>
                    <th className={`${celula} text-center font-semibold`}>Un.</th>
                    <th className={`${celula} text-center font-semibold`}>Qtde</th>
                    <th className={`${celula} text-center font-semibold`}>Preço</th>
                    <th className={`${celula} text-center font-semibold`}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {nfe.itens.map((i) => (
                    <tr key={i.codigo}>
                      <td className={`${celula} max-w-40 truncate`} title={`${i.codigo} - ${i.descricao}`}>
                        {i.descricao}
                      </td>
                      <td className={`${celula} text-center`}>{i.unidade}</td>
                      <td className={`${celula} text-right`}>{formatDecimalBR(i.quantidade, 4)}</td>
                      <td className={`${celula} text-right`}>{formatDecimalBR(i.valorUnitario, 4)}</td>
                      <td className={`${celula} text-right`}>{formatDecimalBR(i.valorTotal, 2)}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td className="px-2 py-1.5" colSpan={4}>
                      Total dos produtos
                    </td>
                    <td className="px-2 py-1.5 text-right">{formatDecimalBR(nfe.itens.reduce((s, i) => s + i.valorTotal, 0), 2)}</td>
                  </tr>
                </tbody>
              </table>

              {nfe.pendencias.length > 0 && (
                <ul className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-300 list-disc pl-7 space-y-0.5">
                  {nfe.pendencias.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}

              <div className={FIELD_CLASS}>
                <label htmlFor="nfe-frete" className={LABEL_CLASS}>
                  Frete
                </label>
                <select id="nfe-frete" required value={frete} onChange={(e) => setFrete(e.target.value)} className={`${INPUT_CLASS} w-full`}>
                  {!frete && <option value="">Escolha…</option>}
                  {FRETES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </ConfirmDialog>,
        )}

      {gerada &&
        noBody(
          <ConfirmDialog
            titulo={`NF-e ${gerada.numero}, série ${gerada.serie}`}
            mensagem={
              gerada.repetida
                ? `Esta nota já existia no BMNFe e está ${gerada.situacao}: nada foi alterado.`
                : 'Nota gerada e assinada no BMNFe. Para mandá-la à SEFAZ, use o Enviar da nota no BMNFe.'
            }
            confirmar="Fechar"
            tom="normal"
            semCancelar
            onConfirmar={() => setGerada(null)}
            onCancelar={() => setGerada(null)}
          >
            {gerada.totais && (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <dt className="text-stone-500">Produtos</dt>
                <dd className="text-right">{formatDecimalBR(gerada.totais.vProd, 2)}</dd>
                {TRIBUTOS.filter(([k]) => gerada.totais![k]).map(([k, nome]) => (
                  <React.Fragment key={k}>
                    <dt className="text-stone-500">{nome}</dt>
                    <dd className="text-right">{formatDecimalBR(gerada.totais![k], 2)}</dd>
                  </React.Fragment>
                ))}
                <dt className="font-semibold">Total da nota</dt>
                <dd className="text-right font-semibold">{formatDecimalBR(gerada.totais.vNF, 2)}</dd>
              </dl>
            )}
          </ConfirmDialog>,
        )}

      {concluindo &&
        noBody(
          <ConfirmDialog
            titulo={`Concluir o romaneio ${row.id}?`}
            mensagem="Concluir o Romaneio? (Não será mais possível sua alteração!)"
            confirmar="Concluir"
            tom="normal"
            onConfirmar={async () => {
              await concluirRomaneio(row.id);
              setConcluindo(false);
              onToast(`Romaneio ${row.id} concluído.`);
              recarregar();
            }}
            onCancelar={() => setConcluindo(false)}
          />,
        )}

      {email &&
        noBody(
          <ConfirmDialog
            titulo={`Enviar o romaneio ${row.id} por e-mail`}
            mensagem={`O romaneio vai em anexo (${email.anexo || 'PDF'}).`}
            confirmar="Enviar"
            tom="normal"
            onConfirmar={async () => {
              if (!/^\S+@\S+\.\S+$/.test(email.para.trim())) throw new Error('Informe um e-mail válido em Para.');
              await enviarEmailRomaneio(row.id, email);
              setEmail(null);
              onToast(`Romaneio ${row.id} enviado para ${email.para}.`);
            }}
            onCancelar={() => setEmail(null)}
          >
            <div className="flex flex-col gap-3">
              {campoEmail('para', 'Para')}
              {campoEmail('assunto', 'Assunto')}
              {campoEmail('mensagem', 'Mensagem')}
            </div>
          </ConfirmDialog>,
        )}
    </>
  );
};

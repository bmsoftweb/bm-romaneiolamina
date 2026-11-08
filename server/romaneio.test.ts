import assert from 'node:assert/strict';

// Só funções puras: o teste não precisa do banco (o pool não conecta enquanto não houver consulta)
for (const nome of ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD']) process.env[nome] ||= 'teste';
const { calcularM3, cpfCnpjValido, distribuirPeps, documentoRomaneio, errosDoItem } = await import('./romaneio.js');

// m3 = (esp / conversão da espessura) × largura × comprimento × (1 − perda/100) × qtdade
// 2,5 mm ÷ 1000 × 1,20 × 2,50 × 0,95 × 100 = 0,7125
const item = { espessura: 2.5, largura: 1.2, comprimento: 2.5, perda: 5, qtdade: 100 };
assert.equal(calcularM3(item, 1000), 0.7125);
assert.equal(calcularM3({ ...item, perda: 0 }, 1000), 0.75);

const ok = { ...item, pilha: 1, id_maq: 0 };
assert.deepEqual(errosDoItem(ok, 1000, false), []);
assert.deepEqual(errosDoItem({ ...ok, qtdade: 0 }, 1000, false), ['Quantidade deve ser maior que zero']);
assert.deepEqual(errosDoItem({ ...ok, id_maq: 7 }, 1000, false), ['Código da máquina não encontrado!']);
assert.equal(errosDoItem(ok, 0, false).length, 1);

assert.equal(documentoRomaneio(123), 'ROM/00123');

// PEPS da tora: lote mais antigo primeiro; o que faltar fica negativo no mais novo
const lotes = [{ id: 1, saldo: 0.5 }, { id: 2, saldo: 0 }, { id: 3, saldo: 1 }];
assert.deepEqual(distribuirPeps(lotes, 0.3), [{ lote: 1, quantidade: 0.3 }]);
assert.deepEqual(distribuirPeps(lotes, 1.2), [{ lote: 1, quantidade: 0.5 }, { lote: 3, quantidade: 0.7 }]);
assert.deepEqual(distribuirPeps(lotes, 2.1), [{ lote: 1, quantidade: 0.5 }, { lote: 3, quantidade: 1.6 }]);
assert.deepEqual(distribuirPeps([{ id: 1, saldo: 2 }, { id: 2, saldo: -1 }], 3), [{ lote: 1, quantidade: 2 }, { lote: 2, quantidade: 1 }]);
assert.deepEqual(distribuirPeps([{ id: 9, saldo: 0 }], 0.71253), [{ lote: 9, quantidade: 0.7125 }]);

// CPF/CNPJ: dígitos verificadores
assert.equal(cpfCnpjValido('52998224725'), true);
assert.equal(cpfCnpjValido('52998224726'), false);
assert.equal(cpfCnpjValido('11444777000161'), true);
assert.equal(cpfCnpjValido('11444777000162'), false);
assert.equal(cpfCnpjValido('12ABC34501DE35'), true);
assert.equal(cpfCnpjValido('12ABC34501DE36'), false);
assert.equal(cpfCnpjValido('12ABC34501DEAB'), false);
assert.equal(cpfCnpjValido('11111111111'), false);
assert.equal(cpfCnpjValido('123'), false);

// NF-e: 2,67912 m³ a 850,00 → qCom 2,6791 (4 casas); CFOP e idDest pela UF do cliente
const { CONFIG_PADRAO, montarDocumento, referenciaNFe } = await import('./nfe.js');
const config = {
  ...CONFIG_PADRAO,
  naturezaOperacao: 'VENDA',
  presencial: '9',
  formaPagamento: '15',
  cfopDentroUF: '5101',
  cfopForaUF: '6101',
};
const grupo = { id: 1, descricao: 'LAMINAS', origem: '0', csosn: '102', aliquota_credito_sn: 0, cst_pis: '49', aliquota_pis: 0, cst_cofins: '49', aliquota_cofins: 0 };
const cliente = {
  nome: 'CLIENTE TESTE',
  cpf_cnpj: '11444777000161',
  ind_ie_dest: '9',
  logradouro: 'RUA A',
  numero: '10',
  bairro: 'CENTRO',
  cidade_ibge: '4205407',
  cidade_nome: 'FLORIANOPOLIS',
  cidade_uf: 'SC',
  cep: '88000000',
};
const nota = {
  romaneio: { id: 123, pedido: '55', placa_transp: 'abc1d23' },
  itens: [{ id_produto: 47, espessura: 1.8, un_espessura: 'mm', largura: 1.22, comprimento: 2.44, m3: 2.67912 }],
  produtos: { 47: { sku: '2081', nome: 'LAMINA', ncm: '44083990', preco_venda: 850, sigla: 'M3', grupo_tributario_id: 1 as number | null } },
  grupos: { 1: grupo, 2: { ...grupo, id: 2, descricao: 'TORAS', origem: '1', cfop_dentro_uf: '5102', cclass_trib: '200030' } } as Record<number, any>,
  // Tabela oficial: 200030 reduz IBS e CBS em 60%; 620001 (monofásica) a nota do romaneio não monta
  classificacoes: {
    '000001': { cst: '000', reducao: 0, usavel: true },
    '200030': { cst: '200', reducao: 60, usavel: true },
    '620001': { cst: '620', reducao: 0, usavel: false },
  } as Record<string, any>,
  destinatario: cliente,
  transportador: { nome: 'TRANSP', cpf_cnpj: '52998224725' },
  config,
  ufEmitente: 'SC',
  modalidadeFrete: 9,
};
const { documento, pendencias } = montarDocumento(nota);
assert.deepEqual(pendencias, []);
assert.equal(documento.itens[0]!.quantidade, 2.6791);
assert.equal(documento.itens[0]!.descricao, 'LAMINA 1,800 MM X 1,220 X 2,440');
// Nome longo: corta o nome, não as medidas (xProd tem 120)
const longo = montarDocumento({ ...nota, produtos: { 47: { ...nota.produtos[47], nome: 'X'.repeat(130) } } }).documento.itens[0]!.descricao;
assert.ok(longo.length <= 120 && longo.endsWith(' 1,800 MM X 1,220 X 2,440'));
assert.equal(documento.itens[0]!.cfop, '5101');
assert.equal(documento.ide.idDestino, 1);
assert.equal(documento.ide.consumidorFinal, 1);
assert.equal((documento.destinatario as any).cnpj, '11444777000161');
assert.equal(documento.transporte.transportadora, undefined);
assert.equal(documento.informacoesAdicionais.contribuinte, 'ROMANEIO 000123 - PEDIDO 55 - PLACA ABC1D23');
assert.deepEqual(documento.itens[0]!.imposto.pis, { cst: '49' });
assert.equal(documento.itens[0]!.imposto.csosn, '102');
assert.deepEqual(documento.itens[0]!.imposto.ibscbs, { cst: '000', classificacao: '000001', aliquotaIBSUF: 0.1, aliquotaIBSMun: 0, aliquotaCBS: 0.9 });

// Grupo tributário: o do produto; sem grupo, o padrão da configuração; sem nenhum, pendência
const lamina = nota.produtos[47];
const comGrupo2 = montarDocumento({ ...nota, produtos: { 47: { ...lamina, grupo_tributario_id: 2 } } }).documento.itens[0]!;
assert.equal(comGrupo2.cfop, '5102');
assert.equal(comGrupo2.imposto.origem, 1);
// CST e redução saem da classificação (200030: 60%)
assert.deepEqual([comGrupo2.imposto.ibscbs?.cst, comGrupo2.imposto.ibscbs?.classificacao, comGrupo2.imposto.ibscbs?.reducao], ['200', '200030', 60]);
const comClasse = (cclass_trib: string) => montarDocumento({ ...nota, grupos: { 1: { ...grupo, cclass_trib } } }).pendencias;
assert.deepEqual(comClasse('999999'), [
  'Classificação tributária 999999 não está na tabela oficial (Configuração da NF-e, "Atualizar pela tabela oficial").',
]);
assert.deepEqual(comClasse('620001'), ['Classificação tributária 620001 não serve para a nota do romaneio: escolha outra.']);
// Sem IBS/CBS na configuração, a classificação não é conferida
assert.deepEqual(montarDocumento({ ...nota, config: { ...config, ibscbs: false }, grupos: { 1: { ...grupo, cclass_trib: '999999' } } }).pendencias, []);
const semGrupo = { ...nota, produtos: { 47: { ...lamina, grupo_tributario_id: null } } };
assert.match(montarDocumento(semGrupo).pendencias.join(), /sem grupo tributário/);
assert.deepEqual(montarDocumento({ ...semGrupo, config: { ...config, grupoPadraoId: 2 } }).pendencias, []);
// PIS/COFINS: só os CST da lista (o 03, por unidade de medida, a nota do romaneio não monta)
const grupoRuim = montarDocumento({ ...nota, grupos: { 1: { ...grupo, csosn: null, cst_pis: '', cst_cofins: '03' } } }).pendencias;
assert.deepEqual(grupoRuim, [
  'Grupo tributário LAMINAS: Informe o CSOSN (Simples Nacional) ou o CST do ICMS (regime normal).',
  'Grupo tributário LAMINAS: Escolha o CST do PIS.',
  'Grupo tributário LAMINAS: Escolha o CST da COFINS.',
]);

const foraUF = montarDocumento({ ...nota, destinatario: { ...cliente, cidade_uf: 'PR' }, modalidadeFrete: 1 }).documento;
assert.equal(foraUF.itens[0]!.cfop, '6101');
assert.equal(foraUF.ide.idDestino, 2);
assert.equal((foraUF.transporte.transportadora as any).cpf, '52998224725');

const incompleta = montarDocumento({ ...nota, config: CONFIG_PADRAO, produtos: { 47: { ...nota.produtos[47], ncm: null } } }).pendencias;
assert.equal(incompleta.length, 2);
assert.match(incompleta[0]!, /Configuração da NF-e/);
assert.match(incompleta[1]!, /falta o NCM/);
assert.equal(referenciaNFe(123), 'ROM-000123');

// DIFAL: CPF em PR (outra UF, não contribuinte) sem as alíquotas de PR = pendência; com elas, vai no item
const cpfPR = { ...nota, destinatario: { ...cliente, cpf_cnpj: '52998224725', cidade_uf: 'PR' } };
assert.match(montarDocumento(cpfPR).pendencias.join(), /DIFAL/);
const comDifal = montarDocumento({ ...cpfPR, config: { ...config, difal: { PR: { interestadual: 12, interna: 20, fcp: 0 } } } });
assert.deepEqual(comDifal.pendencias, []);
assert.deepEqual(comDifal.documento.itens[0]!.imposto.difal, { aliquotaInterna: 20, aliquotaInterestadual: 12 });
assert.equal(montarDocumento({ ...cpfPR, destinatario: { ...cpfPR.destinatario, ind_ie_dest: '1', ie: '123' } }).documento.itens[0]!.imposto.difal, undefined);

// Linha em branco da tela some; linha incompleta é recusada
const { validarConfig } = await import('./nfe.js');
assert.deepEqual(validarConfig({ ...config, difal: { PR: { interestadual: 12, interna: 20, fcp: 2 }, RS: { interestadual: 0, interna: 0, fcp: 0 } } }).difal, {
  PR: { interestadual: 12, interna: 20, fcp: 2 },
});
assert.throws(() => validarConfig({ ...config, difal: { PR: { interestadual: 5, interna: 20, fcp: 0 } } }), /interestadual/);
assert.throws(() => validarConfig({ ...config, difal: { PR: { interestadual: 12, interna: 0, fcp: 0 } } }), /interna/);

console.log('romaneio: ok');

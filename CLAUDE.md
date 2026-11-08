# Romaneio de Lâminas (web)

@../../_claude/web.md

Conversão do sistema Delphi `D:\bmsoft\romaneioLamina` (RomaneioLaminas.exe) para o modelo do crmweb
(Vite + React + Express, CRUD dirigido por metadados em `server/schema.ts`).

- Banco: o do ERP BMsoft (`bmerp_000000`), tabelas no padrão novo. Próprias: `lam_romaneiosm` (romaneios),
  `lam_romaneiosd` (itens), `lam_romaneiose` (conversão de estoque), `lam_romaneiosp` (perdas).
- Do ERP: `cad_pessoas` (clientes/transportadores; `date_delete` = excluída), `cad_produtos` (lâminas/toras,
  custo em `preco_custo`), `fin_centro_custo` (máquinas = centro de custo com `*` na descrição; inclusão grava
  `tipo_referencia` ADMINISTRATIVO), `sys_empresas`, `sys_usuarios` + `sys_perfis`.
- Telas Clientes (`cad_pessoas`), Produtos (`cad_produtos`) e Unidades (`cad_produtos_unidades_medida`) só com os
  dados básicos; sem exclusão (inativar). Produto: `unidade_id` é FK (obrigatório) e a inclusão grava `categoria_id`
  NULL (o padrão 0 fere a FK de `cad_produtos_categorias`).
  CPF/CNPJ validado no servidor (`cpfCnpjValido`, aceita o CNPJ alfanumérico: letras maiúsculas gravadas em
  `cpf_cnpj`), `tipo_pessoa` sai do tamanho do documento. Cidade do cliente: combo com pesquisa (`cidade_ibge`,
  recurso oculto `cidades` = `cad_cidades`, municípios do IBGE baixados no BMNFe › Tabelas Fiscais); ao gravar,
  `cidade_nome`, `cidade_uf` e `cidade_id` saem do município escolhido (só leitura no formulário). Sem município
  escolhido, o que já está gravado fica.
- Login: `sys_usuarios.login` + `senha_hash` (bcrypt; aceita legado texto/md5/sha e converte; senha vazia =
  primeiro acesso). Preferências de lista em `sys_usuarios.config_listas`.
- Concluir (com "Baixar estoque"): na localização `ESTOQUE_LOCALIZACAO_ID` (.env), cria um lote `ROM/00123` em
  `cad_produtos_lotes` por lâmina e lança `producao_entrada`; as toras saem dos lotes por PEPS (`producao_saida`),
  o que faltar fica negativo no lote mais novo. Movimentos em `est_estoque_movimentacoes`
  (referencia_tipo `romaneio`), saldo em `est_estoque_saldo` (sem chave única: UPDATE, senão INSERT).
- Regras do romaneio (m3, perda, item novo, concluir, impressão): `server/romaneio.ts`.
- Trava: romaneio concluído ou com NF-e gerada (`nfeGerada()` em server/nfe.ts: nota em `nfe_documentos` pela
  referência, fora rascunho e rejeitada) não aceita alteração nem mexer nos itens (`travar()` no servidor;
  `romaneioTravado` no App.tsx, que deixa formulário e itens só para consulta). Com NF-e gerada o Gerar NFe é
  recusado (prévia e geração). As opções de NF-e do menu avisam na hora (aviso âmbar), pela coluna `nfe_situacao`
  da linha: Gerar com nota gerada, Enviar sem nota ou com nota que não está assinada/rejeitada, Imprimir sem nota.
- Gerar NFe (`server/nfe.ts`): regras fiscais em `sys_empresas.config` (JSON, chave `nfe`, tela "Configuração
  da NF-e"; as outras chaves ficam intactas). Um item por lâmina: qCom = m³ somado (4 casas), vUnCom =
  `cad_produtos.preco_venda`, CFOP 5xxx/6xxx pela UF do cliente.
  Série: select com as séries ativas do BMNFe (`GET /api/nfe/series` → `/api/series/ativas` de lá, tela Séries);
  a emissão no BMNFe recusa série não cadastrada/ativa. Série gravada que não está na lista aparece marcada.
  Imprimir NFe (menu do romaneio): `GET /api/romaneios/:id/nfe/danfe` acha a nota no BMNFe pela referência
  (`GET /api/emitir/ROM-000123`) e devolve o PDF do `POST /api/danfe` de lá.
  Enviar SEFAZ (menu do romaneio): `POST /api/romaneios/:id/nfe/enviar` acha a nota do mesmo jeito, só aceita
  assinada ou rejeitada e chama o `POST /api/enviar` do BMNFe (o Enviar da tela de notas de lá; ambiente = o do BMNFe).
  Coluna NF-e da lista (`nfe_situacao`): situação da nota em `nfe_documentos` pela mesma referência, como ícone
  colorido (`icone: true` no enum; cores em `STATUS_COLORS`). O `empresa_id IN (nfe_empresas)` da subconsulta é
  o que faz usar a chave única (empresa_id, referencia).
  Tributação do item (origem, CSOSN/CST, PIS/COFINS, CFOP e cClassTrib do IBS/CBS) vem do grupo tributário
  do produto (`fis_grupos_tributarios`, `cad_produtos.grupo_tributario_id`); sem grupo, o `grupoPadraoId` da
  configuração; CFOP e cClassTrib vazios no grupo = os da configuração. Grupo é validado ao gravar
  (`errosTributacao`, o mesmo que vira pendência na nota). CST do PIS/COFINS: lista fixa (`CST_PIS_COFINS`, sem o 03).
  CFOP (`fis_cfop`, planilha do Portal Nacional da NF-e) e NCM do produto (`fis_ncm`, Portal Único Siscomex, só os
  8 dígitos) são baixados no BMNFe, tela "Tabelas Fiscais" (nfeWeb `server/tabelas.ts`, botão Baixar/Atualizar;
  estrutura em `extras/2026-11-07_tabelas_fiscais.sql` de lá); o romaneio só lê. Os combos de CFOP
  (`cfops_dentro_uf` 5xxx, `cfops_fora_uf` 6xxx) só mostram os de NF-e (`ind_nfe = 1`) em vigor. Itens iguais do romaneio (produto, espessura,
  largura, comprimento) viram um item da nota, com o m³ somado e as medidas na descrição.
  cClassTrib: tabela oficial (IT 2025.002) em `fis_classificacao_tributaria`, carregada pelo botão "Atualizar pela
  tabela oficial" da Configuração da NF-e: a API da SVRS (`cff.svrs.rs.gov.br/api/v1/consultas/classTrib`) exige
  certificado, então quem consulta é o nfeWeb (`GET /api/tabelas/classificacao-tributaria`, com o A1 da empresa).
  O CST do IBS/CBS e a redução (gRed) saem da classificação; o combo e a nota só aceitam as que passam em
  `CLASSIFICACAO_NA_NFE` (schema.ts); o grupo grava `cst_ibscbs` derivado. Outra UF + não contribuinte (ind_ie_dest 9)
  leva o DIFAL com as alíquotas da UF de destino em `config.nfe.difal` (interestadual 4/7/12, interna, FCP);
  UF sem alíquota vira pendência. Manda ao BMNFe, projeto nfeWeb (`BMNFE_URL/USUARIO/SENHA`,
  `POST /api/emitir` com `transmitir: false`, referência `ROM-000123`): lá a nota é numerada, calculada,
  assinada e fica `assinada`, pronta para o Enviar. Gerar de novo refaz a mesma nota (mesmo número).
  Criados pelo usuário: `cad_produtos.ncm` CHAR(8), `cad_produtos.grupo_tributario_id` (FK), `fis_grupos_tributarios`,
  `fis_classificacao_tributaria` (abaixo), `fis_cfop` e `fis_ncm`; a reversão é DROP dessas colunas e tabelas.

```sql
CREATE TABLE fis_classificacao_tributaria (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cclass_trib CHAR(6) NOT NULL,
  cst CHAR(3) NOT NULL,
  nome_cst VARCHAR(100) NOT NULL,
  nome VARCHAR(255) NOT NULL,
  descricao TEXT NULL,
  p_red_ibs DECIMAL(7,4) NOT NULL DEFAULT 0,
  p_red_cbs DECIMAL(7,4) NOT NULL DEFAULT 0,
  ind_nfe TINYINT(1) NOT NULL DEFAULT 0,
  ind_nfce TINYINT(1) NOT NULL DEFAULT 0,
  ind_trib_regular TINYINT(1) NOT NULL DEFAULT 0,
  ind_monofasica TINYINT(1) NOT NULL DEFAULT 0,
  ind_estorno_cred TINYINT(1) NOT NULL DEFAULT 0,
  inicio_vigencia DATE NULL,
  fim_vigencia DATE NULL,
  publicado_em DATE NULL,
  criado_em DATETIME NULL,
  atualizado_em DATETIME NULL,
  UNIQUE KEY uk_fis_class_trib (cclass_trib)
);
-- reversão: DROP TABLE fis_classificacao_tributaria;
```
- As tabelas são criadas pelo usuário, nunca pelo app.
- Teste das regras puras (m3, validação do item, documento, PEPS, montagem da NF-e): `npm test`.

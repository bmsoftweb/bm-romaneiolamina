# Histórico de versões

Mais recente primeiro. PATCH a cada envio ao GitHub; MAJOR/MINOR só quando pedido.

## 0.1.1 — 2026-11-07

- Cadastros de Clientes, Produtos e Unidades (dados básicos, sem exclusão); CPF/CNPJ validado (aceita o CNPJ alfanumérico) e Cidade do cliente com pesquisa nos municípios do IBGE.
- NF-e do romaneio pelo BMNFe: Configuração da NF-e (regras fiscais, série das ativas no BMNFe, DIFAL por UF), Grupos tributários com cClassTrib da tabela oficial, CFOP e NCM das Tabelas Fiscais do BMNFe.
- Menu do romaneio: Gerar NFe, Enviar SEFAZ e Imprimir NFe (DANFE); as opções avisam na hora quando não cabem na situação da nota.
- Coluna NF-e na lista dos romaneios, com ícone colorido pela situação da nota.
- Romaneio com NF-e gerada fica travado como o concluído (rejeitada ou rascunho ainda liberam).

## 0.1.0 — 2026-11-06

- Conversão do RomaneioLaminas (Delphi) para web: Romaneios (mestre-detalhe com itens, observação, Pesquisar, Imprimir, Concluir e e-Mail), Conversão de estoque, Perdas e Máquinas (Mostrar Tudo / Mostrar Somente Máquinas).

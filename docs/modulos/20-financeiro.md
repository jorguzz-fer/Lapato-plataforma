# MÓDULO 20 — Financeiro e Ordens de Serviço

- Status: aceito
- Data: 2026-09-09
- Numeração oficial: **20** (`0 DIRETRIZES DE INTEGRAÇÃO.docx` §6)

## Nota de origem

**§1.** Este documento é diferente dos outros vinte e cinco. Os demais módulos foram
escritos antes do código; o 20 foi construído a partir das reuniões de revisão com quem
opera o laboratório — a Roberta (recepção e financeiro) e o Hugo (patologista) — e só
depois documentado. O que está escrito aqui é o que existe no ar, com a regra e o motivo
de cada decisão, mais o que ficou declarado como fora desta fase (§100 em diante).

**§2.** Onde uma seção nasceu de uma frase dita numa reunião, a frase está citada. Não é
enfeite: é a única forma de saber, daqui a um ano, se a regra ainda serve ou se foi
resposta a um problema que passou.

**§3.** As seções são numeradas para que o código possa referenciá-las, como faz com os
outros módulos (`M20 §22`, por exemplo).

## 1. Propósito e fronteiras

**§4. Propósito.** Transformar trabalho executado em cobrança correta, e cobrança em
caixa. O módulo é dono do preço, da Ordem de Serviço, da fatura, do livro de lançamentos,
do fechamento do período e das medições que alimentam pagamento (produtividade do
patologista, produção do encarregado logístico).

**§5. O que é dele.**

- O catálogo de preço aplicado a um cliente e a resolução de qual preço vale.
- A Ordem de Serviço: quando nasce, o que entra nela, quando fica faturável.
- A fatura: agrupamento, emissão, pagamento, cancelamento.
- O livro de lançamentos e o fluxo de caixa.
- O fechamento mensal por cliente.
- A medição de produtividade e de produção — quanto cada um produziu no período.

**§6. O que não é dele.** O serviço e o seu valor padrão são do M01; quem é o cliente e
qual tabela ele segue é do M03; o caso e a data de entrada são do M05; o momento em que a
macroscopia conclui é do M08; o laudo liberado é do M11; a execução do serviço logístico é
do M19. O 20 **lê** esses fatos e **não decide** nenhum deles.

**§7. A regra inversa também vale.** Nenhum outro módulo calcula regra financeira própria
— a Logística é explícita nisso (M19 §102): o módulo dono **gera o evento** de produção ou
de custo, e o 20 decide o que aquilo vale. Um valor de serviço que aparecesse na tela da
Logística sem passar por aqui seria um segundo preço, e dois preços é o começo de uma
divergência de fim de mês.

**§8. Vocabulário.**

| Termo | O que é |
|---|---|
| **Serviço** | Item do catálogo do M01 (Histopatologia, Citologia, Necropsia…), com valor padrão |
| **Tabela de preço** | Conjunto nomeado de valores por serviço, que muitos clientes seguem |
| **Faixa** | Valor **total** fechado para N amostras de um serviço, dentro de uma tabela |
| **Acordo** | Valor individual de um serviço para um cliente específico |
| **Ordem de Serviço (OS)** | O que foi executado para um caso, e quanto custa |
| **Faturável** | A OS já sabe o tamanho do trabalho e pode entrar numa fatura |
| **Fatura** | Uma ou mais OS do mesmo cliente, agrupadas para cobrança |
| **Lançamento** | Linha do livro: entrada ou saída de caixa, com data e categoria |
| **Fechamento** | O relatório do período, por cliente, cortado pela data de entrada |

## 2. Preço

**§10. Três camadas.** A Roberta, na segunda revisão: *"os serviços são os mesmos, só varia
o valor — laboratório é um valor, clínica outro, hospital outro"*. O preço de um serviço
para um cliente é resolvido nesta ordem, e a primeira que existir vence:

1. **Acordo individual** do cliente para aquele serviço (`preco_cliente`).
2. **Tabela** que o cliente segue (`item_tabela_preco`, via `cliente.tabela_preco_id`).
3. **Valor padrão** do serviço (M01).

**§11. Por que tabela, e não preço por cliente.** Digitar o catálogo inteiro cliente a
cliente é trabalho que se repete e envelhece torto. A instituição mantém poucas tabelas
nomeadas — na prática, uma por perfil de cliente — e cada cliente aponta para uma. O acordo
individual continua existindo para a exceção, que é o que ele deve ser.

**§12. Faixa por quantidade.** Quando a cobrança não é linear, a tabela pode declarar o
**total** para N amostras: 4 amostras por R$ 380, por exemplo. Vale a maior faixa que não
ultrapassa a quantidade; o que exceder é cobrado pelo valor unitário vigente. O acordo
individual vence a tabela inteira, faixas incluídas — quem negociou um valor com o cliente
negociou o valor, não a curva.

**§13. A faixa entra na OS como `1 × total`.** Com a quantidade na descrição
(*"Histopatologia (4 amostras)"*). Dividir o total por N para inventar um unitário produz
centavo de arredondamento e um número que ninguém acordou.

**§14. Preço não retroage.** O item de OS copia o valor vigente no momento em que entra
(M01 §21). Mudar a tabela hoje não mexe em nenhuma OS de ontem — nem para mais, nem para
menos. É a mesma regra do nome do serviço: o histórico guarda o que valia na época.

**§15. Tabela inativada** some da escolha de novos clientes, e quem já a segue continua
seguindo. M01: **inativa, nunca exclui**.

## 3. Ordem de Serviço

**§20. Uma por caso, nascida na entrada.** A OS é criada junto com o caso, com identificador
próprio (`OS-2026-000123`). A restrição de unicidade é por caso: não existem duas.

**§21. O item inicial.** É o serviço do caso, com quantidade igual ao número de amostras
cadastradas. *"Uma remessa com nódulo de pele que revelou dois fragmentos cobra dois"* — e
a recepção ajusta depois se o acordo do cliente for por caso, e não por amostra.

**§22. Quando a OS fica faturável.** Este é o ponto que mais custou a acertar, e a decisão
está na segunda revisão. Cobrar **na entrada** erra, porque ninguém abre o frasco na
recepção e não se sabe quantas peças são. Cobrar **na liberação do laudo** joga o fim de mês
para o mês seguinte. Ficou:

- **Ao concluir a macroscopia**, quando o serviço tem macroscopia. E só quando **todas** as
  amostras que chegam à bancada estão concluídas: com duas peças, a primeira pronta ainda
  não diz quantos cassetes a segunda vai render. Amostra bloqueada ou recusada na triagem
  (M06) fica fora da conta, porque nunca chega à bancada.
- **Na entrada**, quando o serviço não tem macroscopia (citologia, necropsia) — não existe o
  momento "agora sei o tamanho do trabalho".
- **Na entrada**, também, quando o caso é **particular**: o responsável traz a amostra e paga
  ali (M05).

A origem fica gravada (`faturavel_origem`: `macroscopia` ou `entrada`), porque a pergunta
"por que esta OS já podia ser faturada?" tem que ter resposta sem arqueologia.

**§23. Marcar faturável é idempotente.** Concluir de novo a macroscopia da mesma amostra
(um recorte, por exemplo) não muda a data nem publica o evento outra vez.

**§24. Conferir e despachar continuam existindo** — são marcos operacionais, o ato da
"última saída" que o laboratório já fazia. Não são mais o portão da fatura.

**§25. Item entra até a fatura.** Conferida e despachada **não congelam** a OS: coloração
especial, margem e nova amostra pedidas depois de "finalizado" são rotina do laboratório
(*"faz e manda"*). Só a fatura fecha.

**§26. Retrabalho consta e não cobra.** O recorte pedido pelo patologista, quando a
amostragem não foi representativa, entra como item com valor zero e marcado como retrabalho.
O cliente não paga; o fechamento do mês enxerga o custo. Ordem cancelada não recebe
retrabalho — não há fechamento onde ele apareceria.

**§27. Cancelamento exige motivo.** Some do faturamento e fica na linha do tempo.

**§28. Status.** `aberta` → `conferida` → `despachada` → `faturada`, e `cancelada` a
qualquer momento antes de faturar. Os três primeiros aceitam edição de item (§25).

## 4. Fatura

**§30. O que a fatura agrupa.** Uma ou mais OS **faturáveis** (§22) do **mesmo cliente**. OS
já faturada ou cancelada não entra em outra fatura. Identificador próprio, por ano.

**§31. Particular é uma fatura por exame.** O "cliente" do caso particular é o pseudo-cliente
da instituição, mas quem paga é o responsável de **cada** animal. Agrupar dois exames
particulares numa fatura cobraria de duas pessoas diferentes no mesmo documento.

**§32. Status.** `aberta` (ainda pode ser desfeita) → `emitida` (com vencimento; vira contas
a receber) → `paga`. Cancelada a partir de aberta ou emitida, com motivo.

**§33. Pagamento espelha o livro.** Registrar o pagamento cria, na mesma transação, o
lançamento de **entrada** vinculado à fatura. É o que mantém o fluxo de caixa e o contas a
receber contando a mesma história.

**§34. Cancelar devolve as OS** ao marco operacional em que estavam (despachada, conferida
ou aberta). O `faturavel_em` permanece, então elas podem ser refaturadas na hora.

## 5. Livro de lançamentos e caixa

**§40. Entrada e saída**, com categoria, descrição, valor e data. É o livro simples que o
laboratório precisa para enxergar o mês, não um plano de contas.

**§41. O lançamento automático da fatura não se remove.** Quem quiser mexer, mexe na fatura
— cancelando ou ajustando. Remover a linha por baixo deixaria o caixa dizendo uma coisa e o
contas a receber outra. A remoção de lançamento manual é auditada.

**§42. O resumo** é a tela de chegada do financeiro: fluxo de caixa dos últimos meses,
contas a receber (emitidas não pagas) e o que já pode ser faturado (faturáveis sem fatura).

## 6. Fechamento do período

**§50. O que é.** A Roberta: *"no dia 1 eu preciso fechar todo mundo — um relatório com
todos os exames, valor e subtotal, para todos os clientes"*. O fechamento agrupa por cliente
os casos do período, com subtotal por cliente e total geral.

**§51. O corte é pela data de ENTRADA do material.** *"O que chegou no laboratório entre o
dia 1 e o dia 31"* — não pela data da fatura, nem pela do laudo. É o corte que o cliente
reconhece quando confere. A data final é exclusiva: passa-se o primeiro dia do mês seguinte.

**§52. Cada linha diz o estado.** Status da OS, se já está faturável, a fatura em que entrou
e quantos retrabalhos tem. É o que permite ao financeiro enxergar, antes de faturar, o que
ainda está preso na bancada.

**§53. PDF.** O fechamento gera o documento que vai para o cliente.

**§54. O envio automático por e-mail depende do M26** e está fora desta fase (§101).

## 7. Medição de produção

**§60. Produtividade do patologista.** Hugo: *"de repente a gente pode ter alguém que receba
por produção"*; Roberta: o pagamento é mensal. O módulo **mede**: laudos liberados no
período, por quem assinou, mais os casos destinados que ainda não saíram — a fila de cada um.
Converter medição em pagamento é decisão em aberto (§103).

**§61. Produção do encarregado logístico.** Serviço logístico concluído (M19) vira item de
produção, com o valor que a solicitação carregava. O 20 é quem guarda a situação:
`nao_lancado` → `lancado` → `incluido_em_fechamento`, com referência financeira, data de
pagamento e observação. O M19 não decide nada disso (§7).

## 8. Contratos

**§70. Permissões.**

| Permissão | O que abre |
|---|---|
| `os:visualizar` | Ver OS e a lista de ordens |
| `os:editar` | Ajustar item, quantidade, preço e desconto |
| `os:conferir` | Conferir e despachar |
| `preco:gerenciar` | Valor padrão, tabelas, faixas e acordos |
| `financeiro:visualizar` | Faturas, lançamentos, caixa, fechamento, produtividade |
| `financeiro:lancar` | Criar e emitir fatura, registrar pagamento, lançar entrada e saída |

**§71. Eventos publicados.** `os.criada`, `os.faturavel`, `os.conferida`, `os.despachada`,
`os.cancelada`, `fatura.criada`, `fatura.emitida`, `fatura.paga`, `fatura.cancelada`,
`producao.registrada`. Quem quiser reagir a dinheiro reage a estes — o M25 vai ler daqui.

**§72. Numeração.** `OS-<ano>-<sequencial>` e a série própria da fatura, ambas pelo
serviço de numeração do M01, com sequência por ano.

**§73. Tabelas.** `ordem_servico`, `item_ordem_servico`, `preco_cliente`, `tabela_preco`,
`item_tabela_preco`, `faixa_tabela_preco`, `fatura`, `lancamento_financeiro`,
`producao_logistica`. Todas com `tenant_id` e RLS por descoberta (ADR 0002).

**§74. Telas.** Ordem de Serviço dentro do dossiê do caso; lista de Ordens de Serviço;
Financeiro com as abas de faturas, lançamentos, fechamento e produtividade; tabelas de preço
em Configurações; preços do cliente na ficha dele.

## 9. Decisões em aberto

**§100.** O que está abaixo **não** está implementado e **não** é falha de execução: é
escopo que depende de decisão ou de outro módulo. Enquanto não for decidido, o módulo está
completo em relação a este documento.

**§101. Boleto e Pix na fatura.** Hoje a fatura é emitida com vencimento e o pagamento é
registrado à mão. Emitir boleto ou cobrança Pix exige escolher o meio (banco, PSP) e tratar
a conciliação de retorno — decisão do Fernando, com custo por transação.

**§102. Envio do fechamento por e-mail.** O relatório e o PDF existem; o envio depende dos
canais reais do M26, que hoje só registra em log.

**§103. Pagamento por produção.** O módulo mede produtividade do patologista (§60) e produção
do encarregado (§61). Transformar isso em valor a pagar — regra, percentual, ciclo — não foi
decidido com quem paga.

**§104. Nota fiscal.** Não foi discutida em nenhuma das três revisões. Fica registrado que a
fatura do LAPATO **não é** documento fiscal.

**§105. Despesa recorrente e contas a pagar.** O livro aceita saída avulsa (§40), mas não há
recorrência, fornecedor nem vencimento de conta a pagar. Ninguém pediu; entra se pedirem.

**§106. Excedente da faixa.** Acima da maior faixa, o excedente é cobrado pelo unitário
(§12). É a leitura razoável da regra, e ainda não foi confirmada pela Roberta com um caso
real.

**§107. A lista de preços por serviço da Roberta**, para carregar nas tabelas, é dado, não
código. Sem ela as tabelas existem vazias.

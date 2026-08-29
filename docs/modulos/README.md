# Módulos do LAPATO — numeração oficial e mapa de-para

## Fonte de verdade

A numeração oficial é a definida em **`0 DIRETRIZES DE INTEGRAÇÃO.docx` §6**, que declara
explicitamente: _"Qualquer numeração utilizada em documentos anteriores deverá ser
desconsiderada."_

Todo código, nome de módulo, evento e ADR deste repositório usa a numeração oficial abaixo.

## Os 26 módulos oficiais

| Nº | Módulo | Grupo funcional | Status nesta fase |
|----|--------|-----------------|-------------------|
| 01 | Administração e Configurações | Governança | Núcleo implementado |
| 02 | Usuários, Perfis e Permissões | Governança | Núcleo implementado |
| 03 | Cadastro de Clientes e Veterinários | Relacionamento e entrada | Implementado |
| 04 | Portal do Cliente | Relacionamento e entrada | Implementado |
| 05 | Recebimento e Cadastro de Amostras | Relacionamento e entrada | Implementado |
| 06 | Triagem de Amostras | Operação laboratorial | Implementado |
| 07 | Rastreamento e Gestão de Fluxo | Operação laboratorial | Motor implementado |
| 08 | Macroscopia | Operação laboratorial | Implementado |
| 09 | Processamento Histológico e Colorações | Operação laboratorial | Implementado |
| 10 | Solicitações e Pendências | Operação laboratorial | Implementado |
| 11 | Laudos e Microscopia | Diagnóstico | Implementado |
| 12 | Citopatologia | Diagnóstico | Implementado |
| 13 | Histopatologia | Diagnóstico | Implementado |
| 14 | Necropsia | Diagnóstico | Implementado |
| 15 | Controle de Cadáveres | Materiais e imagens | Implementado |
| 16 | Imagens e Scanner de Lâminas | Materiais e imagens | Implementado (WSI fora do v1, ADR-0004) |
| 17 | Inteligência Artificial | Conhecimento | Implementado (Copiloto real opcional, ADR-0007) |
| 18 | Bioteca e Gestão de Acervo Biológico | Materiais e imagens | Implementado |
| 19 | Logística | Relacionamento e entrada | Documentado — a implementar |
| 20 | Financeiro | Gestão institucional | Sem documentação |
| 21 | Biblioteca | Gestão institucional | Documentado — a implementar |
| 22 | Qualidade e Auditoria | Governança | Documentado — auditoria base implementada |
| 23 | Ensino e Pesquisa | Conhecimento | Documentado — a implementar |
| 24 | Perícia e Patologia Forense | Conhecimento | Documentado — a implementar |
| 25 | Relatórios e Indicadores | Gestão institucional | Sem documentação |
| 26 | Integrações e Notificações | Comunicação | Outbox implementado |

## Mapa de-para: arquivos `.docx` → numeração oficial

Os arquivos `MÓDULO 01` a `MÓDULO 04` já usam a numeração oficial. A partir do arquivo
`MÓDULO 05`, que **funde** os oficiais 05 (Recebimento e Cadastro) e 06 (Triagem), a
numeração fica deslocada em **−1** em relação à oficial.

| Arquivo `.docx` | Numeração oficial | Observação |
|---|---|---|
| MÓDULO 01 Administração e Configurações | 01 | Coincide |
| MÓDULO 02 Usuários, Perfis e Permissões | 02 | Coincide |
| MÓDULO 03 Cadastro de Clientes e Veterinários | 03 | Coincide |
| MÓDULO 04 Portal do Cliente | 04 | Coincide |
| MÓDULO 05 Recebimento de amostras, cadastro e triagem | **05 + 06** | Fusão — ver nota abaixo |
| MÓDULO 06 Rastreamento e Gestão de Fluxo | **07** | Deslocado |
| MÓDULO 07 Macroscopia | **08** | Deslocado |
| MÓDULO 08 Processamento e colorações | **09** | Deslocado |
| MÓDULO 09 Solicitações e Pendências | **10** | Deslocado |
| MÓDULO 10 Laudos e microscopia | **11** | Deslocado |
| MÓDULO 11 Citopatologia | **12** | Deslocado |
| MÓDULO 12 Histopatologia | **13** | Deslocado |
| MÓDULO 13 Necropsia | **14** | Deslocado |
| MÓDULO 14 Controle de cadáveres | **15** | Deslocado |
| MÓDULO 15 Imagens e acervo digital | **16** | Deslocado; ver ADR-0004 |
| MÓDULO 16 Inteligência artificial | **17** | Deslocado |
| MÓDULO 17 Bioteca | **18** | Deslocado |
| MÓDULO 19 Logística | **19** | Coincide de novo |
| MÓDULO 20 Biblioteca | **21** | Deslocado; a numeração do autor pula o Financeiro |
| MÓDULO 21 Qualidade e auditoria | **22** | Deslocado |
| MÓDULO 22 Ensino e pesquisa | **23** | Deslocado |
| MÓDULO 23 Perícia e patologia forense | **24** | Deslocado |

> **Atenção ao ler os `.docx`:** as referências cruzadas *dentro* dos arquivos 05 a 17 usam
> a numeração antiga. Ao ler "o Módulo 15 armazena as imagens", entenda "Módulo 16".

### Por que o deslocamento some no 19 e volta no 20

O arquivo `MÓDULO 19 Logística` volta a coincidir com a numeração oficial, e os seguintes
tornam a se deslocar. A causa é única: **a numeração do autor pula o Financeiro** (oficial
20). A partir da Biblioteca, tudo anda uma casa para trás outra vez.

### Os arquivos 19 a 23 não concordam entre si

Pior que o deslocamento: **as referências cruzadas desses cinco arquivos se contradizem.**

- `MÓDULO 19 Logística` usa a numeração **oficial** em todas as referências — chama a
  Biblioteca de 21, o Financeiro de 20, a Qualidade de 22, as Integrações de 26.
- Os outros quatro usam a numeração **antiga** — Logística 18, Financeiro 19,
  Biblioteca 20, Qualidade 21, Relatórios 24, Integrações 25.

O resultado é que **dois módulos diferentes aparecem como "Módulo 18"**: `Biblioteca §122`
chama a **Logística** de 18, e `Ensino §180` chama a **Bioteca** de 18.

**Regra prática, sem exceção: leia referência cruzada pelo NOME do módulo, nunca pelo
número.** O número dentro dos `.docx` não é confiável; esta tabela é.

## Nota sobre a fusão Cadastro × Triagem

As DIRETRIZES §8.1 exigem os dois como módulos distintos:

- **Cadastro (05)** registra o que foi informado ou recebido administrativamente.
- **Triagem (06)** verifica o que existe fisicamente e se está adequado para análise.

O arquivo `MÓDULO 05` argumenta por uma tela única. As duas coisas são compatíveis: o
próprio documento mantém os quatro momentos (pré-solicitação, cadastro, recebimento,
triagem) registrados separadamente no dado.

**Resolução adotada:** domínios e tabelas separados no backend (`m05-recebimento` e
`m06-triagem`); **uma única tela** no front. A fusão é de experiência de uso, não de
modelo de dados.

## Módulos sem documentação

Faltam três: **20 Financeiro**, **25 Relatórios e Indicadores** e **26 Integrações e
Notificações**.

### O Financeiro é o que mais falta

Ele não é apenas mais um pendente: é o módulo que os cinco documentos recém-recebidos mais
citam, e cada um deles tem uma ponta que fica sem dono enquanto ele não existir.

| Módulo | O que depende do Financeiro |
|---|---|
| 19 Logística | valor do serviço mostrado ao encarregado antes do aceite (§148), item de produção, fechamento e pagamento (§159–164) |
| 24 Perícia | honorários, adiantamentos e despesas periciais (§158) |
| 23 Ensino e Pesquisa | custos de projeto e centro de custo (§143) |
| 22 Qualidade | indicadores financeiros e eventos auditáveis de estorno e desconto (§111, §178) |

Enquanto ele não chega, a regra é a de sempre: o módulo dono **gera o evento** de produção
ou custo e **não calcula regra financeira própria** (Logística §102 é explícito). O evento
fica pronto para o 20 consumir.

### Pontos de extensão já implementados

Conforme DIRETRIZES §18, os demais módulos já contam com o que precisam para não criar
sistemas paralelos:

- eventos de domínio emitidos e persistidos (consumíveis pelo 22 e pelo 25);
- trilha de auditoria imutável (base do 22);
- outbox de notificações (base do 26).

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
| 19 | Logística | Relacionamento e entrada | Sem documentação |
| 20 | Financeiro | Gestão institucional | Sem documentação |
| 21 | Biblioteca | Gestão institucional | Sem documentação |
| 22 | Qualidade e Auditoria | Governança | Auditoria base implementada |
| 23 | Ensino e Pesquisa | Conhecimento | Sem documentação |
| 24 | Perícia e Patologia Forense | Conhecimento | Sem documentação |
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

> **Atenção ao ler os `.docx`:** as referências cruzadas *dentro* dos arquivos 05 a 17 usam
> a numeração antiga. Ao ler "o Módulo 15 armazena as imagens", entenda "Módulo 16".

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

Os módulos **19, 20, 21, 22, 23, 24, 25 e 26** ainda não têm arquivo `.docx`. Financeiro
(20), Qualidade e Auditoria (22) e Integrações e Notificações (26) são citados por quase
todos os módulos documentados.

Nesta fase são implementados apenas os **pontos de extensão** que os demais módulos
precisam para não criar sistemas paralelos, conforme DIRETRIZES §18:

- eventos de domínio emitidos e persistidos (consumíveis pelo 22 e pelo 25);
- trilha de auditoria imutável (base do 22);
- outbox de notificações (base do 26).

A implementação desses módulos depende da documentação correspondente.

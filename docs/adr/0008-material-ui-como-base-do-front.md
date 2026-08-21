# ADR 0008 — Material UI como base do front, com o Trezo como fonte visual

- Status: aceito
- Data: 2026-08-21
- Substitui parcialmente: [ADR 0006](0006-taplox-como-fonte-de-tokens.md)
- **Desvia do Blueprint §2**, com aprovação explícita do dono do produto

## Contexto

O front da fatia vertical foi construído com Tailwind e tokens extraídos do Taplox
(ADR 0006). O resultado foi descrito pelo dono do produto como "tudo muito liso" —
avaliação correta, e a causa é identificável: o `packages/ui` nunca passou de
`export {}`. As telas usam classes utilitárias e `style={{}}` inline, sem camada de
componentes. Faltava hierarquia e densidade, não decoração.

Foi então disponibilizado o **Trezo**, template comercial que o dono do produto já
possui, na variante `react-nextjs-material-ui-starter`: **Next.js 15 + Material UI 7 +
Emotion**, com 183 componentes, 58 telas e tema completo.

Isso criou uma bifurcação que não existia quando o ADR 0006 foi escrito. O Taplox era
HTML/Bootstrap sem versão React — extrair tokens era a *única* opção. O Trezo é React,
e a pergunta passou a ser real: adotar a base dele, ou continuar reconstruindo?

## Decisão

**O front passa a usar Material UI.** O Vite permanece; o Next.js não é adotado.

O Trezo deixa de ser apenas paleta e passa a ser fonte de linguagem visual **e** de
padrões de componente — sem que seu código-fonte entre neste repositório.

## Por quê

**Tailwind e MUI não convivem.** Um resolve estilo em tempo de compilação, o outro em
tempo de execução via Emotion. Manter os dois significa dois vocabulários concorrentes
e brigas de especificidade na mesma tela. Era escolher um.

**Com Tailwind, 183 componentes viram paleta.** O Trezo seria reduzido a "quais cores
usar" — jogando fora exatamente a parte que responde ao problema levantado.

**O custo da troca é mínimo hoje e cresce rápido.** O front tinha 3 telas e ~950 linhas
quando a decisão foi tomada. Depois de quinze telas construídas, a mesma troca custaria
uma reescrita. Se a decisão ia ser tomada algum dia, era hoje que era barata.

**Acessibilidade por padrão.** O laboratório opera muito por teclado, com leitor de
código de barras entre as mãos. Foco, papéis ARIA, navegação e diálogos corretos vêm
prontos no MUI; em Tailwind puro, cada um deles é responsabilidade minha, tela a tela —
e o custo de errar é silencioso.

**Listagem densa.** A Central de Casos tem muitas colunas e muitas linhas, com ordenação
e filtro. `@mui/x-data-grid` resolve isso; uma `<table>` à mão resolveria pior e depois.

## O que este ADR NÃO decide

**Não adota Next.js.** MUI funciona com Vite. Trocar de bundler não tem justificativa.

**Não copia código do Trezo para cá.** O repositório do LAPATO é público, e o Trezo é
licenciado. O que atravessa é linguagem visual: escala, espaçamento, elevação, raio,
tipografia e padrões de composição. O repositório `jorguzz-fer/trezo-referencia` é
privado e serve de consulta, não de origem de arquivos.

**Não abandona o princípio do Blueprint §9.** Os componentes base continuam em
`packages/ui`, encapsulando a lib visual. Uma tela do LAPATO importa de `@lapato/ui`,
nunca de `@mui/material` diretamente. Foi esse encapsulamento que tornou esta troca
barata, e é ele que manteria barata a próxima.

## O desvio do Blueprint

O Blueprint §2 recomenda **Tailwind** para o front, e o Blueprint é lei neste projeto.
Este ADR o contraria de forma consciente, com aprovação explícita registrada.

O que o §9 realmente protege — "os componentes base encapsulam a lib visual, para que
trocá-la não implique reescrever telas" — continua respeitado, e este ADR é a prova:
a troca custou pouco justamente porque as telas eram poucas e a camada existia no plano.

## Consequências

**Aceitas:**

- **Bundle maior: 267 KB → 578 KB** (medido no build de produção, antes de compressão).
  MUI e Emotion pesam mais que CSS compilado. Para uma ferramenta interna de laboratório,
  acessada de desktop em rede local e carregada uma vez por turno, é troca aceitável —
  não seria numa página pública otimizada para primeiro carregamento. Se algum dia
  incomodar, o caminho é divisão por rota, não voltar atrás nesta decisão.
- CSS-in-JS em tempo de execução tem custo de renderização que o Tailwind não tem.
- O trabalho de tokens do Taplox é largamente superado. A paleta muda de azul
  (`#1a80f8`) para o índigo do Trezo (`#605DFF`), e a tipografia de Roboto para Inter.

**Preservadas:**

- Os tokens de domínio, que nenhum template conhece: os quatro níveis de intervenção da
  IA (M17 §11) e os estados de prazo do M07. Eles vivem em `packages/design-tokens` e
  alimentam o tema — não o contrário.
- A exigência do M07 de que indicadores **não dependam apenas de cor**. O MUI não sabe
  disso; os componentes de `@lapato/ui` sabem.

## Alternativas consideradas

**Manter Tailwind e reconstruir à mão.** Fiel ao Blueprint, bundle menor. Descartada
porque descarta 183 componentes prontos e transfere toda a acessibilidade para o meu
cuidado individual, tela a tela.

**Migrar para Next.js junto.** Traria SSR e as convenções do Trezo intactas. Descartada:
o LAPATO é uma aplicação interna atrás de autenticação, onde SSR não paga o próprio
custo, e trocar bundler ampliaria o raio da mudança sem benefício correspondente.

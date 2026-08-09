# ADR 0006 — Taplox como fonte de design tokens, não como base de código

- Status: aceito
- Data: 2026-08-09

## Contexto

Foi fornecido o template comercial **Taplox v1.0** (Stackbros) como referência de UX/UI.
Inspecionado, o pacote é: **HTML estático + Bootstrap 5.3 + SCSS + Gulp + jQuery**, com 54
páginas e um conjunto de plugins da época (apexcharts, gridjs, quill, sweetalert2, dragula,
flatpickr). **Não há versão React neste pacote.**

O Blueprint §2 recomenda React + TypeScript com Tailwind e design system próprio, e o §9
exige que os componentes base **encapsulem** a lib visual, para que trocar a base não
implique reescrever telas. O §9 também exige checar a licença da base de UI, com o exemplo
literal "SaaS pago → licença adequada".

As telas mais importantes do LAPATO — bancada do patologista, estação de macroscopia,
dossiê do caso, painel 70/30 do Copiloto — são densas e específicas; nenhuma delas existe
pronta no template.

## Opções consideradas

1. **Extrair tokens e padrões, reconstruir em React + Tailwind.** Mantém a identidade
   visual aprovada, segue o Blueprint, e as telas específicas seriam custom de qualquer forma.
2. **React + React-Bootstrap portando o SCSS do Taplox.** Fidelidade visual máxima e
   reaproveita mais CSS pronto. Contras: adiciona Bootstrap ao bundle, desvia da
   recomendação de Tailwind, e não elimina o trabalho nas telas densas.
3. **Servir o HTML do template diretamente.** Descartada: quebra "uma API, vários clientes"
   e inviabiliza o app móvel futuro.

## Decisão

Opção 1.

- `packages/design-tokens` recebe os tokens extraídos de
  `Taplox_v1.0/Admin/src/assets/scss/config/_variables.scss` e `_theme-mode.scss`:
  tipografia (Roboto), paleta (`primary #1a80f8`, cinzas `#f8f9fa`→`#21252e`, semânticas),
  raios, sombras, métricas de sidebar (250px / 75px) e topbar (70px), e o par claro/escuro.
  Saída: CSS custom properties + preset Tailwind.
- `packages/ui` implementa os componentes base em React sobre Tailwind + Radix
  (acessibilidade por padrão), encapsulando a lib visual como o Blueprint §9 exige.
- As 54 páginas do template servem como **referência visual**, não como código.
- O zip do template **sai do controle de versão** e entra no `.gitignore`. Material
  licenciado não é redistribuído pelo repositório, e um binário de 16 MB não pertence ao git.

## Licença — verificada

A pendência levantada na primeira versão desta ADR está **resolvida**. O certificado
apresentado é de **Envato Elements**, não de marketplace avulso, e por isso a preocupação
original (licença Regular × Extended do ThemeForest) não se aplica.

O que o certificado estabelece:

- uso **comercial, não exclusivo e mundial**, como parte de **um projeto específico** para
  criar um End Product;
- a licença está **registrada no nome do projeto LAPATO**, que é o registro correto;
- item de autoria da Stackbros, com código de licença mantido **fora do repositório**
  (ver "Onde o certificado fica", abaixo).

Um SaaS multi-instituição é **um End Product**: uma base de código, um produto. O modelo
Elements licencia por projeto, não por cliente atendido — os laboratórios que usarem o
LAPATO são usuários do produto, não destinatários do template. Não há on-selling: o item
não é revendido nem redistribuído de forma que alguém possa extraí-lo.

### Duas condições que precisam ser observadas

1. **A assinatura Envato Elements precisa continuar ativa até o End Product estar
   concluído.** O certificado é explícito: a licença só é válida se o End Product for
   concluído com a assinatura vigente — e aí passa a valer pela vida do produto, mesmo
   que a assinatura termine depois. Num projeto de 26 módulos, que leva tempo, deixar a
   assinatura cair no meio do caminho é um risco real e silencioso. Vale tratar a
   renovação como item de operação, não como despesa opcional.

2. **O certificado nomeia a variante Angular do Taplox**, enquanto o pacote recebido é a
   variante HTML/Bootstrap. Para esta ADR isso é indiferente — o que foi extraído são
   tokens de identidade (cores, tipografia, métricas de layout), idênticos entre as
   variantes e, isoladamente, não protegíveis da mesma forma que código e assets. Mas se
   um dia a decisão mudar e algum **código ou asset** do template for usado, é preciso
   confirmar que a variante correta está coberta.

### Onde o certificado fica

O PDF do certificado **não entra no repositório**, que é público: ele contém nome do
licenciado e código de licença. Estes são dados do titular, não configuração do sistema.
O certificado deve ser guardado com os demais documentos comerciais do projeto.

## Consequências

- Nenhum asset do template (imagens, ícones, fontes, arquivos SCSS) entra no repositório —
  a regra continua valendo, agora por higiene e não por dúvida de licença.
- A fidelidade ao template é de identidade e layout, não pixel a pixel.
- Trocar a identidade visual depois custa alterar um pacote de tokens, não as telas.
- Renovação da assinatura Envato Elements vira item de acompanhamento até o go-live.

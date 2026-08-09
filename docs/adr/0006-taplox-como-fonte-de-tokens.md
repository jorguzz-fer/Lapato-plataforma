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

## Consequências

- **Pendência para o dono do produto:** como o LAPATO é SaaS multi-instituição, uma licença
  Regular de marketplace não cobre este uso — seria necessária a Extended License.
  Extrair apenas tokens (cores, tipografia, métricas — que não são obra protegível da mesma
  forma que o código e os assets) reduz muito a exposição, mas a licença adquirida precisa
  ser confirmada. Enquanto não for, nenhum asset do template (imagens, ícones, fontes,
  arquivos SCSS) entra no repositório.
- A fidelidade ao template é de identidade e layout, não pixel a pixel.
- Trocar a identidade visual depois custa alterar um pacote de tokens, não as telas.

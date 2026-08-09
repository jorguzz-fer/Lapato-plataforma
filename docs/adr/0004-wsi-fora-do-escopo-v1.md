# ADR 0004 — Whole Slide Imaging fora do escopo da v1

- Status: aceito
- Data: 2026-08-09

## Contexto

O nome oficial do Módulo 16 nas DIRETRIZES §6 é **"Imagens e Scanner de Lâminas"**. Porém a
documentação do próprio módulo (arquivo `MÓDULO 15 Imagens e acervo digital.docx`, §3 e
§133) exclui explicitamente desta versão: scanner automatizado de lâminas, *whole slide
imaging*, *stitching*, navegação em lâmina virtual, digitalização automatizada,
processamento de arquivos WSI, plataforma completa de patologia digital e diagnóstico
automático por imagem — indicando que poderão constituir um módulo independente no futuro.

Há, portanto, um conflito entre o nome do módulo e o escopo declarado.

Reforçando a exclusão, o `MÓDULO 10 Laudos e microscopia.docx` afirma que a digitalização de
lâminas **não é requisito obrigatório**: o sistema deve funcionar plenamente com microscópio
físico e a estação LAPATO.

## Opções consideradas

1. **Implementar WSI já na v1** — atenderia ao nome oficial.
   Contras: arquivos de dezenas de GB por lâmina, pirâmide de tiles, servidor de deep zoom,
   custo de storage e banda altíssimo. Contraria o escopo que a própria doc definiu e o
   princípio de simplicidade do Blueprint §0.
2. **Deixar WSI fora da v1, com o modelo preparado** — implementar o repositório de imagens
   (fotografia macro, microfotografia, documentos) e deixar o tipo de imagem extensível.
3. **Ignorar o tema** — cria retrabalho quando WSI entrar.

## Decisão

Opção 2. **WSI fica fora do escopo da v1.**

- O Módulo 16 é implementado como repositório central de imagens: fotografia de
  recebimento e triagem, macroscopia, microfotografia, documentos.
- `imagem.tipo` é um enum extensível; um valor `whole_slide` pode ser acrescentado sem
  alterar a modelagem de casos, versões e anotações.
- O contrato de imagem já prevê `hash_original`, versões (original / trabalho / publicada) e
  anotações em camada separada, que continuam válidos para WSI.
- O nome do módulo permanece o oficial ("Imagens e Scanner de Lâminas"), com esta ADR
  registrando que a parte de scanner é fase futura.

## Consequências

- Nenhuma dependência de biblioteca de WSI (OpenSlide, servidores de tile) entra agora.
- Quando WSI for priorizado, provavelmente será um serviço próprio, dado o perfil de
  storage e CPU — o que o event bus já permite sem refatorar o núcleo.
- Recursos que dependem de lâmina digitalizada (segunda opinião remota, telepatologia,
  marcação de ROI em lâmina virtual, contagem assistida por imagem) ficam adiados junto.

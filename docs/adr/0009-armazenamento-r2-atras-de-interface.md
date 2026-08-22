# ADR 0009 — Armazenamento de arquivos: Cloudflare R2, atrás de uma interface

- Status: aceito
- Data: 2026-08-22

## Contexto

O M11 precisa gravar o PDF assinado do laudo (ADR 0005: o PDF é derivado do dado
estruturado, congelado com hash no momento da assinatura — os mesmos bytes têm que voltar
em toda releitura). O M16 (Imagens e Scanner de Lâminas) vai precisar do mesmo tipo de
armazenamento para os arquivos de imagem, com o mesmo requisito de "original nunca
sobrescrito" (ADR 0004).

Opções de onde gravar o PDF: coluna `bytea` no Postgres, ou um object storage
S3-compatível. E, se for object storage, qual provedor.

## Opções consideradas

1. **`bytea` no Postgres.** Simples, sem serviço extra. Contras: infla o banco com binário
   que não participa de índice nem de RLS por linha da forma que os outros dados fazem;
   backup e replicação do banco carregam o peso de todo PDF já emitido; o M16 (imagens,
   potencialmente grandes) tornaria isso pior.
2. **Object storage S3-compatível, provedor a escolher.** Separa dado binário de dado
   relacional; a maioria dos provedores oferece bucket privado e SDK compatível com S3.
3. **Dentro da opção 2, Cloudflare R2 especificamente.** Escolha explícita do dono do
   produto. R2 não cobra egresso — relevante porque o PDF do laudo é baixado repetidamente
   pelo mesmo pequeno arquivo (quem assina, quem revisa, e mais tarde o Portal do Cliente do
   M04).

## Decisão

Opções 2 e 3.

- `StorageProvider` (`apps/api/src/core/storage/storage.provider.ts`) é a interface que os
  serviços de domínio conhecem: `salvar(chave, dados, mimeType)` e `baixar(chave)`. Nenhum
  provedor devolve URL pública — quem baixa passa pela API, que decide se autoriza
  (DIRETRIZES/Blueprint §6: bucket privado, sem acesso público direto).
- `StorageFactory` seleciona o provedor por `STORAGE_PROVIDER`, no mesmo padrão do
  `CopilotoFactory` (ADR 0007): `local` (disco, padrão de dev/teste, sem credencial) ou `r2`
  (Cloudflare, via `@aws-sdk/client-s3` contra o endpoint S3-compatível do R2).
- O provedor R2 não é gerenciado pelo Nest (`@Injectable`) de propósito — construir o
  `S3Client` exige as quatro credenciais, e um provider do Nest é instanciado na subida do
  módulo mesmo quando `STORAGE_PROVIDER=local`. A `StorageFactory` o cria sob demanda, só
  quando `STORAGE_PROVIDER=r2`, para o ambiente local nunca precisar da credencial.
- `STORAGE_PROVIDER=r2` sem as quatro variáveis (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`) impede a subida — `carregarEnv()` falha alto e cedo,
  mesmo padrão do `COPILOT_PROVIDER=claude` sem `ANTHROPIC_API_KEY`.
- Chave de objeto do PDF: `laudos/{tenantId}/{versaoId}.pdf` — namespace por tenant já no
  caminho, ainda que o isolamento de acesso de verdade seja decidido pela API, não pelo
  bucket.

## Consequências

- Trocar de backend S3-compatível no futuro (ou voltar para outro provedor) não toca os
  serviços de domínio — eles só conhecem `StorageProvider`.
- Dev e CI nunca precisam de credencial de nuvem: `STORAGE_PROVIDER=local` é o padrão, os
  arquivos vão para `.storage-local/` (git-ignorado), e a suíte de testes já produz e lê PDF
  real por esse caminho.
- O M16 reaproveita o mesmo bucket e a mesma interface — não é uma decisão de storage nova,
  é a mesma decisão aplicada a um segundo tipo de arquivo.
- Custo: uma indireção a mais (`StorageFactory.criar()`) em troca de nunca acoplar domínio a
  SDK de nuvem.

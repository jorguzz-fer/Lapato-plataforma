# Auditoria de dependências — 20/11/2026

Rodada estreita, só de dependências: o passo **SCA, SAST e secret scanning** da CI
(`pnpm audit --audit-level high`) estava vermelho no `main` e em todo PR desde
novembro. Nenhum achado vinha de código do LAPATO — eram 13 advisories publicados
depois do último build verde (09/09), em dependências diretas e transitivas.

**Resultado:** `pnpm audit` limpo em todas as severidades, inclusive `moderate`.
Suíte igual ao baseline: 78 shared, 34 db, 226 api.

Um commit por etapa, em ordem de risco crescente, para que um `git bisect` futuro
caia num escopo legível.

## 1. Transitivos — 10 dos 13 advisories

Um `pnpm update` rerresolveu o lockfile **dentro dos ranges que os pais já
declaravam**. Nenhum override novo foi necessário:

| Pacote            | De → Para       | Severidade  | Pai e range que já permitia           |
| ----------------- | --------------- | ----------- | ------------------------------------- |
| `proxy-addr`      | 2.0.7 → 2.0.8   | 🔴 critical | express 5.2.1 declara `^2.0.7`        |
| `shell-quote`     | 1.10.0 → 1.12.0 | 🔴 critical | gel 2.2.0 declara `^1.8.1`            |
| `body-parser`     | 2.3.0 → 2.4.0   | 🟠 high     | express 5.2.1 declara `^2.2.1`        |
| `multer`          | 2.3.0 → 2.5.0   | 🟠 high     | via `@nestjs/platform-express` 11.2.x |
| `brace-expansion` | 1.1.18 → 1.1.22 | 🟠 high     | minimatch 3 declara `^1.1.7`          |
| `brace-expansion` | 5.0.9 → 5.0.13  | 🟠 high     | minimatch 10 declara `^5.0.8`         |
| `source-map-js`   | 1.2.1 → 1.2.4   | 🟠 high     | via postcss 8.5.33                    |
| `vite`            | 6.4.3 → 6.4.6   | 🟠 high     | o próprio `^6.4.3` já declarado       |

Duas correções ao diagnóstico inicial:

- **O Vite não precisou do major.** O advisory pede `>=6.4.4` e a linha 6.4.x tem
  6.4.6. Nada de Vite 7/8.
- **O `express` continua em 5.2.1 de propósito.** O `@nestjs/platform-express`
  fixa a versão exata, e `proxy-addr`/`body-parser` ficaram corrigidos dentro dos
  ranges que o próprio express 5.2.1 declara. Forçar express por override seria
  risco sem ganho.

Os **pisos** de `multer` e `vite` nos `pnpm.overrides` subiram para a versão
corrigida (`^2.5.0`, `^6.4.4`). O override já forçava a árvore, mas com o piso
antigo uma rerresolução futura podia voltar para uma versão vulnerável e a CI só
acusaria depois. Os ranges declarados nos manifests ficaram intactos: correção de
segurança não é hora de atualizar toolchain.

## 2. Vitest 3.2.7 → 4.1.12 — os dois críticos restantes

`GHSA-5gmw-xhrv-c9v3` e `GHSA-85c8-ppgw-ccpr`: prototype pollution no **tinypool**,
levando a RCE. O tinypool entrava como dependência do vitest 3 (`^1.1.1`, resolvido
em 1.1.1; o advisory pede `>=2.1.2`). Não havia correção no lugar — o range do
vitest 3 nem alcança a linha 2.x, e um override cruzaria um major de biblioteca que
o vitest consome direto.

O vitest 4 resolve **por subtração**: deixou de depender de tinypool, que não existe
mais na árvore. De passagem, `@vitest/mocker` vai a 4.1.12 (o advisory pedia
`>=4.1.11`).

Custo real: zero linha de código. A suíte usa três APIs do vitest (`vi.spyOn`,
`expect.arrayContaining`, `expect.assertions`), estáveis no v4, e o único
`vitest.config.ts` (apps/api, SWC no runner por causa do `emitDecoratorMetadata`
que o NestJS exige) não usa opção removida. Nada de `workspace`, que o v4 trocou
por `projects`. O Vite segue em 6.4.6: o vitest 4.1.x aceita `vite ^6 || ^7 || ^8`.

## 3. Zod 3 → 4.6.7 — o único em código de produção

`GHSA-mrhx-c7xc-m3w5`: o zod pode esgotar memória validando coleções restritas
superdimensionadas. Pede `>=4.6.6`.

O major custou menos do que a auditoria previa. A migração inteira são **13
chamadas de `z.record`**, que no v4 passou a exigir os dois argumentos:

```
z.record(z.unknown())  ->  z.record(z.string(), z.unknown())   (12x)
z.record(z.string())   ->  z.record(z.string(), z.string())    ( 1x)
```

Mesmo tipo resultante (`Record<string, ...>`), nenhuma mudança de semântica.

O que se esperava quebrar e não quebrou:

- `superRefine` + `ctx.addIssue` continuam na API pública e preservam `path` e
  `message`. As **64 mensagens em português são todas customizadas** (segundo
  argumento do validador ou `addIssue`) — nenhuma se perdeu.
- `z.ZodIssueCode` ainda existe no 4.6.7 e ainda tem `custom`. Os 8 usos ficaram
  como estavam.
- `resultado.error.issues` já era o nome certo (saiu o `.errors` do v3), então
  `core/http/validacao.ts` e `core/config/env.ts` não mudaram uma linha.

### 3.1 🟡 Pendência de produto: as 314 mensagens padrão

As mensagens **padrão** do zod foram todas reescritas no v4, e **314 validadores
dependem delas**. Elas chegam à tela pelo `ErroApi.detalhe`. Continuam em inglês,
como já eram no v3 — o que muda é a redação:

| v3                                                      | v4                                                   |
| ------------------------------------------------------- | ---------------------------------------------------- |
| `Required`                                              | `Invalid input: expected string, received undefined` |
| `String must contain at least 1 character(s)`           | `Too small: expected string to have >=1 characters`  |
| `Number must be greater than or equal to 1`             | `Too small: expected number to be >=1`               |
| `Invalid enum value. Expected 'x' \| 'y', received 'z'` | `Invalid option: expected one of "x"\|"y"`           |
| `Invalid email`                                         | `Invalid email address`                              |

O comportamento é idêntico: mesma recusa, mesmo campo em `errors[].campo`, mesmo 400. Só o texto muda, e nenhum teste afirma sobre mensagem gerada pelo zod.

Verificado na imagem de producao (`pnpm deploy --prod`, `NODE_ENV=production`),
com `POST /api/v1/auth/login` e corpo `{"email": 123}`. O contrato RFC 7807
continua igual -- o que muda e so o texto de `mensagem`:

```json
{
  "type": "https://lapato.app/erros/400",
  "title": "Dados inválidos",
  "status": 400,
  "detail": "O corpo da requisição não passou na validação.",
  "errors": [
    { "campo": "instituicao", "mensagem": "Invalid input: expected string, received undefined" },
    { "campo": "email", "mensagem": "Invalid input: expected string, received number" },
    { "campo": "senha", "mensagem": "Invalid input: expected string, received undefined" }
  ]
}
```

No zod 3 esses tres leriam, na ordem: `Required`,
`Expected string, received number`, `Required`.

**Decisão em aberto.** O v4 traz `z.config(z.locales.pt())`, que poria essas 314 em
português numa linha. Ficou fora desta rodada porque é decisão de produto, não
correção de segurança — e porque trocar 314 strings visíveis merece commit próprio,
não carona num PR de CVE. Um sistema em português mostrando `Too small: expected
string to have >=1 characters` é dívida de UX que já existia antes deste PR; o que
mudou é que agora está documentada.

## 4. Como reproduzir a verificação

```
pnpm install --frozen-lockfile
pnpm lint && pnpm typecheck && pnpm build
pnpm db:migrate && pnpm db:seed
pnpm test
pnpm --filter @lapato/web build
pnpm audit --audit-level high
```

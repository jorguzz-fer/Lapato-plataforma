# ADR 0011 — A API aplica as migrations ao subir

- Status: aceito
- Data: 2026-11-23
- Revisa: ADR 0010, na opção 3 ("aplicar as migrations automaticamente na subida da API"),
  que lá foi rejeitada. O restante do ADR 0010 — a API recusar subir com o banco
  desatualizado — continua valendo.

## Contexto

O ADR 0010 deixou as migrations a cargo do **Pre-deployment Command** do Coolify e criou o
guarda que impede a API de subir com migration pendente. O guarda funciona. O pré-deploy
nunca fez o que o ADR 0010 e a `docs/deploy-coolify.md` presumiam.

O log do deploy de 23/11/2026 mostra por quê:

```
15:34:07  Executing pre-deployment command
15:34:10  Importing jorguzz-fer/Lapato-plataforma:main (commit 259f6f8)
15:34:15  Building docker image started
15:37:05  New container started
15:37:10  Banco desatualizado: 9 de 31 migrations pendentes (0022_..., 0030_...)
15:37:56  New container is not healthy, rolling back to the old container.
```

O pré-deploy roda **dentro do container que já está no ar**, antes de o commit novo sequer
ser importado. O `migrate.js` que ele executa é o da versão **antiga**, que só conhece as
migrations antigas: não aplica nada e termina com sucesso. O container novo esbarra no
guarda, o Coolify volta para o anterior, e o deploy seguinte repete tudo. Toda versão com
migration nova fica travada para sempre.

Produção ficou parada na migration `0021` desde 20/11. O front, publicado numa imagem
separada, seguiu em frente — e a tela de chegada derrubou o sistema para todos os usuários
ao ler um campo que a API antiga não mandava (o PR #104 fez a tela sobreviver a isso; não
resolve a causa).

O mesmo mecanismo explica os incidentes anteriores: as "cinco migrations atrasadas" que
motivaram o PR #96 (descritas em `apps/api/src/migrations-guarda.test.ts`) e, muito
provavelmente, a coluna `miniatura_chave` de 23/08 que motivou o ADR 0010. Só o de 23/11 tem
log que prove. O ponto é que o pré-deploy **não estava mal configurado; estava no lugar
errado**. O #96 consertou o guarda, que passou a bloquear de verdade — e, com isso,
converteu uma quebra silenciosa numa trava permanente.

## Opções consideradas

1. **Manter o pré-deploy.** Impossível: ele não enxerga o código novo.
2. **Post-deployment Command.** Roda no container novo, mas só depois de ele ficar saudável
   — e ele nunca fica, porque o guarda o recusa antes. Mesma trava.
3. **Um passo de migração separado, com a imagem nova, antes da API** — uma pilha Compose
   com um serviço `migrate` de execução única e `api` dependendo dele com
   `condition: service_completed_successfully`. Preserva tudo o que o ADR 0010 defende, mas
   muda a forma de publicar os três aplicativos; recursos separados no Coolify não têm
   ordem garantida entre si.
4. **O container da API migra ao subir, antes de a aplicação iniciar.** É a opção que o ADR
   0010 rejeitou, por três motivos. Revistos um a um:
   - _"Com mais de uma réplica, duas instâncias migram ao mesmo tempo."_ Procede, e foi
     reproduzido: dois `migrate.js` simultâneos num banco vazio, e em três de três rodadas
     um deles morre em `duplicate key value violates unique constraint
"pg_type_typname_nsp_index"` — o drizzle não se protege disso. Resolvido com uma trava
     consultiva no `migrate.js`: o segundo espera o primeiro e encontra tudo aplicado.
   - _"Migration destrutiva rodaria sem ninguém decidir."_ O desenho do pré-deploy tinha a
     mesma propriedade — rodaria qualquer migration no deploy, sem ninguém olhando. A
     decisão acontece na revisão do PR, e a regra de compatibilidade do ADR 0010 continua
     obrigatória. Não piora o que já se pretendia.
   - _"O processo da aplicação passaria a rodar com o usuário dono do schema."_ Não passa: a
     migração roda num **processo separado**, que termina antes de a API começar; a API
     continua conectando só com `DATABASE_URL`. A credencial do dono fica no ambiente do
     container — onde já estava, porque o pré-deploy precisava dela —, mas **não chega ao
     processo da API**: o `CMD` a remove com `env -u` antes de iniciar o node (ver a nota
     abaixo).

## Decisão

**Opção 4.** O `CMD` da imagem da API passa a ser:

```sh
node node_modules/@lapato/db/dist/cli/migrate.js && exec node dist/main.js
```

- **`&&`**: migration que falha impede a API de subir. O healthcheck não passa e o Coolify
  mantém a versão anterior no ar, coerente com o banco — o drizzle aplica as migrations
  pendentes numa transação só, desfeita inteira se algo falhar.
- **`exec`**: o node vira o PID 1 e recebe o `SIGTERM` do rolling update.
- **`env -u DATABASE_MIGRATION_URL`**: a URL do dono sai do ambiente antes de o node da
  API nascer.

  > **Nota da terceira auditoria de segurança (23/11/2026).** A primeira versão deste
  > `CMD` era `... && exec node dist/main.js`. O `exec` repassa o ambiente inteiro, e o
  > processo que atende a internet ficava com a credencial do dono em `process.env`. No
  > Postgres do Coolify o dono é o `POSTGRES_USER` da imagem — superusuário, que ignora o
  > RLS mesmo com `FORCE`. Qualquer falha que expusesse o ambiente da API entregaria o
  > banco de todas as instituições. O que este ADR afirmava ("a API continua conectando
  > só com `DATABASE_URL`") era verdade sobre a conexão e falso sobre o alcance.
- **`DATABASE_MIGRATION_URL` é obrigatória.** Sem ela o `migrate.js` falha com mensagem
  explícita e a API não sobe. Pular a migration em silêncio recriaria exatamente o problema
  que o ADR 0010 descreve.
- **Trava consultiva** (`pg_advisory_lock`) no `migrate.js`, na conexão única que ele usa.
  Cobre a transação do drizzle e a aplicação das políticas de RLS, que também mexem no
  catálogo. Fechar a conexão libera a trava, inclusive quando algo falha no meio.
- **O guarda do ADR 0010 fica**: é a defesa para quem iniciar a imagem com outro comando, e
  continua reportando o estado em `/health`.
- **O Pre-deployment Command sai** do `lapato-api` no Coolify. Mantido, ele não quebra nada
  — roda o `migrate.js` antigo, que não aplica nada —, mas documenta um passo que não
  acontece.

## Consequências

- Deploy com migration nova passa a funcionar num passo só, sem ação manual.
- **Rollback continua possível.** O `migrate.js` da imagem antiga encontra o banco à frente e
  não aplica nada (o drizzle só aplica o que é mais novo que o último registro do banco); o
  guarda só conta como pendente o que o código conhece e o banco não tem. A regra de
  compatibilidade do ADR 0010 continua sendo o que torna o rollback seguro.
- **O tempo da migração conta contra o healthcheck** (`start-period` de 20 s, depois três
  tentativas a cada 30 s). Migration de esquema leva segundos. Uma migração de dados longa
  precisa rodar antes do deploy, à mão, com o mesmo `migrate.js`.
- O worker não migra. A §6 da `docs/deploy-coolify.md` já manda publicar a API antes dele.
- O `docker compose` local não muda: o `.env.example` já traz `DATABASE_MIGRATION_URL`
  apontando para o serviço `postgres`.

## Como foi verificado

Sem Docker, com o pacote montado exatamente como a etapa de build da imagem
(`pnpm deploy --filter @lapato/api --prod --legacy`) e o comando **extraído do próprio
`Dockerfile.api`**, contra um banco levado ao estado de produção (migrations até a `0021`):

| Cenário                                                                                            | Resultado                                                                                        |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `CMD` antigo (`node dist/main.js`), banco na `0021`                                                | não sobe: `Banco desatualizado: 9 de 31 migrations pendentes` — a mesma linha do log de produção |
| `CMD` novo, mesmo banco                                                                            | aplica as nove, sobe em modo produção, `/health` com `schema: ok`                                |
| `CMD` novo de novo (reinício)                                                                      | nada a aplicar, sobe                                                                             |
| journal cortado na `0021` (o caminho de migração e guarda de um rollback) contra o banco na `0030` | nada a aplicar, guarda passa, sobe                                                               |
| sem `DATABASE_MIGRATION_URL`                                                                       | `exit 1` com `DATABASE_MIGRATION_URL nao definida`; a porta nunca abre                           |

A trava tem teste (`packages/db/src/migrate-trava.test.ts`): dois `migrate.js` simultâneos
num banco descartável. Passa com a trava; removida a trava, falha com o mesmo
`duplicate key ... pg_type_typname_nsp_index`.

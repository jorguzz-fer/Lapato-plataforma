# ADR 0010 — A API recusa subir com o schema do banco desatualizado

- Status: aceito
- Data: 2026-08-23

## Contexto

Em 23/08/2026, no primeiro uso real da plataforma, todo upload de imagem em produção
devolvia 500. A causa: o código do M16 tinha subido com a coluna `imagem.miniatura_chave`,
mas a migration `0003_messy_firedrake` nunca foi aplicada no banco de produção. A API
subiu normalmente, respondeu ao healthcheck como saudável, aceitou login e navegação — e só
quebrou no primeiro request que tocou a coluna inexistente.

O usuário viu "Ocorreu um erro inesperado". A causa real só apareceu depois, no log do
Postgres, dentro de um `select ... "miniatura_chave" ...`.

Dois problemas se somaram:

1. **O deploy não aplicou a migration.** O Pre-deployment Command do Coolify roda
   `migrate.js`; se ele não estiver configurado, ou se `DATABASE_MIGRATION_URL` faltar no
   aplicativo, o passo simplesmente não acontece — sem erro visível, porque o deploy do
   código continua funcionando.
2. **A API aceitou o banco desatualizado em silêncio.** Este é o problema estrutural, e é
   o que esta ADR trata. O item 1 é configuração e pode falhar de novo; o item 2 é o que
   transforma essa falha de configuração numa quebra invisível em produção.

Vale notar o que já existia e não bastou: o `carregarEnv` derruba o processo se faltar
`SESSION_SECRET`, e o healthcheck consulta o banco. Ou seja, a subida já falha fechada para
configuração — só não fazia isso para o schema.

## Opções consideradas

1. **Não fazer nada; confiar no pré-deploy.** É o estado que produziu o incidente. O
   pré-deploy é um campo de texto numa interface web: quem reconfigura o aplicativo, cria um
   ambiente novo ou restaura um backup pode perdê-lo sem perceber.
2. **Subir e avisar no log.** Detecta, mas não impede. Em produção ninguém está lendo o log
   de subida no momento do deploy; o sinal chega junto com o 500 do usuário, tarde demais.
3. **Aplicar as migrations automaticamente na subida da API.** Tentador e errado. Com mais
   de uma réplica, duas instâncias migram ao mesmo tempo; migration destrutiva rodaria sem
   ninguém decidir; e o processo da aplicação passaria a rodar com o usuário dono do schema,
   contrariando a separação de `DATABASE_URL` e `DATABASE_MIGRATION_URL` (ADR 0002).
4. **Recusar subir quando houver migrations pendentes.** O deploy falha alto, no momento em
   que quem deu deploy está olhando, e o Coolify mantém a versão anterior no ar — que está
   coerente com o banco que existe.

## Decisão

**Opção 4, com válvula de escape.**

Na subida, antes do `listen`, a API compara o journal de migrations do pacote `@lapato/db`
com a tabela `drizzle.__drizzle_migrations` do banco:

- **pendentes > 0** → o processo morre com a lista das migrations que faltam e o comando que
  as aplica.
- **`MIGRACOES_PENDENTES=avisar`** → sobe e loga. Emergência (por exemplo, precisar da API
  no ar para consultar dados enquanto a migration não pode rodar), não configuração normal.
- **estado indeterminado** (a role da aplicação ainda não tem `SELECT` na tabela de
  controle) → sobe e loga o aviso. Não se derruba produção por não conseguir verificar.

A checagem fica **antes do `listen`** de propósito: um container que já responde healthcheck
recebe tráfego do proxy antes de a verificação terminar.

O `/health` passa a devolver `schema: 'ok' | 'desatualizado' | 'indeterminado'`, para que o
estado continue visível depois da subida — em particular quando alguém ligou `avisar`.

A comparação usa o carimbo `created_at` de cada migration, não a contagem: assim também
detecta o banco **à frente** do código, que é o que acontece num rollback do container sem
rollback do banco.

## Consequências

- Deploy com migration esquecida falha no deploy, com a versão anterior ainda no ar, em vez
  de falhar no primeiro usuário.
- A role da aplicação ganha `USAGE` no schema `drizzle` e `SELECT` na tabela de controle.
  É leitura de metadado de migration; nenhum dado de domínio, nenhuma escrita.
- O grant é aplicado pelo próprio `migrate.js`. Enquanto ele não rodar uma vez com esta
  versão, a checagem responde `indeterminado` e apenas avisa.
- A regra de compatibilidade continua valendo e não é substituída por esta ADR: toda
  migration precisa ser compatível com a versão anterior do código (coluna nova sempre
  opcional, criar antes de remover, nunca renomear em um passo só). Esta checagem protege
  contra a migration que **não rodou**; não torna segura a migration destrutiva.

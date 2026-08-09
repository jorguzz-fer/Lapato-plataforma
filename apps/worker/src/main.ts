import { and, eq, sql } from 'drizzle-orm';
import {
  comTenant,
  criarConexao,
  eventoDominio,
  notificacaoPendente,
  outboxEvento,
} from '@lapato/db';

/**
 * Worker de eventos de dominio.
 *
 * Blueprint secao 3: fluxos assincronos com retry, back-off e dead-letter.
 * DIRETRIZES secao 17: liberar um laudo dispara consequencias - notificar,
 * atualizar indicadores, alimentar auditoria. Quem executa isso e este processo,
 * fora do request do usuario.
 *
 * O worker le `outbox_evento`, que fica FORA da RLS por nao conter dado de
 * dominio (so FK e estado de retry). Ao tocar em qualquer dado real, abre
 * `comTenant` com o tenant da propria linha - o isolamento continua valendo.
 */

const INTERVALO_MS = 2_000;
const LOTE = 50;
const MAX_TENTATIVAS = 5;

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL nao definida.');

const { db, encerrar } = criarConexao({ url, max: 4 });

let rodando = true;

/** Back-off exponencial com teto de 5 minutos. */
function proximaTentativa(tentativas: number): Date {
  const segundos = Math.min(2 ** tentativas * 5, 300);
  return new Date(Date.now() + segundos * 1000);
}

async function processarLote(): Promise<number> {
  /**
   * `FOR UPDATE SKIP LOCKED` permite rodar varias replicas do worker sem que
   * duas peguem o mesmo evento - cada uma leva o que estiver livre.
   */
  const pendentes = await db.execute<{
    id: string;
    evento_id: string;
    tenant_id: string;
    tentativas: number;
  }>(sql`
    SELECT id, evento_id, tenant_id, tentativas
    FROM outbox_evento
    WHERE status = 'pendente'
      AND proxima_tentativa_em <= now()
    ORDER BY criado_em
    LIMIT ${LOTE}
    FOR UPDATE SKIP LOCKED
  `);

  const linhas = Array.from(pendentes);
  if (linhas.length === 0) return 0;

  for (const linha of linhas) {
    try {
      await comTenant(db, linha.tenant_id, async (tx) => {
        const [evento] = await tx
          .select()
          .from(eventoDominio)
          .where(eq(eventoDominio.id, linha.evento_id))
          .limit(1);

        if (!evento) {
          // Evento sumiu (tenant removido, por exemplo): nada a reprocessar.
          return;
        }

        await despachar(evento.tipo, evento, tx);
      });

      await db
        .update(outboxEvento)
        .set({ status: 'processado', processadoEm: new Date() })
        .where(eq(outboxEvento.id, linha.id));
    } catch (erro) {
      const tentativas = linha.tentativas + 1;
      const esgotou = tentativas >= MAX_TENTATIVAS;

      await db
        .update(outboxEvento)
        .set({
          // Dead-letter: para de tentar e fica visivel para investigacao.
          status: esgotou ? 'falhou' : 'pendente',
          tentativas,
          proximaTentativaEm: proximaTentativa(tentativas),
          ultimoErro: erro instanceof Error ? erro.message : String(erro),
        })
        .where(eq(outboxEvento.id, linha.id));

      console.error(
        `evento ${linha.evento_id} falhou (tentativa ${tentativas}${esgotou ? ', dead-letter' : ''}):`,
        erro instanceof Error ? erro.message : erro,
      );
    }
  }

  return linhas.length;
}

/**
 * Consequencias de cada evento.
 *
 * Hoje cobre o que a fatia vertical exige. Quando o M26 for documentado, este
 * despacho passa a montar mensagem e escolher canal de verdade; a estrutura de
 * outbox e retry ja esta pronta para isso.
 */
async function despachar(
  tipo: string,
  evento: typeof eventoDominio.$inferSelect,
  _tx: unknown,
): Promise<void> {
  switch (tipo) {
    case 'laudo.liberado':
      // A notificacao ja foi enfileirada pelo M11 na mesma transacao da
      // liberacao; aqui apenas registramos o processamento do evento.
      console.warn(`[M26] laudo liberado no caso ${evento.casoId}; notificacao enfileirada.`);
      break;

    case 'triagem.bloqueada':
    case 'material.recusado':
      console.warn(`[M26] pendencia de triagem no caso ${evento.casoId}.`);
      break;

    default:
      // Evento sem consequencia assincrona: ja cumpriu seu papel na linha do
      // tempo. Nao e erro.
      break;
  }
}

/** Envio das notificacoes pendentes. Adaptador real entra com o M26. */
async function processarNotificacoes(): Promise<number> {
  const pendentes = await db.execute<{ id: string; tenant_id: string; canal: string }>(sql`
    SELECT id, tenant_id, canal
    FROM notificacao_pendente
    WHERE status = 'pendente'
    ORDER BY criado_em
    LIMIT ${LOTE}
    FOR UPDATE SKIP LOCKED
  `);

  const linhas = Array.from(pendentes);

  for (const linha of linhas) {
    await comTenant(db, linha.tenant_id, async (tx) => {
      // Adaptador de log: os canais reais (e-mail, WhatsApp) pertencem ao M26,
      // que ainda nao tem documentacao.
      console.warn(`[M26] notificacao ${linha.id} via ${linha.canal} (adaptador de log)`);

      await tx
        .update(notificacaoPendente)
        .set({ status: 'enviada', enviadaEm: new Date() })
        .where(
          and(
            eq(notificacaoPendente.id, linha.id),
            eq(notificacaoPendente.tenantId, linha.tenant_id),
          ),
        );
    });
  }

  return linhas.length;
}

async function loop(): Promise<void> {
  console.warn('worker iniciado.');

  while (rodando) {
    try {
      const eventos = await processarLote();
      const notificacoes = await processarNotificacoes();

      // Só dorme quando não havia nada; com fila cheia, segue direto.
      if (eventos === 0 && notificacoes === 0) {
        await new Promise((r) => setTimeout(r, INTERVALO_MS));
      }
    } catch (erro) {
      console.error('erro no ciclo do worker:', erro);
      await new Promise((r) => setTimeout(r, INTERVALO_MS));
    }
  }
}

/** Encerramento gracioso: termina o ciclo em curso antes de sair. */
for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sinal, () => {
    console.warn(`${sinal} recebido; encerrando...`);
    rodando = false;
  });
}

loop()
  .then(() => encerrar())
  .catch(async (erro: unknown) => {
    console.error('worker encerrou com erro:', erro);
    await encerrar();
    process.exit(1);
  });

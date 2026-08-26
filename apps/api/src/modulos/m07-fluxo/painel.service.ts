import { Injectable } from '@nestjs/common';
import { and, count, eq, gte, inArray, notInArray, sql } from 'drizzle-orm';
import { caso, estadoCaso, tenant } from '@lapato/db';
import {
  ETAPAS_EM_ANDAMENTO,
  ETAPAS_ENCERRADAS,
  ETAPA_LABEL,
  PERMISSOES,
  diaLocalIso,
  fusoDaInstituicao,
  inicioDoDia,
  type Etapa,
  type Permissao,
} from '@lapato/shared';
import { DbService } from '../../core/db/db.service.js';
import { exigirContexto } from '../../core/contexto/contexto-requisicao.js';
import { SolicitacoesService } from '../m10-solicitacoes/solicitacoes.service.js';
import { CadaveresService } from '../m15-cadaveres/cadaveres.service.js';
import { BiotecaService } from '../m18-bioteca/bioteca.service.js';

/** Dias da serie diaria de entradas x liberacoes. */
const DIAS_DA_SERIE = 14;
/** Janela usada para o tempo medio de liberacao. */
const DIAS_DA_MEDIA = 30;

export interface ItemDeAtencao {
  chave: string;
  rotulo: string;
  /** O que fazer com o numero, em uma frase. */
  detalhe: string;
  total: number;
  /** Rota que resolve o item. Sempre uma tela em que o usuario pode AGIR. */
  para: string;
  nivel: 'critico' | 'atencao' | 'informacao';
}

export interface Painel {
  geradoEm: string;
  fuso: string;
  volumetria: {
    emAndamento: number;
    entraramHoje: number;
    liberadosHoje: number;
    /** Media de dias corridos entre cadastro e liberacao, na janela recente. */
    tempoMedioDias: number | null;
    diasDaMedia: number;
  };
  atencao: ItemDeAtencao[];
  funil: { etapa: Etapa; rotulo: string; total: number }[];
  serie: { dia: string; entradas: number; liberacoes: number }[];
}

/**
 * M07 - painel de chegada.
 *
 * Nao e uma segunda Central de Casos. A Central responde "onde esta o caso X";
 * o painel responde **"o que precisa de mim agora"** e da tamanho ao dia. Por
 * isso todo item da faixa de atencao carrega uma rota: numero que nao leva a
 * lugar nenhum vira decoracao, e o M07 secao 3 pede indicadores acionaveis.
 *
 * Os numeros de fora do M07 nao sao consultados aqui: cada modulo dono responde
 * pelo seu (`resumoPainel()`), como manda a DIRETRIZ de proprietario unico. E
 * cada bloco so aparece se o usuario tiver a permissao que o deixa AGIR sobre
 * ele - mostrar "3 cadaveres aguardando liberacao" para quem nao pode liberar
 * so produz ansiedade.
 */
@Injectable()
export class PainelService {
  constructor(
    private readonly db: DbService,
    private readonly solicitacoes: SolicitacoesService,
    private readonly cadaveres: CadaveresService,
    private readonly bioteca: BiotecaService,
  ) {}

  async montar(): Promise<Painel> {
    const ctx = exigirContexto();
    const pode = (permissao: Permissao) => ctx.permissoes.has(permissao);
    const agora = new Date();

    const fuso = await this.fusoDoTenant();
    const inicioDeHoje = inicioDoDia(agora, 0, fuso);
    const inicioDaSerie = inicioDoDia(agora, DIAS_DA_SERIE - 1, fuso);
    const inicioDaMedia = inicioDoDia(agora, DIAS_DA_MEDIA, fuso);

    const doFluxo = await this.db.executar(async (tx) => {
      const [contagens] = await tx
        .select({
          emAndamento: sql<number>`(count(*) filter (where ${notInArray(
            estadoCaso.etapa,
            ETAPAS_ENCERRADAS,
          )}))::int`,
          atrasados: sql<number>`(count(*) filter (
            where ${notInArray(estadoCaso.etapa, ETAPAS_ENCERRADAS)}
              and ${estadoCaso.previsaoLiberacao} < now()
          ))::int`,
          bloqueados: sql<number>`(count(*) filter (
            where ${notInArray(estadoCaso.etapa, ETAPAS_ENCERRADAS)} and ${estadoCaso.bloqueado}
          ))::int`,
          aguardandoAssinatura: sql<number>`(count(*) filter (
            where ${estadoCaso.etapa} = 'aguardando_assinatura'
          ))::int`,
          aguardandoRevisao: sql<number>`(count(*) filter (
            where ${estadoCaso.etapa} = 'aguardando_revisao'
          ))::int`,
          minhaFila: sql<number>`(count(*) filter (
            where ${notInArray(estadoCaso.etapa, ETAPAS_ENCERRADAS)}
              and ${estadoCaso.responsavelId} = ${ctx.usuarioId}
          ))::int`,
          /**
           * A data vai como texto ISO com cast explicito, e nao como `Date`.
           *
           * Dentro de um fragmento `sql` cru nao existe coluna para o Drizzle
           * consultar, entao ele entrega o valor direto ao driver - e o
           * postgres.js so serializa `Date` quando o mapeador da coluna esta no
           * caminho. O sintoma nao e um erro de SQL: e um TypeError de buffer
           * vindo do driver, longe do lugar que causou.
           */
          liberadosHoje: sql<number>`(count(*) filter (
            where ${estadoCaso.etapa} = 'liberado'
              and ${estadoCaso.entrouNaEtapaEm} >= ${inicioDeHoje.toISOString()}::timestamptz
          ))::int`,
        })
        .from(estadoCaso)
        .where(eq(estadoCaso.tenantId, ctx.tenantId));

      const [entradas] = await tx
        .select({ total: count() })
        .from(caso)
        .where(and(eq(caso.tenantId, ctx.tenantId), gte(caso.cadastradoEm, inicioDeHoje)));

      /**
       * Tempo medio em DIAS CORRIDOS, nao uteis.
       *
       * O prazo contratual do M01 conta dias uteis, e o painel nao esta
       * medindo prazo: esta medindo quanto tempo o material passou aqui
       * dentro. Um caso que atravessou o feriado passou o feriado aqui.
       */
      const [media] = await tx
        .select({
          dias: sql<
            number | null
          >`avg(extract(epoch from (${estadoCaso.entrouNaEtapaEm} - ${caso.cadastradoEm})) / 86400)::float8`,
        })
        .from(estadoCaso)
        .innerJoin(caso, eq(caso.id, estadoCaso.casoId))
        .where(
          and(
            eq(estadoCaso.tenantId, ctx.tenantId),
            eq(estadoCaso.etapa, 'liberado'),
            gte(estadoCaso.entrouNaEtapaEm, inicioDaMedia),
          ),
        );

      const porEtapa = await tx
        .select({ etapa: estadoCaso.etapa, total: count() })
        .from(estadoCaso)
        .where(
          and(
            eq(estadoCaso.tenantId, ctx.tenantId),
            inArray(estadoCaso.etapa, ETAPAS_EM_ANDAMENTO),
          ),
        )
        .groupBy(estadoCaso.etapa);

      const entradasPorDia = await tx
        .select({
          dia: sql<string>`to_char((${caso.cadastradoEm} at time zone ${fuso})::date, 'YYYY-MM-DD')`,
          total: count(),
        })
        .from(caso)
        .where(and(eq(caso.tenantId, ctx.tenantId), gte(caso.cadastradoEm, inicioDaSerie)))
        /**
         * `group by 1`, e nao a expressao repetida.
         *
         * Repetir `(... at time zone $n)::date` no GROUP BY gera um placeholder
         * NOVO para o fuso, e o Postgres nao reconhece `$1` e `$2` como a mesma
         * expressao mesmo carregando o mesmo valor - o erro que sai e
         * "must appear in the GROUP BY clause", apontando para a coluna errada.
         */
        .groupBy(sql`1`);

      const liberacoesPorDia = await tx
        .select({
          dia: sql<string>`to_char((${estadoCaso.entrouNaEtapaEm} at time zone ${fuso})::date, 'YYYY-MM-DD')`,
          total: count(),
        })
        .from(estadoCaso)
        .where(
          and(
            eq(estadoCaso.tenantId, ctx.tenantId),
            eq(estadoCaso.etapa, 'liberado'),
            gte(estadoCaso.entrouNaEtapaEm, inicioDaSerie),
          ),
        )
        .groupBy(sql`1`);

      return {
        contagens,
        entradasHoje: entradas?.total ?? 0,
        tempoMedioDias: media?.dias ?? null,
        porEtapa,
        entradasPorDia,
        liberacoesPorDia,
      };
    });

    const atencao: ItemDeAtencao[] = [];
    const c = doFluxo.contagens;

    if (c) {
      this.acrescentar(atencao, {
        chave: 'casos_atrasados',
        rotulo: 'Casos fora do prazo',
        detalhe: 'A previsão de liberação já passou.',
        total: c.atrasados,
        para: '/casos',
        nivel: 'critico',
      });
      this.acrescentar(atencao, {
        chave: 'casos_bloqueados',
        rotulo: 'Casos bloqueados',
        detalhe: 'O fluxo não avança enquanto o bloqueio existir.',
        total: c.bloqueados,
        para: '/casos',
        nivel: 'critico',
      });
      if (pode(PERMISSOES.LAUDO_ASSINAR)) {
        this.acrescentar(atencao, {
          chave: 'aguardando_assinatura',
          rotulo: 'Laudos aguardando assinatura',
          detalhe: 'Prontos; falta a assinatura do responsável.',
          total: c.aguardandoAssinatura,
          para: '/casos?etapa=aguardando_assinatura',
          nivel: 'atencao',
        });
      }
      if (pode(PERMISSOES.LAUDO_REVISAR)) {
        this.acrescentar(atencao, {
          chave: 'aguardando_revisao',
          rotulo: 'Laudos aguardando revisão',
          detalhe: 'Esperando a leitura de um revisor.',
          total: c.aguardandoRevisao,
          para: '/casos?etapa=aguardando_revisao',
          nivel: 'atencao',
        });
      }
      this.acrescentar(atencao, {
        chave: 'minha_fila',
        rotulo: 'Casos sob sua responsabilidade',
        detalhe: 'Em andamento e atribuídos a você.',
        total: c.minhaFila,
        para: '/casos?minhaFila=true',
        nivel: 'informacao',
      });
    }

    if (pode(PERMISSOES.SOLICITACAO_VISUALIZAR)) {
      const m10 = await this.solicitacoes.resumoPainel();
      this.acrescentar(atencao, {
        chave: 'pendencias_bloqueantes',
        rotulo: 'Pendências que travam o fluxo',
        detalhe: 'Bloqueiam total ou parcialmente uma etapa.',
        total: m10.pendenciasBloqueantes,
        para: '/solicitacoes',
        nivel: 'critico',
      });
      this.acrescentar(atencao, {
        chave: 'pendencias_abertas',
        rotulo: 'Pendências abertas',
        detalhe: 'Aguardando resposta de alguém.',
        total: m10.pendenciasAbertas,
        para: '/solicitacoes',
        nivel: 'atencao',
      });
      this.acrescentar(atencao, {
        chave: 'solicitacoes_abertas',
        rotulo: 'Solicitações em aberto',
        detalhe: 'Ainda não concluídas nem canceladas.',
        total: m10.solicitacoesAbertas,
        para: '/solicitacoes',
        nivel: 'informacao',
      });
    }

    if (pode(PERMISSOES.CADAVER_VISUALIZAR)) {
      const m15 = await this.cadaveres.resumoPainel();
      this.acrescentar(atencao, {
        chave: 'cadaveres_bloqueados',
        rotulo: 'Cadáveres com bloqueio ativo',
        detalhe: 'Não podem sair até o bloqueio ser resolvido.',
        total: m15.bloqueados,
        para: '/cadaveres',
        nivel: 'critico',
      });
      this.acrescentar(atencao, {
        chave: 'cadaveres_aguardando_liberacao',
        rotulo: 'Cadáveres aguardando liberação',
        detalhe: 'Exame concluído; ocupam câmara até a autorização.',
        total: m15.aguardandoLiberacao,
        para: '/cadaveres',
        nivel: 'atencao',
      });
      this.acrescentar(atencao, {
        chave: 'cadaveres_armazenados',
        rotulo: 'Cadáveres armazenados',
        detalhe: 'Ocupando posição no armazenamento agora.',
        total: m15.armazenados,
        para: '/cadaveres',
        nivel: 'informacao',
      });
    }

    if (pode(PERMISSOES.BIOTECA_VISUALIZAR)) {
      const m18 = await this.bioteca.resumoPainel();
      this.acrescentar(atencao, {
        chave: 'emprestimos_atrasados',
        rotulo: 'Empréstimos atrasados',
        detalhe: 'Material fora do acervo além do prazo combinado.',
        total: m18.emprestimosAtrasados,
        para: '/bioteca',
        nivel: 'critico',
      });
      this.acrescentar(atencao, {
        chave: 'emprestimos_abertos',
        rotulo: 'Empréstimos em aberto',
        detalhe: 'Material emprestado ainda não devolvido.',
        total: m18.emprestimosAbertos,
        para: '/bioteca',
        nivel: 'informacao',
      });
    }

    return {
      geradoEm: agora.toISOString(),
      fuso,
      volumetria: {
        emAndamento: c?.emAndamento ?? 0,
        entraramHoje: doFluxo.entradasHoje,
        liberadosHoje: c?.liberadosHoje ?? 0,
        tempoMedioDias:
          doFluxo.tempoMedioDias === null
            ? null
            : Math.round(doFluxo.tempoMedioDias * 10) / 10,
        diasDaMedia: DIAS_DA_MEDIA,
      },
      atencao,
      funil: this.montarFunil(doFluxo.porEtapa),
      serie: this.montarSerie(agora, fuso, doFluxo.entradasPorDia, doFluxo.liberacoesPorDia),
    };
  }

  /** Item com total zero nao entra: a faixa e "o que exige atencao", nao um relatorio. */
  private acrescentar(lista: ItemDeAtencao[], item: ItemDeAtencao): void {
    if (item.total > 0) lista.push(item);
  }

  /**
   * O funil sai na ordem de producao do `ETAPA`, nao na ordem de volume.
   *
   * Ordenar por volume faria a fila trocar de lugar a cada carga da tela, e a
   * leitura util aqui e "onde o trabalho esta empoçando" - o que so aparece se
   * as etapas ficarem sempre na mesma sequencia.
   */
  private montarFunil(
    linhas: { etapa: Etapa; total: number }[],
  ): { etapa: Etapa; rotulo: string; total: number }[] {
    const porEtapa = new Map(linhas.map((l) => [l.etapa, l.total]));
    return ETAPAS_EM_ANDAMENTO.filter((etapa) => (porEtapa.get(etapa) ?? 0) > 0).map((etapa) => ({
      etapa,
      rotulo: ETAPA_LABEL[etapa],
      total: porEtapa.get(etapa) ?? 0,
    }));
  }

  /**
   * Serie preenchida dia a dia, inclusive os dias sem movimento.
   *
   * O banco so devolve os dias que tiveram alguma coisa; desenhar o grafico
   * direto do resultado esconderia os buracos e faria um sabado parado parecer
   * um dia comum.
   */
  private montarSerie(
    agora: Date,
    fuso: string,
    entradas: { dia: string; total: number }[],
    liberacoes: { dia: string; total: number }[],
  ): { dia: string; entradas: number; liberacoes: number }[] {
    const mapaEntradas = new Map(entradas.map((l) => [l.dia, l.total]));
    const mapaLiberacoes = new Map(liberacoes.map((l) => [l.dia, l.total]));

    const dias: { dia: string; entradas: number; liberacoes: number }[] = [];
    for (let atras = DIAS_DA_SERIE - 1; atras >= 0; atras -= 1) {
      const dia = diaLocalIso(inicioDoDia(agora, atras, fuso), fuso);
      dias.push({
        dia,
        entradas: mapaEntradas.get(dia) ?? 0,
        liberacoes: mapaLiberacoes.get(dia) ?? 0,
      });
    }
    return dias;
  }

  /** M01 secao 30: o fuso e configuracao da instituicao, nao do servidor. */
  private async fusoDoTenant(): Promise<string> {
    const ctx = exigirContexto();
    const [instituicao] = await this.db.raw
      .select({ preferencias: tenant.preferencias })
      .from(tenant)
      .where(eq(tenant.id, ctx.tenantId))
      .limit(1);
    return fusoDaInstituicao(instituicao?.preferencias);
  }
}

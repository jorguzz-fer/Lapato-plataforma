import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import {
  bloqueioCadaver,
  cadaver,
  caso,
  destinacaoCadaverHistorico,
  localFisico,
  movimentacaoCadaver,
  usuario,
  type Transacao,
} from '@lapato/db';
import {
  MODULOS,
  STATUS_QUE_OCUPAM_POSICAO,
  type ConservacaoCadaver,
  type DestinacaoCadaver,
  type EmbalagemCadaver,
  type IdentificacaoExterna,
  type IntegridadeCadaver,
  type StatusCadaver,
  type TipoBloqueioCadaver,
} from '@lapato/shared';
import { DbService } from '../../core/db/db.service.js';
import { EventosService } from '../../core/eventos/eventos.service.js';
import { AuditoriaService } from '../../core/auditoria/auditoria.service.js';
import { GuardianService } from '../../core/guardian/guardian.service.js';
import { NumeracaoService } from '../m01-administracao/numeracao.service.js';
import { exigirContexto } from '../../core/contexto/contexto-requisicao.js';

export interface DadosRecebimento {
  /** Ausente na entrada provisoria (secao 5): o corpo chegou antes do cadastro. */
  casoId?: string | null;
  especie: string;
  nomeAnimal?: string | null;
  sexo?: string | null;
  raca?: string | null;
  pelagem?: string | null;
  microchip?: string | null;
  origemResponsavel?: string | null;
  obitoEm?: string | null;
  conservacaoRecebimento?: ConservacaoCadaver | null;
  embalagem?: EmbalagemCadaver | null;
  integridade?: IntegridadeCadaver | null;
  identificacaoExterna?: IdentificacaoExterna | null;
  observacoesRecebimento?: string | null;
  /** Dias de guarda; vira `prazoGuardaAte` (secoes 34-35). */
  prazoGuardaDias?: number | null;
}

/**
 * M15 - Controle de Cadaveres.
 *
 * O modulo responde, a qualquer momento: qual cadaver esta sob responsabilidade
 * do laboratorio, onde ele esta, quem o moveu, se pode sair e para onde vai.
 *
 * Tres regras da secao 88 moldam quase todo metodo aqui:
 *
 * - **Toda movimentacao e registrada.** Nenhum metodo muda posicao sem gravar a
 *   linha correspondente em `movimentacao_cadaver`.
 * - **Liberado e retirado sao estados distintos.** Liberar e uma decisao;
 *   retirar e um fato fisico. Colapsar os dois faz o laboratorio perder a conta
 *   de quem ainda esta no predio.
 * - **Registros historicos nao sao apagados.** Correcao entra como registro
 *   novo com justificativa.
 */
@Injectable()
export class CadaveresService {
  constructor(
    private readonly db: DbService,
    private readonly eventos: EventosService,
    private readonly auditoria: AuditoriaService,
    private readonly numeracao: NumeracaoService,
    private readonly guardian: GuardianService,
  ) {}

  /**
   * Registra a entrada fisica (secao 4).
   *
   * `casoId` opcional e a secao 5 em codigo: recusar o corpo que chegou antes
   * do cadastro administrativo significa um corpo sem registro nenhum na
   * camara - o oposto do que o modulo existe para garantir. A entrada nasce
   * marcada como incompleta e e reconciliada depois.
   */
  async receber(dados: DadosRecebimento): Promise<{ id: string; identificador: string }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      if (dados.casoId) await this.exigirCaso(tx, dados.casoId);

      const identificador = await this.numeracao.proximoCadaver(tx, new Date().getFullYear());
      const agora = new Date();

      const [novo] = await tx
        .insert(cadaver)
        .values({
          tenantId: ctx.tenantId,
          identificador,
          casoId: dados.casoId ?? null,
          especie: dados.especie,
          nomeAnimal: dados.nomeAnimal ?? null,
          sexo: dados.sexo ?? null,
          raca: dados.raca ?? null,
          pelagem: dados.pelagem ?? null,
          microchip: dados.microchip ?? null,
          origemResponsavel: dados.origemResponsavel ?? null,
          obitoEm: dados.obitoEm ? new Date(dados.obitoEm) : null,
          conservacaoRecebimento: dados.conservacaoRecebimento ?? null,
          conservacaoAtual: dados.conservacaoRecebimento ?? null,
          embalagem: dados.embalagem ?? null,
          integridade: dados.integridade ?? null,
          identificacaoExterna: dados.identificacaoExterna ?? null,
          observacoesRecebimento: dados.observacoesRecebimento ?? null,
          recebidoEm: agora,
          recebidoPorId: ctx.usuarioId,
          status: 'recebido',
          prazoGuardaAte: dados.prazoGuardaDias
            ? new Date(agora.getTime() + dados.prazoGuardaDias * 86_400_000)
            : null,
        })
        .returning({ id: cadaver.id });

      await this.registrarMovimentacao(tx, {
        cadaverId: novo!.id,
        tipo: 'recebimento',
        destinoDescricao: 'Recebimento',
        conservacao: dados.conservacaoRecebimento ?? null,
        motivo: 'Entrada física no laboratório',
      });

      if (dados.casoId) {
        await this.eventos.publicar(tx, {
          tipo: 'cadaver.recebido',
          casoId: dados.casoId,
          moduloOrigem: MODULOS.M15_CADAVERES,
          objetoTipo: 'cadaver',
          objetoId: novo!.id,
          payload: { identificador },
        });
      }

      return { id: novo!.id, identificador };
    });
  }

  /** Reconciliacao da entrada provisoria com o cadastro definitivo (secao 5). */
  async vincularAoCaso(cadaverId: string, casoId: string): Promise<void> {
    return this.db.executar(async (tx) => {
      const atual = await this.buscar(tx, cadaverId);
      if (atual.casoId) {
        throw new BadRequestException('Este cadáver já está vinculado a um caso.');
      }
      await this.exigirCaso(tx, casoId);

      await tx.update(cadaver).set({ casoId, atualizadoEm: new Date() }).where(eq(cadaver.id, cadaverId));

      await this.auditoria.registrar(tx, {
        entidade: 'cadaver',
        entidadeId: cadaverId,
        acao: 'vincular_caso',
        valorAnterior: { casoId: null },
        valorNovo: { casoId },
      });

      await this.eventos.publicar(tx, {
        tipo: 'cadaver.recebido',
        casoId,
        moduloOrigem: MODULOS.M15_CADAVERES,
        objetoTipo: 'cadaver',
        objetoId: cadaverId,
        payload: { identificador: atual.identificador, reconciliado: true },
      });
    });
  }

  /**
   * Coloca ou transfere o cadaver numa posicao (secoes 18 e 23).
   *
   * A secao 25 e literal: "se o usuario tentar colocar um cadaver em posicao
   * ocupada, a movimentacao devera ser impedida ate correcao". Duas etiquetas
   * na mesma prateleira e como a identidade se perde.
   */
  async armazenar(
    cadaverId: string,
    dados: { localId: string; conservacao?: ConservacaoCadaver | null; observacao?: string | null },
  ): Promise<void> {
    return this.db.executar(async (tx) => {
      const atual = await this.buscar(tx, cadaverId);

      if (atual.status === 'retirado' || atual.status === 'destinado') {
        throw new BadRequestException(
          'Cadáver que já saiu do laboratório não pode ser armazenado. Corrija o registro de saída.',
        );
      }

      const local = await this.exigirLocal(tx, dados.localId);
      const ocupante = await this.ocupanteDaPosicao(tx, dados.localId, cadaverId);
      if (ocupante) {
        throw new BadRequestException(
          `Posição ${local.codigo} já ocupada por ${ocupante.identificador}. ` +
            'Escolha outra posição ou corrija o registro do cadáver que está nela.',
        );
      }

      const origemId = atual.localAtualId;
      const conservacao = dados.conservacao ?? atual.conservacaoAtual;

      await tx
        .update(cadaver)
        .set({
          localAtualId: dados.localId,
          localAnteriorId: origemId,
          conservacaoAtual: conservacao,
          foraDesde: null,
          status: atual.status === 'em_necropsia' ? 'aguardando_liberacao' : 'armazenado',
          atualizadoEm: new Date(),
        })
        .where(eq(cadaver.id, cadaverId));

      await this.registrarMovimentacao(tx, {
        cadaverId,
        tipo: atual.status === 'em_necropsia' ? 'retorno_necropsia' : origemId ? 'transferencia' : 'armazenamento',
        origemLocalId: origemId,
        destinoLocalId: dados.localId,
        conservacao,
        observacao: dados.observacao ?? null,
      });
    });
  }

  /**
   * Retirada para necropsia (secao 26).
   *
   * A posicao e liberada, mas o cadaver **nao some do mapa**: `localAnteriorId`
   * e `foraDesde` continuam dizendo de onde ele saiu e ha quanto tempo esta
   * fora da refrigeracao (secoes 29 e 30).
   */
  async retirarParaNecropsia(cadaverId: string, motivo?: string): Promise<void> {
    return this.db.executar(async (tx) => {
      const atual = await this.buscar(tx, cadaverId);

      if (atual.status === 'em_necropsia') {
        throw new BadRequestException('Este cadáver já está fora do armazenamento, em necropsia.');
      }
      if (atual.status === 'retirado' || atual.status === 'destinado') {
        throw new BadRequestException('Cadáver que já saiu do laboratório não pode ir para necropsia.');
      }

      await tx
        .update(cadaver)
        .set({
          localAnteriorId: atual.localAtualId,
          localAtualId: null,
          foraDesde: new Date(),
          status: 'em_necropsia',
          atualizadoEm: new Date(),
        })
        .where(eq(cadaver.id, cadaverId));

      await this.registrarMovimentacao(tx, {
        cadaverId,
        tipo: 'retirada_necropsia',
        origemLocalId: atual.localAtualId,
        destinoDescricao: 'Sala de Necropsia',
        motivo: motivo ?? null,
      });
    });
  }

  /**
   * Bloqueio (secoes 31-33). Impede a saida; nao muda onde o corpo esta.
   */
  async bloquear(
    cadaverId: string,
    dados: { tipo: TipoBloqueioCadaver; motivo: string },
  ): Promise<{ id: string }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      await this.buscar(tx, cadaverId);

      const [novo] = await tx
        .insert(bloqueioCadaver)
        .values({
          tenantId: ctx.tenantId,
          cadaverId,
          tipo: dados.tipo,
          motivo: dados.motivo,
          criadoPorId: ctx.usuarioId,
        })
        .returning({ id: bloqueioCadaver.id });

      await this.auditoria.registrar(tx, {
        entidade: 'cadaver',
        entidadeId: cadaverId,
        acao: 'bloquear',
        valorNovo: { tipo: dados.tipo, motivo: dados.motivo },
      });

      return { id: novo!.id };
    });
  }

  /** Resolver exige justificativa: o bloqueio existia por uma razao (secao 88). */
  async resolverBloqueio(bloqueioId: string, justificativa: string): Promise<void> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const [atual] = await tx
        .select()
        .from(bloqueioCadaver)
        .where(and(eq(bloqueioCadaver.tenantId, ctx.tenantId), eq(bloqueioCadaver.id, bloqueioId)))
        .limit(1);

      if (!atual) throw new NotFoundException('Bloqueio não encontrado.');
      if (atual.resolvidoEm) throw new BadRequestException('Este bloqueio já foi resolvido.');

      await tx
        .update(bloqueioCadaver)
        .set({
          resolvidoEm: new Date(),
          resolvidoPorId: ctx.usuarioId,
          justificativaResolucao: justificativa,
          atualizadoEm: new Date(),
        })
        .where(eq(bloqueioCadaver.id, bloqueioId));

      await this.auditoria.registrar(tx, {
        entidade: 'cadaver',
        entidadeId: atual.cadaverId,
        acao: 'resolver_bloqueio',
        valorAnterior: { tipo: atual.tipo, motivo: atual.motivo },
        valorNovo: { resolvido: true },
        justificativa,
      });
    });
  }

  /**
   * Define ou altera a destinacao (secoes 40-41).
   *
   * "Nunca devera simplesmente sobrescrever a escolha anterior": cada alteracao
   * vira linha no historico, com quem mudou e por que.
   */
  async definirDestinacao(
    cadaverId: string,
    dados: { destinacao: DestinacaoCadaver; justificativa?: string | null },
  ): Promise<void> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const atual = await this.buscar(tx, cadaverId);

      if (atual.destinacao && atual.destinacao !== dados.destinacao && !dados.justificativa?.trim()) {
        throw new BadRequestException(
          'Alterar a destinação já autorizada exige justificativa.',
        );
      }

      await tx.insert(destinacaoCadaverHistorico).values({
        tenantId: ctx.tenantId,
        cadaverId,
        anterior: atual.destinacao,
        nova: dados.destinacao,
        justificativa: dados.justificativa ?? null,
        definidaPorId: ctx.usuarioId,
      });

      await tx
        .update(cadaver)
        .set({
          destinacao: dados.destinacao,
          destinacaoDefinidaEm: new Date(),
          atualizadoEm: new Date(),
        })
        .where(eq(cadaver.id, cadaverId));
    });
  }

  /**
   * Liberacao tecnica (secao 42).
   *
   * A secao 32 nao deixa margem: cadaver bloqueado nao se libera mudando o
   * status na mao. Aqui isso vira uma checagem, nao uma recomendacao.
   */
  async liberar(cadaverId: string): Promise<void> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const atual = await this.buscar(tx, cadaverId);

      if (atual.status === 'retirado' || atual.status === 'destinado') {
        throw new BadRequestException('Este cadáver já saiu do laboratório.');
      }
      if (atual.status === 'em_necropsia') {
        throw new BadRequestException(
          'Cadáver em necropsia não pode ser liberado. Registre o retorno ao armazenamento primeiro.',
        );
      }

      const bloqueios = await this.bloqueiosAtivos(tx, cadaverId);
      if (bloqueios.length > 0) {
        throw new BadRequestException(
          `Cadáver com ${bloqueios.length} bloqueio(s) ativo(s): ${bloqueios
            .map((b) => b.motivo)
            .join(' · ')}. Resolva o bloqueio antes de liberar.`,
        );
      }

      await tx
        .update(cadaver)
        .set({
          status: 'liberado',
          liberadoEm: new Date(),
          liberadoPorId: ctx.usuarioId,
          atualizadoEm: new Date(),
        })
        .where(eq(cadaver.id, cadaverId));

      await this.auditoria.registrar(tx, {
        entidade: 'cadaver',
        entidadeId: cadaverId,
        acao: 'liberar',
        valorAnterior: { status: atual.status },
        valorNovo: { status: 'liberado' },
      });

      if (atual.casoId) {
        await this.eventos.publicar(tx, {
          tipo: 'cadaver.liberado',
          casoId: atual.casoId,
          moduloOrigem: MODULOS.M15_CADAVERES,
          objetoTipo: 'cadaver',
          objetoId: cadaverId,
        });
      }
    });
  }

  /**
   * Saida fisica (secoes 43-44 e 49).
   *
   * So aqui a posicao e devolvida ao mapa - e so aqui, porque "a saida fisica
   * devera liberar a posicao" (secao 88) e a saida fisica e este momento, nao a
   * liberacao.
   */
  async registrarEntrega(
    cadaverId: string,
    dados: {
      nome: string;
      documento?: string | null;
      vinculo?: string | null;
      empresa?: string | null;
    },
  ): Promise<void> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const atual = await this.buscar(tx, cadaverId);

      if (atual.status !== 'liberado') {
        throw new BadRequestException(
          'Só um cadáver liberado pode ser entregue. Libere tecnicamente antes de registrar a saída.',
        );
      }

      const origemId = atual.localAtualId;

      await tx
        .update(cadaver)
        .set({
          status: 'retirado',
          retiradoEm: new Date(),
          retiradoPorNome: dados.nome,
          retiradoPorDocumento: dados.documento ?? null,
          retiradoPorVinculo: dados.vinculo ?? null,
          retiradoPorEmpresa: dados.empresa ?? null,
          entregaRegistradaPorId: ctx.usuarioId,
          // A posicao volta a ficar livre no mapa (secoes 49 e 88).
          localAtualId: null,
          localAnteriorId: origemId,
          foraDesde: null,
          atualizadoEm: new Date(),
        })
        .where(eq(cadaver.id, cadaverId));

      await this.registrarMovimentacao(tx, {
        cadaverId,
        tipo: 'saida_fisica',
        origemLocalId: origemId,
        destinoDescricao: dados.empresa ? `Entrega a ${dados.empresa}` : `Entrega a ${dados.nome}`,
        motivo: dados.vinculo ?? null,
      });

      await this.auditoria.registrar(tx, {
        entidade: 'cadaver',
        entidadeId: cadaverId,
        acao: 'entregar',
        valorAnterior: { status: 'liberado' },
        valorNovo: { status: 'retirado', destinatario: dados.nome },
      });

      if (atual.casoId) {
        await this.eventos.publicar(tx, {
          tipo: 'cadaver.retirado',
          casoId: atual.casoId,
          moduloOrigem: MODULOS.M15_CADAVERES,
          objetoTipo: 'cadaver',
          objetoId: cadaverId,
          payload: { destinatario: dados.nome },
        });
      }
    });
  }

  /**
   * Encerramento (secao 49).
   *
   * "Destinacao nao significa exclusao" (secao 50): o registro permanece
   * inteiro. O que muda e o estado.
   */
  async confirmarDestinacao(cadaverId: string): Promise<void> {
    return this.db.executar(async (tx) => {
      const atual = await this.buscar(tx, cadaverId);

      if (atual.status !== 'retirado') {
        throw new BadRequestException(
          'A destinação se confirma depois da saída física. Registre a entrega primeiro.',
        );
      }
      if (!atual.destinacao) {
        throw new BadRequestException('Defina a destinação autorizada antes de confirmá-la.');
      }

      await tx
        .update(cadaver)
        .set({ status: 'destinado', atualizadoEm: new Date() })
        .where(eq(cadaver.id, cadaverId));

      await this.auditoria.registrar(tx, {
        entidade: 'cadaver',
        entidadeId: cadaverId,
        acao: 'confirmar_destinacao',
        valorAnterior: { status: 'retirado' },
        valorNovo: { status: 'destinado', destinacao: atual.destinacao },
      });
    });
  }

  // --- Consulta ------------------------------------------------------------

  /** Painel operacional (secoes 37-39). */
  async listar(filtros: { status?: StatusCadaver; busca?: string }): Promise<unknown[]> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const condicoes = [eq(cadaver.tenantId, ctx.tenantId)];
      if (filtros.status) condicoes.push(eq(cadaver.status, filtros.status));
      if (filtros.busca?.trim()) {
        const termo = `%${filtros.busca.trim().toLowerCase()}%`;
        condicoes.push(
          sql`(lower(${cadaver.identificador}) like ${termo}
            or lower(coalesce(${cadaver.nomeAnimal}, '')) like ${termo}
            or lower(coalesce(${cadaver.microchip}, '')) like ${termo})`,
        );
      }

      const linhas = await tx
        .select({
          id: cadaver.id,
          identificador: cadaver.identificador,
          nomeAnimal: cadaver.nomeAnimal,
          especie: cadaver.especie,
          status: cadaver.status,
          casoId: cadaver.casoId,
          casoIdentificador: caso.identificador,
          localCodigo: localFisico.codigo,
          localNome: localFisico.nome,
          conservacaoAtual: cadaver.conservacaoAtual,
          recebidoEm: cadaver.recebidoEm,
          foraDesde: cadaver.foraDesde,
          prazoGuardaAte: cadaver.prazoGuardaAte,
          destinacao: cadaver.destinacao,
          bloqueios: sql<number>`(
            select count(*) from ${bloqueioCadaver} b
            where b.cadaver_id = ${cadaver.id} and b.resolvido_em is null
          )`,
        })
        .from(cadaver)
        .leftJoin(caso, eq(caso.id, cadaver.casoId))
        .leftJoin(localFisico, eq(localFisico.id, cadaver.localAtualId))
        .where(and(...condicoes))
        .orderBy(desc(cadaver.recebidoEm));

      return linhas;
    });
  }

  /** Ficha operacional: o que o QR Code abre (secao 10). */
  async ficha(cadaverId: string) {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const registro = await this.buscar(tx, cadaverId);

      const [local] = registro.localAtualId
        ? await tx.select().from(localFisico).where(eq(localFisico.id, registro.localAtualId)).limit(1)
        : [];

      const movimentacoes = await tx
        .select({
          id: movimentacaoCadaver.id,
          tipo: movimentacaoCadaver.tipo,
          origem: sql<string | null>`(
            select l.codigo from ${localFisico} l where l.id = ${movimentacaoCadaver.origemLocalId}
          )`,
          destino: sql<string | null>`(
            select l.codigo from ${localFisico} l where l.id = ${movimentacaoCadaver.destinoLocalId}
          )`,
          destinoDescricao: movimentacaoCadaver.destinoDescricao,
          conservacao: movimentacaoCadaver.conservacao,
          motivo: movimentacaoCadaver.motivo,
          observacao: movimentacaoCadaver.observacao,
          ocorridoEm: movimentacaoCadaver.ocorridoEm,
          usuario: usuario.nomeCompleto,
        })
        .from(movimentacaoCadaver)
        .leftJoin(usuario, eq(usuario.id, movimentacaoCadaver.usuarioId))
        .where(
          and(
            eq(movimentacaoCadaver.tenantId, ctx.tenantId),
            eq(movimentacaoCadaver.cadaverId, cadaverId),
          ),
        )
        .orderBy(asc(movimentacaoCadaver.ocorridoEm));

      const bloqueios = await tx
        .select()
        .from(bloqueioCadaver)
        .where(
          and(eq(bloqueioCadaver.tenantId, ctx.tenantId), eq(bloqueioCadaver.cadaverId, cadaverId)),
        )
        .orderBy(desc(bloqueioCadaver.criadoEm));

      const destinacoes = await tx
        .select()
        .from(destinacaoCadaverHistorico)
        .where(
          and(
            eq(destinacaoCadaverHistorico.tenantId, ctx.tenantId),
            eq(destinacaoCadaverHistorico.cadaverId, cadaverId),
          ),
        )
        .orderBy(desc(destinacaoCadaverHistorico.criadoEm));

      return {
        cadaver: registro,
        local: local ?? null,
        movimentacoes,
        bloqueios,
        destinacoes,
        /** Secao 6: enquanto nao houver caso, a ficha grita CADASTRO INCOMPLETO. */
        cadastroIncompleto: registro.casoId === null,
      };
    });
  }

  /**
   * Mapa de armazenamento (secao 19).
   *
   * Devolve as posicoes com quem ocupa cada uma. O que a secao 29 exige - que
   * nenhum cadaver desapareca do mapa quando sai - aparece aqui como a lista
   * `foraDoArmazenamento`, montada a partir de `localAnteriorId`.
   */
  async mapa() {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const posicoes = await tx
        .select({
          id: localFisico.id,
          codigo: localFisico.codigo,
          nome: localFisico.nome,
          paiId: localFisico.paiId,
          categoria: localFisico.categoria,
          condicaoAmbiental: localFisico.condicaoAmbiental,
          ocupanteId: cadaver.id,
          ocupanteIdentificador: cadaver.identificador,
          ocupanteNome: cadaver.nomeAnimal,
          ocupanteStatus: cadaver.status,
        })
        .from(localFisico)
        .leftJoin(
          cadaver,
          and(
            eq(cadaver.localAtualId, localFisico.id),
            inArray(cadaver.status, STATUS_QUE_OCUPAM_POSICAO),
          ),
        )
        .where(and(eq(localFisico.tenantId, ctx.tenantId), isNull(localFisico.inativadoEm)))
        .orderBy(asc(localFisico.codigo));

      const foraDoArmazenamento = await tx
        .select({
          id: cadaver.id,
          identificador: cadaver.identificador,
          nomeAnimal: cadaver.nomeAnimal,
          status: cadaver.status,
          foraDesde: cadaver.foraDesde,
          origemCodigo: sql<string | null>`(
            select l.codigo from ${localFisico} l where l.id = ${cadaver.localAnteriorId}
          )`,
        })
        .from(cadaver)
        .where(
          and(
            eq(cadaver.tenantId, ctx.tenantId),
            eq(cadaver.status, 'em_necropsia'),
            isNotNull(cadaver.foraDesde),
          ),
        );

      return { posicoes, foraDoArmazenamento };
    });
  }

  /**
   * Varredura do Guardian (secao 70).
   *
   * Nao barra nada: procura incoerencias que ja existem - corpo que saiu mas
   * continua ocupando posicao, liberado sem destinacao, liberado com bloqueio.
   * E trabalho pendente da operacao, e o painel mostra como tal.
   */
  async conferencia() {
    return this.db.executar((tx) => this.guardian.verificarCadaveres(tx));
  }

  // --- internos ------------------------------------------------------------

  private async registrarMovimentacao(
    tx: Transacao,
    dados: {
      cadaverId: string;
      tipo:
        | 'recebimento'
        | 'armazenamento'
        | 'transferencia'
        | 'retirada_necropsia'
        | 'retorno_necropsia'
        | 'mudanca_conservacao'
        | 'saida_fisica'
        | 'correcao';
      origemLocalId?: string | null;
      destinoLocalId?: string | null;
      destinoDescricao?: string | null;
      conservacao?: ConservacaoCadaver | null;
      motivo?: string | null;
      observacao?: string | null;
    },
  ): Promise<void> {
    const ctx = exigirContexto();

    await tx.insert(movimentacaoCadaver).values({
      tenantId: ctx.tenantId,
      cadaverId: dados.cadaverId,
      tipo: dados.tipo,
      origemLocalId: dados.origemLocalId ?? null,
      destinoLocalId: dados.destinoLocalId ?? null,
      destinoDescricao: dados.destinoDescricao ?? null,
      conservacao: dados.conservacao ?? null,
      motivo: dados.motivo ?? null,
      observacao: dados.observacao ?? null,
      usuarioId: ctx.usuarioId,
    });
  }

  /** Quem ocupa a posicao, ignorando o proprio cadaver que esta sendo movido. */
  private async ocupanteDaPosicao(tx: Transacao, localId: string, exceto: string) {
    const ctx = exigirContexto();
    const [ocupante] = await tx
      .select({ id: cadaver.id, identificador: cadaver.identificador })
      .from(cadaver)
      .where(
        and(
          eq(cadaver.tenantId, ctx.tenantId),
          eq(cadaver.localAtualId, localId),
          inArray(cadaver.status, STATUS_QUE_OCUPAM_POSICAO),
          sql`${cadaver.id} <> ${exceto}`,
        ),
      )
      .limit(1);
    return ocupante ?? null;
  }

  private async bloqueiosAtivos(tx: Transacao, cadaverId: string) {
    const ctx = exigirContexto();
    return tx
      .select()
      .from(bloqueioCadaver)
      .where(
        and(
          eq(bloqueioCadaver.tenantId, ctx.tenantId),
          eq(bloqueioCadaver.cadaverId, cadaverId),
          isNull(bloqueioCadaver.resolvidoEm),
        ),
      );
  }

  private async buscar(tx: Transacao, cadaverId: string) {
    const ctx = exigirContexto();
    const [registro] = await tx
      .select()
      .from(cadaver)
      .where(and(eq(cadaver.tenantId, ctx.tenantId), eq(cadaver.id, cadaverId)))
      .limit(1);

    if (!registro) throw new NotFoundException('Cadáver não encontrado.');
    return registro;
  }

  private async exigirCaso(tx: Transacao, casoId: string) {
    const ctx = exigirContexto();
    const [registro] = await tx
      .select({ id: caso.id })
      .from(caso)
      .where(and(eq(caso.tenantId, ctx.tenantId), eq(caso.id, casoId)))
      .limit(1);

    if (!registro) throw new NotFoundException('Caso não encontrado.');
    return registro;
  }

  private async exigirLocal(tx: Transacao, localId: string) {
    const ctx = exigirContexto();
    const [registro] = await tx
      .select()
      .from(localFisico)
      .where(and(eq(localFisico.tenantId, ctx.tenantId), eq(localFisico.id, localId)))
      .limit(1);

    if (!registro) throw new NotFoundException('Local de armazenamento não encontrado.');
    if (registro.inativadoEm) {
      throw new BadRequestException('Este local está inativado e não recebe cadáver.');
    }
    return registro;
  }
}

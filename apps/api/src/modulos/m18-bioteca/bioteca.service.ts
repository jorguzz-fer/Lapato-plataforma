import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import {
  bloco,
  caso,
  colecaoBiologica,
  colecaoItem,
  emprestimo,
  emprestimoItem,
  inventarioBioteca,
  inventarioItem,
  lamina,
  localFisico,
  loteDescarte,
  movimentacaoObjeto,
  objetoBiologico,
  reservaObjeto,
  usuario,
  type Transacao,
} from '@lapato/db';
import {
  MODULOS,
  STATUS_EMPRESTIMO_ABERTOS,
  STATUS_OBJETO_OCUPANDO_POSICAO,
  TIPOS_QUE_EXIGEM_FRIO,
  calcularRetencaoAte,
  motivoDescarteBloqueado,
  prioridadeFinalidade,
  type CondicaoObjeto,
  type DivergenciaInventario,
  type FinalidadeUso,
  type MetodoDescarte,
  type MotivoRetencaoAmpliada,
  type RestricaoObjeto,
  type StatusObjetoBiologico,
  type TipoObjetoBiologico,
} from '@lapato/shared';
import { DbService } from '../../core/db/db.service.js';
import { EventosService } from '../../core/eventos/eventos.service.js';
import { AuditoriaService } from '../../core/auditoria/auditoria.service.js';
import { GuardianService } from '../../core/guardian/guardian.service.js';
import { NumeracaoService } from '../m01-administracao/numeracao.service.js';
import { exigirContexto } from '../../core/contexto/contexto-requisicao.js';

export interface DadosArquivamento {
  tipo: TipoObjetoBiologico;
  descricao?: string | null;
  casoId?: string | null;
  amostraId?: string | null;
  blocoId?: string | null;
  laminaId?: string | null;
  objetoPaiId?: string | null;
  orgao?: string | null;
  localId?: string | null;
  quantidade?: number | null;
  recipiente?: string | null;
  fixador?: string | null;
  temperaturaPrevista?: string | null;
  restricoes?: RestricaoObjeto[] | null;
  preservacaoEspecial?: boolean | null;
  /** Sobrepoe o padrao de `RETENCAO_PADRAO_MESES` quando a instituicao tem politica propria. */
  retencaoMeses?: number | null;
  condicao?: CondicaoObjeto | null;
}

/**
 * M18 - Bioteca e Gestao de Acervo Biologico.
 *
 * O resultado esperado do modulo (secao 115) e uma lista de perguntas que a
 * equipe precisa responder na hora: onde esta o bloco A3, ainda existe tecido
 * remanescente, esse bloco ainda tem material, esta reservado, foi emprestado,
 * para quem, quando volta, pode ir para pesquisa, ha restricao pericial,
 * quando pode ser descartado. Cada metodo aqui existe para que alguma dessas
 * perguntas nao dependa de "memoria pessoal, planilhas paralelas, caixas sem
 * registro ou anotacoes manuais".
 *
 * Tres regras da secao 113 atravessam quase todo metodo:
 *
 * - **Toda retirada devera possuir responsavel e finalidade.** Nenhum metodo
 *   tira material do lugar sem gravar quem e para que.
 * - **Correcoes de localizacao nao deverao apagar o historico anterior.**
 *   `movimentacao_objeto` e append-only; corrigir e um evento novo.
 * - **Materiais com bloqueio nao deverao ser descartados.** O descarte passa
 *   por `motivoDescarteBloqueado()` objeto a objeto, mesmo em lote.
 */
@Injectable()
export class BiotecaService {
  constructor(
    private readonly db: DbService,
    private readonly eventos: EventosService,
    private readonly auditoria: AuditoriaService,
    private readonly numeracao: NumeracaoService,
    private readonly guardian: GuardianService,
  ) {}

  /**
   * Da identidade de custodia a um material e o coloca no acervo (secao 114).
   *
   * O `localId` e opcional de proposito: material recem-produzido existe antes
   * de ter gaveta, e recusar o registro nesse intervalo cria exatamente a
   * "caixa sem registro" que a secao 115 quer eliminar. Sem local, o objeto
   * entra `disponivel` e o Guardian o aponta como material sem localizacao
   * (secao 86) ate alguem arquiva-lo.
   */
  async arquivar(dados: DadosArquivamento): Promise<{ id: string; identificador: string }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      if (dados.casoId) await this.exigirCaso(tx, dados.casoId);

      const local = dados.localId ? await this.exigirLocal(tx, dados.localId) : null;
      if (local) this.exigirCompatibilidade(dados.tipo, local);

      const agora = new Date();
      const identificador = await this.numeracao.proximoObjetoBiologico(tx, agora.getFullYear());
      const quantidade = dados.quantidade ?? 1;
      if (quantidade < 1) {
        throw new BadRequestException('A quantidade arquivada precisa ser pelo menos 1.');
      }

      const retencao = calcularRetencaoAte(dados.tipo, agora, {
        preservacaoEspecial: dados.preservacaoEspecial ?? false,
        mesesConfigurados: dados.retencaoMeses ?? undefined,
      });

      const [novo] = await tx
        .insert(objetoBiologico)
        .values({
          tenantId: ctx.tenantId,
          identificador,
          tipo: dados.tipo,
          descricao: dados.descricao ?? null,
          casoId: dados.casoId ?? null,
          amostraId: dados.amostraId ?? null,
          blocoId: dados.blocoId ?? null,
          laminaId: dados.laminaId ?? null,
          objetoPaiId: dados.objetoPaiId ?? null,
          orgao: dados.orgao ?? null,
          status: 'disponivel',
          condicao: dados.condicao ?? 'integro',
          localOrigemId: local?.id ?? null,
          localAtualId: local?.id ?? null,
          quantidadeInicial: quantidade,
          quantidadeDisponivel: quantidade,
          recipiente: dados.recipiente ?? null,
          fixador: dados.fixador ?? null,
          temperaturaPrevista: dados.temperaturaPrevista ?? null,
          restricoes: dados.restricoes ?? [],
          preservacaoEspecial: dados.preservacaoEspecial ?? false,
          retencaoAte: retencao ? retencao.toISOString().slice(0, 10) : null,
          arquivadoEm: local ? agora : null,
          arquivadoPorId: ctx.usuarioId,
        })
        .returning({ id: objetoBiologico.id });

      await this.registrarMovimentacao(tx, {
        objetoId: novo!.id,
        tipo: 'arquivamento',
        destinoLocalId: local?.id ?? null,
        destinoDescritivo: local ? null : 'Sem posição definida',
        statusNovo: 'disponivel',
        quantidade,
        motivo: 'Entrada no acervo',
      });

      if (dados.casoId) {
        await this.eventos.publicar(tx, {
          tipo: 'bioteca.objeto_arquivado',
          casoId: dados.casoId,
          moduloOrigem: MODULOS.M18_BIOTECA,
          objetoTipo: 'objeto_biologico',
          objetoId: novo!.id,
          payload: { identificador, tipo: dados.tipo },
        });
      }

      await this.auditoria.registrar(tx, {
        entidade: 'objeto_biologico',
        entidadeId: novo!.id,
        acao: 'criar',
        valorNovo: { identificador, tipo: dados.tipo, local: local?.codigo ?? null },
      });

      return { id: novo!.id, identificador };
    });
  }

  /**
   * Move o objeto entre posicoes do acervo (secao 17).
   *
   * Diferente de `retirar`: aqui o material continua guardado, so muda de
   * gaveta. Por isso `localOrigemId` acompanha o destino - a posicao de volta
   * passa a ser a nova, e nao a antiga.
   */
  async transferir(objetoId: string, localDestinoId: string, motivo?: string): Promise<void> {
    return this.db.executar(async (tx) => {
      const objeto = await this.buscar(tx, objetoId);
      this.exigirNaoTerminal(objeto.status);

      const destino = await this.exigirLocal(tx, localDestinoId);
      this.exigirCompatibilidade(objeto.tipo, destino);

      await tx
        .update(objetoBiologico)
        .set({
          localOrigemId: destino.id,
          localAtualId: destino.id,
          localizacaoDescritiva: null,
          atualizadoEm: new Date(),
        })
        .where(eq(objetoBiologico.id, objetoId));

      await this.registrarMovimentacao(tx, {
        objetoId,
        tipo: 'transferencia',
        origemLocalId: objeto.localAtualId,
        destinoLocalId: destino.id,
        motivo: motivo ?? null,
      });
    });
  }

  /**
   * Retirada fisica (secoes 30 e 32).
   *
   * A secao 33 e a regra que da forma ao metodo: o objeto **nao desaparece do
   * sistema**. `localOrigemId` fica intacto - e para la que ele volta - e
   * `localAtualId` e zerado em favor de um destino descritivo, de modo que a
   * posicao volte a contar como livre no mapa sem que se perca de onde o
   * material saiu.
   */
  async retirar(
    objetoId: string,
    dados: {
      finalidade: FinalidadeUso;
      destino: string;
      previsaoDevolucao?: string | null;
      observacao?: string | null;
    },
  ): Promise<void> {
    return this.db.executar(async (tx) => {
      const objeto = await this.buscar(tx, objetoId);
      this.exigirNaoTerminal(objeto.status);

      if (objeto.status === 'emprestado' || objeto.status === 'em_uso') {
        throw new BadRequestException(
          `${objeto.identificador} já está fora do acervo. Registre a devolução antes de retirar de novo.`,
        );
      }

      await this.exigirFinalidadeCompativel(tx, objeto, dados.finalidade);

      await tx
        .update(objetoBiologico)
        .set({
          status: 'em_uso',
          localAtualId: null,
          localizacaoDescritiva: dados.destino,
          atualizadoEm: new Date(),
        })
        .where(eq(objetoBiologico.id, objetoId));

      await this.registrarMovimentacao(tx, {
        objetoId,
        tipo: 'retirada',
        origemLocalId: objeto.localAtualId,
        destinoDescritivo: dados.destino,
        finalidade: dados.finalidade,
        statusAnterior: objeto.status,
        statusNovo: 'em_uso',
        previsaoDevolucao: dados.previsaoDevolucao ? new Date(dados.previsaoDevolucao) : null,
        observacao: dados.observacao ?? null,
      });
    });
  }

  /**
   * Devolucao ao acervo (secao 34).
   *
   * Volta para `localOrigemId`, que nunca foi perdido. A condicao e registrada
   * na volta porque material emprestado volta quebrado, descolado ou ilegivel -
   * e isso muda o que ele ainda serve para fazer.
   */
  async devolver(
    objetoId: string,
    dados: { localId?: string | null; condicao?: CondicaoObjeto | null; observacao?: string | null },
  ): Promise<void> {
    return this.db.executar(async (tx) => {
      const objeto = await this.buscar(tx, objetoId);
      this.exigirNaoTerminal(objeto.status);

      const destinoId = dados.localId ?? objeto.localOrigemId;
      if (!destinoId) {
        throw new BadRequestException(
          'Este material não tem posição de origem registrada. Informe onde ele será guardado.',
        );
      }
      const destino = await this.exigirLocal(tx, destinoId);
      this.exigirCompatibilidade(objeto.tipo, destino);

      const status = await this.statusDeRepouso(tx, objeto);

      await tx
        .update(objetoBiologico)
        .set({
          status,
          localOrigemId: destino.id,
          localAtualId: destino.id,
          localizacaoDescritiva: null,
          condicao: dados.condicao ?? objeto.condicao,
          atualizadoEm: new Date(),
        })
        .where(eq(objetoBiologico.id, objetoId));

      await this.registrarMovimentacao(tx, {
        objetoId,
        tipo: 'devolucao',
        destinoLocalId: destino.id,
        statusAnterior: objeto.status,
        statusNovo: status,
        condicaoRegistrada: dados.condicao ?? null,
        observacao: dados.observacao ?? null,
      });
    });
  }

  /**
   * Consumo parcial (secoes 24, 25 e 70).
   *
   * Debita a quantidade e, quando ela zera, marca `esgotado` - e e esse status
   * que a secao 25 exige que fique "visivel ao patologista antes de solicitar
   * novos complementares". Quando o objeto e um bloco do M09, o esgotamento
   * sobe para `bloco.esgotado`, que e onde o Guardian de complementares olha.
   */
  async consumir(
    objetoId: string,
    dados: { quantidade?: number | null; finalidade: FinalidadeUso; observacao?: string | null },
  ): Promise<{ status: StatusObjetoBiologico; quantidadeDisponivel: number }> {
    return this.db.executar(async (tx) => {
      const objeto = await this.buscar(tx, objetoId);
      this.exigirNaoTerminal(objeto.status);

      if (objeto.restricoes.includes('nao_consumir')) {
        throw new BadRequestException(
          `${objeto.identificador} tem restrição "não consumir". Remova a restrição antes, com justificativa.`,
        );
      }

      await this.exigirFinalidadeCompativel(tx, objeto, dados.finalidade);

      const quantidade = dados.quantidade ?? 1;
      if (quantidade < 1) {
        throw new BadRequestException('A quantidade consumida precisa ser pelo menos 1.');
      }
      if (quantidade > objeto.quantidadeDisponivel) {
        throw new BadRequestException(
          `Restam ${objeto.quantidadeDisponivel} de ${objeto.identificador}; foram informados ${quantidade}.`,
        );
      }

      const restante = objeto.quantidadeDisponivel - quantidade;
      const status: StatusObjetoBiologico =
        restante === 0
          ? 'esgotado'
          : restante <= Math.max(1, Math.floor(objeto.quantidadeInicial * 0.2))
            ? 'proximo_esgotamento'
            : 'parcialmente_consumido';

      await tx
        .update(objetoBiologico)
        .set({
          quantidadeDisponivel: restante,
          status,
          condicao: restante === 0 ? 'esgotado' : objeto.condicao,
          atualizadoEm: new Date(),
        })
        .where(eq(objetoBiologico.id, objetoId));

      /**
       * Secao 24: "o Modulo 08 podera informar cada novo corte; o Modulo 17
       * devera refletir progressivamente o estado do bloco". O caminho de volta
       * tambem vale - quem consome pela Bioteca precisa deixar o bloco marcado
       * no M09, senao o pedido de IHQ nao ve o esgotamento.
       */
      if (objeto.blocoId) {
        await tx
          .update(bloco)
          .set({ esgotado: restante === 0, parcialmenteConsumido: restante > 0 })
          .where(eq(bloco.id, objeto.blocoId));
      }

      await this.registrarMovimentacao(tx, {
        objetoId,
        tipo: 'consumo',
        finalidade: dados.finalidade,
        quantidade,
        statusAnterior: objeto.status,
        statusNovo: status,
        observacao: dados.observacao ?? null,
      });

      if (restante === 0 && objeto.casoId) {
        await this.eventos.publicar(tx, {
          tipo: 'bioteca.material_esgotado',
          casoId: objeto.casoId,
          moduloOrigem: MODULOS.M18_BIOTECA,
          objetoTipo: 'objeto_biologico',
          objetoId,
          payload: { identificador: objeto.identificador },
        });
      }

      return { status, quantidadeDisponivel: restante };
    });
  }

  /**
   * Reserva (secoes 28, 29 e 69).
   *
   * Uma reserva de finalidade inferior nao passa por cima de outra ja ativa de
   * finalidade superior: a secao 29 poe diagnostico e pericia acima de ensino e
   * pesquisa, e o inverso continua livre - reservar para diagnostico um material
   * reservado para ensino e exatamente o que a hierarquia autoriza.
   */
  async reservar(
    objetoId: string,
    dados: {
      finalidade: FinalidadeUso;
      projeto?: string | null;
      justificativa?: string | null;
      vigenciaAte?: string | null;
    },
  ): Promise<{ id: string }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const objeto = await this.buscar(tx, objetoId);
      this.exigirNaoTerminal(objeto.status);

      const ativas = await this.reservasAtivas(tx, objetoId);
      const conflitante = ativas.find(
        (r) => prioridadeFinalidade(r.finalidade) < prioridadeFinalidade(dados.finalidade),
      );
      if (conflitante) {
        throw new BadRequestException(
          `${objeto.identificador} já está reservado para ${conflitante.finalidade}, que tem precedência sobre ${dados.finalidade}. Encerre a reserva atual antes, com justificativa.`,
        );
      }

      const [nova] = await tx
        .insert(reservaObjeto)
        .values({
          tenantId: ctx.tenantId,
          objetoId,
          finalidade: dados.finalidade,
          projeto: dados.projeto ?? null,
          justificativa: dados.justificativa ?? null,
          vigenciaAte: dados.vigenciaAte ? new Date(dados.vigenciaAte) : null,
          criadaPorId: ctx.usuarioId,
        })
        .returning({ id: reservaObjeto.id });

      if (STATUS_OBJETO_OCUPANDO_POSICAO.includes(objeto.status)) {
        await tx
          .update(objetoBiologico)
          .set({ status: 'reservado', atualizadoEm: new Date() })
          .where(eq(objetoBiologico.id, objetoId));
      }

      await this.auditoria.registrar(tx, {
        entidade: 'reserva_objeto',
        entidadeId: nova!.id,
        acao: 'criar',
        valorNovo: { objeto: objeto.identificador, finalidade: dados.finalidade },
      });

      return { id: nova!.id };
    });
  }

  async encerrarReserva(reservaId: string, motivo: string): Promise<void> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const [reserva] = await tx
        .select()
        .from(reservaObjeto)
        .where(and(eq(reservaObjeto.tenantId, ctx.tenantId), eq(reservaObjeto.id, reservaId)))
        .limit(1);

      if (!reserva) throw new NotFoundException('Reserva não encontrada.');
      if (!reserva.ativa) throw new BadRequestException('Esta reserva já foi encerrada.');

      await tx
        .update(reservaObjeto)
        .set({ ativa: false, encerradaEm: new Date(), motivoEncerramento: motivo })
        .where(eq(reservaObjeto.id, reservaId));

      const objeto = await this.buscar(tx, reserva.objetoId);
      if (objeto.status === 'reservado') {
        await tx
          .update(objetoBiologico)
          .set({ status: await this.statusDeRepouso(tx, objeto), atualizadoEm: new Date() })
          .where(eq(objetoBiologico.id, objeto.id));
      }
    });
  }

  /**
   * Emprestimo (secoes 35-38 e 41).
   *
   * O prazo e obrigatorio no schema: sem ele, a secao 38 nao tem como alertar e
   * a secao 39 nao tem como dizer que o material esta atrasado. Material com
   * restricao `nao_emprestar` e recusado aqui, nao no momento da entrega.
   */
  async emprestar(dados: {
    tipo: 'interno' | 'externo';
    finalidade: FinalidadeUso;
    destinatario: string;
    contatoDestinatario?: string | null;
    unidadeDestinoId?: string | null;
    prazoDevolucao: string;
    condicoes?: string | null;
    observacoes?: string | null;
    objetoIds: string[];
  }): Promise<{ id: string; identificador: string }> {
    const ctx = exigirContexto();

    if (dados.objetoIds.length === 0) {
      throw new BadRequestException('Selecione pelo menos um material para o empréstimo.');
    }

    return this.db.executar(async (tx) => {
      const objetos = await Promise.all(dados.objetoIds.map((id) => this.buscar(tx, id)));

      for (const objeto of objetos) {
        this.exigirNaoTerminal(objeto.status);
        if (objeto.restricoes.includes('nao_emprestar')) {
          throw new BadRequestException(
            `${objeto.identificador} tem restrição "não emprestar" registrada.`,
          );
        }
        if (objeto.restricoes.includes('restricao_pericial') && dados.finalidade !== 'pericia') {
          throw new BadRequestException(
            `${objeto.identificador} está sob restrição pericial e só sai para finalidade pericial, com autorização formal.`,
          );
        }
        if (objeto.status === 'emprestado' || objeto.status === 'em_uso') {
          throw new BadRequestException(
            `${objeto.identificador} já está fora do acervo. Registre a devolução antes.`,
          );
        }
        await this.exigirFinalidadeCompativel(tx, objeto, dados.finalidade);
      }

      const agora = new Date();
      const identificador = await this.numeracao.proximoEmprestimo(tx, agora.getFullYear());

      const [novo] = await tx
        .insert(emprestimo)
        .values({
          tenantId: ctx.tenantId,
          identificador,
          tipo: dados.tipo,
          finalidade: dados.finalidade,
          destinatario: dados.destinatario,
          contatoDestinatario: dados.contatoDestinatario ?? null,
          unidadeDestinoId: dados.unidadeDestinoId ?? null,
          condicoes: dados.condicoes ?? null,
          observacoes: dados.observacoes ?? null,
          prazoDevolucao: dados.prazoDevolucao,
          emprestadoPorId: ctx.usuarioId,
        })
        .returning({ id: emprestimo.id });

      for (const objeto of objetos) {
        await tx.insert(emprestimoItem).values({
          tenantId: ctx.tenantId,
          emprestimoId: novo!.id,
          objetoId: objeto.id,
        });

        await tx
          .update(objetoBiologico)
          .set({
            status: 'emprestado',
            localAtualId: null,
            localizacaoDescritiva: dados.destinatario,
            atualizadoEm: agora,
          })
          .where(eq(objetoBiologico.id, objeto.id));

        await this.registrarMovimentacao(tx, {
          objetoId: objeto.id,
          tipo: 'emprestimo_saida',
          origemLocalId: objeto.localAtualId,
          destinoDescritivo: dados.destinatario,
          finalidade: dados.finalidade,
          statusAnterior: objeto.status,
          statusNovo: 'emprestado',
          previsaoDevolucao: new Date(dados.prazoDevolucao),
          motivo: identificador,
        });
      }

      await this.auditoria.registrar(tx, {
        entidade: 'emprestimo',
        entidadeId: novo!.id,
        acao: 'criar',
        valorNovo: {
          identificador,
          destinatario: dados.destinatario,
          materiais: objetos.map((o) => o.identificador),
        },
      });

      return { id: novo!.id, identificador };
    });
  }

  /**
   * Devolucao de um item do emprestimo (secoes 34 e 39).
   *
   * O emprestimo so vai para `devolvido` quando o ultimo item volta. Enquanto
   * faltar um, ele fica `devolvido_parcial` - a secao 39 proibe encerrar um
   * emprestimo cujo material nao voltou, porque isso apagaria a unica pista de
   * onde o material esta.
   */
  async devolverEmprestimo(
    emprestimoId: string,
    dados: {
      objetoId: string;
      localId?: string | null;
      condicao?: CondicaoObjeto | null;
      observacao?: string | null;
    },
  ): Promise<{ status: string }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const [cabecalho] = await tx
        .select()
        .from(emprestimo)
        .where(and(eq(emprestimo.tenantId, ctx.tenantId), eq(emprestimo.id, emprestimoId)))
        .limit(1);

      if (!cabecalho) throw new NotFoundException('Empréstimo não encontrado.');

      const [item] = await tx
        .select()
        .from(emprestimoItem)
        .where(
          and(
            eq(emprestimoItem.emprestimoId, emprestimoId),
            eq(emprestimoItem.objetoId, dados.objetoId),
          ),
        )
        .limit(1);

      if (!item) throw new NotFoundException('Este material não faz parte do empréstimo.');
      if (item.devolvidoEm) throw new BadRequestException('Este material já foi devolvido.');

      const agora = new Date();
      await tx
        .update(emprestimoItem)
        .set({
          devolvidoEm: agora,
          condicaoDevolucao: dados.condicao ?? null,
          observacaoDevolucao: dados.observacao ?? null,
        })
        .where(eq(emprestimoItem.id, item.id));

      const objeto = await this.buscar(tx, dados.objetoId);
      const destinoId = dados.localId ?? objeto.localOrigemId;
      const destino = destinoId ? await this.exigirLocal(tx, destinoId) : null;
      const status = await this.statusDeRepouso(tx, objeto);

      await tx
        .update(objetoBiologico)
        .set({
          status,
          localOrigemId: destino?.id ?? objeto.localOrigemId,
          localAtualId: destino?.id ?? null,
          localizacaoDescritiva: destino ? null : 'Devolvido, sem posição definida',
          condicao: dados.condicao ?? objeto.condicao,
          atualizadoEm: agora,
        })
        .where(eq(objetoBiologico.id, objeto.id));

      await this.registrarMovimentacao(tx, {
        objetoId: objeto.id,
        tipo: 'emprestimo_retorno',
        destinoLocalId: destino?.id ?? null,
        statusAnterior: objeto.status,
        statusNovo: status,
        condicaoRegistrada: dados.condicao ?? null,
        motivo: cabecalho.identificador,
        observacao: dados.observacao ?? null,
      });

      const pendentes = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(emprestimoItem)
        .where(
          and(eq(emprestimoItem.emprestimoId, emprestimoId), isNull(emprestimoItem.devolvidoEm)),
        );

      const restantes = pendentes[0]?.total ?? 0;
      const novoStatus = restantes === 0 ? 'devolvido' : 'devolvido_parcial';

      await tx
        .update(emprestimo)
        .set({
          status: novoStatus,
          encerradoEm: restantes === 0 ? agora : null,
        })
        .where(eq(emprestimo.id, emprestimoId));

      return { status: novoStatus };
    });
  }

  /**
   * Marca emprestimos vencidos (secoes 38 e 39).
   *
   * Roda sob demanda ao abrir o painel: `atrasado` e um fato derivado da data,
   * e derivar na leitura evita depender de um job para que a tela diga a
   * verdade. `nao_devolvido` continua sendo decisao humana.
   */
  async atualizarAtrasos(): Promise<number> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const hoje = new Date().toISOString().slice(0, 10);
      const atualizados = await tx
        .update(emprestimo)
        .set({ status: 'atrasado' })
        .where(
          and(
            eq(emprestimo.tenantId, ctx.tenantId),
            inArray(emprestimo.status, ['aberto', 'devolvido_parcial']),
            /**
             * `<` e nao `<=`: quem vence HOJE ainda esta no prazo ate o fim do
             * dia. O Guardian ja compara com `< current_date`; marcar atrasado
             * aqui com `<=` faria as duas telas discordarem sobre o mesmo
             * emprestimo durante o dia inteiro do vencimento.
             */
            lt(emprestimo.prazoDevolucao, hoje),
          ),
        )
        .returning({ id: emprestimo.id });

      return atualizados.length;
    });
  }

  /**
   * Correcao de localizacao (secao 83).
   *
   * Nao e transferencia: transferencia move o material de verdade; correcao
   * conserta um registro que estava errado. O motivo e obrigatorio e o evento
   * anterior permanece - "o evento anterior permanece" e literal na secao 83.
   */
  async corrigirLocalizacao(objetoId: string, localId: string, motivo: string): Promise<void> {
    if (!motivo.trim()) {
      throw new BadRequestException('A correção de localização exige motivo registrado.');
    }

    return this.db.executar(async (tx) => {
      const objeto = await this.buscar(tx, objetoId);
      const destino = await this.exigirLocal(tx, localId);

      await tx
        .update(objetoBiologico)
        .set({
          localOrigemId: destino.id,
          localAtualId: destino.id,
          localizacaoDescritiva: null,
          atualizadoEm: new Date(),
        })
        .where(eq(objetoBiologico.id, objetoId));

      await this.registrarMovimentacao(tx, {
        objetoId,
        tipo: 'correcao_localizacao',
        origemLocalId: objeto.localAtualId,
        destinoLocalId: destino.id,
        motivo,
      });

      await this.auditoria.registrar(tx, {
        entidade: 'objeto_biologico',
        entidadeId: objetoId,
        acao: 'atualizar',
        valorAnterior: { localAtualId: objeto.localAtualId },
        valorNovo: { localAtualId: destino.id },
        justificativa: motivo,
      });
    });
  }

  /** Altera restricoes e preservacao especial (secoes 72 e 85). */
  async definirRestricoes(
    objetoId: string,
    dados: {
      restricoes: RestricaoObjeto[];
      preservacaoEspecial?: boolean | null;
      motivoRetencaoAmpliada?: MotivoRetencaoAmpliada | null;
      justificativa?: string | null;
    },
  ): Promise<void> {
    return this.db.executar(async (tx) => {
      const objeto = await this.buscar(tx, objetoId);

      const ampliaRetencao =
        dados.preservacaoEspecial === true || dados.motivoRetencaoAmpliada != null;
      if (ampliaRetencao && !dados.justificativa?.trim()) {
        throw new BadRequestException(
          'Retenção ampliada exige justificativa registrada (seção 48).',
        );
      }

      await tx
        .update(objetoBiologico)
        .set({
          restricoes: dados.restricoes,
          preservacaoEspecial: dados.preservacaoEspecial ?? objeto.preservacaoEspecial,
          motivoRetencaoAmpliada: dados.motivoRetencaoAmpliada ?? objeto.motivoRetencaoAmpliada,
          justificativaRetencao: dados.justificativa ?? objeto.justificativaRetencao,
          /** Secao 72: preservacao especial dispensa data prevista de descarte. */
          retencaoAte: dados.preservacaoEspecial === true ? null : objeto.retencaoAte,
          atualizadoEm: new Date(),
        })
        .where(eq(objetoBiologico.id, objetoId));

      await this.auditoria.registrar(tx, {
        entidade: 'objeto_biologico',
        entidadeId: objetoId,
        acao: 'atualizar',
        valorAnterior: { restricoes: objeto.restricoes },
        valorNovo: { restricoes: dados.restricoes },
        justificativa: dados.justificativa ?? null,
      });
    });
  }

  // --- Inventario ----------------------------------------------------------

  /** Abre um inventario por localizacao ou por tipo (secoes 54 e 55). */
  async abrirInventario(dados: {
    descricao?: string | null;
    localId?: string | null;
    tipoFiltro?: TipoObjetoBiologico | null;
  }): Promise<{ id: string; identificador: string; esperados: number }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const identificador = await this.numeracao.proximoInventario(tx, new Date().getFullYear());

      const [novo] = await tx
        .insert(inventarioBioteca)
        .values({
          tenantId: ctx.tenantId,
          identificador,
          descricao: dados.descricao ?? null,
          localId: dados.localId ?? null,
          tipoFiltro: dados.tipoFiltro ?? null,
          iniciadoPorId: ctx.usuarioId,
        })
        .returning({ id: inventarioBioteca.id });

      const esperados = await this.objetosEsperados(tx, dados.localId ?? null, dados.tipoFiltro);

      for (const objeto of esperados) {
        await tx.insert(inventarioItem).values({
          tenantId: ctx.tenantId,
          inventarioId: novo!.id,
          objetoId: objeto.id,
          localEsperadoId: objeto.localAtualId,
          registradoPorId: ctx.usuarioId,
        });
      }

      return { id: novo!.id, identificador, esperados: esperados.length };
    });
  }

  /**
   * Registra a leitura de um material durante o inventario (secao 56).
   *
   * Tres divergencias saem daqui automaticamente: objeto lido em posicao
   * diferente da esperada, objeto lido que nao existe no cadastro, e condicao
   * diferente da registrada. A quarta - `nao_localizado` - so pode ser apurada
   * no fechamento, porque e a ausencia de leitura.
   */
  async registrarLeitura(
    inventarioId: string,
    dados: {
      objetoId?: string | null;
      codigoLido?: string | null;
      localEncontradoId?: string | null;
      condicaoEncontrada?: CondicaoObjeto | null;
    },
  ): Promise<{ divergencia: DivergenciaInventario | null }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const inventario = await this.exigirInventarioAberto(tx, inventarioId);

      if (!dados.objetoId && !dados.codigoLido) {
        throw new BadRequestException('Informe o material lido ou o código encontrado.');
      }

      if (!dados.objetoId) {
        await tx.insert(inventarioItem).values({
          tenantId: ctx.tenantId,
          inventarioId: inventario.id,
          codigoLido: dados.codigoLido,
          encontrado: true,
          localEncontradoId: dados.localEncontradoId ?? null,
          divergencia: 'nao_cadastrado',
          registradoPorId: ctx.usuarioId,
        });
        return { divergencia: 'nao_cadastrado' as const };
      }

      const objeto = await this.buscar(tx, dados.objetoId);

      let divergencia: DivergenciaInventario | null = null;
      if (dados.localEncontradoId && dados.localEncontradoId !== objeto.localAtualId) {
        divergencia = 'posicao_incorreta';
      } else if (dados.condicaoEncontrada && dados.condicaoEncontrada !== objeto.condicao) {
        divergencia = 'condicao_divergente';
      }

      const [existente] = await tx
        .select({ id: inventarioItem.id })
        .from(inventarioItem)
        .where(
          and(
            eq(inventarioItem.inventarioId, inventario.id),
            eq(inventarioItem.objetoId, objeto.id),
          ),
        )
        .limit(1);

      const valores = {
        encontrado: true,
        localEncontradoId: dados.localEncontradoId ?? null,
        condicaoEncontrada: dados.condicaoEncontrada ?? null,
        divergencia,
        registradoPorId: ctx.usuarioId,
      };

      if (existente) {
        await tx.update(inventarioItem).set(valores).where(eq(inventarioItem.id, existente.id));
      } else {
        await tx.insert(inventarioItem).values({
          tenantId: ctx.tenantId,
          inventarioId: inventario.id,
          objetoId: objeto.id,
          localEsperadoId: objeto.localAtualId,
          codigoLido: dados.codigoLido ?? objeto.identificador,
          ...valores,
        });
      }

      await this.registrarMovimentacao(tx, {
        objetoId: objeto.id,
        tipo: 'inventario',
        origemLocalId: objeto.localAtualId,
        destinoLocalId: dados.localEncontradoId ?? null,
        motivo: inventario.identificador,
        observacao: divergencia,
      });

      return { divergencia };
    });
  }

  /**
   * Reconciliacao (secao 57).
   *
   * A correcao "devera preservar localizacao anterior, localizacao encontrada,
   * usuario, data e justificativa" - as cinco ficam gravadas no item, e o
   * objeto so muda de posicao atraves de `corrigirLocalizacao`, que gera o seu
   * proprio evento append-only.
   */
  async reconciliar(itemId: string, justificativa: string): Promise<void> {
    const ctx = exigirContexto();

    if (!justificativa.trim()) {
      throw new BadRequestException('A reconciliação exige justificativa registrada.');
    }

    return this.db.executar(async (tx) => {
      const [item] = await tx
        .select()
        .from(inventarioItem)
        .where(and(eq(inventarioItem.tenantId, ctx.tenantId), eq(inventarioItem.id, itemId)))
        .limit(1);

      if (!item) throw new NotFoundException('Item de inventário não encontrado.');
      if (!item.divergencia) throw new BadRequestException('Este item não tem divergência.');

      await tx
        .update(inventarioItem)
        .set({
          reconciliadoEm: new Date(),
          reconciliadoPorId: ctx.usuarioId,
          justificativaReconciliacao: justificativa,
        })
        .where(eq(inventarioItem.id, itemId));

      if (item.divergencia === 'posicao_incorreta' && item.objetoId && item.localEncontradoId) {
        await this.corrigirLocalizacaoInterna(
          tx,
          item.objetoId,
          item.localEncontradoId,
          justificativa,
        );
      }

      if (item.divergencia === 'nao_localizado' && item.objetoId) {
        await tx
          .update(objetoBiologico)
          .set({ status: 'nao_localizado', atualizadoEm: new Date() })
          .where(eq(objetoBiologico.id, item.objetoId));
      }
    });
  }

  /**
   * Fecha o inventario (secoes 56 e 58).
   *
   * O que nao foi lido vira `nao_localizado` - e aqui que a divergencia por
   * ausencia aparece, porque so no fechamento se sabe que ninguem encontrou o
   * material. O objeto ainda nao vira `perdido`: a secao 58 poe uma
   * investigacao entre os dois.
   */
  async concluirInventario(inventarioId: string): Promise<Record<string, number>> {
    return this.db.executar(async (tx) => {
      const inventario = await this.exigirInventarioAberto(tx, inventarioId);

      const naoLidos = await tx
        .select({ id: inventarioItem.id, objetoId: inventarioItem.objetoId })
        .from(inventarioItem)
        .where(
          and(
            eq(inventarioItem.inventarioId, inventario.id),
            eq(inventarioItem.encontrado, false),
            isNull(inventarioItem.divergencia),
          ),
        );

      for (const item of naoLidos) {
        await tx
          .update(inventarioItem)
          .set({ divergencia: 'nao_localizado' })
          .where(eq(inventarioItem.id, item.id));
      }

      const itens = await tx
        .select({
          encontrado: inventarioItem.encontrado,
          divergencia: inventarioItem.divergencia,
        })
        .from(inventarioItem)
        .where(eq(inventarioItem.inventarioId, inventario.id));

      const resumo = {
        total: itens.length,
        encontrados: itens.filter((i) => i.encontrado).length,
        naoLocalizados: itens.filter((i) => i.divergencia === 'nao_localizado').length,
        posicaoIncorreta: itens.filter((i) => i.divergencia === 'posicao_incorreta').length,
        naoCadastrados: itens.filter((i) => i.divergencia === 'nao_cadastrado').length,
        condicaoDivergente: itens.filter((i) => i.divergencia === 'condicao_divergente').length,
      };

      await tx
        .update(inventarioBioteca)
        .set({ concluidoEm: new Date(), resumo })
        .where(eq(inventarioBioteca.id, inventario.id));

      return resumo;
    });
  }

  // --- Destinacao ----------------------------------------------------------

  /**
   * Lista o que pode ser destinado (secao 50).
   *
   * Devolve tambem o que **nao** pode, com o motivo: uma lista que so mostra
   * elegiveis esconde exatamente a informacao que a operacao precisa - por que
   * aquele bloco vencido continua no armario.
   */
  async elegiveisParaDescarte(filtros: { tipo?: TipoObjetoBiologico; localId?: string } = {}) {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const condicoes = [
        eq(objetoBiologico.tenantId, ctx.tenantId),
        sql`${objetoBiologico.status} <> 'descartado'`,
      ];
      if (filtros.tipo) condicoes.push(eq(objetoBiologico.tipo, filtros.tipo));
      if (filtros.localId) condicoes.push(eq(objetoBiologico.localAtualId, filtros.localId));

      const candidatos = await tx
        .select()
        .from(objetoBiologico)
        .where(and(...condicoes))
        .orderBy(asc(objetoBiologico.retencaoAte));

      const agora = new Date();
      const elegiveis: unknown[] = [];
      const bloqueados: unknown[] = [];

      for (const objeto of candidatos) {
        const [emprestimosAbertos, reservas] = await Promise.all([
          this.emprestimosAbertosDoObjeto(tx, objeto.id),
          this.reservasAtivas(tx, objeto.id),
        ]);

        const motivo = motivoDescarteBloqueado({
          status: objeto.status,
          restricoes: objeto.restricoes,
          temEmprestimoAberto: emprestimosAbertos.length > 0,
          temReservaAtiva: reservas.length > 0,
          retencaoAte: objeto.retencaoAte ? new Date(objeto.retencaoAte) : null,
          agora,
        });

        const resumo = {
          id: objeto.id,
          identificador: objeto.identificador,
          tipo: objeto.tipo,
          descricao: objeto.descricao,
          retencaoAte: objeto.retencaoAte,
          preservacaoEspecial: objeto.preservacaoEspecial,
        };

        if (motivo) bloqueados.push({ ...resumo, motivo });
        else elegiveis.push(resumo);
      }

      return { elegiveis, bloqueados };
    });
  }

  /**
   * Descarte em lote (secoes 51-53).
   *
   * Cada objeto e revalidado individualmente, mesmo tendo saido da lista de
   * elegiveis: entre montar a lista e confirmar, alguem pode ter emprestado o
   * material. E `descartar` **nao apaga o objeto** - muda o status e mantem o
   * historico consultavel (secao 53).
   */
  async descartar(dados: {
    metodo: MetodoDescarte;
    empresa?: string | null;
    observacoes?: string | null;
    objetoIds: string[];
  }): Promise<{ id: string; identificador: string; descartados: number }> {
    const ctx = exigirContexto();

    if (dados.objetoIds.length === 0) {
      throw new BadRequestException('Selecione pelo menos um material para o lote de destinação.');
    }

    return this.db.executar(async (tx) => {
      const agora = new Date();
      const identificador = await this.numeracao.proximoLoteDescarte(tx, agora.getFullYear());

      const [lote] = await tx
        .insert(loteDescarte)
        .values({
          tenantId: ctx.tenantId,
          identificador,
          metodo: dados.metodo,
          empresa: dados.empresa ?? null,
          observacoes: dados.observacoes ?? null,
          executadoEm: agora,
          autorizadoPorId: ctx.usuarioId,
        })
        .returning({ id: loteDescarte.id });

      for (const objetoId of dados.objetoIds) {
        const objeto = await this.buscar(tx, objetoId);

        const [emprestimosAbertos, reservas] = await Promise.all([
          this.emprestimosAbertosDoObjeto(tx, objetoId),
          this.reservasAtivas(tx, objetoId),
        ]);

        const motivo = motivoDescarteBloqueado({
          status: objeto.status,
          restricoes: objeto.restricoes,
          temEmprestimoAberto: emprestimosAbertos.length > 0,
          temReservaAtiva: reservas.length > 0,
          retencaoAte: objeto.retencaoAte ? new Date(objeto.retencaoAte) : null,
          agora,
        });

        if (motivo) {
          throw new BadRequestException(`${objeto.identificador}: ${motivo}`);
        }

        await tx
          .update(objetoBiologico)
          .set({
            status: 'descartado',
            localAtualId: null,
            localizacaoDescritiva: identificador,
            atualizadoEm: agora,
          })
          .where(eq(objetoBiologico.id, objetoId));

        await this.registrarMovimentacao(tx, {
          objetoId,
          tipo: 'descarte',
          origemLocalId: objeto.localAtualId,
          destinoDescritivo: identificador,
          statusAnterior: objeto.status,
          statusNovo: 'descartado',
          motivo: dados.metodo,
        });

        await this.auditoria.registrar(tx, {
          entidade: 'objeto_biologico',
          entidadeId: objetoId,
          acao: 'atualizar',
          valorAnterior: { status: objeto.status },
          valorNovo: { status: 'descartado', lote: identificador },
          justificativa: dados.observacoes ?? null,
        });
      }

      return { id: lote!.id, identificador, descartados: dados.objetoIds.length };
    });
  }

  // --- Colecoes ------------------------------------------------------------

  /** Colecao virtual (secoes 73-74): agrupa sem mover nada de lugar. */
  async criarColecao(dados: {
    nome: string;
    descricao?: string | null;
    finalidade?: FinalidadeUso | null;
    projeto?: string | null;
  }): Promise<{ id: string }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const [nova] = await tx
        .insert(colecaoBiologica)
        .values({
          tenantId: ctx.tenantId,
          nome: dados.nome,
          descricao: dados.descricao ?? null,
          finalidade: dados.finalidade ?? null,
          projeto: dados.projeto ?? null,
          criadaPorId: ctx.usuarioId,
        })
        .returning({ id: colecaoBiologica.id });

      return { id: nova!.id };
    });
  }

  async adicionarNaColecao(
    colecaoId: string,
    objetoId: string,
    nota?: string | null,
  ): Promise<void> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      await this.buscar(tx, objetoId);

      const [colecao] = await tx
        .select({ id: colecaoBiologica.id })
        .from(colecaoBiologica)
        .where(and(eq(colecaoBiologica.tenantId, ctx.tenantId), eq(colecaoBiologica.id, colecaoId)))
        .limit(1);

      if (!colecao) throw new NotFoundException('Coleção não encontrada.');

      await tx
        .insert(colecaoItem)
        .values({ tenantId: ctx.tenantId, colecaoId, objetoId, nota: nota ?? null })
        .onConflictDoNothing();
    });
  }

  // --- Consultas -----------------------------------------------------------

  /** Busca do acervo (secoes 77 e 79). */
  async listar(filtros: {
    status?: StatusObjetoBiologico;
    tipo?: TipoObjetoBiologico;
    casoId?: string;
    localId?: string;
    busca?: string;
    apenasDisponiveis?: boolean;
  }) {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const condicoes = [eq(objetoBiologico.tenantId, ctx.tenantId)];
      if (filtros.status) condicoes.push(eq(objetoBiologico.status, filtros.status));
      if (filtros.tipo) condicoes.push(eq(objetoBiologico.tipo, filtros.tipo));
      if (filtros.casoId) condicoes.push(eq(objetoBiologico.casoId, filtros.casoId));
      if (filtros.localId) condicoes.push(eq(objetoBiologico.localAtualId, filtros.localId));
      if (filtros.apenasDisponiveis) {
        condicoes.push(
          inArray(objetoBiologico.status, [
            'disponivel',
            'arquivado',
            'parcialmente_consumido',
            'proximo_esgotamento',
          ]),
        );
      }
      if (filtros.busca) {
        const termo = `%${filtros.busca}%`;
        condicoes.push(
          or(
            sql`${objetoBiologico.identificador} ILIKE ${termo}`,
            sql`${objetoBiologico.descricao} ILIKE ${termo}`,
            sql`${objetoBiologico.orgao} ILIKE ${termo}`,
          )!,
        );
      }

      return tx
        .select({
          id: objetoBiologico.id,
          identificador: objetoBiologico.identificador,
          tipo: objetoBiologico.tipo,
          descricao: objetoBiologico.descricao,
          orgao: objetoBiologico.orgao,
          status: objetoBiologico.status,
          condicao: objetoBiologico.condicao,
          quantidadeDisponivel: objetoBiologico.quantidadeDisponivel,
          quantidadeInicial: objetoBiologico.quantidadeInicial,
          restricoes: objetoBiologico.restricoes,
          retencaoAte: objetoBiologico.retencaoAte,
          preservacaoEspecial: objetoBiologico.preservacaoEspecial,
          localizacaoDescritiva: objetoBiologico.localizacaoDescritiva,
          localCodigo: localFisico.codigo,
          localNome: localFisico.nome,
          casoIdentificador: caso.identificador,
        })
        .from(objetoBiologico)
        .leftJoin(localFisico, eq(localFisico.id, objetoBiologico.localAtualId))
        .leftJoin(caso, eq(caso.id, objetoBiologico.casoId))
        .where(and(...condicoes))
        .orderBy(desc(objetoBiologico.criadoEm))
        .limit(200);
    });
  }

  /**
   * Ficha do objeto (secoes 80 e 81).
   *
   * A linha do tempo nao e um extra: a secao 81 diz que "essa timeline sera
   * essencial". Ela e a resposta para "onde esteve, quem usou, quando voltou" -
   * e o que transforma um bloco em algo mais que a etiqueta `A3`.
   */
  async ficha(objetoId: string) {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const objeto = await this.buscar(tx, objetoId);

      const [local] = objeto.localAtualId
        ? await tx
            .select({ id: localFisico.id, codigo: localFisico.codigo, nome: localFisico.nome })
            .from(localFisico)
            .where(eq(localFisico.id, objeto.localAtualId))
            .limit(1)
        : [];

      const [origem] = objeto.localOrigemId
        ? await tx
            .select({ id: localFisico.id, codigo: localFisico.codigo, nome: localFisico.nome })
            .from(localFisico)
            .where(eq(localFisico.id, objeto.localOrigemId))
            .limit(1)
        : [];

      const movimentacoes = await tx
        .select({
          id: movimentacaoObjeto.id,
          tipo: movimentacaoObjeto.tipo,
          finalidade: movimentacaoObjeto.finalidade,
          destinoDescritivo: movimentacaoObjeto.destinoDescritivo,
          quantidade: movimentacaoObjeto.quantidade,
          statusNovo: movimentacaoObjeto.statusNovo,
          motivo: movimentacaoObjeto.motivo,
          observacao: movimentacaoObjeto.observacao,
          registradaEm: movimentacaoObjeto.registradaEm,
          usuarioNome: usuario.nomeCompleto,
          origemCodigo: sql<string | null>`(
            select l.codigo from ${localFisico} l where l.id = movimentacao_objeto.origem_local_id
          )`,
          destinoCodigo: sql<string | null>`(
            select l.codigo from ${localFisico} l where l.id = movimentacao_objeto.destino_local_id
          )`,
        })
        .from(movimentacaoObjeto)
        .leftJoin(usuario, eq(usuario.id, movimentacaoObjeto.registradaPorId))
        .where(
          and(
            eq(movimentacaoObjeto.tenantId, ctx.tenantId),
            eq(movimentacaoObjeto.objetoId, objetoId),
          ),
        )
        .orderBy(desc(movimentacaoObjeto.registradaEm));

      const reservas = await tx
        .select()
        .from(reservaObjeto)
        .where(
          and(eq(reservaObjeto.tenantId, ctx.tenantId), eq(reservaObjeto.objetoId, objetoId)),
        )
        .orderBy(desc(reservaObjeto.criadaEm));

      const emprestimos = await tx
        .select({
          id: emprestimo.id,
          identificador: emprestimo.identificador,
          tipo: emprestimo.tipo,
          finalidade: emprestimo.finalidade,
          destinatario: emprestimo.destinatario,
          status: emprestimo.status,
          prazoDevolucao: emprestimo.prazoDevolucao,
          devolvidoEm: emprestimoItem.devolvidoEm,
        })
        .from(emprestimoItem)
        .innerJoin(emprestimo, eq(emprestimo.id, emprestimoItem.emprestimoId))
        .where(
          and(eq(emprestimoItem.tenantId, ctx.tenantId), eq(emprestimoItem.objetoId, objetoId)),
        )
        .orderBy(desc(emprestimo.emprestadoEm));

      /** Genealogia (secao 5): de onde este objeto veio, dentro do proprio acervo. */
      const genealogia = await this.genealogia(tx, objeto);

      return {
        ...objeto,
        local: local ?? null,
        localOrigem: origem ?? null,
        movimentacoes,
        reservas,
        emprestimos,
        genealogia,
      };
    });
  }

  /**
   * Mapa de posicoes e ocupacao (secoes 19 e 20).
   *
   * "Sempre que possivel, a interface devera mostrar posicoes" - e o mapa
   * mostra tanto o que esta ocupado quanto o que esta livre, porque planejar
   * espaco depende das duas metades.
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
          capacidade: localFisico.capacidade,
          condicaoAmbiental: localFisico.condicaoAmbiental,
          status: localFisico.status,
          /**
           * A coluna externa vai escrita por extenso (`local_fisico.id`), e nao
           * como `${localFisico.id}`: numa consulta de tabela unica o drizzle
           * emite so `"id"`, que dentro da subconsulta resolve para o `id` do
           * escopo interno. A correlacao vira `o.local_atual_id = o.id`, nao da
           * erro e devolve zero ocupacao em silencio.
           */
          ocupacao: sql<number>`(
            select count(*)::int from ${objetoBiologico} o
            where o.local_atual_id = local_fisico.id
              and o.tenant_id = local_fisico.tenant_id
              and o.status = any(${sql.raw(`ARRAY[${STATUS_OBJETO_OCUPANDO_POSICAO.map((s) => `'${s}'`).join(',')}]::status_objeto_biologico[]`)})
          )`,
        })
        .from(localFisico)
        .where(and(eq(localFisico.tenantId, ctx.tenantId), isNull(localFisico.inativadoEm)))
        .orderBy(asc(localFisico.codigo));

      const foraDoAcervo = await tx
        .select({
          id: objetoBiologico.id,
          identificador: objetoBiologico.identificador,
          tipo: objetoBiologico.tipo,
          status: objetoBiologico.status,
          localizacaoDescritiva: objetoBiologico.localizacaoDescritiva,
          origemCodigo: sql<string | null>`(
            select l.codigo from ${localFisico} l where l.id = objeto_biologico.local_origem_id
          )`,
        })
        .from(objetoBiologico)
        .where(
          and(
            eq(objetoBiologico.tenantId, ctx.tenantId),
            inArray(objetoBiologico.status, ['em_uso', 'emprestado', 'enviado']),
          ),
        )
        .orderBy(asc(objetoBiologico.identificador));

      return {
        posicoes: posicoes.map((p) => ({
          ...p,
          livres: p.capacidade == null ? null : Math.max(0, p.capacidade - p.ocupacao),
          percentual:
            p.capacidade && p.capacidade > 0 ? Math.round((p.ocupacao / p.capacidade) * 100) : null,
        })),
        foraDoAcervo,
      };
    });
  }

  /** Emprestimos abertos e vencidos (secoes 38, 39 e 87). */
  async emprestimos(filtros: { apenasAbertos?: boolean } = {}) {
    const ctx = exigirContexto();
    await this.atualizarAtrasos();

    return this.db.executar(async (tx) => {
      const condicoes = [eq(emprestimo.tenantId, ctx.tenantId)];
      if (filtros.apenasAbertos) {
        condicoes.push(inArray(emprestimo.status, STATUS_EMPRESTIMO_ABERTOS));
      }

      return tx
        .select({
          id: emprestimo.id,
          identificador: emprestimo.identificador,
          tipo: emprestimo.tipo,
          finalidade: emprestimo.finalidade,
          destinatario: emprestimo.destinatario,
          status: emprestimo.status,
          prazoDevolucao: emprestimo.prazoDevolucao,
          emprestadoEm: emprestimo.emprestadoEm,
          /** Coluna externa por extenso — ver a nota em `mapa()`. */
          itens: sql<number>`(
            select count(*)::int from ${emprestimoItem} i where i.emprestimo_id = emprestimo.id
          )`,
          pendentes: sql<number>`(
            select count(*)::int from ${emprestimoItem} i
            where i.emprestimo_id = emprestimo.id and i.devolvido_em is null
          )`,
          diasAtraso: sql<number>`greatest(0, (current_date - ${emprestimo.prazoDevolucao})::int)`,
        })
        .from(emprestimo)
        .where(and(...condicoes))
        .orderBy(asc(emprestimo.prazoDevolucao));
    });
  }

  /** Detalhe de um emprestimo com os itens (secao 37). */
  async emprestimoDetalhe(emprestimoId: string) {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const [cabecalho] = await tx
        .select()
        .from(emprestimo)
        .where(and(eq(emprestimo.tenantId, ctx.tenantId), eq(emprestimo.id, emprestimoId)))
        .limit(1);

      if (!cabecalho) throw new NotFoundException('Empréstimo não encontrado.');

      const itens = await tx
        .select({
          objetoId: emprestimoItem.objetoId,
          identificador: objetoBiologico.identificador,
          tipo: objetoBiologico.tipo,
          descricao: objetoBiologico.descricao,
          devolvidoEm: emprestimoItem.devolvidoEm,
          condicaoDevolucao: emprestimoItem.condicaoDevolucao,
        })
        .from(emprestimoItem)
        .innerJoin(objetoBiologico, eq(objetoBiologico.id, emprestimoItem.objetoId))
        .where(eq(emprestimoItem.emprestimoId, emprestimoId));

      return { ...cabecalho, itens };
    });
  }

  /** Inventario com os itens e as divergencias (secoes 54-57). */
  async inventarioDetalhe(inventarioId: string) {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const [cabecalho] = await tx
        .select()
        .from(inventarioBioteca)
        .where(
          and(eq(inventarioBioteca.tenantId, ctx.tenantId), eq(inventarioBioteca.id, inventarioId)),
        )
        .limit(1);

      if (!cabecalho) throw new NotFoundException('Inventário não encontrado.');

      const itens = await tx
        .select({
          id: inventarioItem.id,
          objetoId: inventarioItem.objetoId,
          identificador: objetoBiologico.identificador,
          codigoLido: inventarioItem.codigoLido,
          encontrado: inventarioItem.encontrado,
          divergencia: inventarioItem.divergencia,
          reconciliadoEm: inventarioItem.reconciliadoEm,
          esperadoCodigo: sql<string | null>`(
            select l.codigo from ${localFisico} l where l.id = inventario_item.local_esperado_id
          )`,
          encontradoCodigo: sql<string | null>`(
            select l.codigo from ${localFisico} l where l.id = inventario_item.local_encontrado_id
          )`,
        })
        .from(inventarioItem)
        .leftJoin(objetoBiologico, eq(objetoBiologico.id, inventarioItem.objetoId))
        .where(eq(inventarioItem.inventarioId, inventarioId));

      return { ...cabecalho, itens };
    });
  }

  async listarInventarios() {
    const ctx = exigirContexto();

    return this.db.executar((tx) =>
      tx
        .select({
          id: inventarioBioteca.id,
          identificador: inventarioBioteca.identificador,
          descricao: inventarioBioteca.descricao,
          iniciadoEm: inventarioBioteca.iniciadoEm,
          concluidoEm: inventarioBioteca.concluidoEm,
          resumo: inventarioBioteca.resumo,
          localCodigo: localFisico.codigo,
        })
        .from(inventarioBioteca)
        .leftJoin(localFisico, eq(localFisico.id, inventarioBioteca.localId))
        .where(eq(inventarioBioteca.tenantId, ctx.tenantId))
        .orderBy(desc(inventarioBioteca.iniciadoEm)),
    );
  }

  /**
   * Disponibilidade por caso (secao 76).
   *
   * E a pergunta que a microscopia faz: "ainda existe bloco deste caso?". A
   * resposta da secao 76 nao e sim ou nao - e "Blocos A1, A2 e A3 disponiveis.
   * A2 proximo do esgotamento", com o estado de cada um.
   */
  async porCaso(casoId: string) {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      await this.exigirCaso(tx, casoId);

      const objetos = await tx
        .select({
          id: objetoBiologico.id,
          identificador: objetoBiologico.identificador,
          tipo: objetoBiologico.tipo,
          descricao: objetoBiologico.descricao,
          orgao: objetoBiologico.orgao,
          status: objetoBiologico.status,
          condicao: objetoBiologico.condicao,
          quantidadeDisponivel: objetoBiologico.quantidadeDisponivel,
          restricoes: objetoBiologico.restricoes,
          localCodigo: localFisico.codigo,
          localizacaoDescritiva: objetoBiologico.localizacaoDescritiva,
          blocoIdentificador: bloco.identificador,
          laminaIdentificador: lamina.identificador,
        })
        .from(objetoBiologico)
        .leftJoin(localFisico, eq(localFisico.id, objetoBiologico.localAtualId))
        .leftJoin(bloco, eq(bloco.id, objetoBiologico.blocoId))
        .leftJoin(lamina, eq(lamina.id, objetoBiologico.laminaId))
        .where(
          and(eq(objetoBiologico.tenantId, ctx.tenantId), eq(objetoBiologico.casoId, casoId)),
        )
        .orderBy(asc(objetoBiologico.identificador));

      return {
        objetos,
        resumo: {
          total: objetos.length,
          disponiveis: objetos.filter((o) =>
            ['disponivel', 'arquivado', 'parcialmente_consumido', 'proximo_esgotamento'].includes(
              o.status,
            ),
          ).length,
          esgotados: objetos.filter((o) => o.status === 'esgotado').length,
          fora: objetos.filter((o) => ['em_uso', 'emprestado', 'enviado'].includes(o.status))
            .length,
        },
      };
    });
  }

  /**
   * Varredura do Guardian (secao 86).
   *
   * Nao barra nada: procura incoerencias que ja existem no acervo - emprestimo
   * vencido, material sem localizacao, congelado em equipamento incompativel,
   * elegivel para descarte mas preso por processo ativo.
   */
  async conferencia() {
    await this.atualizarAtrasos();
    return this.db.executar((tx) => this.guardian.verificarBioteca(tx));
  }

  // --- internos ------------------------------------------------------------

  private async registrarMovimentacao(
    tx: Transacao,
    dados: {
      objetoId: string;
      tipo:
        | 'arquivamento'
        | 'retirada'
        | 'devolucao'
        | 'transferencia'
        | 'emprestimo_saida'
        | 'emprestimo_retorno'
        | 'correcao_localizacao'
        | 'consumo'
        | 'mudanca_condicao'
        | 'inventario'
        | 'descarte';
      origemLocalId?: string | null;
      destinoLocalId?: string | null;
      destinoDescritivo?: string | null;
      finalidade?: FinalidadeUso | null;
      quantidade?: number | null;
      statusAnterior?: StatusObjetoBiologico | null;
      statusNovo?: StatusObjetoBiologico | null;
      condicaoRegistrada?: CondicaoObjeto | null;
      motivo?: string | null;
      observacao?: string | null;
      previsaoDevolucao?: Date | null;
    },
  ): Promise<void> {
    const ctx = exigirContexto();

    await tx.insert(movimentacaoObjeto).values({
      tenantId: ctx.tenantId,
      objetoId: dados.objetoId,
      tipo: dados.tipo,
      origemLocalId: dados.origemLocalId ?? null,
      destinoLocalId: dados.destinoLocalId ?? null,
      destinoDescritivo: dados.destinoDescritivo ?? null,
      finalidade: dados.finalidade ?? null,
      quantidade: dados.quantidade ?? null,
      statusAnterior: dados.statusAnterior ?? null,
      statusNovo: dados.statusNovo ?? null,
      condicaoRegistrada: dados.condicaoRegistrada ?? null,
      motivo: dados.motivo ?? null,
      observacao: dados.observacao ?? null,
      previsaoDevolucao: dados.previsaoDevolucao ?? null,
      registradaPorId: ctx.usuarioId,
    });
  }

  private async corrigirLocalizacaoInterna(
    tx: Transacao,
    objetoId: string,
    localId: string,
    motivo: string,
  ) {
    const objeto = await this.buscar(tx, objetoId);
    await tx
      .update(objetoBiologico)
      .set({
        localOrigemId: localId,
        localAtualId: localId,
        localizacaoDescritiva: null,
        atualizadoEm: new Date(),
      })
      .where(eq(objetoBiologico.id, objetoId));

    await this.registrarMovimentacao(tx, {
      objetoId,
      tipo: 'correcao_localizacao',
      origemLocalId: objeto.localAtualId,
      destinoLocalId: localId,
      motivo,
    });
  }

  /**
   * Para qual status o objeto volta quando repousa no acervo.
   *
   * Nao e sempre `disponivel`: um material com reserva ativa volta para
   * `reservado`, e um parcialmente consumido nao pode "rejuvenescer" para
   * disponivel so porque voltou da bancada.
   */
  private async statusDeRepouso(
    tx: Transacao,
    objeto: { id: string; quantidadeInicial: number; quantidadeDisponivel: number },
  ): Promise<StatusObjetoBiologico> {
    const reservas = await this.reservasAtivas(tx, objeto.id);
    if (reservas.length > 0) return 'reservado';
    if (objeto.quantidadeDisponivel === 0) return 'esgotado';
    if (objeto.quantidadeDisponivel < objeto.quantidadeInicial) return 'parcialmente_consumido';
    return 'disponivel';
  }

  /**
   * Hierarquia de finalidade (secao 29) aplicada ao pedido.
   *
   * Recusa quando o material esta reservado para uma finalidade de precedencia
   * maior. O caminho inverso e explicitamente permitido: a secao 71 diz que "a
   * retirada para pesquisa nao devera impedir necessidade diagnostica futura",
   * e o corolario e que a necessidade diagnostica passa por cima da reserva de
   * pesquisa.
   */
  private async exigirFinalidadeCompativel(
    tx: Transacao,
    objeto: { id: string; identificador: string },
    finalidade: FinalidadeUso,
  ) {
    const reservas = await this.reservasAtivas(tx, objeto.id);
    const conflitante = reservas.find(
      (r) => prioridadeFinalidade(r.finalidade) < prioridadeFinalidade(finalidade),
    );

    if (conflitante) {
      throw new BadRequestException(
        `${objeto.identificador} está reservado para ${conflitante.finalidade}, que tem precedência sobre ${finalidade}. Encerre a reserva antes, com justificativa.`,
      );
    }
  }

  private async reservasAtivas(tx: Transacao, objetoId: string) {
    const ctx = exigirContexto();
    const agora = new Date();

    return tx
      .select()
      .from(reservaObjeto)
      .where(
        and(
          eq(reservaObjeto.tenantId, ctx.tenantId),
          eq(reservaObjeto.objetoId, objetoId),
          eq(reservaObjeto.ativa, true),
          or(isNull(reservaObjeto.vigenciaAte), gt(reservaObjeto.vigenciaAte, agora))!,
        ),
      );
  }

  private async emprestimosAbertosDoObjeto(tx: Transacao, objetoId: string) {
    const ctx = exigirContexto();

    return tx
      .select({ id: emprestimo.id })
      .from(emprestimoItem)
      .innerJoin(emprestimo, eq(emprestimo.id, emprestimoItem.emprestimoId))
      .where(
        and(
          eq(emprestimoItem.tenantId, ctx.tenantId),
          eq(emprestimoItem.objetoId, objetoId),
          isNull(emprestimoItem.devolvidoEm),
          inArray(emprestimo.status, STATUS_EMPRESTIMO_ABERTOS),
        ),
      );
  }

  private async objetosEsperados(
    tx: Transacao,
    localId: string | null,
    tipo?: TipoObjetoBiologico | null,
  ) {
    const ctx = exigirContexto();
    const condicoes = [
      eq(objetoBiologico.tenantId, ctx.tenantId),
      inArray(objetoBiologico.status, STATUS_OBJETO_OCUPANDO_POSICAO),
    ];
    if (localId) condicoes.push(eq(objetoBiologico.localAtualId, localId));
    if (tipo) condicoes.push(eq(objetoBiologico.tipo, tipo));

    return tx
      .select({ id: objetoBiologico.id, localAtualId: objetoBiologico.localAtualId })
      .from(objetoBiologico)
      .where(and(...condicoes));
  }

  /** Cadeia de origem dentro do acervo (secoes 5 e 65). */
  private async genealogia(tx: Transacao, objeto: { objetoPaiId: string | null }) {
    const ctx = exigirContexto();
    const cadeia: Array<{ id: string; identificador: string; tipo: string }> = [];
    let paiId = objeto.objetoPaiId;
    let profundidade = 0;

    while (paiId && profundidade < 10) {
      const [pai] = await tx
        .select({
          id: objetoBiologico.id,
          identificador: objetoBiologico.identificador,
          tipo: objetoBiologico.tipo,
          objetoPaiId: objetoBiologico.objetoPaiId,
        })
        .from(objetoBiologico)
        .where(and(eq(objetoBiologico.tenantId, ctx.tenantId), eq(objetoBiologico.id, paiId)))
        .limit(1);

      if (!pai) break;
      cadeia.push({ id: pai.id, identificador: pai.identificador, tipo: pai.tipo });
      paiId = pai.objetoPaiId;
      profundidade += 1;
    }

    return cadeia;
  }

  private exigirNaoTerminal(status: StatusObjetoBiologico) {
    if (status === 'descartado') {
      throw new BadRequestException(
        'Este material foi descartado. O registro permanece consultável, mas ele não volta ao acervo.',
      );
    }
    if (status === 'perdido') {
      throw new BadRequestException(
        'Este material está registrado como perdido. Reabra a investigação antes de movimentá-lo.',
      );
    }
  }

  /**
   * Secao 62: equipamento indisponivel nao recebe posicao nova; secao 86:
   * congelado em equipamento incompativel e achado do Guardian - e melhor
   * ainda barrar na entrada do que apontar depois que o tecido descongelou.
   */
  private exigirCompatibilidade(
    tipo: TipoObjetoBiologico,
    local: { codigo: string; status: string; condicaoAmbiental: string | null },
  ) {
    if (local.status !== 'operacional') {
      throw new BadRequestException(
        `O local ${local.codigo} está com status "${local.status}" e não recebe material novo.`,
      );
    }

    if (TIPOS_QUE_EXIGEM_FRIO.includes(tipo) && local.condicaoAmbiental !== 'congelado') {
      throw new BadRequestException(
        `${local.codigo} não é um equipamento de congelamento. Material congelado precisa de local com condição ambiental "congelado".`,
      );
    }
  }

  private async buscar(tx: Transacao, objetoId: string) {
    const ctx = exigirContexto();
    const [registro] = await tx
      .select()
      .from(objetoBiologico)
      .where(and(eq(objetoBiologico.tenantId, ctx.tenantId), eq(objetoBiologico.id, objetoId)))
      .limit(1);

    if (!registro) throw new NotFoundException('Material não encontrado no acervo.');
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
      throw new BadRequestException('Este local está inativado e não recebe material.');
    }
    return registro;
  }

  private async exigirInventarioAberto(tx: Transacao, inventarioId: string) {
    const ctx = exigirContexto();
    const [registro] = await tx
      .select()
      .from(inventarioBioteca)
      .where(
        and(eq(inventarioBioteca.tenantId, ctx.tenantId), eq(inventarioBioteca.id, inventarioId)),
      )
      .limit(1);

    if (!registro) throw new NotFoundException('Inventário não encontrado.');
    if (registro.concluidoEm) throw new BadRequestException('Este inventário já foi concluído.');
    return registro;
  }
}

import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import {
  amostra,
  caso,
  cassete,
  lesaoMacroscopica,
  macroscopia,
  margemMacroscopica,
  type Transacao,
} from '@lapato/db';
import {
  MODULOS,
  identificadorCassete,
  type Lateralidade,
  type MetodoAmostragem,
} from '@lapato/shared';
import { DbService } from '../../core/db/db.service.js';
import { EventosService } from '../../core/eventos/eventos.service.js';
import { GuardianService } from '../../core/guardian/guardian.service.js';
import { SugestoesService } from '../../core/ia/sugestoes.service.js';
import { FluxoService } from '../m07-fluxo/fluxo.service.js';
import { exigirContexto } from '../../core/contexto/contexto-requisicao.js';

export interface DadosMacroscopia {
  descricaoTexto?: string;
  caracteristicas?: Record<string, unknown>;
  comprimentoCm?: number;
  larguraCm?: number;
  alturaCm?: number;
  pesoG?: number;
  materialTotalmenteIncluido?: boolean;
  lesoes?: Array<{
    rotulo: string;
    tipo?: string;
    localizacao?: string;
    lateralidade?: Lateralidade;
    maiorEixoCm?: number;
    menorEixoCm?: number;
  }>;
  margens?: Array<{
    nome: string;
    metodoAmostragem?: MetodoAmostragem;
    distanciaCm?: number;
    tinta?: Record<string, unknown>;
    naoAvaliavel?: boolean;
  }>;
  cassetes?: Array<{
    tecidoOrigem: string;
    descricao?: string;
    exigeDescalcificacao?: boolean;
  }>;
}

/**
 * M08 - Macroscopia.
 *
 * Finalidade do modulo: "transformar uma peca anatomica em representacao
 * estruturada, mensuravel, fotografada e amostrada".
 *
 * Uma ficha por AMOSTRA, nao por caso. Campos estruturados e texto livre
 * coexistem - exigencia explicita, um nao substitui o outro.
 */
@Injectable()
export class MacroscopiaService {
  constructor(
    private readonly db: DbService,
    private readonly eventos: EventosService,
    private readonly fluxo: FluxoService,
    private readonly guardian: GuardianService,
    private readonly sugestoes: SugestoesService,
  ) {}

  async iniciar(amostraId: string): Promise<{ id: string }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const alvo = await this.buscarAmostra(tx, amostraId);

      // M06 -> M08: material bloqueado na triagem nao chega a bancada.
      if (alvo.resultadoTriagem === 'bloqueado' || alvo.resultadoTriagem === 'recusado') {
        throw new BadRequestException(
          `Amostra com triagem "${alvo.resultadoTriagem}" não pode iniciar macroscopia.`,
        );
      }

      const [existente] = await tx
        .select({ id: macroscopia.id })
        .from(macroscopia)
        .where(
          and(eq(macroscopia.tenantId, ctx.tenantId), eq(macroscopia.amostraId, amostraId)),
        )
        .limit(1);

      if (existente) return { id: existente.id };

      const [nova] = await tx
        .insert(macroscopia)
        .values({
          tenantId: ctx.tenantId,
          casoId: alvo.casoId,
          amostraId,
          iniciadaEm: new Date(),
          executadaPorId: ctx.usuarioId,
        })
        .returning({ id: macroscopia.id });

      await this.eventos.publicar(tx, {
        tipo: 'macroscopia.iniciada',
        casoId: alvo.casoId,
        moduloOrigem: MODULOS.M08_MACROSCOPIA,
        objetoTipo: 'amostra',
        objetoId: amostraId,
      });

      await this.fluxo.processarEvento(tx, alvo.casoId, 'macroscopia.iniciada');

      return { id: nova!.id };
    });
  }

  async salvar(macroscopiaId: string, dados: DadosMacroscopia): Promise<void> {
    const ctx = exigirContexto();

    await this.db.executar(async (tx) => {
      const registro = await this.buscarMacroscopia(tx, macroscopiaId);

      if (registro.concluidaEm) {
        // M08: alteracao apos a conclusao tem controle especial e permissao
        // propria (`macroscopia:alterar_apos_conclusao`).
        throw new BadRequestException(
          'Macroscopia já concluída. Use a rota de alteração pós-conclusão.',
        );
      }

      await tx
        .update(macroscopia)
        .set({
          descricaoTexto: dados.descricaoTexto ?? registro.descricaoTexto,
          caracteristicas: dados.caracteristicas ?? registro.caracteristicas,
          comprimentoCm: dados.comprimentoCm?.toString() ?? registro.comprimentoCm,
          larguraCm: dados.larguraCm?.toString() ?? registro.larguraCm,
          alturaCm: dados.alturaCm?.toString() ?? registro.alturaCm,
          pesoG: dados.pesoG?.toString() ?? registro.pesoG,
          materialTotalmenteIncluido:
            dados.materialTotalmenteIncluido ?? registro.materialTotalmenteIncluido,
          atualizadoEm: new Date(),
        })
        .where(eq(macroscopia.id, macroscopiaId));

      /**
       * Lesao e margem sao identificadas pelo rotulo/nome dentro da ficha, e o
       * conflito nesse par significa "esta e a mesma lesao", nao "ja existe,
       * ignore". Enquanto a macroscopia nao esta concluida ela e rascunho: uma
       * medida corrigida precisa gravar. Ignorar o conflito faria a correcao
       * sumir sem aviso - o salvamento responderia sucesso sem ter salvo nada.
       */
      if (dados.lesoes) {
        for (const l of dados.lesoes) {
          await tx
            .insert(lesaoMacroscopica)
            .values({
              tenantId: ctx.tenantId,
              macroscopiaId,
              rotulo: l.rotulo,
              tipo: l.tipo ?? null,
              localizacao: l.localizacao ?? null,
              lateralidade: l.lateralidade ?? 'nao_aplicavel',
              maiorEixoCm: l.maiorEixoCm?.toString() ?? null,
              menorEixoCm: l.menorEixoCm?.toString() ?? null,
            })
            .onConflictDoUpdate({
              target: [lesaoMacroscopica.macroscopiaId, lesaoMacroscopica.rotulo],
              set: {
                tipo: l.tipo ?? null,
                localizacao: l.localizacao ?? null,
                lateralidade: l.lateralidade ?? 'nao_aplicavel',
                maiorEixoCm: l.maiorEixoCm?.toString() ?? null,
                menorEixoCm: l.menorEixoCm?.toString() ?? null,
                atualizadoEm: new Date(),
              },
            });
        }
      }

      if (dados.margens) {
        for (const m of dados.margens) {
          await tx
            .insert(margemMacroscopica)
            .values({
              tenantId: ctx.tenantId,
              macroscopiaId,
              nome: m.nome,
              // M13: o metodo importa para interpretar a distancia depois.
              metodoAmostragem: m.metodoAmostragem ?? null,
              distanciaCm: m.distanciaCm?.toString() ?? null,
              tinta: m.tinta ?? null,
              naoAvaliavel: m.naoAvaliavel ?? false,
            })
            .onConflictDoUpdate({
              target: [margemMacroscopica.macroscopiaId, margemMacroscopica.nome],
              set: {
                metodoAmostragem: m.metodoAmostragem ?? null,
                distanciaCm: m.distanciaCm?.toString() ?? null,
                tinta: m.tinta ?? null,
                naoAvaliavel: m.naoAvaliavel ?? false,
                atualizadoEm: new Date(),
              },
            });
        }
      }

      if (dados.cassetes?.length) {
        await this.gerarCassetes(tx, registro, dados.cassetes);
      }
    });
  }

  /**
   * Conclusao da macroscopia.
   *
   * M08: residente e tecnico em treinamento executam, mas **nao concluem sem
   * aprovacao**. Por isso a checagem de `exigeSupervisao` acontece aqui, alem
   * da permissao no controller.
   */
  async concluir(macroscopiaId: string): Promise<void> {
    const ctx = exigirContexto();

    await this.db.executar(async (tx) => {
      const registro = await this.buscarMacroscopia(tx, macroscopiaId);

      if (registro.concluidaEm) {
        throw new BadRequestException('Macroscopia já concluída.');
      }

      if (ctx.exigeSupervisao) {
        throw new ForbiddenException(
          'Perfil em supervisão não conclui macroscopia. É necessária aprovação de um responsável.',
        );
      }

      const achados = await this.guardian.verificarConclusaoMacroscopia(tx, macroscopiaId);
      await this.sugestoes.registrarAchadosGuardian(
        tx,
        achados,
        registro.casoId,
        'conclusao_macroscopia',
      );
      this.guardian.garantirSemBloqueio(achados, 'concluir macroscopia');

      await tx
        .update(macroscopia)
        .set({ concluidaEm: new Date(), atualizadoEm: new Date() })
        .where(eq(macroscopia.id, macroscopiaId));

      const cassetes = await tx
        .select({ identificador: cassete.identificador })
        .from(cassete)
        .where(
          and(eq(cassete.tenantId, ctx.tenantId), eq(cassete.macroscopiaId, macroscopiaId)),
        );

      await this.eventos.publicar(tx, {
        tipo: 'cassetes.gerados',
        casoId: registro.casoId,
        moduloOrigem: MODULOS.M08_MACROSCOPIA,
        payload: { cassetes: cassetes.map((c) => c.identificador) },
      });

      await this.eventos.publicar(tx, {
        tipo: 'macroscopia.concluida',
        casoId: registro.casoId,
        moduloOrigem: MODULOS.M08_MACROSCOPIA,
        objetoTipo: 'amostra',
        objetoId: registro.amostraId,
        payload: { totalCassetes: cassetes.length },
      });

      await this.fluxo.processarEvento(tx, registro.casoId, 'macroscopia.concluida');
    });
  }

  /**
   * Ficha da amostra, ou `null` se a macroscopia ainda nao foi iniciada.
   *
   * Precisa ser um GET separado do `iniciar`: abrir a tela nao pode publicar
   * `macroscopia.iniciada` nem mover o fluxo. Quem inicia e o profissional,
   * quando pega a peca - nao o navegador ao carregar a pagina.
   */
  async buscarPorAmostra(amostraId: string) {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const [ficha] = await tx
        .select()
        .from(macroscopia)
        .where(
          and(eq(macroscopia.tenantId, ctx.tenantId), eq(macroscopia.amostraId, amostraId)),
        )
        .limit(1);

      if (!ficha) return null;

      const [lesoes, margens, cassetes] = await Promise.all([
        tx
          .select()
          .from(lesaoMacroscopica)
          .where(eq(lesaoMacroscopica.macroscopiaId, ficha.id))
          .orderBy(asc(lesaoMacroscopica.rotulo)),
        tx
          .select()
          .from(margemMacroscopica)
          .where(eq(margemMacroscopica.macroscopiaId, ficha.id))
          .orderBy(asc(margemMacroscopica.nome)),
        tx
          .select()
          .from(cassete)
          .where(eq(cassete.macroscopiaId, ficha.id))
          .orderBy(asc(cassete.ordem)),
      ]);

      return {
        id: ficha.id,
        casoId: ficha.casoId,
        amostraId: ficha.amostraId,
        descricaoTexto: ficha.descricaoTexto,
        comprimentoCm: ficha.comprimentoCm,
        larguraCm: ficha.larguraCm,
        alturaCm: ficha.alturaCm,
        pesoG: ficha.pesoG,
        materialTotalmenteIncluido: ficha.materialTotalmenteIncluido,
        iniciadaEm: ficha.iniciadaEm,
        concluidaEm: ficha.concluidaEm,
        lesoes: lesoes.map((l) => ({
          rotulo: l.rotulo,
          tipo: l.tipo,
          localizacao: l.localizacao,
          lateralidade: l.lateralidade,
          maiorEixoCm: l.maiorEixoCm,
          menorEixoCm: l.menorEixoCm,
        })),
        margens: margens.map((m) => ({
          nome: m.nome,
          metodoAmostragem: m.metodoAmostragem,
          distanciaCm: m.distanciaCm,
          naoAvaliavel: m.naoAvaliavel,
        })),
        cassetes: cassetes.map((c) => ({
          id: c.id,
          identificador: c.identificador,
          tecidoOrigem: c.tecidoOrigem,
          descricao: c.descricao,
          exigeDescalcificacao: c.exigeDescalcificacao,
        })),
      };
    });
  }

  /**
   * Cassetes do caso.
   *
   * O tecnico precisa desta lista para montar o lote de envio ao laboratorio de
   * apoio (M09), e o laboratorio precisa dela para conferir o recebimento.
   */
  async listarCassetes(casoId: string) {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) =>
      tx
        .select({
          id: cassete.id,
          identificador: cassete.identificador,
          amostraId: cassete.amostraId,
          tecidoOrigem: cassete.tecidoOrigem,
          exigeDescalcificacao: cassete.exigeDescalcificacao,
          statusTecnico: cassete.statusTecnico,
        })
        .from(cassete)
        .where(and(eq(cassete.tenantId, ctx.tenantId), eq(cassete.casoId, casoId)))
        .orderBy(asc(cassete.ordem)),
    );
  }

  // --- internos ------------------------------------------------------------

  private async gerarCassetes(
    tx: Transacao,
    registro: { id: string; casoId: string; amostraId: string },
    novos: NonNullable<DadosMacroscopia['cassetes']>,
  ): Promise<void> {
    const ctx = exigirContexto();

    const [alvo] = await tx
      .select({ letra: amostra.letra })
      .from(amostra)
      .where(eq(amostra.id, registro.amostraId))
      .limit(1);

    const [dadosCaso] = await tx
      .select({ identificador: caso.identificador })
      .from(caso)
      .where(eq(caso.id, registro.casoId))
      .limit(1);

    const existentes = await tx
      .select({ id: cassete.id })
      .from(cassete)
      .where(and(eq(cassete.tenantId, ctx.tenantId), eq(cassete.macroscopiaId, registro.id)));

    let ordem = existentes.length;

    for (const c of novos) {
      // M08: "cada cassete deve ter tecido de origem identificado". Recusar
      // aqui evita produzir material irrastreavel no processamento.
      if (!c.tecidoOrigem?.trim()) {
        throw new BadRequestException('Cassete sem tecido de origem não pode ser criado.');
      }

      ordem++;
      await tx.insert(cassete).values({
        tenantId: ctx.tenantId,
        casoId: registro.casoId,
        amostraId: registro.amostraId,
        macroscopiaId: registro.id,
        identificador: identificadorCassete(
          dadosCaso!.identificador,
          alvo!.letra,
          ordem,
        ),
        ordem,
        tecidoOrigem: c.tecidoOrigem,
        descricao: c.descricao ?? null,
        exigeDescalcificacao: c.exigeDescalcificacao ?? false,
      });
    }
  }

  private async buscarAmostra(tx: Transacao, amostraId: string) {
    const ctx = exigirContexto();
    const [alvo] = await tx
      .select()
      .from(amostra)
      .where(and(eq(amostra.tenantId, ctx.tenantId), eq(amostra.id, amostraId)))
      .limit(1);

    if (!alvo) throw new NotFoundException('Amostra não encontrada.');
    return alvo;
  }

  private async buscarMacroscopia(tx: Transacao, macroscopiaId: string) {
    const ctx = exigirContexto();
    const [registro] = await tx
      .select()
      .from(macroscopia)
      .where(and(eq(macroscopia.tenantId, ctx.tenantId), eq(macroscopia.id, macroscopiaId)))
      .limit(1);

    if (!registro) throw new NotFoundException('Macroscopia não encontrada.');
    return registro;
  }
}

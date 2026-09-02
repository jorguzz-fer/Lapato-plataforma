import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, getTableColumns, inArray } from 'drizzle-orm';
import {
  amostra,
  bloco,
  caso,
  cassete,
  cliente,
  estadoCaso,
  historicoClinico,
  lamina,
  paciente,
  perfil,
  recipiente,
  servico,
  tutor,
  usuario,
  usuarioPerfil,
  type Transacao,
  macroscopia,
} from '@lapato/db';
import {
  MODULOS,
  identificadorAmostra,
  identificadorRecipiente,
  type Lateralidade,
} from '@lapato/shared';
import { DbService } from '../../core/db/db.service.js';
import { EventosService } from '../../core/eventos/eventos.service.js';
import { AuditoriaService } from '../../core/auditoria/auditoria.service.js';
import { NumeracaoService } from '../m01-administracao/numeracao.service.js';
import { FluxoService } from '../m07-fluxo/fluxo.service.js';
import { OrdensService } from '../m20-ordens/ordens.service.js';
import { exigirContexto } from '../../core/contexto/contexto-requisicao.js';

export interface DadosNovoCaso {
  servicoId: string;
  clienteId: string;
  veterinarioId?: string;
  prioridade?: 'rotina' | 'prioritaria' | 'urgente' | 'critica';
  paciente: {
    id?: string;
    nome: string;
    especieId?: string;
    sexo?: string;
    microchip?: string;
    tutorNome?: string;
  };
  historicoClinico?: string;
  amostras: Array<{
    descricao?: string;
    orgaoId?: string;
    regiaoAnatomica?: string;
    lateralidade?: Lateralidade;
    tipoRelacao?: string;
  }>;
  recipientes: Array<{
    tipoId?: string;
    fixadorId?: string;
    identificacaoExterna?: string;
    quantidadeDeclarada?: number;
  }>;
}

/**
 * M05 - Recebimento e Cadastro de Amostras.
 *
 * Regra estruturante do modulo:
 *   Solicitado != Cadastrado != Recebido != Triado
 * Quatro momentos gravados separadamente; nenhum apaga o anterior.
 *
 * Outra regra que o codigo precisa respeitar: **um paciente por caso**. Uma
 * remessa com material de tres animais gera tres casos e uma remessa.
 */
@Injectable()
export class CasosService {
  constructor(
    private readonly db: DbService,
    private readonly eventos: EventosService,
    private readonly auditoria: AuditoriaService,
    private readonly numeracao: NumeracaoService,
    private readonly fluxo: FluxoService,
    private readonly ordens: OrdensService,
  ) {}

  async criar(dados: DadosNovoCaso): Promise<{ id: string; identificador: string }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const [servicoEscolhido] = await tx
        .select()
        .from(servico)
        .where(and(eq(servico.tenantId, ctx.tenantId), eq(servico.id, dados.servicoId)))
        .limit(1);

      if (!servicoEscolhido) throw new NotFoundException('Serviço não encontrado.');
      if (servicoEscolhido.inativadoEm) {
        // M01: item inativado nao aparece em novos registros, mas continua nos
        // casos historicos.
        throw new BadRequestException('Serviço inativado não aceita novos casos.');
      }

      const [clienteEscolhido] = await tx
        .select()
        .from(cliente)
        .where(and(eq(cliente.tenantId, ctx.tenantId), eq(cliente.id, dados.clienteId)))
        .limit(1);

      if (!clienteEscolhido) throw new NotFoundException('Cliente não encontrado.');

      const pacienteId = await this.resolverPaciente(tx, dados.paciente);

      const ano = new Date().getFullYear();
      const { identificador, sequencial } = await this.numeracao.proximoCaso(
        tx,
        clienteEscolhido.codigo,
        ano,
      );

      if (!ctx.unidadeId) {
        throw new BadRequestException(
          'A sessão não tem unidade ativa. Selecione a unidade antes de cadastrar.',
        );
      }

      const [novo] = await tx
        .insert(caso)
        .values({
          tenantId: ctx.tenantId,
          identificador,
          sequencial,
          ano,
          unidadeId: ctx.unidadeId,
          servicoId: dados.servicoId,
          clienteId: dados.clienteId,
          veterinarioId: dados.veterinarioId ?? null,
          pacienteId,
          prioridade: dados.prioridade ?? 'rotina',
          // Momento 2: cadastrado. Recebido e triado ficam nulos ate acontecerem.
          cadastradoEm: new Date(),
          cadastradoPorId: ctx.usuarioId,
        })
        .returning();

      if (dados.historicoClinico?.trim()) {
        // M05: o texto original do solicitante e preservado como veio.
        await tx.insert(historicoClinico).values({
          tenantId: ctx.tenantId,
          casoId: novo!.id,
          texto: dados.historicoClinico,
          origem: 'solicitante',
          registradoPorId: ctx.usuarioId,
        });
      }

      await this.criarRecipientesEAmostras(tx, novo!.id, identificador, dados);

      await this.fluxo.iniciarFluxo(tx, novo!.id);

      await this.eventos.publicar(tx, {
        tipo: 'caso.criado',
        casoId: novo!.id,
        moduloOrigem: MODULOS.M05_RECEBIMENTO,
        visibilidade: 'externo',
        payload: { identificador, servico: servicoEscolhido.nome },
      });

      await this.auditoria.registrar(tx, {
        entidade: 'caso',
        entidadeId: novo!.id,
        acao: 'criar',
        casoId: novo!.id,
        valorNovo: { identificador },
      });

      return { id: novo!.id, identificador };
    });
  }

  /**
   * Momento 3: recebimento fisico.
   *
   * M05: `quantidadeDeclarada` e `quantidadeRecebida` ficam em colunas
   * distintas, e a divergencia e destacada em vez de "corrigida". A divergencia
   * e um dado do caso, nao um erro a apagar.
   */
  async receberMaterial(
    casoId: string,
    conferencia: Array<{ recipienteId: string; quantidadeRecebida: number }>,
  ): Promise<{ divergencias: number }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const registro = await this.buscarCaso(tx, casoId);

      if (registro.recebidoEm) {
        throw new BadRequestException('Material deste caso já foi recebido.');
      }

      let divergencias = 0;

      for (const item of conferencia) {
        const [alvo] = await tx
          .select()
          .from(recipiente)
          .where(
            and(
              eq(recipiente.tenantId, ctx.tenantId),
              eq(recipiente.id, item.recipienteId),
              eq(recipiente.casoId, casoId),
            ),
          )
          .limit(1);

        if (!alvo) throw new NotFoundException(`Recipiente ${item.recipienteId} não encontrado.`);

        await tx
          .update(recipiente)
          .set({ quantidadeRecebida: item.quantidadeRecebida, recebidoEm: new Date() })
          .where(eq(recipiente.id, alvo.id));

        if (
          alvo.quantidadeDeclarada !== null &&
          alvo.quantidadeDeclarada !== item.quantidadeRecebida
        ) {
          divergencias++;
          await this.eventos.publicar(tx, {
            tipo: 'divergencia.identificada',
            casoId,
            moduloOrigem: MODULOS.M05_RECEBIMENTO,
            objetoTipo: 'recipiente',
            objetoId: alvo.id,
            payload: {
              recipiente: alvo.identificador,
              declarada: alvo.quantidadeDeclarada,
              recebida: item.quantidadeRecebida,
            },
          });
        }
      }

      await tx
        .update(caso)
        .set({ recebidoEm: new Date(), recebidoPorId: ctx.usuarioId })
        .where(eq(caso.id, casoId));

      await this.eventos.publicar(tx, {
        tipo: 'material.recebido',
        casoId,
        moduloOrigem: MODULOS.M05_RECEBIMENTO,
        visibilidade: 'externo',
        payload: { divergencias },
      });

      // O M07 decide a transicao; o M05 apenas informa que o fato aconteceu.
      await this.fluxo.processarEvento(tx, casoId, 'material.recebido');

      /**
       * Review com o laboratorio: "a OS e criada a partir do momento que
       * chegou a amostra e alguem conferiu". Na MESMA transacao: material
       * conferido sem ordem de cobranca e vazamento de receita.
       */
      await this.ordens.criarParaCaso(tx, casoId);

      return { divergencias };
    });
  }

  /** Dossie do caso (DIRETRIZES secao 14: um so dossie, venha de onde vier). */
  async buscarDossie(casoId: string) {
    return this.db.executar(async (tx) => {
      const ctx = exigirContexto();

      const [registro] = await tx
        .select({
          caso,
          cliente,
          paciente,
          servico,
          estado: estadoCaso,
        })
        .from(caso)
        .innerJoin(cliente, eq(cliente.id, caso.clienteId))
        .innerJoin(paciente, eq(paciente.id, caso.pacienteId))
        .innerJoin(servico, eq(servico.id, caso.servicoId))
        .leftJoin(estadoCaso, eq(estadoCaso.casoId, caso.id))
        .where(and(eq(caso.tenantId, ctx.tenantId), eq(caso.id, casoId)))
        .limit(1);

      if (!registro) throw new NotFoundException('Caso não encontrado.');

      // Para quem foi a lamina (segunda review): o responsavel do laudo, quando ja escolhido.
      const [patologistaResponsavel] = registro.caso.patologistaResponsavelId
        ? await tx
            .select({ id: usuario.id, nome: usuario.nomeCompleto })
            .from(usuario)
            .where(
              and(
                eq(usuario.tenantId, ctx.tenantId),
                eq(usuario.id, registro.caso.patologistaResponsavelId),
              ),
            )
            .limit(1)
        : [];

      // Com o estado da macroscopia: e o que decide se a amostra aceita recorte.
      const amostras = await tx
        .select({ ...getTableColumns(amostra), macroscopiaConcluidaEm: macroscopia.concluidaEm })
        .from(amostra)
        .leftJoin(macroscopia, eq(macroscopia.amostraId, amostra.id))
        .where(and(eq(amostra.tenantId, ctx.tenantId), eq(amostra.casoId, casoId)));

      const recipientes = await tx
        .select()
        .from(recipiente)
        .where(and(eq(recipiente.tenantId, ctx.tenantId), eq(recipiente.casoId, casoId)));

      const historicos = await tx
        .select()
        .from(historicoClinico)
        .where(
          and(eq(historicoClinico.tenantId, ctx.tenantId), eq(historicoClinico.casoId, casoId)),
        );

      const linhaDoTempo = await this.eventos.linhaDoTempo(tx, casoId);

      return {
        ...registro,
        patologistaResponsavel: patologistaResponsavel ?? null,
        amostras,
        recipientes,
        historicos,
        linhaDoTempo,
      };
    });
  }

  /**
   * Para qual patologista vai a lamina (segunda review).
   *
   * "Depois da macroscopia a lamina sai para alguem laudar; a gente precisa
   * rastrear para quem foi enviada." O destino e um usuario com perfil de
   * patologista - cadastro paralelo de "laudador" nao existe (M02): sao os
   * mesmos usuarios, com acesso restrito ao que o perfil da.
   *
   * Grava no caso (M11: `patologistaResponsavelId`) e no estado do fluxo
   * (`responsavelId`, que e o que a fila "meus casos" do M07 le). Hugo:
   * "as vezes um patologista passa um caso pro outro" - reatribuir e normal e
   * fica na linha do tempo.
   */
  async atribuirPatologista(casoId: string, usuarioId: string): Promise<void> {
    const ctx = exigirContexto();

    await this.db.executar(async (tx) => {
      const [alvo] = await tx
        .select({ id: caso.id, atual: caso.patologistaResponsavelId })
        .from(caso)
        .where(and(eq(caso.tenantId, ctx.tenantId), eq(caso.id, casoId)))
        .limit(1);
      if (!alvo) throw new NotFoundException('Caso não encontrado.');

      const [destino] = await tx
        .select({ id: usuario.id, nome: usuario.nomeCompleto, status: usuario.status })
        .from(usuario)
        .innerJoin(usuarioPerfil, eq(usuarioPerfil.usuarioId, usuario.id))
        .innerJoin(perfil, eq(perfil.id, usuarioPerfil.perfilId))
        .where(
          and(
            eq(usuario.tenantId, ctx.tenantId),
            eq(usuario.id, usuarioId),
            inArray(perfil.chave, ['patologista', 'patologista_revisor']),
          ),
        )
        .limit(1);
      if (!destino) {
        throw new BadRequestException(
          'Só usuário com perfil de patologista pode receber a lâmina para laudar.',
        );
      }
      if (destino.status !== 'ativo') {
        throw new BadRequestException(`${destino.nome} não está ativo(a) no sistema.`);
      }

      const agora = new Date();
      await tx
        .update(caso)
        .set({ patologistaResponsavelId: usuarioId, atualizadoEm: agora })
        .where(eq(caso.id, casoId));
      await tx
        .update(estadoCaso)
        .set({ responsavelId: usuarioId, atualizadoEm: agora })
        .where(and(eq(estadoCaso.tenantId, ctx.tenantId), eq(estadoCaso.casoId, casoId)));

      await this.eventos.publicar(tx, {
        tipo: 'caso.patologista_atribuido',
        casoId,
        moduloOrigem: MODULOS.M05_RECEBIMENTO,
        objetoTipo: 'usuario',
        objetoId: usuarioId,
        payload: { patologista: destino.nome, anterior: alvo.atual, reatribuicao: alvo.atual != null },
      });
    });
  }

  /**
   * Bipagem (Hugo): "abre o login daquele patologista e vai so bipando as
   * laminas dele - pa, pa, pa - nao precisa escrever nada". O codigo de barras
   * da etiqueta carrega o identificador do cassete; a lamina herda o do bloco,
   * que herda o do cassete, que carrega o do caso. Qualquer um deles resolve o
   * caso, e o caso passa a ser de quem bipou.
   */
  async biparParaMim(codigo: string): Promise<{ casoId: string; identificador: string }> {
    const ctx = exigirContexto();
    const limpo = codigo.trim().toUpperCase();
    if (!limpo) throw new BadRequestException('Bipe ou digite o código da lâmina.');

    const casoId = await this.db.executar(async (tx) => {
      const [direto] = await tx
        .select({ id: caso.id })
        .from(caso)
        .where(and(eq(caso.tenantId, ctx.tenantId), eq(caso.identificador, limpo)))
        .limit(1);
      if (direto) return direto.id;

      const [porCassete] = await tx
        .select({ casoId: cassete.casoId })
        .from(cassete)
        .where(and(eq(cassete.tenantId, ctx.tenantId), eq(cassete.identificador, limpo)))
        .limit(1);
      if (porCassete) return porCassete.casoId;

      const [porBloco] = await tx
        .select({ casoId: bloco.casoId })
        .from(bloco)
        .where(and(eq(bloco.tenantId, ctx.tenantId), eq(bloco.identificador, limpo)))
        .limit(1);
      if (porBloco) return porBloco.casoId;

      const [porLamina] = await tx
        .select({ casoId: lamina.casoId })
        .from(lamina)
        .where(and(eq(lamina.tenantId, ctx.tenantId), eq(lamina.identificador, limpo)))
        .limit(1);
      if (porLamina) return porLamina.casoId;

      throw new NotFoundException(`Nenhum caso, cassete, bloco ou lâmina com o código "${limpo}".`);
    });

    await this.atribuirPatologista(casoId, ctx.usuarioId);

    const [registro] = await this.db.executar((tx) =>
      tx
        .select({ identificador: caso.identificador })
        .from(caso)
        .where(and(eq(caso.tenantId, ctx.tenantId), eq(caso.id, casoId)))
        .limit(1),
    );
    return { casoId, identificador: registro!.identificador };
  }

  // --- internos ------------------------------------------------------------

  private async buscarCaso(tx: Transacao, casoId: string) {
    const ctx = exigirContexto();
    const [registro] = await tx
      .select()
      .from(caso)
      .where(and(eq(caso.tenantId, ctx.tenantId), eq(caso.id, casoId)))
      .limit(1);

    if (!registro) throw new NotFoundException('Caso não encontrado.');
    return registro;
  }

  /**
   * M05: o paciente e entidade longitudinal. Reaproveitar o registro existente
   * e o que permite a Memoria do Paciente (M17) reunir exames anteriores do
   * mesmo animal - por isso o cadastro aceita um `id` ja conhecido.
   */
  private async resolverPaciente(
    tx: Transacao,
    dados: DadosNovoCaso['paciente'],
  ): Promise<string> {
    const ctx = exigirContexto();

    if (dados.id) {
      const [existente] = await tx
        .select({ id: paciente.id })
        .from(paciente)
        .where(and(eq(paciente.tenantId, ctx.tenantId), eq(paciente.id, dados.id)))
        .limit(1);

      if (!existente) throw new NotFoundException('Paciente não encontrado.');
      return existente.id;
    }

    let tutorId: string | null = null;
    if (dados.tutorNome?.trim()) {
      const [novoTutor] = await tx
        .insert(tutor)
        .values({ tenantId: ctx.tenantId, nome: dados.tutorNome.trim() })
        .returning({ id: tutor.id });
      tutorId = novoTutor!.id;
    }

    const [novo] = await tx
      .insert(paciente)
      .values({
        tenantId: ctx.tenantId,
        nome: dados.nome,
        especieId: dados.especieId ?? null,
        sexo: dados.sexo ?? null,
        microchip: dados.microchip ?? null,
        tutorId,
      })
      .returning({ id: paciente.id });

    return novo!.id;
  }

  private async criarRecipientesEAmostras(
    tx: Transacao,
    casoId: string,
    identificadorCaso: string,
    dados: DadosNovoCaso,
  ): Promise<void> {
    const ctx = exigirContexto();

    const recipientesCriados = [];
    for (const [i, r] of dados.recipientes.entries()) {
      const [novo] = await tx
        .insert(recipiente)
        .values({
          tenantId: ctx.tenantId,
          casoId,
          identificador: identificadorRecipiente(identificadorCaso, i + 1),
          ordem: i + 1,
          tipoId: r.tipoId ?? null,
          fixadorId: r.fixadorId ?? null,
          identificacaoExterna: r.identificacaoExterna ?? null,
          quantidadeDeclarada: r.quantidadeDeclarada ?? 1,
        })
        .returning({ id: recipiente.id });
      recipientesCriados.push(novo!.id);
    }

    for (const [i, a] of dados.amostras.entries()) {
      await tx.insert(amostra).values({
        tenantId: ctx.tenantId,
        casoId,
        // Sem recipiente correspondente, a amostra fica sem vinculo em vez de
        // ser associada ao errado.
        recipienteId: recipientesCriados[i] ?? recipientesCriados[0] ?? null,
        identificador: identificadorAmostra(identificadorCaso, i + 1),
        ordem: i + 1,
        // Letra usada depois na identificacao dos cassetes (M08): A, B, C...
        letra: String.fromCharCode(65 + i),
        descricao: a.descricao ?? null,
        orgaoId: a.orgaoId ?? null,
        regiaoAnatomica: a.regiaoAnatomica ?? null,
        lateralidade: a.lateralidade ?? 'nao_aplicavel',
        tipoRelacao: a.tipoRelacao ?? null,
      });
    }
  }
}

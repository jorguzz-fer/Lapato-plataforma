import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { aliasedTable, and, desc, eq, getTableColumns, ilike, inArray, or, sql } from 'drizzle-orm';
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
  termo,
  tutor,
  usuario,
  usuarioPerfil,
  type Transacao,
  macroscopia,
  naoConformidadePreAnalitica,
} from '@lapato/db';
import {
  MODULOS,
  identificadorAmostra,
  identificadorRecipiente,
  type Lateralidade,
  type ModalidadeCobranca,
} from '@lapato/shared';
import { DbService } from '../../core/db/db.service.js';
import { EventosService } from '../../core/eventos/eventos.service.js';
import { AuditoriaService } from '../../core/auditoria/auditoria.service.js';
import { NumeracaoService } from '../m01-administracao/numeracao.service.js';
import { FluxoService } from '../m07-fluxo/fluxo.service.js';
import { OrdensService } from '../m20-ordens/ordens.service.js';
import { exigirContexto } from '../../core/contexto/contexto-requisicao.js';

export interface DadosPaciente {
  nome: string;
  especieId?: string;
  raca?: string;
  sexo?: string;
  dataNascimento?: string;
  idadeInformada?: string;
  microchip?: string;
  /** Responsavel pelo animal ("Tutor" virou "Responsavel" na tela - documento do Hugo). */
  tutorNome?: string;
  tutorTelefone?: string;
  tutorEmail?: string;
}

export interface DadosNovoCaso {
  servicoId: string;
  /**
   * Convenio: o cliente parceiro (obrigatorio). Particular: omitido - o caso
   * vai para o pseudo-cliente "Particular" da instituicao e quem paga e o
   * responsavel do paciente.
   */
  modalidade?: ModalidadeCobranca;
  clienteId?: string;
  veterinarioId?: string;
  /** Particular: clinica de origem e veterinario como texto, sem cadastro. */
  clinicaOrigem?: string;
  veterinarioInformado?: string;
  /** Data de entrada do material; omitida = agora. */
  entradaEm?: Date;
  prioridade?: 'rotina' | 'prioritaria' | 'urgente' | 'critica';
  paciente: DadosPaciente & { id?: string };
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

      const modalidade: ModalidadeCobranca = dados.modalidade ?? 'convenio';

      /**
       * Particular (documento do Hugo): o responsavel traz a amostra, paga na
       * entrada e recebe o laudo. Nao ha parceria, logo nao ha cliente a
       * escolher - o caso vai para o pseudo-cliente "Particular" da
       * instituicao, e a sigla dele (PT) identifica esses exames a olho nu.
       */
      const clienteId =
        modalidade === 'particular'
          ? await this.obterClienteParticular(tx)
          : dados.clienteId;
      if (!clienteId) {
        throw new BadRequestException('Informe o cliente do convênio.');
      }
      if (modalidade === 'particular') {
        const contato = dados.paciente.tutorTelefone?.trim() || dados.paciente.tutorEmail?.trim();
        if (!dados.paciente.id && (!dados.paciente.tutorNome?.trim() || !contato)) {
          throw new BadRequestException(
            'Exame particular precisa do responsável com telefone ou e-mail — é dele que se cobra e para ele que vai o laudo.',
          );
        }
      }

      const [clienteEscolhido] = await tx
        .select()
        .from(cliente)
        .where(and(eq(cliente.tenantId, ctx.tenantId), eq(cliente.id, clienteId)))
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
          clienteId,
          modalidade,
          veterinarioId: modalidade === 'convenio' ? (dados.veterinarioId ?? null) : null,
          clinicaOrigem: modalidade === 'particular' ? dados.clinicaOrigem?.trim() || null : null,
          veterinarioInformado:
            modalidade === 'particular' ? dados.veterinarioInformado?.trim() || null : null,
          pacienteId,
          prioridade: dados.prioridade ?? 'rotina',
          // Entrada: quando o material chegou (pode ser antes de agora - volume grande).
          entradaEm: dados.entradaEm ?? new Date(),
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
    conferencia: Array<{
      recipienteId: string;
      quantidadeRecebida: number;
      /** Documento do Hugo: fragmentos por pote (numero) ou "multiplos". */
      fragmentosRecebidos?: number | null;
      fragmentosMultiplos?: boolean;
      ressalva?: string | null;
      ressalvaDetalhe?: string | null;
    }>,
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
          .set({
            quantidadeRecebida: item.quantidadeRecebida,
            fragmentosRecebidos: item.fragmentosMultiplos ? null : (item.fragmentosRecebidos ?? null),
            fragmentosMultiplos: item.fragmentosMultiplos ?? false,
            ressalva: item.ressalva || null,
            ressalvaDetalhe: item.ressalvaDetalhe?.trim() || null,
            recebidoEm: new Date(),
          })
          .where(eq(recipiente.id, alvo.id));

        // A ressalva do pote fica na linha do tempo: e o que a macro e o
        // laudo precisam ver antes de abrir o material.
        if (item.ressalva) {
          await this.eventos.publicar(tx, {
            tipo: 'ressalva.recebimento',
            casoId,
            moduloOrigem: MODULOS.M05_RECEBIMENTO,
            objetoTipo: 'recipiente',
            objetoId: alvo.id,
            payload: {
              recipiente: alvo.identificador,
              ressalva: item.ressalva,
              detalhe: item.ressalvaDetalhe?.trim() || null,
            },
          });
        }

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

      /**
       * Review: "esta faltando a descricao exata do que foi DECLARADO" - quem
       * confere precisa bater o que o cliente disse que mandou com o que
       * chegou. Tipo de recipiente e fixador vem pelo nome, nao pelo id.
       */
      const tipoRecipiente = aliasedTable(termo, 'tipo_recipiente');
      const fixador = aliasedTable(termo, 'fixador');
      const recipientes = await tx
        .select({
          ...getTableColumns(recipiente),
          tipo: tipoRecipiente.valor,
          fixador: fixador.valor,
        })
        .from(recipiente)
        .leftJoin(tipoRecipiente, eq(tipoRecipiente.id, recipiente.tipoId))
        .leftJoin(fixador, eq(fixador.id, recipiente.fixadorId))
        .where(and(eq(recipiente.tenantId, ctx.tenantId), eq(recipiente.casoId, casoId)))
        .orderBy(recipiente.ordem);

      const historicos = await tx
        .select()
        .from(historicoClinico)
        .where(
          and(eq(historicoClinico.tenantId, ctx.tenantId), eq(historicoClinico.casoId, casoId)),
        );

      const linhaDoTempo = await this.eventos.linhaDoTempo(tx, casoId);

      // Documento do Hugo: ressalvas e nao conformidades no cabecalho da macro e
      // do laudo, para conferir antes de abrir o pote.
      const naoConformidades = await tx
        .select({
          id: naoConformidadePreAnalitica.id,
          tipo: naoConformidadePreAnalitica.tipo,
          gravidade: naoConformidadePreAnalitica.gravidade,
          descricao: naoConformidadePreAnalitica.descricao,
          amostraId: naoConformidadePreAnalitica.amostraId,
        })
        .from(naoConformidadePreAnalitica)
        .where(
          and(
            eq(naoConformidadePreAnalitica.tenantId, ctx.tenantId),
            eq(naoConformidadePreAnalitica.casoId, casoId),
          ),
        );

      // Responsavel pelo animal: no particular e quem paga e recebe o laudo.
      const [responsavel] = registro.paciente.tutorId
        ? await tx
            .select({ id: tutor.id, nome: tutor.nome, telefone: tutor.telefone, email: tutor.email })
            .from(tutor)
            .where(and(eq(tutor.tenantId, ctx.tenantId), eq(tutor.id, registro.paciente.tutorId)))
            .limit(1)
        : [];

      return {
        ...registro,
        naoConformidades,
        responsavel: responsavel ?? null,
        patologistaResponsavel: patologistaResponsavel ?? null,
        amostras,
        recipientes,
        historicos,
        linhaDoTempo,
      };
    });
  }

  /**
   * Corrige a data de entrada do material (segunda review, Hugo).
   *
   * Nao e edicao livre de historico: o prazo do laudo e recontado a partir
   * da nova data pelo M07, a alteracao fica na auditoria e vira evento na
   * linha do tempo. Quem cadastrou ontem o que chegou anteontem conserta
   * aqui, e o caso deixa de nascer atrasado.
   */
  async alterarEntrada(casoId: string, entradaEm: Date): Promise<void> {
    const ctx = exigirContexto();

    await this.db.executar(async (tx) => {
      const [atual] = await tx
        .select({ id: caso.id, entradaEm: caso.entradaEm, cadastradoEm: caso.cadastradoEm })
        .from(caso)
        .where(and(eq(caso.tenantId, ctx.tenantId), eq(caso.id, casoId)))
        .limit(1);
      if (!atual) throw new NotFoundException('Caso não encontrado.');
      if (atual.entradaEm.getTime() === entradaEm.getTime()) return;

      await tx
        .update(caso)
        .set({ entradaEm, atualizadoEm: new Date() })
        .where(eq(caso.id, casoId));

      await this.auditoria.registrarAlteracao(
        tx,
        'caso',
        casoId,
        { entradaEm: atual.entradaEm.toISOString() },
        { entradaEm: entradaEm.toISOString() },
      );

      await this.eventos.publicar(tx, {
        tipo: 'caso.entrada_alterada',
        casoId,
        moduloOrigem: MODULOS.M05_RECEBIMENTO,
        payload: { de: atual.entradaEm.toISOString(), para: entradaEm.toISOString() },
      });

      // O prazo conta da entrada: o M07 reconta a partir da nova data.
      await this.fluxo.reiniciarPrazo(tx, casoId, entradaEm);
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
  /**
   * Resolve um codigo bipado (caso, recipiente, cassete, bloco ou lamina) ao
   * caso, SEM atribuir nada - e o que a fila de macroscopia usa para abrir a
   * ficha do pote que esta na bancada (documento do Hugo).
   */
  async resolverCodigo(codigo: string): Promise<{ casoId: string; identificador: string }> {
    const ctx = exigirContexto();
    const limpo = codigo.trim().toUpperCase();
    if (!limpo) throw new BadRequestException('Bipe ou digite o código da etiqueta.');

    return this.db.executar(async (tx) => {
      const casoId = await this.casoDoCodigo(tx, limpo);
      const [registro] = await tx
        .select({ identificador: caso.identificador })
        .from(caso)
        .where(and(eq(caso.tenantId, ctx.tenantId), eq(caso.id, casoId)))
        .limit(1);
      return { casoId, identificador: registro!.identificador };
    });
  }

  private async casoDoCodigo(tx: Transacao, limpo: string): Promise<string> {
    const ctx = exigirContexto();

    const [direto] = await tx
      .select({ id: caso.id })
      .from(caso)
      .where(and(eq(caso.tenantId, ctx.tenantId), eq(caso.identificador, limpo)))
      .limit(1);
    if (direto) return direto.id;

    // Etiqueta do pote (documento do Hugo): `CV-000342/26-F01`.
    const [porRecipiente] = await tx
      .select({ casoId: recipiente.casoId })
      .from(recipiente)
      .where(and(eq(recipiente.tenantId, ctx.tenantId), eq(recipiente.identificador, limpo)))
      .limit(1);
    if (porRecipiente) return porRecipiente.casoId;

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

    throw new NotFoundException(
      `Nenhum caso, recipiente, cassete, bloco ou lâmina com o código "${limpo}".`,
    );
  }

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
      return this.casoDoCodigo(tx, limpo);
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
        .values({
          tenantId: ctx.tenantId,
          nome: dados.tutorNome.trim(),
          telefone: dados.tutorTelefone?.trim() || null,
          email: dados.tutorEmail?.trim().toLowerCase() || null,
        })
        .returning({ id: tutor.id });
      tutorId = novoTutor!.id;
    }

    const [novo] = await tx
      .insert(paciente)
      .values({
        tenantId: ctx.tenantId,
        nome: dados.nome,
        especieId: dados.especieId ?? null,
        raca: dados.raca?.trim() || null,
        sexo: dados.sexo ?? null,
        dataNascimento: dados.dataNascimento || null,
        idadeInformada: dados.idadeInformada?.trim() || null,
        microchip: dados.microchip ?? null,
        tutorId,
      })
      .returning({ id: paciente.id });

    return novo!.id;
  }

  /**
   * O pseudo-cliente "Particular" da instituicao - criado na primeira vez que
   * um exame particular entra. Um por instituicao, tipo `tutor_particular`,
   * sigla PT: e o que faz `PT-000012/26` ser reconhecivel como particular
   * sem abrir o caso.
   */
  private async obterClienteParticular(tx: Transacao): Promise<string> {
    const ctx = exigirContexto();

    const [existente] = await tx
      .select({ id: cliente.id })
      .from(cliente)
      .where(and(eq(cliente.tenantId, ctx.tenantId), eq(cliente.tipo, 'tutor_particular')))
      .orderBy(cliente.criadoEm)
      .limit(1);
    if (existente) return existente.id;

    const [comSiglaPt] = await tx
      .select({ id: cliente.id })
      .from(cliente)
      .where(and(eq(cliente.tenantId, ctx.tenantId), eq(cliente.codigo, 'PT')))
      .limit(1);

    const [novo] = await tx
      .insert(cliente)
      .values({
        tenantId: ctx.tenantId,
        nomeFantasia: 'Particular',
        tipo: 'tutor_particular',
        codigo: comSiglaPt ? 'PART' : 'PT',
        observacoes:
          'Exames trazidos pelo responsável, sem parceria. Cobrados na entrada, do próprio responsável.',
      })
      .returning({ id: cliente.id });

    await this.auditoria.registrar(tx, {
      entidade: 'cliente',
      entidadeId: novo!.id,
      acao: 'criar',
      valorNovo: { nomeFantasia: 'Particular', tipo: 'tutor_particular' },
      justificativa: 'Pseudo-cliente criado automaticamente no primeiro exame particular.',
    });

    return novo!.id;
  }

  /**
   * Busca do paciente ja atendido (documento do Hugo): "BOB, da MARIA
   * OLIVEIRA, fez uma citologia dia 10; dia 1 chegou um histopatologico dele -
   * precisamos reinserir tudo". A busca e por nome do animal OU do responsavel,
   * e devolve o ultimo exame para a recepcao confirmar que e o mesmo bicho
   * antes de "so inserir o exame".
   */
  async buscarPacientes(texto: string) {
    const q = texto.trim();
    if (q.length < 2) return [];

    return this.db.executar(async (tx) => {
      const ctx = exigirContexto();
      const padrao = `%${q}%`;

      const especie = aliasedTable(termo, 'especie');
      const linhas = await tx
        .select({
          id: paciente.id,
          nome: paciente.nome,
          especie: especie.valor,
          raca: paciente.raca,
          sexo: paciente.sexo,
          dataNascimento: paciente.dataNascimento,
          idadeInformada: paciente.idadeInformada,
          microchip: paciente.microchip,
          tutorNome: tutor.nome,
          tutorTelefone: tutor.telefone,
          tutorEmail: tutor.email,
          // Ultimo exame: literal para nao cair na armadilha da subconsulta.
          ultimoCaso: sql<string | null>`(
            select c.identificador from caso c
            where c.paciente_id = paciente.id order by c.entrada_em desc limit 1
          )`,
          ultimaEntrada: sql<string | null>`(
            select c.entrada_em from caso c
            where c.paciente_id = paciente.id order by c.entrada_em desc limit 1
          )`,
          totalCasos: sql<number>`(select count(*)::int from caso c where c.paciente_id = paciente.id)`,
        })
        .from(paciente)
        .leftJoin(tutor, eq(tutor.id, paciente.tutorId))
        .leftJoin(especie, eq(especie.id, paciente.especieId))
        .where(
          and(
            eq(paciente.tenantId, ctx.tenantId),
            or(ilike(paciente.nome, padrao), ilike(tutor.nome, padrao), ilike(paciente.microchip, padrao)),
          ),
        )
        .orderBy(desc(paciente.atualizadoEm))
        .limit(20);

      return linhas;
    });
  }

  /**
   * Edicao da identificacao do animal depois do cadastro (documento do Hugo:
   * "quem inseriu pode errar ou nao entender a informacao - e bem comum").
   * Fica auditado campo a campo; o Guardian continua comparando identidade
   * antes da assinatura, entao uma correcao aqui e o caminho certo, nao um
   * desvio.
   */
  async editarPaciente(pacienteId: string, dados: Partial<DadosPaciente>): Promise<void> {
    const ctx = exigirContexto();

    await this.db.executar(async (tx) => {
      const [atual] = await tx
        .select()
        .from(paciente)
        .where(and(eq(paciente.tenantId, ctx.tenantId), eq(paciente.id, pacienteId)))
        .limit(1);
      if (!atual) throw new NotFoundException('Paciente não encontrado.');

      const mudancas: Record<string, unknown> = {};
      if (dados.nome !== undefined && dados.nome.trim()) mudancas.nome = dados.nome.trim();
      if (dados.especieId !== undefined) mudancas.especieId = dados.especieId || null;
      if (dados.raca !== undefined) mudancas.raca = dados.raca.trim() || null;
      if (dados.sexo !== undefined) mudancas.sexo = dados.sexo || null;
      if (dados.dataNascimento !== undefined) mudancas.dataNascimento = dados.dataNascimento || null;
      if (dados.idadeInformada !== undefined)
        mudancas.idadeInformada = dados.idadeInformada.trim() || null;
      if (dados.microchip !== undefined) mudancas.microchip = dados.microchip.trim() || null;

      const anteriorPaciente = {
        nome: atual.nome,
        especieId: atual.especieId,
        raca: atual.raca,
        sexo: atual.sexo,
        dataNascimento: atual.dataNascimento,
        idadeInformada: atual.idadeInformada,
        microchip: atual.microchip,
      };

      if (Object.keys(mudancas).length > 0) {
        await tx
          .update(paciente)
          .set({ ...mudancas, atualizadoEm: new Date() })
          .where(eq(paciente.id, pacienteId));
        await this.auditoria.registrarAlteracao(tx, 'paciente', pacienteId, anteriorPaciente, mudancas);
      }

      // Responsavel: cria se nao havia, atualiza se havia.
      const mexeuNoTutor =
        dados.tutorNome !== undefined ||
        dados.tutorTelefone !== undefined ||
        dados.tutorEmail !== undefined;
      if (!mexeuNoTutor) return;

      if (atual.tutorId) {
        const [tutorAtual] = await tx
          .select()
          .from(tutor)
          .where(and(eq(tutor.tenantId, ctx.tenantId), eq(tutor.id, atual.tutorId)))
          .limit(1);
        const mudancasTutor: Record<string, unknown> = {};
        if (dados.tutorNome !== undefined && dados.tutorNome.trim())
          mudancasTutor.nome = dados.tutorNome.trim();
        if (dados.tutorTelefone !== undefined)
          mudancasTutor.telefone = dados.tutorTelefone.trim() || null;
        if (dados.tutorEmail !== undefined)
          mudancasTutor.email = dados.tutorEmail.trim().toLowerCase() || null;
        if (Object.keys(mudancasTutor).length === 0) return;
        await tx
          .update(tutor)
          .set({ ...mudancasTutor, atualizadoEm: new Date() })
          .where(eq(tutor.id, atual.tutorId));
        await this.auditoria.registrarAlteracao(
          tx,
          'tutor',
          atual.tutorId,
          { nome: tutorAtual?.nome, telefone: tutorAtual?.telefone, email: tutorAtual?.email },
          mudancasTutor,
        );
      } else if (dados.tutorNome?.trim()) {
        const [novoTutor] = await tx
          .insert(tutor)
          .values({
            tenantId: ctx.tenantId,
            nome: dados.tutorNome.trim(),
            telefone: dados.tutorTelefone?.trim() || null,
            email: dados.tutorEmail?.trim().toLowerCase() || null,
          })
          .returning({ id: tutor.id });
        await tx
          .update(paciente)
          .set({ tutorId: novoTutor!.id, atualizadoEm: new Date() })
          .where(eq(paciente.id, pacienteId));
        await this.auditoria.registrarAlteracao(tx, 'paciente', pacienteId, { tutorId: null }, {
          tutorId: novoTutor!.id,
        });
      }
    });
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

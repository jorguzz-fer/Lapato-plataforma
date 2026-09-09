import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  imagem,
  movimentacaoLogistica,
  ofertaServico,
  perfil,
  rotaLogistica,
  solicitacaoLogistica,
  usuario,
  usuarioPerfil,
  type Transacao,
} from '@lapato/db';
import {
  DISTANCIA_ALERTA_GEO_METROS,
  FOTOS_MAXIMAS_POR_MARCO,
  FOTOS_MINIMAS_POR_MARCO,
  MODULOS,
  OCORRENCIA_LOGISTICA_CRITICA,
  ORIGENS_DO_MARCO,
  PERFIS_PADRAO,
  PERMISSOES,
  STATUS_LOGISTICO_ABERTO,
  distanciaMetros,
  type CondicaoMaterialLogistica,
  type GeoMarco,
  type MarcoEvidenciaLogistica,
  type MotivoContatoSemSucesso,
  type MotivoGeoAusente,
  type MotivoNaoRealizacao,
  type PessoaNoLocal,
  type Recebedor,
  type StatusSolicitacaoLogistica,
  type TipoOcorrenciaLogistica,
} from '@lapato/shared';
import { DbService } from '../../core/db/db.service.js';
import { EventosService } from '../../core/eventos/eventos.service.js';
import { AuditoriaService } from '../../core/auditoria/auditoria.service.js';
import { GuardianService } from '../../core/guardian/guardian.service.js';
import { exigirContexto } from '../../core/contexto/contexto-requisicao.js';
import { ImagensService, type ArquivoRecebido } from '../m16-imagens/imagens.service.js';
import { FinanceiroService } from '../m20-ordens/financeiro.service.js';
import { LogisticaService } from './logistica.service.js';

/** O que o dispositivo mandou - ou por que nao mandou (secao 153). */
export interface EntradaGeo {
  latitude?: number | null;
  longitude?: number | null;
  precisaoMetros?: number | null;
  geoAusente?: MotivoGeoAusente | null;
}

const OBJETO = 'solicitacao_logistica';

/**
 * M19 - Logistica, fatia 2: a EXECUCAO do servico que ja tem dono.
 *
 * A primeira fatia parou no aceite. Esta cobre o que a secao 139 chama de
 * "executa o servico -> registra retirada/entrega com evidencias -> servico e
 * concluido e arquivado -> evento financeiro do encarregado e disponibilizado
 * ao Modulo 20".
 *
 * Tres regras estruturam o que esta aqui:
 *
 * - **Nenhum marco fisico sem evidencia** (secoes 151 e 153, regra 16 da
 *   secao 132). Material retirado e material entregue exigem foto e pedem a
 *   posicao do dispositivo - e a AUSENCIA da posicao e registrada com motivo,
 *   nunca inventada.
 * - **Divergencia e dado, nao correcao** (secoes 59 e 78). O que o cliente
 *   estimou, o que o encarregado contou e o que chegou ao laboratorio ficam em
 *   colunas separadas; quando diferem, a diferenca vira registro e alerta.
 * - **O encarregado nao avalia o material** (secao 62). Ele descreve o que ve
 *   na embalagem; adequacao e aceite tecnico continuam no M05.
 */
@Injectable()
export class LogisticaExecucaoService {
  constructor(
    private readonly db: DbService,
    private readonly eventos: EventosService,
    private readonly auditoria: AuditoriaService,
    private readonly imagens: ImagensService,
    private readonly financeiro: FinanceiroService,
    private readonly logistica: LogisticaService,
    private readonly guardian: GuardianService,
  ) {}

  /** Varredura da secao 111, para o painel da central. */
  async varreduraGuardian() {
    return this.db.executar((tx) => this.guardian.verificarLogistica(tx));
  }

  // --- quem pode executar ---------------------------------------------------

  /**
   * Secao 34 / 140: os encarregados sao usuarios do M02 com o perfil de campo.
   * A lista alimenta as caixas de marcacao da oferta e a criacao de rota.
   */
  async listarEncarregados(): Promise<Array<{ id: string; nome: string }>> {
    const ctx = exigirContexto();
    return this.db.executar((tx) =>
      tx
        .selectDistinct({ id: usuario.id, nome: usuario.nomeCompleto })
        .from(usuario)
        .innerJoin(usuarioPerfil, eq(usuarioPerfil.usuarioId, usuario.id))
        .innerJoin(perfil, eq(perfil.id, usuarioPerfil.perfilId))
        .where(
          and(
            eq(usuario.tenantId, ctx.tenantId),
            eq(usuario.status, 'ativo'),
            eq(perfil.chave, PERFIS_PADRAO.ENCARREGADO_LOGISTICO),
          ),
        )
        .orderBy(asc(usuario.nomeCompleto)),
    );
  }

  // --- atribuicao direta e reatribuicao (secoes 32 e 33) -------------------

  /**
   * Atribui sem passar pela oferta, ou troca quem esta com o servico.
   *
   * Secao 33: "preservar o historico da atribuicao anterior e registrar
   * motivo, usuario e horario". O responsavel anterior fica na linha do tempo
   * e na auditoria; a coluna passa a apontar para o novo.
   */
  async atribuir(
    solicitacaoId: string,
    encarregadoId: string,
    motivo?: string,
  ): Promise<{ identificador: string; anterior: string | null }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const atual = await this.buscar(tx, solicitacaoId);
      if (!STATUS_LOGISTICO_ABERTO.includes(atual.status)) {
        throw new BadRequestException('Solicitação encerrada não muda de responsável.');
      }
      if (atual.status === 'entregue') {
        throw new BadRequestException(
          'O material já foi entregue: conclua o serviço em vez de reatribuir.',
        );
      }
      if (atual.encarregadoId === encarregadoId) {
        throw new BadRequestException('Este encarregado já é o responsável.');
      }
      if (atual.encarregadoId && !motivo?.trim()) {
        throw new BadRequestException('A reatribuição exige motivo (M19 §33).');
      }

      const [novo] = await tx
        .select({ id: usuario.id, nome: usuario.nomeCompleto })
        .from(usuario)
        .where(
          and(
            eq(usuario.tenantId, ctx.tenantId),
            eq(usuario.id, encarregadoId),
            eq(usuario.status, 'ativo'),
          ),
        )
        .limit(1);
      if (!novo) throw new BadRequestException('Encarregado inexistente ou inativo.');

      const agora = new Date();
      const anteriorId = atual.encarregadoId;
      const anteriorNome = anteriorId ? await this.nomeDe(tx, anteriorId) : null;
      const statusNovo: StatusSolicitacaoLogistica =
        atual.encarregadoId || ['aceita', 'agendada'].includes(atual.status)
          ? atual.status
          : 'aceita';

      await tx
        .update(solicitacaoLogistica)
        .set({
          encarregadoId,
          aceitaEm: atual.aceitaEm ?? agora,
          status: statusNovo,
          atualizadoEm: agora,
        })
        .where(eq(solicitacaoLogistica.id, solicitacaoId));

      // Oferta aberta morre: o servico ja tem dono.
      await tx
        .update(ofertaServico)
        .set({ status: 'encerrada', respondidaEm: agora })
        .where(
          and(
            eq(ofertaServico.tenantId, ctx.tenantId),
            eq(ofertaServico.solicitacaoId, solicitacaoId),
            eq(ofertaServico.status, 'enviada'),
          ),
        );

      await this.registrar(tx, solicitacaoId, {
        tipo: anteriorId ? 'reatribuida' : 'atribuida',
        statusAnterior: atual.status,
        statusNovo,
        descricao: anteriorId
          ? `Responsável alterado de ${anteriorNome} para ${novo.nome}: ${motivo!.trim()}`
          : `Serviço atribuído a ${novo.nome}.`,
        detalhe: { anteriorId, novoId: encarregadoId, motivo: motivo ?? null },
      });

      await this.auditoria.registrar(tx, {
        entidade: OBJETO,
        entidadeId: solicitacaoId,
        acao: anteriorId ? 'reatribuir' : 'atribuir',
        valorAnterior: { encarregadoId: anteriorId },
        valorNovo: { encarregadoId },
        justificativa: motivo ?? null,
      });

      await this.eventos.publicar(tx, {
        tipo: 'logistica.responsavel_alterado',
        moduloOrigem: MODULOS.M19_LOGISTICA,
        casoId: atual.casoId,
        objetoTipo: OBJETO,
        objetoId: solicitacaoId,
        visibilidade: 'interno',
        payload: { identificador: atual.identificador, anteriorId, encarregadoId },
      });

      return { identificador: atual.identificador, anterior: anteriorNome };
    });
  }

  // --- evidencias (secoes 61, 151, 152) --------------------------------------

  /**
   * Foto de um marco. O arquivo e do M16; aqui so se decide se ela pode
   * entrar: servico em aberto, no maximo 4 por marco, e so quem executa ou
   * coordena. Depois da conclusao nada mais entra (secao 152: "impedir
   * substituicao silenciosa apos conclusao do servico").
   */
  async anexarEvidencia(
    solicitacaoId: string,
    marco: MarcoEvidenciaLogistica,
    arquivo: ArquivoRecebido,
    miniatura?: ArquivoRecebido,
  ): Promise<{ id: string; identificador: string; fotosNoMarco: number }> {
    const atual = await this.db.executar(async (tx) => {
      const s = await this.buscar(tx, solicitacaoId);
      this.exigirExecutor(s);
      if (!STATUS_LOGISTICO_ABERTO.includes(s.status)) {
        throw new BadRequestException(
          'Serviço encerrado não recebe evidência. O que foi registrado fica como está (M19 §152).',
        );
      }
      const existentes = await this.contarFotos(tx, solicitacaoId, marco);
      if (existentes >= FOTOS_MAXIMAS_POR_MARCO) {
        throw new BadRequestException(
          `Este marco já tem ${FOTOS_MAXIMAS_POR_MARCO} fotografias, o máximo (M19 §151).`,
        );
      }
      return { ...s, existentes };
    });

    const gravada = await this.imagens.enviarParaObjeto(
      { objetoTipo: OBJETO, objetoId: solicitacaoId },
      arquivo,
      {
        tipo: 'evidencia_logistica',
        moduloContexto: MODULOS.M19_LOGISTICA,
        legenda: `${atual.identificador} · ${marco}`,
        capturadaEm: new Date().toISOString(),
        metadados: { marco },
      },
      miniatura,
    );

    return { ...gravada, fotosNoMarco: atual.existentes + 1 };
  }

  /**
   * Secao 115: o encarregado ve as fotos da operacao DELE; a central ve todas.
   * Outro encarregado, com a mesma permissao de visualizar, nao ve nada aqui.
   */
  async listarEvidencias(solicitacaoId: string) {
    await this.db.executar(async (tx) => this.exigirCentralOuExecutor(await this.buscar(tx, solicitacaoId)));
    return this.imagens.listarPorObjeto(OBJETO, solicitacaoId);
  }

  async baixarEvidencia(solicitacaoId: string, imagemId: string, qual: 'original' | 'miniatura') {
    await this.db.executar(async (tx) => this.exigirCentralOuExecutor(await this.buscar(tx, solicitacaoId)));
    return this.imagens.baixarDoObjeto(OBJETO, solicitacaoId, imagemId, qual);
  }

  // --- marcos (secoes 47 a 82, botoes da secao 150) --------------------------

  /** EM DESLOCAMENTO (secao 48). Alimenta o "motorista a caminho" do Portal. */
  async iniciarDeslocamento(solicitacaoId: string): Promise<void> {
    await this.marcoSimples(solicitacaoId, 'em_deslocamento', {
      coluna: 'deslocamentoEm',
      tipo: 'deslocamento_iniciado',
      descricao: 'Encarregado a caminho.',
      evento: 'logistica.deslocamento_iniciado',
      visibilidade: 'externo',
    });
  }

  /**
   * Chegada (secoes 50 e 53). A hora fica em coluna para medir a espera no
   * cliente; a posicao, quando o dispositivo a fornece, vai para o detalhe.
   */
  async registrarChegada(solicitacaoId: string, geo: EntradaGeo): Promise<void> {
    const ctx = exigirContexto();
    await this.db.executar(async (tx) => {
      const atual = await this.buscar(tx, solicitacaoId);
      this.exigirExecutor(atual);
      this.exigirOrigem(atual.status, 'no_local');
      if (atual.tipoServico === 'entrega') {
        throw new BadRequestException(
          'Numa entrega o material sai do laboratório: registre "Material retirado no laboratório".',
        );
      }
      const agora = new Date();
      const marco = this.montarGeo(geo, agora);

      await tx
        .update(solicitacaoLogistica)
        .set({ status: 'no_local', chegadaEm: agora, atualizadoEm: agora })
        .where(eq(solicitacaoLogistica.id, solicitacaoId));

      await this.registrar(tx, solicitacaoId, {
        tipo: 'chegada',
        statusAnterior: atual.status,
        statusNovo: 'no_local',
        visivelPortal: true,
        descricao: `${ctx.nomeCompleto} chegou ao local.`,
        detalhe: { geo: marco },
      });

      await this.eventos.publicar(tx, {
        tipo: 'logistica.chegada_registrada',
        moduloOrigem: MODULOS.M19_LOGISTICA,
        casoId: atual.casoId,
        objetoTipo: OBJETO,
        objetoId: solicitacaoId,
        visibilidade: 'externo',
        payload: { identificador: atual.identificador },
      });
    });
  }

  /**
   * Secao 52: ninguem no local, cliente fechado, material nao preparado.
   *
   * Nao muda o status - o encarregado ainda esta la, ou ainda pode voltar. O
   * que muda e o historico: a tentativa fica registrada com hora e motivo, e e
   * o que separa "o cliente nao estava" de "o encarregado nao foi".
   */
  async registrarTentativaContato(
    solicitacaoId: string,
    motivo: MotivoContatoSemSucesso,
    detalhe?: string,
  ): Promise<void> {
    const ctx = exigirContexto();
    await this.db.executar(async (tx) => {
      const atual = await this.buscar(tx, solicitacaoId);
      this.exigirExecutor(atual);
      if (!STATUS_LOGISTICO_ABERTO.includes(atual.status)) {
        throw new BadRequestException('Solicitação encerrada.');
      }
      await this.registrar(tx, solicitacaoId, {
        tipo: 'tentativa_contato',
        visivelPortal: true,
        descricao: `${ctx.nomeCompleto} não conseguiu contato: ${motivo}${detalhe ? ` — ${detalhe}` : ''}`,
        detalhe: { motivo, detalhe: detalhe ?? null },
      });
      await this.eventos.publicar(tx, {
        tipo: 'logistica.ocorrencia_registrada',
        moduloOrigem: MODULOS.M19_LOGISTICA,
        casoId: atual.casoId,
        objetoTipo: OBJETO,
        objetoId: solicitacaoId,
        visibilidade: 'interno',
        payload: { identificador: atual.identificador, tipo: 'tentativa_contato', motivo },
      });
    });
  }

  /**
   * MATERIAL RETIRADO (secoes 54 a 67; 151 a 154).
   *
   * Na RETIRADA e o material saindo do cliente; na ENTREGA e o material
   * saindo do laboratorio (secao 150). O status interno e o mesmo - `coletada`
   * quer dizer "esta com o encarregado" - e as exigencias tambem: foto, posicao
   * ou motivo da ausencia, volumes conferidos.
   */
  async registrarRetirada(
    solicitacaoId: string,
    dados: {
      volumesRecebidos: number;
      justificativaVolumes?: string | null;
      condicaoMaterial?: CondicaoMaterialLogistica[];
      observacao?: string | null;
      quemEntregou?: PessoaNoLocal | null;
    } & EntradaGeo,
  ): Promise<{ divergente: boolean; alertas: string[] }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const atual = await this.buscar(tx, solicitacaoId);
      this.exigirExecutor(atual);
      this.exigirOrigem(atual.status, 'coletada');
      await this.exigirFotos(tx, solicitacaoId, 'retirada');

      const agora = new Date();
      const geo = this.montarGeo(dados, agora);
      const alertas: string[] = [];

      /** Secao 59: estimado != contado e dado, com justificativa quando houver. */
      const divergente =
        atual.volumesEstimados != null && atual.volumesEstimados !== dados.volumesRecebidos;
      if (divergente) {
        alertas.push(
          `Volumes conferidos (${dados.volumesRecebidos}) diferem do estimado (${atual.volumesEstimados}).`,
        );
      }

      /**
       * Secao 111 do Guardian: "coleta marcada como concluida sem chegada
       * registrada". Nao bloqueia - a secao 50 diz que a chegada "podera" ser
       * registrada - mas fica apontado para a central.
       */
      if (atual.tipoServico === 'retirada' && !atual.chegadaEm) {
        alertas.push('Retirada registrada sem chegada ao local anotada antes.');
      }

      const posicao = this.alertaDePosicao(atual, geo);
      if (posicao) alertas.push(posicao);

      await tx
        .update(solicitacaoLogistica)
        .set({
          status: 'coletada',
          retiradaEm: agora,
          volumesRecebidos: dados.volumesRecebidos,
          justificativaVolumes: dados.justificativaVolumes ?? null,
          condicaoMaterial: dados.condicaoMaterial ?? [],
          observacaoRetirada: dados.observacao ?? null,
          quemEntregou: dados.quemEntregou?.nome ? dados.quemEntregou : null,
          geoRetirada: geo,
          atualizadoEm: agora,
        })
        .where(eq(solicitacaoLogistica.id, solicitacaoId));

      await this.registrar(tx, solicitacaoId, {
        tipo: 'material_retirado',
        statusAnterior: atual.status,
        statusNovo: 'coletada',
        visivelPortal: true,
        descricao:
          atual.tipoServico === 'entrega'
            ? `Material retirado no laboratório por ${ctx.nomeCompleto}: ${dados.volumesRecebidos} volume(s).`
            : `Material retirado por ${ctx.nomeCompleto}: ${dados.volumesRecebidos} volume(s)` +
              (dados.quemEntregou?.nome ? `, entregue por ${dados.quemEntregou.nome}.` : '.'),
        detalhe: {
          volumesEstimados: atual.volumesEstimados,
          volumesRecebidos: dados.volumesRecebidos,
          divergente,
          justificativa: dados.justificativaVolumes ?? null,
          condicaoMaterial: dados.condicaoMaterial ?? [],
          quemEntregou: dados.quemEntregou ?? null,
          geo,
          alertas,
        },
      });

      for (const alerta of alertas) {
        await this.registrar(tx, solicitacaoId, {
          tipo: 'alerta_guardian',
          descricao: alerta,
          detalhe: { marco: 'retirada' },
        });
      }

      await this.auditoria.registrar(tx, {
        entidade: OBJETO,
        entidadeId: solicitacaoId,
        acao: 'retirar',
        valorAnterior: { status: atual.status },
        valorNovo: { status: 'coletada', volumesRecebidos: dados.volumesRecebidos },
        justificativa: dados.justificativaVolumes ?? null,
      });

      await this.eventos.publicar(tx, {
        tipo: 'logistica.material_retirado',
        moduloOrigem: MODULOS.M19_LOGISTICA,
        casoId: atual.casoId,
        objetoTipo: OBJETO,
        objetoId: solicitacaoId,
        visibilidade: 'externo',
        payload: {
          identificador: atual.identificador,
          volumes: dados.volumesRecebidos,
          divergente,
          condicaoMaterial: dados.condicaoMaterial ?? [],
        },
      });

      return { divergente, alertas };
    });
  }

  /** EM TRANSPORTE (secao 68): o material esta sob custodia do encarregado, na rua. */
  async iniciarTransporte(solicitacaoId: string): Promise<void> {
    await this.marcoSimples(solicitacaoId, 'em_transporte', {
      coluna: 'transporteEm',
      tipo: 'em_transporte',
      descricao: 'Material em transporte.',
      evento: 'logistica.material_retirado',
      visibilidade: 'interno',
      semEvento: true,
    });
  }

  /**
   * MATERIAL ENTREGUE (secoes 75 a 80; 155 a 156).
   *
   * Na RETIRADA o destino e o laboratorio; na ENTREGA e o cliente, e ai a
   * secao 155 pergunta quem recebeu. Nos dois, foto e posicao (ou o motivo de
   * nao haver), e os volumes entregues comparados com os coletados (secao 78).
   */
  async registrarEntrega(
    solicitacaoId: string,
    dados: {
      volumesEntregues?: number | null;
      recebedor?: Recebedor | null;
      observacao?: string | null;
    } & EntradaGeo,
  ): Promise<{ divergente: boolean; alertas: string[] }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const atual = await this.buscar(tx, solicitacaoId);
      this.exigirExecutor(atual);
      this.exigirOrigem(atual.status, 'entregue');
      await this.exigirFotos(tx, solicitacaoId, 'entrega');

      if (atual.tipoServico === 'entrega' && !dados.recebedor?.nome?.trim()) {
        throw new BadRequestException('Informe quem recebeu o material (M19 §155).');
      }

      const agora = new Date();
      const geo = this.montarGeo(dados, agora);
      const volumesEntregues = dados.volumesEntregues ?? atual.volumesRecebidos ?? null;
      const alertas: string[] = [];

      /** Secao 78: entregou menos do que coletou - sinalizado antes do encerramento. */
      const divergente =
        atual.volumesRecebidos != null &&
        volumesEntregues != null &&
        volumesEntregues < atual.volumesRecebidos;
      if (divergente) {
        alertas.push(
          `Entregues ${volumesEntregues} de ${atual.volumesRecebidos} volume(s) coletados.`,
        );
      }

      // Na entrega ao cliente a posicao esperada e o endereco; na volta ao
      // laboratorio nao ha coordenada de referencia na solicitacao.
      const posicao = atual.tipoServico === 'entrega' ? this.alertaDePosicao(atual, geo) : null;
      if (posicao) alertas.push(posicao);

      await tx
        .update(solicitacaoLogistica)
        .set({
          status: 'entregue',
          entregueEm: agora,
          volumesEntregues,
          recebedor: dados.recebedor?.nome ? dados.recebedor : null,
          geoEntrega: geo,
          comDivergencia: divergente,
          atualizadoEm: agora,
        })
        .where(eq(solicitacaoLogistica.id, solicitacaoId));

      await this.registrar(tx, solicitacaoId, {
        tipo: 'material_entregue',
        statusAnterior: atual.status,
        statusNovo: 'entregue',
        visivelPortal: true,
        descricao:
          atual.tipoServico === 'entrega'
            ? `Material entregue por ${ctx.nomeCompleto} a ${dados.recebedor!.nome}.`
            : `Material entregue ao laboratório por ${ctx.nomeCompleto}` +
              (dados.recebedor?.nome ? `, recebido por ${dados.recebedor.nome}.` : '.'),
        detalhe: {
          volumesRecebidos: atual.volumesRecebidos,
          volumesEntregues,
          divergente,
          recebedor: dados.recebedor ?? null,
          observacao: dados.observacao ?? null,
          geo,
          alertas,
        },
      });

      for (const alerta of alertas) {
        await this.registrar(tx, solicitacaoId, {
          tipo: divergente && alerta.startsWith('Entregues') ? 'divergencia_entrega' : 'alerta_guardian',
          descricao: alerta,
          detalhe: { marco: 'entrega' },
        });
      }

      await this.auditoria.registrar(tx, {
        entidade: OBJETO,
        entidadeId: solicitacaoId,
        acao: 'entregar',
        valorAnterior: { status: atual.status },
        valorNovo: { status: 'entregue', volumesEntregues, recebedor: dados.recebedor ?? null },
      });

      await this.eventos.publicar(tx, {
        tipo: 'logistica.material_entregue',
        moduloOrigem: MODULOS.M19_LOGISTICA,
        casoId: atual.casoId,
        objetoTipo: OBJETO,
        objetoId: solicitacaoId,
        visibilidade: 'externo',
        payload: { identificador: atual.identificador, volumesEntregues, divergente },
      });

      if (divergente) {
        /** Secao 128: divergencia vai para a Qualidade. */
        await this.eventos.publicar(tx, {
          tipo: 'logistica.divergencia_volumes',
          moduloOrigem: MODULOS.M19_LOGISTICA,
          casoId: atual.casoId,
          objetoTipo: OBJETO,
          objetoId: solicitacaoId,
          visibilidade: 'interno',
          payload: {
            identificador: atual.identificador,
            volumesRecebidos: atual.volumesRecebidos,
            volumesEntregues,
          },
        });
      }

      return { divergente, alertas };
    });
  }

  /**
   * SERVICO CONCLUIDO (secoes 82, 159 e 164).
   *
   * So depois da entrega confirmada. A divergencia nao impede concluir - o
   * material pode ter sido localizado, ou a contagem inicial estar errada -
   * mas exige que alguem diga o que houve, porque a secao 78 pede a
   * sinalizacao "antes do encerramento" e a regra 10 da secao 132 manda o
   * volume nao entregue gerar alerta.
   *
   * Concluir gera o item de producao no M20: e o unico ponto em que a
   * Logistica toca o Financeiro, e e para ENTREGAR o fato, nao para calcular
   * nada (secao 148).
   */
  async concluir(
    solicitacaoId: string,
    justificativaDivergencia?: string | null,
  ): Promise<{ identificador: string; producaoId: string | null }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const atual = await this.buscar(tx, solicitacaoId);
      this.exigirExecutor(atual);
      this.exigirOrigem(atual.status, 'concluida');

      if (atual.comDivergencia && !justificativaDivergencia?.trim()) {
        throw new BadRequestException(
          'Há volumes coletados e não entregues. Diga o que aconteceu antes de concluir (M19 §78).',
        );
      }

      const agora = new Date();
      await tx
        .update(solicitacaoLogistica)
        .set({
          status: 'concluida',
          concluidaEm: agora,
          concluidaPorId: ctx.usuarioId,
          atualizadoEm: agora,
        })
        .where(eq(solicitacaoLogistica.id, solicitacaoId));

      await this.registrar(tx, solicitacaoId, {
        tipo: 'concluida',
        statusAnterior: atual.status,
        statusNovo: 'concluida',
        visivelPortal: true,
        descricao:
          `Serviço concluído por ${ctx.nomeCompleto}.` +
          (justificativaDivergencia ? ` Divergência: ${justificativaDivergencia.trim()}` : ''),
        detalhe: { justificativaDivergencia: justificativaDivergencia ?? null },
      });

      /** Secao 159: cada servico concluido gera um item de producao do encarregado. */
      const producaoId = atual.encarregadoId
        ? await this.financeiro.registrarProducaoLogistica(tx, {
            solicitacaoId,
            encarregadoId: atual.encarregadoId,
            tipoServico: atual.tipoServico,
            concluidaEm: agora,
            valorCentavos: atual.valorCentavos ?? 0,
          })
        : null;

      await this.auditoria.registrar(tx, {
        entidade: OBJETO,
        entidadeId: solicitacaoId,
        acao: 'concluir',
        valorAnterior: { status: atual.status },
        valorNovo: { status: 'concluida', producaoId },
        justificativa: justificativaDivergencia ?? null,
      });

      await this.eventos.publicar(tx, {
        tipo: 'logistica.servico_concluido',
        moduloOrigem: MODULOS.M19_LOGISTICA,
        casoId: atual.casoId,
        objetoTipo: OBJETO,
        objetoId: solicitacaoId,
        visibilidade: 'externo',
        payload: {
          identificador: atual.identificador,
          encarregadoId: atual.encarregadoId,
          valorCentavos: atual.valorCentavos ?? 0,
          producaoId,
        },
      });

      return { identificador: atual.identificador, producaoId };
    });
  }

  // --- desfechos sem entrega (secoes 83 a 85) --------------------------------

  /** NAO REALIZADA: o motivo e obrigatorio (secao 83). */
  async naoRealizar(
    solicitacaoId: string,
    motivo: MotivoNaoRealizacao,
    detalhe?: string | null,
  ): Promise<void> {
    const ctx = exigirContexto();
    await this.db.executar(async (tx) => {
      const atual = await this.buscar(tx, solicitacaoId);
      if (!STATUS_LOGISTICO_ABERTO.includes(atual.status)) {
        throw new BadRequestException('Esta solicitação já está encerrada.');
      }
      if (atual.status === 'entregue') {
        throw new BadRequestException('O material já foi entregue: conclua o serviço.');
      }
      // Quem executa ou quem coordena; a recepcao que abriu nao decide sozinha.
      if (
        atual.encarregadoId !== ctx.usuarioId &&
        !ctx.permissoes.has(PERMISSOES.LOGISTICA_ATRIBUIR) &&
        !ctx.permissoes.has(PERMISSOES.LOGISTICA_CANCELAR)
      ) {
        throw new ForbiddenException('Só o encarregado ou a central registram a não realização.');
      }

      const agora = new Date();
      await tx
        .update(solicitacaoLogistica)
        .set({
          status: 'nao_realizada',
          motivoNaoRealizacao: motivo,
          detalheNaoRealizacao: detalhe ?? null,
          atualizadoEm: agora,
        })
        .where(eq(solicitacaoLogistica.id, solicitacaoId));

      await tx
        .update(ofertaServico)
        .set({ status: 'encerrada', respondidaEm: agora })
        .where(
          and(
            eq(ofertaServico.tenantId, ctx.tenantId),
            eq(ofertaServico.solicitacaoId, solicitacaoId),
            eq(ofertaServico.status, 'enviada'),
          ),
        );

      await this.registrar(tx, solicitacaoId, {
        tipo: 'nao_realizada',
        statusAnterior: atual.status,
        statusNovo: 'nao_realizada',
        visivelPortal: true,
        descricao: `Não realizada: ${motivo}${detalhe ? ` — ${detalhe}` : ''}`,
        detalhe: { motivo, detalhe: detalhe ?? null },
      });

      await this.auditoria.registrar(tx, {
        entidade: OBJETO,
        entidadeId: solicitacaoId,
        acao: 'nao_realizar',
        valorAnterior: { status: atual.status },
        valorNovo: { status: 'nao_realizada', motivo },
        justificativa: detalhe ?? motivo,
      });

      await this.eventos.publicar(tx, {
        tipo: 'logistica.nao_realizada',
        moduloOrigem: MODULOS.M19_LOGISTICA,
        casoId: atual.casoId,
        objetoTipo: OBJETO,
        objetoId: solicitacaoId,
        visibilidade: 'externo',
        payload: { identificador: atual.identificador, motivo },
      });
    });
  }

  /**
   * Reagendamento (secao 85): NOVA solicitacao apontando para a que nao deu
   * certo. As duas continuam existindo, e o historico mostra as tentativas.
   */
  async reagendar(
    solicitacaoId: string,
    ajustes: {
      dataDesejada?: string | null;
      janelaInicio?: string | null;
      janelaFim?: string | null;
      observacoes?: string | null;
    },
  ): Promise<{ id: string; identificador: string }> {
    const anterior = await this.db.executar(async (tx) => {
      const s = await this.buscar(tx, solicitacaoId);
      if (s.status !== 'nao_realizada' && s.status !== 'cancelada') {
        throw new BadRequestException('Só uma operação não realizada ou cancelada é reagendada.');
      }
      return s;
    });

    const nova = await this.logistica.criar({
      tipoServico: anterior.tipoServico,
      tipoOperacao: anterior.tipoOperacao,
      canalOrigem: anterior.canalOrigem,
      clienteId: anterior.clienteId,
      unidadeId: anterior.unidadeId,
      casoId: anterior.casoId,
      endereco: anterior.endereco,
      pontoReferencia: anterior.pontoReferencia,
      latitude: anterior.latitude,
      longitude: anterior.longitude,
      contatoNoLocal: anterior.contatoNoLocal,
      telefoneContato: anterior.telefoneContato,
      dataDesejada: ajustes.dataDesejada ?? null,
      janelaInicio: ajustes.janelaInicio ?? anterior.janelaInicio,
      janelaFim: ajustes.janelaFim ?? anterior.janelaFim,
      volumesEstimados: anterior.volumesEstimados,
      tipoMaterial: anterior.tipoMaterial,
      conservacao: anterior.conservacao,
      requisitosEspeciais: anterior.requisitosEspeciais,
      prioridade: anterior.prioridade,
      observacoes: ajustes.observacoes ?? anterior.observacoes,
      valorCentavos: anterior.valorCentavos,
    });

    await this.db.executar(async (tx) => {
      await tx
        .update(solicitacaoLogistica)
        .set({ reagendamentoDeId: solicitacaoId })
        .where(eq(solicitacaoLogistica.id, nova.id));

      await this.registrar(tx, nova.id, {
        tipo: 'reagendamento',
        visivelPortal: true,
        descricao: `Reagendamento de ${anterior.identificador}.`,
        detalhe: { anteriorId: solicitacaoId, anteriorIdentificador: anterior.identificador },
      });
      await this.registrar(tx, solicitacaoId, {
        tipo: 'reagendada',
        visivelPortal: true,
        descricao: `Reagendada como ${nova.identificador}.`,
        detalhe: { novaId: nova.id, novoIdentificador: nova.identificador },
      });

      await this.eventos.publicar(tx, {
        tipo: 'logistica.reagendada',
        moduloOrigem: MODULOS.M19_LOGISTICA,
        casoId: anterior.casoId,
        objetoTipo: OBJETO,
        objetoId: solicitacaoId,
        visibilidade: 'externo',
        payload: { identificador: anterior.identificador, novoIdentificador: nova.identificador },
      });
    });

    return nova;
  }

  // --- ocorrencias (secoes 73 e 74) -----------------------------------------

  async registrarOcorrencia(
    solicitacaoId: string,
    dados: { tipo: TipoOcorrenciaLogistica; descricao: string; medidas?: string | null },
  ): Promise<{ critica: boolean }> {
    const ctx = exigirContexto();
    return this.db.executar(async (tx) => {
      const atual = await this.buscar(tx, solicitacaoId);
      if (!STATUS_LOGISTICO_ABERTO.includes(atual.status)) {
        throw new BadRequestException('Ocorrência só se registra em operação aberta.');
      }
      const critica = OCORRENCIA_LOGISTICA_CRITICA.includes(dados.tipo);

      await tx
        .update(solicitacaoLogistica)
        .set({ comOcorrencia: true, atualizadoEm: new Date() })
        .where(eq(solicitacaoLogistica.id, solicitacaoId));

      await this.registrar(tx, solicitacaoId, {
        tipo: 'ocorrencia',
        descricao: `${dados.tipo}: ${dados.descricao}`,
        detalhe: { tipo: dados.tipo, critica, medidas: dados.medidas ?? null, por: ctx.nomeCompleto },
      });

      /**
       * Secao 74: a critica notifica a central na hora e vai para a Qualidade
       * (M22). Restrita porque descreve risco ao material ou a pessoa - nao e
       * assunto do Portal.
       */
      await this.eventos.publicar(tx, {
        tipo: 'logistica.ocorrencia_registrada',
        moduloOrigem: MODULOS.M19_LOGISTICA,
        casoId: atual.casoId,
        objetoTipo: OBJETO,
        objetoId: solicitacaoId,
        visibilidade: critica ? 'restrito' : 'interno',
        payload: {
          identificador: atual.identificador,
          tipo: dados.tipo,
          critica,
          descricao: dados.descricao,
          medidas: dados.medidas ?? null,
        },
      });

      return { critica };
    });
  }

  // --- painel (secao 94) -------------------------------------------------------

  async painel() {
    const ctx = exigirContexto();
    return this.db.executar(async (tx) => {
      const inicio = new Date();
      inicio.setHours(0, 0, 0, 0);
      // postgres-js nao serializa Date dentro de `sql` cru: vai como texto com cast.
      const hoje = `'${inicio.toISOString()}'::timestamptz`;
      const amanha = `'${new Date(inicio.getTime() + 86_400_000).toISOString()}'::timestamptz`;
      const trintaDias = `'${new Date(inicio.getTime() - 30 * 86_400_000).toISOString()}'::timestamptz`;

      const [linha] = await tx
        .select({
          hoje: sql<number>`count(*) filter (where ${solicitacaoLogistica.dataDesejada} >= ${sql.raw(hoje)} and ${solicitacaoLogistica.dataDesejada} < ${sql.raw(amanha)})::int`,
          aguardandoAceite: sql<number>`count(*) filter (where ${solicitacaoLogistica.status} in ('recebida','aguardando_informacao','aguardando_triagem','aguardando_aceite'))::int`,
          agendadas: sql<number>`count(*) filter (where ${solicitacaoLogistica.status} in ('aceita','agendada'))::int`,
          emRota: sql<number>`count(*) filter (where ${solicitacaoLogistica.status} in ('em_deslocamento','no_local','em_transporte'))::int`,
          coletadasNaoEntregues: sql<number>`count(*) filter (where ${solicitacaoLogistica.status} in ('coletada','em_transporte'))::int`,
          entreguesNaoConcluidas: sql<number>`count(*) filter (where ${solicitacaoLogistica.status} = 'entregue')::int`,
          atrasadas: sql<number>`count(*) filter (where ${solicitacaoLogistica.dataDesejada} < ${sql.raw(hoje)} and ${solicitacaoLogistica.status} in ('recebida','aguardando_informacao','aguardando_triagem','aguardando_aceite','aceita','agendada','em_deslocamento','no_local'))::int`,
          urgentes: sql<number>`count(*) filter (where ${solicitacaoLogistica.prioridade} = 'urgente' and ${solicitacaoLogistica.status} in ('recebida','aguardando_informacao','aguardando_triagem','aguardando_aceite','aceita','agendada','em_deslocamento','no_local','coletada','em_transporte'))::int`,
          naoRealizadas30d: sql<number>`count(*) filter (where ${solicitacaoLogistica.status} = 'nao_realizada' and ${solicitacaoLogistica.atualizadoEm} >= ${sql.raw(trintaDias)})::int`,
          comOcorrencia: sql<number>`count(*) filter (where ${solicitacaoLogistica.comOcorrencia} and ${solicitacaoLogistica.status} in ('recebida','aguardando_informacao','aguardando_triagem','aguardando_aceite','aceita','agendada','em_deslocamento','no_local','coletada','em_transporte','entregue'))::int`,
          comDivergencia: sql<number>`count(*) filter (where ${solicitacaoLogistica.comDivergencia} and ${solicitacaoLogistica.status} <> 'concluida')::int`,
        })
        .from(solicitacaoLogistica)
        .where(eq(solicitacaoLogistica.tenantId, ctx.tenantId));

      const emAtividade = await tx
        .select({
          encarregadoId: solicitacaoLogistica.encarregadoId,
          nome: usuario.nomeCompleto,
          servicos: sql<number>`count(*)::int`,
        })
        .from(solicitacaoLogistica)
        .innerJoin(usuario, eq(usuario.id, solicitacaoLogistica.encarregadoId))
        .where(
          and(
            eq(solicitacaoLogistica.tenantId, ctx.tenantId),
            inArray(solicitacaoLogistica.status, [
              'em_deslocamento',
              'no_local',
              'coletada',
              'em_transporte',
            ]),
          ),
        )
        .groupBy(solicitacaoLogistica.encarregadoId, usuario.nomeCompleto)
        .orderBy(desc(sql`count(*)`));

      const rotasAbertas = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(rotaLogistica)
        .where(
          and(eq(rotaLogistica.tenantId, ctx.tenantId), eq(rotaLogistica.status, 'em_andamento')),
        );

      return { ...linha!, encarregadosEmAtividade: emAtividade, rotasEmAndamento: rotasAbertas[0]?.n ?? 0 };
    });
  }

  // --- internos ---------------------------------------------------------------

  /**
   * Marcos que so mudam status e hora, sem evidencia: deslocamento e
   * transporte. Os que exigem foto tem metodo proprio.
   */
  private async marcoSimples(
    solicitacaoId: string,
    destino: 'em_deslocamento' | 'em_transporte',
    opcoes: {
      coluna: 'deslocamentoEm' | 'transporteEm';
      tipo: string;
      descricao: string;
      evento: 'logistica.deslocamento_iniciado' | 'logistica.material_retirado';
      visibilidade: 'externo' | 'interno';
      semEvento?: boolean;
    },
  ): Promise<void> {
    await this.db.executar(async (tx) => {
      const atual = await this.buscar(tx, solicitacaoId);
      this.exigirExecutor(atual);
      this.exigirOrigem(atual.status, destino);
      const agora = new Date();

      await tx
        .update(solicitacaoLogistica)
        .set({ status: destino, [opcoes.coluna]: agora, atualizadoEm: agora })
        .where(eq(solicitacaoLogistica.id, solicitacaoId));

      await this.registrar(tx, solicitacaoId, {
        tipo: opcoes.tipo,
        statusAnterior: atual.status,
        statusNovo: destino,
        visivelPortal: opcoes.visibilidade === 'externo',
        descricao: opcoes.descricao,
      });

      if (!opcoes.semEvento) {
        await this.eventos.publicar(tx, {
          tipo: opcoes.evento,
          moduloOrigem: MODULOS.M19_LOGISTICA,
          casoId: atual.casoId,
          objetoTipo: OBJETO,
          objetoId: solicitacaoId,
          visibilidade: opcoes.visibilidade,
          payload: { identificador: atual.identificador },
        });
      }
    });
  }

  /** Quem executa e o encarregado do servico; a central (atribuir) pode agir por ele. */
  private exigirExecutor(s: { encarregadoId: string | null }): void {
    const ctx = exigirContexto();
    if (s.encarregadoId === ctx.usuarioId) return;
    if (ctx.permissoes.has(PERMISSOES.LOGISTICA_ATRIBUIR)) return;
    throw new ForbiddenException(
      s.encarregadoId
        ? 'Este serviço está com outro encarregado.'
        : 'O serviço ainda não tem encarregado. Aceite a oferta ou peça atribuição.',
    );
  }

  private exigirCentralOuExecutor(s: { encarregadoId: string | null }): void {
    const ctx = exigirContexto();
    if (s.encarregadoId === ctx.usuarioId) return;
    if (
      ctx.permissoes.has(PERMISSOES.LOGISTICA_ATRIBUIR) ||
      ctx.permissoes.has(PERMISSOES.LOGISTICA_OFERTAR) ||
      ctx.permissoes.has(PERMISSOES.LOGISTICA_CANCELAR)
    ) {
      return;
    }
    throw new ForbiddenException('As evidências desta operação não são suas.');
  }

  private exigirOrigem(
    atual: StatusSolicitacaoLogistica,
    destino: keyof typeof ORIGENS_DO_MARCO,
  ): void {
    if (!ORIGENS_DO_MARCO[destino].includes(atual)) {
      throw new BadRequestException(
        `Não dá para registrar "${destino}" a partir de "${atual}". Siga a ordem dos marcos (M19 §150).`,
      );
    }
  }

  /** Secao 151: sem foto, nao ha marco. */
  private async exigirFotos(tx: Transacao, solicitacaoId: string, marco: 'retirada' | 'entrega') {
    const n = await this.contarFotos(tx, solicitacaoId, marco);
    if (n < FOTOS_MINIMAS_POR_MARCO) {
      throw new BadRequestException(
        `Registre ao menos ${FOTOS_MINIMAS_POR_MARCO} fotografia do material antes de marcar "${marco}" (M19 §151).`,
      );
    }
  }

  private async contarFotos(
    tx: Transacao,
    solicitacaoId: string,
    marco: MarcoEvidenciaLogistica,
  ): Promise<number> {
    const ctx = exigirContexto();
    const [linha] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(imagem)
      .where(
        and(
          eq(imagem.tenantId, ctx.tenantId),
          eq(imagem.objetoTipo, OBJETO),
          eq(imagem.objetoId, solicitacaoId),
          isNull(imagem.inativadaEm),
          sql`${imagem.metadados} ->> 'marco' = ${marco}`,
        ),
      );
    return linha?.n ?? 0;
  }

  /**
   * Secao 153: grava o que veio, ou POR QUE nao veio. Coordenada sem motivo de
   * ausencia e motivo sem coordenada sao os dois estados validos; nenhum dos
   * dois e "campo vazio".
   */
  private montarGeo(entrada: EntradaGeo, agora: Date): GeoMarco {
    const temCoordenada =
      typeof entrada.latitude === 'number' &&
      typeof entrada.longitude === 'number' &&
      Number.isFinite(entrada.latitude) &&
      Number.isFinite(entrada.longitude);
    if (!temCoordenada && !entrada.geoAusente) {
      throw new BadRequestException(
        'Registre a posição do dispositivo ou o motivo de não haver posição (M19 §153).',
      );
    }
    return {
      latitude: temCoordenada ? entrada.latitude! : null,
      longitude: temCoordenada ? entrada.longitude! : null,
      precisaoMetros: entrada.precisaoMetros ?? null,
      ausente: temCoordenada ? null : entrada.geoAusente!,
      registradoEm: agora.toISOString(),
    };
  }

  /** Secao 154: posicao longe do endereco previsto vira alerta, nunca bloqueio. */
  private alertaDePosicao(
    s: { latitude: string | null; longitude: string | null },
    geo: GeoMarco,
  ): string | null {
    if (geo.latitude == null || geo.longitude == null) return null;
    const lat = Number(s.latitude);
    const lon = Number(s.longitude);
    if (!s.latitude || !s.longitude || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const d = distanciaMetros({ latitude: lat, longitude: lon }, { latitude: geo.latitude, longitude: geo.longitude });
    if (d <= DISTANCIA_ALERTA_GEO_METROS) return null;
    return `Posição registrada a ${Math.round(d)} m do endereço previsto.`;
  }

  private async nomeDe(tx: Transacao, usuarioId: string): Promise<string | null> {
    const [u] = await tx
      .select({ nome: usuario.nomeCompleto })
      .from(usuario)
      .where(eq(usuario.id, usuarioId))
      .limit(1);
    return u?.nome ?? null;
  }

  private async registrar(
    tx: Transacao,
    solicitacaoId: string,
    dados: {
      tipo: string;
      statusAnterior?: StatusSolicitacaoLogistica;
      statusNovo?: StatusSolicitacaoLogistica;
      visivelPortal?: boolean;
      descricao?: string;
      detalhe?: Record<string, unknown>;
    },
  ): Promise<void> {
    const ctx = exigirContexto();
    await tx.insert(movimentacaoLogistica).values({
      tenantId: ctx.tenantId,
      solicitacaoId,
      tipo: dados.tipo,
      statusAnterior: dados.statusAnterior ?? null,
      statusNovo: dados.statusNovo ?? null,
      visivelPortal: dados.visivelPortal ?? false,
      descricao: dados.descricao ?? null,
      detalhe: dados.detalhe ?? {},
      responsavelId: ctx.usuarioId,
    });
  }

  private async buscar(tx: Transacao, id: string) {
    const ctx = exigirContexto();
    const [linha] = await tx
      .select()
      .from(solicitacaoLogistica)
      .where(and(eq(solicitacaoLogistica.tenantId, ctx.tenantId), eq(solicitacaoLogistica.id, id)))
      .limit(1);
    if (!linha) throw new NotFoundException('Solicitação logística não encontrada.');
    return linha;
  }
}

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  ADEQUACAO_CITOLOGICA,
  CANAL_ORIGEM_LOGISTICO,
  CONSERVACAO_LOGISTICA,
  PRIORIDADE_LOGISTICA,
  REQUISITO_ESPECIAL_LOGISTICO,
  TIPO_OPERACAO_LOGISTICA,
  TIPO_SERVICO_LOGISTICO,
  type StatusFatura,
  type StatusOrdemServico,
  type TipoLancamento,
  type StatusSolicitacaoLogistica,
  CONDICAO_OBJETO,
  FINALIDADE_USO,
  METODO_DESCARTE,
  MOTIVO_RETENCAO_AMPLIADA,
  RESTRICAO_OBJETO,
  TIPO_EMPRESTIMO,
  TIPO_OBJETO_BIOLOGICO,
  type StatusObjetoBiologico,
  type TipoObjetoBiologico,
  CAVIDADE_NECROPSIA,
  CELULARIDADE,
  CLASSIFICACAO_LESAO,
  CONSERVACAO_CADAVER,
  CONSERVACAO_NECROPSIA,
  ESTADO_EXAME_ORGAO,
  GRAU_CERTEZA_CAUSA,
  LIMITACAO_NECROPSIA,
  MECANISMO_TERMINAL,
  MODALIDADE_NECROPSIA,
  RELACAO_LESAO,
  DESTINACAO_CADAVER,
  EMBALAGEM_CADAVER,
  IDENTIFICACAO_EXTERNA,
  INTEGRIDADE_CADAVER,
  TIPO_BLOQUEIO_CADAVER,
  type StatusCadaver,
  ETAPA,
  GRAVIDADE_NC,
  GRAU_CERTEZA,
  INTENSIDADE,
  LATERALIDADE,
  MODALIDADE_COBRANCA,
  RESSALVAS_RECEBIMENTO,
  METODO_AMOSTRAGEM,
  NIVEL_BLOQUEIO,
  PERMISSOES,
  ORIGEM_IMAGEM,
  PRESERVACAO_CELULAR,
  PRIORIDADE,
  RESULTADO_MARGEM,
  RESULTADO_TRIAGEM,
  STATUS_CLIENTE,
  STATUS_PENDENCIA,
  TIPO_CLIENTE,
  TIPO_IMAGEM,
  type Etapa,
} from '@lapato/shared';
import { ExigePermissao, Publica } from '../core/auth/guards.js';
import { nomeParaCabecalho } from '../core/http/cabecalhos.js';
import { LimiteEntrada } from '../core/http/rate-limit.js';
import { validarCorpo } from '../core/http/validacao.js';
import { UsuariosService } from './m02-usuarios/usuarios.service.js';
import { ClientesService } from './m03-clientes/clientes.service.js';
import { CasosService } from './m05-casos/casos.service.js';
import { TriagemService } from './m06-triagem/triagem.service.js';
import { MacroscopiaService } from './m08-macroscopia/macroscopia.service.js';
import { ProcessamentoService } from './m09-processamento/processamento.service.js';
import { LaudosService } from './m11-laudos/laudos.service.js';
import { CitopatologiaService } from './m12-citopatologia/citopatologia.service.js';
import { NecropsiaService } from './m14-necropsia/necropsia.service.js';
import { CadaveresService } from './m15-cadaveres/cadaveres.service.js';
import { BiotecaService } from './m18-bioteca/bioteca.service.js';
import {
  ImagensService,
  TAMANHO_MAXIMO,
  type ArquivoRecebido,
} from './m16-imagens/imagens.service.js';
import { PortalService } from './m04-portal/portal.service.js';
import {
  SolicitacoesService,
  type AbaSolicitacoes,
} from './m10-solicitacoes/solicitacoes.service.js';
import { FluxoConsultaService } from './m07-fluxo/fluxo-consulta.service.js';
import { PainelService } from './m07-fluxo/painel.service.js';
import { LogisticaService } from './m19-logistica/logistica.service.js';
import { OrdensService } from './m20-ordens/ordens.service.js';
import { EtiquetasService } from './m09-processamento/etiquetas.service.js';
import { FinanceiroService } from './m20-ordens/financeiro.service.js';
import { DbService } from '../core/db/db.service.js';

// ---------------------------------------------------------------------------
// M05 - Recebimento e Cadastro de Amostras
// ---------------------------------------------------------------------------

/**
 * Data de entrada do material (segunda review): pode ficar no passado -
 * volume grande chega hoje e e cadastrado amanha - mas nao no futuro, e nao
 * tao atras que vire reescrita de historico.
 */
const entradaEmSchema = z
  .string()
  .datetime({ offset: true })
  .refine((v) => new Date(v).getTime() <= Date.now() + 5 * 60_000, 'A entrada não pode estar no futuro.')
  .refine(
    (v) => new Date(v).getTime() >= Date.now() - 60 * 24 * 60 * 60_000,
    'Entrada com mais de 60 dias: fale com a administração.',
  );

const pacienteSchema = z.object({
  nome: z.string().min(1),
  // `''` = limpar a especie (dialogo de correcao envia o campo vazio).
  especieId: z.string().uuid().optional().or(z.literal('')),
  raca: z.string().max(80).optional(),
  sexo: z.string().optional(),
  /** ISO `AAAA-MM-DD`; a maioria das requisicoes traz idade, algumas a data. */
  dataNascimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  idadeInformada: z.string().max(40).optional(),
  microchip: z.string().optional(),
  tutorNome: z.string().max(160).optional(),
  tutorTelefone: z.string().max(40).optional(),
  tutorEmail: z.string().email().optional().or(z.literal('')),
});

const novoCasoSchema = z
  .object({
    entradaEm: entradaEmSchema.optional(),
    servicoId: z.string().uuid(),
    modalidade: z.enum(MODALIDADE_COBRANCA).optional(),
    clienteId: z.string().uuid().optional(),
    veterinarioId: z.string().uuid().optional(),
    clinicaOrigem: z.string().max(160).optional(),
    veterinarioInformado: z.string().max(160).optional(),
    prioridade: z.enum(PRIORIDADE).optional(),
    paciente: pacienteSchema.extend({ id: z.string().uuid().optional() }),
    historicoClinico: z.string().optional(),
    amostras: z
      .array(
        z.object({
          descricao: z.string().optional(),
          orgaoId: z.string().uuid().optional(),
          regiaoAnatomica: z.string().optional(),
          lateralidade: z.enum(LATERALIDADE).optional(),
          tipoRelacao: z.string().optional(),
        }),
      )
      .min(1, 'Informe ao menos uma amostra.'),
    recipientes: z
      .array(
        z.object({
          tipoId: z.string().uuid().optional(),
          fixadorId: z.string().uuid().optional(),
          identificacaoExterna: z.string().optional(),
          quantidadeDeclarada: z.number().int().positive().optional(),
        }),
      )
      .min(1, 'Informe ao menos um recipiente.'),
  })
  .superRefine((c, ctx) => {
    if ((c.modalidade ?? 'convenio') === 'convenio' && !c.clienteId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['clienteId'], message: 'Informe o cliente.' });
    }
  });

const recebimentoSchema = z.object({
  conferencia: z
    .array(
      z.object({
        recipienteId: z.string().uuid(),
        quantidadeRecebida: z.number().int().nonnegative(),
        /** Documento do Hugo: fragmentos por pote (numero) ou "multiplos". */
        fragmentosRecebidos: z.number().int().nonnegative().max(999).nullable().optional(),
        fragmentosMultiplos: z.boolean().optional(),
        ressalva: z.enum(RESSALVAS_RECEBIMENTO).nullable().optional(),
        ressalvaDetalhe: z.string().max(300).nullable().optional(),
      }),
    )
    .min(1),
});

@ApiTags('M05 - Recebimento e Cadastro')
@Controller('casos')
export class CasosController {
  constructor(
    private readonly casos: CasosService,
    private readonly etiquetasEntrada: EtiquetasService,
  ) {}

  @Post()
  @ExigePermissao(PERMISSOES.CASO_CRIAR)
  @ApiOperation({
    summary: 'Cadastra um caso anatomopatológico',
    description:
      'Um paciente por caso (M05). Gera o registro oficial pela sequência do M01, ' +
      'nunca reutilizável, e inicia o fluxo no M07.',
  })
  async criar(@Body() corpo: unknown) {
    const { entradaEm, ...dados } = validarCorpo(novoCasoSchema, corpo);
    return this.casos.criar({ ...dados, ...(entradaEm ? { entradaEm: new Date(entradaEm) } : {}) });
  }

  @Post(':id/entrada')
  @ExigePermissao(PERMISSOES.CASO_EDITAR)
  @ApiOperation({
    summary: 'Corrige a data de entrada do material',
    description:
      'O prazo do laudo é recontado a partir da nova data (M07); a alteração fica ' +
      'na auditoria e na linha do tempo.',
  })
  async alterarEntrada(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    const dados = validarCorpo(z.object({ entradaEm: entradaEmSchema }), corpo);
    await this.casos.alterarEntrada(id, new Date(dados.entradaEm));
    return { ok: true };
  }

  @Post('bipagem')
  @ExigePermissao(PERMISSOES.LAUDO_EDITAR)
  @ApiOperation({
    summary: 'Bipar a lâmina: o caso passa a ser de quem bipou',
    description:
      'Aceita o identificador do caso, do cassete, do bloco ou da lâmina (o código de ' +
      'barras da etiqueta). Atribui o caso ao patologista da sessão.',
  })
  async bipar(@Body() corpo: unknown) {
    const dados = validarCorpo(z.object({ codigo: z.string().min(3).max(60) }), corpo);
    return this.casos.biparParaMim(dados.codigo);
  }

  @Post(':id/patologista')
  @ExigePermissao(PERMISSOES.FLUXO_ATRIBUIR_RESPONSAVEL)
  @ApiOperation({
    summary: 'Para qual patologista vai a lâmina',
    description:
      'Registra o destino do material depois da macroscopia. Só usuário com perfil ' +
      'de patologista; reatribuir é permitido e fica na linha do tempo.',
  })
  async atribuirPatologista(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    const dados = validarCorpo(z.object({ usuarioId: z.string().uuid() }), corpo);
    await this.casos.atribuirPatologista(id, dados.usuarioId);
    return { ok: true };
  }

  @Post('resolver-codigo')
  @ExigePermissao(PERMISSOES.CASO_VISUALIZAR)
  @ApiOperation({
    summary: 'Resolve um código bipado (caso, pote, cassete, bloco ou lâmina) ao caso',
    description:
      'Sem atribuir responsável — é o que a fila de macroscopia usa para abrir a ficha do pote ' +
      'que está na bancada. Para assumir o caso, use /casos/bipagem.',
  })
  async resolverCodigo(@Body() corpo: unknown) {
    const dados = validarCorpo(z.object({ codigo: z.string().min(1).max(80) }), corpo);
    return this.casos.resolverCodigo(dados.codigo);
  }

  @Get(':id/etiquetas')
  @ExigePermissao(PERMISSOES.CASO_VISUALIZAR)
  @Header('Content-Type', 'application/pdf')
  @ApiOperation({
    summary: 'PDF das etiquetas da entrada: requisição e potes',
    description:
      'Uma página por etiqueta, no modelo de recipiente do M01. `alvo`: tudo (padrão), ' +
      'requisicao, recipientes, ou o id de um recipiente.',
  })
  async etiquetasDoCaso(@Param('id', ParseUUIDPipe) id: string, @Query('alvo') alvo?: string) {
    const escolha =
      alvo === 'requisicao' || alvo === 'recipientes'
        ? alvo
        : alvo && /^[0-9a-f-]{36}$/i.test(alvo)
          ? { recipienteId: alvo }
          : ('tudo' as const);
    const { bytes, nomeArquivo } = await this.etiquetasEntrada.etiquetasDoCaso(id, escolha);
    return new StreamableFile(bytes, {
      disposition: `inline; filename="${nomeParaCabecalho(nomeArquivo)}"`,
    });
  }

  @Post(':id/recebimento')
  @ExigePermissao(PERMISSOES.MATERIAL_RECEBER)
  @ApiOperation({
    summary: 'Registra o recebimento físico do material',
    description:
      'Quantidade declarada e recebida ficam em campos distintos; a divergência é ' +
      'registrada como dado do caso, não corrigida silenciosamente (M05).',
  })
  async receber(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    const dados = validarCorpo(recebimentoSchema, corpo);
    return this.casos.receberMaterial(id, dados.conferencia);
  }

  @Get(':id')
  @ExigePermissao(PERMISSOES.CASO_VISUALIZAR)
  @ApiOperation({
    summary: 'Dossiê único do caso',
    description:
      'Mesmo dossiê independentemente do módulo de origem, com a linha do tempo ' +
      'única (DIRETRIZES seções 13 e 14).',
  })
  async dossie(@Param('id', ParseUUIDPipe) id: string) {
    return this.casos.buscarDossie(id);
  }
}

// ---------------------------------------------------------------------------
// M06 - Triagem
// ---------------------------------------------------------------------------

const triagemSchema = z.object({
  amostras: z
    .array(
      z
        .object({
          amostraId: z.string().uuid(),
          resultado: z.enum(RESULTADO_TRIAGEM),
          observacoes: z.string().optional(),
          checklist: z.record(z.unknown()).optional(),
        })
        /**
         * Bloquear ou recusar **exige motivo escrito**.
         *
         * O bloqueio cria uma pendencia com descricao generica ("material nao
         * apto para prosseguir") e suspende o prazo. Sem a observacao, o unico
         * lugar onde caberia o motivo real fica vazio - e quem for resolver a
         * pendencia depois nao tem como saber o que precisa ser resolvido.
         */
        .superRefine((a, ctx) => {
          const trava = a.resultado === 'bloqueado' || a.resultado === 'recusado';
          if (trava && !a.observacoes?.trim()) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['observacoes'],
              message: `Resultado "${a.resultado}" exige o motivo em observações.`,
            });
          }
        }),
    )
    .min(1),
  naoConformidades: z
    .array(
      z.object({
        amostraId: z.string().uuid().optional(),
        tipo: z.string().min(1),
        gravidade: z.enum(GRAVIDADE_NC),
        descricao: z.string().min(1),
        impactoPotencial: z.string().optional(),
      }),
    )
    .optional(),
});

@ApiTags('M06 - Triagem')
@Controller('casos/:casoId/triagem')
export class TriagemController {
  constructor(private readonly triagem: TriagemService) {}

  @Post()
  @ExigePermissao(PERMISSOES.TRIAGEM_EXECUTAR)
  @ApiOperation({
    summary: 'Executa a triagem das amostras',
    description:
      'A triagem confirma ou contradiz o cadastro, sem substituí-lo (DIRETRIZES 8.1). ' +
      'Resultado bloqueado ou recusado cria pendência e impede o avanço do fluxo.',
  })
  async executar(
    @Param('casoId', ParseUUIDPipe) casoId: string,
    @Body() corpo: unknown,
  ) {
    return this.triagem.executar(casoId, validarCorpo(triagemSchema, corpo));
  }
}

// ---------------------------------------------------------------------------
// M08 - Macroscopia
// ---------------------------------------------------------------------------

const macroscopiaSchema = z.object({
  descricaoTexto: z.string().optional(),
  caracteristicas: z.record(z.unknown()).optional(),
  comprimentoCm: z.number().positive().optional(),
  larguraCm: z.number().positive().optional(),
  alturaCm: z.number().positive().optional(),
  pesoG: z.number().positive().optional(),
  materialTotalmenteIncluido: z.boolean().optional(),
  lesoes: z
    .array(
      z.object({
        rotulo: z.string().min(1),
        tipo: z.string().optional(),
        localizacao: z.string().optional(),
        lateralidade: z.enum(LATERALIDADE).optional(),
        maiorEixoCm: z.number().positive().optional(),
        menorEixoCm: z.number().positive().optional(),
      }),
    )
    .optional(),
  margens: z
    .array(
      z.object({
        nome: z.string().min(1),
        metodoAmostragem: z.enum(METODO_AMOSTRAGEM).optional(),
        distanciaCm: z.number().nonnegative().optional(),
        tinta: z.record(z.unknown()).optional(),
        naoAvaliavel: z.boolean().optional(),
      }),
    )
    .optional(),
  cassetes: z
    .array(
      z.object({
        tecidoOrigem: z.string().min(1, 'Cassete exige tecido de origem (M08).'),
        descricao: z.string().optional(),
        exigeDescalcificacao: z.boolean().optional(),
      }),
    )
    .optional(),
});

@ApiTags('M08 - Macroscopia')
@Controller('macroscopia')
export class MacroscopiaController {
  constructor(private readonly macro: MacroscopiaService) {}


  @Get('casos/:casoId/cassetes')
  @ExigePermissao(PERMISSOES.PROCESSAMENTO_VISUALIZAR)
  @ApiOperation({
    summary: 'Cassetes do caso',
    description:
      'Base para montar o lote de envio (M09) e para a conferência do laboratório de apoio.',
  })
  async cassetes(@Param('casoId', ParseUUIDPipe) casoId: string) {
    return this.macro.listarCassetes(casoId);
  }

  @Get('amostras/:amostraId')
  @ExigePermissao(PERMISSOES.MACROSCOPIA_EXECUTAR)
  @ApiOperation({
    summary: 'Ficha de macroscopia da amostra',
    description:
      'Devolve null quando ainda não iniciada. Separado do início justamente ' +
      'para que abrir a tela não publique evento nem mova o fluxo.',
  })
  async ficha(@Param('amostraId', ParseUUIDPipe) amostraId: string) {
    return this.macro.buscarPorAmostra(amostraId);
  }

  @Post('amostras/:amostraId')
  @ExigePermissao(PERMISSOES.MACROSCOPIA_EXECUTAR)
  @ApiOperation({ summary: 'Inicia a macroscopia de uma amostra' })
  async iniciar(@Param('amostraId', ParseUUIDPipe) amostraId: string) {
    return this.macro.iniciar(amostraId);
  }

  @Post(':id')
  @ExigePermissao(PERMISSOES.MACROSCOPIA_EXECUTAR)
  @ApiOperation({
    summary: 'Salva medidas, lesões, margens e mapa de cassetes',
    description: 'Campos estruturados e texto livre coexistem (M08).',
  })
  async salvar(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    await this.macro.salvar(id, validarCorpo(macroscopiaSchema, corpo));
    return { ok: true };
  }

  @Post(':id/composicao')
  @ExigePermissao(PERMISSOES.MACROSCOPIA_EXECUTAR)
  @ApiOperation({
    summary: 'Compõe o texto corrido a partir dos bloquinhos marcados',
    description:
      'A base determinística funciona sem IA (M17 §110); o Copiloto, quando ' +
      'disponível, apenas lapida. O texto volta para a tela e é editável — ' +
      'nada é gravado por esta rota.',
  })
  async comporDescricao(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    const dados = validarCorpo(
      z.object({ selecoes: z.record(z.string(), z.array(z.string().min(1).max(80)).max(12)) }),
      corpo,
    );
    return this.macro.comporDescricao(id, dados.selecoes);
  }

  @Post(':id/conclusao')
  @ExigePermissao(PERMISSOES.MACROSCOPIA_CONCLUIR)
  @ApiOperation({
    summary: 'Conclui a macroscopia',
    description:
      'O Guardian bloqueia cassete sem tecido de origem. Perfil em supervisão ' +
      'não conclui sem aprovação (M08).',
  })
  async concluir(@Param('id', ParseUUIDPipe) id: string) {
    await this.macro.concluir(id);
    return { ok: true };
  }

  @Post('amostras/:amostraId/recorte')
  @ExigePermissao(PERMISSOES.SOLICITACAO_CRIAR)
  @ApiOperation({
    summary: 'Recorte: reabre a macroscopia da amostra, sem cobrança',
    description:
      'Pedido do patologista quando a amostragem não foi representativa. Reabre ' +
      'a ficha, registra a solicitação (M10) e lança o retrabalho na OS com valor ' +
      'zero. O prazo do laudo não reinicia.',
  })
  async recorte(@Param('amostraId', ParseUUIDPipe) amostraId: string, @Body() corpo: unknown) {
    const dados = validarCorpo(z.object({ motivo: z.string().min(3).max(500) }), corpo);
    return this.macro.solicitarRecorte(amostraId, dados.motivo);
  }
}

// ---------------------------------------------------------------------------
// M09 - Processamento (terceirizado)
// ---------------------------------------------------------------------------

const loteSchema = z.object({
  casseteIds: z.array(z.string().uuid()).min(1),
  /**
   * Obrigatorio desde que o parceiro passou a ver os proprios lotes: sem
   * destino, o lote fica invisivel do outro lado.
   */
  laboratorioApoioId: z.string().uuid(),
});

const conferenciaSchema = z.object({
  confirmados: z.array(z.string().uuid()).default([]),
  divergencias: z
    .array(
      z.object({
        tipo: z.enum(['cassete_faltante', 'cassete_excedente', 'numeracao_errada']),
        casseteId: z.string().uuid().optional(),
        codigoInformado: z.string().optional(),
        descricao: z.string().min(1),
      }),
    )
    .optional(),
});

const laminasSchema = z.object({
  laminas: z
    .array(
      z.object({
        casseteId: z.string().uuid(),
        coloracao: z.string().min(1),
        nivel: z.number().int().positive().optional(),
      }),
    )
    .min(1),
});

@ApiTags('M09 - Processamento e Colorações')
@Controller('processamento')
export class ProcessamentoController {
  constructor(private readonly processamento: ProcessamentoService,
    private readonly etiquetas: EtiquetasService,
  ) {}

  @Get('cassetes-pendentes')
  @ExigePermissao(PERMISSOES.PROCESSAMENTO_VISUALIZAR)
  @ApiOperation({
    summary: 'Cassetes prontos para envio, de todos os casos',
    description:
      'A bancada monta o lote do dia, que atravessa vários casos — por isso a ' +
      'listagem não é por caso (M09).',
  })
  async cassetesPendentes() {
    return this.processamento.cassetesPendentes();
  }

  @Get('lotes')
  @ExigePermissao(PERMISSOES.PROCESSAMENTO_VISUALIZAR)
  @ApiOperation({ summary: 'Lotes enviados, do mais recente para o mais antigo' })
  async listarLotes() {
    return this.processamento.listarLotes();
  }

  @Get('lotes/:id')
  @ExigePermissao(PERMISSOES.PROCESSAMENTO_VISUALIZAR)
  @ApiOperation({
    summary: 'Detalhe do lote',
    description:
      'Cassetes, conferência, divergências e lâminas. As lâminas são alcançadas ' +
      'pela genealogia Cassete → Bloco → Lâmina.',
  })
  async detalharLote(@Param('id', ParseUUIDPipe) id: string) {
    return this.processamento.detalharLote(id);
  }

  @Post('lotes')
  @ExigePermissao(PERMISSOES.PROCESSAMENTO_ENVIAR_LOTE)
  @ApiOperation({
    summary: 'Envia um lote de cassetes ao laboratório de apoio',
    description: 'O processamento é terceirizado; o lote é identificado pela data de envio.',
  })
  async enviarLote(@Body() corpo: unknown) {
    const dados = validarCorpo(loteSchema, corpo);
    return this.processamento.enviarLote(dados.casseteIds, dados.laboratorioApoioId);
  }

  @Get('lotes/:id/etiquetas')
  @ExigePermissao(PERMISSOES.ETIQUETA_IMPRIMIR)
  @Header('Content-Type', 'application/pdf')
  @ApiOperation({
    summary: 'PDF de etiquetas de lâmina do lote',
    description:
      'Uma página por etiqueta, no tamanho do modelo do M01, com identificador ' +
      'e Code 128 — o parceiro imprime as NOSSAS etiquetas na impressora dele ' +
      '(M09). A lâmina herda o identificador do cassete, então bipar resolve a cadeia.',
  })
  async etiquetasDoLote(@Param('id', ParseUUIDPipe) id: string) {
    const { bytes, nomeArquivo } = await this.etiquetas.etiquetasDoLote(id);
    return new StreamableFile(bytes, {
      disposition: `inline; filename="${nomeParaCabecalho(nomeArquivo)}"`,
    });
  }

  @Post('lotes/:id/conferencia')
  @ExigePermissao(PERMISSOES.PROCESSAMENTO_CONFIRMAR_RECEBIMENTO)
  @ApiOperation({
    summary: 'Conferência do lote pelo laboratório de apoio',
    description:
      'O parceiro confirma o recebimento e aponta incongruências: falta de cassetes, ' +
      'cassetes a mais não listados, numerações erradas (M09).',
  })
  async conferir(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    return this.processamento.confirmarRecebimento(id, validarCorpo(conferenciaSchema, corpo));
  }

  @Post('lotes/:id/laminas')
  @ExigePermissao(PERMISSOES.PROCESSAMENTO_REGISTRAR_LAMINAS)
  @ApiOperation({
    summary: 'Registra as lâminas produzidas',
    description:
      'Cria o bloco a partir do cassete e a lâmina a partir do bloco, preservando a ' +
      'origem até o fragmento macroscópico (M09).',
  })
  async registrarLaminas(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    const dados = validarCorpo(laminasSchema, corpo);
    return this.processamento.registrarLaminas(id, dados.laminas);
  }
}

// ---------------------------------------------------------------------------
// M11 - Laudos e Microscopia
// ---------------------------------------------------------------------------

const laudoSchema = z.object({
  descricaoMicroscopica: z.string().optional(),
  comentarios: z.string().optional(),
  conclusao: z.string().optional(),
  notaInterna: z.string().optional(),
  diagnosticos: z
    .array(
      z.object({
        amostraId: z.string().uuid().optional(),
        hierarquia: z.string().optional(),
        processo: z.string().optional(),
        entidade: z.string().optional(),
        comportamento: z.string().optional(),
        distribuicao: z.string().optional(),
        severidade: z.string().optional(),
        lateralidade: z.enum(LATERALIDADE).optional(),
        textoExibido: z.string().min(1),
        classificacaoNome: z.string().optional(),
        classificacaoVersao: z.string().optional(),
        grau: z.string().optional(),
        criteriosGraduacao: z.record(z.unknown()).optional(),
        provisorio: z.boolean().optional(),
      }),
    )
    .optional(),
  margens: z
    .array(
      z.object({
        nome: z.string().min(1),
        resultado: z.enum(RESULTADO_MARGEM),
        distanciaMm: z.number().nonnegative().optional(),
        observacoes: z.string().optional(),
      }),
    )
    .optional(),
});

const reaberturaSchema = z.object({
  motivo: z.string().min(5, 'Diga por que o laudo volta para edição.'),
});

const revisaoSchema = z
  .object({
    resultado: z.enum(['aprovada', 'ajustes_solicitados']),
    comentarios: z.string().optional(),
    discordancia: z.boolean().optional(),
  })
  /**
   * Devolver para correcao exige dizer o que corrigir - mesma logica do motivo
   * obrigatorio no bloqueio da triagem. Sem o comentario, quem elabora recebe
   * so "o revisor solicitou ajustes" e fica adivinhando quais.
   */
  .superRefine((r, ctx) => {
    if (r.resultado === 'ajustes_solicitados' && !r.comentarios?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['comentarios'],
        message: 'Solicitar ajustes exige dizer quais, em comentários.',
      });
    }
  });

const novaVersaoSchema = z.object({
  tipo: z.enum(['adendo', 'correcao']),
  motivo: z.string().min(1, 'Adendo e correção exigem motivo (M11).'),
});

@ApiTags('M11 - Laudos e Microscopia')
@Controller('laudos')
export class LaudosController {
  constructor(private readonly laudos: LaudosService) {}

  @Get('busca')
  @ExigePermissao(PERMISSOES.LAUDO_VISUALIZAR)
  @ApiOperation({
    summary: 'Arquivo de laudos: busca por paciente, cliente, responsável, palavra-chave, lâmina ou OS',
    description: 'Um termo, procurado na versão corrente de cada laudo e nas referências do caso.',
  })
  async buscar(@Query('q') q?: string) {
    return this.laudos.buscar(q ?? '');
  }

  @Get('casos/:casoId')
  @ExigePermissao(PERMISSOES.LAUDO_VISUALIZAR)
  @ApiOperation({
    summary: 'Laudo do caso, com a versão corrente',
    description:
      'Devolve null quando ainda não aberto. Separado do início para que ' +
      'carregar a tela não publique evento nem mova o fluxo. A nota interna ' +
      'só vem para quem tem a permissão própria (M11).',
  })
  async laudoDoCaso(@Param('casoId', ParseUUIDPipe) casoId: string) {
    return this.laudos.buscarPorCaso(casoId);
  }

  @Post('casos/:casoId')
  @ExigePermissao(PERMISSOES.LAUDO_EDITAR)
  @ApiOperation({ summary: 'Abre (ou recupera) o laudo do caso' })
  async abrir(@Param('casoId', ParseUUIDPipe) casoId: string) {
    return this.laudos.abrir(casoId);
  }

  @Post('versoes/:versaoId')
  @ExigePermissao(PERMISSOES.LAUDO_EDITAR)
  @ApiOperation({
    summary: 'Salva o conteúdo estruturado da versão',
    description:
      'O laudo é o dado estruturado versionado; o PDF é representação derivada (ADR 0005).',
  })
  async salvar(@Param('versaoId', ParseUUIDPipe) versaoId: string, @Body() corpo: unknown) {
    await this.laudos.salvar(versaoId, validarCorpo(laudoSchema, corpo));
    return { ok: true };
  }

  @Post('versoes/:versaoId/revisao')
  @ExigePermissao(PERMISSOES.LAUDO_EDITAR)
  @ApiOperation({ summary: 'Envia a versão para revisão' })
  async enviarRevisao(@Param('versaoId', ParseUUIDPipe) versaoId: string) {
    await this.laudos.enviarParaRevisao(versaoId);
    return { ok: true };
  }

  @Post('versoes/:versaoId/reabertura')
  @ExigePermissao(PERMISSOES.LAUDO_EDITAR)
  @ApiOperation({
    summary: 'Retoma a edição de um laudo aguardando assinatura',
    description:
      'Devolve a versão aprovada ao rascunho. **Invalida a aprovação**: aprovar é um ' +
      'parecer sobre um texto específico, e o laudo passa pela revisão de novo. ' +
      'O motivo é obrigatório — o ato desfaz o trabalho do revisor.',
  })
  async reabrirParaEdicao(
    @Param('versaoId', ParseUUIDPipe) versaoId: string,
    @Body() corpo: unknown,
  ) {
    const dados = validarCorpo(reaberturaSchema, corpo);
    await this.laudos.reabrirParaEdicao(versaoId, dados.motivo);
  }

  @Post('versoes/:versaoId/revisao/conclusao')
  @ExigePermissao(PERMISSOES.LAUDO_REVISAR)
  @ApiOperation({ summary: 'Conclui a revisão' })
  async concluirRevisao(
    @Param('versaoId', ParseUUIDPipe) versaoId: string,
    @Body() corpo: unknown,
  ) {
    const dados = validarCorpo(revisaoSchema, corpo);
    await this.laudos.concluirRevisao(
      versaoId,
      dados.resultado,
      dados.comentarios,
      dados.discordancia,
    );
    return { ok: true };
  }

  @Post('versoes/:versaoId/assinatura')
  @ExigePermissao(PERMISSOES.LAUDO_ASSINAR)
  @ApiOperation({
    summary: 'Assina a versão do laudo',
    description:
      'Roda a checagem consolidada do Guardian antes de assinar. Achado crítico ' +
      '(lateralidade divergente, ausência de diagnóstico, assinatura expirada) bloqueia.',
  })
  async assinar(@Param('versaoId', ParseUUIDPipe) versaoId: string) {
    return this.laudos.assinar(versaoId);
  }

  @Post('versoes/:versaoId/liberacao')
  @ExigePermissao(PERMISSOES.LAUDO_LIBERAR)
  @ApiOperation({
    summary: 'Libera o laudo',
    description:
      'Uma ação; o resto são consequências automatizadas: fluxo, Portal, notificação ' +
      'e auditoria (DIRETRIZES seção 17).',
  })
  async liberar(@Param('versaoId', ParseUUIDPipe) versaoId: string) {
    await this.laudos.liberar(versaoId);
    return { ok: true };
  }

  @Post(':laudoId/versoes')
  @ExigePermissao(PERMISSOES.LAUDO_ADENDO)
  @ApiOperation({
    summary: 'Cria adendo ou correção',
    description: 'Adendo acrescenta, correção retifica. A versão anterior é preservada (M11).',
  })
  async novaVersao(@Param('laudoId', ParseUUIDPipe) laudoId: string, @Body() corpo: unknown) {
    const dados = validarCorpo(novaVersaoSchema, corpo);
    return this.laudos.novaVersao(laudoId, dados.tipo, dados.motivo);
  }

  @Get('versoes/:versaoId/pdf/pre-visualizacao')
  @ExigePermissao(PERMISSOES.LAUDO_VISUALIZAR)
  @Header('Content-Type', 'application/pdf')
  @ApiOperation({
    summary: 'Pré-visualização do PDF',
    description:
      'Mostra exatamente o documento que seria disponibilizado (M11 seção 71). Gerado ' +
      'na hora, nunca gravado - só a versão assinada é congelada (ADR 0005).',
  })
  async preVisualizarPdf(@Param('versaoId', ParseUUIDPipe) versaoId: string) {
    const bytes = await this.laudos.preVisualizarPdf(versaoId);
    return new StreamableFile(bytes);
  }

  @Get('versoes/:versaoId/pdf')
  @ExigePermissao(PERMISSOES.LAUDO_VISUALIZAR)
  @Header('Content-Type', 'application/pdf')
  @ApiOperation({
    summary: 'PDF assinado',
    description:
      'Os bytes congelados no momento da assinatura - nunca regerados. ' +
      '400 se a versão ainda não foi assinada.',
  })
  async baixarPdf(@Param('versaoId', ParseUUIDPipe) versaoId: string) {
    const { bytes, nomeArquivo } = await this.laudos.baixarPdf(versaoId);
    return new StreamableFile(bytes, {
      disposition: `inline; filename="${nomeParaCabecalho(nomeArquivo)}"`,
    });
  }
}

// ---------------------------------------------------------------------------
// Validacao publica de laudo (M11 secao 88)
// ---------------------------------------------------------------------------

const autocadastroSchema = z.object({
  nomeFantasia: z.string().min(1, 'Informe o nome.').max(160),
  razaoSocial: z.string().max(200).optional(),
  documento: z
    .string()
    .max(30)
    .refine((d) => d.replace(/\D/g, '').length >= 11, 'Informe o CNPJ (ou CPF) completo.'),
  email: z.string().email('E-mail inválido.'),
  telefone: z.string().min(8, 'Informe o telefone.').max(40),
});

/**
 * Autocadastro do cliente pelo link (documento do Hugo). Rota anonima, como a
 * validacao do laudo: o tenant vem no caminho, o token e o unico segredo, e o
 * teto de entrada impede varredura.
 */
@Controller('cadastro-cliente')
export class AutocadastroClienteController {
  constructor(private readonly clientes: ClientesService) {}

  @Publica()
  @LimiteEntrada()
  @Get(':tenantSlug/:token')
  @ApiOperation({ summary: 'Dados atuais do cliente para o link de autocadastro' })
  async ler(@Param('tenantSlug') tenantSlug: string, @Param('token') token: string) {
    return this.clientes.lerConvitePublico(tenantSlug, token);
  }

  @Publica()
  @LimiteEntrada()
  @Post(':tenantSlug/:token')
  @ApiOperation({ summary: 'O cliente preenche a própria ficha; o link se consome' })
  async concluir(
    @Param('tenantSlug') tenantSlug: string,
    @Param('token') token: string,
    @Body() corpo: unknown,
  ) {
    return this.clientes.concluirConvitePublico(tenantSlug, token, validarCorpo(autocadastroSchema, corpo));
  }
}

/**
 * Fora de `/laudos` de proposito: e a unica rota do modulo sem sessao, e
 * misturá-la ao controller autenticado tornaria facil esquecer o `@Publica()`
 * num endpoint futuro por perto. O slug da instituicao vem na URL pela mesma
 * razao do login (ADR 0002) - nao ha sessao para resolver o tenant.
 */
@ApiTags('Validação pública de laudo')
@Controller('validar')
export class ValidacaoController {
  constructor(private readonly laudos: LaudosService) {}

  @Publica()
  // Rota anonima e enumeravel por natureza: o codigo do laudo e o unico
  // segredo. Sem teto, da para varrer o espaco de codigos a vontade.
  @LimiteEntrada()
  @Get(':tenantSlug/:codigo')
  @ApiOperation({
    summary: 'Confere a autenticidade de um laudo pelo QR Code',
    description:
      'Resposta deliberadamente pobre: instituição, caso, versão, quem assinou e ' +
      'quando, e se esta é a versão vigente. Nenhum dado clínico ou diagnóstico.',
  })
  async validar(
    @Param('tenantSlug') tenantSlug: string,
    @Param('codigo') codigo: string,
  ) {
    return this.laudos.validarPublico(tenantSlug, codigo);
  }
}

// ---------------------------------------------------------------------------
// M02 - Usuários, Perfis e Permissões (gestão; a autenticação vive em core/auth)
// ---------------------------------------------------------------------------

const novoUsuarioSchema = z.object({
  nomeCompleto: z.string().min(1, 'Informe o nome.'),
  email: z.string().email('E-mail inválido.'),
  perfilIds: z.array(z.string().uuid()).min(1, 'Atribua ao menos um perfil.'),
  unidadePrincipalId: z.string().uuid().optional(),
  telefone: z.string().optional(),
  /** M04: obrigatório quando algum perfil é do Portal - é o escopo da conta. */
  clienteId: z.string().uuid().optional(),
});

/**
 * M02 secao 45: a identificacao profissional e o que sai impresso no laudo
 * (conselho e registro). `validoAte` vazio significa sem prazo.
 */
const novaAssinaturaSchema = z.object({
  identificacaoProfissional: z
    .string()
    .min(3, 'Informe o conselho e o registro, como aparecerá no laudo.'),
  validoAte: z.string().datetime({ offset: true }).nullish(),
});

const edicaoUsuarioSchema = z.object({
  nomeCompleto: z.string().min(1).optional(),
  /** M02 secao 3: corrigivel, mas continua unico na instituicao. */
  email: z.string().email('Informe um e-mail válido.').optional(),
  perfilIds: z.array(z.string().uuid()).min(1).optional(),
  unidadePrincipalId: z.string().uuid().nullish(),
});

@ApiTags('M02 - Usuários, Perfis e Permissões')
@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly usuarios: UsuariosService) {}

  @Get('patologistas')
  @ExigePermissao(PERMISSOES.CASO_VISUALIZAR)
  @ApiOperation({ summary: 'Patologistas ativos — o seletor de destino da lâmina' })
  async patologistas() {
    return this.usuarios.listarPatologistas();
  }

  @Get('perfis')
  @ExigePermissao(PERMISSOES.USUARIO_VISUALIZAR)
  @ApiOperation({ summary: 'Perfis disponíveis para atribuição (M02 seção 9)' })
  async perfis() {
    return this.usuarios.listarPerfis();
  }

  @Get()
  @ExigePermissao(PERMISSOES.USUARIO_VISUALIZAR)
  @ApiOperation({ summary: 'Usuários da instituição, com perfis e último acesso' })
  async listar() {
    return this.usuarios.listar();
  }

  @Post()
  @ExigePermissao(PERMISSOES.USUARIO_CRIAR)
  @ApiOperation({
    summary: 'Cria usuário',
    description:
      'Senha provisória gerada e exibida UMA vez (M02 seção 31); o primeiro login fica ' +
      'preso na troca obrigatória - e no cadastro de MFA, se o perfil exigir.',
  })
  async criar(@Body() corpo: unknown) {
    return this.usuarios.criar(validarCorpo(novoUsuarioSchema, corpo));
  }

  @Post(':id/bloqueio')
  @ExigePermissao(PERMISSOES.USUARIO_BLOQUEAR)
  @ApiOperation({
    summary: 'Bloqueia a conta',
    description: 'Derruba as sessões abertas na hora (M02 seção 33). Não apaga nada.',
  })
  async bloquear(@Param('id', ParseUUIDPipe) id: string) {
    await this.usuarios.bloquear(id);
    return { ok: true };
  }

  @Post(':id/reativacao')
  @ExigePermissao(PERMISSOES.USUARIO_BLOQUEAR)
  @ApiOperation({ summary: 'Reativa a conta e zera o lockout progressivo' })
  async reativar(@Param('id', ParseUUIDPipe) id: string) {
    await this.usuarios.reativar(id);
    return { ok: true };
  }

  @Post(':id/redefinicao-senha')
  @ExigePermissao(PERMISSOES.USUARIO_EDITAR)
  @ApiOperation({
    summary: 'Reset administrativo de senha',
    description:
      'Nova senha provisória com troca obrigatória; sessões revogadas; o ato fica na ' +
      'auditoria (M02 seção 32).',
  })
  async redefinirSenha(@Param('id', ParseUUIDPipe) id: string) {
    return this.usuarios.redefinirSenha(id);
  }

  @Get(':id/assinaturas')
  @ExigePermissao(PERMISSOES.USUARIO_VISUALIZAR)
  @ApiOperation({
    summary: 'Assinaturas profissionais do usuário',
    description: 'Histórico completo: a inativa fica, porque o laudo assinado aponta para ela.',
  })
  async assinaturas(@Param('id', ParseUUIDPipe) id: string) {
    return this.usuarios.listarAssinaturas(id);
  }

  @Post(':id/assinaturas')
  @ExigePermissao(PERMISSOES.USUARIO_EDITAR)
  @ApiOperation({
    summary: 'Registra a assinatura profissional',
    description:
      'Sem assinatura ativa e válida o Guardian barra a assinatura do laudo (M11). ' +
      'Renovar cria um registro novo e inativa o anterior — o laudo já assinado ' +
      'continua apontando para a identificação que valia na época (M11 §118).',
  })
  async registrarAssinatura(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    return this.usuarios.registrarAssinatura(id, validarCorpo(novaAssinaturaSchema, corpo));
  }

  @Post(':id/assinaturas/:assinaturaId/inativacao')
  @ExigePermissao(PERMISSOES.USUARIO_EDITAR)
  @ApiOperation({
    summary: 'Inativa a assinatura profissional',
    description: 'Inativação, nunca exclusão (M01): o registro histórico é preservado.',
  })
  async inativarAssinatura(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('assinaturaId', ParseUUIDPipe) assinaturaId: string,
  ) {
    await this.usuarios.inativarAssinatura(id, assinaturaId);
  }

  @Post(':id')
  @ExigePermissao(PERMISSOES.USUARIO_EDITAR)
  @ApiOperation({
    summary: 'Edita nome, e-mail, perfis e unidade',
    description:
      'A troca de perfis substitui o conjunto e vale na próxima sessão - reduzir ' +
      'privilégio de sessão aberta exige bloquear. A troca de e-mail muda o login ' +
      'da pessoa e fica registrada na auditoria com o endereço anterior.',
  })
  async editar(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    await this.usuarios.editar(id, validarCorpo(edicaoUsuarioSchema, corpo));
    return { ok: true };
  }
}

// ---------------------------------------------------------------------------
// M03 - Cadastro de Clientes e Veterinários
// ---------------------------------------------------------------------------

/**
 * Documento do Hugo: "as unicas infos obrigatorias sao CNPJ, email, telefone".
 * O particular e a excecao - nao e empresa, e o responsavel do animal.
 */
const clienteBase = z
  .object({
    nomeFantasia: z.string().min(1, 'Informe o nome do cliente.'),
    razaoSocial: z.string().optional(),
    documento: z.string().optional(),
    email: z.string().email('E-mail inválido.').optional().or(z.literal('')),
    telefone: z.string().max(40).optional(),
    tipo: z.enum(TIPO_CLIENTE),
    codigo: z
      .string()
      .min(2)
      .max(6)
      .regex(/^[A-Za-z0-9]+$/, 'Só letras e números - o código compõe o registro do exame.'),
    nomeAbreviado: z.string().optional(),
    observacoes: z.string().optional(),
    /** M03 seção 20: confirmação após o aviso de duplicidade. */
    ignorarDuplicidade: z.boolean().optional(),
  });
const clienteSchema = clienteBase.superRefine((c, ctx) => {
    if (c.tipo === 'tutor_particular') return;
    if (!c.documento?.replace(/\D/g, '')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['documento'], message: 'Informe o CNPJ.' });
    }
    if (!c.email?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['email'], message: 'Informe o e-mail.' });
    }
    if (!c.telefone?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['telefone'], message: 'Informe o telefone.' });
    }
  });

// Documento do Hugo: no veterinario, nome e CRMV sao obrigatorios.
const veterinarioBase = z.object({
  nome: z.string().min(1, 'Informe o nome do profissional.'),
  crmv: z.string().min(1, 'Informe o CRMV.'),
  crmvUf: z.string().length(2, 'Informe a UF do CRMV.'),
  email: z.string().email().optional().or(z.literal('')),
  telefone: z.string().optional(),
  especialidade: z.string().optional(),
  ignorarDuplicidade: z.boolean().optional(),
});

const veterinarioSchema = veterinarioBase.superRefine((v, ctx) => {
  // CRMV sem UF não identifica o registro; UF sem número tampouco.
  if (Boolean(v.crmv?.trim()) !== Boolean(v.crmvUf?.trim())) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['crmvUf'],
      message: 'CRMV e UF andam juntos - informe os dois ou nenhum.',
    });
  }
});

const vinculoSchema = z.object({
  clienteId: z.string().uuid(),
  cargo: z.string().optional(),
  principal: z.boolean().optional(),
});

@ApiTags('M05 - Pacientes')
/**
 * Paciente longitudinal (M05): a busca para "so inserir o exame" e a correcao
 * da identificacao depois do cadastro (documento do Hugo).
 */
@Controller('pacientes')
export class PacientesController {
  constructor(private readonly casos: CasosService) {}

  @Get()
  @ExigePermissao(PERMISSOES.CASO_VISUALIZAR)
  @ApiOperation({
    summary: 'Busca pacientes já atendidos por nome, responsável ou microchip',
    description:
      'Devolve o último exame de cada um para a recepção confirmar que é o mesmo animal ' +
      'antes de reaproveitar o cadastro.',
  })
  async buscar(@Query('q') q?: string) {
    return this.casos.buscarPacientes(q ?? '');
  }

  @Post(':id')
  @ExigePermissao(PERMISSOES.CASO_EDITAR)
  @ApiOperation({
    summary: 'Corrige a identificação do animal e do responsável',
    description: 'Auditado campo a campo; o Guardian segue comparando identidade antes da assinatura.',
  })
  async editar(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    await this.casos.editarPaciente(id, validarCorpo(pacienteSchema.partial(), corpo));
    return { ok: true };
  }
}

@ApiTags('M03 - Clientes e Veterinários')
@Controller('clientes')
export class ClientesController {
  constructor(private readonly clientes: ClientesService) {}

  @Get()
  @ExigePermissao(PERMISSOES.CLIENTE_VISUALIZAR)
  @ApiOperation({
    summary: 'Busca ampla de clientes',
    description:
      'Um campo cobre nome, razão social, documento e código (M03 seção 45). Inclui ' +
      'inativos - a ficha histórica continua acessível; só as opções de exame os escondem.',
  })
  async listar(@Query('q') q?: string, @Query('status') status?: string) {
    return this.clientes.listarClientes({
      q,
      status: STATUS_CLIENTE.includes(status as never) ? (status as never) : undefined,
    });
  }

  @Post()
  @ExigePermissao(PERMISSOES.CLIENTE_CRIAR)
  @ApiOperation({
    summary: 'Cria cliente',
    description:
      'Documento ou nome já cadastrados devolvem 409 com os candidatos (M03 seção 20); ' +
      'confirmar com ignorarDuplicidade fica registrado na auditoria.',
  })
  async criar(@Body() corpo: unknown) {
    const { ignorarDuplicidade, ...dados } = validarCorpo(clienteSchema, corpo);
    return this.clientes.criarCliente(dados, ignorarDuplicidade);
  }

  @Get(':id')
  @ExigePermissao(PERMISSOES.CLIENTE_VISUALIZAR)
  @ApiOperation({ summary: 'Ficha do cliente: dados, vínculos e últimos casos (M03 seção 49)' })
  async detalhe(@Param('id', ParseUUIDPipe) id: string) {
    return this.clientes.detalheCliente(id);
  }

  @Post(':id')
  @ExigePermissao(PERMISSOES.CLIENTE_EDITAR)
  @ApiOperation({
    summary: 'Edita cliente',
    description:
      'O código fica fora: ele compõe o registro dos exames já emitidos e não se troca ' +
      'por formulário.',
  })
  async editar(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    await this.clientes.editarCliente(
      id,
      validarCorpo(
        clienteBase
          .partial()
          .omit({ codigo: true, ignorarDuplicidade: true })
          // M20: tabela de precos que o cliente segue; nulo volta ao valor padrao.
          .extend({ tabelaPrecoId: z.string().uuid().nullable().optional() }),
        corpo,
      ),
    );
    return { ok: true };
  }

  @Post(':id/convite-cadastro')
  @ExigePermissao(PERMISSOES.CLIENTE_EDITAR)
  @ApiOperation({
    summary: 'Gera o link para o próprio cliente preencher a ficha',
    description:
      'Token de uso único, sete dias de validade, só o hash guardado. O cliente preenche nome, ' +
      'razão social, CNPJ, e-mail e telefone — preços e veterinários seguem internos.',
  })
  async conviteCadastro(@Param('id', ParseUUIDPipe) id: string) {
    return this.clientes.gerarConviteCadastro(id);
  }

  @Post(':id/inativacao')
  @ExigePermissao(PERMISSOES.CLIENTE_EDITAR)
  @ApiOperation({ summary: 'Inativa cliente - nunca exclui (M01/M03)' })
  async inativar(@Param('id', ParseUUIDPipe) id: string) {
    await this.clientes.inativarCliente(id);
    return { ok: true };
  }

  @Post(':id/reativacao')
  @ExigePermissao(PERMISSOES.CLIENTE_EDITAR)
  @ApiOperation({ summary: 'Reativa cliente' })
  async reativar(@Param('id', ParseUUIDPipe) id: string) {
    await this.clientes.reativarCliente(id);
    return { ok: true };
  }
}

@ApiTags('M03 - Clientes e Veterinários')
@Controller('veterinarios')
export class VeterinariosController {
  constructor(private readonly clientes: ClientesService) {}

  @Post('vinculos/:id/encerramento')
  @ExigePermissao(PERMISSOES.VETERINARIO_EDITAR)
  @ApiOperation({
    summary: 'Encerra vínculo com um cliente',
    description:
      'O profissional sai das opções padrão daquele cliente; exames anteriores ficam e o ' +
      'cadastro segue ativo se houver outros vínculos (M03 seção 35).',
  })
  async encerrarVinculo(@Param('id', ParseUUIDPipe) id: string) {
    await this.clientes.encerrarVinculo(id);
    return { ok: true };
  }

  @Get()
  @ExigePermissao(PERMISSOES.VETERINARIO_VISUALIZAR)
  @ApiOperation({ summary: 'Busca de veterinários, com os vínculos vigentes (M03 seção 46)' })
  async listar(@Query('q') q?: string) {
    return this.clientes.listarVeterinarios({ q });
  }

  @Post()
  @ExigePermissao(PERMISSOES.VETERINARIO_CRIAR)
  @ApiOperation({
    summary: 'Cria veterinário',
    description:
      'Pessoa única com N vínculos (M03 seções 12-13): CRMV ou nome já cadastrados ' +
      'devolvem 409 - o caminho normal é vincular o existente, não recadastrar.',
  })
  async criar(@Body() corpo: unknown) {
    const { ignorarDuplicidade, ...dados } = validarCorpo(veterinarioSchema, corpo);
    return this.clientes.criarVeterinario(dados, ignorarDuplicidade);
  }

  @Post(':id/vinculos')
  @ExigePermissao(PERMISSOES.VETERINARIO_EDITAR)
  @ApiOperation({
    summary: 'Vincula o veterinário a um cliente',
    description: 'Se o vínculo existiu e foi encerrado, reativa em vez de duplicar (M03 seção 36).',
  })
  async vincular(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    const dados = validarCorpo(vinculoSchema, corpo);
    return this.clientes.vincular(id, dados.clienteId, dados);
  }

  @Post(':id/inativacao')
  @ExigePermissao(PERMISSOES.VETERINARIO_EDITAR)
  @ApiOperation({ summary: 'Inativa veterinário' })
  async inativar(@Param('id', ParseUUIDPipe) id: string) {
    await this.clientes.inativarVeterinario(id);
    return { ok: true };
  }

  @Post(':id/reativacao')
  @ExigePermissao(PERMISSOES.VETERINARIO_EDITAR)
  @ApiOperation({ summary: 'Reativa veterinário' })
  async reativar(@Param('id', ParseUUIDPipe) id: string) {
    await this.clientes.reativarVeterinario(id);
    return { ok: true };
  }

  @Post(':id')
  @ExigePermissao(PERMISSOES.VETERINARIO_EDITAR)
  @ApiOperation({ summary: 'Edita veterinário' })
  async editar(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    await this.clientes.editarVeterinario(
      id,
      validarCorpo(veterinarioBase.partial().omit({ ignorarDuplicidade: true }), corpo),
    );
    return { ok: true };
  }
}

// ---------------------------------------------------------------------------
// M10 - Solicitações e Pendências
// ---------------------------------------------------------------------------

const novaSolicitacaoSchema = z.object({
  casoId: z.string().uuid().optional(),
  /**
   * Texto livre de propósito: o M10 seção 112 entrega os tipos à configuração
   * do M01. A tela oferece os comuns (coloração especial, IHQ, recorte...);
   * fixar um enum aqui congelaria no código o que a documentação quer em dados.
   */
  tipo: z.string().min(1),
  categoria: z.string().optional(),
  descricao: z.string().min(1, 'Descreva o que está sendo solicitado.'),
  justificativa: z.string().optional(),
  prioridade: z.enum(PRIORIDADE).optional(),
  objetoTipo: z.enum(['amostra', 'cassete', 'bloco', 'lamina']).optional(),
  objetoId: z.string().uuid().optional(),
  setorResponsavel: z.string().optional(),
  prazoEm: z.coerce.date().optional(),
  exigeAprovacao: z.boolean().optional(),
});

const analiseSchema = z
  .object({
    resultado: z.enum(['aprovada', 'recusada']),
    motivo: z.string().optional(),
  })
  .superRefine((r, ctx) => {
    if (r.resultado === 'recusada' && !r.motivo?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['motivo'],
        message: 'Recusar uma solicitação exige o motivo.',
      });
    }
  });

const conclusaoSolicitacaoSchema = z.object({
  resultadoTecnico: z.string().optional(),
});

const cancelamentoSchema = z.object({
  motivo: z.string().min(1, 'Cancelar exige o motivo - ele fica no histórico (M10 seção 108).'),
});

const novaPendenciaSchema = z.object({
  casoId: z.string().uuid(),
  solicitacaoId: z.string().uuid().optional(),
  tipo: z.string().min(1),
  descricao: z.string().min(1, 'Descreva o que falta para o caso avançar.'),
  status: z.enum(STATUS_PENDENCIA).optional(),
  nivelBloqueio: z.enum(NIVEL_BLOQUEIO).optional(),
  etapaBloqueada: z.enum(ETAPA).optional(),
  suspendePrazo: z.boolean().optional(),
  setorResponsavel: z.string().optional(),
  visivelPortal: z.boolean().optional(),
});

const resolucaoPendenciaSchema = z.object({
  resolucao: z.string().min(1, 'A resolução registra COMO a pendência saiu do caminho.'),
});

const mensagemSchema = z.object({
  texto: z.string().min(1),
});

@ApiTags('M10 - Solicitações e Pendências')
@Controller('solicitacoes')
export class SolicitacoesController {
  constructor(private readonly solicitacoes: SolicitacoesService) {}

  /**
   * As rotas fixas (`pendencias`, `casos/...`) vêm antes de `:id` de
   * propósito: o Nest resolve na ordem de declaração, e depois delas qualquer
   * segmento vira id - que o ParseUUIDPipe valida.
   */

  @Get('pendencias')
  @ExigePermissao(PERMISSOES.SOLICITACAO_VISUALIZAR)
  @ApiOperation({
    summary: 'Pendências abertas da instituição',
    description: 'Mais antigas primeiro - a pendência esquecida é o inimigo (M10 seção 92).',
  })
  async pendencias() {
    return this.solicitacoes.listarPendencias();
  }

  @Post('pendencias')
  @ExigePermissao(PERMISSOES.SOLICITACAO_CRIAR)
  @ApiOperation({
    summary: 'Cria pendência',
    description:
      'A pendência informa seu impacto (bloqueio, suspensão de prazo); quem decide ' +
      'o estado global do caso é o M07 (M10 seções 21-22).',
  })
  async criarPendencia(@Body() corpo: unknown) {
    return this.solicitacoes.criarPendencia(validarCorpo(novaPendenciaSchema, corpo));
  }

  @Post('pendencias/:id/resolucao')
  @ExigePermissao(PERMISSOES.PENDENCIA_RESOLVER)
  @ApiOperation({
    summary: 'Resolve pendência',
    description:
      'Resolução manual (M10 seção 94). Libera bloqueio e retoma o prazo quando a ' +
      'pendência os criou - inclusive a pendência de triagem bloqueada (M06).',
  })
  async resolverPendencia(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    const dados = validarCorpo(resolucaoPendenciaSchema, corpo);
    await this.solicitacoes.resolverPendencia(id, dados.resolucao);
    return { ok: true };
  }

  @Get('casos/:casoId')
  @ExigePermissao(PERMISSOES.SOLICITACAO_VISUALIZAR)
  @ApiOperation({ summary: 'Solicitações e pendências do caso (aba do dossiê, M10 seção 89)' })
  async doCaso(@Param('casoId', ParseUUIDPipe) casoId: string) {
    return this.solicitacoes.doCaso(casoId);
  }

  @Get()
  @ExigePermissao(PERMISSOES.SOLICITACAO_VISUALIZAR)
  @ApiOperation({ summary: 'Fila de solicitações por subaba (M10 seção 51)' })
  async listar(@Query('aba') aba?: string) {
    const valida = ['abertas', 'minhas', 'vencidas', 'concluidas', 'todas'].includes(aba ?? '');
    return this.solicitacoes.listar(valida ? (aba as AbaSolicitacoes) : 'abertas');
  }

  @Post()
  @ExigePermissao(PERMISSOES.SOLICITACAO_CRIAR)
  @ApiOperation({
    summary: 'Cria solicitação',
    description:
      'Numeração própria SOL- (M10 seção 10). Quem exige aprovação nasce aguardando ' +
      'análise; o resto cai direto na fila de execução.',
  })
  async criar(@Body() corpo: unknown) {
    return this.solicitacoes.criar(validarCorpo(novaSolicitacaoSchema, corpo));
  }

  @Post(':id/analise')
  @ExigePermissao(PERMISSOES.SOLICITACAO_APROVAR)
  @ApiOperation({
    summary: 'Aprova ou recusa solicitação que exige análise prévia',
    description: 'Decisão técnica (M10 seção 29) - recusar exige motivo.',
  })
  async analisar(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    const dados = validarCorpo(analiseSchema, corpo);
    await this.solicitacoes.analisar(id, dados.resultado, dados.motivo);
    return { ok: true };
  }

  @Post(':id/conclusao')
  @ExigePermissao(PERMISSOES.SOLICITACAO_EXECUTAR)
  @ApiOperation({
    summary: 'Conclui a execução',
    description:
      'Registra o resultado técnico - nunca a interpretação, que pertence ao módulo ' +
      'diagnóstico (M10 seções 3 e 26). Pendências vinculadas resolvem sozinhas (seção 93).',
  })
  async concluir(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    const dados = validarCorpo(conclusaoSolicitacaoSchema, corpo);
    await this.solicitacoes.concluir(id, dados.resultadoTecnico);
    return { ok: true };
  }

  @Post(':id/cancelamento')
  @ExigePermissao(PERMISSOES.SOLICITACAO_CANCELAR)
  @ApiOperation({ summary: 'Cancela solicitação aberta, com motivo obrigatório' })
  async cancelar(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    const dados = validarCorpo(cancelamentoSchema, corpo);
    await this.solicitacoes.cancelar(id, dados.motivo);
    return { ok: true };
  }

  @Get(':id/mensagens')
  @ExigePermissao(PERMISSOES.SOLICITACAO_VISUALIZAR)
  @ApiOperation({ summary: 'Conversa estruturada da solicitação (M10 seção 49)' })
  async mensagens(@Param('id', ParseUUIDPipe) id: string) {
    return this.solicitacoes.mensagens(id);
  }

  @Post(':id/mensagens')
  @ExigePermissao(PERMISSOES.SOLICITACAO_VISUALIZAR)
  @ApiOperation({
    summary: 'Comenta na solicitação',
    description:
      'A conversa fica anexa à demanda, nunca solta no caso - comentário livre como ' +
      'tarefa é o que o módulo quer eliminar (M10 seção 50).',
  })
  async comentar(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    const dados = validarCorpo(mensagemSchema, corpo);
    await this.solicitacoes.comentar(id, dados.texto);
    return { ok: true };
  }
}

// ---------------------------------------------------------------------------
// M07 - Rastreamento e Gestão de Fluxo
// ---------------------------------------------------------------------------

const transicaoSchema = z.object({
  etapa: z.enum(ETAPA),
  justificativa: z.string().min(1, 'Transição manual exige justificativa (M07).'),
});

@ApiTags('M07 - Rastreamento e Gestão de Fluxo')
@Controller('fluxo')
export class FluxoController {
  constructor(
    private readonly consulta: FluxoConsultaService,
    private readonly db: DbService,
  ) {}

  @Get('casos')
  @ExigePermissao(PERMISSOES.FLUXO_VISUALIZAR)
  @ApiOperation({
    summary: 'Central de casos',
    description: 'Filas por etapa, responsável e alerta de prazo.',
  })
  async listar(
    @Query('etapa') etapa?: string,
    @Query('minhaFila') minhaFila?: string,
    @Query('q') q?: string,
    @Query('ordem') ordem?: string,
  ) {
    return this.consulta.listar({
      // `etapa=a,b` lista varias etapas de uma vez (fila da macro).
      etapa: etapa ? (etapa.split(',').map((e) => e.trim()) as Etapa[]) : undefined,
      apenasMinhaFila: minhaFila === 'true',
      q,
      ordem: ordem === 'entrada' ? 'entrada' : 'previsao',
    });
  }

  @Post('casos/:casoId/transicao')
  @ExigePermissao(PERMISSOES.FLUXO_TRANSICAO_MANUAL)
  @ApiOperation({
    summary: 'Transição manual de etapa',
    description:
      'Exceção que exige permissão e justificativa. O caminho normal é o evento ' +
      'emitido pelo módulo responsável (M07).',
  })
  async transicao(
    @Param('casoId', ParseUUIDPipe) casoId: string,
    @Body() corpo: unknown,
  ) {
    const dados = validarCorpo(transicaoSchema, corpo);
    await this.db.executar((tx) =>
      this.consulta.transicaoManual(tx, casoId, dados.etapa, dados.justificativa),
    );
    return { ok: true };
  }
}


@ApiTags('M07 - Rastreamento e Gestão de Fluxo')
@Controller('painel')
export class PainelController {
  constructor(private readonly painel: PainelService) {}

  @Get()
  @ExigePermissao(PERMISSOES.FLUXO_VISUALIZAR)
  @ApiOperation({
    summary: 'Painel de chegada',
    description:
      'Volumetria do dia, o que exige atenção agora e o funil por etapa. ' +
      'Cada bloco respeita a permissão que permite agir sobre ele.',
  })
  async montar() {
    return this.painel.montar();
  }
}


// ---------------------------------------------------------------------------
// M19 - Logística
// ---------------------------------------------------------------------------

const solicitacaoLogisticaSchema = z.object({
  tipoServico: z.enum(TIPO_SERVICO_LOGISTICO),
  tipoOperacao: z.enum(TIPO_OPERACAO_LOGISTICA),
  canalOrigem: z.enum(CANAL_ORIGEM_LOGISTICO),
  clienteId: z.string().uuid(),
  unidadeId: z.string().uuid().nullish(),
  casoId: z.string().uuid().nullish(),
  /** Seção 13: sem endereço não existe operação - é para onde alguém vai. */
  endereco: z.string().min(1, 'Informe o endereço da operação.'),
  pontoReferencia: z.string().nullish(),
  latitude: z.string().nullish(),
  longitude: z.string().nullish(),
  contatoNoLocal: z.string().nullish(),
  telefoneContato: z.string().nullish(),
  dataDesejada: z.string().datetime().nullish(),
  janelaInicio: z.string().nullish(),
  janelaFim: z.string().nullish(),
  volumesEstimados: z.number().int().positive().nullish(),
  tipoMaterial: z.string().nullish(),
  conservacao: z.enum(CONSERVACAO_LOGISTICA).nullish(),
  requisitosEspeciais: z.array(z.enum(REQUISITO_ESPECIAL_LOGISTICO)).optional(),
  prioridade: z.enum(PRIORIDADE_LOGISTICA).optional(),
  observacoes: z.string().nullish(),
  /** Seção 148: valor APLICADO, não calculado - a regra é do M20. Em centavos. */
  valorCentavos: z.number().int().nonnegative().nullish(),
});

const ofertaSchema = z.object({
  encarregadoIds: z.array(z.string().uuid()).min(1, 'Escolha ao menos um encarregado.'),
  minutosValidade: z.number().int().positive().max(1440).optional(),
});

@ApiTags('M19 - Logística')
@Controller('logistica')
export class LogisticaController {
  constructor(private readonly logistica: LogisticaService) {}

  @Get('solicitacoes')
  @ExigePermissao(PERMISSOES.LOGISTICA_VISUALIZAR)
  @ApiOperation({
    summary: 'Fila logística',
    description:
      'Com `minhasOfertas=true` devolve a caixa do encarregado: o que foi ofertado ' +
      'a ele e ainda está aberto, mais o que ele já assumiu.',
  })
  async listar(
    @Query('status') status?: string,
    @Query('abertas') abertas?: string,
    @Query('minhasOfertas') minhasOfertas?: string,
  ) {
    return this.logistica.listar({
      status: status as StatusSolicitacaoLogistica | undefined,
      apenasAbertas: abertas === 'true',
      minhasOfertas: minhasOfertas === 'true',
    });
  }

  @Get('solicitacoes/:id')
  @ExigePermissao(PERMISSOES.LOGISTICA_VISUALIZAR)
  @ApiOperation({
    summary: 'Ficha da operação, com ofertas e linha do tempo',
    description: 'A tradução para o status externo do Portal sai daqui (M19 §27).',
  })
  async ficha(@Param('id', ParseUUIDPipe) id: string) {
    return this.logistica.ficha(id);
  }

  @Post('solicitacoes')
  @ExigePermissao(PERMISSOES.LOGISTICA_SOLICITAR)
  @ApiOperation({
    summary: 'Abre uma solicitação de retirada ou entrega',
    description:
      'Qualquer que seja o canal de origem, o pedido vira UM registro no LAPATO ' +
      '(M19 §4). O número é único e acompanha a operação até o encerramento.',
  })
  async criar(@Body() corpo: unknown) {
    return this.logistica.criar(validarCorpo(solicitacaoLogisticaSchema, corpo));
  }

  @Post('solicitacoes/:id/oferta')
  @ExigePermissao(PERMISSOES.LOGISTICA_OFERTAR)
  @ApiOperation({
    summary: 'Oferta o serviço a vários encarregados de uma vez',
    description:
      'O primeiro aceite válido leva (M19 §144). O envio da mensagem é do M26; ' +
      'aqui se publica o evento.',
  })
  async ofertar(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    const dados = validarCorpo(ofertaSchema, corpo);
    return this.logistica.ofertar(id, dados.encarregadoIds, dados.minutosValidade);
  }

  @Post('solicitacoes/:id/aceite')
  @ExigePermissao(PERMISSOES.LOGISTICA_EXECUTAR)
  @ApiOperation({
    summary: 'Aceita o serviço ofertado',
    description:
      'Aceite competitivo e transacional: dois encarregados clicando ao mesmo ' +
      'tempo disputam a mesma linha, e o segundo recebe "já assumida por outro" ' +
      'em vez de erro (M19 §144-145).',
  })
  async aceitar(@Param('id', ParseUUIDPipe) id: string) {
    return this.logistica.aceitar(id);
  }

  @Post('solicitacoes/:id/recusa')
  @ExigePermissao(PERMISSOES.LOGISTICA_EXECUTAR)
  @ApiOperation({
    summary: 'Recusa a oferta',
    description: 'Não impede os demais encarregados de aceitar (M19 §147).',
  })
  async recusar(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    const dados = validarCorpo(z.object({ motivo: z.string().optional() }), corpo);
    await this.logistica.recusar(id, dados.motivo);
    return { ok: true };
  }

  @Post('solicitacoes/:id/cancelamento')
  @ExigePermissao(PERMISSOES.LOGISTICA_CANCELAR)
  @ApiOperation({
    summary: 'Cancela a operação',
    description: 'Exige motivo: §86 registra quem pediu, por quê, quando.',
  })
  async cancelar(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    const dados = validarCorpo(
      z.object({ motivo: z.string().min(1, 'O cancelamento exige motivo (M19 §86).') }),
      corpo,
    );
    await this.logistica.cancelar(id, dados.motivo);
    return { ok: true };
  }
}


// ---------------------------------------------------------------------------
// M12 - Citopatologia
// ---------------------------------------------------------------------------

/**
 * Os campos livres continuam livres de proposito.
 *
 * M12 secao 73 proibe o "diagnostico por cliques" e a secao 142 diz que campos
 * estruturados nao substituem a descricao profissional. O schema valida FORMA -
 * os enums fechados sao escalas, e escala com valor inventado nao e mais
 * escala; as listas de vocabulario ficam abertas porque a instituicao vai
 * acrescentar as suas.
 */
const avaliacaoCitologicaSchema = z.object({
  tipoColeta: z.string().nullish(),
  sitio: z.string().nullish(),
  numeroLaminas: z.number().int().positive().nullish(),
  coloracoes: z.array(z.string()).optional(),
  adequacao: z.enum(ADEQUACAO_CITOLOGICA).nullish(),
  motivosLimitacao: z.array(z.string()).optional(),
  celularidade: z.enum(CELULARIDADE).nullish(),
  preservacao: z.enum(PRESERVACAO_CELULAR).nullish(),
  fundo: z.array(z.string()).optional(),
  hemorragia: z.enum(INTENSIDADE).nullish(),
  achadosHemorragia: z.array(z.string()).optional(),
  necrose: z.enum(INTENSIDADE).nullish(),
  materialExtracelular: z.array(z.string()).optional(),
  populacoes: z.array(z.record(z.unknown())).optional(),
  criteriosMalignidade: z.record(z.string()).optional(),
  mitoses: z.string().nullish(),
  inflamacao: z.record(z.unknown()).nullish(),
  agentes: z.array(z.record(z.unknown())).optional(),
  descricaoCitologica: z.string().nullish(),
  interpretacao: z.string().nullish(),
  grauCerteza: z.enum(GRAU_CERTEZA).nullish(),
  limitacoes: z.array(z.string()).optional(),
  recomendacoes: z.string().nullish(),
});

@ApiTags('M12 - Citopatologia')
@Controller('citologia')
export class CitopatologiaController {
  constructor(private readonly citopatologia: CitopatologiaService) {}

  @Get('vocabulario')
  @ExigePermissao(PERMISSOES.LAUDO_VISUALIZAR)
  @ApiOperation({
    summary: 'Vocabulário estruturado da citologia',
    description:
      'Tipos de coleta, adequação, celularidade, fundo, populações, critérios de ' +
      'malignidade, inflamação e agentes (M12 seção 3).',
  })
  vocabulario() {
    return this.citopatologia.vocabulario();
  }

  @Get('versoes/:versaoId')
  @ExigePermissao(PERMISSOES.LAUDO_VISUALIZAR)
  @ApiOperation({
    summary: 'Avaliações citológicas da versão, com as amostras do caso',
    description:
      'As amostras vêm juntas para que a tela mostre também as que ainda não ' +
      'foram avaliadas (M12 seção 142).',
  })
  async listar(@Param('versaoId', ParseUUIDPipe) versaoId: string) {
    return this.citopatologia.listarPorVersao(versaoId);
  }

  @Post('versoes/:versaoId/amostras/:amostraId')
  @ExigePermissao(PERMISSOES.LAUDO_EDITAR)
  @ApiOperation({
    summary: 'Grava a avaliação citológica de uma amostra',
    description:
      'Uma amostra por chamada: cada material aspirado tem interpretação ' +
      'independente dentro do mesmo caso (M12 seção 115).',
  })
  async salvar(
    @Param('versaoId', ParseUUIDPipe) versaoId: string,
    @Param('amostraId', ParseUUIDPipe) amostraId: string,
    @Body() corpo: unknown,
  ) {
    await this.citopatologia.salvar(
      versaoId,
      amostraId,
      validarCorpo(avaliacaoCitologicaSchema, corpo),
    );
    return { ok: true };
  }
}


// ---------------------------------------------------------------------------
// M16 - Imagens e Gestão do Acervo Digital
// ---------------------------------------------------------------------------

/**
 * Os campos chegam como texto porque a requisição é multipart - o corpo vem ao
 * lado do arquivo, não em JSON. `metadados` viaja como JSON serializado.
 */
const novaImagemSchema = z.object({
  tipo: z.enum(TIPO_IMAGEM),
  origem: z.enum(ORIGEM_IMAGEM).optional(),
  moduloContexto: z.string().min(1),
  objetoTipo: z.string().optional(),
  objetoId: z.string().uuid().optional(),
  legenda: z.string().optional(),
  descricao: z.string().optional(),
  capturadaEm: z.string().optional(),
  /** JSON serializado: multipart não carrega objeto aninhado. */
  metadados: z.string().optional(),
});

const edicaoImagemSchema = z.object({
  legenda: z.string().optional(),
  descricao: z.string().optional(),
  metadados: z.record(z.unknown()).optional(),
  autorizadaEnsino: z.boolean().optional(),
  autorizadaPesquisa: z.boolean().optional(),
  autorizadaTreinamentoIa: z.boolean().optional(),
});

@ApiTags('M16 - Imagens')
@Controller('imagens')
export class ImagensController {
  constructor(private readonly imagens: ImagensService) {}

  @Get('casos/:casoId')
  @ExigePermissao(PERMISSOES.IMAGEM_VISUALIZAR)
  @ApiOperation({
    summary: 'Galeria do caso',
    description:
      'Acervo único: as imagens de todas as etapas num só lugar, separadas por ' +
      'contexto e origem (M16 seções 6 e 57). Inativadas ficam de fora por padrão.',
  })
  async galeria(
    @Param('casoId', ParseUUIDPipe) casoId: string,
    @Query('inativadas') inativadas?: string,
  ) {
    return this.imagens.listarPorCaso(casoId, inativadas === 'sim');
  }

  @Post('casos/:casoId')
  @ExigePermissao(PERMISSOES.IMAGEM_ENVIAR)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'arquivo', maxCount: 1 },
        { name: 'miniatura', maxCount: 1 },
      ],
      /**
       * O limite precisa estar AQUI, e nao so no servico.
       *
       * O multer guarda o arquivo em memoria antes de o handler existir: sem
       * `limits`, um envio de alguns GB e integralmente bufferizado e so entao
       * recusado por tamanho - o processo pode morrer por falta de memoria
       * antes de chegar a checagem. Com `limits`, o multer aborta durante o
       * stream. A checagem do servico continua valendo: ela e a regra de
       * negocio, esta e a defesa do processo.
       */
      { limits: { fileSize: TAMANHO_MAXIMO, files: 2, fields: 20 } },
    ),
  )
  @ApiOperation({
    summary: 'Envia uma imagem para o acervo do caso',
    description:
      'O original é preservado e nunca sobrescrito (M16 §22). A miniatura é ' +
      'opcional: sem ela, a galeria carrega o original.',
  })
  async enviar(
    @Param('casoId', ParseUUIDPipe) casoId: string,
    @UploadedFiles()
    arquivos: { arquivo?: ArquivoRecebido[]; miniatura?: ArquivoRecebido[] },
    @Body() corpo: unknown,
  ) {
    const arquivo = arquivos?.arquivo?.[0];
    if (!arquivo) throw new BadRequestException('Envie o arquivo da imagem.');

    const dados = validarCorpo(novaImagemSchema, corpo);

    let metadados: Record<string, unknown> | undefined;
    if (dados.metadados) {
      try {
        metadados = JSON.parse(dados.metadados) as Record<string, unknown>;
      } catch {
        throw new BadRequestException('O campo metadados não é um JSON válido.');
      }
    }

    return this.imagens.enviar(
      casoId,
      arquivo,
      { ...dados, metadados },
      arquivos.miniatura?.[0],
    );
  }

  @Get(':id/arquivo')
  @ExigePermissao(PERMISSOES.IMAGEM_VISUALIZAR)
  @ApiOperation({
    summary: 'Bytes da imagem',
    description:
      'O bucket é privado: o arquivo sai por aqui, depois da checagem de ' +
      'permissão, e nunca por URL pública. `?tamanho=miniatura` serve a galeria.',
  })
  async arquivo(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('tamanho') tamanho?: string,
  ) {
    const { bytes, mimeType, nomeArquivo } = await this.imagens.baixar(
      id,
      tamanho === 'miniatura' ? 'miniatura' : 'original',
    );
    return new StreamableFile(bytes, {
      type: mimeType,
      disposition: `inline; filename="${nomeParaCabecalho(nomeArquivo)}"`,
    });
  }

  @Post(':id')
  @ExigePermissao(PERMISSOES.IMAGEM_EDITAR)
  @ApiOperation({
    summary: 'Legenda, metadados e autorizações de uso',
    description:
      'Ensino, pesquisa e treinamento de IA são autorizações explícitas: ' +
      'armazenar a imagem não autoriza nenhum deles (M16 §§44-47).',
  })
  async editar(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    await this.imagens.editar(id, validarCorpo(edicaoImagemSchema, corpo));
    return { ok: true };
  }

  @Post(':id/inativacao')
  @ExigePermissao(PERMISSOES.IMAGEM_EDITAR)
  @ApiOperation({
    summary: 'Inativa a imagem',
    description:
      'M16 §69: imagem errada é inativada com motivo, não apagada — o histórico fica.',
  })
  async inativar(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    const dados = validarCorpo(
      z.object({ motivo: z.string().min(1, 'Inativar uma imagem exige o motivo.') }),
      corpo,
    );
    await this.imagens.inativar(id, dados.motivo);
    return { ok: true };
  }

  @Post(':id/laudo')
  @ExigePermissao(PERMISSOES.IMAGEM_EDITAR)
  @ApiOperation({
    summary: 'Inclui ou retira a imagem do laudo',
    description:
      'Marcação com ordem; a numeração do documento ("Imagem 01") deriva dela ' +
      'e muda sozinha quando a ordem muda (M16 §§36-39). O arquivo não é tocado.',
  })
  async selecionar(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    const dados = validarCorpo(z.object({ incluir: z.boolean() }), corpo);
    await this.imagens.selecionarParaLaudo(id, dados.incluir);
    return { ok: true };
  }

  @Post('casos/:casoId/ordem')
  @ExigePermissao(PERMISSOES.IMAGEM_EDITAR)
  @ApiOperation({ summary: 'Reordena as imagens selecionadas para o laudo' })
  async reordenar(
    @Param('casoId', ParseUUIDPipe) casoId: string,
    @Body() corpo: unknown,
  ) {
    const dados = validarCorpo(z.object({ ordem: z.array(z.string().uuid()) }), corpo);
    await this.imagens.reordenarNoLaudo(casoId, dados.ordem);
    return { ok: true };
  }
}


// ---------------------------------------------------------------------------
// M04 - Portal do Cliente
// ---------------------------------------------------------------------------

/**
 * Nenhuma rota daqui recebe `clienteId`.
 *
 * M04 seção 5: o isolamento não é visual, é de dados — e um identificador que
 * viaja no request seria a escolha de quem o usuário quer ser. O escopo vem da
 * conta, resolvido no servidor, do mesmo jeito que o tenant (ADR 0002).
 */
@ApiTags('M04 - Portal do Cliente')
@Controller('portal')
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Get('painel')
  @ExigePermissao(PERMISSOES.PORTAL_ACESSAR)
  @ApiOperation({
    summary: 'Painel do cliente',
    description:
      'Exames em andamento, laudos liberados, pendências que aguardam o cliente ' +
      'e solicitações abertas (M04 §9).',
  })
  async painel() {
    return this.portal.painel();
  }

  @Get('exames')
  @ExigePermissao(PERMISSOES.PORTAL_ACESSAR)
  @ApiOperation({
    summary: 'Exames do cliente',
    description:
      'Busca por paciente, tutor ou registro — os três jeitos pelos quais o ' +
      'cliente lembra do exame. Status já traduzidos para o vocabulário externo (§12).',
  })
  async exames(@Query('q') q?: string, @Query('situacao') situacao?: string) {
    return this.portal.exames({
      q,
      situacao:
        situacao === 'andamento' || situacao === 'liberados' ? situacao : 'todos',
    });
  }

  @Get('exames/:casoId')
  @ExigePermissao(PERMISSOES.PORTAL_ACESSAR)
  @ApiOperation({
    summary: 'Dossiê externo do exame',
    description:
      'A versão do caso que o cliente pode ver (§18): situação, previsão, histórico ' +
      'enviado, pendências visíveis, linha do tempo traduzida e laudo, quando liberado.',
  })
  async exame(@Param('casoId', ParseUUIDPipe) casoId: string) {
    return this.portal.exame(casoId);
  }

  @Post('exames/:casoId/historico')
  @ExigePermissao(PERMISSOES.PORTAL_HISTORICO_COMPLEMENTAR)
  @ApiOperation({
    summary: 'Acrescenta informação clínica ao caso',
    description:
      'Acrescenta, nunca substitui (§§23-24): o patologista precisa reconstruir ' +
      'a sequência do que soube e quando.',
  })
  async complementar(
    @Param('casoId', ParseUUIDPipe) casoId: string,
    @Body() corpo: unknown,
  ) {
    const dados = validarCorpo(
      z.object({ texto: z.string().min(1, 'Escreva a informação a acrescentar.') }),
      corpo,
    );
    await this.portal.complementarHistorico(casoId, dados.texto);
    return { ok: true };
  }

  @Get('solicitacoes')
  @ExigePermissao(PERMISSOES.PORTAL_ACESSAR)
  @ApiOperation({ summary: 'Solicitações do cliente e seu andamento (§31)' })
  async solicitacoes() {
    return this.portal.solicitacoes();
  }

  @Get('laudos/:versaoId/pdf')
  @ExigePermissao(PERMISSOES.PORTAL_LAUDO_BAIXAR)
  @Header('Content-Type', 'application/pdf')
  @ApiOperation({
    summary: 'PDF do laudo liberado',
    description:
      'Só versão assinada de laudo liberado (§20). Rascunho, versão interna e ' +
      'documento não assinado não existem deste lado. O acesso fica registrado (§22).',
  })
  async laudo(@Param('versaoId', ParseUUIDPipe) versaoId: string) {
    const { bytes, nomeArquivo } = await this.portal.baixarLaudo(versaoId);
    return new StreamableFile(bytes, {
      disposition: `inline; filename="${nomeParaCabecalho(nomeArquivo)}"`,
    });
  }
}

// ---------------------------------------------------------------------------
// M15 - Controle de Cadáveres
// ---------------------------------------------------------------------------

/**
 * §6: a entrada provisória exige o mínimo que impede a perda de identidade —
 * espécie, origem, quem recebeu. O caso pode faltar; a espécie não.
 */
const recebimentoCadaverSchema = z.object({
  casoId: z.string().uuid().nullish(),
  especie: z.string().min(1, 'Informe a espécie.'),
  nomeAnimal: z.string().nullish(),
  sexo: z.string().nullish(),
  raca: z.string().nullish(),
  pelagem: z.string().nullish(),
  microchip: z.string().nullish(),
  origemResponsavel: z.string().nullish(),
  obitoEm: z.string().datetime({ offset: true }).nullish(),
  conservacaoRecebimento: z.enum(CONSERVACAO_CADAVER).nullish(),
  embalagem: z.enum(EMBALAGEM_CADAVER).nullish(),
  integridade: z.enum(INTEGRIDADE_CADAVER).nullish(),
  identificacaoExterna: z.enum(IDENTIFICACAO_EXTERNA).nullish(),
  observacoesRecebimento: z.string().nullish(),
  prazoGuardaDias: z.number().int().positive().nullish(),
});

const armazenamentoSchema = z.object({
  localId: z.string().uuid(),
  conservacao: z.enum(CONSERVACAO_CADAVER).nullish(),
  observacao: z.string().nullish(),
});

const bloqueioSchema = z.object({
  tipo: z.enum(TIPO_BLOQUEIO_CADAVER),
  motivo: z.string().min(5, 'Diga por que o cadáver está bloqueado.'),
});

const destinacaoSchema = z.object({
  destinacao: z.enum(DESTINACAO_CADAVER),
  justificativa: z.string().nullish(),
});

/** §44: a entrega identifica quem levou. Sem nome não há entrega registrada. */
const entregaSchema = z.object({
  nome: z.string().min(3, 'Informe quem está retirando.'),
  documento: z.string().nullish(),
  vinculo: z.string().nullish(),
  empresa: z.string().nullish(),
});

@ApiTags('M15 - Controle de Cadáveres')
@Controller('cadaveres')
export class CadaveresController {
  constructor(private readonly cadaveres: CadaveresService) {}

  @Get()
  @ExigePermissao(PERMISSOES.CADAVER_VISUALIZAR)
  @ApiOperation({
    summary: 'Painel operacional',
    description:
      'Quem está sob responsabilidade do laboratório, onde, há quanto tempo e com ' +
      'que pendências (§37). Busca por identificador, nome ou microchip (§39).',
  })
  async listar(@Query('status') status?: string, @Query('q') busca?: string) {
    return this.cadaveres.listar({
      status: status ? (status as StatusCadaver) : undefined,
      busca,
    });
  }

  @Get('mapa')
  @ExigePermissao(PERMISSOES.CADAVER_VISUALIZAR)
  @ApiOperation({
    summary: 'Mapa de armazenamento',
    description:
      'Posições e quem ocupa cada uma (§19), mais quem está fora do armazenamento — ' +
      'porque nenhum cadáver desaparece do mapa quando é retirado (§29).',
  })
  async mapa() {
    return this.cadaveres.mapa();
  }

  @Get('conferencia')
  @ExigePermissao(PERMISSOES.CADAVER_VISUALIZAR)
  @ApiOperation({
    summary: 'Conferências do Guardian sobre o acervo',
    description:
      'Incoerências que já existem (§70): retirado ocupando posição, sem localização, ' +
      'liberado sem destinação, liberado apesar de bloqueio. Não barra nada — é trabalho pendente.',
  })
  async conferencia() {
    return this.cadaveres.conferencia();
  }

  @Get(':id')
  @ExigePermissao(PERMISSOES.CADAVER_VISUALIZAR)
  @ApiOperation({
    summary: 'Ficha operacional',
    description: 'O que o QR Code abre (§10): identidade, localização, histórico e bloqueios.',
  })
  async ficha(@Param('id', ParseUUIDPipe) id: string) {
    return this.cadaveres.ficha(id);
  }

  @Post()
  @ExigePermissao(PERMISSOES.CADAVER_RECEBER)
  @ApiOperation({
    summary: 'Registra a entrada física',
    description:
      'O caso é opcional (§5): um corpo pode chegar antes do cadastro administrativo, ' +
      'e recusá-lo aqui significaria um corpo sem registro nenhum na câmara.',
  })
  async receber(@Body() corpo: unknown) {
    return this.cadaveres.receber(validarCorpo(recebimentoCadaverSchema, corpo));
  }

  @Post(':id/vinculo')
  @ExigePermissao(PERMISSOES.CADAVER_RECEBER)
  @ApiOperation({ summary: 'Reconcilia a entrada provisória com o caso definitivo (§5)' })
  async vincular(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    const dados = validarCorpo(z.object({ casoId: z.string().uuid() }), corpo);
    await this.cadaveres.vincularAoCaso(id, dados.casoId);
  }

  @Post(':id/armazenamento')
  @ExigePermissao(PERMISSOES.CADAVER_MOVIMENTAR)
  @ApiOperation({
    summary: 'Armazena ou transfere de posição',
    description: 'Posição ocupada recusa a movimentação (§25) — é assim que a identidade se perde.',
  })
  async armazenar(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    await this.cadaveres.armazenar(id, validarCorpo(armazenamentoSchema, corpo));
  }

  @Post(':id/retirada-necropsia')
  @ExigePermissao(PERMISSOES.CADAVER_MOVIMENTAR)
  @ApiOperation({
    summary: 'Retira para necropsia',
    description: 'A posição fica livre, mas o cadáver continua no mapa, marcado como fora (§29).',
  })
  async retirarParaNecropsia(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    const dados = validarCorpo(z.object({ motivo: z.string().nullish() }), corpo ?? {});
    await this.cadaveres.retirarParaNecropsia(id, dados.motivo ?? undefined);
  }

  @Post(':id/bloqueios')
  @ExigePermissao(PERMISSOES.CADAVER_BLOQUEAR)
  @ApiOperation({
    summary: 'Bloqueia a saída',
    description: 'Não muda onde o corpo está: impede que ele saia (§31).',
  })
  async bloquear(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    return this.cadaveres.bloquear(id, validarCorpo(bloqueioSchema, corpo));
  }

  @Post('bloqueios/:bloqueioId/resolucao')
  @ExigePermissao(PERMISSOES.CADAVER_LIBERAR)
  @ApiOperation({
    summary: 'Resolve um bloqueio',
    description: 'Exige justificativa — o bloqueio existia por uma razão (§88).',
  })
  async resolverBloqueio(
    @Param('bloqueioId', ParseUUIDPipe) bloqueioId: string,
    @Body() corpo: unknown,
  ) {
    const dados = validarCorpo(
      z.object({ justificativa: z.string().min(5, 'Diga como o bloqueio foi resolvido.') }),
      corpo,
    );
    await this.cadaveres.resolverBloqueio(bloqueioId, dados.justificativa);
  }

  @Post(':id/destinacao')
  @ExigePermissao(PERMISSOES.CADAVER_LIBERAR)
  @ApiOperation({
    summary: 'Define ou altera a destinação autorizada',
    description: 'Alterar preserva a escolha anterior no histórico — nunca sobrescreve (§41).',
  })
  async definirDestinacao(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    await this.cadaveres.definirDestinacao(id, validarCorpo(destinacaoSchema, corpo));
  }

  @Post(':id/liberacao')
  @ExigePermissao(PERMISSOES.CADAVER_LIBERAR)
  @ApiOperation({
    summary: 'Liberação técnica',
    description:
      'Diz que o corpo PODE ser entregue; ele continua no laboratório (§43). ' +
      'Bloqueio ativo impede — e não se contorna mudando o status na mão (§32).',
  })
  async liberar(@Param('id', ParseUUIDPipe) id: string) {
    await this.cadaveres.liberar(id);
  }

  @Post(':id/entrega')
  @ExigePermissao(PERMISSOES.CADAVER_ENTREGAR)
  @ApiOperation({
    summary: 'Registra a saída física',
    description: 'É aqui que a posição volta a ficar livre no mapa (§§49 e 88).',
  })
  async registrarEntrega(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    await this.cadaveres.registrarEntrega(id, validarCorpo(entregaSchema, corpo));
  }

  @Post(':id/destinacao/confirmacao')
  @ExigePermissao(PERMISSOES.CADAVER_ENTREGAR)
  @ApiOperation({
    summary: 'Confirma a destinação e encerra fisicamente',
    description: 'Destinação não é exclusão: o registro permanece inteiro (§50).',
  })
  async confirmarDestinacao(@Param('id', ParseUUIDPipe) id: string) {
    await this.cadaveres.confirmarDestinacao(id);
  }
}

// ---------------------------------------------------------------------------
// M14 - Necropsia
// ---------------------------------------------------------------------------

/**
 * §4: a necropsia não exige médico-veterinário solicitante — pode ser pedida
 * pelo tutor, por seguradora ou por autoridade. Mas §163 é firme: "deverá
 * existir responsável pela solicitação".
 */
const aberturaNecropsiaSchema = z.object({
  modalidade: z.enum(MODALIDADE_NECROPSIA).optional(),
  responsavelSolicitacao: z.string().min(3, 'Informe quem solicitou a necropsia.'),
  contatoResponsavel: z.string().nullish(),
  cadaverId: z.string().uuid().nullish(),
  conservacao: z.enum(CONSERVACAO_NECROPSIA).nullish(),
  obitoEm: z.string().datetime({ offset: true }).nullish(),
  circunstanciasMorte: z.string().nullish(),
  perguntasSolicitante: z.string().nullish(),
});

const exameExternoSchema = z.object({
  exameExterno: z.record(z.unknown()).optional(),
  limitacoes: z.array(z.enum(LIMITACAO_NECROPSIA)).optional(),
  limitacoesObservacao: z.string().nullish(),
  conservacao: z.enum(CONSERVACAO_NECROPSIA).nullish(),
  circunstanciasMorte: z.string().nullish(),
  perguntasSolicitante: z.string().nullish(),
});

const orgaoSchema = z.object({
  cavidade: z.enum(CAVIDADE_NECROPSIA),
  sistema: z.string().nullish(),
  orgao: z.string().min(1, 'Informe o órgão.'),
  estado: z.enum(ESTADO_EXAME_ORGAO),
  descricao: z.string().nullish(),
  pesoGramas: z.number().int().positive().nullish(),
});

const lesaoSchema = z.object({
  orgao: z.string().min(1, 'Informe o órgão.'),
  descricao: z.string().min(3, 'Descreva a alteração.'),
  localizacao: z.string().nullish(),
  distribuicao: z.string().nullish(),
  dimensao: z.string().nullish(),
  diagnosticoMorfologico: z.string().nullish(),
  classificacao: z.enum(CLASSIFICACAO_LESAO).nullish(),
  impressaoMacroscopica: z.string().nullish(),
  observacoes: z.string().nullish(),
});

const relacaoSchema = z.object({
  origemId: z.string().uuid(),
  destinoId: z.string().uuid(),
  tipo: z.enum(RELACAO_LESAO).optional(),
  observacao: z.string().nullish(),
});

/**
 * §111: `indeterminada` é resposta válida, não pendência. O schema aceita todos
 * os campos vazios com grau indeterminado — é a conclusão cientificamente
 * adequada em muitos casos.
 */
const causaMortisSchema = z.object({
  causaImediata: z.string().nullish(),
  condicaoAntecedente: z.string().nullish(),
  causaBasica: z.string().nullish(),
  condicoesContribuintes: z.string().nullish(),
  mecanismoTerminal: z.enum(MECANISMO_TERMINAL).nullish(),
  grauCerteza: z.enum(GRAU_CERTEZA_CAUSA),
  diagnosticosDiferenciais: z.array(z.string()).optional(),
  conclusao: z.string().nullish(),
});

@ApiTags('M14 - Necropsia')
@Controller('necropsia')
export class NecropsiaController {
  constructor(private readonly necropsia: NecropsiaService) {}

  @Get('casos/:casoId')
  @ExigePermissao(PERMISSOES.NECROPSIA_VISUALIZAR)
  @ApiOperation({
    summary: 'A bancada inteira do caso',
    description:
      'Exame externo, órgãos, lesões, relações causais e causa mortis. Traz também o ' +
      'checklist de completude (§72): quantos órgãos ficaram sem exame.',
  })
  async porCaso(@Param('casoId', ParseUUIDPipe) casoId: string) {
    return this.necropsia.porCaso(casoId);
  }

  @Post('casos/:casoId')
  @ExigePermissao(PERMISSOES.NECROPSIA_EXECUTAR)
  @ApiOperation({
    summary: 'Abre a necropsia do caso',
    description:
      'O veterinário solicitante é opcional (§4); o responsável pela solicitação, não — ' +
      'a necropsia pode ser pedida pelo tutor, por seguradora ou por autoridade.',
  })
  async abrir(@Param('casoId', ParseUUIDPipe) casoId: string, @Body() corpo: unknown) {
    return this.necropsia.abrir(casoId, validarCorpo(aberturaNecropsiaSchema, corpo));
  }

  @Post(':id/exame-externo')
  @ExigePermissao(PERMISSOES.NECROPSIA_EXECUTAR)
  @ApiOperation({ summary: 'Salva exame externo, conservação e limitações (§§57 e 119)' })
  async salvarExameExterno(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    await this.necropsia.salvarExameExterno(id, validarCorpo(exameExternoSchema, corpo));
  }

  @Post(':id/orgaos')
  @ExigePermissao(PERMISSOES.NECROPSIA_EXECUTAR)
  @ApiOperation({
    summary: 'Registra o exame de um órgão',
    description:
      '“Não examinado” é diferente de “sem alterações” (§163) — e órgão não examinado ' +
      'com descrição é recusado, porque as duas afirmações não convivem.',
  })
  async registrarOrgao(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    await this.necropsia.registrarOrgao(id, validarCorpo(orgaoSchema, corpo));
  }

  @Post(':id/lesoes')
  @ExigePermissao(PERMISSOES.NECROPSIA_EXECUTAR)
  @ApiOperation({
    summary: 'Cria um Objeto Lesão',
    description: 'Registro individual (L01, L02…), o que permite ligá-lo a outras lesões (§73).',
  })
  async criarLesao(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    return this.necropsia.criarLesao(id, validarCorpo(lesaoSchema, corpo));
  }

  @Post('lesoes/:lesaoId')
  @ExigePermissao(PERMISSOES.NECROPSIA_EXECUTAR)
  @ApiOperation({
    summary: 'Edita a lesão, inclusive a classificação funcional',
    description:
      'Processo principal, secundário, contribuinte, incidental, post mortem ou artefato ' +
      '(§75) — a separação que evita que todo achado seja lido como causal (§97).',
  })
  async editarLesao(@Param('lesaoId', ParseUUIDPipe) lesaoId: string, @Body() corpo: unknown) {
    await this.necropsia.editarLesao(lesaoId, validarCorpo(lesaoSchema.partial(), corpo));
  }

  @Post(':id/relacoes')
  @ExigePermissao(PERMISSOES.NECROPSIA_EXECUTAR)
  @ApiOperation({
    summary: 'Liga duas lesões',
    description:
      'Ruptura esplênica → hemoperitônio → hipovolemia → choque (§76). É o mapa ' +
      'fisiopatológico, e o que separa uma lista de achados de um raciocínio sobre a morte.',
  })
  async relacionar(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    await this.necropsia.relacionar(id, validarCorpo(relacaoSchema, corpo));
  }

  @Post('relacoes/:relacaoId/remocao')
  @ExigePermissao(PERMISSOES.NECROPSIA_EXECUTAR)
  @ApiOperation({ summary: 'Desfaz uma relação entre lesões' })
  async removerRelacao(@Param('relacaoId', ParseUUIDPipe) relacaoId: string) {
    await this.necropsia.removerRelacao(relacaoId);
  }

  @Post(':id/causa-mortis')
  @ExigePermissao(PERMISSOES.NECROPSIA_CONCLUIR)
  @ApiOperation({
    summary: 'Salva a causa mortis',
    description:
      'Imediata, antecedente, básica e contribuintes (§109), com o mecanismo terminal em ' +
      'campo próprio — mecanismo não é causa (§108). Indeterminada é resposta válida (§111).',
  })
  async salvarCausaMortis(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    await this.necropsia.salvarCausaMortis(id, validarCorpo(causaMortisSchema, corpo));
  }

  @Get(':id/conferencia')
  @ExigePermissao(PERMISSOES.NECROPSIA_VISUALIZAR)
  @ApiOperation({
    summary: 'Conferências do Guardian antes de concluir',
    description: 'Causalidade, evidência insuficiente e coerência (§§116-118), sem barrar nada.',
  })
  async conferir(@Param('id', ParseUUIDPipe) id: string) {
    return this.necropsia.conferir(id);
  }

  @Post(':id/conclusao')
  @ExigePermissao(PERMISSOES.NECROPSIA_CONCLUIR)
  @ApiOperation({
    summary: 'Conclui o exame necroscópico',
    description:
      'Roda a checagem consolidada do Guardian. Achado crítico barra: a conclusão é o que ' +
      'o laudo vai afirmar sobre por que o animal morreu.',
  })
  async concluir(@Param('id', ParseUUIDPipe) id: string) {
    await this.necropsia.concluir(id);
  }

  @Post(':id/reabertura')
  @ExigePermissao(PERMISSOES.NECROPSIA_CONCLUIR)
  @ApiOperation({ summary: 'Reabre a necropsia concluída para correção' })
  async reabrir(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    const dados = validarCorpo(
      z.object({ motivo: z.string().min(5, 'Diga por que o exame volta para correção.') }),
      corpo,
    );
    await this.necropsia.reabrir(id, dados.motivo);
  }
}

// --- M18 Bioteca e Gestão de Acervo Biológico -------------------------------

const arquivamentoSchema = z.object({
  tipo: z.enum(TIPO_OBJETO_BIOLOGICO),
  descricao: z.string().nullish(),
  casoId: z.string().uuid().nullish(),
  amostraId: z.string().uuid().nullish(),
  blocoId: z.string().uuid().nullish(),
  laminaId: z.string().uuid().nullish(),
  objetoPaiId: z.string().uuid().nullish(),
  orgao: z.string().nullish(),
  localId: z.string().uuid().nullish(),
  quantidade: z.number().int().min(1).nullish(),
  recipiente: z.string().nullish(),
  fixador: z.string().nullish(),
  temperaturaPrevista: z.string().nullish(),
  restricoes: z.array(z.enum(RESTRICAO_OBJETO)).nullish(),
  preservacaoEspecial: z.boolean().nullish(),
  retencaoMeses: z.number().int().min(0).nullish(),
  condicao: z.enum(CONDICAO_OBJETO).nullish(),
});

/** §30: toda retirada exige responsável e finalidade — o destino diz onde procurar. */
const retiradaSchema = z.object({
  finalidade: z.enum(FINALIDADE_USO),
  destino: z.string().min(2, 'Informe para onde o material está indo.'),
  previsaoDevolucao: z.string().nullish(),
  observacao: z.string().nullish(),
});

const emprestimoSchema = z.object({
  tipo: z.enum(TIPO_EMPRESTIMO),
  finalidade: z.enum(FINALIDADE_USO),
  destinatario: z.string().min(3, 'Informe quem fica responsável pelo material.'),
  contatoDestinatario: z.string().nullish(),
  unidadeDestinoId: z.string().uuid().nullish(),
  /** §38: sem prazo não há alerta de vencimento nem material atrasado. */
  prazoDevolucao: z.string().min(10, 'Empréstimo sem prazo de devolução não é permitido.'),
  condicoes: z.string().nullish(),
  observacoes: z.string().nullish(),
  objetoIds: z.array(z.string().uuid()).min(1, 'Selecione ao menos um material.'),
});

@ApiTags('M18 - Bioteca')
@Controller('bioteca')
export class BiotecaController {
  constructor(private readonly bioteca: BiotecaService) {}

  @Get()
  @ExigePermissao(PERMISSOES.BIOTECA_VISUALIZAR)
  @ApiOperation({
    summary: 'Acervo biológico',
    description:
      'Busca por identificador, descrição, órgão, tipo, status, caso e localização (§77), ' +
      'com filtro de disponibilidade (§79).',
  })
  async listar(
    @Query('status') status?: string,
    @Query('tipo') tipo?: string,
    @Query('casoId') casoId?: string,
    @Query('localId') localId?: string,
    @Query('q') busca?: string,
    @Query('disponiveis') disponiveis?: string,
  ) {
    return this.bioteca.listar({
      status: status ? (status as StatusObjetoBiologico) : undefined,
      tipo: tipo ? (tipo as TipoObjetoBiologico) : undefined,
      casoId: casoId || undefined,
      localId: localId || undefined,
      busca: busca || undefined,
      apenasDisponiveis: disponiveis === 'true',
    });
  }

  @Get('mapa')
  @ExigePermissao(PERMISSOES.BIOTECA_VISUALIZAR)
  @ApiOperation({
    summary: 'Mapa de posições e ocupação',
    description:
      'Total, ocupadas e livres por local (§20), mais o que está fora do acervo — porque ' +
      'material retirado não desaparece do sistema (§33).',
  })
  async mapa() {
    return this.bioteca.mapa();
  }

  @Get('conferencia')
  @ExigePermissao(PERMISSOES.BIOTECA_VISUALIZAR)
  @ApiOperation({
    summary: 'Conferências do Guardian sobre o acervo',
    description:
      'Material sem localização, congelado em equipamento incompatível, empréstimo atrasado, ' +
      'vencido preso por processo ativo (§86). Não barra nada — é trabalho pendente.',
  })
  async conferencia() {
    return this.bioteca.conferencia();
  }

  @Get('emprestimos')
  @ExigePermissao(PERMISSOES.BIOTECA_VISUALIZAR)
  @ApiOperation({
    summary: 'Empréstimos e vencimentos',
    description: 'Marca os vencidos na leitura (§38) e mostra quantos itens ainda não voltaram.',
  })
  async emprestimos(@Query('abertos') abertos?: string) {
    return this.bioteca.emprestimos({ apenasAbertos: abertos === 'true' });
  }

  @Get('emprestimos/:id')
  @ExigePermissao(PERMISSOES.BIOTECA_VISUALIZAR)
  @ApiOperation({ summary: 'Termo de empréstimo com os materiais (§37)' })
  async emprestimoDetalhe(@Param('id', ParseUUIDPipe) id: string) {
    return this.bioteca.emprestimoDetalhe(id);
  }

  @Get('inventarios')
  @ExigePermissao(PERMISSOES.BIOTECA_VISUALIZAR)
  @ApiOperation({ summary: 'Inventários físicos realizados (§54)' })
  async inventarios() {
    return this.bioteca.listarInventarios();
  }

  @Get('inventarios/:id')
  @ExigePermissao(PERMISSOES.BIOTECA_VISUALIZAR)
  @ApiOperation({ summary: 'Inventário com itens, divergências e reconciliações (§56-57)' })
  async inventarioDetalhe(@Param('id', ParseUUIDPipe) id: string) {
    return this.bioteca.inventarioDetalhe(id);
  }

  @Get('descarte/elegiveis')
  @ExigePermissao(PERMISSOES.BIOTECA_VISUALIZAR)
  @ApiOperation({
    summary: 'Elegíveis para destinação',
    description:
      'Devolve também os bloqueados, com o motivo de cada um (§49-50): uma lista que só ' +
      'mostra elegíveis esconde por que o material vencido continua no armário.',
  })
  async elegiveis(@Query('tipo') tipo?: string, @Query('localId') localId?: string) {
    return this.bioteca.elegiveisParaDescarte({
      tipo: tipo ? (tipo as TipoObjetoBiologico) : undefined,
      localId: localId || undefined,
    });
  }

  @Get('casos/:casoId')
  @ExigePermissao(PERMISSOES.BIOTECA_VISUALIZAR)
  @ApiOperation({
    summary: 'Material preservado do caso',
    description:
      'A resposta da §76 para "ainda existe bloco deste caso?": cada material com seu estado, ' +
      'não um sim ou não.',
  })
  async porCaso(@Param('casoId', ParseUUIDPipe) casoId: string) {
    return this.bioteca.porCaso(casoId);
  }

  @Get(':id')
  @ExigePermissao(PERMISSOES.BIOTECA_VISUALIZAR)
  @ApiOperation({
    summary: 'Ficha do Objeto Biológico',
    description:
      'Identificação, origem, condição, localização, reservas, empréstimos, retenção e a ' +
      'linha do tempo completa (§80-81).',
  })
  async ficha(@Param('id', ParseUUIDPipe) id: string) {
    return this.bioteca.ficha(id);
  }

  @Post()
  @ExigePermissao(PERMISSOES.BIOTECA_MOVIMENTAR)
  @ApiOperation({
    summary: 'Arquiva material no acervo',
    description:
      'O local é opcional: material recém-produzido existe antes de ter gaveta, e recusá-lo ' +
      'aqui criaria a "caixa sem registro" que o módulo existe para eliminar (§115).',
  })
  async arquivar(@Body() corpo: unknown) {
    return this.bioteca.arquivar(validarCorpo(arquivamentoSchema, corpo));
  }

  @Post(':id/transferencia')
  @ExigePermissao(PERMISSOES.BIOTECA_MOVIMENTAR)
  @ApiOperation({ summary: 'Move o material entre posições do acervo (§17)' })
  async transferir(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    const dados = validarCorpo(
      z.object({ localId: z.string().uuid(), motivo: z.string().nullish() }),
      corpo,
    );
    await this.bioteca.transferir(id, dados.localId, dados.motivo ?? undefined);
  }

  @Post(':id/retirada')
  @ExigePermissao(PERMISSOES.BIOTECA_MOVIMENTAR)
  @ApiOperation({
    summary: 'Retirada física',
    description:
      'O objeto sai da posição mas continua rastreável: a posição de origem é preservada ' +
      'e é para lá que ele volta (§33).',
  })
  async retirar(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    await this.bioteca.retirar(id, validarCorpo(retiradaSchema, corpo));
  }

  @Post(':id/devolucao')
  @ExigePermissao(PERMISSOES.BIOTECA_MOVIMENTAR)
  @ApiOperation({ summary: 'Devolve o material à posição de origem, com a condição de volta (§34)' })
  async devolver(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    const dados = validarCorpo(
      z.object({
        localId: z.string().uuid().nullish(),
        condicao: z.enum(CONDICAO_OBJETO).nullish(),
        observacao: z.string().nullish(),
      }),
      corpo,
    );
    await this.bioteca.devolver(id, dados);
  }

  @Post(':id/consumo')
  @ExigePermissao(PERMISSOES.BIOTECA_MOVIMENTAR)
  @ApiOperation({
    summary: 'Registra consumo do material',
    description:
      'Debita a quantidade e marca o esgotamento — que precisa ficar visível ao patologista ' +
      'antes do próximo pedido de complementar (§25).',
  })
  async consumir(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    const dados = validarCorpo(
      z.object({
        quantidade: z.number().int().min(1).nullish(),
        finalidade: z.enum(FINALIDADE_USO),
        observacao: z.string().nullish(),
      }),
      corpo,
    );
    return this.bioteca.consumir(id, dados);
  }

  @Post(':id/reserva')
  @ExigePermissao(PERMISSOES.BIOTECA_RESERVAR)
  @ApiOperation({
    summary: 'Reserva o material para uma finalidade',
    description:
      'A hierarquia da §29 vale: diagnóstico e perícia têm precedência sobre ensino e pesquisa, ' +
      'e uma reserva de precedência menor não passa por cima de outra maior.',
  })
  async reservar(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    const dados = validarCorpo(
      z.object({
        finalidade: z.enum(FINALIDADE_USO),
        projeto: z.string().nullish(),
        justificativa: z.string().nullish(),
        vigenciaAte: z.string().nullish(),
      }),
      corpo,
    );
    return this.bioteca.reservar(id, dados);
  }

  @Post('reservas/:id/encerramento')
  @ExigePermissao(PERMISSOES.BIOTECA_RESERVAR)
  @ApiOperation({ summary: 'Encerra a reserva, com motivo registrado' })
  async encerrarReserva(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    const dados = validarCorpo(
      z.object({ motivo: z.string().min(5, 'Diga por que a reserva está sendo encerrada.') }),
      corpo,
    );
    await this.bioteca.encerrarReserva(id, dados.motivo);
  }

  @Post(':id/restricoes')
  @ExigePermissao(PERMISSOES.BIOTECA_ADMINISTRAR)
  @ApiOperation({
    summary: 'Define restrições e retenção ampliada',
    description: 'Retenção ampliada exige justificativa registrada (§48).',
  })
  async definirRestricoes(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    const dados = validarCorpo(
      z.object({
        restricoes: z.array(z.enum(RESTRICAO_OBJETO)),
        preservacaoEspecial: z.boolean().nullish(),
        motivoRetencaoAmpliada: z.enum(MOTIVO_RETENCAO_AMPLIADA).nullish(),
        justificativa: z.string().nullish(),
      }),
      corpo,
    );
    await this.bioteca.definirRestricoes(id, dados);
  }

  @Post(':id/correcao-localizacao')
  @ExigePermissao(PERMISSOES.BIOTECA_ADMINISTRAR)
  @ApiOperation({
    summary: 'Corrige um registro de localização errado',
    description:
      'Não é transferência: o material não se moveu, o registro é que estava errado. ' +
      'O evento anterior permanece (§83).',
  })
  async corrigirLocalizacao(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    const dados = validarCorpo(
      z.object({
        localId: z.string().uuid(),
        motivo: z.string().min(5, 'A correção de localização exige motivo registrado.'),
      }),
      corpo,
    );
    await this.bioteca.corrigirLocalizacao(id, dados.localId, dados.motivo);
  }

  @Post('emprestimos')
  @ExigePermissao(PERMISSOES.BIOTECA_EMPRESTAR)
  @ApiOperation({
    summary: 'Empresta material do acervo',
    description:
      'Vários objetos num mesmo termo (§41). Material com restrição "não emprestar" ou sob ' +
      'restrição pericial é recusado aqui, não na entrega.',
  })
  async emprestar(@Body() corpo: unknown) {
    return this.bioteca.emprestar(validarCorpo(emprestimoSchema, corpo));
  }

  @Post('emprestimos/:id/devolucao')
  @ExigePermissao(PERMISSOES.BIOTECA_EMPRESTAR)
  @ApiOperation({
    summary: 'Devolve um material do empréstimo',
    description:
      'O empréstimo só encerra quando o último item volta — a §39 proíbe encerrar um ' +
      'empréstimo cujo material não voltou.',
  })
  async devolverEmprestimo(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    const dados = validarCorpo(
      z.object({
        objetoId: z.string().uuid(),
        localId: z.string().uuid().nullish(),
        condicao: z.enum(CONDICAO_OBJETO).nullish(),
        observacao: z.string().nullish(),
      }),
      corpo,
    );
    return this.bioteca.devolverEmprestimo(id, dados);
  }

  @Post('inventarios')
  @ExigePermissao(PERMISSOES.BIOTECA_INVENTARIAR)
  @ApiOperation({
    summary: 'Abre um inventário físico',
    description: 'Por localização ou por tipo (§54-55). Congela a lista do que deveria estar lá.',
  })
  async abrirInventario(@Body() corpo: unknown) {
    const dados = validarCorpo(
      z.object({
        descricao: z.string().nullish(),
        localId: z.string().uuid().nullish(),
        tipoFiltro: z.enum(TIPO_OBJETO_BIOLOGICO).nullish(),
      }),
      corpo,
    );
    return this.bioteca.abrirInventario(dados);
  }

  @Post('inventarios/:id/leitura')
  @ExigePermissao(PERMISSOES.BIOTECA_INVENTARIAR)
  @ApiOperation({
    summary: 'Registra a leitura de um material',
    description:
      'Aponta posição incorreta, condição divergente e objeto não cadastrado (§56). ' +
      '"Não localizado" só aparece no fechamento, porque é a ausência de leitura.',
  })
  async registrarLeitura(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    const dados = validarCorpo(
      z.object({
        objetoId: z.string().uuid().nullish(),
        codigoLido: z.string().nullish(),
        localEncontradoId: z.string().uuid().nullish(),
        condicaoEncontrada: z.enum(CONDICAO_OBJETO).nullish(),
      }),
      corpo,
    );
    return this.bioteca.registrarLeitura(id, dados);
  }

  @Post('inventarios/itens/:id/reconciliacao')
  @ExigePermissao(PERMISSOES.BIOTECA_INVENTARIAR)
  @ApiOperation({
    summary: 'Reconcilia uma divergência',
    description:
      'Preserva localização anterior, localização encontrada, usuário, data e justificativa (§57).',
  })
  async reconciliar(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    const dados = validarCorpo(
      z.object({ justificativa: z.string().min(5, 'A reconciliação exige justificativa.') }),
      corpo,
    );
    await this.bioteca.reconciliar(id, dados.justificativa);
  }

  @Post('inventarios/:id/conclusao')
  @ExigePermissao(PERMISSOES.BIOTECA_INVENTARIAR)
  @ApiOperation({
    summary: 'Conclui o inventário',
    description: 'O que não foi lido vira "não localizado" — a divergência por ausência (§56).',
  })
  async concluirInventario(@Param('id', ParseUUIDPipe) id: string) {
    return this.bioteca.concluirInventario(id);
  }

  @Post('descarte')
  @ExigePermissao(PERMISSOES.BIOTECA_DESCARTAR)
  @ApiOperation({
    summary: 'Lote de destinação final',
    description:
      'Cada objeto é revalidado individualmente na confirmação (§51). Descartar não apaga ' +
      'o registro: muda o status e o histórico permanece consultável (§53).',
  })
  async descartar(@Body() corpo: unknown) {
    const dados = validarCorpo(
      z.object({
        metodo: z.enum(METODO_DESCARTE),
        empresa: z.string().nullish(),
        observacoes: z.string().nullish(),
        objetoIds: z.array(z.string().uuid()).min(1, 'Selecione ao menos um material.'),
      }),
      corpo,
    );
    return this.bioteca.descartar(dados);
  }

  @Post('colecoes')
  @ExigePermissao(PERMISSOES.BIOTECA_ADMINISTRAR)
  @ApiOperation({
    summary: 'Cria uma coleção biológica',
    description:
      'Relação virtual: os materiais continuam nas suas posições físicas originais (§74).',
  })
  async criarColecao(@Body() corpo: unknown) {
    const dados = validarCorpo(
      z.object({
        nome: z.string().min(3),
        descricao: z.string().nullish(),
        finalidade: z.enum(FINALIDADE_USO).nullish(),
        projeto: z.string().nullish(),
      }),
      corpo,
    );
    return this.bioteca.criarColecao(dados);
  }

  @Post('colecoes/:id/itens')
  @ExigePermissao(PERMISSOES.BIOTECA_ADMINISTRAR)
  @ApiOperation({ summary: 'Adiciona material à coleção, sem duplicar o registro (§67)' })
  async adicionarNaColecao(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    const dados = validarCorpo(
      z.object({ objetoId: z.string().uuid(), nota: z.string().nullish() }),
      corpo,
    );
    await this.bioteca.adicionarNaColecao(id, dados.objetoId, dados.nota);
  }
}

// --- M20 (parcial): Ordem de Servico e precos ------------------------------

const itemOrdemSchema = z.object({
  servicoId: z.string().uuid().nullish(),
  descricao: z.string().max(300).nullish(),
  quantidade: z.number().positive().max(100000).optional(),
  valorUnitario: z.number().min(0).max(9_999_999).nullish(),
  descontoPercentual: z.number().min(0).max(100).optional(),
});

const edicaoItemOrdemSchema = z.object({
  descricao: z.string().min(1).max(300).optional(),
  quantidade: z.number().positive().max(100000).optional(),
  valorUnitario: z.number().min(0).max(9_999_999).optional(),
  descontoPercentual: z.number().min(0).max(100).optional(),
});

const precoClienteSchema = z.object({
  servicoId: z.string().uuid(),
  /** Nulo remove o acordo e devolve o cliente a tabela padrao. */
  valor: z.number().min(0).max(9_999_999).nullable(),
});

@ApiTags('M20 - Ordens de Serviço')
@Controller('ordens')
export class OrdensController {
  constructor(private readonly ordens: OrdensService) {}

  @Get()
  @ExigePermissao(PERMISSOES.OS_VISUALIZAR)
  @ApiOperation({
    summary: 'Fila de Ordens de Serviço',
    description:
      'A OS nasce na conferência do recebimento e é o que o financeiro fatura — ' +
      'a cobrança nunca sai de um caso solto.',
  })
  async listar(@Query('status') status?: string, @Query('faturaveis') faturaveis?: string) {
    return this.ordens.listar(
      status as StatusOrdemServico | undefined,
      faturaveis === '1' || faturaveis === 'true',
    );
  }

  @Get('casos/:casoId')
  @ExigePermissao(PERMISSOES.OS_VISUALIZAR)
  @ApiOperation({ summary: 'OS do caso, com itens e total calculado' })
  async porCaso(@Param('casoId', ParseUUIDPipe) casoId: string) {
    return this.ordens.buscarPorCaso(casoId);
  }

  @Post(':id/itens')
  @ExigePermissao(PERMISSOES.OS_EDITAR)
  @ApiOperation({
    summary: 'Adiciona um item à OS (até ela entrar numa fatura)',
    description:
      'Com serviço, o preço entra do acordo do cliente ou da tabela padrão; sem ' +
      'serviço é item avulso, criado na hora, com descrição e valor próprios.',
  })
  async adicionarItem(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    return this.ordens.adicionarItem(id, validarCorpo(itemOrdemSchema, corpo));
  }

  @Post(':id/itens/:itemId')
  @ExigePermissao(PERMISSOES.OS_EDITAR)
  @ApiOperation({ summary: 'Edita quantidade, valor, desconto ou descrição de um item' })
  async editarItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() corpo: unknown,
  ) {
    return this.ordens.editarItem(id, itemId, validarCorpo(edicaoItemOrdemSchema, corpo));
  }

  @Post(':id/itens/:itemId/remocao')
  @ExigePermissao(PERMISSOES.OS_EDITAR)
  @ApiOperation({ summary: 'Remove um item da OS (até ela entrar numa fatura)' })
  async removerItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    return this.ordens.removerItem(id, itemId);
  }

  @Post(':id/conferencia')
  @ExigePermissao(PERMISSOES.OS_CONFERIR)
  @ApiOperation({
    summary: 'Conferência da saída',
    description:
      'O ato descrito na review: alguém pega a OS, verifica se tudo que ela ' +
      'lista foi executado e dá o ok. Marco operacional; não congela itens.',
  })
  async conferir(@Param('id', ParseUUIDPipe) id: string) {
    return this.ordens.conferir(id);
  }

  @Post(':id/despacho')
  @ExigePermissao(PERMISSOES.OS_CONFERIR)
  @ApiOperation({ summary: 'Despacho — o material saiu (marco operacional)' })
  async despachar(@Param('id', ParseUUIDPipe) id: string) {
    return this.ordens.despachar(id);
  }

  @Post(':id/cancelamento')
  @ExigePermissao(PERMISSOES.OS_EDITAR)
  @ApiOperation({ summary: 'Cancela a OS, com motivo obrigatório' })
  async cancelar(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    const dados = validarCorpo(z.object({ motivo: z.string().min(1) }), corpo);
    return this.ordens.cancelar(id, dados.motivo);
  }
}

@ApiTags('M20 - Preços')
@Controller('precos')
export class PrecosController {
  constructor(private readonly ordens: OrdensService) {}

  @Get('clientes/:clienteId')
  @ExigePermissao(PERMISSOES.PRECO_GERENCIAR)
  @ApiOperation({
    summary: 'Tabela de preços do cliente',
    description:
      'O catálogo inteiro com o valor padrão e o acordo personalizado lado a ' +
      'lado — "tabela padrão ou personalizada", como na rotina do laboratório.',
  })
  async doCliente(@Param('clienteId', ParseUUIDPipe) clienteId: string) {
    return this.ordens.precosDoCliente(clienteId);
  }

  @Post('clientes/:clienteId')
  @ExigePermissao(PERMISSOES.PRECO_GERENCIAR)
  @ApiOperation({ summary: 'Define ou remove (valor nulo) o acordo de um serviço' })
  async definir(@Param('clienteId', ParseUUIDPipe) clienteId: string, @Body() corpo: unknown) {
    const dados = validarCorpo(precoClienteSchema, corpo);
    return this.ordens.definirPrecoCliente(clienteId, dados.servicoId, dados.valor);
  }

  // --- Tabelas de preco (segunda review) ----------------------------------

  @Get('tabelas')
  @ExigePermissao(PERMISSOES.PRECO_GERENCIAR)
  @ApiOperation({
    summary: 'Tabelas de preço da instituição',
    description:
      'Laboratório, clínica, hospital… — os serviços são os mesmos, só o valor muda. ' +
      'O cliente aponta para uma tabela; o acordo individual continua vencendo.',
  })
  async tabelas() {
    return this.ordens.listarTabelas();
  }

  @Get('tabelas/opcoes')
  @ExigePermissao(PERMISSOES.CLIENTE_VISUALIZAR)
  @ApiOperation({ summary: 'Tabelas ativas, para o cadastro do cliente escolher' })
  async opcoesDeTabela() {
    return this.ordens.opcoesDeTabela();
  }

  @Post('tabelas')
  @ExigePermissao(PERMISSOES.PRECO_GERENCIAR)
  @ApiOperation({ summary: 'Cria uma tabela de preço' })
  async criarTabela(@Body() corpo: unknown) {
    const dados = validarCorpo(tabelaPrecoSchema, corpo);
    return this.ordens.criarTabela(dados.nome, dados.descricao);
  }

  @Post('tabelas/:id')
  @ExigePermissao(PERMISSOES.PRECO_GERENCIAR)
  @ApiOperation({ summary: 'Renomeia, descreve, inativa ou reativa uma tabela (M01: nunca exclui)' })
  async editarTabela(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    return this.ordens.editarTabela(id, validarCorpo(edicaoTabelaPrecoSchema, corpo));
  }

  @Get('tabelas/:id/itens')
  @ExigePermissao(PERMISSOES.PRECO_GERENCIAR)
  @ApiOperation({ summary: 'Catálogo inteiro com o valor padrão e o valor da tabela ao lado' })
  async itensDaTabela(@Param('id', ParseUUIDPipe) id: string) {
    return this.ordens.itensDaTabela(id);
  }

  @Post('tabelas/:id/itens')
  @ExigePermissao(PERMISSOES.PRECO_GERENCIAR)
  @ApiOperation({ summary: 'Define ou remove (valor nulo) o preço de um serviço na tabela' })
  async definirItemTabela(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    const dados = validarCorpo(precoClienteSchema, corpo);
    return this.ordens.definirItemTabela(id, dados.servicoId, dados.valor);
  }

  @Get('tabelas/:id/faixas')
  @ExigePermissao(PERMISSOES.PRECO_GERENCIAR)
  @ApiOperation({ summary: 'Faixas por quantidade de um serviço na tabela' })
  async faixasDaTabela(@Param('id', ParseUUIDPipe) id: string, @Query('servicoId') servicoId?: string) {
    // Sem servico: todas as faixas da tabela, numa requisicao so (a tela de valores).
    return this.ordens.faixasDaTabela(id, servicoId || undefined);
  }

  @Post('tabelas/:id/faixas')
  @ExigePermissao(PERMISSOES.PRECO_GERENCIAR)
  @ApiOperation({
    summary: 'Define o total para N amostras do serviço na tabela (nulo remove)',
    description:
      'Documento do Hugo: "1 histopatológico 100, 2 = 160, 3 = 200" — a cobrança de mais de uma ' +
      'amostra nem sempre é linear. A faixa guarda o TOTAL para exatamente N amostras.',
  })
  async definirFaixaTabela(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    const dados = validarCorpo(faixaTabelaSchema, corpo);
    return this.ordens.definirFaixaTabela(id, dados.servicoId, dados.quantidade, dados.valorTotal);
  }
}

const faixaTabelaSchema = z.object({
  servicoId: z.string().uuid(),
  quantidade: z.number().int().min(2).max(500),
  valorTotal: z.number().min(0).max(9_999_999).nullable(),
});

const tabelaPrecoSchema = z.object({
  nome: z.string().min(2).max(80),
  descricao: z.string().max(300).optional(),
});

const edicaoTabelaPrecoSchema = z.object({
  nome: z.string().min(2).max(80).optional(),
  descricao: z.string().max(300).nullable().optional(),
  ativa: z.boolean().optional(),
});

/** Período do fechamento: `YYYY-MM-DD` ou ISO; `ate` exclusivo. */
const periodoSchema = z
  .object({
    de: z.string().min(10),
    ate: z.string().min(10),
    clienteId: z.string().uuid().optional(),
  })
  .refine((p) => !Number.isNaN(Date.parse(p.de)) && !Number.isNaN(Date.parse(p.ate)), 'Datas inválidas.')
  .refine((p) => Date.parse(p.ate) > Date.parse(p.de), '`ate` precisa ser depois de `de`.');

const novaFaturaSchema = z.object({
  clienteId: z.string().uuid(),
  ordemIds: z.array(z.string().uuid()).min(1, 'Escolha ao menos uma OS faturável.'),
});

const lancamentoSchema = z.object({
  tipo: z.enum(['entrada', 'saida']),
  categoria: z.string().min(1).max(120),
  descricao: z.string().min(1).max(300),
  valor: z.number().positive().max(9_999_999),
  /** Data de competência do caixa, `YYYY-MM-DD`. */
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

@ApiTags('M20 - Financeiro')
@Controller('financeiro')
export class FinanceiroController {
  constructor(private readonly financeiro: FinanceiroService) {}

  @Get('resumo')
  @ExigePermissao(PERMISSOES.FINANCEIRO_VISUALIZAR)
  @ApiOperation({
    summary: 'Fluxo de caixa, contas a receber e o que já pode ser faturado',
  })
  async resumo() {
    return this.financeiro.resumo();
  }

  @Get('fechamento')
  @ExigePermissao(PERMISSOES.FINANCEIRO_VISUALIZAR)
  @ApiOperation({
    summary: 'Fechamento do período por cliente',
    description:
      'Exames com ENTRADA entre `de` (inclusive) e `ate` (exclusivo), agrupados por ' +
      'cliente com subtotal — o relatório do dia 1º. Cada linha diz o status da OS.',
  })
  async fechamento(
    @Query('de') de?: string,
    @Query('ate') ate?: string,
    @Query('clienteId') clienteId?: string,
  ) {
    const p = validarCorpo(periodoSchema, { de, ate, clienteId });
    return this.financeiro.fechamento(new Date(p.de), new Date(p.ate), p.clienteId);
  }

  @Get('fechamento/pdf')
  @ExigePermissao(PERMISSOES.FINANCEIRO_VISUALIZAR)
  @Header('Content-Type', 'application/pdf')
  @ApiOperation({ summary: 'O fechamento em PDF — o que vai por e-mail para o cliente' })
  async fechamentoPdf(
    @Query('de') de?: string,
    @Query('ate') ate?: string,
    @Query('clienteId') clienteId?: string,
  ) {
    const p = validarCorpo(periodoSchema, { de, ate, clienteId });
    const bytes = await this.financeiro.fechamentoPdf(new Date(p.de), new Date(p.ate), p.clienteId);
    return new StreamableFile(bytes, {
      disposition: `inline; filename="fechamento-${p.de.slice(0, 10)}.pdf"`,
    });
  }

  @Get('produtividade')
  @ExigePermissao(PERMISSOES.FINANCEIRO_VISUALIZAR)
  @ApiOperation({ summary: 'Laudos liberados por patologista no período, e a fila de cada um' })
  async produtividade(@Query('de') de?: string, @Query('ate') ate?: string) {
    const p = validarCorpo(periodoSchema, { de, ate });
    return this.financeiro.produtividade(new Date(p.de), new Date(p.ate));
  }

  @Get('faturas')
  @ExigePermissao(PERMISSOES.FINANCEIRO_VISUALIZAR)
  @ApiOperation({ summary: 'Faturas, com total calculado das ordens' })
  async faturas(@Query('status') status?: string) {
    return this.financeiro.listarFaturas(status as StatusFatura | undefined);
  }

  @Get('faturas/:id')
  @ExigePermissao(PERMISSOES.FINANCEIRO_VISUALIZAR)
  @ApiOperation({ summary: 'Fatura com as ordens que a compõem' })
  async fatura(@Param('id', ParseUUIDPipe) id: string) {
    return this.financeiro.buscarFatura(id);
  }

  @Post('faturas')
  @ExigePermissao(PERMISSOES.FINANCEIRO_LANCAR)
  @ApiOperation({
    summary: 'Cria a fatura agrupando OSs despachadas do cliente',
    description:
      'Só ordem despachada entra — "a partir desse momento já pode ir pra fatura". ' +
      'As ordens passam a `faturada`; cancelar a fatura as devolve.',
  })
  async criarFatura(@Body() corpo: unknown) {
    const dados = validarCorpo(novaFaturaSchema, corpo);
    return this.financeiro.criarFatura(dados.clienteId, dados.ordemIds);
  }

  @Post('faturas/:id/emissao')
  @ExigePermissao(PERMISSOES.FINANCEIRO_LANCAR)
  @ApiOperation({ summary: 'Emite a fatura com vencimento — vira contas a receber' })
  async emitir(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    const dados = validarCorpo(
      z.object({ vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
      corpo,
    );
    return this.financeiro.emitirFatura(id, dados.vencimento);
  }

  @Post('faturas/:id/pagamento')
  @ExigePermissao(PERMISSOES.FINANCEIRO_LANCAR)
  @ApiOperation({
    summary: 'Registra o pagamento',
    description:
      'Gera o lançamento de ENTRADA automático e travado no livro — fluxo de ' +
      'caixa e contas a receber contam a mesma história.',
  })
  async pagar(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    const dados = validarCorpo(
      z.object({
        valor: z.number().positive().max(9_999_999).optional(),
        data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
      corpo,
    );
    return this.financeiro.registrarPagamento(id, dados);
  }

  @Post('faturas/:id/cancelamento')
  @ExigePermissao(PERMISSOES.FINANCEIRO_LANCAR)
  @ApiOperation({ summary: 'Cancela a fatura; as ordens voltam a "despachada"' })
  async cancelarFatura(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    const dados = validarCorpo(z.object({ motivo: z.string().min(1) }), corpo);
    return this.financeiro.cancelarFatura(id, dados.motivo);
  }

  @Get('lancamentos')
  @ExigePermissao(PERMISSOES.FINANCEIRO_VISUALIZAR)
  @ApiOperation({ summary: 'Livro de entradas e saídas (filtro por mês YYYY-MM)' })
  async lancamentos(@Query('mes') mes?: string) {
    return this.financeiro.listarLancamentos(mes);
  }

  @Post('lancamentos')
  @ExigePermissao(PERMISSOES.FINANCEIRO_LANCAR)
  @ApiOperation({ summary: 'Lançamento manual de entrada ou saída' })
  async lancar(@Body() corpo: unknown) {
    const dados = validarCorpo(lancamentoSchema, corpo);
    return this.financeiro.lancar({ ...dados, tipo: dados.tipo as TipoLancamento });
  }

  @Post('lancamentos/:id/remocao')
  @ExigePermissao(PERMISSOES.FINANCEIRO_LANCAR)
  @ApiOperation({
    summary: 'Remove um lançamento manual',
    description: 'Lançamento automático de fatura não se remove — ajuste a fatura.',
  })
  async removerLancamento(@Param('id', ParseUUIDPipe) id: string) {
    return this.financeiro.removerLancamento(id);
  }
}


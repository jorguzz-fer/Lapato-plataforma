import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  ETAPA,
  GRAVIDADE_NC,
  LATERALIDADE,
  METODO_AMOSTRAGEM,
  PERMISSOES,
  PRIORIDADE,
  RESULTADO_MARGEM,
  RESULTADO_TRIAGEM,
  type Etapa,
} from '@lapato/shared';
import { ExigePermissao } from '../core/auth/guards.js';
import { validarCorpo } from '../core/http/validacao.js';
import { CasosService } from './m05-casos/casos.service.js';
import { TriagemService } from './m06-triagem/triagem.service.js';
import { MacroscopiaService } from './m08-macroscopia/macroscopia.service.js';
import { ProcessamentoService } from './m09-processamento/processamento.service.js';
import { LaudosService } from './m11-laudos/laudos.service.js';
import { FluxoConsultaService } from './m07-fluxo/fluxo-consulta.service.js';
import { DbService } from '../core/db/db.service.js';

// ---------------------------------------------------------------------------
// M05 - Recebimento e Cadastro de Amostras
// ---------------------------------------------------------------------------

const novoCasoSchema = z.object({
  servicoId: z.string().uuid(),
  clienteId: z.string().uuid(),
  veterinarioId: z.string().uuid().optional(),
  prioridade: z.enum(PRIORIDADE).optional(),
  paciente: z.object({
    id: z.string().uuid().optional(),
    nome: z.string().min(1),
    especieId: z.string().uuid().optional(),
    sexo: z.string().optional(),
    microchip: z.string().optional(),
    tutorNome: z.string().optional(),
  }),
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
});

const recebimentoSchema = z.object({
  conferencia: z
    .array(
      z.object({
        recipienteId: z.string().uuid(),
        quantidadeRecebida: z.number().int().nonnegative(),
      }),
    )
    .min(1),
});

@ApiTags('M05 - Recebimento e Cadastro')
@Controller('casos')
export class CasosController {
  constructor(private readonly casos: CasosService) {}

  @Post()
  @ExigePermissao(PERMISSOES.CASO_CRIAR)
  @ApiOperation({
    summary: 'Cadastra um caso anatomopatológico',
    description:
      'Um paciente por caso (M05). Gera o registro oficial pela sequência do M01, ' +
      'nunca reutilizável, e inicia o fluxo no M07.',
  })
  async criar(@Body() corpo: unknown) {
    return this.casos.criar(validarCorpo(novoCasoSchema, corpo));
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
  constructor(private readonly processamento: ProcessamentoService) {}

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
  async listar(@Query('etapa') etapa?: string, @Query('minhaFila') minhaFila?: string) {
    return this.consulta.listar({
      etapa: etapa as Etapa | undefined,
      apenasMinhaFila: minhaFila === 'true',
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

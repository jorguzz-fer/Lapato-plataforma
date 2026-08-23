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
  CELULARIDADE,
  ETAPA,
  GRAVIDADE_NC,
  GRAU_CERTEZA,
  INTENSIDADE,
  LATERALIDADE,
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

const edicaoUsuarioSchema = z.object({
  nomeCompleto: z.string().min(1).optional(),
  perfilIds: z.array(z.string().uuid()).min(1).optional(),
  unidadePrincipalId: z.string().uuid().nullish(),
});

@ApiTags('M02 - Usuários, Perfis e Permissões')
@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly usuarios: UsuariosService) {}

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

  @Post(':id')
  @ExigePermissao(PERMISSOES.USUARIO_EDITAR)
  @ApiOperation({
    summary: 'Edita nome, perfis e unidade',
    description:
      'A troca de perfis substitui o conjunto e vale na próxima sessão - reduzir ' +
      'privilégio de sessão aberta exige bloquear.',
  })
  async editar(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    await this.usuarios.editar(id, validarCorpo(edicaoUsuarioSchema, corpo));
    return { ok: true };
  }
}

// ---------------------------------------------------------------------------
// M03 - Cadastro de Clientes e Veterinários
// ---------------------------------------------------------------------------

const clienteSchema = z.object({
  nomeFantasia: z.string().min(1, 'Informe o nome do cliente.'),
  razaoSocial: z.string().optional(),
  documento: z.string().optional(),
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

const veterinarioBase = z.object({
  nome: z.string().min(1, 'Informe o nome do profissional.'),
  crmv: z.string().optional(),
  crmvUf: z.string().length(2).optional(),
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
      validarCorpo(clienteSchema.partial().omit({ codigo: true, ignorarDuplicidade: true }), corpo),
    );
    return { ok: true };
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
    const valida = ['abertas', 'vencidas', 'concluidas', 'todas'].includes(aba ?? '');
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

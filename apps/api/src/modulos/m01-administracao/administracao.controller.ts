import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PERMISSOES, TIPO_UNIDADE } from '@lapato/shared';
import { ExigePermissao } from '../../core/auth/guards.js';
import { validarCorpo } from '../../core/http/validacao.js';
import { AdministracaoService } from './administracao.service.js';

/**
 * M01 - Administracao e Configuracoes: as ESCRITAS.
 *
 * As leituras que os formularios consomem (servicos ativos, termos ativos,
 * unidades) continuam no CatalogoController - qualquer perfil operacional as
 * usa. Aqui e a gestao, atras de permissoes administrativas, e as listagens
 * incluem inativos porque administrar e cuidar do ciclo de vida inteiro.
 */

const servicoSchema = z.object({
  nome: z.string().min(1),
  codigo: z
    .string()
    .min(2)
    .max(12)
    .regex(/^[A-Za-z0-9_]+$/),
  categoria: z.string().min(1),
  /** Conforme o schema do banco (M01 secao 10). */
  modalidade: z.enum(['histopatologia', 'citopatologia', 'necropsia', 'revisao', 'complementar']),
  descricao: z.string().optional(),
  exigeTriagem: z.boolean().optional(),
  exigeMacroscopia: z.boolean().optional(),
  exigeProcessamento: z.boolean().optional(),
  exigeMicroscopia: z.boolean().optional(),
  geraLaudo: z.boolean().optional(),
  permiteComplementares: z.boolean().optional(),
  prazoDiasUteis: z.number().int().min(1).max(365).optional(),
  prazoUrgenteDiasUteis: z.number().int().min(1).max(365).nullish(),
});

const termoSchema = z.object({
  valor: z.string().min(1),
  codigo: z.string().min(1).max(60),
  abreviacao: z.string().optional(),
  sinonimos: z.array(z.string()).optional(),
  ordem: z.number().int().optional(),
});

const unidadeSchema = z.object({
  nome: z.string().min(1),
  codigo: z
    .string()
    .min(2)
    .max(12)
    .regex(/^[A-Za-z0-9_]+$/),
  sigla: z.string().max(8).optional(),
  tipo: z.enum(TIPO_UNIDADE),
  responsavel: z.string().optional(),
});

/**
 * M01 secao 7.3 + M15 secao 18: a arvore de locais. `paiId` ausente cria a raiz
 * (a sala ou o equipamento); presente pendura o filho (a prateleira, a posicao).
 */
const localSchema = z.object({
  unidadeId: z.string().uuid(),
  paiId: z.string().uuid().nullish(),
  nome: z.string().min(1, 'Informe o nome.'),
  codigo: z.string().min(1, 'Informe o código.'),
  categoria: z.string().min(1, 'Informe a categoria — câmara, prateleira, posição…'),
  capacidade: z.number().int().positive().nullish(),
  condicaoAmbiental: z.string().nullish(),
});

const setorSchema = z.object({
  nome: z.string().min(1),
  codigo: z
    .string()
    .min(2)
    .max(12)
    .regex(/^[A-Za-z0-9_]+$/),
  tipo: z.string().min(1),
});

const diaNaoUtilSchema = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.'),
  descricao: z.string().min(1),
  tipo: z.enum(['nacional', 'estadual', 'municipal', 'recesso', 'institucional']).optional(),
});

@ApiTags('M01 - Administração e Configurações')
@Controller('administracao')
export class AdministracaoController {
  constructor(private readonly admin: AdministracaoService) {}

  // --- servicos -------------------------------------------------------------

  @Get('servicos')
  @ExigePermissao(PERMISSOES.CONFIG_VISUALIZAR)
  @ApiOperation({ summary: 'Todos os serviços, inclusive inativos' })
  async servicos() {
    return this.admin.listarServicos();
  }

  @Post('servicos')
  @ExigePermissao(PERMISSOES.CONFIG_EDITAR)
  @ApiOperation({
    summary: 'Cria serviço',
    description:
      'As flags de comportamento decidem por quais etapas o caso passa (M01 seção 11) - ' +
      'o fluxo é configurado em dados, não em código.',
  })
  async criarServico(@Body() corpo: unknown) {
    return this.admin.criarServico(validarCorpo(servicoSchema, corpo));
  }

  @Post('servicos/:id')
  @ExigePermissao(PERMISSOES.CONFIG_EDITAR)
  @ApiOperation({
    summary: 'Edita serviço',
    description:
      'Vale para casos NOVOS (M01 seção 22): o caso aberto com prazo de 5 dias segue ' +
      'com 5 dias. O código é imutável.',
  })
  async editarServico(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    await this.admin.editarServico(
      id,
      validarCorpo(servicoSchema.partial().omit({ codigo: true }), corpo),
    );
    return { ok: true };
  }

  @Post('servicos/:id/inativacao')
  @ExigePermissao(PERMISSOES.CONFIG_EDITAR)
  @ApiOperation({ summary: 'Inativa serviço - nunca exclui (M01 seção 21)' })
  async inativarServico(@Param('id', ParseUUIDPipe) id: string) {
    await this.admin.alternarServico(id, false);
    return { ok: true };
  }

  @Post('servicos/:id/reativacao')
  @ExigePermissao(PERMISSOES.CONFIG_EDITAR)
  @ApiOperation({ summary: 'Reativa serviço' })
  async reativarServico(@Param('id', ParseUUIDPipe) id: string) {
    await this.admin.alternarServico(id, true);
    return { ok: true };
  }

  // --- tabelas mestres e termos ----------------------------------------------

  @Get('tabelas')
  @ExigePermissao(PERMISSOES.CONFIG_VISUALIZAR)
  @ApiOperation({ summary: 'Tabelas mestres com a contagem de termos ativos' })
  async tabelas() {
    return this.admin.listarTabelas();
  }

  @Get('tabelas/:id/termos')
  @ExigePermissao(PERMISSOES.CONFIG_VISUALIZAR)
  @ApiOperation({ summary: 'Termos da tabela, inclusive inativos' })
  async termos(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.listarTermos(id);
  }

  @Post('tabelas/:id/termos')
  @ExigePermissao(PERMISSOES.TABELA_MESTRE_GERENCIAR)
  @ApiOperation({
    summary: 'Cria termo',
    description:
      'Terminologia controlada (M01 seção 20): valor preferencial, sinônimos e código ' +
      'estável que os demais módulos referenciam.',
  })
  async criarTermo(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    return this.admin.criarTermo(id, validarCorpo(termoSchema, corpo));
  }

  @Post('termos/:id')
  @ExigePermissao(PERMISSOES.TABELA_MESTRE_GERENCIAR)
  @ApiOperation({ summary: 'Edita termo - o código é imutável' })
  async editarTermo(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    await this.admin.editarTermo(
      id,
      validarCorpo(termoSchema.partial().omit({ codigo: true }), corpo),
    );
    return { ok: true };
  }

  @Post('termos/:id/inativacao')
  @ExigePermissao(PERMISSOES.TABELA_MESTRE_GERENCIAR)
  @ApiOperation({
    summary: 'Inativa termo',
    description:
      'Some das opções novas; os casos históricos continuam exibindo o valor (M01 seção 21).',
  })
  async inativarTermo(@Param('id', ParseUUIDPipe) id: string) {
    await this.admin.alternarTermo(id, false);
    return { ok: true };
  }

  @Post('termos/:id/reativacao')
  @ExigePermissao(PERMISSOES.TABELA_MESTRE_GERENCIAR)
  @ApiOperation({ summary: 'Reativa termo' })
  async reativarTermo(@Param('id', ParseUUIDPipe) id: string) {
    await this.admin.alternarTermo(id, true);
    return { ok: true };
  }

  // --- unidades e setores -----------------------------------------------------

  @Get('unidades')
  @ExigePermissao(PERMISSOES.CONFIG_VISUALIZAR)
  @ApiOperation({ summary: 'Unidades com os setores, inclusive inativas' })
  async unidades() {
    return this.admin.listarUnidades();
  }

  @Post('unidades')
  @ExigePermissao(PERMISSOES.UNIDADE_GERENCIAR)
  @ApiOperation({
    summary: 'Cria unidade',
    description:
      'Sede, filial, posto de recebimento, laboratório de apoio ou parceira (M01 seção 7.2). ' +
      'O tipo é imutável: dele deriva o isolamento de acesso do parceiro (M09).',
  })
  async criarUnidade(@Body() corpo: unknown) {
    return this.admin.criarUnidade(validarCorpo(unidadeSchema, corpo));
  }

  @Post('unidades/:id')
  @ExigePermissao(PERMISSOES.UNIDADE_GERENCIAR)
  @ApiOperation({ summary: 'Edita unidade - código e tipo são imutáveis' })
  async editarUnidade(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    await this.admin.editarUnidade(
      id,
      validarCorpo(unidadeSchema.partial().omit({ codigo: true, tipo: true }), corpo),
    );
    return { ok: true };
  }

  @Post('unidades/:id/inativacao')
  @ExigePermissao(PERMISSOES.UNIDADE_GERENCIAR)
  @ApiOperation({ summary: 'Inativa unidade (M01 seção 7.4)' })
  async inativarUnidade(@Param('id', ParseUUIDPipe) id: string) {
    await this.admin.alternarUnidade(id, false);
    return { ok: true };
  }

  @Post('unidades/:id/reativacao')
  @ExigePermissao(PERMISSOES.UNIDADE_GERENCIAR)
  @ApiOperation({ summary: 'Reativa unidade' })
  async reativarUnidade(@Param('id', ParseUUIDPipe) id: string) {
    await this.admin.alternarUnidade(id, true);
    return { ok: true };
  }

  @Post('unidades/:id/setores')
  @ExigePermissao(PERMISSOES.UNIDADE_GERENCIAR)
  @ApiOperation({ summary: 'Cria setor na unidade (M01 seção 8)' })
  async criarSetor(@Param('id', ParseUUIDPipe) id: string, @Body() corpo: unknown) {
    return this.admin.criarSetor(id, validarCorpo(setorSchema, corpo));
  }

  @Post('setores/:id/inativacao')
  @ExigePermissao(PERMISSOES.UNIDADE_GERENCIAR)
  @ApiOperation({ summary: 'Inativa setor' })
  async inativarSetor(@Param('id', ParseUUIDPipe) id: string) {
    await this.admin.alternarSetor(id, false);
    return { ok: true };
  }

  @Post('setores/:id/reativacao')
  @ExigePermissao(PERMISSOES.UNIDADE_GERENCIAR)
  @ApiOperation({ summary: 'Reativa setor' })
  async reativarSetor(@Param('id', ParseUUIDPipe) id: string) {
    await this.admin.alternarSetor(id, true);
    return { ok: true };
  }

  // --- locais fisicos ---------------------------------------------------------

  @Get('locais')
  @ExigePermissao(PERMISSOES.UNIDADE_GERENCIAR)
  @ApiOperation({
    summary: 'Locais físicos, em árvore',
    description:
      'Unidade → sala → equipamento → compartimento → posição. O M01 define o que ' +
      'existe; Controle de Cadáveres e Bioteca registram o que está em cada um.',
  })
  async locais() {
    return this.admin.listarLocais();
  }

  @Post('locais')
  @ExigePermissao(PERMISSOES.UNIDADE_GERENCIAR)
  @ApiOperation({ summary: 'Cria local físico' })
  async criarLocal(@Body() corpo: unknown) {
    return this.admin.criarLocal(validarCorpo(localSchema, corpo));
  }

  @Post('locais/:id/inativacao')
  @ExigePermissao(PERMISSOES.UNIDADE_GERENCIAR)
  @ApiOperation({ summary: 'Inativa local — nunca exclui: a posição guarda histórico' })
  async inativarLocal(@Param('id', ParseUUIDPipe) id: string) {
    await this.admin.alternarLocal(id, false);
    return { ok: true };
  }

  @Post('locais/:id/reativacao')
  @ExigePermissao(PERMISSOES.UNIDADE_GERENCIAR)
  @ApiOperation({ summary: 'Reativa local' })
  async reativarLocal(@Param('id', ParseUUIDPipe) id: string) {
    await this.admin.alternarLocal(id, true);
    return { ok: true };
  }

  // --- calendario -------------------------------------------------------------

  @Get('calendario')
  @ExigePermissao(PERMISSOES.CONFIG_VISUALIZAR)
  @ApiOperation({ summary: 'Dias não úteis da instituição' })
  async calendario() {
    return this.admin.listarDiasNaoUteis();
  }

  @Post('calendario')
  @ExigePermissao(PERMISSOES.CONFIG_EDITAR)
  @ApiOperation({
    summary: 'Adiciona dia não útil',
    description: 'Move o cálculo de previsão em dias úteis do M07 (M01 seção 14).',
  })
  async criarDiaNaoUtil(@Body() corpo: unknown) {
    return this.admin.criarDiaNaoUtil(validarCorpo(diaNaoUtilSchema, corpo));
  }

  @Post('calendario/:id/remocao')
  @ExigePermissao(PERMISSOES.CONFIG_EDITAR)
  @ApiOperation({
    summary: 'Remove dia não útil',
    description:
      'Exceção à regra de inativação: nada aponta para o feriado - ele só participa do ' +
      'cálculo, refeito a cada consulta. A auditoria guarda a remoção.',
  })
  async removerDiaNaoUtil(@Param('id', ParseUUIDPipe) id: string) {
    await this.admin.removerDiaNaoUtil(id);
    return { ok: true };
  }
}

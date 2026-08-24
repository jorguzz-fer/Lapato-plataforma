import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { MODULOS, PERMISSOES, type ContextoCopiloto } from '@lapato/shared';
import { CopilotoFactory } from './copiloto.provider.js';
import { SugestoesService } from './sugestoes.service.js';
import { validarCorpo } from '../http/validacao.js';
import { ExigePermissao } from '../auth/guards.js';

const sugerirSchema = z.object({
  modulo: z.string().min(1),
  etapa: z.string().optional(),
  casoId: z.string().uuid().optional(),
  dados: z.record(z.unknown()).optional(),
});

const feedbackSchema = z.object({
  sugestaoId: z.string().uuid(),
  acao: z.enum(['aceita', 'editada', 'rejeitada', 'ignorada']),
  comentario: z.string().optional(),
});

/**
 * M17 - Inteligencia Artificial.
 *
 * DIRETRIZES secao 9: "o mecanismo de IA pertence ao Modulo 17. Isso evita
 * implementar vinte e seis sistemas de IA diferentes." Os demais modulos
 * consomem estes endpoints; nenhum deles fala com modelo diretamente.
 */
@ApiTags('Inteligência Artificial (M17)')
@Controller('ia')
export class IaController {
  constructor(
    private readonly factory: CopilotoFactory,
    private readonly sugestoes: SugestoesService,
  ) {}

  @Get('status')
  @ApiOperation({
    summary: 'Disponibilidade da assistência de IA',
    description:
      'O front usa isto para exibir "Assistência de IA temporariamente indisponível" ' +
      'sem impedir o trabalho (M17 seções 110-112).',
  })
  status(): { disponivel: boolean; provedor: string } {
    const provedor = this.factory.criar();
    return { disponivel: provedor.disponivel(), provedor: provedor.nome };
  }

  /**
   * `ia:utilizar`, e nao sessao pura: as rotas de sugestao leem contexto de
   * caso, e uma conta externa do Portal tem sessao valida. Com o Copiloto em
   * stub nada vazava; com um LLM real lendo o caso, vazaria. O gate entra
   * antes do provedor real. `status` fica sem permissao de proposito - so
   * informa disponibilidade e o front chama antes de saber o perfil.
   */
  @Post('sugerir')
  @ExigePermissao(PERMISSOES.IA_UTILIZAR)
  @ApiOperation({
    summary: 'Cartões contextuais do LAPATO Copiloto',
    description:
      'O conteúdo varia por módulo e etapa; não é um chatbot genérico (M17 seção 9).',
  })
  async sugerir(@Body() corpo: unknown) {
    const dados = validarCorpo(sugerirSchema, corpo);
    const provedor = this.factory.criar();

    const contexto: ContextoCopiloto = {
      modulo: dados.modulo as ContextoCopiloto['modulo'],
      etapa: dados.etapa,
      casoId: dados.casoId,
      dados: dados.dados,
    };

    const resposta = await provedor.sugerir(contexto);

    // M17 seção 15: toda sugestão apresentada fica registrada, com fontes e
    // modelo, para transparência e para os indicadores de desempenho.
    if (resposta.cartoes.length > 0) {
      await this.sugestoes.registrarCartoes(
        resposta.cartoes,
        dados.modulo,
        dados.casoId ?? null,
        dados.etapa ?? null,
        resposta.modelo ?? provedor.nome,
      );
    }

    return resposta;
  }

  @Post('feedback')
  @ExigePermissao(PERMISSOES.IA_UTILIZAR)
  @ApiOperation({
    summary: 'Registra o que o usuário fez com a sugestão',
    description:
      'Alimenta os indicadores do M17 (apresentadas, aceitas, modificadas, rejeitadas), ' +
      'que a documentação ressalva serem para melhoria do sistema, não avaliação individual.',
  })
  async feedback(@Body() corpo: unknown): Promise<{ ok: true }> {
    const dados = validarCorpo(feedbackSchema, corpo);
    await this.sugestoes.registrarFeedback(dados);
    return { ok: true };
  }

  @Get('modulos')
  @ApiOperation({ summary: 'Módulos oficiais do LAPATO' })
  modulos(): Record<string, string> {
    return MODULOS;
  }
}

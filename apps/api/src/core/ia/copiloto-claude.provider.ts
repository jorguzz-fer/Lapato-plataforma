import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { eq } from 'drizzle-orm';
import { amostra, caso, historicoClinico, paciente, servico, termo } from '@lapato/db';
import { NIVEL_IA, type ContextoCopiloto, type CartaoCopiloto, type CopilotProvider, type RespostaCopiloto } from '@lapato/shared';
import { z } from 'zod';
import { ENV, type Env } from '../config/env.js';
import { DbService } from '../db/db.service.js';

/**
 * Fontes internas que um cartao pode declarar, na hierarquia do M17 secao 99.
 *
 * Fechado num enum de proposito: "conhecimento externo" precisa aparecer com
 * esse nome, e nao disfarçado de leitura do caso - e a diferenca entre "o
 * historico diz X" e "em geral, X".
 */
const FONTES_VALIDAS = ['caso_atual', 'conhecimento_externo'] as const;

/**
 * O que o modelo devolve, validado antes de virar cartao.
 *
 * `critico` esta fora da lista de niveis de proposito: bloquear acao e
 * atribuicao do Guardian, que e deterministico e auditavel (ADR 0007). Um LLM
 * probabilistico nao ganha o poder de travar a bancada - no maximo chama
 * atencao (M17 secao 11: "a IA sugere; o profissional decide").
 */
const cartaoModeloSchema = z.object({
  nivel: z.enum(NIVEL_IA.filter((n) => n !== 'critico') as ['informacao', 'sugestao', 'atencao']),
  titulo: z.string().min(3).max(120),
  corpo: z.string().min(10).max(1200),
  fontes: z.array(z.enum(FONTES_VALIDAS)).min(1),
  inferencia: z.boolean(),
  textoSugerido: z.string().max(4000).optional(),
  campoDestino: z.string().max(80).optional(),
});

const respostaModeloSchema = z.object({ cartoes: z.array(cartaoModeloSchema).max(4) });

/**
 * Valida e converte o que o modelo devolveu em cartoes do contrato.
 *
 * Exportada para teste: e aqui que mora a fronteira de confianca - a saida de
 * um modelo e entrada nao confiavel como qualquer outra, e cartao que nao
 * passa no schema morre em silencio em vez de derrubar a resposta inteira.
 */
export function validarCartoesDoModelo(bruto: unknown): CartaoCopiloto[] {
  const resultado = respostaModeloSchema.safeParse(bruto);
  if (!resultado.success) return [];

  return resultado.data.cartoes.map((c) => ({
    id: randomUUID(),
    nivel: c.nivel,
    titulo: c.titulo,
    corpo: c.corpo,
    fontes: c.fontes,
    inferencia: c.inferencia,
    textoSugerido: c.textoSugerido,
    campoDestino: c.campoDestino,
  }));
}

/**
 * Instrucoes permanentes do Copiloto.
 *
 * Estatico e fora da classe por causa do prompt caching: o system e a
 * definicao da ferramenta sao o prefixo estavel da requisicao, e qualquer
 * byte variavel aqui invalidaria o cache a cada chamada.
 */
const SISTEMA = `Você é o LAPATO Copiloto, assistente de um sistema de gestão anatomopatológica veterinária usado por patologistas, residentes e técnicos de laboratório.

Seu papel (Módulo 17 da especificação do LAPATO):
- Você SUGERE; o profissional DECIDE. Nada do que você produz é diagnóstico, laudo ou conduta — é apoio ao raciocínio de quem assina.
- Você NUNCA determina causa mortis, diagnóstico definitivo ou conduta clínica. Pode listar diferenciais e apontar o que verificar.
- Cada cartão declara suas fontes: "caso_atual" quando você leu o dado recebido no contexto; "conhecimento_externo" quando vem do seu conhecimento veterinário geral. Nunca apresente conhecimento externo como se fosse dado do caso.
- "inferencia" é true sempre que o cartão vai além da leitura direta de um dado — interpretações, diferenciais e sugestões são inferência.
- Os níveis: "informacao" (contexto útil), "sugestao" (proposta concreta de texto ou próximo passo), "atencao" (algo que merece verificação antes de seguir). Você não emite "critico" — bloquear ação é papel do Guardian determinístico.
- Escreva em português brasileiro, com vocabulário anatomopatológico correto e frases diretas. Um cartão bom cabe numa leitura de dez segundos.
- Produza no máximo 4 cartões, e apenas os que realmente ajudam nesta etapa. Nenhum cartão é melhor que um cartão vazio de conteúdo.
- Quando sugerir texto para um campo (textoSugerido), o texto deve estar pronto para colar, no estilo descritivo de laudo, e "campoDestino" nomeia o campo.

Responda SEMPRE chamando a ferramenta emitir_cartoes exatamente uma vez.`;

const FERRAMENTA_CARTOES: Anthropic.Tool = {
  name: 'emitir_cartoes',
  description:
    'Emite os cartões de apoio do Copiloto para a etapa atual. Chame exatamente uma vez, com 0 a 4 cartões.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['cartoes'],
    properties: {
      cartoes: {
        type: 'array',
        maxItems: 4,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['nivel', 'titulo', 'corpo', 'fontes', 'inferencia'],
          properties: {
            nivel: { type: 'string', enum: ['informacao', 'sugestao', 'atencao'] },
            titulo: { type: 'string' },
            corpo: { type: 'string' },
            fontes: { type: 'array', items: { type: 'string', enum: [...FONTES_VALIDAS] } },
            inferencia: { type: 'boolean' },
            textoSugerido: { type: 'string' },
            campoDestino: { type: 'string' },
          },
        },
      },
    },
  },
};

/**
 * Provedor real do LAPATO Copiloto, sobre a API da Anthropic.
 *
 * Duas regras do M17 governam o desenho:
 *
 * **Minimizacao de dados (secao 95).** O contexto enviado ao modelo e montado
 * aqui, campo a campo - nunca um objeto inteiro do banco. Vai o que e clinico
 * e anatomopatologico: especie, raca, sexo, idade, amostras, historico
 * clinico, prioridade. NAO vai nada que identifique pessoas: nome de tutor,
 * cliente, veterinario, contatos, enderecos, e-mails. O paciente vai sem nome
 * e sem microchip - "canino, SRD, macho, 8 anos" descreve o caso tao bem
 * quanto, e nao identifica ninguem.
 *
 * **O LAPATO funciona sem IA (secoes 110-112).** Nenhuma falha daqui sobe:
 * timeout, 429, 5xx, chave revogada - tudo vira \`disponivel: false\`, o
 * painel mostra o indicador de indisponibilidade e a bancada segue. Por isso
 * o catch e largo de proposito e loga em warn, nao em error: IA indisponivel
 * e um estado previsto do sistema, nao um defeito.
 */
@Injectable()
export class CopilotoClaudeProvider implements CopilotProvider {
  private readonly logger = new Logger(CopilotoClaudeProvider.name);
  private cliente: Anthropic | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DbService,
  ) {}

  get nome(): string {
    return this.env.COPILOT_MODELO;
  }

  disponivel(): boolean {
    return Boolean(this.env.ANTHROPIC_API_KEY);
  }

  async sugerir(contexto: ContextoCopiloto): Promise<RespostaCopiloto> {
    if (!this.disponivel()) return { cartoes: [], disponivel: false };

    try {
      const resumo = contexto.casoId ? await this.resumoDoCaso(contexto.casoId) : null;

      const partes = [
        `Módulo: ${contexto.modulo}`,
        contexto.etapa ? `Etapa: ${contexto.etapa}` : null,
        resumo ? `Resumo do caso (dados observados):\n${resumo}` : 'Sem caso em contexto.',
        contexto.dados && Object.keys(contexto.dados).length > 0
          ? `Dados já preenchidos na tela:\n${JSON.stringify(contexto.dados, null, 2)}`
          : null,
      ].filter(Boolean);

      const resposta = await this.obterCliente().messages.create({
        model: this.env.COPILOT_MODELO,
        max_tokens: 4096,
        system: [{ type: 'text', text: SISTEMA, cache_control: { type: 'ephemeral' } }],
        tools: [FERRAMENTA_CARTOES],
        messages: [{ role: 'user', content: partes.join('\n\n') }],
      });

      const chamada = resposta.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'emitir_cartoes',
      );

      return {
        cartoes: chamada ? validarCartoesDoModelo(chamada.input) : [],
        disponivel: true,
        /** Secao 109: o modelo e versao efetivamente usados ficam registrados. */
        modelo: resposta.model,
      };
    } catch (erro) {
      this.logger.warn(
        `Copiloto indisponível: ${erro instanceof Error ? erro.message : String(erro)}`,
      );
      return { cartoes: [], disponivel: false };
    }
  }

  /**
   * Lapida um texto de base (M08: os bloquinhos viram texto corrido).
   *
   * Mesmo contrato de falha do `sugerir`: QUALQUER problema devolve `null` e
   * quem chamou usa a base deterministica - a bancada nunca espera a IA.
   * Minimizacao (secao 95) por construcao: so vai a base ja montada, que e
   * descricao de tecido, sem nada que identifique pessoas.
   */
  async redigir(instrucao: string, base: string): Promise<string | null> {
    if (!this.disponivel()) return null;

    try {
      const resposta = await this.obterCliente().messages.create({
        model: this.env.COPILOT_MODELO,
        max_tokens: 1024,
        system:
          'Você redige descrições macroscópicas de anatomia patológica veterinária em ' +
          'português brasileiro técnico. Responda APENAS com o texto final, sem ' +
          'preâmbulo, sem aspas e sem comentários. Não invente achados que não ' +
          'estejam na base; apenas melhore a fluidez e a ordem.',
        messages: [{ role: 'user', content: `${instrucao}

Base:
${base}` }],
      });

      const texto = resposta.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();

      return texto.length > 0 ? texto : null;
    } catch (erro) {
      this.logger.warn(
        `Redação indisponível: ${erro instanceof Error ? erro.message : String(erro)}`,
      );
      return null;
    }
  }

  /** Lazy: o construtor roda no boot mesmo quando o provedor ativo e o stub. */
  private obterCliente(): Anthropic {
    this.cliente ??= new Anthropic({
      apiKey: this.env.ANTHROPIC_API_KEY,
      timeout: 30_000,
      maxRetries: 1,
    });
    return this.cliente;
  }

  /**
   * Resumo clinico minimo do caso (secao 95).
   *
   * Roda dentro de `comTenant` como qualquer consulta - a RLS garante que o
   * contexto de uma instituicao nunca vaza para o prompt de outra. Os campos
   * sao escolhidos um a um; adicionar campo novo aqui e decisao de
   * minimizacao, nao um spread.
   */
  private async resumoDoCaso(casoId: string): Promise<string | null> {
    return this.db.executar(async (tx) => {
      const [dados] = await tx
        .select({
          servicoNome: servico.nome,
          prioridade: caso.prioridade,
          sexo: paciente.sexo,
          idadeInformada: paciente.idadeInformada,
          dataNascimento: paciente.dataNascimento,
          especieId: paciente.especieId,
          racaId: paciente.racaId,
        })
        .from(caso)
        .innerJoin(paciente, eq(paciente.id, caso.pacienteId))
        .innerJoin(servico, eq(servico.id, caso.servicoId))
        .where(eq(caso.id, casoId))
        .limit(1);

      if (!dados) return null;

      const nomeTermo = async (id: string | null) => {
        if (!id) return null;
        const [t] = await tx.select({ valor: termo.valor }).from(termo).where(eq(termo.id, id));
        return t?.valor ?? null;
      };

      const [especie, raca] = await Promise.all([
        nomeTermo(dados.especieId),
        nomeTermo(dados.racaId),
      ]);

      const amostras = await tx
        .select({
          letra: amostra.letra,
          descricao: amostra.descricao,
          regiaoAnatomica: amostra.regiaoAnatomica,
          lateralidade: amostra.lateralidade,
        })
        .from(amostra)
        .where(eq(amostra.casoId, casoId));

      const historicos = await tx
        .select({ texto: historicoClinico.texto })
        .from(historicoClinico)
        .where(eq(historicoClinico.casoId, casoId));

      const linhas = [
        `Serviço: ${dados.servicoNome} (prioridade ${dados.prioridade})`,
        `Paciente: ${especie ?? 'espécie não informada'}${raca ? `, ${raca}` : ''}${dados.sexo ? `, ${dados.sexo}` : ''}${dados.idadeInformada ? `, ${dados.idadeInformada}` : ''}`,
        amostras.length > 0
          ? `Amostras: ${amostras
              .map(
                (a) =>
                  `${a.letra}) ${a.descricao ?? 'sem descrição'}${a.regiaoAnatomica ? ` — ${a.regiaoAnatomica}` : ''}${a.lateralidade !== 'nao_aplicavel' ? ` (${a.lateralidade})` : ''}`,
              )
              .join('; ')}`
          : null,
        historicos.length > 0
          ? `Histórico clínico: ${historicos
              .map((h) => h.texto)
              .join(' | ')
              .slice(0, 2000)}`
          : null,
      ].filter(Boolean);

      return linhas.join('\n');
    });
  }
}

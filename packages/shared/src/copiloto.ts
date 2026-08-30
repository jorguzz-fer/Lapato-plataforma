import type { AcaoSugestao, NivelIa } from './enums.js';
import type { Modulo } from './modulos.js';

/**
 * Contrato do LAPATO Copiloto (M17).
 *
 * M17 secao 9: o painel nao e um chatbot generico - o conteudo muda conforme o
 * modulo e a etapa. Por isso o provedor recebe um contexto tipado e devolve
 * cartoes, nao uma string solta.
 *
 * M17 secoes 110-112: o LAPATO deve funcionar sem IA. A implementacao padrao
 * desta fase e um stub; o provedor real entra depois sem alterar as telas.
 * Ver docs/adr/0007.
 */

export interface ContextoCopiloto {
  modulo: Modulo;
  /** Etapa dentro do modulo, ex.: 'descricao_macroscopica'. */
  etapa?: string;
  casoId?: string;
  /** Dados ja preenchidos na tela, para o provedor nao pedir o que ja existe. */
  dados?: Record<string, unknown>;
}

/**
 * M17 secao 15: toda sugestao indica que foi produzida pela IA, quais dados
 * usou, quais fontes consultou e se houve inferencia - para nao ser confundida
 * com dado observado.
 */
export interface CartaoCopiloto {
  id: string;
  nivel: NivelIa;
  titulo: string;
  corpo: string;
  /**
   * Fontes internas consultadas, na hierarquia do M17 secao 99:
   * caso atual > regras institucionais > protocolos > biblioteca >
   * casos anteriores autorizados > conhecimento externo.
   */
  fontes: string[];
  /** True quando o conteudo e inferencia, e nao leitura direta de um dado. */
  inferencia: boolean;
  /** Texto proposto para um campo, quando o cartao for uma sugestao de redacao. */
  textoSugerido?: string;
  /** Campo de destino do `textoSugerido`. */
  campoDestino?: string;
}

export interface RespostaCopiloto {
  cartoes: CartaoCopiloto[];
  /**
   * M17 secao 110: quando false, o front mostra o indicador "Assistência de IA
   * temporariamente indisponível" e o trabalho segue normalmente.
   */
  disponivel: boolean;
  /** Modelo e versao efetivamente usados, registrados junto da sugestao. */
  modelo?: string;
}

/**
 * Interface que o modulo de IA expõe aos demais modulos.
 *
 * DIRETRIZES secao 9: "o mecanismo de IA pertence ao Modulo 17. Isso evita
 * implementar vinte e seis sistemas de IA diferentes."
 */
export interface CopilotProvider {
  readonly nome: string;
  disponivel(): boolean;
  sugerir(contexto: ContextoCopiloto): Promise<RespostaCopiloto>;
  /**
   * Lapida um texto de base seguindo uma instrucao curta (ex.: transformar a
   * composicao deterministica dos bloquinhos da macroscopia em texto corrido).
   *
   * OPCIONAL e com contrato de falha silenciosa: devolver `null` significa
   * "use a base como esta". E o que garante o M17 secao 110 - o LAPATO
   * funciona sem IA, e a base deterministica ja e publicavel.
   */
  redigir?(instrucao: string, base: string): Promise<string | null>;
}

/** Registro do que o usuario fez com a sugestao (M17 secao 15). */
export interface FeedbackSugestao {
  sugestaoId: string;
  acao: AcaoSugestao;
  comentario?: string;
}

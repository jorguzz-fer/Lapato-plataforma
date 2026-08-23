import { z } from 'zod';
import type { Modulo } from './modulos.js';

/**
 * Contratos dos eventos de dominio.
 *
 * DIRETRIZES secao 17: a integracao entre modulos e orientada a eventos. Ao
 * liberar um laudo, o patologista executa apenas "Liberar laudo" - atualizar
 * status, publicar no portal, notificar e registrar auditoria sao consequencias
 * automatizadas, nao passos manuais.
 *
 * DIRETRIZES secao 13: os eventos alimentam UMA linha do tempo por caso, que
 * pertence a infraestrutura de rastreamento e nao e reproduzida por modulo.
 */

/**
 * M07: classificacao de visibilidade. Define o que pode aparecer no Portal do
 * Cliente e o que fica restrito.
 */
export const VISIBILIDADE_EVENTO = [
  'interno',
  'externo',
  'restrito',
  'pericial',
  'administrativo',
] as const;
export type VisibilidadeEvento = (typeof VISIBILIDADE_EVENTO)[number];

/** Nomes dos eventos de dominio conhecidos nesta fase. */
export const TIPO_EVENTO = [
  // M05 Recebimento e Cadastro
  'caso.criado',
  'caso.cadastro_confirmado',
  'caso.cancelado',
  'material.recebido',
  'recipiente.recebido',
  'divergencia.identificada',
  'etiqueta.impressa',
  // M06 Triagem
  'triagem.iniciada',
  'triagem.concluida.apta',
  'triagem.concluida.ressalva',
  'triagem.bloqueada',
  'material.recusado',
  'nao_conformidade.registrada',
  // M08 Macroscopia
  'macroscopia.iniciada',
  'macroscopia.concluida',
  'cassetes.gerados',
  // M09 Processamento
  'lote.enviado',
  'cassetes.recebidos_parceiro',
  'divergencia.cassetes',
  'laminas.disponiveis',
  // M10 Solicitacoes e Pendencias
  'solicitacao.criada',
  'solicitacao.concluida',
  'pendencia.criada',
  'pendencia.resolvida',
  // M11 Laudos
  'microscopia.iniciada',
  'laudo.rascunho_salvo',
  'laudo.enviado_revisao',
  'laudo.reaberto_para_edicao',

  // M14 Necropsia
  'necropsia.iniciada',
  'necropsia.concluida',
  'necropsia.reaberta',

  // M15 Controle de Cadaveres
  'cadaver.recebido',
  'cadaver.liberado',
  'cadaver.retirado',

  // M18 Bioteca e Gestao de Acervo Biologico
  'bioteca.objeto_arquivado',
  'bioteca.material_esgotado',
  'bioteca.material_emprestado',
  'bioteca.material_descartado',
  'laudo.revisao_concluida',
  'laudo.assinado',
  'laudo.liberado',
  'laudo.adendo_criado',
  'laudo.corrigido',
  // M04 Portal do Cliente
  'historico.complementado',
  // M16 Imagens
  'imagem.anexada',
  // M07 Rastreamento (derivados)
  'fluxo.etapa_alterada',
  'fluxo.bloqueado',
  'fluxo.desbloqueado',
  'fluxo.prazo_recalculado',
] as const;
export type TipoEvento = (typeof TIPO_EVENTO)[number];

/**
 * Envelope comum a todo evento de dominio.
 *
 * `ocorridoEm` e o instante do fato; `registradoEm` e quando o sistema gravou.
 * Sao coisas diferentes (M16 faz a mesma distincao entre data de captura e data
 * de upload) e a linha do tempo ordena pelo primeiro.
 */
export const envelopeEventoSchema = z.object({
  id: z.string().uuid(),
  tipo: z.enum(TIPO_EVENTO),
  tenantId: z.string().uuid(),
  /** Caso relacionado. Ausente em eventos que nao pertencem a um caso. */
  casoId: z.string().uuid().nullable(),
  moduloOrigem: z.string(),
  /** Autor humano da acao. Nulo quando o evento e produzido pelo sistema. */
  usuarioId: z.string().uuid().nullable(),
  unidadeId: z.string().uuid().nullable(),
  /** Objeto afetado, quando o evento se refere a algo mais granular que o caso. */
  objetoTipo: z.string().nullable(),
  objetoId: z.string().uuid().nullable(),
  visibilidade: z.enum(VISIBILIDADE_EVENTO),
  payload: z.record(z.unknown()),
  ocorridoEm: z.coerce.date(),
  registradoEm: z.coerce.date(),
});

export type EnvelopeEvento = z.infer<typeof envelopeEventoSchema>;

/** Dados necessarios para publicar um evento; o resto o publisher preenche. */
export interface NovoEvento {
  tipo: TipoEvento;
  casoId?: string | null;
  moduloOrigem: Modulo;
  objetoTipo?: string | null;
  objetoId?: string | null;
  visibilidade?: VisibilidadeEvento;
  payload?: Record<string, unknown>;
  /** Quando o fato aconteceu, se diferente de agora. */
  ocorridoEm?: Date;
}

/**
 * Rotulos exibidos na linha do tempo do caso.
 * Escritos como fato consumado, no formato que o M07 usa nos exemplos.
 */
export const EVENTO_LABEL: Record<TipoEvento, string> = {
  'caso.criado': 'Caso cadastrado',
  'caso.cadastro_confirmado': 'Cadastro confirmado',
  'caso.cancelado': 'Caso cancelado',
  'material.recebido': 'Material recebido',
  'recipiente.recebido': 'Recipiente conferido',
  'divergencia.identificada': 'Divergência identificada',
  'etiqueta.impressa': 'Etiqueta impressa',
  'triagem.iniciada': 'Triagem iniciada',
  'triagem.concluida.apta': 'Triagem concluída — apto',
  'triagem.concluida.ressalva': 'Triagem concluída — apto com ressalva',
  'triagem.bloqueada': 'Triagem bloqueada',
  'material.recusado': 'Material recusado',
  'nao_conformidade.registrada': 'Não conformidade registrada',
  'macroscopia.iniciada': 'Macroscopia iniciada',
  'macroscopia.concluida': 'Macroscopia concluída',
  'cassetes.gerados': 'Cassetes gerados',
  'lote.enviado': 'Lote enviado ao processamento',
  'cassetes.recebidos_parceiro': 'Cassetes confirmados pelo laboratório de apoio',
  'divergencia.cassetes': 'Divergência de cassetes apontada',
  'laminas.disponiveis': 'Lâminas disponíveis',
  'solicitacao.criada': 'Solicitação criada',
  'solicitacao.concluida': 'Solicitação concluída',
  'pendencia.criada': 'Pendência criada',
  'pendencia.resolvida': 'Pendência resolvida',
  'microscopia.iniciada': 'Microscopia iniciada',
  'laudo.rascunho_salvo': 'Rascunho de laudo salvo',
  'laudo.enviado_revisao': 'Laudo enviado para revisão',
  'laudo.reaberto_para_edicao': 'Laudo retomado para edição',
  'necropsia.iniciada': 'Necropsia iniciada',
  'necropsia.concluida': 'Necropsia concluída',
  'necropsia.reaberta': 'Necropsia reaberta para correção',
  'cadaver.recebido': 'Cadáver recebido',
  'cadaver.liberado': 'Cadáver liberado para retirada',
  'cadaver.retirado': 'Cadáver retirado do laboratório',
  'bioteca.objeto_arquivado': 'Material arquivado no acervo biológico',
  'bioteca.material_esgotado': 'Material esgotado — não há mais tecido útil',
  'bioteca.material_emprestado': 'Material emprestado',
  'bioteca.material_descartado': 'Material destinado',
  'laudo.revisao_concluida': 'Revisão concluída',
  'laudo.assinado': 'Laudo assinado',
  'laudo.liberado': 'Laudo liberado',
  'laudo.adendo_criado': 'Adendo criado',
  'laudo.corrigido': 'Laudo corrigido',
  'historico.complementado': 'Histórico clínico complementado pelo cliente',
  'imagem.anexada': 'Imagem anexada ao caso',
  'fluxo.etapa_alterada': 'Etapa alterada',
  'fluxo.bloqueado': 'Fluxo bloqueado',
  'fluxo.desbloqueado': 'Fluxo desbloqueado',
  'fluxo.prazo_recalculado': 'Prazo recalculado',
};

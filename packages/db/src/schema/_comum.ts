import { pgEnum, timestamp, uuid } from 'drizzle-orm/pg-core';
import {
  ADEQUACAO_CITOLOGICA,
  CAVIDADE_NECROPSIA,
  CLASSIFICACAO_LESAO,
  CONSERVACAO_CADAVER,
  CONSERVACAO_NECROPSIA,
  ESTADO_EXAME_ORGAO,
  GRAU_CERTEZA_CAUSA,
  MECANISMO_TERMINAL,
  MODALIDADE_NECROPSIA,
  RELACAO_LESAO,
  DESTINACAO_CADAVER,
  EMBALAGEM_CADAVER,
  IDENTIFICACAO_EXTERNA,
  INTEGRIDADE_CADAVER,
  STATUS_CADAVER,
  TIPO_BLOQUEIO_CADAVER,
  TIPO_MOVIMENTACAO_CADAVER,
  ALERTA_PRAZO,
  CELULARIDADE,
  CATEGORIA_USUARIO,
  ETAPA,
  FORMA_ENTREGA,
  GRAVIDADE_NC,
  INTENSIDADE,
  LATERALIDADE,
  METODO_AMOSTRAGEM,
  NIVEL_BLOQUEIO,
  NIVEL_IA,
  NIVEL_IMAGEM,
  ORIGEM_IMAGEM,
  PRESERVACAO_CELULAR,
  PRIORIDADE,
  RESULTADO_MARGEM,
  RESULTADO_TRIAGEM,
  STATUS_CLIENTE,
  STATUS_LAUDO,
  STATUS_PENDENCIA,
  STATUS_SOLICITACAO,
  STATUS_USUARIO,
  TIPO_CLIENTE,
  TIPO_IMAGEM,
  TIPO_UNIDADE,
  TIPO_VERSAO_LAUDO,
  VISIBILIDADE_EVENTO,
} from '@lapato/shared';

/**
 * Enums do banco, derivados dos enums de dominio em @lapato/shared.
 *
 * Manter a definicao unica evita que o banco e a aplicacao discordem sobre
 * quais valores existem - o tipo de bug que so aparece em producao.
 */
export const tipoUnidadeEnum = pgEnum('tipo_unidade', TIPO_UNIDADE);
export const statusUsuarioEnum = pgEnum('status_usuario', STATUS_USUARIO);
export const categoriaUsuarioEnum = pgEnum('categoria_usuario', CATEGORIA_USUARIO);
export const tipoClienteEnum = pgEnum('tipo_cliente', TIPO_CLIENTE);
export const statusClienteEnum = pgEnum('status_cliente', STATUS_CLIENTE);
export const formaEntregaEnum = pgEnum('forma_entrega', FORMA_ENTREGA);
export const resultadoTriagemEnum = pgEnum('resultado_triagem', RESULTADO_TRIAGEM);
export const gravidadeNcEnum = pgEnum('gravidade_nc', GRAVIDADE_NC);
export const etapaEnum = pgEnum('etapa', ETAPA);
export const alertaPrazoEnum = pgEnum('alerta_prazo', ALERTA_PRAZO);
export const prioridadeEnum = pgEnum('prioridade', PRIORIDADE);
export const statusSolicitacaoEnum = pgEnum('status_solicitacao', STATUS_SOLICITACAO);
export const statusPendenciaEnum = pgEnum('status_pendencia', STATUS_PENDENCIA);
export const nivelBloqueioEnum = pgEnum('nivel_bloqueio', NIVEL_BLOQUEIO);
export const metodoAmostragemEnum = pgEnum('metodo_amostragem', METODO_AMOSTRAGEM);
export const lateralidadeEnum = pgEnum('lateralidade', LATERALIDADE);
export const resultadoMargemEnum = pgEnum('resultado_margem', RESULTADO_MARGEM);
export const statusLaudoEnum = pgEnum('status_laudo', STATUS_LAUDO);
export const tipoVersaoLaudoEnum = pgEnum('tipo_versao_laudo', TIPO_VERSAO_LAUDO);
export const adequacaoCitologicaEnum = pgEnum('adequacao_citologica', ADEQUACAO_CITOLOGICA);
export const celularidadeEnum = pgEnum('celularidade', CELULARIDADE);
export const preservacaoCelularEnum = pgEnum('preservacao_celular', PRESERVACAO_CELULAR);
export const intensidadeEnum = pgEnum('intensidade', INTENSIDADE);
export const tipoImagemEnum = pgEnum('tipo_imagem', TIPO_IMAGEM);
export const origemImagemEnum = pgEnum('origem_imagem', ORIGEM_IMAGEM);
export const nivelImagemEnum = pgEnum('nivel_imagem', NIVEL_IMAGEM);
export const nivelIaEnum = pgEnum('nivel_ia', NIVEL_IA);
export const visibilidadeEventoEnum = pgEnum('visibilidade_evento', VISIBILIDADE_EVENTO);

/**
 * Colunas presentes em toda tabela de dominio.
 *
 * `tenantId` e a chave do isolamento multi-instituicao (ADR 0002). Ela existe
 * em TODA tabela de dominio, e as policies de RLS a usam. A aplicacao tambem
 * filtra por ela - defesa em profundidade, nao redundancia inutil.
 */
export const colunasTenant = {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
};

/**
 * Blueprint secao 10: `timestamptz` sempre. Guardar horario sem fuso num
 * sistema que registra cadeia de custodia e pedir problema.
 */
export const colunasTempo = {
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
};

/**
 * M01: a regra e **inativar, nunca excluir**. Serviços, setores, unidades,
 * terminologias e tabelas somem de novos registros mas permanecem nos casos
 * historicos e disponiveis para auditoria.
 */
export const colunasInativacao = {
  inativadoEm: timestamp('inativado_em', { withTimezone: true }),
  inativadoPor: uuid('inativado_por'),
};

// --- M15 Controle de Cadaveres ---------------------------------------------
export const statusCadaverEnum = pgEnum('status_cadaver', STATUS_CADAVER);
export const conservacaoCadaverEnum = pgEnum('conservacao_cadaver', CONSERVACAO_CADAVER);
export const embalagemCadaverEnum = pgEnum('embalagem_cadaver', EMBALAGEM_CADAVER);
export const integridadeCadaverEnum = pgEnum('integridade_cadaver', INTEGRIDADE_CADAVER);
export const identificacaoExternaEnum = pgEnum('identificacao_externa', IDENTIFICACAO_EXTERNA);
export const tipoMovimentacaoCadaverEnum = pgEnum(
  'tipo_movimentacao_cadaver',
  TIPO_MOVIMENTACAO_CADAVER,
);
export const tipoBloqueioCadaverEnum = pgEnum('tipo_bloqueio_cadaver', TIPO_BLOQUEIO_CADAVER);
export const destinacaoCadaverEnum = pgEnum('destinacao_cadaver', DESTINACAO_CADAVER);

// --- M14 Necropsia ---------------------------------------------------------
export const modalidadeNecropsiaEnum = pgEnum('modalidade_necropsia', MODALIDADE_NECROPSIA);
export const conservacaoNecropsiaEnum = pgEnum('conservacao_necropsia', CONSERVACAO_NECROPSIA);
export const cavidadeNecropsiaEnum = pgEnum('cavidade_necropsia', CAVIDADE_NECROPSIA);
export const estadoExameOrgaoEnum = pgEnum('estado_exame_orgao', ESTADO_EXAME_ORGAO);
export const classificacaoLesaoEnum = pgEnum('classificacao_lesao', CLASSIFICACAO_LESAO);
export const mecanismoTerminalEnum = pgEnum('mecanismo_terminal', MECANISMO_TERMINAL);
export const grauCertezaCausaEnum = pgEnum('grau_certeza_causa', GRAU_CERTEZA_CAUSA);
/**
 * `tipo_relacao_lesao`, e nao `relacao_lesao`: o Postgres cria um tipo composto
 * implicito com o nome de cada tabela, e a tabela `relacao_lesao` colidiria com
 * o enum de mesmo nome.
 */
export const relacaoLesaoEnum = pgEnum('tipo_relacao_lesao', RELACAO_LESAO);

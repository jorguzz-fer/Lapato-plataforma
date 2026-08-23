import { relations } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  cavidadeNecropsiaEnum,
  classificacaoLesaoEnum,
  colunasTempo,
  colunasTenant,
  conservacaoNecropsiaEnum,
  estadoExameOrgaoEnum,
  grauCertezaCausaEnum,
  mecanismoTerminalEnum,
  modalidadeNecropsiaEnum,
  relacaoLesaoEnum,
} from './_comum.js';
import { cadaver } from './cadaveres.js';
import { caso } from './caso.js';
import { usuario } from './identidade.js';

/**
 * M14 - Necropsia.
 *
 * A necropsia e uma modalidade diagnostica propria, com particularidades que a
 * separam da citologia e da histopatologia (secao 1): pode ser solicitada pelo
 * tutor, dispensa medico-veterinario solicitante, exige autorizacao para exame
 * cadaverico e termina numa reconstrucao fisiopatologica da morte - nao num
 * diagnostico de lesao.
 *
 * O que este schema NAO guarda, porque pertence a outros modulos (secao 162): a
 * localizacao fisica do corpo (M15), os arquivos de imagem (M16), o
 * processamento histologico (M09) e o versionamento do documento (M11).
 */

export const necropsia = pgTable(
  'necropsia',
  {
    ...colunasTenant,
    casoId: uuid('caso_id')
      .notNull()
      .references(() => caso.id),
    /**
     * Vinculo com o corpo sob custodia (M15). Opcional porque a necropsia pode
     * ser aberta antes de o registro fisico existir - mas quando existe, e por
     * ele que se sabe onde o material esta.
     */
    cadaverId: uuid('cadaver_id').references(() => cadaver.id),
    modalidade: modalidadeNecropsiaEnum('modalidade').notNull().default('diagnostica'),

    /**
     * Secao 4: a necropsia NAO exige medico-veterinario solicitante - pode ser
     * pedida pelo tutor, por seguradora, por autoridade. Mas "devera existir
     * sempre um RESPONSAVEL PELA SOLICITACAO com identificacao e forma de
     * contato" (secao 163). O veterinario continua no caso, opcional.
     */
    responsavelSolicitacao: text('responsavel_solicitacao').notNull(),
    contatoResponsavel: text('contato_responsavel'),

    /** Secoes 24 e 163: o estado de conservacao condiciona tudo o que se conclui. */
    conservacao: conservacaoNecropsiaEnum('conservacao'),
    obitoEm: timestamp('obito_em', { withTimezone: true }),

    /** Secao 14: o que se sabe sobre como o animal morreu, em texto do solicitante. */
    circunstanciasMorte: text('circunstancias_morte'),
    /** Secao 19: o que o solicitante quer que a necropsia responda. */
    perguntasSolicitante: text('perguntas_solicitante'),

    /** Secao 57: peso, escore corporal, mucosas, orificios, intervencoes medicas. */
    exameExterno: jsonb('exame_externo').$type<Record<string, unknown>>().default({}),

    /**
     * Secao 119: autolise, congelamento, historico insuficiente, ausencia de
     * toxicologia. Vao para o laudo porque a secao 120 exige que o impacto
     * delas sobre a conclusao fique explicito.
     */
    limitacoes: jsonb('limitacoes').$type<string[]>().default([]),
    limitacoesObservacao: text('limitacoes_observacao'),

    iniciadaEm: timestamp('iniciada_em', { withTimezone: true }).notNull().defaultNow(),
    iniciadaPorId: uuid('iniciada_por_id').references(() => usuario.id),
    concluidaEm: timestamp('concluida_em', { withTimezone: true }),

    ...colunasTempo,
  },
  (t) => [
    unique('uq_necropsia_caso').on(t.tenantId, t.casoId),
    index('idx_necropsia_caso').on(t.tenantId, t.casoId),
  ],
);

/**
 * Exame de um orgao (secoes 63 e 68-72).
 *
 * Organizado por cavidade → sistema → orgao. A regra que da forma a esta tabela
 * esta na secao 163: **"nao examinado" devera ser diferente de "sem
 * alteracoes"**. Por isso `estado` e um enum de tres valores e nao um campo de
 * texto opcional: um orgao ausente da lista e um orgao sobre o qual nada se
 * sabe, e o checklist de completude (secao 72) depende dessa diferenca.
 */
export const exameOrgao = pgTable(
  'exame_orgao',
  {
    ...colunasTenant,
    necropsiaId: uuid('necropsia_id')
      .notNull()
      .references(() => necropsia.id),
    cavidade: cavidadeNecropsiaEnum('cavidade').notNull(),
    /** Sistema anatomico: cardiovascular, respiratorio, digestorio... (secao 68). */
    sistema: text('sistema'),
    orgao: text('orgao').notNull(),
    estado: estadoExameOrgaoEnum('estado').notNull(),
    descricao: text('descricao'),
    /** Peso do orgao, quando pesado. Em gramas. */
    pesoGramas: integer('peso_gramas'),
    ...colunasTempo,
  },
  (t) => [
    unique('uq_exame_orgao').on(t.tenantId, t.necropsiaId, t.cavidade, t.orgao),
    index('idx_exame_orgao_necropsia').on(t.tenantId, t.necropsiaId),
  ],
);

/**
 * Objeto Lesao (secoes 73-75).
 *
 * "Toda alteracao relevante podera possuir registro individual" - L01, L02,
 * L03. O registro individual e o que permite fotografar, amostrar, dar
 * diagnostico morfologico e, sobretudo, **ligar uma lesao a outra**.
 *
 * `classificacao` e o campo que a secao 97 chama de fundamental "para evitar
 * que todo diagnostico seja tratado como causal": achado incidental, alteracao
 * post mortem e artefato ficam registrados sem entrar na cadeia da morte.
 */
export const lesaoNecroscopica = pgTable(
  'lesao_necroscopica',
  {
    ...colunasTenant,
    necropsiaId: uuid('necropsia_id')
      .notNull()
      .references(() => necropsia.id),
    /** `L01`, `L02`… Sequencial dentro da necropsia (secao 73). */
    codigo: text('codigo').notNull(),
    orgao: text('orgao').notNull(),
    /** Onde no orgao, distribuicao, quantidade, forma, tamanho, cor... (secao 74). */
    descricao: text('descricao').notNull(),
    localizacao: text('localizacao'),
    distribuicao: text('distribuicao'),
    dimensao: text('dimensao'),
    /**
     * Secao 94: "orgao + processo + distribuicao + severidade + duracao".
     * Ex.: "edema alveolar difuso, acentuado, agudo".
     */
    diagnosticoMorfologico: text('diagnostico_morfologico'),
    classificacao: classificacaoLesaoEnum('classificacao'),
    /** Secao 95: a impressao macroscopica precede o diagnostico integrado. */
    impressaoMacroscopica: text('impressao_macroscopica'),
    observacoes: text('observacoes'),
    ...colunasTempo,
  },
  (t) => [
    unique('uq_lesao_codigo').on(t.tenantId, t.necropsiaId, t.codigo),
    index('idx_lesao_necropsia').on(t.tenantId, t.necropsiaId),
  ],
);

/**
 * Relacao entre lesoes (secao 76) - o mapa fisiopatologico (secao 102).
 *
 * Ruptura esplenica → hemoperitonio → hipovolemia → choque circulatorio. E o
 * que separa uma lista de achados de um raciocinio sobre a morte, e o que a
 * conclusao usa como evidencia.
 */
export const relacaoLesao = pgTable(
  'relacao_lesao',
  {
    ...colunasTenant,
    necropsiaId: uuid('necropsia_id')
      .notNull()
      .references(() => necropsia.id),
    origemId: uuid('origem_id')
      .notNull()
      .references(() => lesaoNecroscopica.id),
    destinoId: uuid('destino_id')
      .notNull()
      .references(() => lesaoNecroscopica.id),
    tipo: relacaoLesaoEnum('tipo').notNull().default('causou'),
    observacao: text('observacao'),
    ...colunasTempo,
  },
  (t) => [
    unique('uq_relacao_lesao').on(t.tenantId, t.origemId, t.destinoId),
    index('idx_relacao_necropsia').on(t.tenantId, t.necropsiaId),
  ],
);

/**
 * Causa mortis (secoes 107-113).
 *
 * A estrutura da secao 109 - imediata, antecedente, basica, contribuintes - e a
 * mesma do atestado de obito humano, e existe pela mesma razao: separar o que
 * matou agora do que colocou o organismo naquele caminho.
 *
 * `mecanismoTerminal` fica em campo proprio por causa da secao 108: **mecanismo
 * nao e causa**. O choque hipovolemico e como; a ruptura hepatica e por que.
 * Guardar os dois no mesmo campo e o erro classico do laudo necroscopico.
 */
export const causaMortis = pgTable(
  'causa_mortis',
  {
    ...colunasTenant,
    necropsiaId: uuid('necropsia_id')
      .notNull()
      .references(() => necropsia.id),

    causaImediata: text('causa_imediata'),
    condicaoAntecedente: text('condicao_antecedente'),
    causaBasica: text('causa_basica'),
    condicoesContribuintes: text('condicoes_contribuintes'),

    mecanismoTerminal: mecanismoTerminalEnum('mecanismo_terminal'),
    grauCerteza: grauCertezaCausaEnum('grau_certeza').notNull().default('indeterminada'),

    /**
     * Secao 112: quando nao se consegue diferenciar, o patologista mantem as
     * possibilidades e a conclusao discute por que nao foi possivel separa-las.
     */
    diagnosticosDiferenciais: jsonb('diagnosticos_diferenciais').$type<string[]>().default([]),

    /** Secao 113: integra achados, correlacao, limitacoes e raciocinio. */
    conclusao: text('conclusao'),

    ...colunasTempo,
  },
  (t) => [unique('uq_causa_mortis_necropsia').on(t.tenantId, t.necropsiaId)],
);

export const necropsiaRelations = relations(necropsia, ({ one, many }) => ({
  caso: one(caso, { fields: [necropsia.casoId], references: [caso.id] }),
  cadaver: one(cadaver, { fields: [necropsia.cadaverId], references: [cadaver.id] }),
  orgaos: many(exameOrgao),
  lesoes: many(lesaoNecroscopica),
  relacoes: many(relacaoLesao),
}));

export const exameOrgaoRelations = relations(exameOrgao, ({ one }) => ({
  necropsia: one(necropsia, { fields: [exameOrgao.necropsiaId], references: [necropsia.id] }),
}));

export const lesaoNecroscopicaRelations = relations(lesaoNecroscopica, ({ one }) => ({
  necropsia: one(necropsia, {
    fields: [lesaoNecroscopica.necropsiaId],
    references: [necropsia.id],
  }),
}));

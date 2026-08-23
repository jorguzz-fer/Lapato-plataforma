import { relations } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import {
  adequacaoCitologicaEnum,
  celularidadeEnum,
  colunasTempo,
  colunasTenant,
  intensidadeEnum,
  preservacaoCelularEnum,
} from './_comum.js';
import { amostra } from './caso.js';
import { laudoVersao } from './laudo.js';

/**
 * M12 - Citopatologia.
 *
 * DIRETRIZES secao 8.4, ecoada pelo proprio modulo (secao 1): o M11 fornece a
 * **estacao de trabalho** - editor, revisao, versionamento, assinatura,
 * liberacao - e o M12 determina **como a citologia e avaliada dentro dela**.
 * Por isso nao existe laudo citologico separado: existe uma avaliacao
 * citologica presa a uma versao do laudo do M11.
 *
 * M12 secao 142: "toda interpretacao citologica devera estar vinculada a uma
 * amostra identificada" - dai o par (versao, amostra) ser unico, e a amostra
 * ser obrigatoria. Secao 115 completa: varias massas aspiradas no mesmo caso
 * (A linfonodo, B massa cutanea, C figado) tem interpretacao independente.
 *
 * Como toda estrutura de laudo, a avaliacao pertence a VERSAO (ADR 0005): uma
 * correcao ou adendo nasce com a copia da versao anterior e evolui a partir
 * dela, sem apagar o que foi assinado.
 */
export const avaliacaoCitologica = pgTable(
  'avaliacao_citologica',
  {
    ...colunasTenant,
    laudoVersaoId: uuid('laudo_versao_id')
      .notNull()
      .references(() => laudoVersao.id, { onDelete: 'cascade' }),
    amostraId: uuid('amostra_id')
      .notNull()
      .references(() => amostra.id, { onDelete: 'cascade' }),

    // --- Material e preparacao (M12 secoes 5 e 8) --------------------------
    /** Chave de TIPO_COLETA_CITOLOGICA: paaf, imprint, swab, lavado... */
    tipoColeta: text('tipo_coleta'),
    /** Cavidade, sitio ou detalhe do material - "pleural", "ouvido esquerdo". */
    sitio: text('sitio'),
    numeroLaminas: integer('numero_laminas'),
    coloracoes: jsonb('coloracoes').$type<string[]>().notNull().default([]),

    // --- Adequacao (M12 secoes 9-12) --------------------------------------
    adequacao: adequacaoCitologicaEnum('adequacao'),
    /**
     * M12 secao 10: "o sistema devera permitir registrar o motivo da
     * limitacao". Sem o motivo, a adequacao vira rotulo e o indicador de
     * qualidade pre-analitica (secoes 119-120) nao tem o que medir.
     */
    motivosLimitacao: jsonb('motivos_limitacao').$type<string[]>().notNull().default([]),

    // --- Qualidade da preparacao (M12 secoes 13-20) -----------------------
    celularidade: celularidadeEnum('celularidade'),
    preservacao: preservacaoCelularEnum('preservacao'),
    /** M12 secao 16: multiplos componentes podem coexistir. */
    fundo: jsonb('fundo').$type<string[]>().notNull().default([]),
    hemorragia: intensidadeEnum('hemorragia'),
    /** Eritrofagocitose, hemossiderofagos, hematoidina (secao 17). */
    achadosHemorragia: jsonb('achados_hemorragia').$type<string[]>().notNull().default([]),
    necrose: intensidadeEnum('necrose'),
    materialExtracelular: jsonb('material_extracelular')
      .$type<string[]>()
      .notNull()
      .default([]),

    // --- Populacoes e morfologia (M12 secoes 21-30) -----------------------
    /**
     * `[{ tipo, predominante, proporcao, observacao }]`. Varias populacoes
     * coexistem (secao 21), e "indeterminada" e resposta valida (secao 22).
     */
    populacoes: jsonb('populacoes')
      .$type<Array<Record<string, unknown>>>()
      .notNull()
      .default([]),
    /**
     * M12 secao 28: cada criterio tem INTENSIDADE propria - `{ anisocariose:
     * 'moderada' }`. Guardar so a lista dos presentes perderia o gradiente, e o
     * modulo e explicito ao proibir a conversao automatica dessa soma em
     * malignidade (secao 28 e 73: nao existe "diagnostico por cliques").
     */
    criteriosMalignidade: jsonb('criterios_malignidade')
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    mitoses: text('mitoses'),

    // --- Inflamacao e agentes (M12 secoes 31-47) --------------------------
    /** `{ tipo, intensidade, distribuicao, observacao }` (secoes 31-32). */
    inflamacao: jsonb('inflamacao').$type<Record<string, unknown>>(),
    /**
     * `[{ grupo, morfologia, localizacao, significancia }]`. A significancia e
     * campo do patologista: o modulo exige que a diferenca entre agente,
     * achado sem significado e contaminacao seja **interpretativa, nao
     * automatizada** (secao 46).
     */
    agentes: jsonb('agentes').$type<Array<Record<string, unknown>>>().notNull().default([]),

    // --- Interpretacao (M12 secoes 64-67) ---------------------------------
    /** Texto livre: campos estruturados nao substituem a descricao (secao 142). */
    descricaoCitologica: text('descricao_citologica'),
    /** M12 secao 64: a INTERPRETACAO e campo proprio, distinto da descricao. */
    interpretacao: text('interpretacao'),
    /**
     * M12 secao 66: estruturado e **interno** - "podera ajudar na auditoria e
     * IA, mas nao devera necessariamente aparecer no laudo". Nao entra no PDF.
     */
    grauCerteza: text('grau_certeza'),
    limitacoes: jsonb('limitacoes').$type<string[]>().notNull().default([]),
    /**
     * M12 secao 69: recomendar histopatologia NAO e frase automatica. O texto
     * e escrito e editado pelo patologista, conforme material, diagnostico e
     * finalidade clinica.
     */
    recomendacoes: text('recomendacoes'),

    ...colunasTempo,
  },
  (t) => [
    unique('uq_citologia_versao_amostra').on(t.laudoVersaoId, t.amostraId),
    index('idx_citologia_versao').on(t.tenantId, t.laudoVersaoId),
    index('idx_citologia_adequacao').on(t.tenantId, t.adequacao),
  ],
);

export const avaliacaoCitologicaRelations = relations(avaliacaoCitologica, ({ one }) => ({
  versao: one(laudoVersao, {
    fields: [avaliacaoCitologica.laudoVersaoId],
    references: [laudoVersao.id],
  }),
  amostra: one(amostra, {
    fields: [avaliacaoCitologica.amostraId],
    references: [amostra.id],
  }),
}));

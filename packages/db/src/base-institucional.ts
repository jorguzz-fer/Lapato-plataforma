import {
  MODULOS,
  PERFIS_PADRAO,
  PERMISSOES,
  TODAS_PERMISSOES,
  type Permissao,
} from '@lapato/shared';
import type { Transacao } from './client.js';
import * as s from './schema/index.js';

/**
 * Configuracao institucional minima: o que toda instituicao precisa ter no banco
 * para que o fluxo funcione, independente de ser demonstracao ou producao.
 *
 * Existe para que `seed` (desenvolvimento) e `provision` (producao) partam
 * exatamente da mesma base. Se os dois divergirem, o ambiente de testes deixa de
 * provar alguma coisa sobre o ambiente real.
 *
 * O que NAO entra aqui: usuarios, clientes, veterinarios, pacientes e casos.
 * Isso e dado de negocio - o seed inventa, a producao cadastra.
 */

/** M02 secao 9: perfis iniciais, ajustaveis pela instituicao. */
export const PERFIS: Array<{
  chave: string;
  nome: string;
  exigeSupervisao?: boolean;
  permissoes: Permissao[] | 'todas';
}> = [
  {
    chave: PERFIS_PADRAO.ADMINISTRADOR_GERAL,
    nome: 'Administrador Geral',
    permissoes: 'todas',
  },
  {
    chave: PERFIS_PADRAO.RECEPCAO,
    nome: 'Recepção',
    permissoes: [
      PERMISSOES.CASO_VISUALIZAR,
      PERMISSOES.CASO_CRIAR,
      PERMISSOES.CASO_EDITAR,
      PERMISSOES.MATERIAL_RECEBER,
      PERMISSOES.ETIQUETA_IMPRIMIR,
      PERMISSOES.CLIENTE_VISUALIZAR,
      PERMISSOES.CLIENTE_CRIAR,
      PERMISSOES.VETERINARIO_VISUALIZAR,
      PERMISSOES.VETERINARIO_CRIAR,
      PERMISSOES.FLUXO_VISUALIZAR,
      PERMISSOES.SOLICITACAO_VISUALIZAR,
      PERMISSOES.SOLICITACAO_CRIAR,
      /**
       * M10 secao 38 e 52: pendencias cadastrais - confirmar paciente,
       * veterinario, numero de frascos - sao a caixa da recepcao, e resolver
       * e o desfecho do trabalho dela, nao um privilegio tecnico.
       */
      PERMISSOES.PENDENCIA_RESOLVER,
    ],
  },
  {
    chave: PERFIS_PADRAO.TECNICO_LABORATORIO,
    nome: 'Técnico de Laboratório',
    permissoes: [
      PERMISSOES.CASO_VISUALIZAR,
      PERMISSOES.TRIAGEM_EXECUTAR,
      PERMISSOES.MATERIAL_RECEBER,
      PERMISSOES.ETIQUETA_IMPRIMIR,
      PERMISSOES.MACROSCOPIA_VISUALIZAR,
      PERMISSOES.FLUXO_VISUALIZAR,
      PERMISSOES.PROCESSAMENTO_VISUALIZAR,
      PERMISSOES.PROCESSAMENTO_ENVIAR_LOTE,
      PERMISSOES.SOLICITACAO_VISUALIZAR,
      /**
       * M10 secao 52: a caixa do tecnico sao as ordens tecnicas - recortes,
       * niveis, coloracoes, IHQ. Executar e concluir a ordem e dele; a
       * interpretacao do resultado continua no modulo diagnostico (secao 26).
       */
      PERMISSOES.SOLICITACAO_EXECUTAR,
      PERMISSOES.IMAGEM_VISUALIZAR,
      PERMISSOES.IMAGEM_ENVIAR,
    ],
  },
  {
    chave: PERFIS_PADRAO.PATOLOGISTA,
    nome: 'Patologista',
    permissoes: [
      PERMISSOES.CASO_VISUALIZAR,
      PERMISSOES.FLUXO_VISUALIZAR,
      PERMISSOES.MACROSCOPIA_VISUALIZAR,
      PERMISSOES.MACROSCOPIA_EXECUTAR,
      PERMISSOES.MACROSCOPIA_CONCLUIR,
      PERMISSOES.PROCESSAMENTO_VISUALIZAR,
      PERMISSOES.LAUDO_VISUALIZAR,
      PERMISSOES.LAUDO_EDITAR,
      /**
       * M11 preve revisao por pares, dupla revisao e revisao obrigatoria - e
       * quem revisa laudo de patologista e outro patologista. Sem estas duas,
       * o ciclo de revisao e a correcao pos-assinatura so existiriam para o
       * administrador, que o M02 proibe de exercer autoridade tecnica.
       */
      PERMISSOES.LAUDO_REVISAR,
      PERMISSOES.LAUDO_CORRIGIR,
      PERMISSOES.LAUDO_ASSINAR,
      PERMISSOES.LAUDO_LIBERAR,
      PERMISSOES.LAUDO_ADENDO,
      PERMISSOES.LAUDO_VER_NOTA_INTERNA,
      PERMISSOES.SOLICITACAO_VISUALIZAR,
      PERMISSOES.SOLICITACAO_CRIAR,
      /**
       * M10: aprovar solicitacao de alto custo (secao 29, IHQ com autorizacao)
       * e validar a resposta de uma pendencia antes de resolve-la (secoes 48 e
       * 94) sao decisoes tecnicas - do patologista, nao do administrador, que
       * o M02 proibe de exercer autoridade tecnica. Cancelar acompanha quem
       * pode criar e aprovar.
       */
      PERMISSOES.SOLICITACAO_APROVAR,
      PERMISSOES.SOLICITACAO_CANCELAR,
      PERMISSOES.PENDENCIA_RESOLVER,
      PERMISSOES.IMAGEM_VISUALIZAR,
      PERMISSOES.IMAGEM_ENVIAR,
      PERMISSOES.CLIENTE_VISUALIZAR,
      PERMISSOES.VETERINARIO_VISUALIZAR,
    ],
  },
  {
    /**
     * M11 e M02: o residente elabora microscopia e propõe diagnostico, mas o
     * sistema impede assinatura e exige revisao. Note que `LAUDO_ASSINAR` e
     * `LAUDO_LIBERAR` estao ausentes de proposito.
     */
    chave: PERFIS_PADRAO.RESIDENTE,
    nome: 'Residente',
    exigeSupervisao: true,
    permissoes: [
      PERMISSOES.CASO_VISUALIZAR,
      PERMISSOES.FLUXO_VISUALIZAR,
      PERMISSOES.MACROSCOPIA_VISUALIZAR,
      PERMISSOES.MACROSCOPIA_EXECUTAR,
      PERMISSOES.LAUDO_VISUALIZAR,
      PERMISSOES.LAUDO_EDITAR,
      PERMISSOES.SOLICITACAO_VISUALIZAR,
      PERMISSOES.IMAGEM_VISUALIZAR,
    ],
  },
  {
    /**
     * M09: o processamento e terceirizado. O parceiro precisa de acesso para
     * confirmar recebimento de cassetes, apontar incongruencias e registrar as
     * laminas produzidas - e de nada alem disso.
     */
    chave: PERFIS_PADRAO.LABORATORIO_APOIO,
    nome: 'Laboratório de Apoio',
    permissoes: [
      PERMISSOES.PROCESSAMENTO_VISUALIZAR,
      PERMISSOES.PROCESSAMENTO_CONFIRMAR_RECEBIMENTO,
      PERMISSOES.PROCESSAMENTO_REGISTRAR_LAMINAS,
      PERMISSOES.ETIQUETA_IMPRIMIR,
    ],
  },
];

/**
 * Tabelas mestres minimas para o fluxo funcionar (M01 secao 16).
 *
 * Nao e lista fechada: o M01 exige que a instituicao acrescente e inative
 * termos sem depender de codigo. Isto e so o ponto de partida.
 */
export const TABELAS_MESTRES: Array<{ chave: string; nome: string; termos: string[] }> = [
  {
    chave: 'especie',
    nome: 'Espécies',
    termos: ['Canina', 'Felina', 'Equina', 'Bovina', 'Ave', 'Réptil', 'Roedor'],
  },
  {
    chave: 'orgao',
    nome: 'Órgãos',
    termos: ['Pele', 'Mama', 'Baço', 'Fígado', 'Rim', 'Linfonodo', 'Intestino', 'Pulmão'],
  },
  {
    chave: 'fixador',
    nome: 'Fixadores',
    termos: ['Formol 10% tamponado', 'Formol 10% não tamponado', 'Bouin', 'Álcool 70%'],
  },
  {
    chave: 'recipiente',
    nome: 'Recipientes',
    termos: ['Frasco 50 mL', 'Frasco 250 mL', 'Balde 1 L', 'Tubo', 'Porta-lâminas'],
  },
  {
    chave: 'coloracao',
    nome: 'Colorações',
    termos: ['HE', 'PAS', 'Ziehl-Neelsen', 'Grocott', 'Tricrômico de Masson', 'Perls'],
  },
];

/** Setores criados na unidade sede, na ordem do fluxo. */
const SETORES_PADRAO = ['recepcao', 'triagem', 'macroscopia', 'microscopia', 'histotecnica'];

export interface OpcoesBaseInstitucional {
  /** Nome da unidade principal. Toda instituicao tem pelo menos uma. */
  unidadeSede?: { nome?: string; codigo?: string; sigla?: string };
  /**
   * M09: o laboratorio de apoio e um parceiro externo contratado. Em producao
   * so existe quando ha contrato - por isso e opcional.
   */
  laboratorioApoio?: { nome: string; codigo?: string; sigla?: string } | null;
}

export interface BaseInstitucional {
  sedeId: string;
  apoioId: string | null;
  setores: Array<{ id: string; tipo: string | null }>;
  /** chave do perfil -> id. */
  perfis: Map<string, string>;
  servicoHistopatologiaId: string;
}

/** Codigo estavel a partir do texto: sem acento, maiusculo, separado por `_`. */
function codificar(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

/**
 * Cria a configuracao institucional dentro de uma transacao ja escopada no
 * tenant (`comTenant`). Nao abre transacao propria de proposito: quem chama
 * decide o que mais entra no mesmo commit.
 */
export async function criarBaseInstitucional(
  tx: Transacao,
  tenantId: string,
  opcoes: OpcoesBaseInstitucional = {},
): Promise<BaseInstitucional> {
  // --- M01: unidades e setores -------------------------------------------
  const [sede] = await tx
    .insert(s.unidade)
    .values({
      tenantId,
      nome: opcoes.unidadeSede?.nome ?? 'Unidade Sede',
      codigo: opcoes.unidadeSede?.codigo ?? 'SEDE',
      sigla: opcoes.unidadeSede?.sigla ?? 'SD',
      tipo: 'sede',
    })
    .returning();

  let apoioId: string | null = null;
  if (opcoes.laboratorioApoio) {
    const [apoio] = await tx
      .insert(s.unidade)
      .values({
        tenantId,
        nome: opcoes.laboratorioApoio.nome,
        codigo: opcoes.laboratorioApoio.codigo ?? 'APOIO',
        sigla: opcoes.laboratorioApoio.sigla ?? 'AP',
        // M09: "nos nao fazemos processamento. Esse e um servico terceirizado."
        tipo: 'laboratorio_apoio',
      })
      .returning();
    apoioId = apoio!.id;
  }

  const setores = await tx
    .insert(s.setor)
    .values(
      SETORES_PADRAO.map((tipo) => ({
        tenantId,
        unidadeId: sede!.id,
        nome: tipo,
        codigo: tipo.toUpperCase(),
        tipo,
      })),
    )
    .returning();

  // --- M01: tabelas mestres e terminologia -------------------------------
  for (const def of TABELAS_MESTRES) {
    const [tabela] = await tx
      .insert(s.tabelaMestre)
      .values({ tenantId, chave: def.chave, nome: def.nome, sistema: true })
      .returning();

    await tx.insert(s.termo).values(
      def.termos.map((valor, i) => ({
        tenantId,
        tabelaId: tabela!.id,
        valor,
        codigo: codificar(valor),
        ordem: i,
      })),
    );
  }

  // --- M01: servicos -----------------------------------------------------
  const [histopatologia] = await tx
    .insert(s.servico)
    .values({
      tenantId,
      nome: 'Histopatologia de biópsia',
      codigo: 'HISTO',
      categoria: 'Anatomopatologia',
      modalidade: 'histopatologia',
      exigeTriagem: true,
      exigeMacroscopia: true,
      exigeProcessamento: true,
      exigeMicroscopia: true,
      geraLaudo: true,
      geraMaterialBioteca: true,
      prazoDiasUteis: 5,
      prazoUrgenteDiasUteis: 2,
    })
    .returning();

  await tx.insert(s.servico).values({
    tenantId,
    nome: 'Citopatologia',
    codigo: 'CITO',
    categoria: 'Anatomopatologia',
    modalidade: 'citopatologia',
    exigeTriagem: true,
    // M08: nem todo exame passa por macroscopia. O motor de fluxo pula a etapa.
    exigeMacroscopia: false,
    exigeProcessamento: false,
    exigeMicroscopia: true,
    prazoDiasUteis: 3,
  });

  await tx.insert(s.servico).values({
    tenantId,
    nome: 'Revisão de lâminas',
    codigo: 'REVISAO',
    categoria: 'Anatomopatologia',
    modalidade: 'revisao',
    exigeTriagem: true,
    exigeMacroscopia: false,
    exigeProcessamento: false,
    exigeMicroscopia: true,
    prazoDiasUteis: 3,
  });

  // --- M01: modelos de etiqueta ------------------------------------------
  await tx.insert(s.modeloEtiqueta).values([
    {
      tenantId,
      nome: 'Etiqueta de recipiente',
      alvo: 'recipiente',
      larguraMm: 50,
      alturaMm: 25,
      layout: {
        campos: ['identificador', 'paciente', 'cliente', 'data'],
        codigoBarras: { tipo: 'code128', origem: 'identificador' },
      },
    },
    {
      tenantId,
      nome: 'Etiqueta de cassete',
      alvo: 'cassete',
      larguraMm: 28,
      alturaMm: 8,
      layout: { campos: ['identificador'], codigoBarras: { tipo: 'datamatrix' } },
    },
    {
      // M09: "o laboratorio de processamento podera solicitar a impressao das
      // etiquetas para colar nas laminas. Elas devem conter os dados de ID e
      // codigo de barras, visando facilitar a checagem pelo sistema."
      tenantId,
      nome: 'Etiqueta de lâmina',
      alvo: 'lamina',
      larguraMm: 22,
      alturaMm: 15,
      layout: {
        campos: ['identificador', 'coloracao'],
        codigoBarras: { tipo: 'code128', origem: 'identificador' },
      },
    },
  ]);

  // --- M07: workflow da histopatologia -----------------------------------
  const [workflow] = await tx
    .insert(s.definicaoWorkflow)
    .values({
      tenantId,
      nome: 'Histopatologia padrão',
      servicoId: histopatologia!.id,
      modalidade: 'histopatologia',
    })
    .returning();

  /**
   * As etapas condicionais consultam as flags do servico. Assim o mesmo motor
   * atende histopatologia, citologia e revisao de laminas sem codigo especial:
   * a etapa que nao se aplica e simplesmente pulada (M07).
   */
  await tx.insert(s.etapaWorkflow).values([
    {
      tenantId,
      workflowId: workflow!.id,
      etapa: 'aguardando_recebimento',
      ordem: 10,
      eventosSaida: ['material.recebido'],
      setorTipo: 'recepcao',
    },
    {
      tenantId,
      workflowId: workflow!.id,
      etapa: 'aguardando_triagem',
      ordem: 20,
      condicao: { 'servico.exigeTriagem': true },
      eventosEntrada: ['material.recebido'],
      eventosSaida: ['triagem.concluida.apta', 'triagem.concluida.ressalva'],
      setorTipo: 'triagem',
      limitePermanenciaHoras: 24,
    },
    {
      tenantId,
      workflowId: workflow!.id,
      etapa: 'aguardando_macroscopia',
      ordem: 30,
      obrigatoriedade: 'condicional',
      condicao: { 'servico.exigeMacroscopia': true },
      eventosEntrada: ['triagem.concluida.apta', 'triagem.concluida.ressalva'],
      eventosSaida: ['macroscopia.concluida'],
      setorTipo: 'macroscopia',
      limitePermanenciaHoras: 48,
    },
    {
      tenantId,
      workflowId: workflow!.id,
      etapa: 'aguardando_processamento',
      ordem: 40,
      obrigatoriedade: 'condicional',
      condicao: { 'servico.exigeProcessamento': true },
      eventosEntrada: ['macroscopia.concluida'],
      eventosSaida: ['laminas.disponiveis'],
      setorTipo: 'histotecnica',
      limitePermanenciaHoras: 72,
    },
    {
      tenantId,
      workflowId: workflow!.id,
      etapa: 'aguardando_microscopia',
      ordem: 50,
      condicao: { 'servico.exigeMicroscopia': true },
      eventosEntrada: ['laminas.disponiveis'],
      eventosSaida: ['laudo.enviado_revisao', 'laudo.assinado'],
      setorTipo: 'microscopia',
      limitePermanenciaHoras: 48,
    },
    {
      tenantId,
      workflowId: workflow!.id,
      etapa: 'aguardando_revisao',
      ordem: 60,
      obrigatoriedade: 'opcional',
      eventosEntrada: ['laudo.enviado_revisao'],
      eventosSaida: ['laudo.revisao_concluida'],
      setorTipo: 'microscopia',
    },
    {
      tenantId,
      workflowId: workflow!.id,
      etapa: 'aguardando_assinatura',
      ordem: 70,
      eventosEntrada: ['laudo.revisao_concluida'],
      eventosSaida: ['laudo.assinado'],
      setorTipo: 'microscopia',
    },
    {
      tenantId,
      workflowId: workflow!.id,
      etapa: 'liberado',
      ordem: 80,
      eventosEntrada: ['laudo.liberado'],
    },
  ]);

  // --- M02: perfis e permissoes ------------------------------------------
  const perfis = new Map<string, string>();
  for (const def of PERFIS) {
    const [p] = await tx
      .insert(s.perfil)
      .values({
        tenantId,
        nome: def.nome,
        chave: def.chave,
        exigeSupervisao: def.exigeSupervisao ?? false,
      })
      .returning();

    const permissoes = def.permissoes === 'todas' ? TODAS_PERMISSOES : def.permissoes;
    await tx.insert(s.perfilPermissao).values(
      permissoes.map((permissao) => ({
        tenantId,
        perfilId: p!.id,
        permissao,
        escopo: def.chave === PERFIS_PADRAO.ADMINISTRADOR_GERAL ? 'instituicao' : 'unidade',
      })),
    );

    perfis.set(def.chave, p!.id);
  }

  // --- M17: politica de IA -----------------------------------------------
  await tx.insert(s.politicaIa).values({
    tenantId,
    // M17: comeca conservador. Ampliar e decisao institucional.
    perfilAtuacao: 'conservador',
    modulosHabilitados: [
      MODULOS.M05_RECEBIMENTO,
      MODULOS.M06_TRIAGEM,
      MODULOS.M08_MACROSCOPIA,
      MODULOS.M11_LAUDOS,
    ],
    funcoesExigemConfirmacao: [
      'alterar_diagnostico',
      'solicitar_complementar',
      'alterar_prioridade',
      'criar_conclusao',
      'liberar_laudo',
      'alterar_identidade',
    ],
    // M17 secao 97: sem regra institucional escrita e DPA, nao ha treinamento.
    permiteTreinamento: 'nao',
  });

  return {
    sedeId: sede!.id,
    apoioId,
    setores: setores.map((x) => ({ id: x.id, tipo: x.tipo })),
    perfis,
    servicoHistopatologiaId: histopatologia!.id,
  };
}

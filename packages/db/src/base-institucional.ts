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
      /**
       * M03: manter o cadastro vivo - corrigir contato, inativar, encerrar
       * vinculo - e trabalho da recepcao, a mesma caixa das pendencias
       * cadastrais (M10 secao 38). Fundir cadastros fica de fora: fusao
       * redireciona referencias historicas e exige perfil administrativo.
       */
      PERMISSOES.CLIENTE_EDITAR,
      PERMISSOES.VETERINARIO_VISUALIZAR,
      PERMISSOES.VETERINARIO_CRIAR,
      PERMISSOES.VETERINARIO_EDITAR,
      /**
       * M16 secao 5: o recebimento e uma das fontes de imagem do acervo -
       * embalagem, frasco, identificacao, vazamento, nao conformidade. A foto
       * da caixa que chegou molhada e a prova do que foi recebido, e quem a
       * tira e quem abre a caixa.
       */
      PERMISSOES.IMAGEM_VISUALIZAR,
      PERMISSOES.IMAGEM_ENVIAR,
      PERMISSOES.FLUXO_VISUALIZAR,
      PERMISSOES.SOLICITACAO_VISUALIZAR,
      PERMISSOES.SOLICITACAO_CRIAR,
      /**
       * M10 secao 38 e 52: pendencias cadastrais - confirmar paciente,
       * veterinario, numero de frascos - sao a caixa da recepcao, e resolver
       * e o desfecho do trabalho dela, nao um privilegio tecnico.
       */
      PERMISSOES.PENDENCIA_RESOLVER,
      /**
       * M15 secao 68: a recepcao recebe o corpo, etiqueta, consulta e registra
       * a entrega. Nao move dentro da camara nem libera - sao papeis do tecnico
       * e do supervisor.
       */
      PERMISSOES.CADAVER_VISUALIZAR,
      PERMISSOES.CADAVER_RECEBER,
      PERMISSOES.CADAVER_ENTREGAR,
      /**
       * M19 secoes 5 e 140: e a recepcao que atende o telefone e o WhatsApp,
       * abre o pedido e escolhe quais encarregados recebem a oferta. Cancelar
       * fica de fora - a secao 86 trata cancelamento como decisao com
       * responsavel e motivo, nao como desfazer um cadastro.
       */
      PERMISSOES.LOGISTICA_VISUALIZAR,
      PERMISSOES.LOGISTICA_SOLICITAR,
      PERMISSOES.LOGISTICA_OFERTAR,
      /**
       * M20 (review): a OS nasce na conferencia do recebimento - quem conta
       * os frascos e a recepcao, e ajustar itens e desconto e a mesma mesa.
       * Conferir a saida e outra funcao: fica com o tecnico.
       */
      PERMISSOES.OS_VISUALIZAR,
      PERMISSOES.OS_EDITAR,
      PERMISSOES.IA_UTILIZAR,
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
      /** M15 secao 68: o tecnico armazena, transfere, retira para exame e retorna. */
      PERMISSOES.CADAVER_VISUALIZAR,
      PERMISSOES.CADAVER_MOVIMENTAR,
      /**
       * M18 secao 84: "Histotecnica: arquivar, retirar, devolver". A bancada
       * que produz bloco e lamina e a mesma que os guarda e os busca de volta -
       * mas nao e ela que decide emprestimo nem descarte.
       */
      PERMISSOES.BIOTECA_VISUALIZAR,
      PERMISSOES.BIOTECA_MOVIMENTAR,
      PERMISSOES.BIOTECA_INVENTARIAR,
      /** Auxilia na sala: acompanha o exame, nao descreve nem conclui. */
      PERMISSOES.NECROPSIA_VISUALIZAR,
      PERMISSOES.IMAGEM_VISUALIZAR,
      PERMISSOES.IMAGEM_ENVIAR,
      PERMISSOES.IMAGEM_EDITAR,
      /**
       * M20 (review): "a ultima saida e a parte tecnica - a pessoa pega a OS,
       * verifica se foi tudo feito, da ok, vai pra despacho". A conferencia
       * de saida e do tecnico; editar valores nao e.
       */
      PERMISSOES.OS_VISUALIZAR,
      PERMISSOES.OS_CONFERIR,
      PERMISSOES.IA_UTILIZAR,
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
      /**
       * M16 secao 36: escolher quais imagens entram no laudo e ato de quem
       * assina o documento - a selecao integra o raciocinio diagnostico, nao a
       * organizacao do arquivo.
       */
      PERMISSOES.IMAGEM_EDITAR,
      /**
       * M15 secao 68: o patologista consulta a localizacao e aplica retencao
       * tecnica; a liberacao e dele porque exige julgamento tecnico - necropsia
       * concluida, coletas finalizadas, ausencia de bloqueios (secao 42). Note
       * que `CADAVER_MOVIMENTAR` esta ausente de proposito: mover o corpo
       * dentro da camara e trabalho do tecnico.
       */
      PERMISSOES.CADAVER_VISUALIZAR,
      PERMISSOES.CADAVER_BLOQUEAR,
      PERMISSOES.CADAVER_LIBERAR,
      /** M14: descreve o exame e conclui a causa mortis. */
      PERMISSOES.NECROPSIA_VISUALIZAR,
      PERMISSOES.NECROPSIA_EXECUTAR,
      PERMISSOES.NECROPSIA_CONCLUIR,
      /**
       * M18 secao 84: "Patologista: consultar, solicitar, reservar para
       * diagnostico". Reservar e dele porque a secao 29 poe o uso diagnostico
       * acima de ensino e pesquisa - quem responde pelo diagnostico e quem
       * segura o material. Emprestar e descartar ficam com a Bioteca.
       */
      PERMISSOES.BIOTECA_VISUALIZAR,
      PERMISSOES.BIOTECA_RESERVAR,
      PERMISSOES.CLIENTE_VISUALIZAR,
      PERMISSOES.VETERINARIO_VISUALIZAR,
      PERMISSOES.IA_UTILIZAR,
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
      /**
       * M14: descreve o exame necroscopico, mas `NECROPSIA_CONCLUIR` esta
       * ausente de proposito - concluir a causa mortis e ato interpretativo,
       * da mesma familia de assinar laudo.
       */
      PERMISSOES.NECROPSIA_VISUALIZAR,
      PERMISSOES.NECROPSIA_EXECUTAR,
      /** M18: consulta o acervo para saber se ainda existe bloco; nao reserva nem retira. */
      PERMISSOES.BIOTECA_VISUALIZAR,
      PERMISSOES.IMAGEM_VISUALIZAR,
      // Elabora o laudo sob supervisao - e o laudo inclui escolher as imagens.
      PERMISSOES.IMAGEM_ENVIAR,
      PERMISSOES.IMAGEM_EDITAR,
      PERMISSOES.IA_UTILIZAR,
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
  {
    /**
     * M18 secao 84: "Bioteca: administrar, inventariar, emprestar, descartar".
     * E um papel proprio, e nao um adicional do tecnico, porque as quatro acoes
     * decidem o destino do acervo - quem guarda o material nao e
     * necessariamente quem o produz.
     */
    chave: PERFIS_PADRAO.CURADOR_BIOTECA,
    nome: 'Curador da Bioteca',
    permissoes: [
      PERMISSOES.CASO_VISUALIZAR,
      PERMISSOES.BIOTECA_VISUALIZAR,
      PERMISSOES.BIOTECA_MOVIMENTAR,
      PERMISSOES.BIOTECA_RESERVAR,
      PERMISSOES.BIOTECA_EMPRESTAR,
      PERMISSOES.BIOTECA_INVENTARIAR,
      PERMISSOES.BIOTECA_DESCARTAR,
      PERMISSOES.BIOTECA_ADMINISTRAR,
      PERMISSOES.SOLICITACAO_VISUALIZAR,
      PERMISSOES.FLUXO_VISUALIZAR,
    ],
  },
  /**
   * M19 secao 34: o encarregado nao ganha "cadastro de motorista" proprio.
   *
   * A identidade vem daqui, do M02, como a de qualquer pessoa. O que este
   * perfil carrega e o minimo para trabalhar: ver o que lhe foi ofertado,
   * aceitar e executar. Sem `caso:visualizar` de proposito - a secao 115 diz
   * que ele so deve ver o necessario a operacao, e um endereco e uma janela de
   * horario nao exigem saber que exame o material vai virar.
   */
  {
    chave: PERFIS_PADRAO.ENCARREGADO_LOGISTICO,
    nome: 'Encarregado de coleta e entrega',
    permissoes: [PERMISSOES.LOGISTICA_VISUALIZAR, PERMISSOES.LOGISTICA_EXECUTAR],
  },
  /**
   * M04 - usuarios EXTERNOS. Nao veem o sistema interno: as rotas do Portal
   * respondem so a `portal:acessar`, e cada consulta e presa ao cliente da
   * conta (secao 5: o isolamento e de dados, nao de tela).
   *
   * Os dois perfis existem porque a mesma clinica tem gente com necessidades
   * diferentes (secao 8). O administrativo acompanha e pede; quem assina o
   * pedido de exame e complementa a historia clinica e o veterinario.
   */
  {
    chave: PERFIS_PADRAO.CLIENTE,
    nome: 'Cliente (Portal)',
    permissoes: [
      PERMISSOES.PORTAL_ACESSAR,
      PERMISSOES.PORTAL_LAUDO_BAIXAR,
      PERMISSOES.PORTAL_SOLICITAR,
    ],
  },
  {
    chave: PERFIS_PADRAO.VETERINARIO_SOLICITANTE,
    nome: 'Veterinário solicitante (Portal)',
    permissoes: [
      PERMISSOES.PORTAL_ACESSAR,
      PERMISSOES.PORTAL_LAUDO_BAIXAR,
      PERMISSOES.PORTAL_SOLICITAR,
      /**
       * M04 secao 23: complementar a historia clinica e "uma das funcoes mais
       * uteis do Portal" - e e ato clinico, de quem atendeu o animal.
       */
      PERMISSOES.PORTAL_HISTORICO_COMPLEMENTAR,
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

/**
 * M07: workflows padrao, um por modalidade.
 *
 * Duas decisoes estruturais moram aqui:
 *
 * 1. **O workflow e da MODALIDADE, nao do servico** (`servicoId` nulo). As
 *    etapas condicionais ja consultam as flags de cada servico, entao um
 *    servico novo criado pelo M01 usa o mesmo workflow. Amarrado ao servico,
 *    todo servico novo nascia sem fluxo e recusava casos.
 *
 * 2. **A citologia nao e histopatologia sem macroscopia.** Poderia parecer que
 *    as flags do servico bastariam para reaproveitar um unico workflow, mas a
 *    entrada da microscopia e diferente: na histopatologia as laminas nascem do
 *    processamento (`laminas.disponiveis`), enquanto na citologia elas chegam
 *    prontas da coleta e a triagem apta ja habilita a leitura (M12 secao 4).
 *    Com um workflow so, o caso citologico sem processamento ficaria parado em
 *    triagem esperando um evento que ninguem emitiria.
 */
export const WORKFLOWS_PADRAO: Array<{
  nome: string;
  modalidade: string;
  etapas: Array<{
    etapa: (typeof s.etapaWorkflow.$inferInsert)['etapa'];
    ordem: number;
    obrigatoriedade?: 'obrigatoria' | 'condicional' | 'opcional';
    condicao?: Record<string, unknown>;
    eventosEntrada?: string[];
    eventosSaida?: string[];
    setorTipo?: string;
    limitePermanenciaHoras?: number;
  }>;
}> = [
  {
    nome: 'Histopatologia padrão',
    modalidade: 'histopatologia',
    /**
     * As etapas condicionais consultam as flags do servico. Assim o mesmo motor
     * atende biopsia, peca cirurgica e revisao de laminas sem codigo especial:
     * a etapa que nao se aplica e simplesmente pulada (M07).
     */
    etapas: [
      {
        etapa: 'aguardando_recebimento',
        ordem: 10,
        eventosSaida: ['material.recebido'],
        setorTipo: 'recepcao',
      },
      {
        etapa: 'aguardando_triagem',
        ordem: 20,
        condicao: { 'servico.exigeTriagem': true },
        eventosEntrada: ['material.recebido'],
        eventosSaida: ['triagem.concluida.apta', 'triagem.concluida.ressalva'],
        setorTipo: 'triagem',
        limitePermanenciaHoras: 24,
      },
      {
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
        etapa: 'aguardando_microscopia',
        ordem: 50,
        condicao: { 'servico.exigeMicroscopia': true },
        eventosEntrada: ['laminas.disponiveis'],
        eventosSaida: ['laudo.enviado_revisao', 'laudo.assinado'],
        setorTipo: 'microscopia',
        limitePermanenciaHoras: 48,
      },
      {
        etapa: 'aguardando_revisao',
        ordem: 60,
        obrigatoriedade: 'opcional',
        eventosEntrada: ['laudo.enviado_revisao'],
        eventosSaida: ['laudo.revisao_concluida'],
        setorTipo: 'microscopia',
      },
      {
        etapa: 'aguardando_assinatura',
        ordem: 70,
        eventosEntrada: ['laudo.revisao_concluida'],
        eventosSaida: ['laudo.assinado'],
        setorTipo: 'microscopia',
      },
      { etapa: 'liberado', ordem: 80, eventosEntrada: ['laudo.liberado'] },
    ],
  },
  {
    nome: 'Citopatologia padrão',
    modalidade: 'citopatologia',
    etapas: [
      {
        etapa: 'aguardando_recebimento',
        ordem: 10,
        eventosSaida: ['material.recebido'],
        setorTipo: 'recepcao',
      },
      {
        etapa: 'aguardando_triagem',
        ordem: 20,
        condicao: { 'servico.exigeTriagem': true },
        eventosEntrada: ['material.recebido'],
        eventosSaida: ['triagem.concluida.apta', 'triagem.concluida.ressalva'],
        setorTipo: 'triagem',
        limitePermanenciaHoras: 24,
      },
      {
        /**
         * M12 secao 4: coloracao e preparacao entram "quando necessaria" - e a
         * excecao, nao a regra. O prazo aperta porque a citologia costuma ser
         * o exame rapido do laboratorio (o servico CITO nasce com 3 dias).
         */
        etapa: 'aguardando_processamento',
        ordem: 30,
        obrigatoriedade: 'condicional',
        condicao: { 'servico.exigeProcessamento': true },
        eventosEntrada: ['triagem.concluida.apta', 'triagem.concluida.ressalva'],
        eventosSaida: ['laminas.disponiveis'],
        setorTipo: 'histotecnica',
        limitePermanenciaHoras: 24,
      },
      {
        /**
         * Entra por QUALQUER um dos tres: as laminas ficaram prontas na
         * histotecnica, ou a triagem aprovou o material que ja chegou em
         * lamina. Sem os eventos de triagem aqui, o caso citologico sem
         * processamento nunca sairia da triagem.
         */
        etapa: 'aguardando_microscopia',
        ordem: 40,
        condicao: { 'servico.exigeMicroscopia': true },
        eventosEntrada: [
          'laminas.disponiveis',
          'triagem.concluida.apta',
          'triagem.concluida.ressalva',
        ],
        eventosSaida: ['laudo.enviado_revisao', 'laudo.assinado'],
        setorTipo: 'microscopia',
        limitePermanenciaHoras: 24,
      },
      {
        etapa: 'aguardando_revisao',
        ordem: 50,
        obrigatoriedade: 'opcional',
        eventosEntrada: ['laudo.enviado_revisao'],
        eventosSaida: ['laudo.revisao_concluida'],
        setorTipo: 'microscopia',
      },
      {
        etapa: 'aguardando_assinatura',
        ordem: 60,
        eventosEntrada: ['laudo.revisao_concluida'],
        eventosSaida: ['laudo.assinado'],
        setorTipo: 'microscopia',
      },
      { etapa: 'liberado', ordem: 70, eventosEntrada: ['laudo.liberado'] },
    ],
  },
];

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
      // A triagem como etapa do fluxo foi suprimida na review com o
      // laboratorio; segue disponivel por servico, desligada.
      exigeTriagem: false,
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
    exigeTriagem: false,
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
    exigeTriagem: false,
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

  // --- M07: workflows padrao por modalidade -------------------------------
  for (const definicao of WORKFLOWS_PADRAO) {
    const [workflow] = await tx
      .insert(s.definicaoWorkflow)
      .values({
        tenantId,
        nome: definicao.nome,
        servicoId: null,
        modalidade: definicao.modalidade,
      })
      .returning();

    await tx.insert(s.etapaWorkflow).values(
      definicao.etapas.map((etapa) => ({
        ...etapa,
        tenantId,
        workflowId: workflow!.id,
      })),
    );
  }

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

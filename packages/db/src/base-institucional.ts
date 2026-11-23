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
      PERMISSOES.CASO_CORRIGIR_IDENTIFICACAO,
      PERMISSOES.CASO_CORRIGIR_MATERIAL,
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
       * Fatia 2 (secoes 32, 37 e 140): "a recepcionista ou responsavel pela
       * logistica" e quem atribui direto, monta a rota do dia e a reordena.
       * Cancelar continua fora, pela mesma razao de antes.
       */
      PERMISSOES.LOGISTICA_ATRIBUIR,
      /**
       * M20 (review): a OS nasce na conferencia do recebimento - quem conta
       * os frascos e a recepcao, e ajustar itens e desconto e a mesma mesa.
       * Conferir a saida e outra funcao: fica com o tecnico.
       */
      PERMISSOES.OS_VISUALIZAR,
      PERMISSOES.OS_EDITAR,
      PERMISSOES.IA_UTILIZAR,
      PERMISSOES.BIBLIOTECA_VISUALIZAR,
    ],
  },
  {
    /**
     * M20 (review): quem cuida da cobranca. Ve as ordens e os precos, fatura,
     * lanca entrada e saida - e nao toca em nada clinico alem do minimo para
     * saber DO QUE a cobranca trata.
     */
    chave: PERFIS_PADRAO.FINANCEIRO,
    nome: 'Financeiro',
    permissoes: [
      PERMISSOES.FINANCEIRO_VISUALIZAR,
      PERMISSOES.FINANCEIRO_LANCAR,
      PERMISSOES.OS_VISUALIZAR,
      PERMISSOES.PRECO_GERENCIAR,
      PERMISSOES.CLIENTE_VISUALIZAR,
      PERMISSOES.IA_UTILIZAR,
      PERMISSOES.BIBLIOTECA_VISUALIZAR,
    ],
  },
  {
    chave: PERFIS_PADRAO.TECNICO_LABORATORIO,
    nome: 'Técnico de Laboratório',
    permissoes: [
      PERMISSOES.CASO_VISUALIZAR,
      PERMISSOES.CASO_CORRIGIR_IDENTIFICACAO,
      PERMISSOES.CASO_CORRIGIR_MATERIAL,
      PERMISSOES.TRIAGEM_EXECUTAR,
      PERMISSOES.MATERIAL_RECEBER,
      PERMISSOES.ETIQUETA_IMPRIMIR,
      PERMISSOES.MACROSCOPIA_VISUALIZAR,
      PERMISSOES.FLUXO_VISUALIZAR,
      PERMISSOES.PROCESSAMENTO_VISUALIZAR,
      PERMISSOES.PROCESSAMENTO_ENVIAR_LOTE,
      /**
       * Segunda review: depois da macroscopia a lamina sai para um patologista
       * laudar, e a bancada precisa dizer PARA QUEM. E o tecnico que despacha.
       */
      PERMISSOES.FLUXO_ATRIBUIR_RESPONSAVEL,
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
      /** M21 secoes 13 e 48: o tecnico consulta na bancada e escreve instrucoes de trabalho. */
      PERMISSOES.BIBLIOTECA_VISUALIZAR,
      PERMISSOES.BIBLIOTECA_EDITAR,
    ],
  },
  {
    chave: PERFIS_PADRAO.PATOLOGISTA,
    nome: 'Patologista',
    permissoes: [
      PERMISSOES.CASO_VISUALIZAR,
      PERMISSOES.CASO_CORRIGIR_IDENTIFICACAO,
      PERMISSOES.CASO_CORRIGIR_MATERIAL,
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
      /** Hugo: "as vezes um patologista passa um caso pro outro". */
      PERMISSOES.FLUXO_ATRIBUIR_RESPONSAVEL,
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
      /**
       * M21 secoes 25 a 28: num laboratorio pequeno o patologista e a autoridade
       * tecnica - escreve, revisa e aprova o que vira vigente.
       */
      PERMISSOES.BIBLIOTECA_VISUALIZAR,
      PERMISSOES.BIBLIOTECA_EDITAR,
      PERMISSOES.BIBLIOTECA_REVISAR,
      PERMISSOES.BIBLIOTECA_APROVAR,
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
      PERMISSOES.CASO_CORRIGIR_IDENTIFICACAO,
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
      PERMISSOES.BIBLIOTECA_VISUALIZAR,
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
      PERMISSOES.BIBLIOTECA_VISUALIZAR,
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
    /** M21 secao 57: o encarregado le as orientacoes de acondicionamento e transporte. */
    permissoes: [
      PERMISSOES.LOGISTICA_VISUALIZAR,
      PERMISSOES.LOGISTICA_EXECUTAR,
      PERMISSOES.BIBLIOTECA_VISUALIZAR,
    ],
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
    /**
     * "Nao fixada" e o padrao da citologia (quinta revisao): a lamina chega
     * seca da coleta. E um valor legitimo do campo, nao a ausencia dele - por
     * isso esta na tabela, e nao como "deixar em branco".
     */
    termos: [
      'Formol 10% tamponado',
      'Formol 10% não tamponado',
      'Bouin',
      'Álcool 70%',
      'Não fixada',
    ],
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


/**
 * M10: catalogo inicial de tipos de solicitacao, com o fluxo de cada um.
 *
 * Quarta revisao com o Hugo. Duas coisas que a reuniao deixou claras:
 *
 * 1. **O fluxo e do tipo.** A devolucao de um bloco passa por localizar no
 *    arquivo, receber de volta e entregar; uma coloracao especial passa pelo
 *    processamento. Um status generico igual para os dois nao responde "em que
 *    fase isso esta", que e a pergunta que o telefone do laboratorio faz.
 *
 * 2. **Isto e ponto de partida, nao verdade.** O laboratorio edita na
 *    Administracao - inclui tipo, renomeia etapa, inativa o que nao usa. Por
 *    isso nada aqui esta no codigo: esta no banco, desde o primeiro dia.
 *
 * `visivelPortal` marca o que o cliente pode pedir sozinho, substituindo o
 * WhatsApp que perdeu a devolucao de bloco contada na review.
 */
export const TIPOS_SOLICITACAO: Array<{
  chave: string;
  nome: string;
  descricao?: string;
  exigeAprovacao?: boolean;
  visivelPortal?: boolean;
  setorPadrao?: string;
  /** Segundo nivel: qual corante, qual marcador (quinta revisao). */
  subtipos?: string[];
  etapas: Array<{ rotulo: string; setor?: string; textoPortal?: string; automatica?: boolean }>;
}> = [
  {
    chave: 'coloracao_especial',
    nome: 'Coloração especial',
    descricao: 'Escolha o corante no segundo campo.',
    setorPadrao: 'histotecnica',
    /**
     * Documento do Hugo (quinta revisao), lista do formulario do patologista.
     * "Outra" fecha a lista porque corante novo aparece antes de alguem
     * lembrar de cadastra-lo.
     */
    subtipos: [
      'PAS',
      'Ziehl-Neelsen',
      'Gram',
      'Grocott',
      'Faraco',
      'Tricrômico de Masson',
      'Azul de Toluidina',
      'Rodanina',
      'Fontana-Masson',
      'Perls',
      'Novo HE',
      'Outra',
    ],
    /**
     * Fluxo escrito no documento: "Solicitacao -> Separacao do bloco ->
     * Processamento -> Envio ao Patologista". A primeira e automatica: ela
     * acontece no ato de pedir.
     */
    etapas: [
      { rotulo: 'Solicitação', setor: 'microscopia', automatica: true },
      { rotulo: 'Separação do bloco', setor: 'histotecnica' },
      { rotulo: 'Processamento', setor: 'histotecnica' },
      { rotulo: 'Envio ao patologista', setor: 'microscopia' },
    ],
  },
  {
    chave: 'aprofundar_corte',
    nome: 'Aprofundar corte',
    descricao: 'Mesmo caminho da coloração: bloco, processamento e volta.',
    setorPadrao: 'histotecnica',
    etapas: [
      { rotulo: 'Solicitação', setor: 'microscopia', automatica: true },
      { rotulo: 'Separação do bloco', setor: 'histotecnica' },
      { rotulo: 'Processamento', setor: 'histotecnica' },
      { rotulo: 'Envio ao patologista', setor: 'microscopia' },
    ],
  },
  {
    chave: 'problema_tecnico',
    nome: 'Problema técnico',
    descricao: 'Lâmina com dobra, bolha, corte espesso: refazer.',
    setorPadrao: 'histotecnica',
    etapas: [
      { rotulo: 'Solicitação', setor: 'microscopia', automatica: true },
      { rotulo: 'Separação do bloco', setor: 'histotecnica' },
      { rotulo: 'Processamento', setor: 'histotecnica' },
      { rotulo: 'Envio ao patologista', setor: 'microscopia' },
    ],
  },
  {
    chave: 'niveis_adicionais',
    nome: 'Níveis adicionais',
    setorPadrao: 'histotecnica',
    etapas: [
      { rotulo: 'Solicitação', setor: 'microscopia', automatica: true },
      { rotulo: 'Separação do bloco', setor: 'histotecnica' },
      { rotulo: 'Processamento', setor: 'histotecnica' },
      { rotulo: 'Envio ao patologista', setor: 'microscopia' },
    ],
  },
  {
    chave: 'imuno_histoquimica',
    nome: 'Imuno-histoquímica (IHQ)',
    descricao: 'Custo alto: passa por aprovação antes de ir para a fila.',
    exigeAprovacao: true,
    setorPadrao: 'histotecnica',
    etapas: [
      { rotulo: 'Solicitação', setor: 'microscopia', automatica: true },
      { rotulo: 'Separação do bloco', setor: 'histotecnica' },
      { rotulo: 'Enviado ao laboratório de IHQ', setor: 'histotecnica' },
      { rotulo: 'Resultado recebido', setor: 'histotecnica' },
      { rotulo: 'Envio ao patologista', setor: 'microscopia' },
    ],
  },
  {
    chave: 'recorte',
    nome: 'Recorte da amostra',
    descricao: 'A amostragem não foi representativa: volta à bancada.',
    setorPadrao: 'macroscopia',
    /** Documento: "Solicitacao -> Clivagem -> Processamento -> Envio ao Patologista". */
    etapas: [
      { rotulo: 'Solicitação', setor: 'microscopia', automatica: true },
      { rotulo: 'Clivagem', setor: 'macroscopia' },
      { rotulo: 'Processamento', setor: 'histotecnica' },
      { rotulo: 'Envio ao patologista', setor: 'microscopia' },
    ],
  },
  {
    chave: 'reamostragem',
    nome: 'Reamostragem',
    descricao: 'O material não representa a lesão: é preciso nova coleta.',
    setorPadrao: 'recepcao',
    etapas: [
      { rotulo: 'Solicitação', setor: 'microscopia', automatica: true },
      { rotulo: 'Cliente avisado', setor: 'recepcao' },
      { rotulo: 'Novo material recebido', setor: 'recepcao' },
      { rotulo: 'Envio ao patologista', setor: 'microscopia' },
    ],
  },
  {
    chave: 'revisao_interna',
    nome: 'Revisão interna',
    descricao: 'Segunda leitura por outro patologista da casa.',
    setorPadrao: 'microscopia',
    etapas: [
      { rotulo: 'Solicitação', setor: 'microscopia', automatica: true },
      { rotulo: 'Lâminas separadas', setor: 'histotecnica' },
      { rotulo: 'Parecer registrado', setor: 'microscopia' },
    ],
  },
  {
    /**
     * Demandas sem bancada: nascem e se encerram sem etapa intermediaria. Sem
     * etapa, a solicitacao vai direto para "concluir execucao" - e o fluxo nao
     * finge um caminho que nao existe.
     */
    chave: 'correcao_cadastral',
    nome: 'Correção cadastral',
    setorPadrao: 'recepcao',
    etapas: [],
  },
  {
    chave: 'informacao_clinica',
    nome: 'Informação clínica',
    descricao: 'Falta dado do paciente para interpretar o caso.',
    setorPadrao: 'recepcao',
    etapas: [],
  },
  {
    chave: 'administrativa',
    nome: 'Administrativa',
    setorPadrao: 'recepcao',
    etapas: [],
  },
  {
    chave: 'devolucao_bloco',
    nome: 'Devolução de bloco',
    descricao: 'Bloco devolvido ao solicitante, em geral para exame complementar externo.',
    visivelPortal: true,
    setorPadrao: 'histotecnica',
    etapas: [
      { rotulo: 'Recebida pelo laboratório', setor: 'histotecnica', textoPortal: 'Solicitação recebida' },
      { rotulo: 'Bloco solicitado ao arquivo', setor: 'histotecnica', textoPortal: 'Material sendo localizado' },
      { rotulo: 'Bloco recebido de volta', setor: 'histotecnica', textoPortal: 'Material localizado' },
      { rotulo: 'Separado para envio', setor: 'recepcao', textoPortal: 'Material separado para envio' },
      { rotulo: 'Entregue ao solicitante', setor: 'recepcao', textoPortal: 'Material entregue' },
    ],
  },
  {
    chave: 'devolucao_lamina',
    nome: 'Devolução de lâmina',
    visivelPortal: true,
    setorPadrao: 'histotecnica',
    etapas: [
      { rotulo: 'Recebida pelo laboratório', setor: 'histotecnica', textoPortal: 'Solicitação recebida' },
      { rotulo: 'Lâmina localizada', setor: 'histotecnica', textoPortal: 'Material sendo localizado' },
      { rotulo: 'Separada para envio', setor: 'recepcao', textoPortal: 'Material separado para envio' },
      { rotulo: 'Entregue ao solicitante', setor: 'recepcao', textoPortal: 'Material entregue' },
    ],
  },
  {
    chave: 'segunda_opiniao',
    nome: 'Segunda opinião',
    visivelPortal: true,
    setorPadrao: 'microscopia',
    etapas: [
      { rotulo: 'Recebida pelo laboratório', setor: 'recepcao', textoPortal: 'Solicitação recebida' },
      { rotulo: 'Lâminas separadas', setor: 'histotecnica', textoPortal: 'Material sendo preparado' },
      { rotulo: 'Enviadas ao consultor', setor: 'microscopia', textoPortal: 'Em análise com o consultor' },
      { rotulo: 'Parecer recebido', setor: 'microscopia', textoPortal: 'Parecer recebido' },
      { rotulo: 'Enviado ao solicitante', setor: 'microscopia', textoPortal: 'Parecer enviado' },
    ],
  },
  {
    chave: 'copia_laudo',
    nome: 'Cópia do laudo',
    visivelPortal: true,
    setorPadrao: 'recepcao',
    etapas: [
      { rotulo: 'Recebida pela recepção', setor: 'recepcao', textoPortal: 'Solicitação recebida' },
      { rotulo: 'Laudo localizado', setor: 'recepcao', textoPortal: 'Documento localizado' },
      { rotulo: 'Enviado ao solicitante', setor: 'recepcao', textoPortal: 'Documento enviado' },
    ],
  },
];

/**
 * M10: catalogo inicial de tipos de PENDENCIA (quinta revisao).
 *
 * O documento do Hugo lista estes e escreve logo abaixo: "essas opcoes devem
 * ser editaveis". Antes, o tipo era texto livre no formulario - o que impedia
 * filtrar, contar e saber se "margem" e "identificacao de margens" sao a mesma
 * coisa.
 */
export const TIPOS_PENDENCIA: Array<{
  chave: string;
  nome: string;
  bloqueiaPadrao?: 'nao' | 'parcial' | 'total';
}> = [
  { chave: 'cadastral', nome: 'Cadastral' },
  { chave: 'clinica', nome: 'Clínica' },
  /** Sem saber qual margem e qual, o laudo nao pode afirmar comprometimento. */
  { chave: 'identificacao_margens', nome: 'Identificação de margens', bloqueiaPadrao: 'parcial' },
  { chave: 'execucao_tecnica', nome: 'Execução técnica' },
  { chave: 'autorizacao', nome: 'Autorização', bloqueiaPadrao: 'total' },
  { chave: 'macroscopia', nome: 'Macroscopia' },
  { chave: 'outra', nome: 'Outra' },
];

/**
 * Racas para a lista nao nascer vazia, por especie.
 *
 * O documento pede um dropdown "abastecido com as racas pelo uso" - entao esta
 * lista e so o ponto de partida do primeiro dia, nao um catalogo. Ela cresce
 * sozinha a cada cadastro, e o laboratorio pode inativar o que nao ve. "SRD"
 * vem primeiro de proposito: e o que mais se digita, e e o que aparece no
 * proprio desenho da tela.
 *
 * Especies sem lista aqui (Bovina, Ave, Replil, Roedor) comecam vazias e
 * aprendem do zero - inventar racas de ave para um laboratorio de pequenos
 * animais seria enche-lo de opcoes que ele nunca vai usar.
 */
export const RACAS_INICIAIS: Record<string, string[]> = {
  Canina: [
    'SRD',
    'Labrador Retriever',
    'Golden Retriever',
    'Shih Tzu',
    'Poodle',
    'Yorkshire Terrier',
    'Pinscher',
    'Bulldog Francês',
    'Pastor Alemão',
    'Rottweiler',
    'Dachshund',
    'Border Collie',
    'Pug',
    'Lhasa Apso',
    'Maltês',
  ],
  Felina: ['SRD', 'Persa', 'Siamês', 'Maine Coon', 'Angorá', 'Bengal', 'Ragdoll', 'Sphynx'],
  Equina: ['Mangalarga Marchador', 'Quarto de Milha', 'Puro Sangue Inglês', 'Crioulo', 'Árabe'],
};

/**
 * Armazenamento de cadaveres: as camaras e as bandejas de cada uma.
 *
 * Quinta revisao (documento do Dr. Hugo): o desenho mostra a grade 3x3 da
 * camara fria, de 1A a 3C, e os contadores separam "Camara fria" de "Freezer".
 * As posicoes sao `local_fisico` filhos da camara - a tabela ja e hierarquica
 * (freezer -> rack -> caixa -> posicao), entao a grade e DADO, e nao coluna.
 *
 * `capacidade: 1` em cada bandeja nao e uma tranca: desde a quinta revisao o
 * sistema aceita mais de um corpo na mesma lacuna ("e possivel acondiciona-los
 * juntos") e usa a capacidade so para avisar que passou da conta. O
 * laboratorio ajusta o numero, e as proprias bandejas, na Administracao.
 */
const ARMAZENAMENTO_CADAVERES: Array<{
  nome: string;
  codigo: string;
  condicao: string;
  posicoes: string[];
}> = [
  {
    nome: 'Câmara fria',
    codigo: 'CF',
    condicao: 'refrigerado',
    posicoes: ['1A', '1B', '1C', '2A', '2B', '2C', '3A', '3B', '3C'],
  },
  {
    nome: 'Freezer',
    codigo: 'FZ',
    condicao: 'congelado',
    posicoes: ['1A', '1B', '1C', '2A', '2B', '2C'],
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

  /**
   * M01 + M15: o armazenamento de cadaveres, com as bandejas de cada camara.
   *
   * Nasce pronto porque a grade e o desenho da quinta revisao, e porque um
   * corpo recebido sem lugar no mapa e exatamente o que o M15 existe para
   * impedir - abrir o sistema com zero posicoes obriga a inventa-las na
   * primeira entrada, que e a pior hora para inventar.
   */
  const necroterio = setores.find((x) => x.tipo === 'macroscopia') ?? setores[0];
  for (const camara of ARMAZENAMENTO_CADAVERES) {
    const [pai] = await tx
      .insert(s.localFisico)
      .values({
        tenantId,
        unidadeId: sede!.id,
        setorId: necroterio?.id ?? null,
        nome: camara.nome,
        codigo: camara.codigo,
        categoria: 'armazenamento_cadaver',
        condicaoAmbiental: camara.condicao,
        capacidade: camara.posicoes.length,
      })
      .returning();

    await tx.insert(s.localFisico).values(
      camara.posicoes.map((pos) => ({
        tenantId,
        unidadeId: sede!.id,
        setorId: necroterio?.id ?? null,
        paiId: pai!.id,
        nome: `${camara.nome} ${pos}`,
        codigo: `${camara.codigo}${pos}`,
        categoria: 'bandeja_cadaver',
        condicaoAmbiental: camara.condicao,
        capacidade: 1,
      })),
    );
  }

  // --- M01: tabelas mestres e terminologia -------------------------------
  for (const def of TABELAS_MESTRES) {
    const [tabela] = await tx
      .insert(s.tabelaMestre)
      .values({ tenantId, chave: def.chave, nome: def.nome, sistema: true })
      .returning();

    const termos = await tx
      .insert(s.termo)
      .values(
        def.termos.map((valor, i) => ({
          tenantId,
          tabelaId: tabela!.id,
          valor,
          codigo: codificar(valor),
          ordem: i,
        })),
      )
      .returning();

    /**
     * Racas iniciais, penduradas na especie recem-criada. A lista cresce pelo
     * uso a cada cadastro (quinta revisao); isto e so o ponto de partida.
     */
    if (def.chave === 'especie') {
      const iniciais = termos.flatMap((especie) => {
        const lista = RACAS_INICIAIS[especie.valor] ?? [];
        return lista.map((nome, i) => ({
          tenantId,
          especieId: especie.id,
          nome,
          /**
           * A lista e ordenada por `usos`, entao a ordem escrita aqui vira uma
           * dianteira pequena - "SRD" no topo no primeiro dia. Bastam alguns
           * cadastros reais para o uso do laboratorio passar na frente.
           */
          usos: lista.length - i,
        }));
      });
      if (iniciais.length > 0) await tx.insert(s.raca).values(iniciais);
    }
  }

  // --- M01: servicos -----------------------------------------------------
  const [histopatologia] = await tx
    .insert(s.servico)
    .values({
      tenantId,
      // Review: "deixar só Histopatologia" - o nome curto e o que a bancada usa.
      nome: 'Histopatologia',
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
      // Quarta revisao: "de zero a tres dias verde, tres a cinco amarelo".
      alertaAtencaoHoras: 72,
      alertaCriticoHoras: 120,
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
    // "No citopatologico ele calcula em horas: 24 e 48."
    alertaAtencaoHoras: 24,
    alertaCriticoHoras: 48,
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

  // --- M10: tipos de solicitacao e seus fluxos ---------------------------
  for (const def of TIPOS_SOLICITACAO) {
    const [tipo] = await tx
      .insert(s.tipoSolicitacao)
      .values({
        tenantId,
        chave: def.chave,
        nome: def.nome,
        descricao: def.descricao ?? null,
        exigeAprovacao: def.exigeAprovacao ?? false,
        visivelPortal: def.visivelPortal ?? false,
        setorPadrao: def.setorPadrao ?? null,
        ordem: TIPOS_SOLICITACAO.indexOf(def),
      })
      .returning();

    if (def.etapas.length > 0) {
      await tx.insert(s.etapaTipoSolicitacao).values(
        def.etapas.map((etapa, i) => ({
          tenantId,
          tipoId: tipo!.id,
          ordem: i + 1,
          rotulo: etapa.rotulo,
          setor: etapa.setor ?? null,
          textoPortal: etapa.textoPortal ?? null,
          automatica: etapa.automatica ?? false,
        })),
      );
    }

    if (def.subtipos?.length) {
      await tx.insert(s.subtipoSolicitacao).values(
        def.subtipos.map((nome, i) => ({ tenantId, tipoId: tipo!.id, nome, ordem: i })),
      );
    }
  }

  await tx.insert(s.tipoPendencia).values(
    TIPOS_PENDENCIA.map((def, i) => ({
      tenantId,
      chave: def.chave,
      nome: def.nome,
      bloqueiaPadrao: def.bloqueiaPadrao ?? 'nao',
      ordem: i,
    })),
  );

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

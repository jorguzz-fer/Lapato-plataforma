import { hash } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import {
  MODULOS,
  PERFIS_PADRAO,
  PERMISSOES,
  TODAS_PERMISSOES,
  type Permissao,
} from '@lapato/shared';
import { comTenant, criarConexao, type Transacao } from '../client.js';
import * as s from '../schema/index.js';

/**
 * Seed de desenvolvimento: uma instituicao demonstrativa completa o bastante
 * para percorrer a fatia vertical de ponta a ponta.
 *
 * NAO e seed de producao. Cria senhas conhecidas e por isso recusa rodar fora de
 * desenvolvimento.
 */

const SENHA_DEMO = 'lapato123';

/** M02 secao 9: perfis iniciais, ajustaveis pela instituicao. */
const PERFIS: Array<{
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
      PERMISSOES.LAUDO_ASSINAR,
      PERMISSOES.LAUDO_LIBERAR,
      PERMISSOES.LAUDO_ADENDO,
      PERMISSOES.LAUDO_VER_NOTA_INTERNA,
      PERMISSOES.SOLICITACAO_VISUALIZAR,
      PERMISSOES.SOLICITACAO_CRIAR,
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

/** Tabelas mestres minimas para o fluxo funcionar (M01 secao 16). */
const TABELAS_MESTRES: Array<{ chave: string; nome: string; termos: string[] }> = [
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

async function semear(tx: Transacao, tenantId: string): Promise<void> {
  const senhaHash = await hash(SENHA_DEMO);

  // --- M01: unidade e setores -------------------------------------------
  const [sede] = await tx
    .insert(s.unidade)
    .values({
      tenantId,
      nome: 'Unidade Sede',
      codigo: 'SEDE',
      sigla: 'SD',
      tipo: 'sede',
    })
    .returning();

  const [apoio] = await tx
    .insert(s.unidade)
    .values({
      tenantId,
      nome: 'Laboratório de Apoio Histotécnica',
      codigo: 'APOIO',
      sigla: 'AP',
      // M09: "nos nao fazemos processamento. Esse e um servico terceirizado."
      tipo: 'laboratorio_apoio',
    })
    .returning();

  const setores = await tx
    .insert(s.setor)
    .values(
      ['recepcao', 'triagem', 'macroscopia', 'microscopia', 'histotecnica'].map((tipo) => ({
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
        codigo: valor
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .replace(/[^a-zA-Z0-9]+/g, '_')
          .toUpperCase(),
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
  const perfisCriados = new Map<string, string>();
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

    perfisCriados.set(def.chave, p!.id);
  }

  // --- M02: usuarios ------------------------------------------------------
  const usuariosDemo = [
    {
      nome: 'Ana Beatriz Silva',
      email: 'admin@lapato.local',
      perfil: PERFIS_PADRAO.ADMINISTRADOR_GERAL,
      unidade: sede!.id,
      setor: setores.find((x) => x.tipo === 'recepcao')?.id,
    },
    {
      nome: 'Carla Menezes',
      email: 'recepcao@lapato.local',
      perfil: PERFIS_PADRAO.RECEPCAO,
      unidade: sede!.id,
      setor: setores.find((x) => x.tipo === 'recepcao')?.id,
    },
    {
      nome: 'João Pedro Almeida',
      email: 'tecnico@lapato.local',
      perfil: PERFIS_PADRAO.TECNICO_LABORATORIO,
      unidade: sede!.id,
      setor: setores.find((x) => x.tipo === 'triagem')?.id,
    },
    {
      nome: 'Dra. Marina Costa',
      email: 'patologista@lapato.local',
      perfil: PERFIS_PADRAO.PATOLOGISTA,
      unidade: sede!.id,
      setor: setores.find((x) => x.tipo === 'microscopia')?.id,
      identificacaoProfissional: 'CRMV-CE 12345',
    },
    {
      nome: 'Lucas Ferreira',
      email: 'residente@lapato.local',
      perfil: PERFIS_PADRAO.RESIDENTE,
      unidade: sede!.id,
      setor: setores.find((x) => x.tipo === 'microscopia')?.id,
    },
    {
      nome: 'Histotécnica Parceira',
      email: 'apoio@lapato.local',
      perfil: PERFIS_PADRAO.LABORATORIO_APOIO,
      unidade: apoio!.id,
      setor: undefined,
    },
  ];

  for (const def of usuariosDemo) {
    const [u] = await tx
      .insert(s.usuario)
      .values({
        tenantId,
        nomeCompleto: def.nome,
        email: def.email,
        senhaHash,
        status: 'ativo',
        categoria: def.perfil === PERFIS_PADRAO.LABORATORIO_APOIO ? 'externo' : 'interno',
        unidadePrincipalId: def.unidade,
        setorPrincipalId: def.setor ?? null,
        dadosProfissionais: def.identificacaoProfissional
          ? { conselho: def.identificacaoProfissional }
          : {},
      })
      .returning();

    await tx.insert(s.usuarioPerfil).values({
      tenantId,
      usuarioId: u!.id,
      perfilId: perfisCriados.get(def.perfil)!,
    });

    await tx.insert(s.usuarioUnidade).values({
      tenantId,
      usuarioId: u!.id,
      unidadeId: def.unidade,
      nivelAcesso: 'total',
    });

    // M02: a assinatura e pessoal; sem ela, o laudo nao pode ser liberado.
    if (def.identificacaoProfissional) {
      await tx.insert(s.assinaturaProfissional).values({
        tenantId,
        usuarioId: u!.id,
        identificacaoProfissional: def.identificacaoProfissional,
        tipo: 'eletronica',
      });
    }
  }

  // --- M03: cliente e veterinario ----------------------------------------
  const [clinica] = await tx
    .insert(s.cliente)
    .values({
      tenantId,
      nomeFantasia: 'Clínica Veterinária Central',
      razaoSocial: 'Clínica Veterinária Central LTDA',
      tipo: 'clinica',
      codigo: 'CV',
      status: 'ativo',
    })
    .returning();

  await tx.insert(s.clienteEndereco).values({
    tenantId,
    clienteId: clinica!.id,
    tipo: 'sede',
    logradouro: 'Av. Santos Dumont',
    numero: '1500',
    bairro: 'Aldeota',
    municipio: 'Fortaleza',
    estado: 'CE',
    cep: '60150-161',
    padraoColeta: true,
    padraoFaturamento: true,
  });

  const [vet] = await tx
    .insert(s.veterinario)
    .values({
      tenantId,
      nome: 'Dr. Rafael Nogueira',
      crmv: '9876',
      crmvUf: 'CE',
      email: 'rafael@clinicacentral.local',
      especialidade: 'Clínica de pequenos animais',
    })
    .returning();

  await tx.insert(s.vinculoVeterinarioCliente).values({
    tenantId,
    veterinarioId: vet!.id,
    clienteId: clinica!.id,
    principal: true,
  });

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
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('O seed de demonstracao nao roda em producao: ele cria senhas conhecidas.');
  }

  const url = process.env.DATABASE_MIGRATION_URL;
  if (!url) throw new Error('DATABASE_MIGRATION_URL nao definida.');

  const slug = process.env.SEED_TENANT_SLUG ?? 'demo';
  const { db, encerrar } = criarConexao({ url, max: 1 });

  try {
    const existente = await db.select().from(s.tenant).where(eq(s.tenant.slug, slug)).limit(1);
    if (existente.length > 0) {
      console.warn(`instituicao "${slug}" ja existe; nada a fazer.`);
      return;
    }

    const [novo] = await db
      .insert(s.tenant)
      .values({
        slug,
        razaoSocial: 'LAPATO Necropsia Veterinária LTDA',
        nomeFantasia: 'LAPATO',
        preferencias: { idioma: 'pt-BR', fusoHorario: 'America/Fortaleza' },
      })
      .returning();

    await comTenant(db, novo!.id, (tx) => semear(tx, novo!.id));

    console.warn(`instituicao "${slug}" criada.`);
    console.warn(`usuarios de demonstracao (senha: ${SENHA_DEMO}):`);
    console.warn('  admin@lapato.local        Administrador Geral');
    console.warn('  recepcao@lapato.local     Recepção');
    console.warn('  tecnico@lapato.local      Técnico de Laboratório');
    console.warn('  patologista@lapato.local  Patologista');
    console.warn('  residente@lapato.local    Residente (sem assinar/liberar)');
    console.warn('  apoio@lapato.local        Laboratório de Apoio (externo)');
  } finally {
    await encerrar();
  }
}

main().catch((erro: unknown) => {
  console.error('falha no seed:', erro);
  process.exitCode = 1;
});

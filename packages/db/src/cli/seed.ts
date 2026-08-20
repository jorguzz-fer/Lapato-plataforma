import { hash } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import { exigeMfa, PERFIS_PADRAO, TODAS_PERMISSOES } from '@lapato/shared';
import { criarBaseInstitucional, PERFIS } from '../base-institucional.js';
import { comTenant, criarConexao, type Transacao } from '../client.js';
import * as s from '../schema/index.js';

/**
 * Seed de desenvolvimento: uma instituicao demonstrativa completa o bastante
 * para percorrer a fatia vertical de ponta a ponta.
 *
 * NAO e seed de producao. Cria senhas conhecidas e por isso recusa rodar fora de
 * desenvolvimento. Para criar a instituicao real, use `pnpm db:provision`.
 *
 * A configuracao institucional (unidades, setores, tabelas mestres, servicos,
 * etiquetas, workflow, perfis e politica de IA) vem de `criarBaseInstitucional`,
 * a mesma usada em producao. O que este arquivo acrescenta e apenas dado ficticio.
 */

const SENHA_DEMO = 'lapato123';

/**
 * Segredo TOTP fixo dos usuarios de demonstracao que exigem MFA.
 *
 * O Blueprint secao 6 exige segundo fator para quem administra e para quem
 * assina laudo, e essa regra vale igual em desenvolvimento - nao existe flag de
 * ambiente que a desligue, porque uma regra de seguranca que some em dev deixa
 * de ser testada justamente onde os testes rodam.
 *
 * A conciliacao e este segredo conhecido: o fluxo executado e exatamente o de
 * producao, so o segredo e publico. Serve ao mesmo proposito da senha
 * `lapato123` - e, como ela, so existe porque o seed recusa rodar em producao.
 *
 * Para entrar no ambiente de demonstracao, gere o codigo com:
 *   npx otpauth totp generate --secret JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP
 * ou cadastre o segredo em qualquer aplicativo autenticador.
 */
const SEGREDO_MFA_DEMO = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

/**
 * O perfil concede alguma permissao que obriga segundo fator?
 *
 * Deriva da mesma lista que a API consulta em tempo de execucao, entao mudar
 * `PERMISSOES_QUE_EXIGEM_MFA` ajusta o seed sozinho - nao ha segunda copia da
 * regra para sair de sincronia.
 */
function perfilExigeMfa(chave: string): boolean {
  const def = PERFIS.find((p) => p.chave === chave);
  if (!def) return false;
  const permissoes = def.permissoes === 'todas' ? TODAS_PERMISSOES : def.permissoes;
  return exigeMfa(permissoes);
}

async function semear(tx: Transacao, tenantId: string): Promise<void> {
  const senhaHash = await hash(SENHA_DEMO);

  const base = await criarBaseInstitucional(tx, tenantId, {
    laboratorioApoio: { nome: 'Laboratório de Apoio Histotécnica' },
  });

  const setorId = (tipo: string): string | undefined =>
    base.setores.find((x) => x.tipo === tipo)?.id;

  // --- M02: usuarios ------------------------------------------------------
  const usuariosDemo = [
    {
      nome: 'Ana Beatriz Silva',
      email: 'admin@lapato.local',
      perfil: PERFIS_PADRAO.ADMINISTRADOR_GERAL,
      unidade: base.sedeId,
      setor: setorId('recepcao'),
    },
    {
      nome: 'Carla Menezes',
      email: 'recepcao@lapato.local',
      perfil: PERFIS_PADRAO.RECEPCAO,
      unidade: base.sedeId,
      setor: setorId('recepcao'),
    },
    {
      nome: 'João Pedro Almeida',
      email: 'tecnico@lapato.local',
      perfil: PERFIS_PADRAO.TECNICO_LABORATORIO,
      unidade: base.sedeId,
      setor: setorId('triagem'),
    },
    {
      nome: 'Dra. Marina Costa',
      email: 'patologista@lapato.local',
      perfil: PERFIS_PADRAO.PATOLOGISTA,
      unidade: base.sedeId,
      setor: setorId('microscopia'),
      identificacaoProfissional: 'CRMV-CE 12345',
    },
    {
      nome: 'Lucas Ferreira',
      email: 'residente@lapato.local',
      perfil: PERFIS_PADRAO.RESIDENTE,
      unidade: base.sedeId,
      setor: setorId('microscopia'),
    },
    {
      nome: 'Histotécnica Parceira',
      email: 'apoio@lapato.local',
      perfil: PERFIS_PADRAO.LABORATORIO_APOIO,
      unidade: base.apoioId!,
      setor: undefined,
    },
  ];

  for (const def of usuariosDemo) {
    const comMfa = perfilExigeMfa(def.perfil);

    const [u] = await tx
      .insert(s.usuario)
      .values({
        tenantId,
        nomeCompleto: def.nome,
        email: def.email,
        senhaHash,
        mfaSegredo: comMfa ? SEGREDO_MFA_DEMO : null,
        mfaAtivo: comMfa,
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
      perfilId: base.perfis.get(def.perfil)!,
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
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'O seed de demonstracao nao roda em producao: ele cria senhas conhecidas. Use `pnpm db:provision`.',
    );
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
    console.warn('  admin@lapato.local        Administrador Geral        [MFA]');
    console.warn('  recepcao@lapato.local     Recepção');
    console.warn('  tecnico@lapato.local      Técnico de Laboratório');
    console.warn('  patologista@lapato.local  Patologista                [MFA]');
    console.warn('  residente@lapato.local    Residente (sem assinar/liberar)');
    console.warn('  apoio@lapato.local        Laboratório de Apoio (externo)');
    console.warn('');
    console.warn(`  [MFA] segredo TOTP de demonstracao: ${SEGREDO_MFA_DEMO}`);
  } finally {
    await encerrar();
  }
}

main().catch((erro: unknown) => {
  console.error('falha no seed:', erro);
  process.exitCode = 1;
});

import { randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  assinaturaProfissional,
  cliente,
  perfil,
  sessao,
  unidade,
  usuario,
  usuarioPerfil,
  type Transacao,
} from '@lapato/db';
import { PERFIS_PADRAO } from '@lapato/shared';
import { DbService } from '../../core/db/db.service.js';
import { AuditoriaService } from '../../core/auditoria/auditoria.service.js';
import { exigirContexto } from '../../core/contexto/contexto-requisicao.js';

export interface NovoUsuario {
  nomeCompleto: string;
  email: string;
  perfilIds: string[];
  unidadePrincipalId?: string;
  telefone?: string;
  /**
   * M04: cliente ao qual a conta EXTERNA pertence. E dele que sai todo o
   * escopo do Portal - sem o vinculo, a conta entra e nao ve nada, porque nao
   * existe "ver tudo" do lado de fora.
   */
  clienteId?: string;
}

/**
 * M02 - gestao de usuarios (a AUTENTICACAO vive em core/auth; aqui e o ciclo
 * de vida da conta).
 *
 * Regras que estruturam o servico:
 * - **Identidade individual** (secao 3): um e-mail, uma pessoa - contas
 *   compartilhadas sao proibidas, e o e-mail e unico por instituicao.
 * - **Senha definida por terceiro vale para um acesso** (secao 31): criacao e
 *   reset administrativo geram senha provisoria com troca obrigatoria; o funil
 *   de sessao prende a conta ate a troca. A senha aparece UMA vez, para quem
 *   criou - o banco guarda so o hash Argon2id.
 * - **Bloquear nao apaga** (secoes 33-34): a conta bloqueada preserva historico
 *   e autoria; as sessoes abertas caem na hora.
 */
@Injectable()
export class UsuariosService {
  constructor(
    private readonly db: DbService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async listar(): Promise<unknown[]> {
    const ctx = exigirContexto();

    return this.db.executar((tx) =>
      tx
        .select({
          id: usuario.id,
          nomeCompleto: usuario.nomeCompleto,
          email: usuario.email,
          status: usuario.status,
          categoria: usuario.categoria,
          mfaAtivo: usuario.mfaAtivo,
          senhaTrocaObrigatoria: usuario.senhaTrocaObrigatoria,
          ultimoAcessoEm: usuario.ultimoAcessoEm,
          unidadePrincipal: unidade.nome,
          /**
           * M11 + M02: sem assinatura ativa e valida o Guardian barra a
           * assinatura do laudo. Quem administra precisa enxergar isso na
           * lista, e nao descobrir pelo patologista travado na bancada.
           */
          assinaturaAtiva: sql<boolean>`exists(
            select 1 from ${assinaturaProfissional} ap
            where ap.usuario_id = usuario.id
              and ap.tenant_id = usuario.tenant_id
              and ap.ativa = true
              and (ap.valido_ate is null or ap.valido_ate > now())
          )`,
          perfis: sql<string>`coalesce((
            select string_agg(p.nome, ' · ' order by p.nome)
            from ${usuarioPerfil} up
            join ${perfil} p on p.id = up.perfil_id
            where up.usuario_id = usuario.id and up.tenant_id = usuario.tenant_id
          ), '')`,
        })
        .from(usuario)
        .leftJoin(unidade, eq(unidade.id, usuario.unidadePrincipalId))
        .where(eq(usuario.tenantId, ctx.tenantId))
        .orderBy(asc(usuario.nomeCompleto)),
    );
  }

  /** Perfis disponiveis para atribuicao (M02 secao 9). */
  async listarPerfis(): Promise<unknown[]> {
    const ctx = exigirContexto();

    return this.db.executar((tx) =>
      tx
        .select({
          id: perfil.id,
          chave: perfil.chave,
          nome: perfil.nome,
          exigeSupervisao: perfil.exigeSupervisao,
        })
        .from(perfil)
        .where(and(eq(perfil.tenantId, ctx.tenantId), isNull(perfil.inativadoEm)))
        .orderBy(asc(perfil.nome)),
    );
  }

  /**
   * Cria a conta com senha provisoria e troca obrigatoria (secao 31). A conta
   * nasce `ativo` porque o funil de sessao ja prende o primeiro login na troca
   * de senha - e, se algum perfil exigir, no cadastro de MFA na sequencia.
   */
  async criar(dados: NovoUsuario): Promise<{ id: string; senhaProvisoria: string }> {
    const ctx = exigirContexto();

    if (dados.perfilIds.length === 0) {
      throw new BadRequestException(
        'Atribua ao menos um perfil - conta sem perfil não consegue fazer nada.',
      );
    }

    return this.db.executar(async (tx) => {
      const email = dados.email.trim().toLowerCase();

      const [existente] = await tx
        .select({ id: usuario.id })
        .from(usuario)
        .where(and(eq(usuario.tenantId, ctx.tenantId), eq(usuario.email, email)))
        .limit(1);
      if (existente) {
        // Secao 3: identidade individual - um e-mail, uma pessoa.
        throw new BadRequestException(`Já existe uma conta com o e-mail ${email}.`);
      }

      const perfisValidos = await tx
        .select({ id: perfil.id, chave: perfil.chave })
        .from(perfil)
        .where(
          and(
            eq(perfil.tenantId, ctx.tenantId),
            inArray(perfil.id, dados.perfilIds),
            isNull(perfil.inativadoEm),
          ),
        );
      if (perfisValidos.length !== dados.perfilIds.length) {
        throw new BadRequestException('Perfil inexistente ou inativo na lista.');
      }

      /**
       * M04 secao 5: perfil do Portal sem cliente vinculado seria uma conta
       * externa sem escopo. Barrar na criacao evita a conta que entra e ve uma
       * tela vazia sem ninguem entender por que.
       */
      const ehDoPortal = perfisValidos.some(
        (p) =>
          p.chave === PERFIS_PADRAO.CLIENTE ||
          p.chave === PERFIS_PADRAO.VETERINARIO_SOLICITANTE,
      );

      if (ehDoPortal && !dados.clienteId) {
        throw new BadRequestException(
          'Conta do Portal precisa estar vinculada a um cliente.',
        );
      }

      if (dados.clienteId) {
        const [alvo] = await tx
          .select({ id: cliente.id })
          .from(cliente)
          .where(and(eq(cliente.tenantId, ctx.tenantId), eq(cliente.id, dados.clienteId)))
          .limit(1);
        if (!alvo) throw new BadRequestException('Cliente inexistente.');
      }

      const senhaProvisoria = this.gerarSenhaProvisoria();

      const [novo] = await tx
        .insert(usuario)
        .values({
          tenantId: ctx.tenantId,
          nomeCompleto: dados.nomeCompleto.trim(),
          email,
          telefone: dados.telefone?.trim() || null,
          senhaHash: await hash(senhaProvisoria),
          senhaTrocaObrigatoria: true,
          status: 'ativo',
          unidadePrincipalId: dados.unidadePrincipalId ?? null,
          categoria: dados.clienteId ? 'externo' : 'interno',
          clienteId: dados.clienteId ?? null,
        })
        .returning({ id: usuario.id });

      await tx.insert(usuarioPerfil).values(
        dados.perfilIds.map((perfilId) => ({
          tenantId: ctx.tenantId,
          usuarioId: novo!.id,
          perfilId,
        })),
      );

      await this.auditoria.registrar(tx, {
        entidade: 'usuario',
        entidadeId: novo!.id,
        acao: 'criar',
        valorNovo: { nomeCompleto: dados.nomeCompleto, email, perfis: dados.perfilIds.length },
      });

      return { id: novo!.id, senhaProvisoria };
    });
  }

  async editar(
    id: string,
    dados: { nomeCompleto?: string; perfilIds?: string[]; unidadePrincipalId?: string | null },
  ): Promise<void> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const atual = await this.buscar(tx, id);

      if (dados.nomeCompleto !== undefined || dados.unidadePrincipalId !== undefined) {
        await tx
          .update(usuario)
          .set({
            ...(dados.nomeCompleto !== undefined
              ? { nomeCompleto: dados.nomeCompleto.trim() }
              : {}),
            ...(dados.unidadePrincipalId !== undefined
              ? { unidadePrincipalId: dados.unidadePrincipalId }
              : {}),
            atualizadoEm: new Date(),
          })
          .where(eq(usuario.id, id));
      }

      if (dados.perfilIds !== undefined) {
        if (dados.perfilIds.length === 0) {
          throw new BadRequestException('A conta precisa de ao menos um perfil.');
        }

        /**
         * Troca de perfis e SUBSTITUICAO do conjunto - e vale na proxima
         * sessao, porque as permissoes sao resolvidas no login. Reduzir
         * privilegio de sessao aberta exige bloquear (que revoga as sessoes).
         */
        await tx
          .delete(usuarioPerfil)
          .where(
            and(eq(usuarioPerfil.tenantId, ctx.tenantId), eq(usuarioPerfil.usuarioId, id)),
          );
        await tx.insert(usuarioPerfil).values(
          dados.perfilIds.map((perfilId) => ({
            tenantId: ctx.tenantId,
            usuarioId: id,
            perfilId,
          })),
        );
      }

      await this.auditoria.registrar(tx, {
        entidade: 'usuario',
        entidadeId: id,
        acao: 'editar',
        valorAnterior: { nomeCompleto: atual.nomeCompleto },
        valorNovo: {
          ...(dados.nomeCompleto !== undefined ? { nomeCompleto: dados.nomeCompleto } : {}),
          ...(dados.perfilIds !== undefined ? { perfis: dados.perfilIds.length } : {}),
        },
      });
    });
  }

  /** Secao 33: bloqueio derruba as sessoes na hora - nao espera expirar. */
  async bloquear(id: string): Promise<void> {
    const ctx = exigirContexto();

    if (id === ctx.usuarioId) {
      // A conta que se bloqueasse deixaria a instituicao sem quem desbloqueie.
      throw new BadRequestException('Não é possível bloquear a própria conta.');
    }

    return this.db.executar(async (tx) => {
      const atual = await this.buscar(tx, id);
      if (atual.status === 'bloqueado') {
        throw new BadRequestException('Esta conta já está bloqueada.');
      }

      await tx
        .update(usuario)
        .set({ status: 'bloqueado', atualizadoEm: new Date() })
        .where(eq(usuario.id, id));

      await tx
        .update(sessao)
        .set({ revogadaEm: new Date() })
        .where(
          and(
            eq(sessao.tenantId, ctx.tenantId),
            eq(sessao.usuarioId, id),
            isNull(sessao.revogadaEm),
          ),
        );

      await this.auditoria.registrar(tx, {
        entidade: 'usuario',
        entidadeId: id,
        acao: 'bloquear',
        valorAnterior: { status: atual.status },
        valorNovo: { status: 'bloqueado' },
      });
    });
  }

  async reativar(id: string): Promise<void> {
    return this.db.executar(async (tx) => {
      const atual = await this.buscar(tx, id);
      if (atual.status === 'ativo') {
        throw new BadRequestException('Esta conta já está ativa.');
      }

      await tx
        .update(usuario)
        .set({
          status: 'ativo',
          // Zera o lockout progressivo: reativar com o contador cheio
          // deixaria a conta "ativa" mas ainda travada pelo bloqueio temporal.
          tentativasFalhas: { contador: 0, bloqueadoAte: null },
          atualizadoEm: new Date(),
        })
        .where(eq(usuario.id, id));

      await this.auditoria.registrar(tx, {
        entidade: 'usuario',
        entidadeId: id,
        acao: 'reativar',
        valorAnterior: { status: atual.status },
        valorNovo: { status: 'ativo' },
      });
    });
  }

  /**
   * Reset administrativo (secao 32): nova senha provisoria, troca obrigatoria,
   * sessoes revogadas. A senha aparece uma vez para quem resetou - e o reset
   * fica na auditoria, porque e um ato sobre a conta de OUTRA pessoa.
   */
  async redefinirSenha(id: string): Promise<{ senhaProvisoria: string }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      await this.buscar(tx, id);

      const senhaProvisoria = this.gerarSenhaProvisoria();

      await tx
        .update(usuario)
        .set({
          senhaHash: await hash(senhaProvisoria),
          senhaTrocaObrigatoria: true,
          senhaAlteradaEm: new Date(),
          tentativasFalhas: { contador: 0, bloqueadoAte: null },
          atualizadoEm: new Date(),
        })
        .where(eq(usuario.id, id));

      await tx
        .update(sessao)
        .set({ revogadaEm: new Date() })
        .where(
          and(
            eq(sessao.tenantId, ctx.tenantId),
            eq(sessao.usuarioId, id),
            isNull(sessao.revogadaEm),
          ),
        );

      await this.auditoria.registrar(tx, {
        entidade: 'usuario',
        entidadeId: id,
        acao: 'redefinir_senha',
      });

      return { senhaProvisoria };
    });
  }

  // --- internos --------------------------------------------------------------

  private gerarSenhaProvisoria(): string {
    // 12 bytes -> 16 chars base64url: entropia alta, digitavel, sem ambiguidade
    // de shell (sem +, / ou =).
    return randomBytes(12).toString('base64url');
  }

/**
   * Assinaturas do profissional (M02 secao 45).
   *
   * Ate aqui isto so existia no CLI de provisionamento: quem nao passasse
   * `PROVISION_ADMIN_CONSELHO` ficava com um sistema que barra a assinatura do
   * laudo e nao oferece nenhum lugar para resolver. Um bloqueio critico sem
   * caminho de saida dentro do produto e defeito, nao rigor.
   */
  async listarAssinaturas(usuarioId: string): Promise<unknown[]> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      await this.buscar(tx, usuarioId);

      return tx
        .select({
          id: assinaturaProfissional.id,
          tipo: assinaturaProfissional.tipo,
          identificacaoProfissional: assinaturaProfissional.identificacaoProfissional,
          validoDe: assinaturaProfissional.validoDe,
          validoAte: assinaturaProfissional.validoAte,
          ativa: assinaturaProfissional.ativa,
        })
        .from(assinaturaProfissional)
        .where(
          and(
            eq(assinaturaProfissional.tenantId, ctx.tenantId),
            eq(assinaturaProfissional.usuarioId, usuarioId),
          ),
        )
        .orderBy(desc(assinaturaProfissional.validoDe));
    });
  }

  /**
   * Registra uma assinatura. Renovacao cria registro novo e inativa o anterior
   * - o laudo ja assinado precisa continuar apontando para a identificacao que
   * valia no momento da assinatura (M11 secao 118).
   */
  async registrarAssinatura(
    usuarioId: string,
    dados: { identificacaoProfissional: string; validoAte?: string | null },
  ): Promise<{ id: string }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const alvo = await this.buscar(tx, usuarioId);

      if (alvo.categoria === 'externo') {
        throw new BadRequestException(
          'Conta externa não assina laudo: assinatura profissional é de usuário interno.',
        );
      }

      const validoAte = dados.validoAte ? new Date(dados.validoAte) : null;
      if (validoAte && validoAte <= new Date()) {
        throw new BadRequestException('A validade informada já passou.');
      }

      await tx
        .update(assinaturaProfissional)
        .set({ ativa: false, atualizadoEm: new Date() })
        .where(
          and(
            eq(assinaturaProfissional.tenantId, ctx.tenantId),
            eq(assinaturaProfissional.usuarioId, usuarioId),
            eq(assinaturaProfissional.ativa, true),
          ),
        );

      const [nova] = await tx
        .insert(assinaturaProfissional)
        .values({
          tenantId: ctx.tenantId,
          usuarioId,
          tipo: 'eletronica',
          identificacaoProfissional: dados.identificacaoProfissional.trim(),
          validoAte,
          ativa: true,
        })
        .returning({ id: assinaturaProfissional.id });

      await this.auditoria.registrar(tx, {
        entidade: 'assinatura_profissional',
        entidadeId: nova!.id,
        acao: 'registrar',
        valorNovo: {
          usuarioId,
          identificacaoProfissional: dados.identificacaoProfissional.trim(),
          validoAte: validoAte?.toISOString() ?? null,
        },
      });

      return { id: nova!.id };
    });
  }

  /** Inativa, nunca apaga (M01): o laudo assinado precisa do registro historico. */
  async inativarAssinatura(usuarioId: string, assinaturaId: string): Promise<void> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const [atual] = await tx
        .select()
        .from(assinaturaProfissional)
        .where(
          and(
            eq(assinaturaProfissional.tenantId, ctx.tenantId),
            eq(assinaturaProfissional.id, assinaturaId),
            eq(assinaturaProfissional.usuarioId, usuarioId),
          ),
        )
        .limit(1);

      if (!atual) throw new NotFoundException('Assinatura não encontrada.');
      if (!atual.ativa) throw new BadRequestException('Esta assinatura já está inativa.');

      await tx
        .update(assinaturaProfissional)
        .set({ ativa: false, atualizadoEm: new Date() })
        .where(eq(assinaturaProfissional.id, assinaturaId));

      await this.auditoria.registrar(tx, {
        entidade: 'assinatura_profissional',
        entidadeId: assinaturaId,
        acao: 'inativar',
        valorAnterior: { ativa: true },
        valorNovo: { ativa: false },
      });
    });
  }

  private async buscar(tx: Transacao, id: string) {
    const ctx = exigirContexto();
    const [linha] = await tx
      .select()
      .from(usuario)
      .where(and(eq(usuario.tenantId, ctx.tenantId), eq(usuario.id, id)))
      .limit(1);
    if (!linha) throw new NotFoundException('Usuário não encontrado.');
    return linha;
  }
}

import { randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  perfil,
  sessao,
  unidade,
  usuario,
  usuarioPerfil,
  type Transacao,
} from '@lapato/db';
import { DbService } from '../../core/db/db.service.js';
import { AuditoriaService } from '../../core/auditoria/auditoria.service.js';
import { exigirContexto } from '../../core/contexto/contexto-requisicao.js';

export interface NovoUsuario {
  nomeCompleto: string;
  email: string;
  perfilIds: string[];
  unidadePrincipalId?: string;
  telefone?: string;
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
        .select({ id: perfil.id })
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

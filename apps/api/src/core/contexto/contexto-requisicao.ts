import { AsyncLocalStorage } from 'node:async_hooks';
import type { EstagioSessao, Permissao } from '@lapato/shared';

/**
 * Contexto do request, resolvido SEMPRE no servidor.
 *
 * Blueprint secao 1: "regra de negocio, autenticacao e autorizacao vivem no
 * servidor. O cliente e apresentacao; nunca e fronteira de confianca."
 *
 * ADR 0002: o `tenantId` sai da sessao, nunca do corpo ou do cabecalho do
 * request - senao bastaria trocar um campo no JSON para ler outra instituicao.
 */
export interface ContextoRequisicao {
  requestId: string;
  tenantId: string;
  usuarioId: string;
  /** Unidade ativa da sessao (M02 secao 15). */
  unidadeId: string | null;
  setorId: string | null;
  /** Permissoes efetivas ja resolvidas pela hierarquia do M02. */
  permissoes: ReadonlySet<Permissao>;
  /** Unidades em que o usuario pode atuar. Usado pelo escopo de permissao. */
  unidadesPermitidas: ReadonlySet<string>;
  /** M02: perfil que exige supervisao (residente) muda o que pode ser concluido. */
  exigeSupervisao: boolean;
  /** M03/M04: preenchido quando o usuario e externo, para isolar por cliente. */
  clienteId: string | null;
  /**
   * Ate onde esta sessao chegou no funil de entrada. Rotas de negocio so
   * respondem em `ativa`; o `SessaoGuard` aplica a regra.
   */
  estagio: EstagioSessao;
  /** Se a conta ja tem segundo fator ativo. A tela oferece o cadastro quando nao tem. */
  mfaAtivo: boolean;
  ip: string | null;
  userAgent: string | null;
}

const armazenamento = new AsyncLocalStorage<ContextoRequisicao>();

export function executarComContexto<T>(contexto: ContextoRequisicao, fn: () => T): T {
  return armazenamento.run(contexto, fn);
}

/** Contexto atual, ou `undefined` em rotas publicas e jobs. */
export function contextoAtual(): ContextoRequisicao | undefined {
  return armazenamento.getStore();
}

/**
 * Contexto atual, exigindo que exista.
 *
 * Falha alto e cedo: um servico de dominio rodando sem contexto significa que
 * alguem contornou o guard de sessao, e nesse caso e melhor quebrar do que
 * consultar o banco sem tenant.
 */
export function exigirContexto(): ContextoRequisicao {
  const ctx = armazenamento.getStore();
  if (!ctx) {
    throw new Error(
      'Contexto de requisicao ausente. Esta operacao exige sessao autenticada.',
    );
  }
  return ctx;
}

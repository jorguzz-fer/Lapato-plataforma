/**
 * Schema do LAPATO.
 *
 * Organizado por area de dominio, seguindo os modulos oficiais. Toda tabela de
 * dominio carrega `tenant_id` e tem Row-Level Security ativa (ADR 0002) - a
 * migration `0001_rls.sql` aplica as policies e o teste de isolamento prova que
 * funcionam.
 */
export * from './_comum.js';
export * from './tenancy.js';
export * from './identidade.js';
export * from './configuracao.js';
export * from './clientes.js';
export * from './caso.js';
export * from './fluxo.js';
export * from './eventos.js';
export * from './auditoria.js';
export * from './macroscopia.js';
export * from './processamento.js';
export * from './solicitacoes.js';
export * from './laudo.js';
export * from './citologia.js';
export * from './imagens.js';
export * from './ia.js';

import { BadRequestException } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Valida o corpo do request contra um schema Zod.
 *
 * Usar Zod (e nao class-validator) mantem um unico vocabulario de schema no
 * monorepo: os mesmos tipos podem ser reaproveitados pelo front via
 * `@lapato/shared`, sem duplicar regra de validacao em dois lugares.
 *
 * Os erros saem no formato RFC 7807 pelo `ProblemaFilter` (Blueprint secao 8).
 */
export function validarCorpo<T>(schema: ZodType<T>, valor: unknown): T {
  const resultado = schema.safeParse(valor);

  if (!resultado.success) {
    throw new BadRequestException({
      title: 'Dados inválidos',
      detail: 'O corpo da requisição não passou na validação.',
      errors: resultado.error.issues.map((i) => ({
        campo: i.path.join('.'),
        mensagem: i.message,
      })),
    });
  }

  return resultado.data;
}

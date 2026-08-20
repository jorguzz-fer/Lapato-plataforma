import type { FormEvent, ReactNode } from 'react';

/**
 * Moldura comum das telas do funil de entrada (login, segundo fator, troca de
 * senha, cadastro de MFA).
 *
 * Existe para que as quatro telas sejam visualmente a mesma coisa: o usuario
 * atravessa ate tres delas em sequencia, e trocar o enquadramento no meio do
 * caminho passa a impressao de que algo deu errado.
 */
export function CartaoDeEntrada({
  titulo,
  descricao,
  erro,
  children,
  aoSubmeter,
  acao,
  enviando,
  rodape,
  largura = 'max-w-sm',
}: {
  titulo: string;
  descricao?: string;
  erro?: string | null;
  children: ReactNode;
  aoSubmeter: (e: FormEvent) => void;
  acao: string;
  /** Desabilita o botao: envio em curso ou formulario ainda incompleto. */
  enviando: boolean;
  rodape?: ReactNode;
  largura?: string;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={aoSubmeter} className={`cartao w-full ${largura} space-y-4 p-6`}>
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--lapato-primaria)' }}>
            LAPATO
          </h1>
          <p className="rotulo">{titulo}</p>
        </div>

        {descricao && <p className="text-sm">{descricao}</p>}

        {children}

        {erro && (
          <p role="alert" className="text-xs" style={{ color: 'var(--lapato-perigo)' }}>
            {erro}
          </p>
        )}

        <button
          type="submit"
          disabled={enviando}
          className="w-full rounded px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          style={{ background: 'var(--lapato-primaria)' }}
        >
          {acao}
        </button>

        {rodape}
      </form>
    </div>
  );
}

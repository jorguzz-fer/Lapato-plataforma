import { useId, useState, type ReactNode } from 'react';

/**
 * Campo de senha com alternancia de visibilidade.
 *
 * Existe porque senha mascarada esconde o erro de digitacao, e nao so a senha.
 * Numa senha inicial longa, gerada e transcrita de outro lugar, um caractere
 * trocado - `I` por `l`, `0` por `O` - produz "credenciais invalidas" sem
 * nenhuma pista de onde esta o engano. Poder conferir antes de enviar resolve
 * isso, e o risco de alguem ler a tela e escolha de quem esta na frente dela.
 *
 * O estado nasce oculto: mostrar e sempre um ato deliberado.
 */
export function CampoSenha({
  rotulo,
  valor,
  aoMudar,
  autoComplete,
  autoFocus,
  minLength,
  ajuda,
  erro,
}: {
  rotulo: string;
  valor: string;
  aoMudar: (valor: string) => void;
  autoComplete: 'current-password' | 'new-password';
  autoFocus?: boolean;
  minLength?: number;
  ajuda?: ReactNode;
  erro?: string;
}) {
  const [visivel, setVisivel] = useState(false);
  const id = useId();
  const idAjuda = `${id}-ajuda`;

  return (
    <label className="block" htmlFor={id}>
      <span className="rotulo">{rotulo}</span>

      <div className="relative mt-1">
        <input
          id={id}
          type={visivel ? 'text' : 'password'}
          value={valor}
          onChange={(e) => aoMudar(e.target.value)}
          required
          autoFocus={autoFocus}
          autoComplete={autoComplete}
          minLength={minLength}
          aria-describedby={ajuda || erro ? idAjuda : undefined}
          aria-invalid={erro ? true : undefined}
          // `pr-11` reserva o espaco do botao: sem isso o texto passa por baixo.
          className="w-full rounded border py-2 pl-3 pr-11"
          style={{ borderColor: 'var(--lapato-borda)', background: 'var(--lapato-superficie)' }}
        />

        <button
          type="button"
          onClick={() => setVisivel((v) => !v)}
          // `aria-pressed` comunica estado a leitores de tela; o rotulo diz a acao.
          aria-pressed={visivel}
          aria-label={visivel ? 'Ocultar senha' : 'Mostrar senha'}
          title={visivel ? 'Ocultar senha' : 'Mostrar senha'}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r"
          style={{ color: 'var(--lapato-texto-suave, #6c757d)' }}
        >
          {visivel ? <IconeOlhoFechado /> : <IconeOlho />}
        </button>
      </div>

      {(ajuda || erro) && (
        <span
          id={idAjuda}
          className="mt-1 block text-xs"
          style={erro ? { color: 'var(--lapato-perigo)' } : undefined}
        >
          {erro ?? ajuda}
        </span>
      )}
    </label>
  );
}

/* Ícones inline: dois SVGs não justificam uma dependência de biblioteca.
   `aria-hidden` porque quem anuncia a ação é o `aria-label` do botão. */

function IconeOlho() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconeOlhoFechado() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

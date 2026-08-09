import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ErroApi } from '../api';

/**
 * Login.
 *
 * A instituicao e pedida explicitamente porque o tenant e resolvido antes de
 * qualquer consulta a dado de dominio (ADR 0002) - o que dispensa uma funcao de
 * bypass da RLS no backend.
 */
export function Entrar({ aoEntrar }: { aoEntrar: () => void }) {
  const [instituicao, setInstituicao] = useState('demo');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const navegar = useNavigate();

  async function submeter(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);

    try {
      await api.post('/auth/login', { instituicao, email, senha });
      aoEntrar();
      navegar('/casos');
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível entrar.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submeter} className="cartao w-full max-w-sm space-y-4 p-6">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--lapato-primaria)' }}>
            LAPATO
          </h1>
          <p className="rotulo">Gestão Anatomopatológica Veterinária</p>
        </div>

        <label className="block">
          <span className="rotulo">Instituição</span>
          <input
            value={instituicao}
            onChange={(e) => setInstituicao(e.target.value)}
            required
            autoComplete="organization"
            className="mt-1 w-full rounded border px-3 py-2"
            style={{ borderColor: 'var(--lapato-borda)', background: 'var(--lapato-superficie)' }}
          />
        </label>

        <label className="block">
          <span className="rotulo">E-mail</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="username"
            className="mt-1 w-full rounded border px-3 py-2"
            style={{ borderColor: 'var(--lapato-borda)', background: 'var(--lapato-superficie)' }}
          />
        </label>

        <label className="block">
          <span className="rotulo">Senha</span>
          <input
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            required
            autoComplete="current-password"
            className="mt-1 w-full rounded border px-3 py-2"
            style={{ borderColor: 'var(--lapato-borda)', background: 'var(--lapato-superficie)' }}
          />
        </label>

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
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}

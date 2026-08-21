import { useState, type FormEvent } from 'react';
import type { EstagioSessao } from '@lapato/shared';
import { api, ErroApi } from '../api';
import { CampoSenha } from '../componentes/CampoSenha';

/**
 * Login.
 *
 * A instituicao e pedida explicitamente porque o tenant e resolvido antes de
 * qualquer consulta a dado de dominio (ADR 0002) - o que dispensa uma funcao de
 * bypass da RLS no backend.
 *
 * Aceitar a senha nao significa entrar: a resposta diz em que estagio a sessao
 * ficou, e quem decide a proxima tela e o `App`. Antes, o front ignorava esse
 * campo e mandava todo mundo para `/casos` - com MFA ativo isso produzia um
 * laco: `/auth/eu` respondia 401 e a tela de login voltava, sem explicacao.
 */
export function Entrar({ aoEntrar }: { aoEntrar: (estagio: EstagioSessao) => void }) {
  const [instituicao, setInstituicao] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function submeter(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);

    try {
      const { estagio } = await api.post<{ estagio: EstagioSessao }>('/auth/login', {
        instituicao,
        email,
        senha,
      });
      setSenha('');
      aoEntrar(estagio);
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

        <CampoSenha
          rotulo="Senha"
          valor={senha}
          aoMudar={setSenha}
          autoComplete="current-password"
        />

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

import { useState, type FormEvent } from 'react';
import { MFA_TAMANHO_CODIGO, type EstagioSessao } from '@lapato/shared';
import { api, ErroApi } from '../api';
import { CartaoDeEntrada } from '../componentes/CartaoDeEntrada';

/**
 * Segundo fator (M02, Blueprint secao 6).
 *
 * A senha ja foi aceita e o cookie de sessao existe, mas a sessao esta em
 * `mfa_pendente` - nenhuma rota de negocio responde ate o codigo ser validado.
 */
export function SegundoFator({ aoAvancar }: { aoAvancar: (estagio: EstagioSessao) => void }) {
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function submeter(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);

    try {
      const { estagio } = await api.post<{ estagio: EstagioSessao }>('/auth/mfa', { codigo });
      aoAvancar(estagio);
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível validar o código.');
      setCodigo('');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <CartaoDeEntrada
      titulo="Verificação em duas etapas"
      descricao="Digite o código de 6 dígitos do seu aplicativo autenticador."
      erro={erro}
      aoSubmeter={submeter}
      acao={enviando ? 'Verificando…' : 'Verificar'}
      enviando={enviando || codigo.length !== MFA_TAMANHO_CODIGO}
    >
      <label className="block">
        <span className="rotulo">Código</span>
        <input
          value={codigo}
          // Só dígitos: colar de um autenticador costuma trazer espaço no meio.
          onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, MFA_TAMANHO_CODIGO))}
          required
          autoFocus
          inputMode="numeric"
          autoComplete="one-time-code"
          className="mt-1 w-full rounded border px-3 py-2 text-center text-lg tracking-[0.4em]"
          style={{ borderColor: 'var(--lapato-borda)', background: 'var(--lapato-superficie)' }}
        />
      </label>
    </CartaoDeEntrada>
  );
}

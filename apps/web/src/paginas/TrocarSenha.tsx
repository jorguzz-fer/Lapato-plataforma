import { useState, type FormEvent } from 'react';
import { SENHA_TAMANHO_MINIMO, type EstagioSessao } from '@lapato/shared';
import { api, ErroApi } from '../api';
import { CartaoDeEntrada } from '../componentes/CartaoDeEntrada';

/**
 * Troca da propria senha.
 *
 * Serve a dois momentos: a troca obrigatoria do primeiro acesso (senha definida
 * pelo provisionamento) e a troca voluntaria depois. `obrigatoria` muda apenas o
 * texto e a saida - no caminho obrigatorio nao ha "cancelar", porque nao existe
 * para onde voltar.
 */
export function TrocarSenha({
  obrigatoria,
  aoConcluir,
}: {
  obrigatoria: boolean;
  aoConcluir: (estagio: EstagioSessao) => void;
}) {
  const [senhaAtual, setSenhaAtual] = useState('');
  const [senhaNova, setSenhaNova] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const curta = senhaNova.length > 0 && senhaNova.length < SENHA_TAMANHO_MINIMO;
  const divergente = confirmacao.length > 0 && confirmacao !== senhaNova;
  const pronto =
    senhaAtual.length > 0 && senhaNova.length >= SENHA_TAMANHO_MINIMO && confirmacao === senhaNova;

  async function submeter(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);

    try {
      const { estagio } = await api.post<{ estagio: EstagioSessao }>('/auth/senha', {
        senhaAtual,
        senhaNova,
      });
      aoConcluir(estagio);
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível trocar a senha.');
    } finally {
      setEnviando(false);
    }
  }

  const campo = 'mt-1 w-full rounded border px-3 py-2';
  const estiloCampo = {
    borderColor: 'var(--lapato-borda)',
    background: 'var(--lapato-superficie)',
  };

  return (
    <CartaoDeEntrada
      titulo={obrigatoria ? 'Defina sua senha' : 'Trocar senha'}
      descricao={
        obrigatoria
          ? 'Sua senha atual foi definida por outra pessoa durante a instalação. Escolha uma senha que só você conheça para continuar.'
          : undefined
      }
      erro={erro}
      aoSubmeter={submeter}
      acao={enviando ? 'Salvando…' : 'Salvar senha'}
      enviando={enviando || !pronto}
      rodape={
        <p className="rotulo">
          As demais sessões desta conta serão encerradas.
        </p>
      }
    >
      <label className="block">
        <span className="rotulo">{obrigatoria ? 'Senha recebida' : 'Senha atual'}</span>
        <input
          type="password"
          value={senhaAtual}
          onChange={(e) => setSenhaAtual(e.target.value)}
          required
          autoFocus
          autoComplete="current-password"
          className={campo}
          style={estiloCampo}
        />
      </label>

      <label className="block">
        <span className="rotulo">Nova senha</span>
        <input
          type="password"
          value={senhaNova}
          onChange={(e) => setSenhaNova(e.target.value)}
          required
          autoComplete="new-password"
          minLength={SENHA_TAMANHO_MINIMO}
          aria-describedby="ajuda-senha"
          className={campo}
          style={estiloCampo}
        />
        <span
          id="ajuda-senha"
          className="mt-1 block text-xs"
          style={{ color: curta ? 'var(--lapato-perigo)' : undefined }}
        >
          Mínimo de {SENHA_TAMANHO_MINIMO} caracteres. Comprimento protege mais que símbolos.
        </span>
      </label>

      <label className="block">
        <span className="rotulo">Repita a nova senha</span>
        <input
          type="password"
          value={confirmacao}
          onChange={(e) => setConfirmacao(e.target.value)}
          required
          autoComplete="new-password"
          className={campo}
          style={estiloCampo}
        />
        {divergente && (
          <span className="mt-1 block text-xs" style={{ color: 'var(--lapato-perigo)' }}>
            As senhas não coincidem.
          </span>
        )}
      </label>
    </CartaoDeEntrada>
  );
}

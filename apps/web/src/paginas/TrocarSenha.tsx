import { useState, type FormEvent } from 'react';
import { SENHA_TAMANHO_MINIMO, type EstagioSessao } from '@lapato/shared';
import { api, ErroApi } from '../api';
import { CampoSenha } from '../componentes/CampoSenha';
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
      <CampoSenha
        rotulo={obrigatoria ? 'Senha recebida' : 'Senha atual'}
        valor={senhaAtual}
        aoMudar={setSenhaAtual}
        autoComplete="current-password"
        autoFocus
      />

      <CampoSenha
        rotulo="Nova senha"
        valor={senhaNova}
        aoMudar={setSenhaNova}
        autoComplete="new-password"
        minLength={SENHA_TAMANHO_MINIMO}
        ajuda={`Mínimo de ${SENHA_TAMANHO_MINIMO} caracteres. Comprimento protege mais que símbolos.`}
        erro={curta ? `Faltam ${SENHA_TAMANHO_MINIMO - senhaNova.length} caracteres.` : undefined}
      />

      <CampoSenha
        rotulo="Repita a nova senha"
        valor={confirmacao}
        aoMudar={setConfirmacao}
        autoComplete="new-password"
        erro={divergente ? 'As senhas não coincidem.' : undefined}
      />
    </CartaoDeEntrada>
  );
}

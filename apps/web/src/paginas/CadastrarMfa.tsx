import { useEffect, useState, type FormEvent } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { MFA_TAMANHO_CODIGO, type EstagioSessao } from '@lapato/shared';
import { api, ErroApi } from '../api';
import { CartaoDeEntrada } from '../componentes/CartaoDeEntrada';

/**
 * Cadastro do segundo fator (Blueprint secao 6: TOTP obrigatorio para quem
 * administra e para quem assina laudo).
 *
 * Duas etapas em uma tela: a API sorteia o segredo, o usuario le o QR Code e
 * devolve um codigo valido. Sem essa confirmacao a conta ficaria com MFA ativo e
 * nenhum aplicativo capaz de gerar o codigo - ou seja, perdida.
 */
export function CadastrarMfa({
  obrigatorio,
  aoConcluir,
}: {
  obrigatorio: boolean;
  aoConcluir: (estagio: EstagioSessao) => void;
}) {
  const [uri, setUri] = useState<string | null>(null);
  const [segredo, setSegredo] = useState<string | null>(null);
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    let ativo = true;

    api
      .post<{ segredo: string; uri: string }>('/auth/mfa/cadastro')
      .then((r) => {
        // StrictMode monta duas vezes em desenvolvimento; ignorar a resposta do
        // efeito descartado evita exibir um segredo que ja foi substituido.
        if (!ativo) return;
        setUri(r.uri);
        setSegredo(r.segredo);
      })
      .catch((err: unknown) => {
        if (ativo) {
          setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível iniciar o cadastro.');
        }
      });

    return () => {
      ativo = false;
    };
  }, []);

  async function submeter(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);

    try {
      const { estagio } = await api.post<{ estagio: EstagioSessao }>(
        '/auth/mfa/cadastro/confirmacao',
        { codigo },
      );
      aoConcluir(estagio);
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível confirmar o código.');
      setCodigo('');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <CartaoDeEntrada
      titulo="Cadastrar verificação em duas etapas"
      descricao={
        obrigatorio
          ? 'Seu perfil permite assinar laudos ou administrar permissões. Nesses casos o segundo fator é obrigatório.'
          : 'Leia o código abaixo com seu aplicativo autenticador.'
      }
      erro={erro}
      aoSubmeter={submeter}
      acao={enviando ? 'Confirmando…' : 'Confirmar e ativar'}
      enviando={enviando || codigo.length !== MFA_TAMANHO_CODIGO || !uri}
      largura="max-w-md"
      rodape={
        <p className="rotulo">
          Guarde o acesso ao aplicativo: ainda não existe recuperação de segundo fator.
        </p>
      }
    >
      {uri ? (
        <div className="flex flex-col items-center gap-3">
          {/* Fundo branco fixo: em tema escuro um QR invertido não é lido por
              boa parte dos leitores. */}
          <div className="rounded bg-white p-3">
            <QRCodeSVG value={uri} size={168} />
          </div>

          <details className="w-full text-xs">
            <summary className="cursor-pointer rotulo">
              Não consigo ler o código
            </summary>
            <p className="mt-2">Digite esta chave no aplicativo:</p>
            <code className="mt-1 block break-all rounded p-2" style={{ background: 'var(--lapato-fundo)' }}>
              {segredo}
            </code>
          </details>
        </div>
      ) : (
        <p className="rotulo">Gerando código…</p>
      )}

      <label className="block">
        <span className="rotulo">Código gerado pelo aplicativo</span>
        <input
          value={codigo}
          onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, MFA_TAMANHO_CODIGO))}
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          className="mt-1 w-full rounded border px-3 py-2 text-center text-lg tracking-[0.4em]"
          style={{ borderColor: 'var(--lapato-borda)', background: 'var(--lapato-superficie)' }}
        />
      </label>
    </CartaoDeEntrada>
  );
}

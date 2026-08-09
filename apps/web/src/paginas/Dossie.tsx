import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { EVENTO_LABEL, type TipoEvento } from '@lapato/shared';
import { api, type Dossie as DadosDossie } from '../api';

/**
 * Dossie unico do caso (DIRETRIZES secoes 13 e 14).
 *
 * "Ao clicar em Abrir Caso, o usuario devera acessar o mesmo dossie,
 * independentemente do modulo de origem." As abas mudam conforme tipo de exame,
 * perfil, permissoes e etapa - mas o dossie e um so.
 */

type Aba = 'visao' | 'amostras' | 'historico' | 'timeline';

const ABAS: Array<{ id: Aba; rotulo: string }> = [
  { id: 'visao', rotulo: 'Visão geral' },
  { id: 'amostras', rotulo: 'Amostras' },
  { id: 'historico', rotulo: 'Histórico' },
  { id: 'timeline', rotulo: 'Linha do tempo' },
];

export function Dossie() {
  const { id } = useParams<{ id: string }>();
  const [dados, setDados] = useState<DadosDossie | null>(null);
  const [aba, setAba] = useState<Aba>('visao');

  useEffect(() => {
    if (id) api.get<DadosDossie>(`/casos/${id}`).then(setDados);
  }, [id]);

  if (!dados) return <p className="rotulo">Carregando dossiê…</p>;

  return (
    <section>
      {/* DIRETRIZES seção 15: cabeçalho persistente do caso. */}
      <header className="cartao mb-4 p-4">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <span className="font-mono text-base font-semibold">
            {dados.caso.identificador}
          </span>
          <span>{dados.paciente.nome}</span>
          <span className="rotulo">{dados.cliente.nomeFantasia}</span>
          <span className="rotulo">{dados.servico.nome}</span>
          {dados.estado && (
            <span
              className="rounded px-2 py-0.5 text-xs"
              style={{ background: 'var(--lapato-primaria-clara)', color: 'var(--lapato-primaria)' }}
            >
              {dados.estado.etapa.replaceAll('_', ' ')}
            </span>
          )}
        </div>
      </header>

      <nav className="mb-3 flex gap-1 border-b" style={{ borderColor: 'var(--lapato-borda)' }}>
        {ABAS.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setAba(a.id)}
            aria-current={aba === a.id ? 'page' : undefined}
            className="px-3 py-2 text-sm"
            style={{
              borderBottom: aba === a.id ? '2px solid var(--lapato-primaria)' : '2px solid transparent',
              color: aba === a.id ? 'var(--lapato-primaria)' : 'var(--lapato-texto-suave)',
            }}
          >
            {a.rotulo}
          </button>
        ))}
      </nav>

      {aba === 'visao' && (
        <div className="cartao space-y-3 p-4 text-sm">
          <Campo rotulo="Prioridade" valor={dados.caso.prioridade} />
          <Campo
            rotulo="Recebido em"
            valor={
              dados.caso.recebidoEm
                ? new Date(dados.caso.recebidoEm).toLocaleString('pt-BR')
                : 'Ainda não recebido'
            }
          />
          <Campo
            rotulo="Resultado da triagem"
            valor={dados.caso.resultadoTriagem?.replaceAll('_', ' ') ?? 'Ainda não triado'}
          />
          <Campo rotulo="Microchip" valor={dados.paciente.microchip ?? '—'} />

          <div>
            <span className="rotulo">Recipientes</span>
            <ul className="mt-1 space-y-1">
              {dados.recipientes.map((r) => {
                /**
                 * M05: declarado e recebido ficam lado a lado. A divergência é
                 * dado do caso, e por isso aparece em vez de ser "corrigida".
                 */
                const divergente =
                  r.quantidadeRecebida !== null &&
                  r.quantidadeDeclarada !== null &&
                  r.quantidadeRecebida !== r.quantidadeDeclarada;

                return (
                  <li key={r.id} className="flex items-center gap-2 text-xs">
                    <span className="font-mono">{r.identificador}</span>
                    <span>
                      declarado {r.quantidadeDeclarada ?? '—'} · recebido{' '}
                      {r.quantidadeRecebida ?? '—'}
                    </span>
                    {divergente && (
                      <span
                        className="rounded px-1.5 py-0.5 text-[0.7rem] text-white"
                        style={{ background: 'var(--lapato-atencao)' }}
                      >
                        divergência
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {aba === 'amostras' && (
        <div className="cartao p-4">
          <ul className="space-y-2 text-sm">
            {dados.amostras.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-xs">{a.identificador}</span>
                <span>{a.descricao ?? '—'}</span>
                {a.lateralidade !== 'nao_aplicavel' && (
                  <span className="rotulo">lateralidade: {a.lateralidade}</span>
                )}
                {a.resultadoTriagem && (
                  <span className="rotulo">triagem: {a.resultadoTriagem.replaceAll('_', ' ')}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {aba === 'historico' && (
        <div className="cartao space-y-3 p-4 text-sm">
          {dados.historicos.length === 0 && <p className="rotulo">Sem histórico clínico.</p>}
          {dados.historicos.map((h) => (
            <article key={h.id}>
              {/* M05/M11: o texto original do solicitante nunca é substituído. */}
              <span className="rotulo">Origem: {h.origem}</span>
              <p className="mt-1 whitespace-pre-wrap">{h.texto}</p>
            </article>
          ))}
        </div>
      )}

      {aba === 'timeline' && (
        <ol className="cartao space-y-3 p-4">
          {dados.linhaDoTempo.map((e) => (
            <li key={e.id} className="flex gap-3 text-sm">
              <time className="shrink-0 font-mono text-xs" style={{ color: 'var(--lapato-texto-suave)' }}>
                {new Date(e.ocorridoEm).toLocaleString('pt-BR')}
              </time>
              <div>
                <span>{EVENTO_LABEL[e.tipo as TipoEvento] ?? e.tipo}</span>
                <span className="rotulo ml-2">{e.moduloOrigem}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Campo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <span className="rotulo">{rotulo}</span>
      <p>{valor}</p>
    </div>
  );
}

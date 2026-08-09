import { useEffect, useState } from 'react';
import type { NivelIa } from '@lapato/shared';
import { api, type StatusIa } from '../api';

/**
 * Painel lateral do LAPATO Copiloto (M17 secao 8).
 *
 * Requisitos que a documentacao trata como estruturais, e nao como enfeite:
 *
 * - ocupa ~30% da tela, com ~70% para a area de trabalho;
 * - pode ser expandido, reduzido, recolhido, fixado ou ocultado;
 * - o conteudo muda por modulo e etapa - **nao existe uma interface generica de
 *   chatbot** (secao 9);
 * - quando a IA esta indisponivel, mostra o indicador e o trabalho continua
 *   normalmente (secoes 110-112).
 */

const CORES_NIVEL: Record<NivelIa, string> = {
  informacao: 'border-l-ia-informacao',
  sugestao: 'border-l-ia-sugestao',
  atencao: 'border-l-ia-atencao',
  critico: 'border-l-ia-critico',
};

/**
 * M07 exige indicadores que **nao dependam exclusivamente de cores**. Cada
 * nivel carrega tambem um simbolo e um rotulo textual.
 */
const SIMBOLO_NIVEL: Record<NivelIa, string> = {
  informacao: 'i',
  sugestao: '✦',
  atencao: '!',
  critico: '⨯',
};

const ROTULO_NIVEL: Record<NivelIa, string> = {
  informacao: 'Informação',
  sugestao: 'Sugestão',
  atencao: 'Atenção',
  critico: 'Crítico',
};

export interface CartaoPainel {
  id: string;
  nivel: NivelIa;
  titulo: string;
  corpo: string;
  fontes?: string[];
  inferencia?: boolean;
}

interface Props {
  modulo: string;
  etapa?: string;
  /** Achados do Guardian, que existem mesmo sem Copiloto disponível. */
  cartoes?: CartaoPainel[];
  recolhido: boolean;
  onAlternar: () => void;
}

export function PainelCopiloto({ modulo, etapa, cartoes = [], recolhido, onAlternar }: Props) {
  const [status, setStatus] = useState<StatusIa | null>(null);

  useEffect(() => {
    api
      .get<StatusIa>('/ia/status')
      .then(setStatus)
      .catch(() => setStatus({ disponivel: false, provedor: 'indisponivel' }));
  }, []);

  if (recolhido) {
    return (
      <button
        type="button"
        onClick={onAlternar}
        aria-label="Abrir painel do Copiloto"
        className="fixed right-0 top-1/2 -translate-y-1/2 rounded-l-md border border-r-0 px-2 py-6 text-xs"
        style={{
          background: 'var(--lapato-superficie)',
          borderColor: 'var(--lapato-borda)',
        }}
      >
        <span className="[writing-mode:vertical-rl]">Copiloto</span>
      </button>
    );
  }

  return (
    <aside
      /* 30% da tela, conforme M17 seção 8. */
      className="flex h-full w-[30%] min-w-[300px] flex-col border-l"
      style={{ background: 'var(--lapato-superficie)', borderColor: 'var(--lapato-borda)' }}
      aria-label="LAPATO Copiloto"
    >
      <header
        className="flex items-center justify-between border-b px-4 py-3"
        style={{ borderColor: 'var(--lapato-borda)' }}
      >
        <div>
          <h2 className="text-sm font-semibold">LAPATO Copiloto</h2>
          <p className="rotulo">{etapa ? `${modulo} · ${etapa}` : modulo}</p>
        </div>
        <button
          type="button"
          onClick={onAlternar}
          aria-label="Recolher painel do Copiloto"
          className="rounded px-2 py-1 text-lg leading-none hover:bg-cinza-200"
        >
          ›
        </button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {status && !status.disponivel && (
          /**
           * M17 seções 110-112: o indicador é obrigatório, e o trabalho segue.
           * A ausência do Copiloto não impede cadastrar, descrever, diagnosticar,
           * assinar ou liberar.
           */
          <div
            className="rounded border border-dashed p-3 text-xs"
            style={{ borderColor: 'var(--lapato-borda)', color: 'var(--lapato-texto-suave)' }}
            role="status"
          >
            <strong className="block">Assistência de IA temporariamente indisponível.</strong>
            O trabalho continua normalmente; o LAPATO Guardian permanece ativo.
          </div>
        )}

        {cartoes.length === 0 && (
          <p className="text-xs" style={{ color: 'var(--lapato-texto-suave)' }}>
            Nenhum apontamento para esta etapa.
          </p>
        )}

        {cartoes.map((c) => (
          <article
            key={c.id}
            className={`rounded border border-l-4 p-3 ${CORES_NIVEL[c.nivel]}`}
            style={{ borderColor: 'var(--lapato-borda)' }}
          >
            <div className="mb-1 flex items-center gap-2">
              <span aria-hidden className="text-xs font-bold">
                {SIMBOLO_NIVEL[c.nivel]}
              </span>
              <span className="rotulo">{ROTULO_NIVEL[c.nivel]}</span>
            </div>

            <h3 className="text-sm font-medium">{c.titulo}</h3>
            <p className="mt-1 text-xs" style={{ color: 'var(--lapato-texto-suave)' }}>
              {c.corpo}
            </p>

            {/**
             * M17 seção 15: a sugestão precisa dizer que veio da IA, com quais
             * dados, de quais fontes, e se houve inferência - para não ser
             * confundida com dado observado.
             */}
            {(c.fontes?.length || c.inferencia) && (
              <footer className="mt-2 text-[0.7rem]" style={{ color: 'var(--lapato-texto-suave)' }}>
                {c.fontes?.length ? <span>Fontes: {c.fontes.join(', ')}. </span> : null}
                {c.inferencia ? <span>Contém inferência.</span> : <span>Baseado em dados do caso.</span>}
              </footer>
            )}
          </article>
        ))}
      </div>
    </aside>
  );
}

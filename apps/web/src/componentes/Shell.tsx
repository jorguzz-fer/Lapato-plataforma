import { useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { MODULO_LABEL, MODULOS } from '@lapato/shared';
import { api, type Sessao } from '../api';
import { PainelCopiloto, type CartaoPainel } from './PainelCopiloto';

/**
 * Shell de navegacao.
 *
 * DIRETRIZES secao 15: navegacao POR CONTEXTO. O usuario nao deve abandonar o
 * caso para executar acoes relacionadas - por isso o painel do Copiloto e o
 * cabecalho do caso ficam no shell, e nao dentro de cada tela.
 *
 * Layout: ~70% area de trabalho / ~30% painel lateral (M17 secao 8).
 */

const MENU = [
  { para: '/casos', modulo: MODULOS.M07_RASTREAMENTO, permissao: 'fluxo:visualizar' },
  { para: '/casos/novo', modulo: MODULOS.M05_RECEBIMENTO, permissao: 'caso:criar' },
] as const;

interface Props {
  sessao: Sessao;
  /** Devolve o controle ao `App`, que zera o estagio e volta ao login. */
  aoSair: () => void;
  modulo: string;
  etapa?: string;
  cartoes?: CartaoPainel[];
  children: ReactNode;
}

export function Shell({ sessao, aoSair, modulo, etapa, cartoes, children }: Props) {
  const [painelRecolhido, setPainelRecolhido] = useState(false);
  const [tema, setTema] = useState<'claro' | 'escuro'>('claro');
  const navegar = useNavigate();

  function alternarTema() {
    const novo = tema === 'claro' ? 'escuro' : 'claro';
    setTema(novo);
    document.documentElement.setAttribute('data-tema', novo);
  }

  async function sair() {
    await api.post('/auth/logout');
    navegar('/entrar');
    // Só depois de navegar: zerar o estágio antes desmontaria esta tela no meio.
    aoSair();
  }

  return (
    <div className="flex h-screen flex-col">
      <header
        className="flex shrink-0 items-center justify-between border-b px-4"
        style={{
          height: 'var(--lapato-topbar-altura)',
          background: 'var(--lapato-topbar-fundo)',
          borderColor: 'var(--lapato-borda)',
        }}
      >
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold" style={{ color: 'var(--lapato-primaria)' }}>
            LAPATO
          </span>
          <span className="rotulo hidden sm:inline">
            Gestão Anatomopatológica Veterinária
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={alternarTema}
            className="rounded px-3 py-1.5 text-xs"
            aria-label={`Mudar para tema ${tema === 'claro' ? 'escuro' : 'claro'}`}
          >
            {tema === 'claro' ? '🌙' : '☀️'}
          </button>
          <button type="button" onClick={sair} className="rounded px-3 py-1.5 text-xs underline">
            Sair
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav
          className="hidden shrink-0 border-r p-3 md:block"
          style={{
            width: 'var(--lapato-sidebar-largura)',
            background: 'var(--lapato-sidebar-fundo)',
            borderColor: 'var(--lapato-sidebar-borda)',
          }}
          aria-label="Navegação principal"
        >
          <ul className="space-y-1">
            {MENU.filter((item) => sessao.permissoes.includes(item.permissao)).map((item) => (
              <li key={item.para}>
                <NavLink
                  to={item.para}
                  end
                  className={({ isActive }) =>
                    `block rounded px-3 py-2 text-sm ${isActive ? 'font-semibold' : ''}`
                  }
                  style={({ isActive }) => ({
                    background: isActive ? 'var(--lapato-primaria-clara)' : 'transparent',
                    color: isActive
                      ? 'var(--lapato-primaria)'
                      : 'var(--lapato-sidebar-item)',
                  })}
                >
                  {item.para === '/casos/novo'
                    ? 'Novo caso'
                    : MODULO_LABEL[item.modulo]}
                </NavLink>
              </li>
            ))}
          </ul>

          <div className="mt-4 space-y-1 border-t pt-3" style={{ borderColor: 'var(--lapato-sidebar-borda)' }}>
            <NavLink to="/conta/senha" className="block rounded px-3 py-2 text-sm">
              Trocar senha
            </NavLink>
            {!sessao.mfaAtivo && (
              /* Blueprint secao 6: oferecer o segundo fator a quem ainda nao tem,
                 mesmo quando o perfil nao o torna obrigatorio. */
              <NavLink to="/conta/mfa" className="block rounded px-3 py-2 text-sm">
                Ativar verificação em 2 etapas
              </NavLink>
            )}
          </div>

          {sessao.exigeSupervisao && (
            /* M02/M11: o perfil em supervisão precisa saber disso o tempo todo. */
            <p
              className="mt-4 rounded p-2 text-xs"
              style={{ background: 'var(--lapato-primaria-clara)' }}
            >
              Perfil sob supervisão: elaboração permitida, assinatura e liberação exigem
              responsável.
            </p>
          )}
        </nav>

        <main className="min-w-0 flex-1 overflow-y-auto p-4">{children}</main>

        <PainelCopiloto
          modulo={modulo}
          etapa={etapa}
          cartoes={cartoes}
          recolhido={painelRecolhido}
          onAlternar={() => setPainelRecolhido((v) => !v)}
        />
      </div>
    </div>
  );
}

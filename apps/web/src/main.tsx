import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { api, type Sessao } from './api';
import { Shell } from './componentes/Shell';
import { Entrar } from './paginas/Entrar';
import { CentralDeCasos } from './paginas/CentralDeCasos';
import { Dossie } from './paginas/Dossie';
import './estilos.css';

/**
 * Shell da aplicacao.
 *
 * A sessao e resolvida perguntando `GET /auth/eu`: o cookie e httpOnly, entao o
 * front nao consegue - nem deve - inspecionar o token. As permissoes vem
 * resolvidas do servidor e servem apenas para ESCONDER o que o usuario nao pode
 * fazer; a autorizacao de verdade acontece na API a cada request
 * (Blueprint secao 6).
 */
function App() {
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [carregando, setCarregando] = useState(true);

  function carregarSessao() {
    return api
      .get<Sessao>('/auth/eu')
      .then(setSessao)
      .catch(() => setSessao(null))
      .finally(() => setCarregando(false));
  }

  useEffect(() => {
    void carregarSessao();
  }, []);

  if (carregando) {
    return <p className="p-6 rotulo">Carregando…</p>;
  }

  if (!sessao) {
    return (
      <Routes>
        <Route path="/entrar" element={<Entrar aoEntrar={carregarSessao} />} />
        <Route path="*" element={<Navigate to="/entrar" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/entrar" element={<Navigate to="/casos" replace />} />
      <Route
        path="/casos"
        element={
          <Shell sessao={sessao} modulo="Rastreamento e Gestão de Fluxo">
            <CentralDeCasos />
          </Shell>
        }
      />
      <Route
        path="/casos/:id"
        element={
          <Shell sessao={sessao} modulo="Dossiê do caso" etapa="visão geral">
            <Dossie />
          </Shell>
        }
      />
      <Route path="*" element={<Navigate to="/casos" replace />} />
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

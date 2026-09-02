import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import CircularProgress from '@mui/material/CircularProgress';
import Box from '@mui/material/Box';
import type { EstagioSessao } from '@lapato/shared';
import { ProvedorLapato } from '@lapato/ui';
import { api, observarEstagio, type Sessao } from './api';
import { BarreiraDeErro } from './componentes/BarreiraDeErro';
import { Shell } from './componentes/Shell';
import { Entrar } from './paginas/Entrar';
import { SegundoFator } from './paginas/SegundoFator';
import { TrocarSenha } from './paginas/TrocarSenha';
import { CadastrarMfa } from './paginas/CadastrarMfa';
import { Painel } from './paginas/Painel';
import { CentralDeCasos } from './paginas/CentralDeCasos';
import { ArquivoDeLaudos } from './paginas/ArquivoDeLaudos';
import { NovoCaso } from './paginas/NovoCaso';
import { Recebimento } from './paginas/Recebimento';
import { Triagem } from './paginas/Triagem';
import { Macroscopia } from './paginas/Macroscopia';
import { Laudo } from './paginas/Laudo';
import { Processamento } from './paginas/Processamento';
import { FilaMacroscopia } from './paginas/FilaMacroscopia';
import { Solicitacoes } from './paginas/Solicitacoes';
import { OrdensDeServico } from './paginas/ordens/OrdensDeServico';
import { Financeiro } from './paginas/ordens/Financeiro';
import { Cadaveres } from './paginas/Cadaveres';
import { Bioteca } from './paginas/Bioteca';
import { Necropsia } from './paginas/Necropsia';
import { Clientes } from './paginas/Clientes';
import { Veterinarios } from './paginas/Veterinarios';
import { Administracao } from './paginas/Administracao';
import { Usuarios } from './paginas/Usuarios';
import { Dossie } from './paginas/Dossie';
import { ValidarLaudo } from './paginas/ValidarLaudo';
import { ShellPortal } from './portal/ShellPortal';
import { PortalPainel } from './portal/PortalPainel';
import { PortalExames } from './portal/PortalExames';
import { PortalExame } from './portal/PortalExame';
import { PortalSolicitacoes } from './portal/PortalSolicitacoes';
import './estilos.css';

/**
 * Shell da aplicacao.
 *
 * A sessao e resolvida perguntando ao servidor: o cookie e httpOnly, entao o
 * front nao consegue - nem deve - inspecionar o token. As permissoes vem
 * resolvidas do servidor e servem apenas para ESCONDER o que o usuario nao pode
 * fazer; a autorizacao de verdade acontece na API a cada request
 * (Blueprint secao 6).
 *
 * Entrar nao e um passo so. `GET /auth/estado` diz em que ponto do funil a
 * sessao parou, e cada estagio tem uma tela. Perguntar isso no boot - e nao so
 * depois do login - faz o F5 no meio do segundo fator cair na tela certa em vez
 * de voltar ao comeco.
 */
function App() {
  const [estagio, setEstagio] = useState<EstagioSessao | 'carregando'>('carregando');
  const [sessao, setSessao] = useState<Sessao | null>(null);

  /**
   * Leva a sessao ao estagio informado. Em `ativa`, e so aqui, busca-se o
   * perfil completo - nos demais estagios `/auth/eu` responderia 401 ou 403.
   */
  const irPara = useCallback(async (novo: EstagioSessao) => {
    if (novo !== 'ativa') {
      setSessao(null);
      setEstagio(novo);
      return;
    }

    try {
      setSessao(await api.get<Sessao>('/auth/eu'));
      setEstagio('ativa');
    } catch {
      // Estagio e sessao discordaram (revogacao entre as duas chamadas):
      // trata-se como nao autenticado, que e o lado seguro.
      setSessao(null);
      setEstagio('anonimo');
    }
  }, []);

  useEffect(() => {
    // Qualquer 403 que traga estágio redireciona a aplicação inteira: a
    // exigência pode surgir depois do login, com a sessão já aberta.
    observarEstagio((novo) => void irPara(novo));

    api
      .get<{ estagio: EstagioSessao }>('/auth/estado')
      .then((r) => irPara(r.estagio))
      .catch(() => irPara('anonimo'));
  }, [irPara]);

  if (estagio === 'carregando') {
    return <Carregando />;
  }

  if (estagio === 'anonimo') {
    return (
      <Routes>
        <Route path="/entrar" element={<Entrar aoEntrar={irPara} />} />
        <Route path="*" element={<Navigate to="/entrar" replace />} />
      </Routes>
    );
  }

  /**
   * Estagios intermediarios ocupam a tela inteira e ignoram a rota corrente.
   * Nao ha para onde navegar enquanto a pendencia existir, e a API recusaria
   * qualquer outra chamada de qualquer forma.
   */
  if (estagio === 'mfa_pendente') {
    return <SegundoFator aoAvancar={irPara} />;
  }

  if (estagio === 'troca_senha_obrigatoria') {
    return <TrocarSenha obrigatoria aoConcluir={irPara} />;
  }

  if (estagio === 'mfa_cadastro_obrigatorio') {
    return <CadastrarMfa obrigatorio aoConcluir={irPara} />;
  }

  if (!sessao) {
    return <Carregando />;
  }

  const sair = () => irPara('anonimo');

  /**
   * M04: conta externa nao entra no sistema interno.
   *
   * Nao e questao de esconder menu: o Portal e outra aplicacao dentro da mesma
   * casa (secao 55), e as rotas internas responderiam 403 de qualquer forma.
   * Quem tem cliente vinculado tem o Portal inteiro e nada alem dele.
   */
  if (sessao.clienteId) {
    const podeComplementar = sessao.permissoes.includes('portal:historico_complementar');

    return (
      <Routes>
        <Route
          path="/portal"
          element={
            <ShellPortal aoSair={sair}>
              <PortalPainel />
            </ShellPortal>
          }
        />
        <Route
          path="/portal/exames"
          element={
            <ShellPortal aoSair={sair}>
              <PortalExames />
            </ShellPortal>
          }
        />
        <Route
          path="/portal/exames/:id"
          element={
            <ShellPortal aoSair={sair}>
              <PortalExame podeComplementar={podeComplementar} />
            </ShellPortal>
          }
        />
        <Route
          path="/portal/solicitacoes"
          element={
            <ShellPortal aoSair={sair}>
              <PortalSolicitacoes />
            </ShellPortal>
          }
        />
        <Route path="*" element={<Navigate to="/portal" replace />} />
      </Routes>
    );
  }

  /**
   * M09/M02: o parceiro do laboratorio de apoio nao tem `fluxo:visualizar`, e
   * mandar todo mundo para `/casos` faria a tela inicial dele ser um 403. A casa
   * de cada usuario e a primeira coisa que ele pode de fato ver.
   */
  const inicio = sessao.laboratorioApoioId ? '/processamento' : '/painel';

  return (
    <Routes>
      <Route path="/entrar" element={<Navigate to={inicio} replace />} />
      {/* M07: a tela de chegada. O painel le o fluxo, entao mora no M07 - nao e
          um modulo novo, e por isso divide a permissao com a Central. */}
      <Route
        path="/painel"
        element={
          <Shell sessao={sessao} aoSair={sair} modulo="Rastreamento e Gestão de Fluxo">
            <Painel nomeCompleto={sessao.nomeCompleto} permissoes={sessao.permissoes} />
          </Shell>
        }
      />
      <Route
        path="/casos"
        element={
          <Shell sessao={sessao} aoSair={sair} modulo="Rastreamento e Gestão de Fluxo">
            <CentralDeCasos />
          </Shell>
        }
      />
      <Route
        path="/casos/novo"
        element={
          <Shell sessao={sessao} aoSair={sair} modulo="Recebimento e Cadastro" etapa="cadastro">
            <NovoCaso />
          </Shell>
        }
      />
      <Route
        path="/casos/:id/recebimento"
        element={
          <Shell sessao={sessao} aoSair={sair} modulo="Recebimento e Cadastro" etapa="recebimento">
            <Recebimento permissoes={sessao.permissoes} />
          </Shell>
        }
      />
      <Route
        path="/casos/:id/triagem"
        element={
          <Shell sessao={sessao} aoSair={sair} modulo="Triagem de Amostras" etapa="triagem">
            <Triagem />
          </Shell>
        }
      />
      {/* Fora de /casos: o lote é do dia e atravessa vários casos (M09). */}
      <Route
        path="/macroscopia"
        element={
          <Shell sessao={sessao} aoSair={sair} modulo="Macroscopia">
            <FilaMacroscopia />
          </Shell>
        }
      />
      <Route
        path="/processamento"
        element={
          <Shell sessao={sessao} aoSair={sair} modulo="Processamento e Colorações">
            <Processamento
              parceiro={sessao.laboratorioApoioId !== null}
              podeEnviarLote={sessao.permissoes.includes('processamento:enviar_lote')}
            />
          </Shell>
        }
      />
      <Route
        path="/clientes"
        element={
          <Shell sessao={sessao} aoSair={sair} modulo="Cadastro de Clientes">
            <Clientes permissoes={sessao.permissoes} />
          </Shell>
        }
      />
      {/* M03 secao 12: o veterinario e pessoa unica com N vinculos, nao um
          atributo do cliente - por isso tem cadastro proprio. */}
      <Route
        path="/veterinarios"
        element={
          <Shell sessao={sessao} aoSair={sair} modulo="Cadastro de Veterinários">
            <Veterinarios permissoes={sessao.permissoes} />
          </Shell>
        }
      />
      <Route
        path="/administracao"
        element={
          <Shell sessao={sessao} aoSair={sair} modulo="Administração e Configurações">
            <Administracao permissoes={sessao.permissoes} />
          </Shell>
        }
      />
      <Route
        path="/usuarios"
        element={
          <Shell sessao={sessao} aoSair={sair} modulo="Usuários, Perfis e Permissões">
            <Usuarios permissoes={sessao.permissoes} />
          </Shell>
        }
      />
      {/* Fora de /casos: a demanda atravessa casos e setores (M10). */}
      <Route
        path="/cadaveres"
        element={
          <Shell sessao={sessao} aoSair={sair} modulo="Controle de Cadáveres">
            <Cadaveres permissoes={sessao.permissoes} />
          </Shell>
        }
      />
      {/* M18: o acervo atravessa casos e anos - a pergunta e "onde esta", nao "de quem e". */}
      <Route
        path="/bioteca"
        element={
          <Shell sessao={sessao} aoSair={sair} modulo="Bioteca e Acervo Biológico">
            <Bioteca permissoes={sessao.permissoes} />
          </Shell>
        }
      />
      <Route
        path="/solicitacoes"
        element={
          <Shell sessao={sessao} aoSair={sair} modulo="Solicitações e Pendências">
            <Solicitacoes permissoes={sessao.permissoes} />
          </Shell>
        }
      />
      <Route
        path="/ordens"
        element={
          <Shell sessao={sessao} aoSair={sair} modulo="Ordens de Serviço">
            <OrdensDeServico />
          </Shell>
        }
      />
      <Route
        path="/laudos"
        element={
          <Shell sessao={sessao} aoSair={sair} modulo="Laudos">
            <ArquivoDeLaudos />
          </Shell>
        }
      />
      <Route
        path="/financeiro"
        element={
          <Shell sessao={sessao} aoSair={sair} modulo="Financeiro">
            <Financeiro permissoes={sessao.permissoes} />
          </Shell>
        }
      />
      <Route
        path="/casos/:id/macroscopia"
        element={
          <Shell sessao={sessao} aoSair={sair} modulo="Macroscopia" etapa="macroscopia">
            <Macroscopia exigeSupervisao={sessao.exigeSupervisao} />
          </Shell>
        }
      />
      <Route
        path="/casos/:id/necropsia"
        element={
          <Shell sessao={sessao} aoSair={sair} modulo="Necropsia">
            <Necropsia permissoes={sessao.permissoes} />
          </Shell>
        }
      />
      <Route
        path="/casos/:id/laudo"
        element={
          <Shell sessao={sessao} aoSair={sair} modulo="Laudos e Microscopia" etapa="laudo">
            <Laudo permissoes={sessao.permissoes} exigeSupervisao={sessao.exigeSupervisao} />
          </Shell>
        }
      />
      <Route
        path="/casos/:id"
        element={
          <Shell sessao={sessao} aoSair={sair} modulo="Dossiê do caso" etapa="visão geral">
            <Dossie permissoes={sessao.permissoes} />
          </Shell>
        }
      />
      <Route
        path="/conta/senha"
        element={
          <Shell sessao={sessao} aoSair={sair} modulo="Identidade e Permissões">
            <VoltarAoSistema>
              {(concluir) => <TrocarSenha obrigatoria={false} aoConcluir={concluir} />}
            </VoltarAoSistema>
          </Shell>
        }
      />
      <Route
        path="/conta/mfa"
        element={
          <Shell sessao={sessao} aoSair={sair} modulo="Identidade e Permissões">
            <VoltarAoSistema>
              {(concluir) => <CadastrarMfa obrigatorio={false} aoConcluir={concluir} />}
            </VoltarAoSistema>
          </Shell>
        }
      />
      <Route path="*" element={<Navigate to={inicio} replace />} />
    </Routes>
  );
}

/**
 * Adapta as telas do funil de entrada ao uso voluntario: elas avisam o estagio
 * resultante, e aqui isso vira "volte para a central de casos".
 */
function VoltarAoSistema({
  children,
}: {
  children: (concluir: (estagio: EstagioSessao) => void) => React.ReactNode;
}) {
  const navegar = useNavigate();
  return <>{children(() => navegar('/casos'))}</>;
}

function Carregando() {
  return (
    <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
      <CircularProgress size={28} />
    </Box>
  );
}

/**
 * `/validar/:tenantSlug/:codigo` fica FORA do `App`: quem escaneia o QR do
 * PDF não tem sessão nenhuma (M11 seção 88), então essa rota não pode esperar
 * `/auth/estado` resolver, nem cair no redirecionamento para `/entrar`.
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ProvedorLapato>
      {/* Dentro do provedor de tema: a tela de erro tambem precisa de tema, e
          fora dele ela apareceria sem estilo nenhum. */}
      <BarreiraDeErro>
        <BrowserRouter>
          <Routes>
            <Route path="/validar/:tenantSlug/:codigo" element={<ValidarLaudo />} />
            <Route path="*" element={<App />} />
          </Routes>
        </BrowserRouter>
      </BarreiraDeErro>
    </ProvedorLapato>
  </StrictMode>,
);

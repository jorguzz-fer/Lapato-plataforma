import { useEffect, useState, type ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Badge from '@mui/material/Badge';
import ButtonBase from '@mui/material/ButtonBase';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import Close from '@mui/icons-material/CloseOutlined';
import PushPin from '@mui/icons-material/PushPinOutlined';
import PushPinFilled from '@mui/icons-material/PushPin';
import AutoAwesome from '@mui/icons-material/AutoAwesomeOutlined';
import CircularProgress from '@mui/material/CircularProgress';
import Button from '@mui/material/Button';
import { nivelIa, raio, shell, sombra } from '@lapato/design-tokens';
import { MODULO_LABEL, MODULOS, type NivelIa } from '@lapato/shared';
import { api, type CartaoIa, type RespostaCopiloto, type StatusIa } from '../api';

/**
 * Painel do LAPATO Copiloto (M17 secao 8).
 *
 * Requisitos que a documentacao trata como estruturais, e nao como enfeite:
 *
 * - pode ser expandido, reduzido, recolhido, **fixado** ou ocultado;
 * - quando fixado, ocupa ~30% da tela com ~70% para a area de trabalho;
 * - o conteudo muda por modulo e etapa - **nao existe uma interface generica de
 *   chatbot** (secao 9);
 * - quando a IA esta indisponivel, mostra o indicador e o trabalho continua
 *   normalmente (secoes 110-112).
 *
 * O padrao e **flutuante**, e nao a coluna fixa. A propria lista do modulo traz
 * "fixado" como um dos estados, o que implica um estado nao-fixado - e e ele que
 * faz sentido como padrao: o Copiloto assiste o trabalho, entao nao deveria
 * cobrar 30% da largura de quem esta lendo uma tabela de casos ou preenchendo
 * uma macroscopia. Quem quiser a coluna permanente fixa o painel, e a
 * preferencia fica guardada no aparelho.
 */

/**
 * M07 exige indicadores que **nao dependam exclusivamente de cor**. Cada nivel
 * carrega cor, simbolo e rotulo textual - os tres juntos.
 */
const NIVEL: Record<NivelIa, { cor: string; simbolo: string; rotulo: string }> = {
  informacao: { cor: nivelIa.informacao, simbolo: 'i', rotulo: 'Informação' },
  sugestao: { cor: nivelIa.sugestao, simbolo: '✦', rotulo: 'Sugestão' },
  atencao: { cor: nivelIa.atencao, simbolo: '!', rotulo: 'Atenção' },
  critico: { cor: nivelIa.critico, simbolo: '⨯', rotulo: 'Crítico' },
};

const CHAVE_FIXADO = 'lapato:copiloto-fixado';

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
  /**
   * Em tela estreita nao ha o que dividir: o painel vira gaveta, e "fixar" nem
   * se oferece - uma coluna de 30% em 375px deixaria 75px de area de trabalho.
   */
  estreito: boolean;
  aberto: boolean;
  onAlternar: () => void;
}

export function PainelCopiloto({
  modulo,
  etapa,
  cartoes = [],
  estreito,
  aberto,
  onAlternar,
}: Props) {
  const [status, setStatus] = useState<StatusIa | null>(null);
  const [cartoesIa, setCartoesIa] = useState<CartaoIa[]>([]);
  const [buscandoIa, setBuscandoIa] = useState(false);
  const [reagidos, setReagidos] = useState<Record<string, 'aceita' | 'rejeitada'>>({});
  const [fixado, setFixado] = useState(() => {
    try {
      return localStorage.getItem(CHAVE_FIXADO) === 'sim';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    api
      .get<StatusIa>('/ia/status')
      .then(setStatus)
      .catch(() => setStatus({ disponivel: false, provedor: 'indisponivel' }));
  }, []);

  /**
   * As sugestoes so sao buscadas com o painel ABERTO, de proposito: cada
   * consulta ao provedor custa dinheiro e registra uma sugestao apresentada
   * (M17 secao 15) - e sugestao que ninguem viu nao foi apresentada. Abrir o
   * painel e o gesto de pedir ajuda.
   *
   * O casoId sai da URL em vez de descer por prop atraves de cada tela: a rota
   * `/casos/:id/...` e a unica fonte dele, e o painel e o unico consumidor.
   */
  useEffect(() => {
    if (!aberto || !status?.disponivel) return;

    const chaveModulo = (Object.keys(MODULO_LABEL) as Array<keyof typeof MODULO_LABEL>).find(
      (k) => MODULO_LABEL[k] === modulo,
    );
    const casoId = /\/casos\/([0-9a-f-]{36})/.exec(window.location.pathname)?.[1];

    let cancelado = false;
    setBuscandoIa(true);
    api
      .post<RespostaCopiloto>('/ia/sugerir', {
        modulo: chaveModulo ?? MODULOS.M17_IA,
        etapa,
        casoId,
      })
      .then((r) => {
        if (cancelado) return;
        setCartoesIa(r.cartoes);
        if (!r.disponivel) setStatus((s) => (s ? { ...s, disponivel: false } : s));
      })
      // Sem permissao (conta externa) ou falha: o painel segue so com o Guardian.
      .catch(() => !cancelado && setCartoesIa([]))
      .finally(() => !cancelado && setBuscandoIa(false));

    return () => {
      cancelado = true;
    };
  }, [aberto, status?.disponivel, modulo, etapa]);

  async function reagir(cartao: CartaoIa, acao: 'aceita' | 'rejeitada') {
    setReagidos((r) => ({ ...r, [cartao.id]: acao }));
    try {
      await api.post('/ia/feedback', { sugestaoId: cartao.id, acao });
    } catch {
      // O feedback alimenta indicadores; a falha dele nao interrompe ninguem.
    }
  }

  function alternarFixado() {
    setFixado((atual) => {
      const novo = !atual;
      try {
        localStorage.setItem(CHAVE_FIXADO, novo ? 'sim' : 'nao');
      } catch {
        // Preferência não persistida não impede o uso.
      }
      return novo;
    });
  }

  const conteudo: ReactNode = (
    <>
      <Stack
        direction="row"
        component="header"
        sx={{
          px: 2,
          py: 1.5,
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid',
          borderColor: 'divider',
          flexShrink: 0,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
            <AutoAwesome sx={{ fontSize: 15, color: 'primary.main' }} />
            <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>LAPATO Copiloto</Typography>
          </Stack>
          <Typography noWrap sx={{ fontSize: 11.5, color: 'text.secondary' }}>
            {etapa ? `${modulo} · ${etapa}` : modulo}
          </Typography>
        </Box>

        <Stack direction="row" spacing={0.25}>
          {!estreito && (
            <Tooltip
              title={fixado ? 'Soltar: volta a flutuar sobre o conteúdo' : 'Fixar ao lado do conteúdo'}
            >
              <IconButton onClick={alternarFixado} size="small" aria-pressed={fixado}>
                {fixado ? (
                  <PushPinFilled sx={{ fontSize: 17, color: 'primary.main' }} />
                ) : (
                  <PushPin sx={{ fontSize: 17 }} />
                )}
              </IconButton>
            </Tooltip>
          )}

          <IconButton onClick={onAlternar} size="small" aria-label="Fechar painel do Copiloto">
            <Close fontSize="small" />
          </IconButton>
        </Stack>
      </Stack>

      <Stack spacing={1.5} sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
        {status && !status.disponivel && (
          /**
           * M17 seções 110-112: o indicador é obrigatório, e o trabalho segue.
           * A ausência do Copiloto não impede cadastrar, descrever, diagnosticar,
           * assinar ou liberar.
           */
          <Alert severity="info" variant="outlined" role="status" sx={{ fontSize: 12 }}>
            <strong>Assistência de IA temporariamente indisponível.</strong> O trabalho continua
            normalmente; o LAPATO Guardian permanece ativo.
          </Alert>
        )}

        {cartoes.length === 0 && cartoesIa.length === 0 && !buscandoIa && (
          <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
            Nenhum apontamento para esta etapa.
          </Typography>
        )}

        {cartoes.map((c) => {
          const n = NIVEL[c.nivel];
          return (
            <Box
              key={c.id}
              component="article"
              sx={{
                p: 1.75,
                borderRadius: `${raio.medio}px`,
                border: '1px solid',
                borderColor: 'divider',
                // A barra lateral colorida identifica o nível de relance; o
                // símbolo e o rótulo abaixo garantem que não seja só cor.
                borderLeft: `4px solid ${n.cor}`,
              }}
            >
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
                <Box
                  aria-hidden
                  sx={{
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 10,
                    fontWeight: 700,
                    color: '#fff',
                    backgroundColor: n.cor,
                  }}
                >
                  {n.simbolo}
                </Box>
                <Typography
                  sx={{ fontSize: 11, fontWeight: 600, color: n.cor, textTransform: 'uppercase' }}
                >
                  {n.rotulo}
                </Typography>
              </Stack>

              <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{c.titulo}</Typography>
              <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: 0.5 }}>
                {c.corpo}
              </Typography>

              {/**
               * M17 seção 15: a sugestão precisa dizer que veio da IA, com quais
               * dados, de quais fontes, e se houve inferência — para não ser
               * confundida com dado observado.
               */}
              {(c.fontes?.length || c.inferencia) && (
                <Typography component="footer" sx={{ mt: 1, fontSize: 11, color: 'text.secondary' }}>
                  {c.fontes?.length ? `Fontes: ${c.fontes.join(', ')}. ` : null}
                  {c.inferencia ? 'Contém inferência.' : 'Baseado em dados do caso.'}
                </Typography>
              )}
            </Box>
          );
        })}

        {buscandoIa && (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', py: 0.5 }}>
            <CircularProgress size={14} />
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
              Consultando o Copiloto…
            </Typography>
          </Stack>
        )}

        {cartoesIa.map((c) => {
          const n = NIVEL[c.nivel];
          const reacao = reagidos[c.id];
          return (
            <Box
              key={c.id}
              component="article"
              sx={{
                p: 1.75,
                borderRadius: `${raio.medio}px`,
                border: '1px solid',
                borderColor: 'divider',
                borderLeft: `4px solid ${n.cor}`,
                opacity: reacao === 'rejeitada' ? 0.55 : 1,
              }}
            >
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
                <AutoAwesome sx={{ fontSize: 13, color: n.cor }} aria-hidden />
                <Typography
                  sx={{ fontSize: 11, fontWeight: 600, color: n.cor, textTransform: 'uppercase' }}
                >
                  {n.rotulo} · IA
                </Typography>
              </Stack>

              <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{c.titulo}</Typography>
              <Typography
                sx={{ fontSize: 12.5, color: 'text.secondary', mt: 0.5, whiteSpace: 'pre-wrap' }}
              >
                {c.corpo}
              </Typography>

              {c.textoSugerido && (
                <Box
                  sx={{
                    mt: 1,
                    p: 1.25,
                    borderRadius: `${raio.pequeno}px`,
                    backgroundColor: 'action.hover',
                    fontSize: 12.5,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {c.textoSugerido}
                </Box>
              )}

              {/* M17 secao 15: produzida pela IA, com fontes e inferencia ditas. */}
              <Typography component="footer" sx={{ mt: 1, fontSize: 11, color: 'text.secondary' }}>
                Produzido pela IA · Fontes: {c.fontes.join(', ')}.{' '}
                {c.inferencia ? 'Contém inferência.' : 'Leitura de dados do caso.'}
              </Typography>

              {/* O feedback alimenta os indicadores do M17 - apresentadas,
                  aceitas, rejeitadas - e nada alem disso. */}
              {reacao ? (
                <Typography sx={{ mt: 0.75, fontSize: 11, color: 'text.secondary' }}>
                  {reacao === 'aceita' ? 'Marcada como útil.' : 'Marcada como não útil.'}
                </Typography>
              ) : (
                <Stack direction="row" spacing={0.5} sx={{ mt: 0.75 }}>
                  <Button size="small" sx={{ fontSize: 11, py: 0 }} onClick={() => reagir(c, 'aceita')}>
                    Útil
                  </Button>
                  <Button
                    size="small"
                    color="inherit"
                    sx={{ fontSize: 11, py: 0, color: 'text.secondary' }}
                    onClick={() => reagir(c, 'rejeitada')}
                  >
                    Não ajudou
                  </Button>
                </Stack>
              )}
            </Box>
          );
        })}
      </Stack>
    </>
  );

  // --- tela estreita: gaveta ------------------------------------------------
  if (estreito) {
    return (
      <Drawer
        anchor="right"
        open={aberto}
        onClose={onAlternar}
        ModalProps={{ keepMounted: true }}
        slotProps={{
          paper: {
            component: 'aside',
            'aria-label': 'LAPATO Copiloto',
            sx: { width: '100%', maxWidth: 400, display: 'flex', flexDirection: 'column' },
          },
        }}
      >
        {conteudo}
      </Drawer>
    );
  }

  // --- fechado: aba na lateral ----------------------------------------------
  if (!aberto) {
    return (
      <ButtonBase
        onClick={onAlternar}
        aria-label="Abrir painel do Copiloto"
        sx={{
          position: 'fixed',
          right: 0,
          top: '50%',
          transform: 'translateY(-50%)',
          px: 1,
          py: 3,
          gap: 1,
          flexDirection: 'column',
          borderRadius: `${raio.medio}px 0 0 ${raio.medio}px`,
          border: '1px solid',
          borderRight: 'none',
          borderColor: 'divider',
          backgroundColor: 'background.paper',
          boxShadow: 3,
          zIndex: 1200,
        }}
      >
        {/* A contagem e o motivo de abrir: sem ela, a aba seria so um enfeite
            na borda da tela. */}
        <Badge badgeContent={cartoes.length + cartoesIa.length} color="primary">
          <AutoAwesome sx={{ fontSize: 16, color: 'primary.main' }} />
        </Badge>
        <Typography sx={{ fontSize: 11.5, writingMode: 'vertical-rl' }}>Copiloto</Typography>
      </ButtonBase>
    );
  }

  // --- fixado: coluna ao lado, ~30% (M17 secao 8) ---------------------------
  if (fixado) {
    return (
      <Box
        component="aside"
        aria-label="LAPATO Copiloto"
        sx={{
          width: shell.copilotoLargura,
          minWidth: 300,
          display: 'flex',
          flexDirection: 'column',
          borderLeft: '1px solid',
          borderColor: 'divider',
          backgroundColor: 'background.paper',
        }}
      >
        {conteudo}
      </Box>
    );
  }

  /**
   * Padrao: flutuante.
   *
   * `position: fixed` tira o painel do fluxo, entao ele nao rouba largura da
   * area de trabalho - a tabela de casos continua com a tela inteira por baixo.
   * Sem backdrop de proposito: o Copiloto assiste o trabalho, e nao poderia
   * bloquear a interacao justamente com aquilo que esta comentando.
   */
  return (
    <Paper
      component="aside"
      aria-label="LAPATO Copiloto"
      elevation={0}
      sx={{
        position: 'fixed',
        right: 16,
        top: shell.topbarAltura + 16,
        bottom: 16,
        width: 360,
        maxWidth: 'calc(100vw - 32px)',
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: `${raio.cartao}px`,
        boxShadow: sombra.suspenso,
        zIndex: 1150,
      }}
    >
      {conteudo}
    </Paper>
  );
}

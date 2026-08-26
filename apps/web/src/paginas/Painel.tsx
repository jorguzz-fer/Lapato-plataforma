import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import ChevronRight from '@mui/icons-material/ChevronRight';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutlined';
import ErrorOutline from '@mui/icons-material/ErrorOutlineOutlined';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import WarningAmberOutlined from '@mui/icons-material/WarningAmberOutlined';
import { primeiroNome } from '@lapato/shared';
import { api, type Painel as DadosPainel, type ItemDeAtencao } from '../api';

/**
 * Tela de chegada.
 *
 * Nao repete a Central de Casos. A Central responde "onde esta o caso X"; esta
 * tela responde **"o que precisa de mim agora"** e da tamanho ao dia. Por isso
 * ela e curta de proposito: quatro numeros, uma lista de coisas travadas, o
 * funil e a serie. Tudo que aparece aqui e clicavel e leva a uma tela onde da
 * para agir - numero que nao leva a lugar nenhum vira decoracao.
 */

/**
 * Cor e icone andam juntos.
 *
 * M07 exige que o indicador nao dependa exclusivamente de cor; quem nao
 * distingue vermelho de ambar ainda precisa saber o que e urgente.
 */
const NIVEL = {
  critico: { cor: 'error.main', Icone: ErrorOutline },
  atencao: { cor: 'warning.main', Icone: WarningAmberOutlined },
  informacao: { cor: 'text.secondary', Icone: InfoOutlined },
} as const;

function saudacao(agora: Date): string {
  const hora = agora.getHours();
  if (hora < 12) return 'Bom dia';
  if (hora < 18) return 'Boa tarde';
  return 'Boa noite';
}

/** `2026-08-26` -> `26/08`. Rotulo curto do eixo da serie. */
function diaCurto(iso: string): string {
  const [, mes, dia] = iso.split('-');
  return `${dia}/${mes}`;
}

function tempoMedio(dias: number | null): string {
  if (dias === null) return '—';
  if (dias < 1) return '< 1';
  return dias.toLocaleString('pt-BR');
}

function Numero({
  valor,
  rotulo,
  sufixo,
  detalhe,
}: {
  valor: string;
  rotulo: string;
  sufixo?: string;
  detalhe?: string;
}) {
  /**
   * 132px de base para caberem dois por linha num aparelho de 390px: quatro
   * cartoes empilhados empurrariam a faixa de atencao para fora da primeira
   * tela - justamente o que o painel existe para mostrar.
   */
  return (
    <Card sx={{ px: { xs: 1.75, sm: 2.5 }, py: 2, flex: '1 1 132px', minWidth: 132 }}>
      <Stack direction="row" sx={{ alignItems: 'baseline', gap: 0.5 }}>
        <Typography sx={{ fontSize: 30, fontWeight: 600, lineHeight: 1.1 }}>{valor}</Typography>
        {sufixo && (
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>{sufixo}</Typography>
        )}
      </Stack>
      <Typography sx={{ fontSize: 13, fontWeight: 500, mt: 0.75 }}>{rotulo}</Typography>
      {detalhe && (
        <Typography sx={{ fontSize: 11, color: 'text.secondary', mt: 0.25 }}>{detalhe}</Typography>
      )}
    </Card>
  );
}

function LinhaDeAtencao({ item }: { item: ItemDeAtencao }) {
  const { cor, Icone } = NIVEL[item.nivel];
  return (
    <Stack
      component={Link}
      to={item.para}
      direction="row"
      sx={{
        alignItems: 'center',
        gap: 1.5,
        px: 2,
        py: 1.5,
        textDecoration: 'none',
        color: 'inherit',
        borderTop: '1px solid',
        borderColor: 'divider',
        '&:first-of-type': { borderTop: 'none' },
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Icone sx={{ fontSize: 20, color: cor }} />
      <Box sx={{ minWidth: 44 }}>
        <Typography sx={{ fontSize: 20, fontWeight: 600, color: cor, lineHeight: 1 }}>
          {item.total}
        </Typography>
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 14, fontWeight: 500 }}>{item.rotulo}</Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{item.detalhe}</Typography>
      </Box>
      <ChevronRight sx={{ fontSize: 20, color: 'text.disabled' }} />
    </Stack>
  );
}

function Funil({ itens }: { itens: DadosPainel['funil'] }) {
  const maior = Math.max(...itens.map((i) => i.total), 1);

  return (
    <Card sx={{ p: 2.5, flex: '1 1 340px' }}>
      <Typography variant="h4" sx={{ mb: 0.25 }}>
        Casos por etapa
      </Typography>
      <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 2 }}>
        Onde o trabalho está parado agora.
      </Typography>

      {itens.length === 0 ? (
        <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
          Nenhum caso em andamento.
        </Typography>
      ) : (
        <Stack spacing={1.25}>
          {itens.map((i) => (
            <Box
              key={i.etapa}
              component={Link}
              to={`/casos?etapa=${i.etapa}`}
              sx={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
            >
              <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 0.5 }}>
                <Typography sx={{ fontSize: 13 }}>{i.rotulo}</Typography>
                <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{i.total}</Typography>
              </Stack>
              {/* Barra proporcional a maior fila, nao ao total: a pergunta e
                  qual etapa esta mais cheia, nao que fracao do dia ela e. */}
              <Box sx={{ height: 6, borderRadius: 3, bgcolor: 'action.hover' }}>
                <Box
                  sx={{
                    height: '100%',
                    borderRadius: 3,
                    bgcolor: 'primary.main',
                    width: `${Math.max((i.total / maior) * 100, 4)}%`,
                  }}
                />
              </Box>
            </Box>
          ))}
        </Stack>
      )}
    </Card>
  );
}

function Serie({ dias: todos }: { dias: DadosPainel['serie'] }) {
  const tema = useTheme();
  const estreito = useMediaQuery(tema.breakpoints.down('sm'));
  /**
   * Catorze colunas em 390px dariam 22px por dia - as duas barras cabem, o
   * rotulo "13/08" nao. Em tela estreita a serie encurta para uma semana em vez
   * de virar um borrao com datas sobrepostas.
   */
  const dias = estreito ? todos.slice(-7) : todos;
  const maior = Math.max(...dias.flatMap((d) => [d.entradas, d.liberacoes]), 1);

  return (
    <Card sx={{ p: 2.5, flex: '1 1 340px' }}>
      <Typography variant="h4" sx={{ mb: 0.25 }}>
        Entradas e liberações
      </Typography>
      <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 2 }}>
        Últimos {dias.length} dias. Entrar mais do que sai, todo dia, é fila se formando.
      </Typography>

      <Stack direction="row" sx={{ gap: 0.75, alignItems: 'flex-end', height: 120 }}>
        {dias.map((d) => (
          <Stack
            key={d.dia}
            sx={{ flex: 1, alignItems: 'center', gap: 0.5, minWidth: 0 }}
            title={`${diaCurto(d.dia)}: ${d.entradas} entraram, ${d.liberacoes} liberados`}
          >
            <Stack direction="row" sx={{ gap: '2px', alignItems: 'flex-end', height: 96 }}>
              <Box
                sx={{
                  width: 7,
                  borderRadius: '2px 2px 0 0',
                  bgcolor: 'primary.main',
                  // 2px de piso: um dia com zero precisa ser visivelmente zero,
                  // e nao um pixel que some contra o fundo.
                  height: d.entradas === 0 ? 2 : `${(d.entradas / maior) * 96}px`,
                  opacity: d.entradas === 0 ? 0.3 : 1,
                }}
              />
              <Box
                sx={{
                  width: 7,
                  borderRadius: '2px 2px 0 0',
                  bgcolor: 'success.main',
                  height: d.liberacoes === 0 ? 2 : `${(d.liberacoes / maior) * 96}px`,
                  opacity: d.liberacoes === 0 ? 0.3 : 1,
                }}
              />
            </Stack>
            <Typography sx={{ fontSize: 9, color: 'text.secondary', whiteSpace: 'nowrap' }}>
              {diaCurto(d.dia)}
            </Typography>
          </Stack>
        ))}
      </Stack>

      <Stack direction="row" sx={{ gap: 2, mt: 1.5 }}>
        {[
          { cor: 'primary.main', rotulo: 'Entradas' },
          { cor: 'success.main', rotulo: 'Liberações' },
        ].map((l) => (
          <Stack key={l.rotulo} direction="row" sx={{ alignItems: 'center', gap: 0.75 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '2px', bgcolor: l.cor }} />
            <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{l.rotulo}</Typography>
          </Stack>
        ))}
      </Stack>
    </Card>
  );
}

export function Painel({ nomeCompleto }: { nomeCompleto: string }) {
  const [dados, setDados] = useState<DadosPainel | null>(null);
  const [carregando, setCarregando] = useState(true);
  const agora = useMemo(() => new Date(), []);

  useEffect(() => {
    api
      .get<DadosPainel>('/painel')
      .then(setDados)
      .finally(() => setCarregando(false));
  }, []);

  /**
   * `capitalize` do CSS maiusculizaria cada palavra - "Quarta-Feira, 26 De
   * Agosto". Em portugues so a primeira letra sobe.
   */
  const dataPorExtenso = agora.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  });
  const hoje = dataPorExtenso.charAt(0).toUpperCase() + dataPorExtenso.slice(1);

  /**
   * A faixa de atencao e a faixa de contexto sao a mesma consulta, separadas na
   * hora de desenhar. "Cadaveres armazenados: 21" nao precisa de ninguem agora -
   * misturar os dois faria o titulo do cartao mentir e afogaria o que urge.
   */
  const urgentes = dados?.atencao.filter((i) => i.nivel !== 'informacao') ?? [];
  const contexto = dados?.atencao.filter((i) => i.nivel === 'informacao') ?? [];

  return (
    <Box component="section" sx={{ maxWidth: 1080 }}>
      <Typography variant="h2">
        {saudacao(agora)}
        {nomeCompleto.trim() ? `, ${primeiroNome(nomeCompleto)}` : ''}
      </Typography>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 3 }}>
        {hoje}
      </Typography>

      {carregando || !dados ? (
        <Stack spacing={3}>
          <Stack direction="row" spacing={1.5}>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} variant="rounded" height={92} sx={{ flex: 1 }} />
            ))}
          </Stack>
          <Skeleton variant="rounded" height={220} />
        </Stack>
      ) : (
        <Stack spacing={3}>
          <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', gap: 1.5 }}>
            <Numero
              valor={String(dados.volumetria.emAndamento)}
              rotulo="Casos em andamento"
              detalhe="Nem liberados, nem arquivados"
            />
            <Numero valor={String(dados.volumetria.entraramHoje)} rotulo="Entraram hoje" />
            <Numero valor={String(dados.volumetria.liberadosHoje)} rotulo="Liberados hoje" />
            {/* Um laboratorio que libera no mesmo dia daria "0 dias", que se le
                como "sem dado". Abaixo de um dia o numero vira "< 1". */}
            <Numero
              valor={tempoMedio(dados.volumetria.tempoMedioDias)}
              sufixo={
                dados.volumetria.tempoMedioDias === null
                  ? undefined
                  : dados.volumetria.tempoMedioDias < 1
                    ? 'dia'
                    : 'dias'
              }
              rotulo="Tempo médio até a liberação"
              detalhe={`Dias corridos, últimos ${dados.volumetria.diasDaMedia}`}
            />
          </Stack>

          <Card>
            <Box sx={{ px: 2, pt: 2, pb: 1.5 }}>
              <Typography variant="h4">Precisa de você agora</Typography>
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                Só aparece o que existe, e só o que você tem permissão para resolver.
              </Typography>
            </Box>
            {urgentes.length === 0 ? (
              <Stack
                direction="row"
                sx={{
                  alignItems: 'center',
                  gap: 1.5,
                  px: 2,
                  py: 2.5,
                  borderTop: '1px solid',
                  borderColor: 'divider',
                }}
              >
                <CheckCircleOutline sx={{ fontSize: 20, color: 'success.main' }} />
                <Typography sx={{ fontSize: 14 }}>
                  Nada travado no momento. Nenhum caso fora do prazo, bloqueado ou aguardando você.
                </Typography>
              </Stack>
            ) : (
              <Box>
                {urgentes.map((item) => (
                  <LinhaDeAtencao key={item.chave} item={item} />
                ))}
              </Box>
            )}
          </Card>

          {contexto.length > 0 && (
            <Stack direction="row" sx={{ gap: 1.5, flexWrap: 'wrap' }}>
              {contexto.map((item) => (
                <Card
                  key={item.chave}
                  component={Link}
                  to={item.para}
                  sx={{
                    px: 2,
                    py: 1.25,
                    flex: '1 1 180px',
                    minWidth: 160,
                    textDecoration: 'none',
                    color: 'inherit',
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  <Typography sx={{ fontSize: 20, fontWeight: 600, lineHeight: 1.2 }}>
                    {item.total}
                  </Typography>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                    {item.rotulo}
                  </Typography>
                </Card>
              ))}
            </Stack>
          )}

          <Stack direction="row" sx={{ gap: 2, flexWrap: 'wrap', alignItems: 'stretch' }}>
            <Funil itens={dados.funil} />
            <Serie dias={dados.serie} />
          </Stack>
        </Stack>
      )}
    </Box>
  );
}

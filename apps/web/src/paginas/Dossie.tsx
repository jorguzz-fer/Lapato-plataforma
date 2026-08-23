import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import InventoryOutlined from '@mui/icons-material/Inventory2Outlined';
import FactCheckOutlined from '@mui/icons-material/FactCheckOutlined';
import ScienceOutlined from '@mui/icons-material/ScienceOutlined';
import BiotechOutlined from '@mui/icons-material/BiotechOutlined';
import { EVENTO_LABEL, type TipoEvento } from '@lapato/shared';
import { api, type Dossie as DadosDossie } from '../api';
import { GaleriaDoCaso } from './imagens/GaleriaDoCaso';

/**
 * Dossie unico do caso (DIRETRIZES secoes 13 e 14).
 *
 * "Ao clicar em Abrir Caso, o usuario devera acessar o mesmo dossie,
 * independentemente do modulo de origem." As abas mudam conforme tipo de exame,
 * perfil, permissoes e etapa - mas o dossie e um so.
 */

type Aba = 'visao' | 'amostras' | 'imagens' | 'historico' | 'timeline';

const ABAS: Array<{ id: Aba; rotulo: string }> = [
  { id: 'visao', rotulo: 'Visão geral' },
  { id: 'amostras', rotulo: 'Amostras' },
  // M16 seção 57: todo caso tem sua aba de imagens - o acervo é um só.
  { id: 'imagens', rotulo: 'Imagens' },
  { id: 'historico', rotulo: 'Histórico' },
  { id: 'timeline', rotulo: 'Linha do tempo' },
];

/** Identificadores e quantidades em fonte tabular: alinham na vertical. */
const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };

/** M07: etapas em que o trabalho corrente é do M11 (da lâmina à liberação). */
const ETAPAS_LAUDO = new Set([
  'laminas_disponiveis',
  'aguardando_microscopia',
  'em_microscopia',
  'aguardando_complementar',
  'aguardando_revisao',
  'em_revisao',
  'aguardando_assinatura',
  'liberado',
]);

export function Dossie({ permissoes }: { permissoes: string[] }) {
  const { id } = useParams<{ id: string }>();
  const [dados, setDados] = useState<DadosDossie | null>(null);
  const [aba, setAba] = useState<Aba>('visao');

  useEffect(() => {
    if (id) api.get<DadosDossie>(`/casos/${id}`).then(setDados);
  }, [id]);

  if (!dados) {
    return (
      <Stack spacing={2}>
        <Skeleton variant="rounded" height={78} />
        <Skeleton variant="rounded" height={340} />
      </Stack>
    );
  }

  return (
    <Box component="section">
      {/* DIRETRIZES seção 15: cabeçalho persistente do caso. */}
      <Card component="header" sx={{ mb: 2.5, p: 2.5 }}>
        <Stack
          direction="row"
          sx={{ flexWrap: 'wrap', alignItems: 'center', columnGap: 3, rowGap: 1 }}
        >
          <Typography sx={{ ...MONO, fontSize: 17, fontWeight: 700 }}>
            {dados.caso.identificador}
          </Typography>

          <Box>
            <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>Paciente</Typography>
            <Typography sx={{ fontSize: 13.5, fontWeight: 500 }}>{dados.paciente.nome}</Typography>
          </Box>

          <Box>
            <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>Cliente</Typography>
            <Typography sx={{ fontSize: 13.5 }}>{dados.cliente.nomeFantasia}</Typography>
          </Box>

          <Box>
            <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>Serviço</Typography>
            <Typography sx={{ fontSize: 13.5 }}>{dados.servico.nome}</Typography>
          </Box>

          <Stack
            direction="row"
            spacing={1.5}
            sx={{
              // Em tela estreita a ação desce e ocupa a linha; `ml: auto` só
              // faz sentido quando há espaço horizontal sobrando.
              ml: { md: 'auto' },
              width: { xs: '100%', md: 'auto' },
              alignItems: 'center',
              mt: { xs: 1, md: 0 },
            }}
          >
            {dados.estado && (
              <Chip
                size="small"
                label={dados.estado.etapa.replaceAll('_', ' ')}
                color="primary"
                variant="outlined"
              />
            )}

            {/**
             * DIRETRIZES seção 15: navegação POR CONTEXTO. A próxima ação do
             * caso aparece no próprio caso, em vez de exigir que o usuário
             * volte à central e procure outra tela.
             */}
            {!dados.caso.recebidoEm && permissoes.includes('material:receber') && (
              <Button
                component={Link}
                to={`/casos/${id}/recebimento`}
                variant="contained"
                size="small"
                startIcon={<InventoryOutlined />}
                sx={{ flex: { xs: 1, md: 'none' } }}
              >
                Registrar recebimento
              </Button>
            )}

            {/* Recebido e ainda não triado: a triagem é a próxima ação. As duas
                condições são excludentes, então nunca aparecem as duas. */}
            {dados.caso.recebidoEm &&
              !dados.caso.triadoEm &&
              permissoes.includes('triagem:executar') && (
                <Button
                  component={Link}
                  to={`/casos/${id}/triagem`}
                  variant="contained"
                  size="small"
                  startIcon={<FactCheckOutlined />}
                  sx={{ flex: { xs: 1, md: 'none' } }}
                >
                  Registrar triagem
                </Button>
              )}

            {/**
             * M14: a necropsia é uma modalidade própria, não uma etapa da
             * histopatologia — por isso o atalho não depende da triagem como o
             * da macroscopia. Quem recebe um cadáver examina o cadáver.
             */}
            {permissoes.includes('necropsia:executar') && (
              <Button
                component={Link}
                to={`/casos/${id}/necropsia`}
                variant="outlined"
                size="small"
                startIcon={<BiotechOutlined />}
                sx={{ flex: { xs: 1, md: 'none' } }}
              >
                Necropsia
              </Button>
            )}

            {/**
             * Triado e liberado pela triagem: a bancada é a próxima ação. Uma
             * triagem bloqueada ou recusada não chega aqui — é o M06 segurando
             * o caso, e oferecer o atalho contradiria isso.
             */}
            {dados.caso.triadoEm &&
              dados.caso.resultadoTriagem !== 'bloqueado' &&
              dados.caso.resultadoTriagem !== 'recusado' &&
              permissoes.includes('macroscopia:executar') && (
                <Button
                  component={Link}
                  to={`/casos/${id}/macroscopia`}
                  // Enquanto a bancada é o trabalho corrente, é a ação primária;
                  // da lâmina em diante vira consulta, e o laudo assume o papel.
                  variant={ETAPAS_LAUDO.has(dados.estado?.etapa ?? '') ? 'outlined' : 'contained'}
                  size="small"
                  startIcon={<ScienceOutlined />}
                  sx={{ flex: { xs: 1, md: 'none' } }}
                >
                  Macroscopia
                </Button>
              )}

            {/**
             * Da lâmina em diante o trabalho é do M11: microscopia, laudo,
             * revisão, assinatura. Depois de liberado o botão continua — o
             * laudo é consulta, não só elaboração.
             */}
            {ETAPAS_LAUDO.has(dados.estado?.etapa ?? '') &&
              permissoes.includes('laudo:visualizar') && (
                <Button
                  component={Link}
                  to={`/casos/${id}/laudo`}
                  variant="contained"
                  size="small"
                  startIcon={<BiotechOutlined />}
                  sx={{ flex: { xs: 1, md: 'none' } }}
                >
                  Microscopia e laudo
                </Button>
              )}
          </Stack>
        </Stack>
      </Card>

      <Tabs
        value={aba}
        onChange={(_, v: Aba) => setAba(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ mb: 2, borderBottom: '1px solid', borderColor: 'divider' }}
      >
        {ABAS.map((a) => (
          <Tab key={a.id} value={a.id} label={a.rotulo} sx={{ fontSize: 13.5, minHeight: 42 }} />
        ))}
      </Tabs>

      {aba === 'visao' && (
        <Card sx={{ p: 2.5 }}>
          <Stack spacing={2}>
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

            <Divider />

            <Box>
              <Typography sx={{ fontSize: 11, color: 'text.secondary', mb: 1 }}>
                Recipientes
              </Typography>
              <Stack spacing={0.75}>
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
                    <Stack
                      key={r.id}
                      direction="row"
                      spacing={1.5}
                      sx={{ alignItems: 'center', fontSize: 12.5 }}
                    >
                      <Typography sx={{ ...MONO, fontSize: 12.5 }}>{r.identificador}</Typography>
                      <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
                        declarado {r.quantidadeDeclarada ?? '—'} · recebido{' '}
                        {r.quantidadeRecebida ?? '—'}
                      </Typography>
                      {divergente && (
                        <Chip size="small" color="warning" label="divergência" />
                      )}
                    </Stack>
                  );
                })}
              </Stack>
            </Box>
          </Stack>
        </Card>
      )}

      {aba === 'amostras' && (
        <Card sx={{ p: 2.5 }}>
          <Stack spacing={1.5} divider={<Divider flexItem />}>
            {dados.amostras.map((a) => (
              <Stack
                key={a.id}
                direction="row"
                spacing={2}
                sx={{ flexWrap: 'wrap', alignItems: 'center' }}
              >
                <Typography sx={{ ...MONO, fontSize: 12.5 }}>{a.identificador}</Typography>
                <Typography sx={{ fontSize: 13.5 }}>{a.descricao ?? '—'}</Typography>
                {a.lateralidade !== 'nao_aplicavel' && (
                  <Chip size="small" variant="outlined" label={`lateralidade: ${a.lateralidade}`} />
                )}
                {a.resultadoTriagem && (
                  <Chip
                    size="small"
                    variant="outlined"
                    label={`triagem: ${a.resultadoTriagem.replaceAll('_', ' ')}`}
                  />
                )}
              </Stack>
            ))}
          </Stack>
        </Card>
      )}

      {aba === 'imagens' && id && (
        <GaleriaDoCaso casoId={id} permissoes={permissoes} moduloContexto="M05_RECEBIMENTO" />
      )}

      {aba === 'historico' && (
        <Card sx={{ p: 2.5 }}>
          {dados.historicos.length === 0 && (
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
              Sem histórico clínico.
            </Typography>
          )}
          <Stack spacing={2} divider={<Divider flexItem />}>
            {dados.historicos.map((h) => (
              <Box key={h.id} component="article">
                {/* M05/M11: o texto original do solicitante nunca é substituído. */}
                <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                  Origem: {h.origem}
                </Typography>
                <Typography sx={{ fontSize: 13.5, whiteSpace: 'pre-wrap', mt: 0.5 }}>
                  {h.texto}
                </Typography>
              </Box>
            ))}
          </Stack>
        </Card>
      )}

      {aba === 'timeline' && (
        <Card sx={{ p: 2.5 }}>
          <Stack component="ol" spacing={1.5} sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {dados.linhaDoTempo.map((e) => (
              <Stack key={e.id} component="li" direction="row" spacing={2}>
                <Typography
                  component="time"
                  sx={{ ...MONO, fontSize: 11.5, color: 'text.secondary', flexShrink: 0, pt: 0.25 }}
                >
                  {new Date(e.ocorridoEm).toLocaleString('pt-BR')}
                </Typography>
                <Box>
                  <Typography sx={{ fontSize: 13.5 }}>
                    {EVENTO_LABEL[e.tipo as TipoEvento] ?? e.tipo}
                  </Typography>
                  <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                    {e.moduloOrigem}
                  </Typography>
                </Box>
              </Stack>
            ))}
          </Stack>
        </Card>
      )}
    </Box>
  );
}

function Campo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <Box>
      <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{rotulo}</Typography>
      <Typography sx={{ fontSize: 13.5 }}>{valor}</Typography>
    </Box>
  );
}

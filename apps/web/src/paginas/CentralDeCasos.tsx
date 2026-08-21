import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import ChevronRight from '@mui/icons-material/ChevronRight';
import BlockOutlined from '@mui/icons-material/BlockOutlined';
import InboxOutlined from '@mui/icons-material/InboxOutlined';
import { ETAPA } from '@lapato/shared';
import { IndicadorPrazo } from '@lapato/ui';
import { api, type CasoNaFila } from '../api';

/**
 * M07 - Central de Casos.
 *
 * "Onde o caso esta, em que etapa, o que falta, quem e responsavel, se ha
 * pendencia e se esta no prazo."
 *
 * O indicador de prazo vem de `@lapato/ui` justamente porque o M07 exige que ele
 * nao dependa apenas de cor - a regra mora no componente, nao nesta tela.
 */

const ETAPA_LABEL: Record<string, string> = {
  aguardando_recebimento: 'Aguardando recebimento',
  aguardando_triagem: 'Aguardando triagem',
  aguardando_macroscopia: 'Aguardando macroscopia',
  aguardando_processamento: 'Em processamento',
  aguardando_microscopia: 'Aguardando microscopia',
  aguardando_revisao: 'Aguardando revisão',
  aguardando_assinatura: 'Aguardando assinatura',
  liberado: 'Liberado',
};

const COLUNAS = ['Registro', 'Paciente', 'Cliente', 'Serviço', 'Etapa', 'Prazo'];

export function CentralDeCasos() {
  const [casos, setCasos] = useState<CasoNaFila[]>([]);
  const [etapa, setEtapa] = useState('');
  const [carregando, setCarregando] = useState(true);
  const tema = useTheme();
  const estreito = useMediaQuery(tema.breakpoints.down('md'));

  useEffect(() => {
    setCarregando(true);
    api
      .get<CasoNaFila[]>(`/fluxo/casos${etapa ? `?etapa=${etapa}` : ''}`)
      .then(setCasos)
      .finally(() => setCarregando(false));
  }, [etapa]);

  return (
    <Box component="section">
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        sx={{
          mb: 2.5,
          alignItems: { xs: 'stretch', sm: 'center' },
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 2,
        }}
      >
        <Box>
          <Typography variant="h2">Central de Casos</Typography>
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
            {carregando
              ? 'Carregando…'
              : `${casos.length} ${casos.length === 1 ? 'caso' : 'casos'}${etapa ? ' nesta etapa' : ''}`}
          </Typography>
        </Box>

        <TextField
          select
          label="Etapa"
          value={etapa}
          onChange={(e) => setEtapa(e.target.value)}
          sx={{ minWidth: { sm: 230 }, width: { xs: '100%', sm: 'auto' } }}
        >
          <MenuItem value="">Todas</MenuItem>
          {ETAPA.map((e) => (
            <MenuItem key={e} value={e}>
              {ETAPA_LABEL[e] ?? e}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      {/**
        * Duas apresentacoes, e nao uma tabela encolhida: seis colunas num
        * aparelho de 375px sao ilegiveis mesmo com rolagem horizontal. Em tela
        * estreita cada caso vira um cartao com o que decide a acao - registro,
        * paciente, etapa e prazo.
        */}
      {estreito ? (
        <Stack spacing={1.5}>
          {carregando &&
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} variant="rounded" height={96} />
            ))}

          {!carregando && casos.length === 0 && <Vazio comFiltro={etapa !== ''} />}

          {!carregando &&
            casos.map((caso) => (
              <Card key={caso.casoId} sx={{ p: 0 }}>
                <Box
                  component={Link}
                  to={`/casos/${caso.casoId}`}
                  sx={{
                    display: 'block',
                    p: 2,
                    textDecoration: 'none',
                    color: 'inherit',
                    '&:active': { backgroundColor: 'action.hover' },
                  }}
                >
                  <Stack
                    direction="row"
                    sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}
                  >
                    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                      <Typography
                        sx={{
                          fontWeight: 700,
                          color: 'primary.main',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {caso.identificador}
                      </Typography>
                      {caso.bloqueado && (
                        <BlockOutlined
                          sx={{ fontSize: 15, color: 'error.main' }}
                          titleAccess="Caso bloqueado: há pendência impedindo o fluxo"
                        />
                      )}
                    </Stack>

                    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                      <IndicadorPrazo estado={caso.alertaPrazo} previsao={caso.previsaoLiberacao} />
                      <ChevronRight sx={{ fontSize: 18, color: 'text.disabled' }} />
                    </Stack>
                  </Stack>

                  <Typography sx={{ fontSize: 14, fontWeight: 500 }}>{caso.paciente}</Typography>
                  <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
                    {caso.cliente} · {caso.servico}
                  </Typography>
                  <Typography sx={{ fontSize: 12.5, mt: 0.75 }}>
                    {ETAPA_LABEL[caso.etapa] ?? caso.etapa}
                  </Typography>
                </Box>
              </Card>
            ))}
        </Stack>
      ) : (
        <Card>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  {COLUNAS.map((c) => (
                    <TableCell key={c}>{c}</TableCell>
                  ))}
                </TableRow>
              </TableHead>

              <TableBody>
                {carregando &&
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {COLUNAS.map((c) => (
                        <TableCell key={c}>
                          <Skeleton />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}

                {!carregando && casos.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={COLUNAS.length} sx={{ py: 8 }}>
                      <Vazio comFiltro={etapa !== ''} />
                    </TableCell>
                  </TableRow>
                )}

                {!carregando &&
                  casos.map((caso) => (
                    <TableRow
                      key={caso.casoId}
                      hover
                      component={Link}
                      to={`/casos/${caso.casoId}`}
                      sx={{ textDecoration: 'none', display: 'table-row', cursor: 'pointer' }}
                    >
                      <TableCell>
                        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                          <Typography
                            sx={{
                              fontWeight: 600,
                              color: 'primary.main',
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            {caso.identificador}
                          </Typography>
                          {caso.bloqueado && (
                            <Tooltip title="Caso bloqueado: há pendência impedindo o fluxo">
                              <BlockOutlined sx={{ fontSize: 15, color: 'error.main' }} />
                            </Tooltip>
                          )}
                        </Stack>
                      </TableCell>
                      <TableCell>{caso.paciente}</TableCell>
                      <TableCell sx={{ color: 'text.secondary' }}>{caso.cliente}</TableCell>
                      <TableCell sx={{ color: 'text.secondary' }}>{caso.servico}</TableCell>
                      <TableCell>{ETAPA_LABEL[caso.etapa] ?? caso.etapa}</TableCell>
                      <TableCell>
                        <IndicadorPrazo
                          estado={caso.alertaPrazo}
                          previsao={caso.previsaoLiberacao}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      )}
    </Box>
  );
}

/** Estado vazio desenhado: sem ele, a lista vazia parece erro de carregamento. */
function Vazio({ comFiltro }: { comFiltro: boolean }) {
  return (
    <Box sx={{ py: 6, textAlign: 'center' }}>
      <InboxOutlined sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
      <Typography sx={{ fontWeight: 600 }}>
        {comFiltro ? 'Nenhum caso nesta etapa' : 'Nenhum caso cadastrado'}
      </Typography>
      <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
        {comFiltro
          ? 'Troque o filtro para ver os demais.'
          : 'Os casos aparecem aqui assim que forem cadastrados.'}
      </Typography>
    </Box>
  );
}

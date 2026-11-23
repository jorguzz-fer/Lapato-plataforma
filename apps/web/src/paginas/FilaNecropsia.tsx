import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import { DESTINACAO_CADAVER_LABEL, MODALIDADE_NECROPSIA_LABEL } from '@lapato/shared';
import { api, type NaFilaDeNecropsia } from '../api';

const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };

const SITUACAO: Record<NaFilaDeNecropsia['situacao'], { rotulo: string; cor: 'default' | 'warning' | 'info' | 'success' }> = {
  aguardando_exame: { rotulo: 'Aguardando exame', cor: 'warning' },
  em_exame: { rotulo: 'Em exame', cor: 'info' },
  em_laudo: { rotulo: 'Em laudo', cor: 'success' },
};

/**
 * "Realizar exame" (quinta revisao): a listagem de animais que aguardam a
 * necropsia. "Seleciona-se o animal, clicando-se no escolhido."
 *
 * Do mais antigo para o mais novo, como a fila da macroscopia: numa camara
 * fria, a ordem de chegada NAO e um detalhe de apresentacao - e o prazo de
 * guarda correndo.
 */
export function FilaNecropsia() {
  const navegar = useNavigate();
  const [linhas, setLinhas] = useState<NaFilaDeNecropsia[]>([]);
  const [busca, setBusca] = useState('');
  const [carregado, setCarregado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    // Espera o usuário parar de digitar: a busca é por nome do animal e do
    // responsável, e uma consulta por tecla bateria o servidor à toa.
    const t = setTimeout(() => {
      api
        .get<NaFilaDeNecropsia[]>(`/necropsia/fila${busca.trim() ? `?q=${encodeURIComponent(busca.trim())}` : ''}`)
        .then(setLinhas)
        .catch(() => setErro('Não foi possível carregar a fila.'))
        .finally(() => setCarregado(true));
    }, 250);
    return () => clearTimeout(t);
  }, [busca]);

  return (
    <Box sx={{ maxWidth: 1180 }}>
      <Typography variant="h2" sx={{ mb: 0.5 }}>
        Realizar exame
      </Typography>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 3 }}>
        Os animais que aguardam a necropsia, do que chegou primeiro ao que chegou por último.
      </Typography>

      <TextField
        fullWidth
        placeholder="Buscar por LN, animal ou responsável"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        sx={{ mb: 2 }}
        slotProps={{ input: { startAdornment: <SearchOutlined sx={{ mr: 1, color: 'text.secondary' }} /> } }}
      />

      {erro && <Alert severity="error">{erro}</Alert>}

      {!carregado ? (
        <Stack spacing={1}>
          <Skeleton variant="rounded" height={44} />
          <Skeleton variant="rounded" height={44} />
        </Stack>
      ) : linhas.length === 0 ? (
        <Alert severity="info">
          {busca.trim()
            ? 'Nenhum animal encontrado com esse termo.'
            : 'Nenhum corpo aguardando exame no momento.'}
        </Alert>
      ) : (
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                {['ID', 'Nome', 'Raça', 'Sexo', 'Responsável', 'Entrada', 'Tipo', 'Destinação', 'Local', 'Situação', 'Prazo'].map(
                  (c) => (
                    <TableCell key={c} sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {c}
                    </TableCell>
                  ),
                )}
              </TableRow>
            </TableHead>
            <TableBody>
              {linhas.map((l) => {
                /**
                 * O prazo de guarda em dias, e não a data: "faltam 2 dias" é o
                 * que faz alguém agir; "17.10" exige a conta de cabeça com o
                 * corpo ocupando a bandeja.
                 */
                const dias = l.prazoGuardaAte
                  ? Math.ceil((new Date(l.prazoGuardaAte).getTime() - Date.now()) / 86_400_000)
                  : null;
                return (
                  <TableRow
                    key={l.cadaverId}
                    hover
                    sx={{ cursor: l.casoId ? 'pointer' : 'default' }}
                    onClick={() => l.casoId && navegar(`/casos/${l.casoId}/necropsia`)}
                  >
                    <TableCell sx={{ ...MONO, fontWeight: 600 }}>{l.identificador}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{l.nome ?? '—'}</TableCell>
                    <TableCell>{l.raca ?? l.especie}</TableCell>
                    <TableCell>{l.sexo ?? '—'}</TableCell>
                    <TableCell>{l.responsavel ?? '—'}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {l.recebidoEm ? new Date(l.recebidoEm).toLocaleDateString('pt-BR') : '—'}
                    </TableCell>
                    <TableCell>
                      {l.modalidade
                        ? (MODALIDADE_NECROPSIA_LABEL[
                            l.modalidade as keyof typeof MODALIDADE_NECROPSIA_LABEL
                          ] ?? l.modalidade)
                        : '—'}
                    </TableCell>
                    <TableCell>
                      {l.destinacao
                        ? (DESTINACAO_CADAVER_LABEL[
                            l.destinacao as keyof typeof DESTINACAO_CADAVER_LABEL
                          ] ?? l.destinacao)
                        : 'A definir'}
                    </TableCell>
                    <TableCell sx={MONO}>{l.local ?? '—'}</TableCell>
                    <TableCell>
                      <Chip size="small" color={SITUACAO[l.situacao].cor} label={SITUACAO[l.situacao].rotulo} />
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {dias === null ? (
                        '—'
                      ) : (
                        <Typography
                          component="span"
                          sx={{ fontSize: 13, fontWeight: dias <= 2 ? 700 : 400, color: dias <= 0 ? 'error.main' : dias <= 2 ? 'warning.dark' : 'text.primary' }}
                        >
                          {dias <= 0 ? 'Vencido' : `${dias} d`}
                        </Typography>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Box>
      )}
    </Box>
  );
}

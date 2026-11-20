import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { api, ErroApi } from '../api';
import { DialogoEnvio } from './laudo/DialogoEnvio';

/**
 * Arquivo de laudos (segunda review, Hugo): "a gente consegue fazer busca dos
 * laudos pelo paciente, pelo cliente, pelo nome do responsavel, por uma
 * palavra-chave - carcinoma -, pela lamina, pela OS". Uma caixa so; o
 * servidor procura em tudo isso na versao corrente de cada laudo.
 *
 * Quarta revisao, mesma tela: "eu posso procurar por data... se foi enviado,
 * nao foi enviado, se foi assinado, nao foi assinado, porque sao coisas
 * diferentes" - e, abrindo o laudo, "assinado por mim no dia 9 do 10 as 15:51,
 * e foi enviado no dia 9 do 10 as 15:52... eu posso reenviar esse laudo se eu
 * quiser". Por isso cada linha mostra as duas datas e, quando ja ha envio, o
 * botao de reenviar - com os mesmos e-mails do cadastro.
 */

interface ResultadoLaudo {
  casoId: string;
  identificador: string;
  paciente: string;
  cliente: string;
  veterinario: string | null;
  patologista: string | null;
  status: string;
  liberadoEm: string | null;
  versao: number;
  versaoId: string;
  entradaEm: string;
  trecho: string | null;
  assinadaEm: string | null;
  assinadaPor: string | null;
  enviadoEm: string | null;
  envios: number;
}

type Situacao = 'todos' | 'enviados' | 'nao_enviados' | 'assinados' | 'nao_assinados';

const SITUACOES: Array<{ valor: Situacao; rotulo: string }> = [
  { valor: 'todos', rotulo: 'Todos' },
  { valor: 'nao_enviados', rotulo: 'Não enviados' },
  { valor: 'enviados', rotulo: 'Enviados' },
  { valor: 'nao_assinados', rotulo: 'Não assinados' },
  { valor: 'assinados', rotulo: 'Assinados' },
];

const dataHora = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };

export function ArquivoDeLaudos({ permissoes }: { permissoes: string[] }) {
  const [termo, setTermo] = useState('');
  const [situacao, setSituacao] = useState<Situacao>('todos');
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [resultados, setResultados] = useState<ResultadoLaudo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [reenviando, setReenviando] = useState<ResultadoLaudo | null>(null);

  const podeEnviar = permissoes.includes('laudo:liberar');

  const buscar = useCallback(() => {
    const q = termo.trim();
    const temRecorte = situacao !== 'todos' || !!de || !!ate;
    // Menos de 2 letras e sem recorte não vale a viagem: "tudo" não é resposta.
    if (q.length < 2 && !temRecorte) {
      setResultados(null);
      return;
    }
    const parametros = new URLSearchParams();
    if (q.length >= 2) parametros.set('q', q);
    if (situacao !== 'todos') parametros.set('situacao', situacao);
    if (de) parametros.set('de', new Date(`${de}T00:00:00`).toISOString());
    if (ate) parametros.set('ate', new Date(`${ate}T23:59:59`).toISOString());

    setBuscando(true);
    setErro(null);
    api
      .get<ResultadoLaudo[]>(`/laudos/busca?${parametros.toString()}`)
      .then(setResultados)
      .catch((err) => setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível buscar.'))
      .finally(() => setBuscando(false));
  }, [termo, situacao, de, ate]);

  // Busca ao parar de digitar, e imediatamente quando o recorte muda.
  useEffect(() => {
    const alarme = setTimeout(buscar, 350);
    return () => clearTimeout(alarme);
  }, [buscar]);

  return (
    <Box component="section" sx={{ maxWidth: 980 }}>
      <Typography variant="h2">Arquivo de laudos</Typography>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 2.5 }}>
        Paciente, cliente, veterinário, patologista, palavra do laudo, lâmina ou OS — tudo pela
        mesma caixa.
      </Typography>

      <TextField
        fullWidth
        autoFocus
        placeholder="Ex.: carcinoma, Thor, CV-000342/26, OS-2026-000012…"
        value={termo}
        onChange={(e) => setTermo(e.target.value)}
        slotProps={{ htmlInput: { 'aria-label': 'Buscar no arquivo de laudos' } }}
        sx={{ mb: 2 }}
      />

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.5}
        sx={{ mb: 2, alignItems: { sm: 'center' }, flexWrap: 'wrap', gap: 1 }}
      >
        <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', gap: 0.75 }}>
          {SITUACOES.map((s) => (
            <Chip
              key={s.valor}
              size="small"
              label={s.rotulo}
              color={situacao === s.valor ? 'primary' : 'default'}
              variant={situacao === s.valor ? 'filled' : 'outlined'}
              onClick={() => setSituacao(s.valor)}
            />
          ))}
        </Stack>
        <Stack direction="row" spacing={1}>
          <TextField
            size="small"
            type="date"
            label="Liberado de"
            value={de}
            onChange={(e) => setDe(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            size="small"
            type="date"
            label="até"
            value={ate}
            onChange={(e) => setAte(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Stack>
      </Stack>

      {erro && <Alert severity="error">{erro}</Alert>}

      {resultados && resultados.length === 0 && !buscando && (
        <Typography sx={{ fontSize: 13.5, color: 'text.secondary' }}>
          {termo.trim() ? `Nenhum laudo com “${termo.trim()}”.` : 'Nenhum laudo neste recorte.'}
        </Typography>
      )}

      {resultados && resultados.length > 0 && (
        <Card sx={{ p: 0 }}>
          <Stack divider={<Divider flexItem />}>
            {resultados.map((r) => (
              <Box key={r.casoId} sx={{ px: 2.5, py: 1.5, '&:hover': { bgcolor: 'action.hover' } }}>
                <Box
                  component={Link}
                  to={`/casos/${r.casoId}/laudo`}
                  sx={{ display: 'block', textDecoration: 'none', color: 'inherit' }}
                >
                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  <Typography sx={{ ...MONO, fontSize: 13, fontWeight: 700, color: 'primary.main' }}>
                    {r.identificador}
                  </Typography>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>{r.paciente}</Typography>
                  <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>{r.cliente}</Typography>
                  <Chip
                    size="small"
                    variant="outlined"
                    color={r.liberadoEm ? 'success' : 'default'}
                    label={
                      r.liberadoEm
                        ? `liberado ${new Date(r.liberadoEm).toLocaleDateString('pt-BR')}`
                        : r.status.replaceAll('_', ' ')
                    }
                  />
                  {r.versao > 1 && <Chip size="small" variant="outlined" label={`v${r.versao}`} />}
                </Stack>
                <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.25 }}>
                  {[r.patologista ? `laudo: ${r.patologista}` : null, r.veterinario ? `solicitante ${r.veterinario}` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </Typography>
                {r.trecho && (
                  <Typography sx={{ fontSize: 12.5, mt: 0.5, fontStyle: 'italic' }}>{r.trecho}</Typography>
                )}
                </Box>

                {/* As duas datas, lado a lado — "são coisas diferentes". */}
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ mt: 0.5, alignItems: 'center', flexWrap: 'wrap', gap: 0.75 }}
                >
                  <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                    {r.assinadaEm
                      ? `Assinado ${dataHora(r.assinadaEm)}${r.assinadaPor ? ` por ${r.assinadaPor}` : ''}`
                      : 'Não assinado'}
                    {' · '}
                    {r.enviadoEm
                      ? `enviado ${dataHora(r.enviadoEm)}${r.envios > 1 ? ` (${r.envios} envios)` : ''}`
                      : 'não enviado'}
                  </Typography>
                  {podeEnviar && r.liberadoEm && (
                    <Button size="small" onClick={() => setReenviando(r)}>
                      {r.envios > 0 ? 'Reenviar' : 'Enviar'}
                    </Button>
                  )}
                </Stack>
              </Box>
            ))}
          </Stack>
        </Card>
      )}

      {reenviando && (
        <DialogoEnvio
          versaoId={reenviando.versaoId}
          reenvio={reenviando.envios > 0}
          aoFechar={() => setReenviando(null)}
          aoEnviar={buscar}
        />
      )}
    </Box>
  );
}

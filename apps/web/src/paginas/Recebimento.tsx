import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutlineOutlined';
import { api, ErroApi, type Dossie as DadosDossie } from '../api';

/**
 * M05 - Recebimento fisico do material.
 *
 * O modulo separa quatro momentos: **Solicitado, Cadastrado, Recebido e
 * Triado**. Esta tela registra o terceiro, e a distincao nao e burocratica:
 * o que foi declarado pelo solicitante e o que chegou na bancada podem
 * divergir, e essa divergencia e **dado do caso** - vira evento
 * `divergencia.identificada` e fica na linha do tempo. Nao e erro a corrigir.
 *
 * Por isso o campo de quantidade recebida **nasce vazio**. Preenche-lo com o
 * valor declarado transformaria a conferencia em clicar em salvar, e a
 * divergencia que o M05 existe para capturar nunca apareceria. Quem contou
 * precisa digitar o que contou.
 */

const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };

export function Recebimento() {
  const { id } = useParams<{ id: string }>();
  const navegar = useNavigate();

  const [dados, setDados] = useState<DadosDossie | null>(null);
  const [contagem, setContagem] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (id) {
      api
        .get<DadosDossie>(`/casos/${id}`)
        .then(setDados)
        .catch(() => setErro('Não foi possível carregar o caso.'));
    }
  }, [id]);

  const recipientes = dados?.recipientes ?? [];

  const todosPreenchidos = useMemo(
    () => recipientes.length > 0 && recipientes.every((r) => contagem[r.id]?.trim() !== undefined && contagem[r.id]?.trim() !== ''),
    [recipientes, contagem],
  );

  const divergencias = useMemo(
    () =>
      recipientes.filter((r) => {
        const informado = contagem[r.id];
        if (informado === undefined || informado.trim() === '') return false;
        return r.quantidadeDeclarada !== null && Number(informado) !== r.quantidadeDeclarada;
      }),
    [recipientes, contagem],
  );

  async function submeter(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);

    try {
      await api.post(`/casos/${id}/recebimento`, {
        conferencia: recipientes.map((r) => ({
          recipienteId: r.id,
          quantidadeRecebida: Number(contagem[r.id]),
        })),
      });
      navegar(`/casos/${id}`);
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível registrar o recebimento.');
      setEnviando(false);
    }
  }

  if (!dados) {
    return erro ? (
      <Alert severity="error">{erro}</Alert>
    ) : (
      <Stack spacing={2} sx={{ maxWidth: 760 }}>
        <Skeleton variant="rounded" height={70} />
        <Skeleton variant="rounded" height={260} />
      </Stack>
    );
  }

  /**
   * Recebimento acontece uma vez. Mostrar o estado em vez do formulario evita
   * que alguem preencha tudo para colher um 400 no final.
   */
  if (dados.caso.recebidoEm) {
    return (
      <Box sx={{ maxWidth: 760 }}>
        <Alert
          severity="success"
          icon={<CheckCircleOutline />}
          action={
            <Button size="small" onClick={() => navegar(`/casos/${id}`)}>
              Abrir dossiê
            </Button>
          }
        >
          <AlertTitle>Material já recebido</AlertTitle>
          O recebimento de {dados.caso.identificador} foi registrado em{' '}
          {new Date(dados.caso.recebidoEm).toLocaleString('pt-BR')}.
        </Alert>
      </Box>
    );
  }

  return (
    <Box component="form" onSubmit={submeter} noValidate sx={{ maxWidth: 760 }}>
      <Typography variant="h2" sx={{ mb: 0.5 }}>
        Recebimento
      </Typography>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 3 }}>
        Conte o que chegou e registre o número encontrado. Divergência não é erro: fica no caso.
      </Typography>

      <Card sx={{ p: 2.5, mb: 2.5 }}>
        <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <Typography sx={{ ...MONO, fontSize: 16, fontWeight: 700 }}>
            {dados.caso.identificador}
          </Typography>
          <Box>
            <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>Paciente</Typography>
            <Typography sx={{ fontSize: 13.5 }}>{dados.paciente.nome}</Typography>
          </Box>
          <Box>
            <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>Cliente</Typography>
            <Typography sx={{ fontSize: 13.5 }}>{dados.cliente.nomeFantasia}</Typography>
          </Box>
        </Stack>
      </Card>

      <Card sx={{ p: 2.5 }}>
        <Typography variant="h4" sx={{ mb: 0.25 }}>
          Conferência
        </Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
          O campo nasce vazio de propósito — quem contou digita o que contou.
        </Typography>

        <Divider sx={{ my: 2.5 }} />

        <Stack spacing={2.5}>
          {recipientes.map((r) => {
            const informado = contagem[r.id] ?? '';
            const preenchido = informado.trim() !== '';
            const diverge =
              preenchido &&
              r.quantidadeDeclarada !== null &&
              Number(informado) !== r.quantidadeDeclarada;

            return (
              <Stack
                key={r.id}
                direction={{ xs: 'column', sm: 'row' }}
                spacing={2}
                sx={{ alignItems: { sm: 'center' } }}
              >
                <Typography sx={{ ...MONO, fontSize: 13, flex: 1 }}>{r.identificador}</Typography>

                <Box sx={{ width: 120 }}>
                  <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>Declarado</Typography>
                  <Typography sx={{ fontSize: 15, fontVariantNumeric: 'tabular-nums' }}>
                    {r.quantidadeDeclarada ?? '—'}
                  </Typography>
                </Box>

                <TextField
                  label="Recebido"
                  type="number"
                  value={informado}
                  onChange={(e) =>
                    setContagem((atual) => ({ ...atual, [r.id]: e.target.value }))
                  }
                  required
                  sx={{ width: 130 }}
                  slotProps={{ htmlInput: { min: 0 } }}
                  color={diverge ? 'warning' : undefined}
                  focused={diverge || undefined}
                />

                <Box sx={{ width: 140 }}>
                  {diverge && (
                    <Chip
                      size="small"
                      color="warning"
                      label={`▲ divergência`}
                      sx={{ fontVariantNumeric: 'tabular-nums' }}
                    />
                  )}
                </Box>
              </Stack>
            );
          })}
        </Stack>
      </Card>

      {divergencias.length > 0 && (
        <Alert severity="warning" sx={{ mt: 2.5 }}>
          <AlertTitle>
            {divergencias.length === 1
              ? '1 recipiente com divergência'
              : `${divergencias.length} recipientes com divergência`}
          </AlertTitle>
          O recebimento segue normalmente. Cada divergência vira um evento na linha do tempo do
          caso, com o declarado e o recebido lado a lado.
        </Alert>
      )}

      {erro && (
        <Alert severity="error" sx={{ mt: 2.5 }}>
          {erro}
        </Alert>
      )}

      <Stack direction="row" spacing={1.5} sx={{ mt: 3, justifyContent: 'flex-end' }}>
        <Button onClick={() => navegar(`/casos/${id}`)} disabled={enviando}>
          Cancelar
        </Button>
        <Button type="submit" variant="contained" disabled={enviando || !todosPreenchidos}>
          {enviando ? 'Registrando…' : 'Registrar recebimento'}
        </Button>
      </Stack>

      {!todosPreenchidos && recipientes.length > 0 && (
        <Typography sx={{ fontSize: 11.5, color: 'text.secondary', textAlign: 'right', mt: 1 }}>
          Informe a quantidade recebida de todos os recipientes.
        </Typography>
      )}
    </Box>
  );
}

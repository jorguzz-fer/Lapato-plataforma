import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
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
import DownloadOutlined from '@mui/icons-material/DownloadOutlined';
import { STATUS_EXTERNO_LABEL } from '@lapato/shared';
import { api, baixarArquivo, ErroApi, type ExameDetalhePortal } from '../api';

/**
 * M04 secao 18 - dossie externo.
 *
 * "O usuario externo nunca devera visualizar automaticamente a versao interna
 * completa do dossie." O que existe aqui e o que ele pode agir sobre: onde esta
 * o exame, o que falta, o que ele ja enviou, e o laudo quando houver.
 *
 * A caixa de complemento (secoes 23-24) fica ao lado do historico, e nao numa
 * tela separada, porque a decisao de acrescentar nasce da leitura do que ja foi
 * enviado.
 */

export function PortalExame({ podeComplementar }: { podeComplementar: boolean }) {
  const { id } = useParams<{ id: string }>();
  const [dados, setDados] = useState<ExameDetalhePortal | null>(null);
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(() => {
    if (!id) return;
    api
      .get<ExameDetalhePortal>(`/portal/exames/${id}`)
      .then(setDados)
      .catch(() => setErro('Exame não encontrado.'));
  }, [id]);

  useEffect(carregar, [carregar]);

  async function enviarComplemento() {
    if (!id || !texto.trim()) return;
    setOcupado(true);
    setErro(null);
    try {
      await api.post(`/portal/exames/${id}/historico`, { texto });
      setTexto('');
      setAviso('Informação enviada ao laboratório.');
      carregar();
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível enviar.');
    } finally {
      setOcupado(false);
    }
  }

  async function baixar(versaoId: string, identificador: string, versao: number) {
    try {
      const blob = await baixarArquivo(`/portal/laudos/${versaoId}/pdf`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${identificador}-v${versao}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível baixar o laudo.');
    }
  }

  if (!dados) {
    return erro ? <Alert severity="error">{erro}</Alert> : <Skeleton variant="rounded" height={280} />;
  }

  return (
    <Stack spacing={2.5}>
      {erro && <Alert severity="error" onClose={() => setErro(null)}>{erro}</Alert>}
      {aviso && <Alert severity="success" onClose={() => setAviso(null)}>{aviso}</Alert>}

      <Card sx={{ p: 2.5 }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          sx={{ gap: 2, justifyContent: 'space-between' }}
        >
          <Box>
            <Typography variant="h3">{dados.paciente}</Typography>
            <Typography sx={{ fontSize: 13.5, color: 'text.secondary' }}>
              {[
                dados.identificador,
                dados.servico,
                dados.tutor && `Tutor: ${dados.tutor}`,
                dados.veterinario,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Typography>
          </Box>

          <Stack sx={{ gap: 0.75, alignItems: { md: 'flex-end' } }}>
            <Chip
              label={STATUS_EXTERNO_LABEL[dados.status] ?? dados.status}
              color={dados.status === 'laudo_disponivel' ? 'success' : 'default'}
            />
            {dados.prazoSuspenso ? (
              /* §13: prazo suspenso é informação, não ausência de informação. */
              <Typography sx={{ fontSize: 12.5, color: 'warning.main' }}>
                Previsão suspensa — aguardando informação
              </Typography>
            ) : (
              dados.previsaoLiberacao && (
                <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
                  Previsão: {new Date(dados.previsaoLiberacao).toLocaleDateString('pt-BR')}
                </Typography>
              )
            )}
          </Stack>
        </Stack>
      </Card>

      {dados.pendencias.length > 0 && (
        <Alert severity="warning">
          <AlertTitle>O laboratório precisa de uma informação</AlertTitle>
          <Stack spacing={0.5}>
            {dados.pendencias.map((p) => (
              <Typography key={p.id} sx={{ fontSize: 14 }}>
                {p.descricao}
              </Typography>
            ))}
          </Stack>
        </Alert>
      )}

      {dados.laudo && (
        <Card sx={{ p: 2.5 }}>
          <Typography variant="h4" sx={{ mb: 1.5 }}>
            Laudo
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <Stack spacing={1.5}>
            {dados.laudo.versoes.map((v) => (
              <Stack
                key={v.id}
                direction="row"
                sx={{ gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}
              >
                <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
                  {v.tipo === 'adendo'
                    ? `Adendo · versão ${v.versao}`
                    : v.tipo === 'correcao'
                      ? `Correção · versão ${v.versao}`
                      : `Versão ${v.versao}`}
                </Typography>
                {/* §20: versão substituída precisa ficar clara — quem baixou
                    ontem não pode achar que tem o documento vigente. */}
                {!v.vigente && (
                  <Chip size="small" label="substituída por versão posterior" />
                )}
                <Button
                  size="small"
                  startIcon={<DownloadOutlined />}
                  onClick={() => void baixar(v.id, dados.identificador, v.versao)}
                >
                  Baixar PDF
                </Button>
              </Stack>
            ))}
          </Stack>
        </Card>
      )}

      <Card sx={{ p: 2.5 }}>
        <Typography variant="h4" sx={{ mb: 1.5 }}>
          Histórico clínico
        </Typography>
        <Divider sx={{ mb: 2 }} />

        <Stack spacing={1.5} sx={{ mb: podeComplementar ? 2.5 : 0 }}>
          {dados.historicos.length === 0 && (
            <Typography sx={{ fontSize: 13.5, color: 'text.secondary' }}>
              Nenhuma informação clínica registrada.
            </Typography>
          )}
          {dados.historicos.map((h) => (
            <Box key={h.id}>
              <Typography sx={{ fontSize: 14 }}>{h.texto}</Typography>
              <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>
                {h.complementar ? 'Complemento' : 'Informado no cadastro'} ·{' '}
                {new Date(h.criadoEm).toLocaleString('pt-BR')}
              </Typography>
            </Box>
          ))}
        </Stack>

        {podeComplementar && (
          <>
            <TextField
              label="Acrescentar informação"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              multiline
              minRows={3}
              fullWidth
              helperText="O que for enviado é acrescentado ao caso — nada do que já foi informado se perde."
            />
            <Button
              variant="contained"
              sx={{ mt: 1.5 }}
              disabled={ocupado || texto.trim() === ''}
              onClick={() => void enviarComplemento()}
            >
              Enviar ao laboratório
            </Button>
          </>
        )}
      </Card>

      <Card sx={{ p: 2.5 }}>
        <Typography variant="h4" sx={{ mb: 1.5 }}>
          Andamento
        </Typography>
        <Divider sx={{ mb: 2 }} />
        <Stack spacing={1}>
          {dados.linhaDoTempo.map((e, i) => (
            <Stack key={i} direction="row" sx={{ gap: 1.5, alignItems: 'baseline' }}>
              <Typography
                sx={{
                  fontSize: 12,
                  color: 'text.secondary',
                  minWidth: 96,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                }}
              >
                {new Date(e.ocorridoEm).toLocaleDateString('pt-BR')}
              </Typography>
              <Typography sx={{ fontSize: 14 }}>{e.rotulo}</Typography>
            </Stack>
          ))}
        </Stack>
      </Card>
    </Stack>
  );
}

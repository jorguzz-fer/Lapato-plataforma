import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined';
import ErrorOutlineOutlined from '@mui/icons-material/ErrorOutlineOutlined';
import HistoryOutlined from '@mui/icons-material/HistoryOutlined';
import { api, ErroApi, type LaudoValidado } from '../api';

/**
 * Validação pública do laudo pelo QR Code do PDF (M11 seção 88).
 *
 * Sem sessão, de propósito: quem escaneia o QR pode ser um tutor, outro
 * veterinário ou um perito, ninguém com login no LAPATO. O tenant vem no
 * próprio caminho da URL, resolvido antes de qualquer contexto de sessão
 * existir - o mesmo padrão do login (ADR 0002).
 *
 * A resposta é deliberadamente pobre: só o que autentica o documento perante
 * terceiros, nunca diagnóstico, conclusão ou dado do paciente.
 */
export function ValidarLaudo() {
  const { tenantSlug, codigo } = useParams<{ tenantSlug: string; codigo: string }>();
  const [dados, setDados] = useState<LaudoValidado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregado, setCarregado] = useState(false);

  useEffect(() => {
    if (!tenantSlug || !codigo) return;
    api
      .get<LaudoValidado>(`/validar/${tenantSlug}/${codigo}`)
      .then(setDados)
      .catch((err) =>
        setErro(
          err instanceof ErroApi
            ? err.detalhe
            : 'Não foi possível verificar este documento.',
        ),
      )
      .finally(() => setCarregado(true));
  }, [tenantSlug, codigo]);

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        p: 2,
        bgcolor: 'grey.50',
      }}
    >
      <Card sx={{ p: 4, maxWidth: 460, width: '100%' }}>
        <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: 'text.secondary' }}>
          LAPATO
        </Typography>
        <Typography variant="h3" sx={{ mb: 3 }}>
          Verificação de autenticidade
        </Typography>

        {!carregado && (
          <Stack sx={{ py: 3, alignItems: 'center' }}>
            <CircularProgress size={28} />
          </Stack>
        )}

        {carregado && erro && (
          <Alert severity="error" icon={<ErrorOutlineOutlined />}>
            {erro || 'Documento não encontrado. Confira o endereço do QR Code.'}
          </Alert>
        )}

        {carregado && dados && (
          <Stack spacing={2}>
            <Alert
              severity={dados.vigente ? 'success' : 'warning'}
              icon={dados.vigente ? <CheckCircleOutlined /> : <HistoryOutlined />}
            >
              {dados.vigente
                ? 'Documento autêntico e vigente.'
                : 'Documento autêntico, mas substituído por uma versão mais recente.'}
            </Alert>

            <Divider />

            <Campo rotulo="Instituição" valor={dados.instituicao} />
            <Campo rotulo="Caso" valor={dados.caso} />
            <Campo
              rotulo="Versão"
              valor={`v${dados.versao} · ${TIPO_LABEL[dados.tipo] ?? dados.tipo}`}
            />
            <Campo rotulo="Assinado por" valor={dados.assinadoPor ?? '—'} />
            <Campo rotulo="Assinado em" valor={new Date(dados.assinadoEm).toLocaleString('pt-BR')} />

            {!dados.vigente && (
              <Chip
                size="small"
                label="Existe uma versão mais recente deste laudo"
                sx={{ alignSelf: 'flex-start' }}
              />
            )}
          </Stack>
        )}
      </Card>
    </Box>
  );
}

const TIPO_LABEL: Record<string, string> = {
  original: 'Original',
  adendo: 'Adendo',
  correcao: 'Correção',
};

function Campo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <Box>
      <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{rotulo}</Typography>
      <Typography sx={{ fontSize: 14.5 }}>{valor}</Typography>
    </Box>
  );
}

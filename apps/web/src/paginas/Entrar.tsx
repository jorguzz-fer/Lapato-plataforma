import { useState, type FormEvent } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ArrowForward from '@mui/icons-material/ArrowForward';
import HistoryToggleOff from '@mui/icons-material/HistoryToggleOffOutlined';
import ShieldOutlined from '@mui/icons-material/ShieldOutlined';
import VerifiedOutlined from '@mui/icons-material/VerifiedOutlined';
import type { EstagioSessao } from '@lapato/shared';
import { CampoSenha, MolduraEntrada } from '@lapato/ui';
import { api, ErroApi } from '../api';

/**
 * Login.
 *
 * A instituicao e pedida explicitamente porque o tenant e resolvido antes de
 * qualquer consulta a dado de dominio (ADR 0002) - o que dispensa uma funcao de
 * bypass da RLS no backend.
 *
 * Aceitar a senha nao significa entrar: a resposta diz em que estagio a sessao
 * ficou, e quem decide a proxima tela e o `App`.
 */

const DESTAQUES = [
  {
    icone: <HistoryToggleOff sx={{ fontSize: 18 }} />,
    titulo: 'Rastreabilidade',
    descricao: 'Linha do tempo única por caso',
  },
  {
    icone: <ShieldOutlined sx={{ fontSize: 18 }} />,
    titulo: 'Isolamento',
    descricao: 'Cada instituição vê só o seu',
  },
  {
    icone: <VerifiedOutlined sx={{ fontSize: 18 }} />,
    titulo: 'Guardian',
    descricao: 'Checagem antes de assinar',
  },
];

export function Entrar({ aoEntrar }: { aoEntrar: (estagio: EstagioSessao) => void }) {
  const [instituicao, setInstituicao] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function submeter(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);

    try {
      const { estagio } = await api.post<{ estagio: EstagioSessao }>('/auth/login', {
        instituicao,
        email,
        senha,
      });
      setSenha('');
      aoEntrar(estagio);
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível entrar.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <MolduraEntrada
      titulo="Bem-vindo de volta"
      descricao="Entre com suas credenciais para acessar o sistema."
      vitrine={{
        logo: '/logo.webp',
        etiqueta: 'Gestão anatomopatológica veterinária',
        manchete: (
          <>
            Do recebimento à assinatura,{' '}
            <Box component="span" sx={{ color: 'primary.light' }}>
              um caso só.
            </Box>
          </>
        ),
        texto:
          'Cadastro, triagem, macroscopia, processamento e laudo em torno de uma única unidade de trabalho — com prazo em dias úteis e histórico que não se apaga.',
        destaques: DESTAQUES,
      }}
    >
      <Box component="form" onSubmit={submeter} noValidate>
        <Stack spacing={2.5}>
          <TextField
            label="Instituição"
            value={instituicao}
            onChange={(e) => setInstituicao(e.target.value)}
            required
            fullWidth
            autoFocus
            autoComplete="organization"
            helperText="O identificador curto da sua instituição."
          />

          <TextField
            label="E-mail"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            fullWidth
            autoComplete="username"
          />

          <CampoSenha
            rotulo="Senha"
            valor={senha}
            aoMudar={setSenha}
            autoComplete="current-password"
          />

          {erro && (
            <Alert severity="error" sx={{ fontSize: 13 }}>
              {erro}
            </Alert>
          )}

          <Button
            type="submit"
            variant="contained"
            size="large"
            fullWidth
            disabled={enviando}
            endIcon={enviando ? undefined : <ArrowForward />}
          >
            {enviando ? 'Entrando…' : 'Entrar'}
          </Button>
        </Stack>
      </Box>
    </MolduraEntrada>
  );
}

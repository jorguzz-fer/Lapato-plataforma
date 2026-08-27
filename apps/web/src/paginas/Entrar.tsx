import { useEffect, useRef, useState, type FormEvent } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Skeleton from '@mui/material/Skeleton';
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
 * A instituicao continua indo no corpo do login porque o tenant e resolvido
 * antes de qualquer consulta a dado de dominio (ADR 0002) - o que dispensa uma
 * funcao de bypass da RLS no backend. O que muda aqui e so quem digita o slug:
 * enquanto houver um unico tenant, ele vem de `INSTITUICAO_PADRAO`.
 *
 * Aceitar a senha nao significa entrar: a resposta diz em que estagio a sessao
 * ficou, e quem decide a proxima tela e o `App`.
 */

/**
 * Slug usado quando o produto opera com uma instituicao so.
 *
 * Enquanto a homologacao nao libera novos tenants, pedir o slug no login e
 * atrito puro: todo mundo que entra e da mesma instituicao, e um campo a mais
 * so cria uma forma extra de errar o acesso. Com valor definido, o campo some
 * da tela e o slug vai no corpo do login do mesmo jeito - o backend nao muda.
 *
 * Para trazer o campo de volta na abertura para novos tenants, basta publicar
 * com `VITE_INSTITUICAO_PADRAO=""`. Nao ha codigo a reverter.
 */
const INSTITUICAO_PADRAO = import.meta.env.VITE_INSTITUICAO_PADRAO ?? 'lapato';

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

interface InstituicaoUnica {
  slug: string;
  nome: string;
}

export function Entrar({ aoEntrar }: { aoEntrar: (estagio: EstagioSessao) => void }) {
  const [instituicao, setInstituicao] = useState(INSTITUICAO_PADRAO);
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [unica, setUnica] = useState<InstituicaoUnica | null>(null);
  const [resolvendo, setResolvendo] = useState(true);
  const campoEmail = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .get<InstituicaoUnica | null>('/auth/instituicao')
      .then((resposta) => {
        if (resposta?.slug) {
          setUnica(resposta);
          setInstituicao(resposta.slug);
          /**
           * Foco imperativo: `autoFocus` so vale na montagem, e nesse instante
           * o campo de e-mail ainda nao era o primeiro da tela.
           */
          campoEmail.current?.focus();
        }
      })
      /**
       * Falhar aqui nao pode impedir ninguem de entrar: sem resposta, a tela
       * volta a pedir o slug - o comportamento de sempre.
       */
      .catch(() => undefined)
      .finally(() => setResolvendo(false));
  }, []);

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
          {!INSTITUICAO_PADRAO && (
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
          )}

          <TextField
            label="E-mail"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            fullWidth
            autoFocus={Boolean(INSTITUICAO_PADRAO)}
            autoComplete="username"
            inputRef={campoEmail}
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
            disabled={enviando || resolvendo}
            endIcon={enviando ? undefined : <ArrowForward />}
          >
            {enviando ? 'Entrando…' : 'Entrar'}
          </Button>
        </Stack>
      </Box>
    </MolduraEntrada>
  );
}

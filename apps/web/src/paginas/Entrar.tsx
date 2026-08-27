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
 * A instituicao continua sendo enviada sempre, porque o tenant e resolvido
 * antes de qualquer consulta a dado de dominio (ADR 0002) - e o que dispensa
 * uma funcao de bypass da RLS no backend. O que muda aqui e so quem digita.
 *
 * Enquanto existe uma instituicao so, `GET /auth/instituicao` devolve o slug e
 * o campo some: e uma pergunta cuja resposta e sempre a mesma, e uma forma
 * barata de errar o login por digitacao. A decisao vem do estado do banco, nao
 * de uma configuracao - no dia em que a segunda instituicao for criada, a rota
 * passa a devolver `null` e o campo reaparece sozinho.
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

interface InstituicaoUnica {
  slug: string;
  nome: string;
}

export function Entrar({ aoEntrar }: { aoEntrar: (estagio: EstagioSessao) => void }) {
  const [instituicao, setInstituicao] = useState('');
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
          {/* Enquanto a rota nao responde, um esqueleto no lugar do campo: piscar
              o campo e depois some-lo faria a tela pular embaixo do cursor. */}
          {resolvendo && <Skeleton variant="rounded" height={56} />}

          {!resolvendo && !unica && (
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

          {/* Some o campo, mas nao a informacao: quem entra continua vendo em
              qual instituicao esta entrando. */}
          {unica && (
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
              Entrando em <Box component="strong">{unica.nome}</Box>.
            </Typography>
          )}

          <TextField
            label="E-mail"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            fullWidth
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

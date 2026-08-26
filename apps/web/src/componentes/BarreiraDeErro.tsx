import { Component, type ErrorInfo, type ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

/**
 * Ultima linha de defesa da interface.
 *
 * Sem ela, uma unica excecao de render apaga o aplicativo inteiro: o React
 * desmonta a arvore e sobra uma tela branca, sem mensagem, sem menu, sem
 * caminho de volta. Foi exatamente o que aconteceu quando o front subiu antes
 * da API que passou a devolver `nomeCompleto` - um campo do avatar derrubou a
 * lista de casos, que nao tem nada a ver com ele.
 *
 * Numa bancada de laboratorio isso e pior do que parece: quem esta com o
 * material na mao nao tem como saber se o sistema caiu, se a rede caiu, ou se
 * o trabalho foi salvo. Uma mensagem com um caminho de volta e o minimo.
 *
 * A barreira **nao** substitui tratar o erro na origem - ela existe para que a
 * proxima falha que ninguem previu custe uma mensagem, e nao a tela toda.
 */

interface Estado {
  erro: Error | null;
}

export class BarreiraDeErro extends Component<{ children: ReactNode }, Estado> {
  override state: Estado = { erro: null };

  static getDerivedStateFromError(erro: Error): Estado {
    return { erro };
  }

  override componentDidCatch(erro: Error, info: ErrorInfo): void {
    // O console e o unico canal de diagnostico que existe hoje no front; quando
    // o M26 trouxer telemetria, e daqui que o evento sai.
    console.error('Falha ao renderizar a interface:', erro, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.erro) return this.props.children;

    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100dvh', p: 3 }}>
        <Alert severity="error" sx={{ maxWidth: 560 }}>
          <AlertTitle>A tela não pôde ser carregada</AlertTitle>

          <Typography sx={{ fontSize: 13.5, mb: 1 }}>
            Algo falhou ao desenhar esta parte do sistema. Nada do que você já salvou foi
            perdido — o servidor registra cada etapa no momento em que ela é concluída.
          </Typography>

          <Typography sx={{ fontSize: 13.5, mb: 2 }}>
            Recarregar costuma resolver. Se o erro voltar logo depois de uma atualização do
            sistema, avise quem administra a instalação.
          </Typography>

          <Stack direction="row" spacing={1}>
            <Button variant="contained" size="small" onClick={() => window.location.reload()}>
              Recarregar
            </Button>
            <Button size="small" onClick={() => (window.location.href = '/')}>
              Ir para o início
            </Button>
          </Stack>

          {/* O detalhe tecnico fica visivel: quem suporta a instalacao precisa
              dele, e esconder so obriga a pedir print do console. */}
          <Typography
            component="pre"
            sx={{
              mt: 2,
              fontSize: 11,
              color: 'text.secondary',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {this.state.erro.message}
          </Typography>
        </Alert>
      </Box>
    );
  }
}

import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { api, ErroApi, type AssinaturaProfissional, type UsuarioLista } from '../api';

/**
 * Assinatura profissional (M02 secao 45).
 *
 * O que sai impresso no laudo e o que o Guardian confere antes de deixar
 * assinar. Ate a primeira versao disto, so existia no CLI de provisionamento:
 * quem provisionasse a instituicao sem informar o conselho ficava com um
 * sistema que **barra a assinatura do laudo e nao oferece onde resolver**.
 *
 * Renovar nao edita: cria registro novo e inativa o anterior. O laudo ja
 * assinado precisa continuar apontando para a identificacao que valia no
 * momento da assinatura (M11 secao 118), entao o historico fica.
 */
export function DialogoAssinatura({
  usuario,
  aoFechar,
  aoMudar,
}: {
  usuario: UsuarioLista | null;
  aoFechar: () => void;
  aoMudar: () => void;
}) {
  const [assinaturas, setAssinaturas] = useState<AssinaturaProfissional[] | null>(null);
  const [identificacao, setIdentificacao] = useState('');
  const [validoAte, setValidoAte] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const recarregar = useCallback(() => {
    if (!usuario) return;
    api
      .get<AssinaturaProfissional[]>(`/usuarios/${usuario.id}/assinaturas`)
      .then(setAssinaturas)
      .catch(() => setErro('Não foi possível carregar as assinaturas.'));
  }, [usuario]);

  useEffect(() => {
    setAssinaturas(null);
    setIdentificacao('');
    setValidoAte('');
    setErro(null);
    recarregar();
  }, [recarregar]);

  if (!usuario) return null;

  const vigente = assinaturas?.find(
    (a) => a.ativa && (!a.validoAte || new Date(a.validoAte) > new Date()),
  );

  async function agir(acao: () => Promise<unknown>, padrao: string) {
    setOcupado(true);
    setErro(null);
    try {
      await acao();
      recarregar();
      aoMudar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.detalhe : padrao);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Dialog open onClose={aoFechar} fullWidth maxWidth="sm">
      <DialogTitle>Assinatura profissional</DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 2 }}>
          {usuario.nomeCompleto} — é o conselho e o registro que saem impressos no laudo. Sem uma
          assinatura ativa e válida, o Guardian impede a assinatura.
        </Typography>

        {vigente ? (
          <Alert severity="success" sx={{ mb: 2 }}>
            Vigente: <strong>{vigente.identificacaoProfissional}</strong>
            {vigente.validoAte
              ? ` · válida até ${new Date(vigente.validoAte).toLocaleDateString('pt-BR')}`
              : ' · sem prazo'}
          </Alert>
        ) : (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Este profissional não tem assinatura válida e não consegue assinar laudo.
          </Alert>
        )}

        <Stack spacing={2}>
          <TextField
            label={vigente ? 'Renovar com' : 'Conselho e registro'}
            placeholder="CRMV-CE 12345"
            value={identificacao}
            onChange={(e) => setIdentificacao(e.target.value)}
            helperText="Como deve aparecer no laudo."
            fullWidth
          />
          <TextField
            label="Válida até"
            type="date"
            value={validoAte}
            onChange={(e) => setValidoAte(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            helperText="Deixe vazio se não houver prazo."
            fullWidth
          />
          <Button
            variant="contained"
            disabled={ocupado || identificacao.trim().length < 3}
            onClick={() =>
              void agir(
                () =>
                  api.post(`/usuarios/${usuario.id}/assinaturas`, {
                    identificacaoProfissional: identificacao.trim(),
                    // O campo de data dá só o dia; o fim dele é o último
                    // instante em que a assinatura ainda vale.
                    validoAte: validoAte ? new Date(`${validoAte}T23:59:59`).toISOString() : null,
                  }),
                'Não foi possível registrar a assinatura.',
              ).then(() => {
                setIdentificacao('');
                setValidoAte('');
              })
            }
          >
            {vigente ? 'Renovar assinatura' : 'Registrar assinatura'}
          </Button>
        </Stack>

        {assinaturas && assinaturas.length > 0 && (
          <>
            <Divider sx={{ my: 2.5 }} />
            <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mb: 1 }}>
              Histórico — a assinatura inativa fica, porque o laudo assinado aponta para ela.
            </Typography>
            <Stack spacing={1}>
              {assinaturas.map((a) => (
                <Stack
                  key={a.id}
                  direction="row"
                  sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}
                >
                  <Typography sx={{ fontSize: 13 }}>
                    {a.identificacaoProfissional}
                    <Typography component="span" sx={{ fontSize: 12, color: 'text.secondary' }}>
                      {' · desde '}
                      {new Date(a.validoDe).toLocaleDateString('pt-BR')}
                      {a.validoAte
                        ? ` até ${new Date(a.validoAte).toLocaleDateString('pt-BR')}`
                        : ' · sem prazo'}
                    </Typography>
                  </Typography>
                  {a.ativa ? (
                    <Button
                      size="small"
                      color="inherit"
                      disabled={ocupado}
                      onClick={() =>
                        void agir(
                          () => api.post(`/usuarios/${usuario.id}/assinaturas/${a.id}/inativacao`),
                          'Não foi possível inativar.',
                        )
                      }
                    >
                      Inativar
                    </Button>
                  ) : (
                    <Chip size="small" variant="outlined" label="Inativa" />
                  )}
                </Stack>
              ))}
            </Stack>
          </>
        )}

        {erro && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {erro}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={aoFechar}>Fechar</Button>
      </DialogActions>
    </Dialog>
  );
}

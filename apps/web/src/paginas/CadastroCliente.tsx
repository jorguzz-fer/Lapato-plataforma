import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined';
import { api, ErroApi, type AutocadastroCliente } from '../api';

/**
 * Autocadastro do cliente pelo link (documento do Hugo: "poder enviar o link
 * para preenchimento das infos dessa pagina pela propria empresa").
 *
 * Sem sessao, como a validacao do laudo: o tenant vem no caminho e o token e
 * o unico segredo - de uso unico e com validade. O cliente ve e preenche SO
 * os dados dele: precos e veterinarios nunca passam por aqui.
 */
export function CadastroCliente() {
  const { tenantSlug, token } = useParams<{ tenantSlug: string; token: string }>();
  const [dados, setDados] = useState<AutocadastroCliente | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregado, setCarregado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [concluido, setConcluido] = useState(false);

  const [nomeFantasia, setNomeFantasia] = useState('');
  const [razaoSocial, setRazaoSocial] = useState('');
  const [documento, setDocumento] = useState('');
  const [email, setEmail] = useState('');
  const [telefone, setTelefone] = useState('');

  useEffect(() => {
    if (!tenantSlug || !token) return;
    api
      .get<AutocadastroCliente>(`/cadastro-cliente/${tenantSlug}/${token}`)
      .then((d) => {
        setDados(d);
        setNomeFantasia(d.cliente.nomeFantasia);
        setRazaoSocial(d.cliente.razaoSocial ?? '');
        setDocumento(d.cliente.documento ?? '');
        setEmail(d.cliente.email ?? '');
        setTelefone(d.cliente.telefone ?? '');
      })
      .catch((err) =>
        setErro(err instanceof ErroApi ? err.detalhe : 'Este link não é válido ou já expirou.'),
      )
      .finally(() => setCarregado(true));
  }, [tenantSlug, token]);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setErro(null);
    try {
      await api.post(`/cadastro-cliente/${tenantSlug}/${token}`, {
        nomeFantasia: nomeFantasia.trim(),
        ...(razaoSocial.trim() ? { razaoSocial: razaoSocial.trim() } : {}),
        documento: documento.trim(),
        email: email.trim(),
        telefone: telefone.trim(),
      });
      setConcluido(true);
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível enviar os dados.');
    } finally {
      setEnviando(false);
    }
  }

  const valido =
    nomeFantasia.trim() !== '' && documento.trim().length >= 11 && email.trim() !== '' && telefone.trim() !== '';

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 2, bgcolor: 'grey.50' }}>
      <Card sx={{ p: 4, maxWidth: 520, width: '100%' }}>
        <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: 'text.secondary' }}>
          LAPATO
        </Typography>
        <Typography variant="h2" sx={{ mb: 0.5 }}>
          Cadastro de cliente
        </Typography>

        {!carregado ? (
          <Box sx={{ py: 4, textAlign: 'center' }}>
            <CircularProgress size={24} />
          </Box>
        ) : concluido ? (
          <Alert severity="success" icon={<CheckCircleOutlined />} sx={{ mt: 2 }}>
            Dados enviados. Obrigado — o laboratório já recebeu sua ficha. Este link não vale mais.
          </Alert>
        ) : !dados ? (
          <Alert severity="error" sx={{ mt: 2 }}>
            {erro ?? 'Este link não é válido ou já expirou.'}
          </Alert>
        ) : (
          <Box component="form" onSubmit={enviar} noValidate>
            <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 3 }}>
              {dados.instituicao} pediu que você confira e complete os dados da sua empresa. Válido
              até {new Date(dados.expiraEm).toLocaleDateString('pt-BR')}; o link vale uma única vez.
            </Typography>
            <Stack spacing={2}>
              <TextField
                label="Nome fantasia"
                value={nomeFantasia}
                onChange={(e) => setNomeFantasia(e.target.value)}
                required
                autoFocus
              />
              <TextField
                label="Razão social"
                value={razaoSocial}
                onChange={(e) => setRazaoSocial(e.target.value)}
              />
              <TextField
                label="CNPJ"
                value={documento}
                onChange={(e) => setDocumento(e.target.value)}
                required
              />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="E-mail"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  sx={{ flex: 1.4 }}
                  helperText="Para onde vão os laudos e o fechamento do mês"
                />
                <TextField
                  label="Telefone"
                  value={telefone}
                  onChange={(e) => setTelefone(e.target.value)}
                  required
                  sx={{ flex: 1 }}
                  helperText=" "
                />
              </Stack>
              {erro && <Alert severity="error">{erro}</Alert>}
              <Button type="submit" variant="contained" disabled={enviando || !valido}>
                {enviando ? 'Enviando…' : 'Enviar dados'}
              </Button>
            </Stack>
          </Box>
        )}
      </Card>
    </Box>
  );
}

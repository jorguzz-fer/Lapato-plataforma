import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Checkbox from '@mui/material/Checkbox';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined';
import { api, ErroApi, type FormularioNecropsiaPublico } from '../api';
import { CamposDoFormularioNecropsia } from './necropsia/CamposDoFormulario';

/**
 * Formulario de solicitacao e autorizacao de necropsia, aberto pelo tutor no
 * link que o laboratorio enviou (quinta revisao).
 *
 * Sem sessao, como o autocadastro do cliente e a validacao do laudo: o tenant
 * vem no caminho e o token e o unico segredo - de uso unico e com validade.
 *
 * O valor combinado aparece, mas travado: "todos os dados inseridos, a excecao
 * do valor, podem ser editados pelo tutor". Esconder o preco de quem assina a
 * autorizacao seria pior do que deixa-lo editar.
 */
export function FormularioNecropsia() {
  const { tenantSlug, token } = useParams<{ tenantSlug: string; token: string }>();
  const [dados, setDados] = useState<FormularioNecropsiaPublico | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregado, setCarregado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [concluido, setConcluido] = useState(false);

  const [respostas, setRespostas] = useState<Record<string, string>>({});
  const [autorizo, setAutorizo] = useState(false);

  useEffect(() => {
    if (!tenantSlug || !token) return;
    api
      .get<FormularioNecropsiaPublico>(`/formulario-necropsia/${tenantSlug}/${token}`)
      .then((d) => {
        setDados(d);
        // O que o laboratorio ja anotou vem preenchido: o tutor corrige, nao
        // redigita.
        setRespostas({
          responsavelSolicitacao: d.dados.responsavelSolicitacao ?? '',
          contatoResponsavel: d.dados.contatoResponsavel ?? '',
          responsavelDocumento: d.dados.responsavelDocumento ?? '',
          responsavelCidade: d.dados.responsavelCidade ?? '',
          responsavelUf: d.dados.responsavelUf ?? '',
          obitoEm: d.dados.obitoEm ? d.dados.obitoEm.slice(0, 16) : '',
          relatoCronologico: d.dados.circunstanciasMorte ?? '',
          principalDuvida: d.dados.perguntasSolicitante ?? '',
        });
      })
      .catch((err) =>
        setErro(err instanceof ErroApi ? err.detalhe : 'Este link não é válido ou já expirou.'),
      )
      .finally(() => setCarregado(true));
  }, [tenantSlug, token]);

  const valor = useMemo(() => {
    if (!dados?.valorCombinado) return null;
    const n = Number(dados.valorCombinado);
    return Number.isFinite(n)
      ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      : null;
  }, [dados]);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setErro(null);
    try {
      await api.post(`/formulario-necropsia/${tenantSlug}/${token}`, {
        respostas: {
          ...respostas,
          autorizacaoAceitaEm: new Date().toISOString(),
        },
      });
      setConcluido(true);
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível enviar o formulário.');
    } finally {
      setEnviando(false);
    }
  }

  const obrigatorias = ['responsavelSolicitacao', 'contatoResponsavel', 'relatoCronologico'];
  const valido = autorizo && obrigatorias.every((c) => (respostas[c] ?? '').trim() !== '');

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 2, bgcolor: 'grey.50' }}>
      <Card sx={{ p: 4, maxWidth: 620, width: '100%' }}>
        <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: 'text.secondary' }}>
          LAPATO
        </Typography>
        <Typography variant="h2" sx={{ mb: 0.5 }}>
          Solicitação e autorização de necropsia
        </Typography>

        {!carregado ? (
          <Box sx={{ py: 4, textAlign: 'center' }}>
            <CircularProgress size={24} />
          </Box>
        ) : concluido ? (
          <Alert severity="success" icon={<CheckCircleOutlined />} sx={{ mt: 2 }}>
            Formulário enviado. O laboratório já recebeu suas respostas. Este link não vale mais.
          </Alert>
        ) : !dados ? (
          <Alert severity="error" sx={{ mt: 2 }}>
            {erro ?? 'Este link não é válido ou já expirou.'}
          </Alert>
        ) : (
          <Box component="form" onSubmit={enviar} noValidate>
            <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 2 }}>
              {dados.instituicao} pediu que você confira e complete este formulário
              {dados.dados.paciente ? ` sobre ${dados.dados.paciente}` : ''}
              {dados.dados.especie ? ` (${dados.dados.especie})` : ''}. Válido até{' '}
              {dados.expiraEm ? new Date(dados.expiraEm).toLocaleDateString('pt-BR') : '—'}; o link
              vale uma única vez.
            </Typography>

            <Stack spacing={2}>
              <CamposDoFormularioNecropsia valores={respostas} aoMudar={setRespostas} />

              <Divider sx={{ my: 1 }} />
              <Stack
                direction="row"
                spacing={2}
                sx={{ alignItems: 'baseline', justifyContent: 'space-between' }}
              >
                <Box>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                    Devolução do corpo
                  </Typography>
                  <Typography sx={{ fontWeight: 600 }}>
                    {dados.dados.devolucaoCorpo === null
                      ? 'A combinar com o laboratório'
                      : dados.dados.devolucaoCorpo
                        ? 'Com devolução'
                        : 'Sem devolução'}
                  </Typography>
                </Box>
                <Box sx={{ textAlign: 'right' }}>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                    Valor combinado
                  </Typography>
                  <Typography sx={{ fontWeight: 600 }}>{valor ?? 'A combinar'}</Typography>
                </Box>
              </Stack>
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                A devolução e o valor foram acordados com o laboratório e não são editáveis aqui —
                se algo estiver diferente do combinado, fale com {dados.instituicao} antes de
                enviar.
              </Typography>

              <FormControlLabel
                control={
                  <Checkbox checked={autorizo} onChange={(e) => setAutorizo(e.target.checked)} />
                }
                label={
                  <Typography sx={{ fontSize: 13 }}>
                    Autorizo a realização da necropsia nas condições acima e declaro que as
                    informações que prestei são verdadeiras.
                  </Typography>
                }
              />

              {erro && <Alert severity="error">{erro}</Alert>}
              <Button type="submit" variant="contained" disabled={enviando || !valido}>
                {enviando ? 'Enviando…' : 'Enviar formulário'}
              </Button>
              {!autorizo && (
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                  Marque a autorização para poder enviar.
                </Typography>
              )}
            </Stack>
          </Box>
        )}
      </Card>
    </Box>
  );
}

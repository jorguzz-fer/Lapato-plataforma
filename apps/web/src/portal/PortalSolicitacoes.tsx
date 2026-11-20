import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddOutlined from '@mui/icons-material/AddOutlined';
import {
  api,
  ErroApi,
  type ExamePortal,
  type SolicitacaoPortal,
  type TipoSolicitacaoPortal,
} from '../api';

/**
 * M04 secoes 30-32 - solicitacoes do cliente.
 *
 * O Portal e a INTERFACE das solicitacoes; elas pertencem ao M10 (secao 83).
 *
 * Quarta revisao com o Hugo: a reuniao inteira nasce de uma devolucao de bloco
 * pedida por WhatsApp. A tecnica deu "ok", entrou de ferias, e dez dias depois
 * ninguem sabia onde o bloco estava - com o cliente cobrando. "Ele nao faz
 * mais solicitacao pelo WhatsApp, faz pelo login deles... e quando ele entrar
 * no sistema, ele vai saber em que fase ta: ta solicitado, ja foi encaminhado,
 * foi separado."
 *
 * A fase que aparece aqui e o texto de Portal da etapa, nunca o rotulo interno
 * (traducao contextual do M10): o cliente nao precisa saber que o bloco foi
 * "enviado ao processamento".
 */

const STATUS_EXTERNO_SOLICITACAO: Record<string, string> = {
  criada: 'Recebida',
  aguardando_analise: 'Em análise',
  aprovada: 'Em atendimento',
  aguardando_execucao: 'Em atendimento',
  em_execucao: 'Em atendimento',
  aguardando_informacao: 'Aguardando informação',
  parcialmente_concluida: 'Em atendimento',
  concluida: 'Finalizada',
  recusada: 'Finalizada',
  cancelada: 'Cancelada',
};

const ENCERRADAS = ['concluida', 'recusada', 'cancelada'];

export function PortalSolicitacoes({ podeSolicitar }: { podeSolicitar: boolean }) {
  const [itens, setItens] = useState<SolicitacaoPortal[] | null>(null);
  const [tipos, setTipos] = useState<TipoSolicitacaoPortal[]>([]);
  const [exames, setExames] = useState<ExamePortal[]>([]);
  const [dialogo, setDialogo] = useState(false);

  const recarregar = useCallback(() => {
    api
      .get<SolicitacaoPortal[]>('/portal/solicitacoes')
      .then(setItens)
      .catch(() => setItens([]));
  }, []);

  useEffect(recarregar, [recarregar]);

  /** O formulário só existe se houver o que pedir e para qual exame. */
  useEffect(() => {
    if (!podeSolicitar) return;
    api
      .get<TipoSolicitacaoPortal[]>('/portal/tipos-solicitacao')
      .then(setTipos)
      .catch(() => setTipos([]));
    api
      .get<ExamePortal[]>('/portal/exames')
      .then(setExames)
      .catch(() => setExames([]));
  }, [podeSolicitar]);

  if (itens === null) return <Skeleton variant="rounded" height={180} />;

  return (
    <Stack spacing={2.5}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        sx={{ gap: 1.5, alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
      >
        <div>
          <Typography variant="h3">Solicitações</Typography>
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
            Pedidos sobre os seus exames, com a fase de cada um — sem precisar ligar nem mandar
            mensagem.
          </Typography>
        </div>
        {podeSolicitar && tipos.length > 0 && (
          <Button
            variant="contained"
            size="small"
            startIcon={<AddOutlined />}
            onClick={() => setDialogo(true)}
          >
            Nova solicitação
          </Button>
        )}
      </Stack>

      {itens.length === 0 && (
        <Typography sx={{ fontSize: 14, color: 'text.secondary' }}>
          Nenhuma solicitação registrada para os seus exames.
        </Typography>
      )}

      <Stack spacing={1.5}>
        {itens.map((s) => {
          const encerrada = ENCERRADAS.includes(s.status);
          return (
            <Card key={s.id} sx={{ p: 2.5 }}>
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                sx={{ gap: 1.5, justifyContent: 'space-between' }}
              >
                <div>
                  <Stack direction="row" sx={{ gap: 1, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <Typography
                      sx={{
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        fontSize: 13,
                        fontWeight: 600,
                      }}
                    >
                      {s.identificador}
                    </Typography>
                    {s.nomeTipo && (
                      <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{s.nomeTipo}</Typography>
                    )}
                    <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                      {s.paciente} · {s.casoIdentificador}
                    </Typography>
                  </Stack>
                  <Typography sx={{ fontSize: 14, mt: 0.5 }}>{s.descricao}</Typography>
                  {/* A fase, na língua do cliente. Enquanto não há etapa registrada, o status basta. */}
                  {s.fase && !encerrada && (
                    <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 0.5 }}>
                      Fase atual: {s.fase}
                    </Typography>
                  )}
                  <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.25 }}>
                    Pedida em {new Date(s.criadoEm).toLocaleDateString('pt-BR')}
                  </Typography>
                </div>
                <Chip
                  size="small"
                  color={s.status === 'concluida' ? 'success' : 'default'}
                  label={STATUS_EXTERNO_SOLICITACAO[s.status] ?? 'Em análise'}
                  sx={{ alignSelf: { xs: 'flex-start', md: 'center' } }}
                />
              </Stack>
            </Card>
          );
        })}
      </Stack>

      {dialogo && (
        <DialogoNovaSolicitacao
          tipos={tipos}
          exames={exames}
          aoFechar={() => setDialogo(false)}
          aoCriar={() => {
            setDialogo(false);
            recarregar();
          }}
        />
      )}
    </Stack>
  );
}

function DialogoNovaSolicitacao({
  tipos,
  exames,
  aoFechar,
  aoCriar,
}: {
  tipos: TipoSolicitacaoPortal[];
  exames: ExamePortal[];
  aoFechar: () => void;
  aoCriar: () => void;
}) {
  const [tipoId, setTipoId] = useState(tipos[0]?.id ?? '');
  const [casoId, setCasoId] = useState('');
  const [descricao, setDescricao] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const tipo = tipos.find((t) => t.id === tipoId) ?? null;

  async function enviar() {
    setOcupado(true);
    setErro(null);
    try {
      await api.post('/portal/solicitacoes', { tipoId, casoId, descricao: descricao.trim() });
      aoCriar();
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível enviar a solicitação.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Dialog open onClose={aoFechar} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontSize: 17 }}>Nova solicitação</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField select label="O que você precisa" value={tipoId} onChange={(e) => setTipoId(e.target.value)}>
            {tipos.map((t) => (
              <MenuItem key={t.id} value={t.id}>
                {t.nome}
              </MenuItem>
            ))}
          </TextField>
          {tipo?.descricao && (
            <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: -1 }}>
              {tipo.descricao}
            </Typography>
          )}

          <TextField
            select
            label="Exame"
            value={casoId}
            onChange={(e) => setCasoId(e.target.value)}
            helperText="Sobre qual exame é o pedido."
          >
            {exames.map((e) => (
              <MenuItem key={e.id} value={e.id}>
                {e.identificador} · {e.paciente}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            label="Detalhe"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            multiline
            minRows={3}
            required
            helperText="O que precisa ser feito e para quando, se houver prazo."
          />

          <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
            Você acompanha a fase do pedido por esta tela — não é preciso mandar mensagem para saber
            em que pé está.
          </Typography>

          {erro && <Alert severity="error">{erro}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={aoFechar} disabled={ocupado}>
          Cancelar
        </Button>
        <Button
          variant="contained"
          onClick={() => void enviar()}
          disabled={ocupado || !tipoId || !casoId || !descricao.trim()}
        >
          {ocupado ? 'Enviando…' : 'Enviar'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

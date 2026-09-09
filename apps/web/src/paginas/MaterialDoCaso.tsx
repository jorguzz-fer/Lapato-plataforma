import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import {
  LATERALIDADE,
  MARGEM_CIRURGICA,
  MARGEM_CIRURGICA_LABEL,
  type Lateralidade,
  type MargemCirurgica,
} from '@lapato/shared';
import { api, ErroApi, type Dossie as DadosDossie } from '../api';

const LATERALIDADE_LABEL: Record<Lateralidade, string> = {
  direito: 'Direito',
  esquerdo: 'Esquerdo',
  bilateral: 'Bilateral',
  nao_aplicavel: 'Não se aplica',
};

interface Termo {
  id: string;
  valor: string;
}

/**
 * Terceira revisao com o Hugo: "inseri so um frasco, eram dois, e nao achei
 * onde editar depois". Amostras e recipientes mudam ate o laudo ser liberado;
 * cada mudanca fica na auditoria e na linha do tempo, com quem fez.
 */
export function DialogoAmostra({
  dossie,
  amostra,
  aoFechar,
  aoMudar,
}: {
  dossie: DadosDossie;
  /** Ausente: inclui uma amostra nova. */
  amostra?: DadosDossie['amostras'][number];
  aoFechar: () => void;
  aoMudar: () => void;
}) {
  const [descricao, setDescricao] = useState(amostra?.descricao ?? '');
  const [margem, setMargem] = useState<MargemCirurgica>(
    (amostra?.margemCirurgica as MargemCirurgica | undefined) ?? 'sem_margem',
  );
  const [lateralidade, setLateralidade] = useState<Lateralidade>(
    (amostra?.lateralidade as Lateralidade | undefined) ?? 'nao_aplicavel',
  );
  const [recipienteId, setRecipienteId] = useState(amostra?.recipienteId ?? dossie.recipientes[0]?.id ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function salvar() {
    setOcupado(true);
    setErro(null);
    const corpo = {
      descricao: descricao.trim() || null,
      margemCirurgica: margem,
      lateralidade,
      recipienteId: recipienteId || null,
    };
    try {
      if (amostra) await api.post(`/casos/amostras/${amostra.id}`, corpo);
      else await api.post(`/casos/${dossie.caso.id}/amostras`, corpo);
      aoFechar();
      aoMudar();
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível salvar a amostra.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Dialog open onClose={aoFechar} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontSize: 16 }}>
        {amostra ? `Corrigir amostra ${amostra.identificador}` : 'Incluir amostra'}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
            Vale até o laudo ser liberado. Fica na auditoria e na linha do tempo, com quem fez.
          </Typography>
          <TextField label="Descrição" value={descricao} onChange={(e) => setDescricao(e.target.value)} autoFocus />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              select
              label="Margem cirúrgica"
              value={margem}
              onChange={(e) => setMargem(e.target.value as MargemCirurgica)}
              sx={{ flex: 1 }}
              helperText="Cobrada à parte; a macroscopia só avalia margem quando há."
            >
              {MARGEM_CIRURGICA.map((m) => (
                <MenuItem key={m} value={m}>
                  {MARGEM_CIRURGICA_LABEL[m]}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Lateralidade"
              value={lateralidade}
              onChange={(e) => setLateralidade(e.target.value as Lateralidade)}
              sx={{ flex: 1 }}
              helperText=" "
            >
              {LATERALIDADE.map((l) => (
                <MenuItem key={l} value={l}>
                  {LATERALIDADE_LABEL[l]}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <TextField
            select
            label="Recipiente"
            value={recipienteId}
            onChange={(e) => setRecipienteId(e.target.value)}
            helperText="Em qual pote a amostra veio."
          >
            <MenuItem value="">—</MenuItem>
            {dossie.recipientes.map((r) => (
              <MenuItem key={r.id} value={r.id}>
                {r.identificador.slice(r.identificador.lastIndexOf('-') + 1)}
                {r.identificacaoExterna ? ` · ${r.identificacaoExterna}` : ''}
              </MenuItem>
            ))}
          </TextField>
          {erro && <Alert severity="error">{erro}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={aoFechar} disabled={ocupado}>
          Cancelar
        </Button>
        <Button variant="contained" onClick={() => void salvar()} disabled={ocupado}>
          {ocupado ? 'Salvando…' : amostra ? 'Salvar correção' : 'Incluir'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function DialogoRecipiente({
  dossie,
  recipiente,
  aoFechar,
  aoMudar,
}: {
  dossie: DadosDossie;
  /** Ausente: inclui um recipiente novo. */
  recipiente?: DadosDossie['recipientes'][number];
  aoFechar: () => void;
  aoMudar: () => void;
}) {
  const [tipos, setTipos] = useState<Termo[]>([]);
  const [fixadores, setFixadores] = useState<Termo[]>([]);
  const [tipoId, setTipoId] = useState(recipiente?.tipoId ?? '');
  const [fixadorId, setFixadorId] = useState(recipiente?.fixadorId ?? '');
  const [identificacaoExterna, setIdentificacaoExterna] = useState(recipiente?.identificacaoExterna ?? '');
  const [quantidade, setQuantidade] = useState(String(recipiente?.quantidadeDeclarada ?? 1));
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const novo = !recipiente;
  useEffect(() => {
    void Promise.all([
      api.get<Termo[]>('/catalogo/tabelas/recipiente').then(setTipos),
      api.get<Termo[]>('/catalogo/tabelas/fixador').then((lista) => {
        setFixadores(lista);
        // Novo recipiente nasce com Formol 10%, como no cadastro.
        if (novo) {
          const padrao = lista.find((t) => /formol\s*10\s*%/i.test(t.valor));
          if (padrao) setFixadorId((atual) => atual || padrao.id);
        }
      }),
    ]).catch(() => undefined);
  }, [novo]);

  async function salvar() {
    setOcupado(true);
    setErro(null);
    const corpo = {
      tipoId: tipoId || null,
      fixadorId: fixadorId || null,
      identificacaoExterna: identificacaoExterna.trim() || null,
      ...(Number(quantidade) > 0 ? { quantidadeDeclarada: Number(quantidade) } : {}),
    };
    try {
      if (recipiente) await api.post(`/casos/recipientes/${recipiente.id}`, corpo);
      else await api.post(`/casos/${dossie.caso.id}/recipientes`, corpo);
      aoFechar();
      aoMudar();
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível salvar o recipiente.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Dialog open onClose={aoFechar} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontSize: 16 }}>
        {recipiente ? `Corrigir recipiente ${recipiente.identificador}` : 'Incluir recipiente'}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
            A quantidade aqui é a declarada; a recebida continua sendo a da conferência. Fica na auditoria e na linha do tempo.
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField select label="Tipo" value={tipoId} onChange={(e) => setTipoId(e.target.value)} sx={{ flex: 1 }}>
              <MenuItem value="">—</MenuItem>
              {tipos.map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.valor}
                </MenuItem>
              ))}
            </TextField>
            <TextField select label="Fixador" value={fixadorId} onChange={(e) => setFixadorId(e.target.value)} sx={{ flex: 1 }}>
              <MenuItem value="">—</MenuItem>
              {fixadores.map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.valor}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Identificação externa"
              value={identificacaoExterna}
              onChange={(e) => setIdentificacaoExterna(e.target.value)}
              sx={{ flex: 2 }}
              helperText="Como veio rotulado pelo solicitante"
            />
            <TextField
              label="Qtd. declarada"
              type="number"
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value)}
              slotProps={{ htmlInput: { min: 1 } }}
              sx={{ width: { xs: '100%', sm: 140 } }}
            />
          </Stack>
          {erro && <Alert severity="error">{erro}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={aoFechar} disabled={ocupado}>
          Cancelar
        </Button>
        <Button variant="contained" onClick={() => void salvar()} disabled={ocupado}>
          {ocupado ? 'Salvando…' : recipiente ? 'Salvar correção' : 'Incluir'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

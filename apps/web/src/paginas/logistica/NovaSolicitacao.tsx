import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import {
  CANAL_ORIGEM_LOGISTICO,
  CANAL_ORIGEM_LOGISTICO_LABEL,
  CONSERVACAO_LOGISTICA,
  CONSERVACAO_LOGISTICA_LABEL,
  PRIORIDADE_LOGISTICA,
  PRIORIDADE_LOGISTICA_LABEL,
  REQUISITO_ESPECIAL_LOGISTICO,
  REQUISITO_ESPECIAL_LOGISTICO_LABEL,
  TIPO_OPERACAO_LOGISTICA,
  TIPO_OPERACAO_LOGISTICA_LABEL,
  type RequisitoEspecialLogistico,
  type TipoServicoLogistico,
} from '@lapato/shared';
import { api, ErroApi } from '../../api';

interface ClienteCatalogo {
  id: string;
  nomeFantasia: string;
  endereco?: string | null;
}

/**
 * Abrir a solicitacao (M19 secoes 12 a 24; 136 e 139).
 *
 * RETIRADA ou ENTREGA e a primeira escolha, porque decide o resto (secao 136).
 * O cliente vem do M03 e o endereco e COPIADO para a operacao: corrigir o
 * cadastro amanha nao muda onde o encarregado esteve hoje (secao 15).
 */
export function NovaSolicitacao({
  aberto,
  aoFechar,
  aoSalvar,
}: {
  aberto: boolean;
  aoFechar: () => void;
  aoSalvar: (id: string) => void;
}) {
  const [clientes, setClientes] = useState<ClienteCatalogo[]>([]);
  const [tipoServico, setTipoServico] = useState<TipoServicoLogistico>('retirada');
  const [f, setF] = useState({
    clienteId: '',
    tipoOperacao: 'coleta_amostras',
    canalOrigem: 'telefone',
    endereco: '',
    pontoReferencia: '',
    contatoNoLocal: '',
    telefoneContato: '',
    dataDesejada: '',
    janelaInicio: '',
    janelaFim: '',
    volumesEstimados: '',
    tipoMaterial: '',
    conservacao: '',
    prioridade: 'rotina',
    observacoes: '',
    valorReais: '',
  });
  const [requisitos, setRequisitos] = useState<RequisitoEspecialLogistico[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    api
      .get<ClienteCatalogo[]>('/catalogo/clientes')
      .then(setClientes)
      .catch(() => setClientes([]));
  }, [aberto]);

  const campo = (k: keyof typeof f) => ({
    value: f[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value }),
  });

  async function salvar() {
    setOcupado(true);
    setErro(null);
    try {
      const r = await api.post<{ id: string }>('/logistica/solicitacoes', {
        tipoServico,
        tipoOperacao: f.tipoOperacao,
        canalOrigem: f.canalOrigem,
        clienteId: f.clienteId,
        endereco: f.endereco,
        pontoReferencia: f.pontoReferencia || null,
        contatoNoLocal: f.contatoNoLocal || null,
        telefoneContato: f.telefoneContato || null,
        dataDesejada: f.dataDesejada ? new Date(f.dataDesejada).toISOString() : null,
        janelaInicio: f.janelaInicio || null,
        janelaFim: f.janelaFim || null,
        volumesEstimados: f.volumesEstimados ? Number(f.volumesEstimados) : null,
        tipoMaterial: f.tipoMaterial || null,
        conservacao: f.conservacao || null,
        requisitosEspeciais: requisitos,
        prioridade: f.prioridade,
        observacoes: f.observacoes || null,
        valorCentavos: f.valorReais ? Math.round(Number(f.valorReais.replace(',', '.')) * 100) : null,
      });
      aoSalvar(r.id);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.detalhe : 'Não foi possível abrir a solicitação.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Dialog open={aberto} fullWidth maxWidth="sm" onClose={aoFechar}>
      <DialogTitle>Nova solicitação</DialogTitle>
      <DialogContent dividers>
        {erro && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {erro}
          </Alert>
        )}
        <Stack spacing={1.5}>
          <ToggleButtonGroup
            exclusive
            fullWidth
            value={tipoServico}
            onChange={(_, v: TipoServicoLogistico | null) => v && setTipoServico(v)}
          >
            <ToggleButton value="retirada">Retirada (buscar no cliente)</ToggleButton>
            <ToggleButton value="entrega">Entrega (levar ao cliente)</ToggleButton>
          </ToggleButtonGroup>

          <TextField
            select
            size="small"
            label="Cliente"
            value={f.clienteId}
            onChange={(e) => {
              const c = clientes.find((x) => x.id === e.target.value);
              setF({ ...f, clienteId: e.target.value, endereco: f.endereco || c?.endereco || '' });
            }}
          >
            {clientes.map((c) => (
              <MenuItem key={c.id} value={c.id}>
                {c.nomeFantasia}
              </MenuItem>
            ))}
          </TextField>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField select size="small" label="Operação" sx={{ flex: 1 }} {...campo('tipoOperacao')}>
              {TIPO_OPERACAO_LOGISTICA.map((t) => (
                <MenuItem key={t} value={t}>
                  {TIPO_OPERACAO_LOGISTICA_LABEL[t]}
                </MenuItem>
              ))}
            </TextField>
            <TextField select size="small" label="Canal de origem" sx={{ flex: 1 }} {...campo('canalOrigem')}>
              {CANAL_ORIGEM_LOGISTICO.map((t) => (
                <MenuItem key={t} value={t}>
                  {CANAL_ORIGEM_LOGISTICO_LABEL[t]}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <TextField size="small" label="Endereço da operação" required {...campo('endereco')} />
          <TextField size="small" label="Ponto de referência" {...campo('pontoReferencia')} />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField size="small" label="Contato no local" sx={{ flex: 1 }} {...campo('contatoNoLocal')} />
            <TextField size="small" label="Telefone" sx={{ flex: 1 }} {...campo('telefoneContato')} />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField size="small" type="date" label="Data desejada" slotProps={{ inputLabel: { shrink: true } }} sx={{ flex: 1 }} {...campo('dataDesejada')} />
            <TextField size="small" label="Janela início" placeholder="13:00" sx={{ flex: 1 }} {...campo('janelaInicio')} />
            <TextField size="small" label="Janela fim" placeholder="16:00" sx={{ flex: 1 }} {...campo('janelaFim')} />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField size="small" type="number" label="Volumes estimados" sx={{ flex: 1 }} {...campo('volumesEstimados')} />
            <TextField size="small" label="Tipo de material" placeholder="Frascos com biópsias" sx={{ flex: 2 }} {...campo('tipoMaterial')} />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField select size="small" label="Conservação" sx={{ flex: 1 }} {...campo('conservacao')}>
              <MenuItem value="">Não informada</MenuItem>
              {CONSERVACAO_LOGISTICA.map((t) => (
                <MenuItem key={t} value={t}>
                  {CONSERVACAO_LOGISTICA_LABEL[t]}
                </MenuItem>
              ))}
            </TextField>
            <TextField select size="small" label="Prioridade logística" sx={{ flex: 1 }} {...campo('prioridade')}>
              {PRIORIDADE_LOGISTICA.map((t) => (
                <MenuItem key={t} value={t}>
                  {PRIORIDADE_LOGISTICA_LABEL[t]}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <div>
            <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.5 }}>Requisitos especiais</Typography>
            <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
              {REQUISITO_ESPECIAL_LOGISTICO.map((r) => (
                <Chip
                  key={r}
                  size="small"
                  label={REQUISITO_ESPECIAL_LOGISTICO_LABEL[r]}
                  color={requisitos.includes(r) ? 'warning' : 'default'}
                  variant={requisitos.includes(r) ? 'filled' : 'outlined'}
                  onClick={() =>
                    setRequisitos((a) => (a.includes(r) ? a.filter((x) => x !== r) : [...a, r]))
                  }
                />
              ))}
            </Stack>
          </div>
          <TextField
            size="small"
            label="Valor do serviço para o encarregado (R$)"
            helperText="Mostrado antes do aceite (§148). A regra de cálculo é do Financeiro."
            {...campo('valorReais')}
          />
          <TextField size="small" label="Observações" multiline {...campo('observacoes')} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={aoFechar}>Cancelar</Button>
        <Button variant="contained" disabled={ocupado || !f.clienteId || !f.endereco.trim()} onClick={() => void salvar()}>
          Abrir solicitação
        </Button>
      </DialogActions>
    </Dialog>
  );
}

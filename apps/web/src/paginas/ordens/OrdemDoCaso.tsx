import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddOutlined from '@mui/icons-material/AddOutlined';
import {
  ORDEM_EDITAVEL,
  ORIGEM_FATURAVEL_LABEL,
  STATUS_ORDEM_LABEL,
  formatarReais,
  totalDoItem,
  type OrigemFaturavel,
  type StatusOrdemServico,
} from '@lapato/shared';
import { api, ErroApi, type Servico } from '../../api';

/**
 * M20 (parcial) - a OS do caso, como o laboratorio a descreveu nas reviews:
 * nasce na conferencia do recebimento, fica FATURAVEL ao concluir a
 * macroscopia (ou na entrada, para servico sem macroscopia), e segue
 * recebendo itens ate entrar numa fatura - coloracao, margem, nova amostra
 * pedidas depois de "finalizado" sao rotina. Conferir e despachar sao marcos
 * operacionais, nao portoes de cobranca.
 */

interface ItemOrdem {
  id: string;
  servicoId: string | null;
  descricao: string;
  quantidade: string;
  valorUnitario: string;
  descontoPercentual: string;
  /** Recorte: consta na OS com valor zero, nunca na fatura. */
  retrabalho: boolean;
}

interface Ordem {
  id: string;
  identificador: string;
  status: StatusOrdemServico;
  observacoes: string | null;
  criadoEm: string;
  faturavelEm: string | null;
  faturavelOrigem: OrigemFaturavel | null;
  conferidaEm: string | null;
  despachadaEm: string | null;
  motivoCancelamento: string | null;
  clienteNome: string;
  itens: ItemOrdem[];
  total: number;
}

const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };

const COR_STATUS: Record<StatusOrdemServico, 'default' | 'info' | 'success' | 'warning' | 'error'> =
  {
    aberta: 'info',
    conferida: 'warning',
    despachada: 'success',
    faturada: 'success',
    cancelada: 'default',
  };

export function OrdemDoCaso({ casoId, permissoes }: { casoId: string; permissoes: string[] }) {
  const [ordem, setOrdem] = useState<Ordem | null>(null);
  const [carregado, setCarregado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [adicionando, setAdicionando] = useState(false);
  const [emEdicao, setEmEdicao] = useState<ItemOrdem | null>(null);
  const [cancelando, setCancelando] = useState(false);
  const [motivo, setMotivo] = useState('');

  const podeEditar = permissoes.includes('os:editar');
  const podeConferir = permissoes.includes('os:conferir');

  const carregar = useCallback(() => {
    api
      .get<Ordem | null>(`/ordens/casos/${casoId}`)
      .then(setOrdem)
      .catch(() => setErro('Não foi possível carregar a Ordem de Serviço.'))
      .finally(() => setCarregado(true));
  }, [casoId]);

  useEffect(carregar, [carregar]);

  async function agir(fn: () => Promise<unknown>, mensagem: string) {
    setOcupado(true);
    setErro(null);
    try {
      await fn();
      carregar();
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : mensagem);
    } finally {
      setOcupado(false);
    }
  }

  if (!carregado) return <Skeleton variant="rounded" height={180} />;

  if (!ordem) {
    return (
      <Card sx={{ p: 2.5 }}>
        <Typography sx={{ fontSize: 13.5, color: 'text.secondary' }}>
          Este caso ainda não tem Ordem de Serviço — ela nasce automaticamente na conferência do
          recebimento.
        </Typography>
      </Card>
    );
  }

  const editavel = ORDEM_EDITAVEL.includes(ordem.status) && podeEditar;
  const temItemSemValor = ordem.itens.some(
    (i) => !i.retrabalho && Number(i.valorUnitario) === 0,
  );

  return (
    <Card sx={{ p: 2.5 }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 1.5 }}>
        <Typography sx={{ ...MONO, fontSize: 15, fontWeight: 700, color: 'primary.main' }}>
          {ordem.identificador}
        </Typography>
        <Chip
          size="small"
          color={COR_STATUS[ordem.status]}
          label={STATUS_ORDEM_LABEL[ordem.status]}
        />
        <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
          {ordem.clienteNome}
        </Typography>
      </Stack>

      {/* O portao da fatura, dito na tela: quem fatura precisa saber se ja pode. */}
      {ordem.status !== 'cancelada' && ordem.status !== 'faturada' && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.5 }}>
          <Chip
            size="small"
            color={ordem.faturavelEm ? 'success' : 'default'}
            variant={ordem.faturavelEm ? 'filled' : 'outlined'}
            label={ordem.faturavelEm ? 'Faturável' : 'Ainda não faturável'}
          />
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
            {ordem.faturavelEm
              ? `desde ${new Date(ordem.faturavelEm).toLocaleDateString('pt-BR')}` +
                (ordem.faturavelOrigem ? `, ${ORIGEM_FATURAVEL_LABEL[ordem.faturavelOrigem]}` : '')
              : 'Fica faturável ao concluir a macroscopia — só ali se sabe quantas peças são.'}
          </Typography>
        </Stack>
      )}

      {erro && (
        <Alert severity="error" sx={{ mb: 1.5 }}>
          {erro}
        </Alert>
      )}

      {ordem.motivoCancelamento && (
        <Alert severity="warning" sx={{ mb: 1.5 }}>
          Cancelada: {ordem.motivoCancelamento}
        </Alert>
      )}

      {temItemSemValor && editavel && (
        <Alert severity="warning" sx={{ mb: 1.5 }}>
          Há item com valor zerado — o serviço não tem preço cadastrado. Defina o valor antes da
          fatura.
        </Alert>
      )}

      <Stack divider={<Divider flexItem />} spacing={1}>
        {ordem.itens.map((item) => (
          <Stack
            key={item.id}
            direction="row"
            spacing={2}
            sx={{ alignItems: 'center', justifyContent: 'space-between' }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>{item.descricao}</Typography>
                {item.retrabalho && (
                  <Chip size="small" variant="outlined" color="warning" label="Retrabalho — não cobrado" />
                )}
              </Stack>
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                {Number(item.quantidade)} × {formatarReais(item.valorUnitario)}
                {Number(item.descontoPercentual) > 0
                  ? ` − ${Number(item.descontoPercentual)}%`
                  : ''}
              </Typography>
            </Box>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexShrink: 0 }}>
              <Typography sx={{ ...MONO, fontSize: 13.5 }}>
                {formatarReais(totalDoItem(item))}
              </Typography>
              {editavel && !item.retrabalho && (
                <Button size="small" onClick={() => setEmEdicao(item)}>
                  Editar
                </Button>
              )}
            </Stack>
          </Stack>
        ))}
      </Stack>

      <Divider sx={{ my: 1.5 }} />

      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>Total</Typography>
        <Typography sx={{ ...MONO, fontSize: 16, fontWeight: 700 }}>
          {formatarReais(ordem.total)}
        </Typography>
      </Stack>

      <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap' }}>
        {editavel && (
          <Button size="small" startIcon={<AddOutlined />} onClick={() => setAdicionando(true)}>
            Adicionar item
          </Button>
        )}
        {podeConferir && ordem.status === 'aberta' && (
          <Button
            size="small"
            variant="contained"
            disabled={ocupado}
            onClick={() =>
              void agir(
                () => api.post(`/ordens/${ordem.id}/conferencia`, {}),
                'Não foi possível conferir.',
              )
            }
          >
            Conferir saída
          </Button>
        )}
        {podeConferir && ordem.status === 'conferida' && (
          <Button
            size="small"
            variant="contained"
            disabled={ocupado}
            onClick={() =>
              void agir(
                () => api.post(`/ordens/${ordem.id}/despacho`, {}),
                'Não foi possível despachar.',
              )
            }
          >
            Despachar
          </Button>
        )}
        {podeEditar && (ordem.status === 'aberta' || ordem.status === 'conferida') && (
          <Button size="small" color="error" onClick={() => setCancelando(true)}>
            Cancelar OS
          </Button>
        )}
      </Stack>

      {adicionando && (
        <DialogoNovoItem
          ordemId={ordem.id}
          aoFechar={() => setAdicionando(false)}
          aoSalvar={() => {
            setAdicionando(false);
            carregar();
          }}
        />
      )}

      {emEdicao && (
        <DialogoEditarItem
          ordemId={ordem.id}
          item={emEdicao}
          aoFechar={() => setEmEdicao(null)}
          aoSalvar={() => {
            setEmEdicao(null);
            carregar();
          }}
        />
      )}

      <Dialog open={cancelando} onClose={() => setCancelando(false)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontSize: 16 }}>Cancelar {ordem.identificador}</DialogTitle>
        <DialogContent>
          <TextField
            label="Motivo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            fullWidth
            multiline
            minRows={2}
            sx={{ mt: 1 }}
            helperText="Obrigatório: cancelamento é decisão com responsável e motivo."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCancelando(false)}>Voltar</Button>
          <Button
            color="error"
            variant="contained"
            disabled={ocupado || motivo.trim() === ''}
            onClick={() =>
              void agir(async () => {
                await api.post(`/ordens/${ordem.id}/cancelamento`, { motivo: motivo.trim() });
                setCancelando(false);
              }, 'Não foi possível cancelar.')
            }
          >
            Cancelar OS
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}

function DialogoNovoItem({
  ordemId,
  aoFechar,
  aoSalvar,
}: {
  ordemId: string;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [servicoId, setServicoId] = useState('');
  const [descricao, setDescricao] = useState('');
  const [quantidade, setQuantidade] = useState('1');
  const [valor, setValor] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    api
      .get<Servico[]>('/catalogo/servicos')
      .then(setServicos)
      .catch(() => setServicos([]));
  }, []);

  const avulso = servicoId === '';

  async function salvar() {
    setOcupado(true);
    setErro(null);
    try {
      await api.post(`/ordens/${ordemId}/itens`, {
        ...(avulso ? {} : { servicoId }),
        ...(descricao.trim() ? { descricao: descricao.trim() } : {}),
        quantidade: Number(quantidade.replace(',', '.')) || 1,
        // Sem valor explicito, o servico entra pelo acordo do cliente ou tabela padrao.
        ...(valor.trim() ? { valorUnitario: Number(valor.replace(',', '.')) } : {}),
      });
      aoSalvar();
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível adicionar o item.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Dialog open onClose={aoFechar} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontSize: 16 }}>Adicionar item</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {erro && <Alert severity="error">{erro}</Alert>}
          <TextField
            select
            label="Serviço"
            value={servicoId}
            onChange={(e) => setServicoId(e.target.value)}
            helperText="Sem serviço = item avulso, criado na hora (descrição e valor próprios)."
          >
            <MenuItem value="">Item avulso</MenuItem>
            {servicos.map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {s.nome}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label={avulso ? 'Descrição' : 'Descrição (opcional)'}
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
          />
          <Stack direction="row" spacing={2}>
            <TextField
              label="Quantidade"
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value)}
              sx={{ flex: 1 }}
            />
            <TextField
              label={avulso ? 'Valor unitário (R$)' : 'Valor (R$, opcional)'}
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              sx={{ flex: 1 }}
              helperText={avulso ? '' : 'Vazio = acordo do cliente ou tabela padrão.'}
            />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={aoFechar} disabled={ocupado}>
          Cancelar
        </Button>
        <Button
          variant="contained"
          disabled={ocupado || (avulso && (!descricao.trim() || !valor.trim()))}
          onClick={() => void salvar()}
        >
          Adicionar
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function DialogoEditarItem({
  ordemId,
  item,
  aoFechar,
  aoSalvar,
}: {
  ordemId: string;
  item: ItemOrdem;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [descricao, setDescricao] = useState(item.descricao);
  const [quantidade, setQuantidade] = useState(String(Number(item.quantidade)));
  const [valor, setValor] = useState(String(Number(item.valorUnitario)));
  const [desconto, setDesconto] = useState(String(Number(item.descontoPercentual)));
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function agir(fn: () => Promise<unknown>, mensagem: string) {
    setOcupado(true);
    setErro(null);
    try {
      await fn();
      aoSalvar();
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : mensagem);
      setOcupado(false);
    }
  }

  return (
    <Dialog open onClose={aoFechar} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontSize: 16 }}>Editar item</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {erro && <Alert severity="error">{erro}</Alert>}
          <TextField
            label="Descrição"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
          />
          <Stack direction="row" spacing={2}>
            <TextField
              label="Quantidade"
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value)}
              sx={{ flex: 1 }}
            />
            <TextField
              label="Valor (R$)"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              sx={{ flex: 1 }}
            />
            <TextField
              label="Desconto %"
              value={desconto}
              onChange={(e) => setDesconto(e.target.value)}
              sx={{ flex: 1 }}
            />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between', px: 3 }}>
        <Button
          color="error"
          disabled={ocupado}
          onClick={() =>
            void agir(
              () => api.post(`/ordens/${ordemId}/itens/${item.id}/remocao`, {}),
              'Não foi possível remover.',
            )
          }
        >
          Remover
        </Button>
        <Stack direction="row" spacing={1}>
          <Button onClick={aoFechar} disabled={ocupado}>
            Cancelar
          </Button>
          <Button
            variant="contained"
            disabled={ocupado || !descricao.trim()}
            onClick={() =>
              void agir(
                () =>
                  api.post(`/ordens/${ordemId}/itens/${item.id}`, {
                    descricao: descricao.trim(),
                    quantidade: Number(quantidade.replace(',', '.')) || 1,
                    valorUnitario: Number(valor.replace(',', '.')) || 0,
                    descontoPercentual: Number(desconto.replace(',', '.')) || 0,
                  }),
                'Não foi possível salvar.',
              )
            }
          >
            Salvar
          </Button>
        </Stack>
      </DialogActions>
    </Dialog>
  );
}

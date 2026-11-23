import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutlineOutlined';
import { RESSALVAS_RECEBIMENTO, RESSALVA_RECEBIMENTO_LABEL } from '@lapato/shared';
import {
  api,
  ErroApi,
  type Dossie as DadosDossie,
  type MembroEquipe,
} from '../api';
import { AjudaBiblioteca } from '../componentes/AjudaBiblioteca';
import { GaleriaDoCaso } from './imagens/GaleriaDoCaso';

/**
 * M05 - Recebimento fisico do material.
 *
 * O modulo separa quatro momentos: **Solicitado, Cadastrado, Recebido e
 * Triado**. Esta tela registra o terceiro, e a distincao nao e burocratica:
 * o que foi declarado pelo solicitante e o que chegou na bancada podem
 * divergir, e essa divergencia e **dado do caso** - vira evento
 * `divergencia.identificada` e fica na linha do tempo. Nao e erro a corrigir.
 *
 * Por isso o campo de quantidade recebida **nasce vazio**. Preenche-lo com o
 * valor declarado transformaria a conferencia em clicar em salvar, e a
 * divergencia que o M05 existe para capturar nunca apareceria. Quem contou
 * precisa digitar o que contou.
 */

const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };

export function Recebimento({ permissoes }: { permissoes: string[] }) {
  const { id } = useParams<{ id: string }>();
  const navegar = useNavigate();

  const [dados, setDados] = useState<DadosDossie | null>(null);
  const [contagem, setContagem] = useState<Record<string, string>>({});
  /** Documento do Hugo: fragmentos por pote ('' | 'multiplos' | numero) e ressalva. */
  const [fragmentos, setFragmentos] = useState<Record<string, string>>({});
  const [ressalva, setRessalva] = useState<Record<string, string>>({});
  const [ressalvaDetalhe, setRessalvaDetalhe] = useState<Record<string, string>>({});
  /** Citologia (quinta revisão): a conferência aqui é de lâminas, não de fragmentos. */
  const [laminas, setLaminas] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [dialogo, setDialogo] = useState<'pendencia' | 'ressalva' | null>(null);

  useEffect(() => {
    if (id) {
      api
        .get<DadosDossie>(`/casos/${id}`)
        .then(setDados)
        .catch(() => setErro('Não foi possível carregar o caso.'));
    }
  }, [id]);

  const recipientes = dados?.recipientes ?? [];
  /** Citologia: sem macroscopia, o que se confere é quantas lâminas vieram. */
  const citologia = dados ? !dados.servico.exigeMacroscopia : false;

  const todosPreenchidos = useMemo(
    () => recipientes.length > 0 && recipientes.every((r) => contagem[r.id]?.trim() !== undefined && contagem[r.id]?.trim() !== ''),
    [recipientes, contagem],
  );

  const divergencias = useMemo(
    () =>
      recipientes.filter((r) => {
        const informado = contagem[r.id];
        if (informado === undefined || informado.trim() === '') return false;
        return r.quantidadeDeclarada !== null && Number(informado) !== r.quantidadeDeclarada;
      }),
    [recipientes, contagem],
  );

  async function submeter(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);

    try {
      await api.post(`/casos/${id}/recebimento`, {
        conferencia: recipientes.map((r) => {
          const frag = (fragmentos[r.id] ?? '').trim();
          return {
            recipienteId: r.id,
            quantidadeRecebida: Number(contagem[r.id]),
            fragmentosMultiplos: frag === 'multiplos',
            ...(frag && frag !== 'multiplos' ? { fragmentosRecebidos: Number(frag) } : {}),
            ...(ressalva[r.id] ? { ressalva: ressalva[r.id] } : {}),
            ...(ressalva[r.id] && (ressalvaDetalhe[r.id] ?? '').trim()
              ? { ressalvaDetalhe: (ressalvaDetalhe[r.id] ?? '').trim() }
              : {}),
            ...(citologia && (laminas[r.id] ?? '').trim() !== ''
              ? { laminasRecebidas: Number(laminas[r.id]) }
              : {}),
          };
        }),
      });
      navegar(`/casos/${id}`);
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível registrar o recebimento.');
      setEnviando(false);
    }
  }

  if (!dados) {
    return erro ? (
      <Alert severity="error">{erro}</Alert>
    ) : (
      <Stack spacing={2} sx={{ maxWidth: 760 }}>
        <Skeleton variant="rounded" height={70} />
        <Skeleton variant="rounded" height={260} />
      </Stack>
    );
  }

  /**
   * Recebimento acontece uma vez. Mostrar o estado em vez do formulario evita
   * que alguem preencha tudo para colher um 400 no final.
   */
  if (dados.caso.recebidoEm) {
    return (
      <Box sx={{ maxWidth: 760 }}>
        <Alert
          severity="success"
          icon={<CheckCircleOutline />}
          action={
            <Button size="small" onClick={() => navegar(`/casos/${id}`)}>
              Abrir dossiê
            </Button>
          }
        >
          <AlertTitle>Material já recebido</AlertTitle>
          O recebimento de {dados.caso.identificador} foi registrado em{' '}
          {new Date(dados.caso.recebidoEm).toLocaleString('pt-BR')}.
        </Alert>
      </Box>
    );
  }

  return (
    <Box component="form" onSubmit={submeter} noValidate sx={{ maxWidth: 760 }}>
      <Stack direction="row" sx={{ mb: 0.5, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h2">Recebimento</Typography>
        <AjudaBiblioteca contexto="recebimento" permissoes={permissoes} />
      </Stack>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 3 }}>
        Conte o que chegou e registre o número encontrado. Divergência não é erro: fica no caso.
      </Typography>

      <Card sx={{ p: 2.5, mb: 2.5 }}>
        <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <Typography sx={{ ...MONO, fontSize: 16, fontWeight: 700 }}>
            {dados.caso.identificador}
          </Typography>
          <Box>
            <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>Paciente</Typography>
            <Typography sx={{ fontSize: 13.5 }}>{dados.paciente.nome}</Typography>
          </Box>
          <Box>
            <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>Cliente</Typography>
            <Typography sx={{ fontSize: 13.5 }}>{dados.cliente.nomeFantasia}</Typography>
          </Box>
        </Stack>
      </Card>

      <Card sx={{ p: 2.5 }}>
        <Typography variant="h4" sx={{ mb: 0.25 }}>
          Conferência
        </Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
          O campo nasce vazio de propósito — quem contou digita o que contou.
        </Typography>

        <Divider sx={{ my: 2.5 }} />

        <Stack spacing={{ xs: 3, sm: 2.5 }} divider={<Divider flexItem />}>
          {recipientes.map((r) => {
            const informado = contagem[r.id] ?? '';
            const preenchido = informado.trim() !== '';
            const diverge =
              preenchido &&
              r.quantidadeDeclarada !== null &&
              Number(informado) !== r.quantidadeDeclarada;

            return (
              /**
               * Identificador de um lado, contagem do outro - em colunas de
               * verdade.
               *
               * Antes, a linha da contagem subia por margem negativa para se
               * alinhar ao identificador. Funcionava com identificador curto e
               * quebrava com um real: `01-000001/26-F01` empurrava o rótulo
               * "Declarado" para cima do próprio código. Layout que depende do
               * tamanho do conteúdo não é layout.
               */
              <Stack
                key={r.id}
                direction={{ xs: 'column', sm: 'row' }}
                spacing={{ xs: 1.5, sm: 2 }}
                useFlexGap
                // `wrap` + `flexBasis: 100%` na linha de fragmentos/ressalva: ela
                // desce para a segunda linha em vez de esticar a primeira.
                sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', flexWrap: 'wrap' }}
              >
                {/**
                  * Review: "esta faltando a descricao exata do que foi
                  * declarado". O que o cliente disse que mandou fica ao lado
                  * do identificador - e contra isso que se bate o que chegou.
                  */}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ ...MONO, fontSize: 13 }}>{r.identificador}</Typography>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                    {[r.tipo, r.fixador ? `em ${r.fixador}` : null, r.identificacaoExterna ? `ref. ${r.identificacaoExterna}` : null]
                      .filter(Boolean)
                      .join(' · ') || 'Recipiente sem tipo declarado'}
                  </Typography>
                  {(dados.amostras.filter((a) => a.recipienteId === r.id)).map((a) => (
                    <Typography key={a.id} sx={{ fontSize: 12.5, mt: 0.25 }}>
                      <Box component="span" sx={{ ...MONO, fontSize: 11.5, color: 'text.secondary' }}>
                        {a.letra}
                      </Box>{' '}
                      {a.descricao ?? 'sem descrição'}
                      {a.regiaoAnatomica ? ` — ${a.regiaoAnatomica}` : ''}
                      {a.lateralidade !== 'nao_aplicavel' ? ` (${a.lateralidade})` : ''}
                    </Typography>
                  ))}
                  {r.observacoes && (
                    <Typography sx={{ fontSize: 12, color: 'text.secondary', fontStyle: 'italic' }}>
                      {r.observacoes}
                    </Typography>
                  )}
                </Box>

                {/**
                  * Declarado e recebido lado a lado tambem no celular: e a
                  * comparacao que da sentido a tela, e empilha-los a
                  * transformaria em dois numeros soltos.
                  */}
                <Stack
                  direction="row"
                  spacing={2}
                  sx={{ alignItems: 'center', flexShrink: 0 }}
                >
                  <Box sx={{ width: { xs: 'auto', sm: 90 }, minWidth: 72 }}>
                    <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                      Declarado
                    </Typography>
                    <Typography sx={{ fontSize: 15, fontVariantNumeric: 'tabular-nums' }}>
                      {r.quantidadeDeclarada ?? '—'}
                    </Typography>
                  </Box>

                  <TextField
                    label="Recebido"
                    type="number"
                    value={informado}
                    onChange={(e) => setContagem((atual) => ({ ...atual, [r.id]: e.target.value }))}
                    required
                    sx={{ flex: { xs: 1, sm: 'none' }, width: { sm: 130 } }}
                    slotProps={{ htmlInput: { min: 0 } }}
                    color={diverge ? 'warning' : undefined}
                    focused={diverge || undefined}
                  />

                  <Box sx={{ width: { xs: 'auto', sm: 130 } }}>
                    {diverge && <Chip size="small" color="warning" label="▲ divergência" />}
                  </Box>
                </Stack>

                {/* Documento do Hugo: "muitas vezes uma amostra possui mais de 1
                    fragmento" e ressalvas a escolha, em dropdown. */}
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1.5}
                  sx={{ width: '100%', flexBasis: '100%' }}
                >
                  {citologia ? (
                    /* Na citologia a lâmina É o material: vieram duas e chegou
                       uma, metade do caso não será lida. */
                    <TextField
                      size="small"
                      type="number"
                      label="Lâminas recebidas"
                      value={laminas[r.id] ?? ''}
                      onChange={(e) => setLaminas((a) => ({ ...a, [r.id]: e.target.value }))}
                      sx={{ minWidth: 170 }}
                      slotProps={{ htmlInput: { min: 0 } }}
                      helperText={
                        r.laminasDeclaradas !== null
                          ? `Declaradas: ${r.laminasDeclaradas}`
                          : 'Não declarado'
                      }
                    />
                  ) : (
                    <TextField
                      select
                      size="small"
                      label="Fragmentos"
                      value={fragmentos[r.id] ?? ''}
                      onChange={(e) => setFragmentos((a) => ({ ...a, [r.id]: e.target.value }))}
                      sx={{ minWidth: 150 }}
                    >
                      <MenuItem value="">—</MenuItem>
                      <MenuItem value="multiplos">Múltiplos</MenuItem>
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                        <MenuItem key={n} value={String(n)}>
                          {n}
                        </MenuItem>
                      ))}
                    </TextField>
                  )}
                  <TextField
                    select
                    size="small"
                    label="Ressalva"
                    value={ressalva[r.id] ?? ''}
                    onChange={(e) => setRessalva((a) => ({ ...a, [r.id]: e.target.value }))}
                    sx={{ minWidth: 240 }}
                  >
                    <MenuItem value="">Sem ressalva</MenuItem>
                    {RESSALVAS_RECEBIMENTO.map((v) => (
                      <MenuItem key={v} value={v}>
                        {RESSALVA_RECEBIMENTO_LABEL[v]}
                      </MenuItem>
                    ))}
                  </TextField>
                  {ressalva[r.id] && (
                    <TextField
                      size="small"
                      label="Detalhe da ressalva"
                      value={ressalvaDetalhe[r.id] ?? ''}
                      onChange={(e) =>
                        setRessalvaDetalhe((a) => ({ ...a, [r.id]: e.target.value }))
                      }
                      sx={{ flex: 1 }}
                    />
                  )}
                </Stack>
              </Stack>
            );
          })}
        </Stack>
      </Card>

      {/* Documento do Hugo: fotos da requisição e dos potes, arquivadas para
          sempre e exibidas na macro e no laudo. Câmera ou upload. */}
      <Card sx={{ p: 2.5, mt: 2.5 }}>
        <Typography variant="h4" sx={{ mb: 0.25 }}>
          Fotos da requisição e dos potes
        </Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 2 }}>
          Ficam no dossiê e aparecem no cabeçalho da macroscopia e do laudo — é o que evita troca
          entre pacientes com o mesmo nome.
        </Typography>
        <GaleriaDoCaso
          casoId={id!}
          permissoes={permissoes}
          moduloContexto="M05_RECEBIMENTO"
          tipoPadrao="requisicao"
        />
      </Card>

      {/*
        Quinta revisão: os dois caminhos de quem abre o pote e vê algo que não
        bate — mandar para quem decide dentro de casa, ou perguntar ao cliente.
        Ficam aqui, na conferência, porque é onde a dúvida aparece; deixar para
        depois é como a amostra é esquecida.
      */}
      <Card sx={{ p: 2.5, mt: 2.5 }}>
        <Typography variant="h4" sx={{ mb: 0.25 }}>
          Em caso de discordância ou ressalva
        </Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 2 }}>
          Registrar aqui não interrompe o recebimento — ele segue, e a dúvida fica endereçada.
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <Button variant="outlined" onClick={() => setDialogo('pendencia')}>
            Gerar pendência de macroscopia
          </Button>
          <Button variant="outlined" onClick={() => setDialogo('ressalva')}>
            Enviar ressalva para o cliente
          </Button>
        </Stack>
      </Card>

      {dialogo === 'pendencia' && (
        <DialogoPendenciaMacroscopia
          casoId={id!}
          amostras={dados.amostras}
          aoFechar={() => setDialogo(null)}
        />
      )}
      {dialogo === 'ressalva' && (
        <DialogoRessalvaCliente
          casoId={id!}
          recipientes={recipientes}
          aoFechar={() => setDialogo(null)}
        />
      )}

      {divergencias.length > 0 && (
        <Alert severity="warning" sx={{ mt: 2.5 }}>
          <AlertTitle>
            {divergencias.length === 1
              ? '1 recipiente com divergência'
              : `${divergencias.length} recipientes com divergência`}
          </AlertTitle>
          O recebimento segue normalmente. Cada divergência vira um evento na linha do tempo do
          caso, com o declarado e o recebido lado a lado.
        </Alert>
      )}

      {erro && (
        <Alert severity="error" sx={{ mt: 2.5 }}>
          {erro}
        </Alert>
      )}

      <Stack direction="row" spacing={1.5} sx={{ mt: 3, justifyContent: 'flex-end' }}>
        <Button onClick={() => navegar(`/casos/${id}`)} disabled={enviando}>
          Cancelar
        </Button>
        <Button type="submit" variant="contained" disabled={enviando || !todosPreenchidos}>
          {enviando ? 'Registrando…' : 'Registrar recebimento'}
        </Button>
      </Stack>

      {!todosPreenchidos && recipientes.length > 0 && (
        <Typography sx={{ fontSize: 11.5, color: 'text.secondary', textAlign: 'right', mt: 1 }}>
          Informe a quantidade recebida de todos os recipientes.
        </Typography>
      )}
    </Box>
  );
}

/**
 * "Gerar pendencia macroscopia", da tela de conferencia.
 *
 * Quinta revisao: "a amostra fica pendente para o tecnico responsavel pela
 * checagem, permitindo que a amostra nao fique esquecida". E o conferente que
 * abre o pote, ve algo que nao bate com a requisicao e nao e ele quem decide -
 * mas tambem nao pode deixar passar.
 */
function DialogoPendenciaMacroscopia({
  casoId,
  amostras,
  aoFechar,
}: {
  casoId: string;
  amostras: DadosDossie['amostras'];
  aoFechar: () => void;
}) {
  const [observacao, setObservacao] = useState('');
  const [amostraIds, setAmostraIds] = useState<string[]>([]);
  const [equipe, setEquipe] = useState<MembroEquipe[]>([]);
  const [responsavelId, setResponsavelId] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    api
      .get<MembroEquipe[]>('/usuarios/equipe')
      .then(setEquipe)
      .catch(() => setEquipe([]));
  }, []);

  async function criar() {
    setOcupado(true);
    setErro(null);
    try {
      await api.post(`/casos/${casoId}/recebimento/pendencia-macroscopia`, {
        observacao: observacao.trim(),
        ...(amostraIds.length > 0 ? { amostraIds } : {}),
        ...(responsavelId ? { responsavelId } : {}),
      });
      setPronto(true);
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível criar a pendência.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Dialog open onClose={aoFechar} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontSize: 17 }}>Pendência de macroscopia</DialogTitle>
      <DialogContent>
        {pronto ? (
          <Alert severity="success" sx={{ mt: 1 }}>
            Pendência criada. Ela aparece na tela inicial de quem vai conferir, e o recebimento
            segue normalmente.
          </Alert>
        ) : (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="O que precisa ser conferido"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              multiline
              minRows={2}
              required
              helperText='Escreva o que você viu — "o pote B tem dois fragmentos, a requisição diz um".'
            />

            {amostras.length > 0 && (
              <Box>
                <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.secondary' }}>
                  AMOSTRAS
                </Typography>
                <Stack>
                  {amostras.map((a) => (
                    <FormControlLabel
                      key={a.id}
                      control={
                        <Checkbox
                          size="small"
                          checked={amostraIds.includes(a.id)}
                          onChange={(e) =>
                            setAmostraIds((atual) =>
                              e.target.checked
                                ? [...atual, a.id]
                                : atual.filter((x) => x !== a.id),
                            )
                          }
                        />
                      }
                      label={
                        <span>
                          <Typography component="span" sx={{ ...MONO, fontSize: 13, fontWeight: 600 }}>
                            {a.identificador}
                          </Typography>
                          {a.descricao && (
                            <Typography
                              component="span"
                              sx={{ fontSize: 12.5, color: 'text.secondary', ml: 0.75 }}
                            >
                              {a.descricao}
                            </Typography>
                          )}
                        </span>
                      }
                    />
                  ))}
                </Stack>
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                  Nenhuma marcada: a pendência é do caso inteiro.
                </Typography>
              </Box>
            )}

            <TextField
              select
              label="Para quem"
              value={responsavelId}
              onChange={(e) => setResponsavelId(e.target.value)}
              helperText="Sem nome, fica com o setor da macroscopia."
            >
              <MenuItem value="">Setor · macroscopia</MenuItem>
              {equipe.map((m) => (
                <MenuItem key={m.id} value={m.id}>
                  {m.nome}
                  {m.setor ? ` · ${m.setor}` : ''}
                </MenuItem>
              ))}
            </TextField>

            {erro && <Alert severity="error">{erro}</Alert>}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={aoFechar}>{pronto ? 'Fechar' : 'Cancelar'}</Button>
        {!pronto && (
          <Button
            variant="contained"
            onClick={() => void criar()}
            disabled={ocupado || observacao.trim() === ''}
          >
            {ocupado ? 'Criando…' : 'Criar pendência'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

/**
 * "Enviar ressalva para cliente", da tela de conferencia.
 *
 * Quinta revisao: "a pendencia e fotos capturadas podem ser enviadas direto
 * para o cliente (clinica) para que as duvidas possam ser resolvidas". Hoje
 * isso e uma ligacao que ninguem registra; aqui vira evento do caso, visivel
 * no Portal, mais uma notificacao enfileirada.
 */
function DialogoRessalvaCliente({
  casoId,
  recipientes,
  aoFechar,
}: {
  casoId: string;
  recipientes: DadosDossie['recipientes'];
  aoFechar: () => void;
}) {
  const [mensagem, setMensagem] = useState('');
  const [recipienteId, setRecipienteId] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [destinatario, setDestinatario] = useState<string | null | undefined>(undefined);

  async function enviar() {
    setOcupado(true);
    setErro(null);
    try {
      const r = await api.post<{ destinatario: string | null }>(
        `/casos/${casoId}/recebimento/ressalva-cliente`,
        { mensagem: mensagem.trim(), ...(recipienteId ? { recipienteId } : {}) },
      );
      setDestinatario(r.destinatario);
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível registrar a ressalva.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Dialog open onClose={aoFechar} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontSize: 17 }}>Ressalva para o cliente</DialogTitle>
      <DialogContent>
        {destinatario !== undefined ? (
          <Alert severity={destinatario ? 'success' : 'warning'} sx={{ mt: 1 }}>
            {destinatario
              ? `Ressalva registrada e enfileirada para ${destinatario}. Ela também aparece no Portal do cliente.`
              : 'Ressalva registrada e visível no Portal do cliente. O cadastro dele não tem e-mail, ' +
                'então não há para onde enviar — cadastre o endereço na ficha do cliente.'}
          </Alert>
        ) : (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              select
              label="Sobre qual pote"
              value={recipienteId}
              onChange={(e) => setRecipienteId(e.target.value)}
              helperText="Opcional — sem pote, a ressalva é do material como um todo."
            >
              <MenuItem value="">O material como um todo</MenuItem>
              {recipientes.map((r) => (
                <MenuItem key={r.id} value={r.id}>
                  {r.identificador}
                  {r.identificacaoExterna ? ` · ${r.identificacaoExterna}` : ''}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              label="O que precisa ser esclarecido"
              value={mensagem}
              onChange={(e) => setMensagem(e.target.value)}
              multiline
              minRows={3}
              required
              helperText="O cliente lê isto no Portal, junto com as fotos do recebimento."
            />

            {/* Honestidade com quem clica, como no envio do laudo. */}
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
              A ressalva fica registrada com o seu nome e a data, e aparece no Portal do cliente na
              hora. A entrega por e-mail sai pela fila de notificações, quando o canal estiver
              configurado.
            </Typography>

            {erro && <Alert severity="error">{erro}</Alert>}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={aoFechar}>{destinatario !== undefined ? 'Fechar' : 'Cancelar'}</Button>
        {destinatario === undefined && (
          <Button
            variant="contained"
            onClick={() => void enviar()}
            disabled={ocupado || mensagem.trim() === ''}
          >
            {ocupado ? 'Registrando…' : 'Enviar'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

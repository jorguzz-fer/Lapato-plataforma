import { useCallback, useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
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
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddOutlined from '@mui/icons-material/AddOutlined';
import {
  CATEGORIA_DOCUMENTO,
  CATEGORIA_DOCUMENTO_LABEL,
  CONTEXTO_BIBLIOTECA,
  CONTEXTO_BIBLIOTECA_LABEL,
  DESFECHO_REVISAO,
  DESFECHO_REVISAO_LABEL,
  PUBLICO_DOCUMENTO,
  PUBLICO_DOCUMENTO_LABEL,
  STATUS_DOCUMENTO_LABEL,
  STATUS_VERSAO_DOCUMENTO_LABEL,
  TIPO_DOCUMENTO,
  TIPO_DOCUMENTO_LABEL,
  TIPO_FEEDBACK_DOCUMENTO,
  TIPO_FEEDBACK_DOCUMENTO_LABEL,
  type AchadoGuardian,
  type CategoriaDocumento,
  type ContextoBiblioteca,
  type DesfechoRevisao,
  type PublicoDocumento,
  type StatusDocumento,
  type TipoDocumento,
  type TipoFeedbackDocumento,
} from '@lapato/shared';
import { api, ErroApi } from '../../api';
import { ConteudoDocumento, MONO, quando, type DocumentoResumo, type FichaDocumento, type VersaoDocumento } from './comum';

type Aba = 'documentos' | 'revisao' | 'painel';

interface Painel {
  vigentes: number;
  rascunhos: number;
  obsoletos: number;
  proximosDaRevisao: number;
  vencidos: number;
  criticos: number;
  emRevisao: number;
  aguardandoAprovacao: number;
  aprovadasNaoPublicadas: number;
  leiturasPendentes: Array<{ id: string; codigo: string; titulo: string }>;
  maisAcessados: Array<{ id: string; codigo: string; titulo: string; acessos: number }>;
  feedbacksAbertos: number;
}

interface ItemFila {
  versaoId: string;
  numero: string;
  status: string;
  documentoId: string;
  codigo: string;
  titulo: string;
  categoria: CategoriaDocumento;
  exigeAprovacao: boolean;
  autor: string | null;
  enviadaRevisaoEm: string | null;
  motivoRevisao: string | null;
}

/**
 * M21 - Biblioteca.
 *
 * A tela responde as perguntas da secao 130: "qual e o protocolo vigente",
 * "como acondiciono esta amostra", "este POP ja foi revisado", "quem ainda
 * nao leu a nova versao". A busca e o centro; a revisao e o painel ficam em
 * abas porque sao de quem administra.
 */
export function Biblioteca({ permissoes }: { permissoes: string[] }) {
  const podeEditar = permissoes.includes('biblioteca:editar');
  const podeRevisar = permissoes.includes('biblioteca:revisar');
  const administra = permissoes.includes('biblioteca:aprovar');
  const [aba, setAba] = useState<Aba>('documentos');
  const [lista, setLista] = useState<DocumentoResumo[] | null>(null);
  const [q, setQ] = useState('');
  const [categoria, setCategoria] = useState<CategoriaDocumento | ''>('');
  const [tipo, setTipo] = useState<TipoDocumento | ''>('');
  const [status, setStatus] = useState<StatusDocumento | 'todos'>('publicado');
  const [erro, setErro] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const [fichaId, setFichaId] = useState<string | null>(null);

  const recarregar = useCallback(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    if (categoria) p.set('categoria', categoria);
    if (tipo) p.set('tipo', tipo);
    p.set('status', status);
    api
      .get<DocumentoResumo[]>(`/biblioteca/documentos?${p.toString()}`)
      .then(setLista)
      .catch((e) => setErro(e instanceof ErroApi ? e.detalhe : 'Não foi possível carregar a Biblioteca.'));
  }, [q, categoria, tipo, status]);
  useEffect(() => {
    const t = setTimeout(recarregar, 250);
    return () => clearTimeout(t);
  }, [recarregar]);

  return (
    <Box sx={{ maxWidth: 1120 }}>
      <Stack direction="row" sx={{ mb: 0.5, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h2">Biblioteca</Typography>
        {podeEditar && (
          <Button variant="contained" startIcon={<AddOutlined />} onClick={() => setNovo(true)}>
            Novo documento
          </Button>
        )}
      </Stack>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 2 }}>
        Protocolos, POPs, guias e referências: a versão vigente, para quem precisa, no momento em que precisa.
      </Typography>

      <Tabs value={aba} onChange={(_, v: Aba) => setAba(v)} sx={{ mb: 2 }}>
        <Tab value="documentos" label="Documentos" />
        {podeRevisar && <Tab value="revisao" label="Revisão e aprovação" />}
        <Tab value="painel" label="Painel" />
      </Tabs>

      {erro && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErro(null)}>
          {erro}
        </Alert>
      )}

      {aba === 'documentos' && (
        <>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
            <TextField size="small" label="Buscar" placeholder="Título, código, palavra-chave ou trecho do conteúdo" value={q} onChange={(e) => setQ(e.target.value)} sx={{ flex: 2 }} />
            <TextField select size="small" label="Categoria" value={categoria} onChange={(e) => setCategoria(e.target.value as CategoriaDocumento | '')} sx={{ minWidth: 200 }}>
              <MenuItem value="">Todas</MenuItem>
              {CATEGORIA_DOCUMENTO.map((c) => (
                <MenuItem key={c} value={c}>
                  {CATEGORIA_DOCUMENTO_LABEL[c]}
                </MenuItem>
              ))}
            </TextField>
            <TextField select size="small" label="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoDocumento | '')} sx={{ minWidth: 200 }}>
              <MenuItem value="">Todos</MenuItem>
              {TIPO_DOCUMENTO.map((t) => (
                <MenuItem key={t} value={t}>
                  {TIPO_DOCUMENTO_LABEL[t]}
                </MenuItem>
              ))}
            </TextField>
            {podeEditar && (
              <TextField select size="small" label="Situação" value={status} onChange={(e) => setStatus(e.target.value as StatusDocumento | 'todos')} sx={{ minWidth: 170 }}>
                <MenuItem value="publicado">Vigentes</MenuItem>
                <MenuItem value="rascunho">Em elaboração</MenuItem>
                <MenuItem value="obsoleto">Obsoletos</MenuItem>
                <MenuItem value="arquivado">Arquivados</MenuItem>
                <MenuItem value="todos">Todos</MenuItem>
              </TextField>
            )}
          </Stack>
          {lista === null ? (
            <Skeleton variant="rounded" height={120} />
          ) : lista.length === 0 ? (
            <Alert severity="info">Nenhum documento com esses critérios. Se o protocolo deveria existir, peça pelo botão de feedback do painel.</Alert>
          ) : (
            <Stack spacing={1}>
              {lista.map((d) => (
                <Card key={d.id} sx={{ p: 1.5, cursor: 'pointer' }} onClick={() => setFichaId(d.id)}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    <Typography sx={{ ...MONO, fontSize: 12, color: 'text.secondary', minWidth: 110 }}>{d.codigo}</Typography>
                    <Typography sx={{ fontSize: 14, fontWeight: 600, flex: 1, minWidth: 200 }}>{d.titulo}</Typography>
                    {d.critico && <Chip size="small" color="error" label="Crítico" />}
                    {d.status !== 'publicado' && <Chip size="small" variant="outlined" label={STATUS_DOCUMENTO_LABEL[d.status]} />}
                    {d.versaoEmElaboracao && <Chip size="small" color="warning" variant="outlined" label={`Versão ${d.versaoEmElaboracao.replace('_', ' ')}`} />}
                    {d.exigeCiencia && d.status === 'publicado' && (
                      <Chip size="small" color={d.cienciaConfirmada ? 'success' : 'warning'} label={d.cienciaConfirmada ? 'Lido' : 'Leitura pendente'} />
                    )}
                    {d.publico === 'clientes' && <Chip size="small" variant="outlined" label="Portal" />}
                  </Stack>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.25 }}>
                    {TIPO_DOCUMENTO_LABEL[d.tipo]} · {CATEGORIA_DOCUMENTO_LABEL[d.categoria]}
                    {d.subcategoria ? ` › ${d.subcategoria}` : ''}
                    {d.numeroVigente ? ` · v${d.numeroVigente}` : ''}
                    {d.responsavel ? ` · ${d.responsavel}` : ''}
                    {d.proximaRevisaoEm ? ` · revisão até ${quando(d.proximaRevisaoEm)}` : ''}
                  </Typography>
                </Card>
              ))}
            </Stack>
          )}
        </>
      )}

      {aba === 'revisao' && <Fila aoAbrir={setFichaId} />}
      {aba === 'painel' && <PainelBiblioteca aoAbrir={setFichaId} administra={administra} />}

      {novo && (
        <DialogoDocumento
          aoFechar={() => setNovo(false)}
          aoSalvar={(id) => {
            setNovo(false);
            setStatus('todos');
            recarregar();
            setFichaId(id);
          }}
        />
      )}
      <FichaDialogo id={fichaId} permissoes={permissoes} aoFechar={() => setFichaId(null)} aoMudar={recarregar} />
    </Box>
  );
}

function Fila({ aoAbrir }: { aoAbrir: (id: string) => void }) {
  const [fila, setFila] = useState<ItemFila[] | null>(null);
  useEffect(() => {
    api.get<ItemFila[]>('/biblioteca/revisao').then(setFila).catch(() => setFila([]));
  }, []);
  if (!fila) return <Skeleton variant="rounded" height={80} />;
  if (fila.length === 0) return <Alert severity="info">Nada aguardando revisão ou aprovação.</Alert>;
  return (
    <Stack spacing={1}>
      {fila.map((f) => (
        <Card key={f.versaoId} sx={{ p: 1.5, cursor: 'pointer' }} onClick={() => aoAbrir(f.documentoId)}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography sx={{ ...MONO, fontSize: 12, color: 'text.secondary', minWidth: 110 }}>{f.codigo}</Typography>
            <Typography sx={{ fontSize: 14, fontWeight: 600, flex: 1 }}>
              {f.titulo} · v{f.numero}
            </Typography>
            <Chip size="small" color={f.status === 'em_revisao' ? 'warning' : 'info'} label={STATUS_VERSAO_DOCUMENTO_LABEL[f.status as keyof typeof STATUS_VERSAO_DOCUMENTO_LABEL] ?? f.status} />
          </Stack>
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
            {f.autor ?? ''}{f.enviadaRevisaoEm ? ` · enviada em ${quando(f.enviadaRevisaoEm)}` : ''}{f.motivoRevisao ? ` · ${f.motivoRevisao}` : ''}
          </Typography>
        </Card>
      ))}
    </Stack>
  );
}

function PainelBiblioteca({ aoAbrir, administra }: { aoAbrir: (id: string) => void; administra: boolean }) {
  const [p, setP] = useState<Painel | null>(null);
  const [achados, setAchados] = useState<AchadoGuardian[] | null>(null);
  const [pedido, setPedido] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);
  useEffect(() => {
    api.get<Painel>('/biblioteca/painel').then(setP).catch(() => setP(null));
    api.get<AchadoGuardian[]>('/biblioteca/guardian').then(setAchados).catch(() => setAchados([]));
  }, []);
  if (!p) return <Skeleton variant="rounded" height={120} />;
  const tiles: Array<[string, number, 'default' | 'warning' | 'error']> = [
    ['Vigentes', p.vigentes, 'default'],
    ['Em elaboração', p.rascunhos, 'default'],
    ['Em revisão', p.emRevisao, 'warning'],
    ['Aguardando aprovação', p.aguardandoAprovacao, 'warning'],
    ['Aprovadas, não publicadas', p.aprovadasNaoPublicadas, 'warning'],
    ['Revisão nos próximos 30 dias', p.proximosDaRevisao, 'warning'],
    ['Revisão vencida', p.vencidos, 'error'],
    ['Críticos vigentes', p.criticos, 'default'],
    ['Obsoletos ou arquivados', p.obsoletos, 'default'],
  ];
  if (administra) tiles.push(['Feedbacks abertos', p.feedbacksAbertos, 'warning']);
  return (
    <Stack spacing={2}>
      {p.leiturasPendentes.length > 0 && (
        <Alert severity="warning">
          <strong>Leitura obrigatória pendente:</strong>{' '}
          {p.leiturasPendentes.map((d, i) => (
            <span key={d.id}>
              {i > 0 ? ' · ' : ''}
              <a href="#" onClick={(e) => { e.preventDefault(); aoAbrir(d.id); }}>{d.codigo} {d.titulo}</a>
            </span>
          ))}
        </Alert>
      )}
      <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', rowGap: 1.5 }}>
        {tiles.map(([r, v, cor]) => (
          <Card key={r} sx={{ px: 2, py: 1.5, minWidth: 150 }}>
            <Typography sx={{ fontSize: 24, fontWeight: 600, color: v > 0 && cor !== 'default' ? `${cor}.main` : 'text.primary' }}>{v}</Typography>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{r}</Typography>
          </Card>
        ))}
      </Stack>
      {p.maisAcessados.length > 0 && (
        <Card sx={{ p: 2 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 600, mb: 0.5 }}>Mais consultados</Typography>
          {p.maisAcessados.map((d) => (
            <Typography key={d.id} sx={{ fontSize: 13, cursor: 'pointer' }} onClick={() => aoAbrir(d.id)}>
              <span style={MONO}>{d.codigo}</span> {d.titulo} · {d.acessos}
            </Typography>
          ))}
        </Card>
      )}
      <Card sx={{ p: 2 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 600, mb: 1 }}>Guardian</Typography>
        {achados === null ? (
          <Skeleton variant="rounded" height={40} />
        ) : achados.length === 0 ? (
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>Nenhuma incoerência documental.</Typography>
        ) : (
          <Stack spacing={1}>
            {achados.map((a, i) => (
              <Alert key={i} severity={a.nivel === 'critico' ? 'error' : a.nivel === 'atencao' ? 'warning' : 'info'} sx={{ cursor: 'pointer' }} onClick={() => { const id = a.evidencias?.documentoId; if (typeof id === 'string') aoAbrir(id); }}>
                {a.mensagem} <em>{a.comoResolver}</em>
              </Alert>
            ))}
          </Stack>
        )}
      </Card>
      <Card sx={{ p: 2 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 600, mb: 0.5 }}>Falta um protocolo?</Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1 }}>Peça aqui; o pedido vai para quem administra a Biblioteca (M21 §106).</Typography>
        <Stack direction="row" spacing={1}>
          <TextField size="small" fullWidth placeholder="Ex.: guia de acondicionamento de medula óssea" value={pedido} onChange={(e) => setPedido(e.target.value)} />
          <Button
            variant="outlined"
            disabled={!pedido.trim()}
            onClick={() =>
              api
                .post('/biblioteca/solicitacoes', { texto: pedido })
                .then(() => { setPedido(''); setAviso('Pedido registrado.'); })
                .catch(() => setAviso('Não foi possível registrar.'))
            }
          >
            Pedir
          </Button>
        </Stack>
        {aviso && <Typography sx={{ fontSize: 12, mt: 0.5 }}>{aviso}</Typography>}
      </Card>
    </Stack>
  );
}

/** Criar ou editar metadados (secoes 9 e 13). */
function DialogoDocumento({ existente, aoFechar, aoSalvar }: { existente?: FichaDocumento; aoFechar: () => void; aoSalvar: (id: string) => void }) {
  const [f, setF] = useState({
    titulo: existente?.titulo ?? '',
    tipo: (existente?.tipo ?? 'pop') as TipoDocumento,
    categoria: (existente?.categoria ?? 'histopatologia') as CategoriaDocumento,
    subcategoria: existente?.subcategoria ?? '',
    palavrasChave: existente?.palavrasChave.join(', ') ?? '',
    colecoes: existente?.colecoes.join(', ') ?? '',
    resumo: existente?.resumo ?? '',
    publico: (existente?.publico ?? 'colaboradores') as PublicoDocumento,
    contextos: (existente?.contextos ?? []) as ContextoBiblioteca[],
    exigeAprovacao: existente?.exigeAprovacao ?? false,
    exigeCiencia: existente?.exigeCiencia ?? false,
    critico: existente?.critico ?? false,
    permiteDownload: existente?.permiteDownload ?? true,
    revisaoPeriodicaMeses: existente?.revisaoPeriodicaMeses ? String(existente.revisaoPeriodicaMeses) : '',
    codigo: '',
    conteudo: '',
  });
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const campo = (k: keyof typeof f) => ({ value: f[k] as string, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value }) });
  const lista = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

  async function salvar() {
    setOcupado(true);
    setErro(null);
    try {
      const dados = {
        titulo: f.titulo,
        tipo: f.tipo,
        categoria: f.categoria,
        subcategoria: f.subcategoria || null,
        palavrasChave: lista(f.palavrasChave),
        colecoes: lista(f.colecoes),
        resumo: f.resumo || null,
        publico: f.publico,
        contextos: f.contextos,
        exigeAprovacao: f.exigeAprovacao,
        exigeCiencia: f.exigeCiencia,
        critico: f.critico,
        permiteDownload: f.permiteDownload,
        revisaoPeriodicaMeses: f.revisaoPeriodicaMeses ? Number(f.revisaoPeriodicaMeses) : null,
      };
      if (existente) {
        await api.post(`/biblioteca/documentos/${existente.id}`, dados);
        aoSalvar(existente.id);
      } else {
        const r = await api.post<{ id: string }>('/biblioteca/documentos', { ...dados, codigo: f.codigo || null, versao: { conteudo: f.conteudo || null } });
        aoSalvar(r.id);
      }
    } catch (e) {
      setErro(e instanceof ErroApi ? e.detalhe : 'Não foi possível salvar.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Dialog open fullWidth maxWidth="md" onClose={aoFechar}>
      <DialogTitle>{existente ? `Editar ${existente.codigo}` : 'Novo documento'}</DialogTitle>
      <DialogContent dividers>
        {erro && <Alert severity="error" sx={{ mb: 2 }}>{erro}</Alert>}
        <Stack spacing={1.5}>
          <TextField size="small" label="Título" required {...campo('titulo')} />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField select size="small" label="Tipo" sx={{ flex: 1 }} {...campo('tipo')}>
              {TIPO_DOCUMENTO.map((t) => (<MenuItem key={t} value={t}>{TIPO_DOCUMENTO_LABEL[t]}</MenuItem>))}
            </TextField>
            <TextField select size="small" label="Categoria" sx={{ flex: 1 }} {...campo('categoria')}>
              {CATEGORIA_DOCUMENTO.map((c) => (<MenuItem key={c} value={c}>{CATEGORIA_DOCUMENTO_LABEL[c]}</MenuItem>))}
            </TextField>
            {!existente && <TextField size="small" label="Código (vazio gera POP-HIST-001)" sx={{ flex: 1 }} {...campo('codigo')} />}
          </Stack>
          <TextField size="small" label="Subcategoria" placeholder="Pele > Tumores > Mastocitoma" {...campo('subcategoria')} />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField size="small" label="Palavras-chave (vírgula)" sx={{ flex: 1 }} {...campo('palavrasChave')} />
            <TextField size="small" label="Coleções (vírgula)" placeholder="Oncopatologia, Dermatopatologia" sx={{ flex: 1 }} {...campo('colecoes')} />
          </Stack>
          <TextField size="small" label="Resumo" multiline {...campo('resumo')} />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField select size="small" label="Quem vê" sx={{ flex: 1 }} {...campo('publico')}>
              {PUBLICO_DOCUMENTO.map((p) => (<MenuItem key={p} value={p}>{PUBLICO_DOCUMENTO_LABEL[p]}</MenuItem>))}
            </TextField>
            <TextField size="small" type="number" label="Revisão a cada (meses)" sx={{ flex: 1 }} {...campo('revisaoPeriodicaMeses')} />
          </Stack>
          <Box>
            <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.5 }}>Aparece como ajuda em</Typography>
            <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
              {CONTEXTO_BIBLIOTECA.map((c) => (
                <Chip key={c} size="small" label={CONTEXTO_BIBLIOTECA_LABEL[c]} color={f.contextos.includes(c) ? 'primary' : 'default'} variant={f.contextos.includes(c) ? 'filled' : 'outlined'} onClick={() => setF({ ...f, contextos: f.contextos.includes(c) ? f.contextos.filter((x) => x !== c) : [...f.contextos, c] })} />
              ))}
            </Stack>
          </Box>
          <Stack direction="row" sx={{ flexWrap: 'wrap' }}>
            <FormControlLabel control={<Checkbox checked={f.exigeAprovacao} onChange={(_, v) => setF({ ...f, exigeAprovacao: v })} />} label="Documento controlado: exige aprovação formal" />
            <FormControlLabel control={<Checkbox checked={f.exigeCiencia} onChange={(_, v) => setF({ ...f, exigeCiencia: v })} />} label="Exige confirmação de leitura" />
            <FormControlLabel control={<Checkbox checked={f.critico} onChange={(_, v) => setF({ ...f, critico: v })} />} label="Crítico (acesso destacado)" />
            <FormControlLabel control={<Checkbox checked={f.permiteDownload} onChange={(_, v) => setF({ ...f, permiteDownload: v })} />} label="Permite baixar o anexo" />
          </Stack>
          {!existente && (
            <TextField size="small" label="Conteúdo da versão 1.0" multiline minRows={6} helperText="Linhas com # viram títulos, com - viram listas, com ! viram alerta. Arquivos entram como anexo depois de criar." {...campo('conteudo')} />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={aoFechar}>Cancelar</Button>
        <Button variant="contained" disabled={ocupado || !f.titulo.trim()} onClick={() => void salvar()}>Salvar</Button>
      </DialogActions>
    </Dialog>
  );
}

/** A ficha (secoes 9, 23): conteudo, versoes, revisao, ciencia e feedback. */
function FichaDialogo({ id, permissoes, aoFechar, aoMudar }: { id: string | null; permissoes: string[]; aoFechar: () => void; aoMudar: () => void }) {
  const [ficha, setFicha] = useState<FichaDocumento | null>(null);
  const [versaoAberta, setVersaoAberta] = useState<VersaoDocumento | undefined>(undefined);
  const [modo, setModo] = useState<'ler' | 'editar' | 'nova_versao' | 'editar_versao' | 'parecer' | 'saida' | 'feedback' | 'ciencia'>('ler');
  const [texto, setTexto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [link, setLink] = useState('');
  const [relevante, setRelevante] = useState(false);
  const [desfecho, setDesfecho] = useState<DesfechoRevisao>('comentario');
  const [tipoFeedback, setTipoFeedback] = useState<TipoFeedbackDocumento>('util');
  const [painelCiencia, setPainelCiencia] = useState<{ numero: string | null; leram: Array<{ id: string; nome: string; confirmadaEm: string }>; naoLeram: Array<{ id: string; nome: string }> } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const entrada = useRef<HTMLInputElement | null>(null);
  const podeRevisar = permissoes.includes('biblioteca:revisar');

  const carregar = useCallback(() => {
    if (!id) return;
    api.get<FichaDocumento>(`/biblioteca/documentos/${id}`).then((f) => { setFicha(f); setVersaoAberta(undefined); }).catch((e) => setErro(e instanceof ErroApi ? e.detalhe : 'Não foi possível carregar.'));
  }, [id]);
  useEffect(() => { setFicha(null); setModo('ler'); setErro(null); setPainelCiencia(null); carregar(); }, [carregar]);

  if (!id) return null;
  const emElaboracao = ficha?.versoes.find((v) => ['rascunho', 'em_revisao', 'aguardando_aprovacao', 'aprovada'].includes(v.status));

  async function agir(fn: () => Promise<unknown>) {
    setOcupado(true);
    setErro(null);
    try {
      await fn();
      setModo('ler');
      setTexto(''); setMotivo(''); setLink('');
      aoMudar();
      carregar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.detalhe : 'Não foi possível.');
    } finally {
      setOcupado(false);
    }
  }

  async function anexar(lista: FileList | null) {
    if (!lista?.[0] || !emElaboracao) return;
    const corpo = new FormData();
    corpo.append('arquivo', lista[0]);
    await agir(() => api.postForm(`/biblioteca/versoes/${emElaboracao.id}/anexo`, corpo));
    if (entrada.current) entrada.current.value = '';
  }

  return (
    <Dialog open fullWidth maxWidth="md" onClose={aoFechar}>
      <DialogTitle>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography sx={{ ...MONO, fontSize: 14, color: 'text.secondary' }}>{ficha?.codigo ?? '…'}</Typography>
          <Typography sx={{ fontSize: 17, fontWeight: 600, flex: 1 }}>{ficha?.titulo ?? ''}</Typography>
          {ficha && <Chip size="small" color={ficha.status === 'publicado' ? 'success' : 'default'} label={STATUS_DOCUMENTO_LABEL[ficha.status]} />}
          {ficha?.critico && <Chip size="small" color="error" label="Crítico" />}
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        {erro && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErro(null)}>{erro}</Alert>}
        {!ficha ? (
          <Skeleton variant="rounded" height={200} />
        ) : modo === 'editar' ? (
          <DialogoDocumento existente={ficha} aoFechar={() => setModo('ler')} aoSalvar={() => { setModo('ler'); aoMudar(); carregar(); }} />
        ) : (
          <Stack spacing={2}>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
              {TIPO_DOCUMENTO_LABEL[ficha.tipo]} · {CATEGORIA_DOCUMENTO_LABEL[ficha.categoria]}{ficha.subcategoria ? ` › ${ficha.subcategoria}` : ''}
              {ficha.responsavel ? ` · responsável ${ficha.responsavel}` : ''} · {PUBLICO_DOCUMENTO_LABEL[ficha.publico]}
              {ficha.proximaRevisaoEm ? ` · revisão até ${quando(ficha.proximaRevisaoEm)}` : ''}
              {ficha.contextos.length ? ` · ajuda em: ${ficha.contextos.map((c) => CONTEXTO_BIBLIOTECA_LABEL[c]).join(', ')}` : ''}
            </Typography>
            {ficha.resumo && <Typography sx={{ fontSize: 14 }}>{ficha.resumo}</Typography>}
            {ficha.motivoSaida && <Alert severity="warning">Fora de uso: {ficha.motivoSaida}</Alert>}

            {ficha.exigeCiencia && ficha.status === 'publicado' && (
              <Alert
                severity={ficha.minhaCiencia ? 'success' : 'warning'}
                action={!ficha.minhaCiencia && (
                  <Button size="small" color="inherit" disabled={ocupado} onClick={() => void agir(() => api.post(`/biblioteca/versoes/${ficha.versaoVigenteId}/ciencia`))}>
                    Li e estou ciente
                  </Button>
                )}
              >
                {ficha.minhaCiencia ? `Leitura confirmada em ${quando(ficha.minhaCiencia)}.` : 'Este documento exige confirmação de leitura da versão vigente.'}
              </Alert>
            )}

            <ConteudoDocumento ficha={ficha} versao={versaoAberta} />

            {modo === 'nova_versao' && (
              <Box sx={{ p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                <Stack spacing={1.5}>
                  <TextField size="small" label="Motivo da revisão (§22)" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                  <TextField size="small" label="Conteúdo" multiline minRows={6} value={texto} onChange={(e) => setTexto(e.target.value)} />
                  <TextField size="small" label="Link externo (opcional)" value={link} onChange={(e) => setLink(e.target.value)} />
                  <FormControlLabel control={<Checkbox checked={relevante} onChange={(_, v) => setRelevante(v)} />} label="Alteração relevante (avança para 2.0, 3.0…)" />
                  <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                    <Button size="small" onClick={() => setModo('ler')}>Voltar</Button>
                    <Button size="small" variant="contained" disabled={ocupado} onClick={() => void agir(() => api.post(`/biblioteca/documentos/${ficha.id}/versoes`, { conteudo: texto || null, linkExterno: link || null, motivoRevisao: motivo || null, relevante }))}>Abrir versão</Button>
                  </Stack>
                </Stack>
              </Box>
            )}
            {modo === 'editar_versao' && emElaboracao && (
              <Box sx={{ p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                <Stack spacing={1.5}>
                  <TextField size="small" label={`Conteúdo da versão ${emElaboracao.numero}`} multiline minRows={8} value={texto} onChange={(e) => setTexto(e.target.value)} />
                  <TextField size="small" label="Link externo" value={link} onChange={(e) => setLink(e.target.value)} />
                  <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                    <Button size="small" onClick={() => setModo('ler')}>Voltar</Button>
                    <Button size="small" variant="contained" disabled={ocupado} onClick={() => void agir(() => api.post(`/biblioteca/versoes/${emElaboracao.id}`, { conteudo: texto || null, linkExterno: link || null }))}>Salvar</Button>
                  </Stack>
                </Stack>
              </Box>
            )}
            {modo === 'parecer' && emElaboracao && (
              <Box sx={{ p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                <Stack spacing={1.5}>
                  <TextField select size="small" label="Parecer" value={desfecho} onChange={(e) => setDesfecho(e.target.value as DesfechoRevisao)}>
                    {DESFECHO_REVISAO.map((d) => (<MenuItem key={d} value={d}>{DESFECHO_REVISAO_LABEL[d]}</MenuItem>))}
                  </TextField>
                  <TextField size="small" label="Comentário" multiline value={texto} onChange={(e) => setTexto(e.target.value)} />
                  <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                    <Button size="small" onClick={() => setModo('ler')}>Voltar</Button>
                    <Button size="small" variant="contained" disabled={ocupado || !texto.trim()} onClick={() => void agir(() => api.post(`/biblioteca/versoes/${emElaboracao.id}/parecer`, { desfecho, texto }))}>Registrar parecer</Button>
                  </Stack>
                </Stack>
              </Box>
            )}
            {modo === 'saida' && (
              <Box sx={{ p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                <Stack spacing={1.5}>
                  <TextField size="small" label="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                  <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                    <Button size="small" onClick={() => setModo('ler')}>Voltar</Button>
                    <Button size="small" color="warning" disabled={ocupado || !motivo.trim()} onClick={() => void agir(() => api.post(`/biblioteca/documentos/${ficha.id}/saida`, { destino: 'obsoleto', motivo }))}>Tornar obsoleto</Button>
                    <Button size="small" color="error" disabled={ocupado || !motivo.trim()} onClick={() => void agir(() => api.post(`/biblioteca/documentos/${ficha.id}/saida`, { destino: 'arquivado', motivo }))}>Arquivar</Button>
                  </Stack>
                </Stack>
              </Box>
            )}
            {modo === 'feedback' && (
              <Box sx={{ p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                <Stack spacing={1.5}>
                  <TextField select size="small" label="O que você achou" value={tipoFeedback} onChange={(e) => setTipoFeedback(e.target.value as TipoFeedbackDocumento)}>
                    {TIPO_FEEDBACK_DOCUMENTO.filter((t) => t !== 'solicitacao_novo').map((t) => (<MenuItem key={t} value={t}>{TIPO_FEEDBACK_DOCUMENTO_LABEL[t]}</MenuItem>))}
                  </TextField>
                  <TextField size="small" label="Detalhe" multiline value={texto} onChange={(e) => setTexto(e.target.value)} />
                  <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                    <Button size="small" onClick={() => setModo('ler')}>Voltar</Button>
                    <Button size="small" variant="contained" disabled={ocupado} onClick={() => void agir(() => api.post(`/biblioteca/documentos/${ficha.id}/feedback`, { tipo: tipoFeedback, texto: texto || null }))}>Enviar</Button>
                  </Stack>
                </Stack>
              </Box>
            )}
            {modo === 'ciencia' && (
              <Box sx={{ p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                {!painelCiencia ? <Skeleton variant="rounded" height={60} /> : (
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                    <Box sx={{ flex: 1 }}>
                      <Typography sx={{ fontSize: 13, fontWeight: 600 }}>Leram a v{painelCiencia.numero} ({painelCiencia.leram.length})</Typography>
                      {painelCiencia.leram.map((u) => <Typography key={u.id} sx={{ fontSize: 13 }}>{u.nome} · {quando(u.confirmadaEm)}</Typography>)}
                    </Box>
                    <Box sx={{ flex: 1 }}>
                      <Typography sx={{ fontSize: 13, fontWeight: 600 }}>Ainda não leram ({painelCiencia.naoLeram.length})</Typography>
                      {painelCiencia.naoLeram.map((u) => <Typography key={u.id} sx={{ fontSize: 13 }}>{u.nome}</Typography>)}
                    </Box>
                  </Stack>
                )}
                <Button size="small" sx={{ mt: 1 }} onClick={() => setModo('ler')}>Voltar</Button>
              </Box>
            )}

            <Divider />
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Versões</Typography>
            <Stack spacing={0.5}>
              {ficha.versoes.map((v) => (
                <Stack key={v.id} direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', cursor: 'pointer' }} onClick={() => setVersaoAberta(v)}>
                  <Typography sx={{ ...MONO, fontSize: 13, minWidth: 40 }}>v{v.numero}</Typography>
                  <Chip size="small" color={v.status === 'vigente' ? 'success' : v.status === 'obsoleta' ? 'default' : 'warning'} label={STATUS_VERSAO_DOCUMENTO_LABEL[v.status]} />
                  <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                    {v.autor ?? ''}{v.publicadaEm ? ` · publicada ${quando(v.publicadaEm)}` : ` · criada ${quando(v.criadaEm)}`}{v.motivoRevisao ? ` · ${v.motivoRevisao}` : ''}{v.arquivoNome ? ` · ${v.arquivoNome}` : ''}{ficha.exigeCiencia ? ` · ${v.ciencias} ciência(s)` : ''}
                  </Typography>
                </Stack>
              ))}
            </Stack>
            {ficha.comentarios.length > 0 && (
              <>
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Revisão</Typography>
                {ficha.comentarios.map((c) => (
                  <Typography key={c.id} sx={{ fontSize: 13 }}>
                    <strong>{c.autor}</strong> · {DESFECHO_REVISAO_LABEL[c.desfecho]} · {quando(c.criadoEm)}: {c.texto}
                  </Typography>
                ))}
              </>
            )}
            {ficha.feedbacks.length > 0 && (
              <>
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Feedbacks</Typography>
                {ficha.feedbacks.map((f) => (
                  <Stack key={f.id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <Typography sx={{ fontSize: 13, flex: 1 }}>
                      <strong>{TIPO_FEEDBACK_DOCUMENTO_LABEL[f.tipo]}</strong> · {f.autor} · {quando(f.criadoEm)}{f.texto ? `: ${f.texto}` : ''}
                    </Typography>
                    {f.tratadoEm ? <Chip size="small" label="Tratado" /> : ficha.administra && <Button size="small" onClick={() => void agir(() => api.post(`/biblioteca/feedback/${f.id}/tratado`))}>Marcar tratado</Button>}
                  </Stack>
                ))}
              </>
            )}
          </Stack>
        )}
      </DialogContent>
      {ficha && modo === 'ler' && (
        <DialogActions sx={{ flexWrap: 'wrap', gap: 0.5 }}>
          <Button onClick={aoFechar}>Fechar</Button>
          <Box sx={{ flex: 1 }} />
          <Button size="small" onClick={() => setModo('feedback')}>Feedback</Button>
          {ficha.podeEditar && <Button size="small" onClick={() => setModo('editar')}>Editar ficha</Button>}
          {ficha.podeEditar && !emElaboracao && ficha.status !== 'arquivado' && <Button size="small" onClick={() => { setTexto(ficha.versoes.find((v) => v.id === ficha.versaoVigenteId)?.conteudo ?? ''); setModo('nova_versao'); }}>Nova versão</Button>}
          {ficha.podeEditar && emElaboracao && emElaboracao.status === 'rascunho' && (
            <>
              <Button size="small" onClick={() => { setTexto(emElaboracao.conteudo ?? ''); setLink(emElaboracao.linkExterno ?? ''); setModo('editar_versao'); }}>Editar v{emElaboracao.numero}</Button>
              <input ref={entrada} type="file" hidden accept=".pdf,.docx,.pptx,.xlsx,image/*,video/mp4" onChange={(e) => void anexar(e.target.files)} />
              <Button size="small" onClick={() => entrada.current?.click()}>Anexar arquivo</Button>
              <Button size="small" variant="outlined" disabled={ocupado} onClick={() => void agir(() => api.post(`/biblioteca/versoes/${emElaboracao.id}/revisao`))}>Enviar para revisão</Button>
              {!ficha.exigeAprovacao && ficha.administra && <Button size="small" variant="contained" disabled={ocupado} onClick={() => void agir(() => api.post(`/biblioteca/versoes/${emElaboracao.id}/publicacao`))}>Publicar</Button>}
            </>
          )}
          {podeRevisar && emElaboracao?.status === 'em_revisao' && <Button size="small" variant="contained" onClick={() => setModo('parecer')}>Dar parecer</Button>}
          {ficha.administra && emElaboracao?.status === 'aguardando_aprovacao' && <Button size="small" variant="contained" disabled={ocupado} onClick={() => void agir(() => api.post(`/biblioteca/versoes/${emElaboracao.id}/aprovacao`))}>Aprovar</Button>}
          {ficha.administra && emElaboracao && ['aprovada', 'em_revisao'].includes(emElaboracao.status) && (!ficha.exigeAprovacao || emElaboracao.status === 'aprovada') && <Button size="small" variant="contained" disabled={ocupado} onClick={() => void agir(() => api.post(`/biblioteca/versoes/${emElaboracao.id}/publicacao`))}>Publicar v{emElaboracao.numero}</Button>}
          {ficha.administra && ficha.exigeCiencia && ficha.status === 'publicado' && <Button size="small" onClick={() => { setModo('ciencia'); api.get<typeof painelCiencia>(`/biblioteca/documentos/${ficha.id}/ciencia`).then(setPainelCiencia).catch(() => setPainelCiencia({ numero: null, leram: [], naoLeram: [] })); }}>Quem leu</Button>}
          {ficha.administra && ficha.status !== 'arquivado' && <Button size="small" color="warning" onClick={() => setModo('saida')}>Retirar de uso</Button>}
        </DialogActions>
      )}
    </Dialog>
  );
}

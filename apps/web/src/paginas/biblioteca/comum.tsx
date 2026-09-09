import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type {
  CategoriaDocumento,
  ContextoBiblioteca,
  DesfechoRevisao,
  PublicoDocumento,
  StatusDocumento,
  StatusVersaoDocumento,
  TipoDocumento,
  TipoFeedbackDocumento,
} from '@lapato/shared';
import { urlArquivo } from '../../api';

export interface DocumentoResumo {
  id: string;
  codigo: string;
  titulo: string;
  tipo: TipoDocumento;
  categoria: CategoriaDocumento;
  subcategoria: string | null;
  colecoes: string[];
  palavrasChave: string[];
  resumo: string | null;
  publico: PublicoDocumento;
  contextos: ContextoBiblioteca[];
  status: StatusDocumento;
  critico: boolean;
  exigeCiencia: boolean;
  exigeAprovacao: boolean;
  proximaRevisaoEm: string | null;
  acessos: number;
  responsavel: string | null;
  versaoVigenteId: string | null;
  numeroVigente: string | null;
  publicadaEm: string | null;
  versaoEmElaboracao: string | null;
  cienciaConfirmada: boolean;
  atualizadoEm: string;
}

export interface VersaoDocumento {
  id: string;
  numero: string;
  status: StatusVersaoDocumento;
  conteudo: string | null;
  linkExterno: string | null;
  arquivoNome: string | null;
  arquivoMime: string | null;
  arquivoTamanho: number | null;
  arquivoHash: string | null;
  motivoRevisao: string | null;
  autor: string | null;
  autorId: string | null;
  enviadaRevisaoEm: string | null;
  revisaoConcluidaEm: string | null;
  aprovadaEm: string | null;
  publicadaEm: string | null;
  obsoletaEm: string | null;
  criadaEm: string;
  ciencias: number;
}

export interface ComentarioRevisao {
  id: string;
  versaoId: string;
  desfecho: DesfechoRevisao;
  texto: string;
  autor: string | null;
  criadoEm: string;
}

export interface FichaDocumento extends Omit<DocumentoResumo, 'numeroVigente' | 'publicadaEm' | 'versaoEmElaboracao' | 'cienciaConfirmada'> {
  responsavelId: string | null;
  criadoPorId: string | null;
  permiteDownload: boolean;
  revisaoPeriodicaMeses: number | null;
  motivoSaida: string | null;
  minhaCiencia: string | null;
  versoes: VersaoDocumento[];
  comentarios: ComentarioRevisao[];
  feedbacks: Array<{ id: string; tipo: TipoFeedbackDocumento; texto: string | null; autor: string | null; criadoEm: string; tratadoEm: string | null }>;
  podeEditar: boolean;
  administra: boolean;
}

export const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };

export function quando(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR');
}

/**
 * Secao 14: o editor interno e texto com marcacao leve. Linhas que comecam com
 * `#` viram titulo, `-` viram item de lista, o resto e paragrafo. Sem
 * biblioteca de markdown: e o suficiente para POP, instrucao e FAQ, e o que
 * vem de fora entra como anexo.
 */
/** Negrito entre dois asteriscos; o resto sai como veio. */
function Inline({ texto }: { texto: string }) {
  const partes = texto.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {partes.map((p, i) =>
        /^\*\*[^*]+\*\*$/.test(p) ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>,
      )}
    </>
  );
}

type BlocoLeve =
  | { tipo: 'titulo'; nivel: number; texto: string }
  | { tipo: 'aviso'; texto: string }
  | { tipo: 'lista'; ordenada: boolean; itens: string[] }
  | { tipo: 'paragrafo'; linhas: string[] };

/**
 * Marcacao leve do conteudo (M21 §14): "#" titulo, "!" aviso, "-" ou "1." lista,
 * linha em branco separa paragrafos, **negrito**. Lida linha a linha, para o
 * titulo nao engolir o paragrafo que vem colado a ele.
 */
function blocosDe(texto: string): BlocoLeve[] {
  const blocos: BlocoLeve[] = [];
  for (const bruta of texto.replace(/\r\n?/g, '\n').split('\n')) {
    const l = bruta.trimEnd();
    const ultimo = blocos[blocos.length - 1];
    if (l.trim() === '') {
      if (ultimo && ultimo.tipo === 'paragrafo' && ultimo.linhas.length) blocos.push({ tipo: 'paragrafo', linhas: [] });
      continue;
    }
    const titulo = l.match(/^(#{1,3})\s+(.*)$/);
    if (titulo) {
      blocos.push({ tipo: 'titulo', nivel: titulo[1]!.length, texto: titulo[2]! });
      continue;
    }
    const aviso = l.match(/^!\s+(.*)$/);
    if (aviso) {
      blocos.push({ tipo: 'aviso', texto: aviso[1]! });
      continue;
    }
    const item = l.match(/^\s*(?:([-*•])|(\d+[.)]))\s+(.*)$/);
    if (item) {
      const ordenada = Boolean(item[2]);
      if (ultimo && ultimo.tipo === 'lista' && ultimo.ordenada === ordenada) ultimo.itens.push(item[3]!);
      else blocos.push({ tipo: 'lista', ordenada, itens: [item[3]!] });
      continue;
    }
    if (ultimo && ultimo.tipo === 'paragrafo') ultimo.linhas.push(l);
    else blocos.push({ tipo: 'paragrafo', linhas: [l] });
  }
  return blocos.filter((b) => b.tipo !== 'paragrafo' || b.linhas.length > 0);
}

export function TextoLeve({ texto }: { texto: string }) {
  const blocos = blocosDe(texto);
  return (
    <Stack spacing={1.25}>
      {blocos.map((b, i) => {
        if (b.tipo === 'lista') {
          const Tag = b.ordenada ? 'ol' : 'ul';
          return (
            <Tag key={i} style={{ margin: 0, paddingLeft: 22, fontSize: 14, lineHeight: 1.55 }}>
              {b.itens.map((it, j) => (
                <li key={j}>
                  <Inline texto={it} />
                </li>
              ))}
            </Tag>
          );
        }
        if (b.tipo === 'titulo') {
          return (
            <Typography key={i} sx={{ fontSize: b.nivel === 1 ? 18 : b.nivel === 2 ? 16 : 15, fontWeight: 600, mt: 0.5 }}>
              <Inline texto={b.texto} />
            </Typography>
          );
        }
        if (b.tipo === 'aviso') {
          return (
            <Alert key={i} severity="warning">
              <Inline texto={b.texto} />
            </Alert>
          );
        }
        return (
          <Typography key={i} sx={{ fontSize: 14, lineHeight: 1.6 }}>
            {b.linhas.map((l, j) => (
              <span key={j}>
                {j > 0 && <br />}
                <Inline texto={l} />
              </span>
            ))}
          </Typography>
        );
      })}
    </Stack>
  );
}

/** O que se le de um documento: a versao vigente, ou a mais recente quando nao ha vigente. */
export function ConteudoDocumento({ ficha, versao }: { ficha: FichaDocumento; versao?: VersaoDocumento }) {
  const v = versao ?? ficha.versoes.find((x) => x.id === ficha.versaoVigenteId) ?? ficha.versoes[0];
  if (!v) return <Alert severity="info">Documento sem conteúdo.</Alert>;
  return (
    <Box>
      <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1.5 }}>
        Versão {v.numero} · {v.status === 'vigente' ? 'vigente' : `NÃO VIGENTE (${v.status})`}
        {v.publicadaEm ? ` · publicada em ${quando(v.publicadaEm)}` : ''}
        {v.autor ? ` · ${v.autor}` : ''}
      </Typography>
      {v.status !== 'vigente' && (
        <Alert severity="warning" sx={{ mb: 1.5 }}>
          Esta versão não é a orientação operacional padrão (M21 §20).
        </Alert>
      )}
      {v.conteudo && <TextoLeve texto={v.conteudo} />}
      {v.arquivoNome && (
        <Stack direction="row" spacing={1} sx={{ mt: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography sx={{ fontSize: 13 }}>Anexo: {v.arquivoNome}</Typography>
          {ficha.permiteDownload || ficha.administra ? (
            <Button size="small" variant="outlined" href={urlArquivo(`/biblioteca/versoes/${v.id}/anexo`)} target="_blank" rel="noreferrer">
              Abrir anexo
            </Button>
          ) : (
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Só visualização na tela (§91).</Typography>
          )}
        </Stack>
      )}
      {v.linkExterno && (
        <Typography sx={{ fontSize: 13, mt: 2 }}>
          Referência externa:{' '}
          <a href={v.linkExterno} target="_blank" rel="noreferrer">
            {v.linkExterno}
          </a>
        </Typography>
      )}
    </Box>
  );
}

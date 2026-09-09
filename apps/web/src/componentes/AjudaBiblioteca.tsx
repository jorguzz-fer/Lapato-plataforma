import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import MenuBookOutlined from '@mui/icons-material/MenuBookOutlined';
import { CONTEXTO_BIBLIOTECA_LABEL, TIPO_DOCUMENTO_LABEL, type ContextoBiblioteca } from '@lapato/shared';
import { api } from '../api';
import { ConteudoDocumento, type DocumentoResumo, type FichaDocumento } from '../paginas/biblioteca/comum';

/**
 * M21 secoes 51 a 58: "botoes como AJUDA, PROTOCOLO ou CONSULTAR BIBLIOTECA
 * poderao abrir diretamente o conteudo pertinente sem retirar o usuario do
 * fluxo". O botao vive na tela do modulo dono; o conteudo vem da Biblioteca,
 * so o vigente, e so o que declarou este contexto.
 */
export function AjudaBiblioteca({ contexto, permissoes }: { contexto: ContextoBiblioteca; permissoes: string[] }) {
  const [aberto, setAberto] = useState(false);
  const [lista, setLista] = useState<DocumentoResumo[] | null>(null);
  const [ficha, setFicha] = useState<FichaDocumento | null>(null);

  useEffect(() => {
    if (!aberto) return;
    setFicha(null);
    api.get<DocumentoResumo[]>(`/biblioteca/contexto/${contexto}`).then(setLista).catch(() => setLista([]));
  }, [aberto, contexto]);

  if (!permissoes.includes('biblioteca:visualizar')) return null;

  return (
    <>
      <Button size="small" variant="outlined" startIcon={<MenuBookOutlined />} onClick={() => setAberto(true)}>
        Consultar Biblioteca
      </Button>
      <Dialog open={aberto} fullWidth maxWidth="md" onClose={() => setAberto(false)}>
        <DialogTitle>
          {ficha ? `${ficha.codigo} · ${ficha.titulo}` : `Biblioteca · ${CONTEXTO_BIBLIOTECA_LABEL[contexto]}`}
        </DialogTitle>
        <DialogContent dividers>
          {ficha ? (
            <ConteudoDocumento ficha={ficha} />
          ) : lista === null ? (
            <Skeleton variant="rounded" height={80} />
          ) : lista.length === 0 ? (
            <Alert severity="info">Nenhum documento vigente aponta para esta tela. Quem administra a Biblioteca marca o contexto na ficha do documento.</Alert>
          ) : (
            <Stack spacing={1}>
              {lista.map((d) => (
                <Stack
                  key={d.id}
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center', cursor: 'pointer', p: 1, borderRadius: 1, '&:hover': { bgcolor: 'action.hover' } }}
                  onClick={() => api.get<FichaDocumento>(`/biblioteca/documentos/${d.id}`).then(setFicha).catch(() => undefined)}
                >
                  <Typography sx={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: 'text.secondary', minWidth: 110 }}>{d.codigo}</Typography>
                  <Typography sx={{ fontSize: 14, flex: 1 }}>{d.titulo}</Typography>
                  {d.critico && <Chip size="small" color="error" label="Crítico" />}
                  <Chip size="small" variant="outlined" label={TIPO_DOCUMENTO_LABEL[d.tipo]} />
                  <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>v{d.numeroVigente}</Typography>
                </Stack>
              ))}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          {ficha && <Button onClick={() => setFicha(null)}>Voltar à lista</Button>}
          <Button onClick={() => setAberto(false)}>Fechar</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

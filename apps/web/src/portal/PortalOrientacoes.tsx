import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { CATEGORIA_DOCUMENTO_LABEL, TIPO_DOCUMENTO_LABEL, type CategoriaDocumento, type TipoDocumento } from '@lapato/shared';
import { api, urlArquivo } from '../api';
import { TextoLeve } from '../paginas/biblioteca/comum';

interface Orientacao {
  id: string;
  codigo: string;
  titulo: string;
  tipo: TipoDocumento;
  categoria: CategoriaDocumento;
  resumo: string | null;
  versaoId: string;
  numero: string;
  conteudo: string | null;
  linkExterno: string | null;
  temArquivo: boolean;
  arquivoNome: string | null;
  publicadaEm: string | null;
}

/**
 * M21 secoes 59-62: "como coletar, como acondicionar, como identificar,
 * volume minimo, fixadores". So o que a Biblioteca marcou como publico para
 * clientes, na versao vigente - o Portal nao decide o que mostra.
 */
export function PortalOrientacoes() {
  const [lista, setLista] = useState<Orientacao[] | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);

  useEffect(() => {
    api.get<Orientacao[]>('/portal/orientacoes').then(setLista).catch(() => setLista([]));
  }, []);

  return (
    <Stack spacing={2}>
      <Typography variant="h3">Orientações</Typography>
      <Typography sx={{ fontSize: 14, color: 'text.secondary' }}>
        Como coletar, acondicionar e identificar o material antes de enviar ao laboratório.
      </Typography>
      {lista === null ? (
        <Skeleton variant="rounded" height={80} />
      ) : lista.length === 0 ? (
        <Alert severity="info">O laboratório ainda não publicou orientações.</Alert>
      ) : (
        lista.map((o) => (
          <Card key={o.id} sx={{ p: 2 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', cursor: 'pointer' }} onClick={() => setAberta(aberta === o.id ? null : o.id)}>
              <Typography sx={{ fontSize: 15, fontWeight: 600, flex: 1 }}>{o.titulo}</Typography>
              <Chip size="small" variant="outlined" label={TIPO_DOCUMENTO_LABEL[o.tipo]} />
              <Chip size="small" variant="outlined" label={CATEGORIA_DOCUMENTO_LABEL[o.categoria]} />
            </Stack>
            {o.resumo && <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 0.5 }}>{o.resumo}</Typography>}
            {aberta === o.id && (
              <Stack spacing={1.5} sx={{ mt: 1.5 }}>
                {o.conteudo && <TextoLeve texto={o.conteudo} />}
                {o.temArquivo && (
                  <Button size="small" variant="outlined" href={urlArquivo(`/portal/orientacoes/${o.versaoId}/arquivo`)} target="_blank" rel="noreferrer" sx={{ alignSelf: 'flex-start' }}>
                    Abrir {o.arquivoNome ?? 'arquivo'}
                  </Button>
                )}
                {o.linkExterno && (
                  <a href={o.linkExterno} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>{o.linkExterno}</a>
                )}
                <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                  {o.codigo} · versão {o.numero}{o.publicadaEm ? ` · ${new Date(o.publicadaEm).toLocaleDateString('pt-BR')}` : ''}
                </Typography>
              </Stack>
            )}
          </Card>
        ))
      )}
    </Stack>
  );
}

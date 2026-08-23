import { useEffect, useState } from 'react';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { api, type SolicitacaoPortal } from '../api';

/**
 * M04 secoes 30-31 - solicitacoes do cliente.
 *
 * O Portal e a INTERFACE das solicitacoes; elas pertencem ao M10 (secao 83).
 * Nesta entrega o cliente acompanha o que existe; abrir solicitacao pelo Portal
 * entra junto com a conversa estruturada (secao 32), que e o mesmo mecanismo.
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

export function PortalSolicitacoes() {
  const [itens, setItens] = useState<SolicitacaoPortal[] | null>(null);

  useEffect(() => {
    api
      .get<SolicitacaoPortal[]>('/portal/solicitacoes')
      .then(setItens)
      .catch(() => setItens([]));
  }, []);

  if (itens === null) return <Skeleton variant="rounded" height={180} />;

  return (
    <Stack spacing={2.5}>
      <Typography variant="h3">Solicitações</Typography>

      {itens.length === 0 && (
        <Typography sx={{ fontSize: 14, color: 'text.secondary' }}>
          Nenhuma solicitação registrada para os seus exames.
        </Typography>
      )}

      <Stack spacing={1.5}>
        {itens.map((s) => (
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
                  <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                    {s.paciente} · {s.casoIdentificador}
                  </Typography>
                </Stack>
                <Typography sx={{ fontSize: 14, mt: 0.5 }}>{s.descricao}</Typography>
              </div>
              <Chip
                size="small"
                label={STATUS_EXTERNO_SOLICITACAO[s.status] ?? 'Em análise'}
                sx={{ alignSelf: { xs: 'flex-start', md: 'center' } }}
              />
            </Stack>
          </Card>
        ))}
      </Stack>
    </Stack>
  );
}

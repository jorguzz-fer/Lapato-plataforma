import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ChevronRight from '@mui/icons-material/ChevronRight';
import AutoAwesome from '@mui/icons-material/AutoAwesomeOutlined';
import { nivelIa, raio, shell } from '@lapato/design-tokens';
import type { NivelIa } from '@lapato/shared';
import { api, type StatusIa } from '../api';

/**
 * Painel lateral do LAPATO Copiloto (M17 secao 8).
 *
 * Requisitos que a documentacao trata como estruturais, e nao como enfeite:
 *
 * - ocupa ~30% da tela, com ~70% para a area de trabalho;
 * - pode ser expandido, reduzido, recolhido, fixado ou ocultado;
 * - o conteudo muda por modulo e etapa - **nao existe uma interface generica de
 *   chatbot** (secao 9);
 * - quando a IA esta indisponivel, mostra o indicador e o trabalho continua
 *   normalmente (secoes 110-112).
 */

/**
 * M07 exige indicadores que **nao dependam exclusivamente de cor**. Cada nivel
 * carrega cor, simbolo e rotulo textual - os tres juntos.
 */
const NIVEL: Record<NivelIa, { cor: string; simbolo: string; rotulo: string }> = {
  informacao: { cor: nivelIa.informacao, simbolo: 'i', rotulo: 'Informação' },
  sugestao: { cor: nivelIa.sugestao, simbolo: '✦', rotulo: 'Sugestão' },
  atencao: { cor: nivelIa.atencao, simbolo: '!', rotulo: 'Atenção' },
  critico: { cor: nivelIa.critico, simbolo: '⨯', rotulo: 'Crítico' },
};

export interface CartaoPainel {
  id: string;
  nivel: NivelIa;
  titulo: string;
  corpo: string;
  fontes?: string[];
  inferencia?: boolean;
}

interface Props {
  modulo: string;
  etapa?: string;
  /** Achados do Guardian, que existem mesmo sem Copiloto disponível. */
  cartoes?: CartaoPainel[];
  recolhido: boolean;
  onAlternar: () => void;
}

export function PainelCopiloto({ modulo, etapa, cartoes = [], recolhido, onAlternar }: Props) {
  const [status, setStatus] = useState<StatusIa | null>(null);

  useEffect(() => {
    api
      .get<StatusIa>('/ia/status')
      .then(setStatus)
      .catch(() => setStatus({ disponivel: false, provedor: 'indisponivel' }));
  }, []);

  if (recolhido) {
    return (
      <ButtonBase
        onClick={onAlternar}
        aria-label="Abrir painel do Copiloto"
        sx={{
          position: 'fixed',
          right: 0,
          top: '50%',
          transform: 'translateY(-50%)',
          px: 1,
          py: 3,
          gap: 1,
          flexDirection: 'column',
          borderRadius: `${raio.medio}px 0 0 ${raio.medio}px`,
          border: '1px solid',
          borderRight: 'none',
          borderColor: 'divider',
          backgroundColor: 'background.paper',
          boxShadow: 3,
          zIndex: 1200,
        }}
      >
        <AutoAwesome sx={{ fontSize: 16, color: 'primary.main' }} />
        <Typography sx={{ fontSize: 11.5, writingMode: 'vertical-rl' }}>Copiloto</Typography>
      </ButtonBase>
    );
  }

  return (
    <Box
      component="aside"
      aria-label="LAPATO Copiloto"
      sx={{
        // 30% da tela, conforme M17 seção 8.
        width: shell.copilotoLargura,
        minWidth: 300,
        display: 'flex',
        flexDirection: 'column',
        borderLeft: '1px solid',
        borderColor: 'divider',
        backgroundColor: 'background.paper',
      }}
    >
      <Stack
        direction="row"
        component="header"
        sx={{
          px: 2,
          py: 1.5,
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Box>
          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
            <AutoAwesome sx={{ fontSize: 15, color: 'primary.main' }} />
            <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>LAPATO Copiloto</Typography>
          </Stack>
          <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>
            {etapa ? `${modulo} · ${etapa}` : modulo}
          </Typography>
        </Box>

        <IconButton onClick={onAlternar} size="small" aria-label="Recolher painel do Copiloto">
          <ChevronRight fontSize="small" />
        </IconButton>
      </Stack>

      <Stack spacing={1.5} sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
        {status && !status.disponivel && (
          /**
           * M17 seções 110-112: o indicador é obrigatório, e o trabalho segue.
           * A ausência do Copiloto não impede cadastrar, descrever, diagnosticar,
           * assinar ou liberar.
           */
          <Alert severity="info" variant="outlined" role="status" sx={{ fontSize: 12 }}>
            <strong>Assistência de IA temporariamente indisponível.</strong> O trabalho continua
            normalmente; o LAPATO Guardian permanece ativo.
          </Alert>
        )}

        {cartoes.length === 0 && (
          <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
            Nenhum apontamento para esta etapa.
          </Typography>
        )}

        {cartoes.map((c) => {
          const n = NIVEL[c.nivel];
          return (
            <Box
              key={c.id}
              component="article"
              sx={{
                p: 1.75,
                borderRadius: `${raio.medio}px`,
                border: '1px solid',
                borderColor: 'divider',
                // A barra lateral colorida identifica o nível de relance; o
                // símbolo e o rótulo abaixo garantem que não seja só cor.
                borderLeft: `4px solid ${n.cor}`,
              }}
            >
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
                <Box
                  aria-hidden
                  sx={{
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 10,
                    fontWeight: 700,
                    color: '#fff',
                    backgroundColor: n.cor,
                  }}
                >
                  {n.simbolo}
                </Box>
                <Typography
                  sx={{ fontSize: 11, fontWeight: 600, color: n.cor, textTransform: 'uppercase' }}
                >
                  {n.rotulo}
                </Typography>
              </Stack>

              <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{c.titulo}</Typography>
              <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: 0.5 }}>
                {c.corpo}
              </Typography>

              {/**
               * M17 seção 15: a sugestão precisa dizer que veio da IA, com quais
               * dados, de quais fontes, e se houve inferência — para não ser
               * confundida com dado observado.
               */}
              {(c.fontes?.length || c.inferencia) && (
                <Typography
                  component="footer"
                  sx={{ mt: 1, fontSize: 11, color: 'text.secondary' }}
                >
                  {c.fontes?.length ? `Fontes: ${c.fontes.join(', ')}. ` : null}
                  {c.inferencia ? 'Contém inferência.' : 'Baseado em dados do caso.'}
                </Typography>
              )}
            </Box>
          );
        })}
      </Stack>
    </Box>
  );
}

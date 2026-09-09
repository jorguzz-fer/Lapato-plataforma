import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import {
  MARGEM_CIRURGICA_LABEL,
  RESSALVA_RECEBIMENTO_LABEL,
  type MargemCirurgica,
  type RessalvaRecebimento,
} from '@lapato/shared';
import { api, urlArquivo, type Dossie, type ImagemDoCaso } from '../api';
import { DialogoIdentificacao } from './IdentificacaoDoAnimal';

interface CasseteResumo {
  id: string;
  identificador: string;
  amostraId: string;
  fragmentos: number | null;
}

/**
 * Cabecalho do material para a bancada (documento do Hugo): responsavel,
 * cliente, o que veio em cada pote, as ressalvas do recebimento e as nao
 * conformidades da triagem, e as fotos da requisicao e dos potes. "Isso
 * permite ao funcionario conferir as informacoes e evitar troca de amostras
 * de pacientes com mesmo nome."
 */
const TIPOS_DE_ENTRADA = new Set(['requisicao', 'recebimento', 'triagem', 'documento']);

export function CabecalhoDoMaterial({
  dossie,
  podeCorrigir = false,
  aoMudar,
}: {
  dossie: Dossie;
  /** Terceira revisão: quem está na bancada corrige o cadastro sem sair dela. */
  podeCorrigir?: boolean;
  aoMudar?: () => void;
}) {
  const [fotos, setFotos] = useState<ImagemDoCaso[]>([]);
  const [ampliada, setAmpliada] = useState<ImagemDoCaso | null>(null);
  const [cassetes, setCassetes] = useState<CasseteResumo[]>([]);
  const [corrigindo, setCorrigindo] = useState(false);

  /**
   * Terceira revisão com o Hugo: "aquela amostra tem quatro fragmentos e esses
   * fragmentos foram colocados em dois cassetes" — quem lê a lâmina confere
   * que viu todos os fragmentos e todas as lâminas. Fica aqui, não no laudo.
   */
  useEffect(() => {
    api
      .get<CasseteResumo[]>(`/macroscopia/casos/${dossie.caso.id}/cassetes`)
      .then(setCassetes)
      .catch(() => setCassetes([]));
  }, [dossie.caso.id, dossie.amostras]);

  useEffect(() => {
    api
      .get<ImagemDoCaso[]>(`/imagens/casos/${dossie.caso.id}`)
      .then((todas) => setFotos(todas.filter((i) => TIPOS_DE_ENTRADA.has(i.tipo))))
      .catch(() => setFotos([]));
  }, [dossie.caso.id]);

  const ressalvas = dossie.recipientes.filter((r) => r.ressalva);
  const ncs = dossie.naoConformidades ?? [];

  return (
    <Box sx={{ mt: 2 }}>
      <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
        <Campo
          rotulo={dossie.caso.modalidade === 'particular' ? 'Particular · responsável' : 'Cliente'}
          valor={
            dossie.caso.modalidade === 'particular'
              ? (dossie.responsavel?.nome ?? '—')
              : dossie.cliente.nomeFantasia
          }
        />
        {dossie.caso.modalidade !== 'particular' && dossie.responsavel && (
          <Campo rotulo="Responsável" valor={dossie.responsavel.nome} />
        )}
        {dossie.paciente.raca && <Campo rotulo="Raça" valor={dossie.paciente.raca} />}
        {(dossie.paciente.idadeInformada || dossie.paciente.sexo) && (
          <Campo
            rotulo="Idade · sexo"
            valor={[dossie.paciente.idadeInformada, dossie.paciente.sexo].filter(Boolean).join(' · ')}
          />
        )}
        <Campo
          rotulo="Entrada"
          valor={new Date(dossie.caso.entradaEm).toLocaleDateString('pt-BR')}
        />
        {podeCorrigir && aoMudar && (
          <Button size="small" onClick={() => setCorrigindo(true)} sx={{ alignSelf: 'flex-start', ml: 'auto' }}>
            Corrigir identificação
          </Button>
        )}
      </Stack>

      <Stack spacing={0.5} sx={{ mt: 1.5 }}>
        {dossie.recipientes.map((r) => (
          <Typography key={r.id} sx={{ fontSize: 12.5 }}>
            <Box component="span" sx={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11.5, color: 'text.secondary' }}>
              {r.identificador.slice(r.identificador.lastIndexOf('-') + 1)}
            </Box>{' '}
            {[
              r.tipo,
              r.fixador ? `em ${r.fixador}` : null,
              r.quantidadeRecebida !== null ? `${r.quantidadeRecebida} recebido(s)` : null,
              r.fragmentosMultiplos
                ? 'múltiplos fragmentos'
                : r.fragmentosRecebidos !== null
                  ? `${r.fragmentosRecebidos} fragmento(s)`
                  : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            {dossie.amostras
              .filter((a) => a.recipienteId === r.id)
              .map(
                (a) =>
                  ` — ${a.descricao ?? 'sem descrição'}${a.regiaoAnatomica ? `, ${a.regiaoAnatomica}` : ''}${
                    a.margemCirurgica && a.margemCirurgica !== 'sem_margem'
                      ? ` (${MARGEM_CIRURGICA_LABEL[a.margemCirurgica as MargemCirurgica] ?? a.margemCirurgica})`
                      : ''
                  }`,
              )
              .join('')}
          </Typography>
        ))}
      </Stack>

      {cassetes.length > 0 && (
        <Stack spacing={0.25} sx={{ mt: 1.25 }}>
          {dossie.amostras
            .map((a) => ({ amostra: a, seus: cassetes.filter((c) => c.amostraId === a.id) }))
            .filter(({ seus }) => seus.length > 0)
            .map(({ amostra, seus }) => {
              const fragmentos = seus.reduce((t, c) => t + (c.fragmentos ?? 0), 0);
              const semContagem = seus.some((c) => c.fragmentos == null);
              return (
                <Typography key={amostra.id} sx={{ fontSize: 12.5 }}>
                  <Box component="span" sx={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11.5, color: 'text.secondary' }}>
                    {amostra.letra}
                  </Box>{' '}
                  {seus.length} {seus.length === 1 ? 'cassete' : 'cassetes'}
                  {semContagem ? '' : ` · ${fragmentos} ${fragmentos === 1 ? 'fragmento' : 'fragmentos'}`}
                  {': '}
                  {seus
                    .map(
                      (c) =>
                        `${c.identificador.slice(c.identificador.lastIndexOf('-') + 1)}${c.fragmentos != null ? ` (${c.fragmentos})` : ''}`,
                    )
                    .join(', ')}
                </Typography>
              );
            })}
        </Stack>
      )}

      {(ressalvas.length > 0 || ncs.length > 0) && (
        <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap', mt: 1.5 }}>
          {ressalvas.map((r) => (
            <Chip
              key={r.id}
              size="small"
              color="warning"
              variant="outlined"
              label={`${r.identificador.slice(r.identificador.lastIndexOf('-') + 1)}: ${
                RESSALVA_RECEBIMENTO_LABEL[r.ressalva as RessalvaRecebimento] ?? r.ressalva
              }${r.ressalvaDetalhe ? ` — ${r.ressalvaDetalhe}` : ''}`}
            />
          ))}
          {ncs.map((n) => (
            <Chip
              key={n.id}
              size="small"
              color={n.gravidade === 'critica' || n.gravidade === 'alta' ? 'error' : 'warning'}
              label={`Triagem: ${n.tipo.replaceAll('_', ' ')} — ${n.descricao}`}
            />
          ))}
        </Stack>
      )}

      {fotos.length > 0 && (
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', mt: 1.5 }}>
          {fotos.map((f) => (
            <Box
              key={f.id}
              component="button"
              type="button"
              onClick={() => setAmpliada(f)}
              sx={{ p: 0, border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'transparent', cursor: 'zoom-in', lineHeight: 0 }}
              aria-label={`Foto: ${f.tipo}${f.legenda ? ` — ${f.legenda}` : ''}`}
            >
              <Box
                component="img"
                src={urlArquivo(`/imagens/${f.id}/arquivo?tamanho=miniatura`)}
                alt={f.legenda ?? f.tipo}
                sx={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 1, display: 'block' }}
              />
            </Box>
          ))}
        </Stack>
      )}

      {aoMudar && (
        <DialogoIdentificacao dados={dossie} aberto={corrigindo} aoFechar={() => setCorrigindo(false)} aoMudar={aoMudar} />
      )}

      <Dialog open={ampliada !== null} onClose={() => setAmpliada(null)} maxWidth="lg">
        {ampliada && (
          <Box
            component="img"
            src={urlArquivo(`/imagens/${ampliada.id}/arquivo`)}
            alt={ampliada.legenda ?? ampliada.tipo}
            sx={{ maxWidth: '90vw', maxHeight: '85vh', display: 'block' }}
          />
        )}
      </Dialog>
    </Box>
  );
}

function Campo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <Box>
      <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{rotulo}</Typography>
      <Typography sx={{ fontSize: 13 }}>{valor}</Typography>
    </Box>
  );
}

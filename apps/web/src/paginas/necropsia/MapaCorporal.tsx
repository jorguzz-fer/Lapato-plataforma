import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import {
  ESCALA_MAPA_CORPORAL,
  TIPO_MARCADOR_CORPORAL,
  TIPO_MARCADOR_CORPORAL_LABEL,
  VISTA_MAPA_CORPORAL,
  VISTA_MAPA_CORPORAL_LABEL,
  type TipoMarcadorCorporal,
  type VistaMapaCorporal,
} from '@lapato/shared';
import { api, type BancadaNecropsia, type MarcadorCorporal } from '../../api';

const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };

/** Cor por tipo de marcador; a mesma na silhueta e na lista. */
const COR_TIPO: Record<TipoMarcadorCorporal, string> = {
  ferida: '#c62828',
  escoriacao: '#ef6c00',
  hematoma: '#6a1b9a',
  incisao: '#1565c0',
  massa: '#2e7d32',
  fratura_suspeita: '#37474f',
  outra: '#8d6e63',
};

/**
 * Silhueta generica de quadrupede. A posicao guardada e por mil da vista
 * (secao 62), entao a silhueta pode ser trocada por outra especie depois sem
 * invalidar o que ja foi marcado. O viewBox e 1000 x 1000 de proposito: um
 * clique em (x, y) do SVG ja e a posicao por mil.
 */
function Silhueta({ vista }: { vista: VistaMapaCorporal }) {
  const cor = 'var(--mapa-corpo, #d7d2c8)';
  if (vista === 'lateral_esquerda' || vista === 'lateral_direita') {
    // Cabeca a esquerda na lateral esquerda; espelhada na direita.
    const espelho = vista === 'lateral_direita' ? 'translate(1000 0) scale(-1 1)' : undefined;
    return (
      <g fill={cor} transform={espelho}>
        <ellipse cx="530" cy="520" rx="280" ry="150" />
        <polygon points="300,430 330,600 200,470 170,400" />
        <ellipse cx="205" cy="385" rx="95" ry="78" />
        <ellipse cx="112" cy="418" rx="58" ry="36" />
        <ellipse cx="250" cy="318" rx="26" ry="58" transform="rotate(-20 250 318)" />
        <rect x="335" y="590" width="58" height="280" rx="26" />
        <rect x="405" y="600" width="54" height="270" rx="24" />
        <rect x="655" y="600" width="54" height="270" rx="24" />
        <rect x="725" y="590" width="58" height="280" rx="26" />
        <path d="M790 445 C 860 400, 910 360, 925 300 C 932 330, 900 420, 820 470 Z" />
        <text x="205" y="960" fontSize="30" fill="#7a7368" textAnchor="middle">
          cabeça
        </text>
        <text x="850" y="960" fontSize="30" fill="#7a7368" textAnchor="middle">
          cauda
        </text>
      </g>
    );
  }
  // Dorsal e ventral: cabeca em cima. Ventral e a mesma silhueta com o ventre claro.
  return (
    <g fill={cor}>
      <ellipse cx="500" cy="545" rx="160" ry="290" />
      <polygon points="420,290 580,290 560,340 440,340" />
      <ellipse cx="500" cy="200" rx="95" ry="88" />
      <ellipse cx="500" cy="112" rx="48" ry="42" />
      <ellipse cx="415" cy="160" rx="26" ry="55" transform="rotate(25 415 160)" />
      <ellipse cx="585" cy="160" rx="26" ry="55" transform="rotate(-25 585 160)" />
      <rect x="312" y="330" width="60" height="200" rx="28" transform="rotate(12 342 430)" />
      <rect x="628" y="330" width="60" height="200" rx="28" transform="rotate(-12 658 430)" />
      <rect x="312" y="640" width="60" height="200" rx="28" transform="rotate(-12 342 740)" />
      <rect x="628" y="640" width="60" height="200" rx="28" transform="rotate(12 658 740)" />
      <rect x="484" y="810" width="32" height="150" rx="16" />
      {vista === 'ventral' && <ellipse cx="500" cy="560" rx="95" ry="220" fill="#ece8e0" />}
      <text x="150" y="530" fontSize="30" fill="#7a7368" textAnchor="middle">
        {vista === 'dorsal' ? 'E' : 'D'}
      </text>
      <text x="850" y="530" fontSize="30" fill="#7a7368" textAnchor="middle">
        {vista === 'dorsal' ? 'D' : 'E'}
      </text>
    </g>
  );
}

interface Rascunho {
  id?: string;
  vista: VistaMapaCorporal;
  x: number;
  y: number;
  tipo: TipoMarcadorCorporal;
  descricao: string;
  lesaoId: string;
  criarLesao: boolean;
  lesaoOrgao: string;
  lesaoDescricao: string;
}

/**
 * Mapa corporal (M14 secao 62). Clique na silhueta cria um marcador; clique
 * no marcador abre para mover, retipar, ligar a uma lesao ou desfazer. O
 * marcador e um lembrete visual - a lesao continua sendo o registro clinico.
 */
export function MapaCorporal({
  banca,
  editavel,
  agir,
  ocupado,
}: {
  banca: BancadaNecropsia;
  editavel: boolean;
  agir: (a: () => Promise<unknown>, p: string) => Promise<void>;
  ocupado: boolean;
}) {
  const [vista, setVista] = useState<VistaMapaCorporal>('lateral_esquerda');
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const marcadores = banca.marcadores ?? [];
  const daVista = marcadores.filter((m) => m.vista === vista);
  const lesaoPorId = new Map(banca.lesoes.map((l) => [l.id, l]));
  const numero = (m: MarcadorCorporal) => marcadores.findIndex((x) => x.id === m.id) + 1;

  function clicarSilhueta(e: React.MouseEvent<SVGSVGElement>) {
    if (!editavel || ocupado) return;
    const svg = e.currentTarget;
    const caixa = svg.getBoundingClientRect();
    const x = Math.round(((e.clientX - caixa.left) / caixa.width) * ESCALA_MAPA_CORPORAL);
    const y = Math.round(((e.clientY - caixa.top) / caixa.height) * ESCALA_MAPA_CORPORAL);
    setRascunho({
      vista,
      x,
      y,
      tipo: 'hematoma',
      descricao: '',
      lesaoId: '',
      criarLesao: false,
      lesaoOrgao: 'Pele e subcutâneo',
      lesaoDescricao: '',
    });
  }

  function abrirExistente(m: MarcadorCorporal) {
    setRascunho({
      id: m.id,
      vista: m.vista as VistaMapaCorporal,
      x: m.x,
      y: m.y,
      tipo: m.tipo as TipoMarcadorCorporal,
      descricao: m.descricao ?? '',
      lesaoId: m.lesaoId ?? '',
      criarLesao: false,
      lesaoOrgao: 'Pele e subcutâneo',
      lesaoDescricao: '',
    });
  }

  async function salvar() {
    if (!rascunho) return;
    const r = rascunho;
    setRascunho(null);
    if (r.id) {
      await agir(
        () =>
          api.post(`/necropsia/marcadores/${r.id}`, {
            tipo: r.tipo,
            descricao: r.descricao || null,
            lesaoId: r.lesaoId || null,
          }),
        'Não foi possível salvar o marcador.',
      );
      return;
    }
    await agir(
      () =>
        api.post(`/necropsia/${banca.necropsia.id}/marcadores`, {
          tipo: r.tipo,
          vista: r.vista,
          x: r.x,
          y: r.y,
          descricao: r.descricao || null,
          lesaoId: !r.criarLesao && r.lesaoId ? r.lesaoId : null,
          lesao: r.criarLesao
            ? {
                orgao: r.lesaoOrgao,
                descricao: r.lesaoDescricao || r.descricao || TIPO_MARCADOR_CORPORAL_LABEL[r.tipo],
              }
            : null,
        }),
      'Não foi possível marcar.',
    );
  }

  return (
    <Card sx={{ p: 2.5, mb: 2 }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
        <Typography sx={{ fontSize: 15, fontWeight: 600 }}>Mapa corporal</Typography>
        <Tabs value={vista} onChange={(_, v) => setVista(v as VistaMapaCorporal)} sx={{ minHeight: 34 }}>
          {VISTA_MAPA_CORPORAL.map((v) => (
            <Tab key={v} value={v} label={VISTA_MAPA_CORPORAL_LABEL[v]} sx={{ minHeight: 34, py: 0, fontSize: 12.5 }} />
          ))}
        </Tabs>
      </Stack>
      <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mb: 1.5 }}>
        {editavel
          ? 'Clique na silhueta para marcar ferida, escoriação, hematoma, incisão, massa ou fratura suspeita. Cada marcador pode apontar para uma lesão.'
          : 'Marcações do exame externo. A lesão apontada por cada uma está na lista de lesões.'}
      </Typography>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '360px 1fr' }, gap: 2, alignItems: 'start' }}>
        <Box
          sx={{
            '--mapa-corpo': (t) => (t.palette.mode === 'dark' ? '#4a4640' : '#d7d2c8'),
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1.5,
            overflow: 'hidden',
            bgcolor: 'background.default',
          }}
        >
          <svg
            viewBox={`0 0 ${ESCALA_MAPA_CORPORAL} ${ESCALA_MAPA_CORPORAL}`}
            width="100%"
            role="img"
            aria-label={`Silhueta, vista ${VISTA_MAPA_CORPORAL_LABEL[vista]}`}
            style={{ display: 'block', cursor: editavel ? 'crosshair' : 'default' }}
            onClick={clicarSilhueta}
          >
            <Silhueta vista={vista} />
            {daVista.map((m) => (
              <g
                key={m.id}
                transform={`translate(${m.x} ${m.y})`}
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                  e.stopPropagation();
                  abrirExistente(m);
                }}
              >
                <circle r="26" fill={COR_TIPO[m.tipo as TipoMarcadorCorporal] ?? '#8d6e63'} stroke="#fff" strokeWidth="5" />
                <text y="10" fontSize="28" fontWeight="700" fill="#fff" textAnchor="middle">
                  {numero(m)}
                </text>
              </g>
            ))}
          </svg>
        </Box>

        <Box>
          {marcadores.length === 0 ? (
            <Alert severity="info">Nenhuma marcação no mapa.</Alert>
          ) : (
            <Stack spacing={0.75}>
              {marcadores.map((m) => {
                const lesao = m.lesaoId ? lesaoPorId.get(m.lesaoId) : null;
                return (
                  <Stack
                    key={m.id}
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center', flexWrap: 'wrap', opacity: m.vista === vista ? 1 : 0.6 }}
                  >
                    <Box
                      sx={{
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        bgcolor: COR_TIPO[m.tipo as TipoMarcadorCorporal],
                        color: '#fff',
                        fontSize: 12,
                        fontWeight: 700,
                        display: 'grid',
                        placeItems: 'center',
                      }}
                    >
                      {numero(m)}
                    </Box>
                    <Typography sx={{ fontSize: 13, fontWeight: 500 }}>
                      {TIPO_MARCADOR_CORPORAL_LABEL[m.tipo as TipoMarcadorCorporal] ?? m.tipo}
                    </Typography>
                    <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                      {VISTA_MAPA_CORPORAL_LABEL[m.vista as VistaMapaCorporal]}
                    </Typography>
                    {lesao ? (
                      <Chip size="small" variant="outlined" label={`${lesao.codigo} · ${lesao.orgao}`} sx={{ ...MONO, fontSize: 11.5 }} />
                    ) : (
                      <Chip size="small" variant="outlined" color="default" label="Sem lesão" sx={{ fontSize: 11.5 }} />
                    )}
                    {m.descricao && (
                      <Typography sx={{ fontSize: 12.5, color: 'text.secondary', width: '100%', pl: 3.75 }}>
                        {m.descricao}
                      </Typography>
                    )}
                    {editavel && (
                      <Button size="small" onClick={() => abrirExistente(m)} sx={{ ml: 'auto' }}>
                        Editar
                      </Button>
                    )}
                  </Stack>
                );
              })}
            </Stack>
          )}
        </Box>
      </Box>

      <Dialog open={rascunho !== null} onClose={() => setRascunho(null)} maxWidth="xs" fullWidth>
        {rascunho && (
          <>
            <DialogTitle sx={{ fontSize: 16 }}>
              {rascunho.id ? 'Marcador' : 'Nova marcação'} · {VISTA_MAPA_CORPORAL_LABEL[rascunho.vista]}
            </DialogTitle>
            <DialogContent>
              <Stack spacing={2} sx={{ pt: 1 }}>
                <TextField
                  select
                  size="small"
                  label="Tipo"
                  value={rascunho.tipo}
                  onChange={(e) => setRascunho({ ...rascunho, tipo: e.target.value as TipoMarcadorCorporal })}
                >
                  {TIPO_MARCADOR_CORPORAL.map((t) => (
                    <MenuItem key={t} value={t}>
                      {TIPO_MARCADOR_CORPORAL_LABEL[t]}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  size="small"
                  label="Descrição"
                  value={rascunho.descricao}
                  onChange={(e) => setRascunho({ ...rascunho, descricao: e.target.value })}
                  multiline
                  minRows={2}
                />
                {!rascunho.criarLesao && (
                  <TextField
                    select
                    size="small"
                    label="Aponta para a lesão"
                    value={rascunho.lesaoId}
                    onChange={(e) => setRascunho({ ...rascunho, lesaoId: e.target.value })}
                  >
                    <MenuItem value="">Nenhuma</MenuItem>
                    {banca.lesoes.map((l) => (
                      <MenuItem key={l.id} value={l.id}>
                        {l.codigo} · {l.orgao}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
                {!rascunho.id && (
                  <FormControlLabel
                    control={
                      <Switch
                        size="small"
                        checked={rascunho.criarLesao}
                        onChange={(e) => setRascunho({ ...rascunho, criarLesao: e.target.checked })}
                      />
                    }
                    label={<Typography sx={{ fontSize: 13 }}>Criar a lesão agora (ganha código L)</Typography>}
                  />
                )}
                {rascunho.criarLesao && (
                  <>
                    <TextField
                      size="small"
                      label="Órgão ou região"
                      value={rascunho.lesaoOrgao}
                      onChange={(e) => setRascunho({ ...rascunho, lesaoOrgao: e.target.value })}
                    />
                    <TextField
                      size="small"
                      label="Descrição da lesão"
                      value={rascunho.lesaoDescricao}
                      onChange={(e) => setRascunho({ ...rascunho, lesaoDescricao: e.target.value })}
                      helperText="Se vazia, usa a descrição do marcador."
                      multiline
                      minRows={2}
                    />
                  </>
                )}
              </Stack>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2 }}>
              {rascunho.id && (
                <Button
                  color="error"
                  disabled={ocupado}
                  onClick={() => {
                    const id = rascunho.id;
                    setRascunho(null);
                    void agir(() => api.post(`/necropsia/marcadores/${id}/remocao`, {}), 'Não foi possível desfazer.');
                  }}
                  sx={{ mr: 'auto' }}
                >
                  Desfazer marcação
                </Button>
              )}
              <Button onClick={() => setRascunho(null)}>Cancelar</Button>
              <Button
                variant="contained"
                disabled={ocupado || (rascunho.criarLesao && !rascunho.lesaoOrgao.trim())}
                onClick={() => void salvar()}
              >
                Salvar
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Card>
  );
}

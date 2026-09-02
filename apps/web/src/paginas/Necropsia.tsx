import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddOutlined from '@mui/icons-material/AddOutlined';
import {
  CAVIDADE_NECROPSIA,
  CAVIDADE_NECROPSIA_LABEL,
  CLASSIFICACAO_LESAO,
  CLASSIFICACAO_LESAO_LABEL,
  CONSERVACAO_NECROPSIA,
  CONSERVACAO_NECROPSIA_LABEL,
  ESTADO_EXAME_ORGAO,
  ESTADO_EXAME_ORGAO_LABEL,
  GRAU_CERTEZA_CAUSA,
  GRAU_CERTEZA_CAUSA_LABEL,
  LIMITACAO_NECROPSIA,
  LIMITACAO_NECROPSIA_LABEL,
  MECANISMO_TERMINAL,
  MECANISMO_TERMINAL_LABEL,
  MODALIDADE_NECROPSIA,
  MODALIDADE_NECROPSIA_LABEL,
  RELACAO_LESAO_LABEL,
  type CavidadeNecropsia,
  type ClassificacaoLesao,
  type EstadoExameOrgao,
  type GrauCertezaCausa,
} from '@lapato/shared';
import { api, ErroApi, type BancadaNecropsia, type Dossie } from '../api';
import { BloqueioGuardian } from './BloqueioGuardian';

/**
 * M14 - bancada de necropsia.
 *
 * A necropsia nao termina num diagnostico de lesao: termina numa reconstrucao
 * de por que o animal morreu. A tela e organizada nessa ordem - exame externo,
 * orgao por orgao, lesoes, ligacoes entre elas, causa mortis - porque e a ordem
 * do raciocinio, nao so a do formulario.
 *
 * Duas coisas aparecem aqui de propostio, e nao sao decoracao:
 *
 * - **O contador de nao examinados.** A secao 72 pede checklist de completude,
 *   e o numero que importa e o dos orgaos que ficaram de fora - e sobre eles
 *   que a conclusao vai silenciar.
 * - **A conferencia do Guardian antes do clique.** Concluir e afirmar por que
 *   o animal morreu; ver o que o Guardian achou depois de ser barrado e tarde.
 */

const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };

const COR_CLASSIFICACAO: Partial<
  Record<ClassificacaoLesao, 'default' | 'error' | 'warning' | 'info'>
> = {
  processo_principal: 'error',
  processo_secundario: 'warning',
  contribuinte: 'warning',
  incidental: 'info',
  post_mortem: 'default',
  artefato: 'default',
};

export function Necropsia({ permissoes }: { permissoes: string[] }) {
  const { id } = useParams<{ id: string }>();
  const [dossie, setDossie] = useState<Dossie | null>(null);
  const [banca, setBanca] = useState<BancadaNecropsia | null>(null);
  const [carregado, setCarregado] = useState(false);
  const [conferencia, setConferencia] = useState<
    Array<{ codigo: string; nivel: string; mensagem: string; comoResolver?: string }>
  >([]);
  const [erro, setErro] = useState<string | null>(null);
  const [bloqueio, setBloqueio] = useState<ErroApi | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const podeExecutar = permissoes.includes('necropsia:executar');
  const podeConcluir = permissoes.includes('necropsia:concluir');

  const recarregar = useCallback(async () => {
    const dados = await api.get<BancadaNecropsia | null>(`/necropsia/casos/${id}`);
    setBanca(dados);
    if (dados) {
      await api
        .get<typeof conferencia>(`/necropsia/${dados.necropsia.id}/conferencia`)
        .then(setConferencia)
        .catch(() => setConferencia([]));
    }
  }, [id]);

  useEffect(() => {
    Promise.all([
      api.get<Dossie>(`/casos/${id}`).then(setDossie),
      recarregar(),
    ])
      .catch(() => setErro('Não foi possível carregar a necropsia.'))
      .finally(() => setCarregado(true));
  }, [id, recarregar]);

  async function agir(acao: () => Promise<unknown>, padrao: string) {
    setOcupado(true);
    setErro(null);
    setBloqueio(null);
    try {
      await acao();
      await recarregar();
    } catch (e) {
      if (e instanceof ErroApi && e.bloqueadoPeloGuardian) setBloqueio(e);
      else setErro(e instanceof ErroApi ? e.detalhe : padrao);
    } finally {
      setOcupado(false);
    }
  }

  if (!carregado || !dossie) {
    return erro ? (
      <Alert severity="error">{erro}</Alert>
    ) : (
      <Stack spacing={2} sx={{ maxWidth: 940 }}>
        <Skeleton variant="rounded" height={70} />
        <Skeleton variant="rounded" height={320} />
      </Stack>
    );
  }

  if (!banca) {
    return (
      <Abertura
        dossie={dossie}
        podeExecutar={podeExecutar}
        aoAbrir={(dados) =>
          agir(() => api.post(`/necropsia/casos/${id}`, dados), 'Não foi possível abrir a necropsia.')
        }
        ocupado={ocupado}
        erro={erro}
      />
    );
  }

  const concluida = banca.necropsia.concluidaEm !== null;
  const editavel = podeExecutar && !concluida;
  const criticos = conferencia.filter((a) => a.nivel === 'critico');

  return (
    <Box sx={{ maxWidth: 940 }}>
      <Stack
        direction="row"
        sx={{ mb: 0.5, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}
      >
        <Typography variant="h2">Necropsia</Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Chip
            size="small"
            variant="outlined"
            label={
              MODALIDADE_NECROPSIA_LABEL[
                banca.necropsia.modalidade as keyof typeof MODALIDADE_NECROPSIA_LABEL
              ] ?? banca.necropsia.modalidade
            }
          />
          {concluida && <Chip size="small" color="success" label="Concluída" />}
        </Stack>
      </Stack>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 3 }}>
        O exame não termina num diagnóstico de lesão — termina em por que o animal morreu.
      </Typography>

      <Card sx={{ p: 2, mb: 2.5 }}>
        <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap' }}>
          <Box>
            <Typography sx={{ ...MONO, fontSize: 14, fontWeight: 600 }}>
              {dossie.caso.identificador}
            </Typography>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
              {dossie.paciente.nome} · {dossie.cliente.nomeFantasia}
            </Typography>
          </Box>
          <Box>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Solicitado por</Typography>
            <Typography sx={{ fontSize: 13 }}>
              {banca.necropsia.responsavelSolicitacao}
              {banca.necropsia.contatoResponsavel ? ` · ${banca.necropsia.contatoResponsavel}` : ''}
            </Typography>
          </Box>
        </Stack>
      </Card>

      {/* Secao 72: o numero que importa e o dos orgaos que ficaram de fora. */}
      <Stack direction="row" spacing={1.5} sx={{ mb: 3, flexWrap: 'wrap' }}>
        {[
          { r: 'Órgãos examinados', v: banca.completude.examinados },
          { r: 'Com alteração', v: banca.completude.comAlteracao },
          { r: 'Não examinados', v: banca.completude.naoExaminados, alerta: true },
          { r: 'Achados na cadeia causal', v: banca.lesoesCausais },
        ].map((i) => (
          <Card key={i.r} sx={{ px: 2, py: 1.5, minWidth: 150 }}>
            <Typography
              sx={{
                fontSize: 24,
                fontWeight: 600,
                color: i.alerta && i.v > 0 ? 'warning.main' : 'text.primary',
              }}
            >
              {i.v}
            </Typography>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{i.r}</Typography>
          </Card>
        ))}
      </Stack>

      <ExameExterno banca={banca} editavel={editavel} agir={agir} ocupado={ocupado} />

      <ExameInterno banca={banca} editavel={editavel} agir={agir} ocupado={ocupado} />

      <Lesoes banca={banca} editavel={editavel} agir={agir} ocupado={ocupado} />

      <CausaMortis
        banca={banca}
        editavel={podeConcluir && !concluida}
        agir={agir}
        ocupado={ocupado}
      />

      {/* Secao 116-118: o que o Guardian achou, ANTES do clique de concluir. */}
      {conferencia.length > 0 && (
        <Alert severity={criticos.length > 0 ? 'error' : 'warning'} sx={{ mt: 2.5 }}>
          <AlertTitle>
            {criticos.length > 0
              ? 'O Guardian encontrou impedimentos para concluir'
              : 'O Guardian tem observações sobre este exame'}
          </AlertTitle>
          <Stack component="ul" spacing={1.25} sx={{ m: 0, pl: 2.5 }}>
            {conferencia.map((a) => (
              <Box component="li" key={a.codigo}>
                <Typography sx={{ fontSize: 13 }}>{a.mensagem}</Typography>
                {a.comoResolver && (
                  <Typography sx={{ fontSize: 13, mt: 0.25, fontWeight: 500 }}>
                    {a.comoResolver}
                  </Typography>
                )}
              </Box>
            ))}
          </Stack>
        </Alert>
      )}

      {bloqueio && <BloqueioGuardian erro={bloqueio} acao="concluir a necropsia" />}

      {erro && (
        <Alert severity="error" sx={{ mt: 2.5 }}>
          {erro}
        </Alert>
      )}

      <Stack direction="row" spacing={1} sx={{ mt: 3, justifyContent: 'flex-end' }}>
        {podeConcluir && !concluida && (
          <Button
            variant="contained"
            disabled={ocupado}
            onClick={() =>
              void agir(
                () => api.post(`/necropsia/${banca.necropsia.id}/conclusao`),
                'Não foi possível concluir.',
              )
            }
          >
            Concluir necropsia
          </Button>
        )}
        {podeConcluir && concluida && (
          <Button
            variant="outlined"
            disabled={ocupado}
            onClick={() => {
              const motivo = window.prompt('Por que o exame volta para correção?');
              if (motivo && motivo.trim().length >= 5) {
                void agir(
                  () =>
                    api.post(`/necropsia/${banca.necropsia.id}/reabertura`, {
                      motivo: motivo.trim(),
                    }),
                  'Não foi possível reabrir.',
                );
              }
            }}
          >
            Reabrir para correção
          </Button>
        )}
      </Stack>
    </Box>
  );
}

function Abertura({
  dossie,
  podeExecutar,
  aoAbrir,
  ocupado,
  erro,
}: {
  dossie: Dossie;
  podeExecutar: boolean;
  aoAbrir: (dados: Record<string, unknown>) => void;
  ocupado: boolean;
  erro: string | null;
}) {
  const [modalidade, setModalidade] = useState('diagnostica');
  const [responsavel, setResponsavel] = useState('');
  const [contato, setContato] = useState('');
  const [conservacao, setConservacao] = useState('');
  const [circunstancias, setCircunstancias] = useState('');

  if (!podeExecutar) {
    return <Alert severity="info">Este caso ainda não tem necropsia aberta.</Alert>;
  }

  return (
    <Box sx={{ maxWidth: 760 }}>
      <Typography variant="h2" sx={{ mb: 0.5 }}>
        Abrir necropsia
      </Typography>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 3 }}>
        {dossie.caso.identificador} · {dossie.paciente.nome}
      </Typography>

      <Card sx={{ p: 2.5 }}>
        <Stack spacing={2}>
          <TextField
            select
            label="Modalidade"
            value={modalidade}
            onChange={(e) => setModalidade(e.target.value)}
            helperText="Muda campos obrigatórios, fotografia e modelo de laudo."
          >
            {MODALIDADE_NECROPSIA.map((m) => (
              <MenuItem key={m} value={m}>
                {MODALIDADE_NECROPSIA_LABEL[m]}
              </MenuItem>
            ))}
          </TextField>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Responsável pela solicitação"
              value={responsavel}
              onChange={(e) => setResponsavel(e.target.value)}
              required
              helperText="Responsável, clínica, seguradora, autoridade. O veterinário é opcional na necropsia."
              sx={{ flex: 1 }}
            />
            <TextField
              label="Contato"
              value={contato}
              onChange={(e) => setContato(e.target.value)}
              sx={{ flex: 1 }}
            />
          </Stack>

          <TextField
            select
            label="Estado de conservação"
            value={conservacao}
            onChange={(e) => setConservacao(e.target.value)}
            helperText="Condiciona o que o exame consegue concluir."
          >
            <MenuItem value="">Não informado</MenuItem>
            {CONSERVACAO_NECROPSIA.map((c) => (
              <MenuItem key={c} value={c}>
                {CONSERVACAO_NECROPSIA_LABEL[c]}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            label="Circunstâncias da morte"
            value={circunstancias}
            onChange={(e) => setCircunstancias(e.target.value)}
            multiline
            minRows={3}
            helperText="Como o solicitante descreve o ocorrido. Fica preservado como veio."
          />

          {erro && <Alert severity="error">{erro}</Alert>}

          <Box>
            <Button
              variant="contained"
              disabled={ocupado || responsavel.trim().length < 3}
              onClick={() =>
                aoAbrir({
                  modalidade,
                  responsavelSolicitacao: responsavel.trim(),
                  contatoResponsavel: contato.trim() || null,
                  conservacao: conservacao || null,
                  circunstanciasMorte: circunstancias.trim() || null,
                })
              }
            >
              Abrir necropsia
            </Button>
          </Box>
        </Stack>
      </Card>
    </Box>
  );
}

function ExameExterno({
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
  const [limitacoes, setLimitacoes] = useState<string[]>(banca.necropsia.limitacoes ?? []);
  const [observacao, setObservacao] = useState(banca.necropsia.limitacoesObservacao ?? '');
  const [texto, setTexto] = useState(String(banca.necropsia.exameExterno?.descricao ?? ''));

  return (
    <Card sx={{ p: 2.5, mb: 2 }}>
      <Typography sx={{ fontSize: 15, fontWeight: 600 }}>Exame externo</Typography>
      <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mb: 2 }}>
        Escore corporal, mucosas, orifícios naturais, intervenções médicas — o que permite
        separar intervenção de trauma.
      </Typography>

      <Stack spacing={2}>
        <TextField
          label="Descrição"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          multiline
          minRows={3}
          disabled={!editavel}
          fullWidth
        />

        <Divider textAlign="left" sx={{ fontSize: 12 }}>
          Limitações do exame
        </Divider>
        <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
          Entram no laudo. O impacto delas sobre a conclusão precisa ficar explícito.
        </Typography>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {LIMITACAO_NECROPSIA.map((l) => (
            <Chip
              key={l}
              size="small"
              label={LIMITACAO_NECROPSIA_LABEL[l]}
              color={limitacoes.includes(l) ? 'warning' : 'default'}
              variant={limitacoes.includes(l) ? 'filled' : 'outlined'}
              onClick={
                editavel
                  ? () =>
                      setLimitacoes((atual) =>
                        atual.includes(l) ? atual.filter((x) => x !== l) : [...atual, l],
                      )
                  : undefined
              }
            />
          ))}
        </Box>

        {limitacoes.length > 0 && (
          <TextField
            label="Como as limitações afetam a interpretação"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            multiline
            minRows={2}
            disabled={!editavel}
          />
        )}

        {editavel && (
          <Box>
            <Button
              size="small"
              disabled={ocupado}
              onClick={() =>
                void agir(
                  () =>
                    api.post(`/necropsia/${banca.necropsia.id}/exame-externo`, {
                      exameExterno: { descricao: texto },
                      limitacoes,
                      limitacoesObservacao: observacao || null,
                    }),
                  'Não foi possível salvar o exame externo.',
                )
              }
            >
              Salvar exame externo
            </Button>
          </Box>
        )}
      </Stack>
    </Card>
  );
}

function ExameInterno({
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
  const [cavidade, setCavidade] = useState<CavidadeNecropsia>('toracica');
  const [orgao, setOrgao] = useState('');
  const [estado, setEstado] = useState<EstadoExameOrgao>('sem_alteracoes');
  const [descricao, setDescricao] = useState('');

  const porCavidade = new Map<string, typeof banca.orgaos>();
  for (const o of banca.orgaos) {
    porCavidade.set(o.cavidade, [...(porCavidade.get(o.cavidade) ?? []), o]);
  }

  return (
    <Card sx={{ p: 2.5, mb: 2 }}>
      <Typography sx={{ fontSize: 15, fontWeight: 600 }}>Exame interno</Typography>
      <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mb: 2 }}>
        Cavidade → órgão. <strong>“Não examinado” não é o mesmo que “sem alterações”</strong> — o
        primeiro é um buraco na investigação, o segundo é um achado.
      </Typography>

      {banca.orgaos.length === 0 ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          Nenhum órgão registrado ainda.
        </Alert>
      ) : (
        <Stack spacing={2} sx={{ mb: 2 }}>
          {[...porCavidade.entries()].map(([cav, orgaos]) => (
            <Box key={cav}>
              <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: 'text.secondary', mb: 0.75 }}>
                {CAVIDADE_NECROPSIA_LABEL[cav as CavidadeNecropsia] ?? cav}
              </Typography>
              <Stack spacing={0.75}>
                {orgaos.map((o) => (
                  <Stack key={o.id} direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
                    <Typography sx={{ fontSize: 13, minWidth: 150, fontWeight: 500 }}>
                      {o.orgao}
                    </Typography>
                    <Chip
                      size="small"
                      variant={o.estado === 'nao_examinado' ? 'filled' : 'outlined'}
                      color={
                        o.estado === 'alterado'
                          ? 'warning'
                          : o.estado === 'nao_examinado'
                            ? 'default'
                            : 'success'
                      }
                      label={ESTADO_EXAME_ORGAO_LABEL[o.estado as EstadoExameOrgao] ?? o.estado}
                    />
                    {o.descricao && (
                      <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                        {o.descricao}
                      </Typography>
                    )}
                  </Stack>
                ))}
              </Stack>
            </Box>
          ))}
        </Stack>
      )}

      {editavel && (
        <>
          <Divider sx={{ my: 2 }} />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 1.5 }}>
            <TextField
              size="small"
              select
              label="Cavidade"
              value={cavidade}
              onChange={(e) => setCavidade(e.target.value as CavidadeNecropsia)}
              sx={{ minWidth: 190 }}
            >
              {CAVIDADE_NECROPSIA.map((c) => (
                <MenuItem key={c} value={c}>
                  {CAVIDADE_NECROPSIA_LABEL[c]}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              label="Órgão"
              value={orgao}
              onChange={(e) => setOrgao(e.target.value)}
              sx={{ flex: 1 }}
            />
            <TextField
              size="small"
              select
              label="Estado"
              value={estado}
              onChange={(e) => setEstado(e.target.value as EstadoExameOrgao)}
              sx={{ minWidth: 175 }}
            >
              {ESTADO_EXAME_ORGAO.map((e) => (
                <MenuItem key={e} value={e}>
                  {ESTADO_EXAME_ORGAO_LABEL[e]}
                </MenuItem>
              ))}
            </TextField>
          </Stack>

          <TextField
            size="small"
            label="Descrição"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            disabled={estado === 'nao_examinado'}
            helperText={
              estado === 'nao_examinado'
                ? 'Órgão não examinado não recebe descrição — não se descreve o que não se olhou.'
                : ' '
            }
            fullWidth
            sx={{ mb: 1.5 }}
          />

          <Button
            size="small"
            startIcon={<AddOutlined />}
            disabled={ocupado || !orgao.trim()}
            onClick={() =>
              void agir(
                () =>
                  api.post(`/necropsia/${banca.necropsia.id}/orgaos`, {
                    cavidade,
                    orgao: orgao.trim(),
                    estado,
                    descricao: estado === 'nao_examinado' ? null : descricao.trim() || null,
                  }),
                'Não foi possível registrar o órgão.',
              ).then(() => {
                setOrgao('');
                setDescricao('');
              })
            }
          >
            Registrar órgão
          </Button>
        </>
      )}
    </Card>
  );
}

function Lesoes({
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
  const [orgao, setOrgao] = useState('');
  const [descricao, setDescricao] = useState('');
  const [diagnostico, setDiagnostico] = useState('');
  const [origem, setOrigem] = useState('');
  const [destino, setDestino] = useState('');

  const porId = new Map(banca.lesoes.map((l) => [l.id, l]));

  return (
    <Card sx={{ p: 2.5, mb: 2 }}>
      <Typography sx={{ fontSize: 15, fontWeight: 600 }}>Lesões</Typography>
      <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mb: 2 }}>
        Cada alteração relevante tem registro próprio. A classificação separa o que participou
        da morte do que só estava lá — sem ela, todo achado acaba lido como causal.
      </Typography>

      {banca.lesoes.length === 0 ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          Nenhuma lesão registrada.
        </Alert>
      ) : (
        <Stack spacing={1.25} sx={{ mb: 2 }}>
          {banca.lesoes.map((l) => (
            <Box key={l.id}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <Typography sx={{ ...MONO, fontSize: 13, fontWeight: 600 }}>{l.codigo}</Typography>
                <Typography sx={{ fontSize: 13.5, fontWeight: 500 }}>{l.orgao}</Typography>
                {l.classificacao ? (
                  <Chip
                    size="small"
                    color={COR_CLASSIFICACAO[l.classificacao as ClassificacaoLesao] ?? 'default'}
                    label={
                      CLASSIFICACAO_LESAO_LABEL[l.classificacao as ClassificacaoLesao] ??
                      l.classificacao
                    }
                  />
                ) : (
                  <Chip size="small" variant="outlined" color="warning" label="Sem classificação" />
                )}
              </Stack>
              <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                {l.descricao}
                {l.diagnosticoMorfologico ? ` · ${l.diagnosticoMorfologico}` : ''}
              </Typography>
              {editavel && !l.classificacao && (
                <TextField
                  size="small"
                  select
                  label="Classificar"
                  value=""
                  onChange={(e) =>
                    void agir(
                      () =>
                        api.post(`/necropsia/lesoes/${l.id}`, {
                          classificacao: e.target.value as ClassificacaoLesao,
                        }),
                      'Não foi possível classificar.',
                    )
                  }
                  sx={{ mt: 0.75, minWidth: 230 }}
                >
                  {CLASSIFICACAO_LESAO.map((c) => (
                    <MenuItem key={c} value={c}>
                      {CLASSIFICACAO_LESAO_LABEL[c]}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            </Box>
          ))}
        </Stack>
      )}

      {/* Secao 76: o mapa fisiopatologico. */}
      {banca.relacoes.length > 0 && (
        <>
          <Divider sx={{ my: 2 }} />
          <Typography sx={{ fontSize: 13, fontWeight: 600, mb: 1 }}>
            Cadeia fisiopatológica
          </Typography>
          <Stack spacing={0.5}>
            {banca.relacoes.map((r) => (
              <Typography key={r.id} sx={{ fontSize: 13 }}>
                <Typography component="span" sx={{ ...MONO, fontSize: 12.5 }}>
                  {porId.get(r.origemId)?.codigo}
                </Typography>{' '}
                {porId.get(r.origemId)?.diagnosticoMorfologico ?? porId.get(r.origemId)?.orgao}{' '}
                <Typography component="span" sx={{ color: 'text.secondary' }}>
                  {RELACAO_LESAO_LABEL[r.tipo as keyof typeof RELACAO_LESAO_LABEL] ?? r.tipo} →
                </Typography>{' '}
                <Typography component="span" sx={{ ...MONO, fontSize: 12.5 }}>
                  {porId.get(r.destinoId)?.codigo}
                </Typography>{' '}
                {porId.get(r.destinoId)?.diagnosticoMorfologico ?? porId.get(r.destinoId)?.orgao}
              </Typography>
            ))}
          </Stack>
        </>
      )}

      {editavel && (
        <>
          <Divider sx={{ my: 2 }} />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 1.5 }}>
            <TextField
              size="small"
              label="Órgão"
              value={orgao}
              onChange={(e) => setOrgao(e.target.value)}
              sx={{ minWidth: 180 }}
            />
            <TextField
              size="small"
              label="Descrição"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              sx={{ flex: 1 }}
            />
            <TextField
              size="small"
              label="Diagnóstico morfológico"
              value={diagnostico}
              onChange={(e) => setDiagnostico(e.target.value)}
              sx={{ flex: 1 }}
            />
          </Stack>
          <Button
            size="small"
            startIcon={<AddOutlined />}
            disabled={ocupado || !orgao.trim() || descricao.trim().length < 3}
            onClick={() =>
              void agir(
                () =>
                  api.post(`/necropsia/${banca.necropsia.id}/lesoes`, {
                    orgao: orgao.trim(),
                    descricao: descricao.trim(),
                    diagnosticoMorfologico: diagnostico.trim() || null,
                  }),
                'Não foi possível criar a lesão.',
              ).then(() => {
                setOrgao('');
                setDescricao('');
                setDiagnostico('');
              })
            }
          >
            Adicionar lesão
          </Button>

          {banca.lesoes.length >= 2 && (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 2 }}>
              <TextField
                size="small"
                select
                label="Esta lesão"
                value={origem}
                onChange={(e) => setOrigem(e.target.value)}
                sx={{ minWidth: 200 }}
              >
                {banca.lesoes.map((l) => (
                  <MenuItem key={l.id} value={l.id}>
                    {l.codigo} — {l.orgao}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                size="small"
                select
                label="causou"
                value={destino}
                onChange={(e) => setDestino(e.target.value)}
                sx={{ minWidth: 200 }}
              >
                {banca.lesoes.map((l) => (
                  <MenuItem key={l.id} value={l.id}>
                    {l.codigo} — {l.orgao}
                  </MenuItem>
                ))}
              </TextField>
              <Button
                size="small"
                disabled={ocupado || !origem || !destino || origem === destino}
                onClick={() =>
                  void agir(
                    () =>
                      api.post(`/necropsia/${banca.necropsia.id}/relacoes`, {
                        origemId: origem,
                        destinoId: destino,
                      }),
                    'Não foi possível ligar as lesões.',
                  ).then(() => {
                    setOrigem('');
                    setDestino('');
                  })
                }
              >
                Ligar
              </Button>
            </Stack>
          )}
        </>
      )}
    </Card>
  );
}

function CausaMortis({
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
  const atual = banca.causaMortis;
  const [imediata, setImediata] = useState(atual?.causaImediata ?? '');
  const [antecedente, setAntecedente] = useState(atual?.condicaoAntecedente ?? '');
  const [basica, setBasica] = useState(atual?.causaBasica ?? '');
  const [contribuintes, setContribuintes] = useState(atual?.condicoesContribuintes ?? '');
  const [mecanismo, setMecanismo] = useState(atual?.mecanismoTerminal ?? '');
  const [grau, setGrau] = useState<GrauCertezaCausa>(
    (atual?.grauCerteza as GrauCertezaCausa) ?? 'indeterminada',
  );
  const [conclusao, setConclusao] = useState(atual?.conclusao ?? '');

  return (
    <Card sx={{ p: 2.5 }}>
      <Typography sx={{ fontSize: 15, fontWeight: 600 }}>Causa mortis</Typography>
      <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mb: 2 }}>
        <strong>Mecanismo não é causa.</strong> Choque hipovolêmico é <em>como</em> o animal
        morreu; a ruptura que o provocou é <em>por quê</em>. Indeterminada é resposta válida.
      </Typography>

      <Stack spacing={2}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label="Causa imediata"
            value={imediata}
            onChange={(e) => setImediata(e.target.value)}
            disabled={!editavel}
            sx={{ flex: 1 }}
          />
          <TextField
            label="Condição antecedente"
            value={antecedente}
            onChange={(e) => setAntecedente(e.target.value)}
            disabled={!editavel}
            sx={{ flex: 1 }}
          />
        </Stack>

        <TextField
          label="Causa básica"
          value={basica}
          onChange={(e) => setBasica(e.target.value)}
          disabled={!editavel}
          helperText="O que colocou o organismo nesse caminho."
        />

        <TextField
          label="Condições contribuintes"
          value={contribuintes}
          onChange={(e) => setContribuintes(e.target.value)}
          disabled={!editavel}
        />

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            select
            label="Mecanismo terminal"
            value={mecanismo}
            onChange={(e) => setMecanismo(e.target.value)}
            disabled={!editavel}
            sx={{ flex: 1 }}
          >
            <MenuItem value="">Não informado</MenuItem>
            {MECANISMO_TERMINAL.map((m) => (
              <MenuItem key={m} value={m}>
                {MECANISMO_TERMINAL_LABEL[m]}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Grau de certeza"
            value={grau}
            onChange={(e) => setGrau(e.target.value as GrauCertezaCausa)}
            disabled={!editavel}
            sx={{ flex: 1 }}
          >
            {GRAU_CERTEZA_CAUSA.map((g) => (
              <MenuItem key={g} value={g}>
                {GRAU_CERTEZA_CAUSA_LABEL[g]}
              </MenuItem>
            ))}
          </TextField>
        </Stack>

        <TextField
          label="Conclusão anatomopatológica"
          value={conclusao}
          onChange={(e) => setConclusao(e.target.value)}
          disabled={!editavel}
          multiline
          minRows={3}
          helperText="Linguagem proporcional à evidência."
        />

        {editavel && (
          <Box>
            <Button
              size="small"
              disabled={ocupado}
              onClick={() =>
                void agir(
                  () =>
                    api.post(`/necropsia/${banca.necropsia.id}/causa-mortis`, {
                      causaImediata: imediata.trim() || null,
                      condicaoAntecedente: antecedente.trim() || null,
                      causaBasica: basica.trim() || null,
                      condicoesContribuintes: contribuintes.trim() || null,
                      mecanismoTerminal: mecanismo || null,
                      grauCerteza: grau,
                      conclusao: conclusao.trim() || null,
                    }),
                  'Não foi possível salvar a causa mortis.',
                )
              }
            >
              Salvar causa mortis
            </Button>
          </Box>
        )}
      </Stack>
    </Card>
  );
}

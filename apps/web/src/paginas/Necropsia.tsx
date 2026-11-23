import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import FormControlLabel from '@mui/material/FormControlLabel';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
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
  PERGUNTAS_FORMULARIO_NECROPSIA,
  RELACAO_LESAO_LABEL,
  type CavidadeNecropsia,
  type ClassificacaoLesao,
  type EstadoExameOrgao,
  type GrauCertezaCausa,
} from '@lapato/shared';
import {
  api,
  ErroApi,
  type BancadaNecropsia,
  type Dossie,
  type SugestoesCopiloto,
} from '../api';
import { AjudaBiblioteca } from '../componentes/AjudaBiblioteca';
import { BloqueioGuardian } from './BloqueioGuardian';
import { GaleriaDoCaso } from './imagens/GaleriaDoCaso';
import { MapaCorporal } from './necropsia/MapaCorporal';
import { CamposDoFormularioNecropsia } from './necropsia/CamposDoFormulario';

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

type Aba = 'historico' | 'anexos' | 'externo' | 'interno' | 'microscopia' | 'conclusao';

export function Necropsia({ permissoes }: { permissoes: string[] }) {
  const navegar = useNavigate();
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
  const [formulario, setFormulario] = useState<'preencher' | 'enviar' | null>(null);
  const [aba, setAba] = useState<Aba>('historico');

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

  /** Devolve se a acao passou, para o diálogo só fechar quando passou. */
  async function agir(acao: () => Promise<unknown>, padrao: string): Promise<boolean> {
    setOcupado(true);
    setErro(null);
    setBloqueio(null);
    try {
      await acao();
      await recarregar();
      return true;
    } catch (e) {
      if (e instanceof ErroApi && e.bloqueadoPeloGuardian) setBloqueio(e);
      else setErro(e instanceof ErroApi ? e.detalhe : padrao);
      return false;
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
          <AjudaBiblioteca contexto="necropsia" permissoes={permissoes} />
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
          {/*
            "Data de entrada | Data do exame" lado a lado. A do exame e
            editavel porque o corpo chega na sexta e a mesa so abre na segunda -
            e e a data do exame que vai ao laudo.
          */}
          <Box>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Data do exame</Typography>
            <TextField
              size="small"
              type="date"
              variant="standard"
              disabled={!editavel || ocupado}
              value={banca.necropsia.exameEm ? banca.necropsia.exameEm.slice(0, 10) : ''}
              onChange={(e) =>
                void agir(
                  () =>
                    api.post(`/necropsia/${banca.necropsia.id}/cabecalho`, {
                      exameEm: e.target.value ? new Date(`${e.target.value}T12:00:00`).toISOString() : null,
                    }),
                  'Não foi possível salvar a data do exame.',
                )
              }
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ width: 150 }}
            />
          </Box>
          {banca.necropsia.devolucaoCorpo !== null && (
            <Box>
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Corpo</Typography>
              <Typography sx={{ fontSize: 13 }}>
                {banca.necropsia.devolucaoCorpo ? 'Com devolução' : 'Sem devolução'}
              </Typography>
            </Box>
          )}
          {/*
            Os dois botoes da quinta revisao: ou o tecnico preenche agora, com o
            tutor na frente ou no telefone, ou manda o link e o tutor preenche.
            O mesmo questionario nos dois caminhos.
          */}
          {editavel && (
            <Stack direction="row" spacing={1} sx={{ ml: 'auto', alignItems: 'center' }}>
              <Button size="small" variant="outlined" onClick={() => setFormulario('preencher')}>
                Preencher formulário
              </Button>
              <Button size="small" variant="outlined" onClick={() => setFormulario('enviar')}>
                Enviar formulário
              </Button>
            </Stack>
          )}
        </Stack>
      </Card>

      {formulario === 'preencher' && (
        <DialogoPreencherFormulario
          necropsia={banca.necropsia}
          aoFechar={() => setFormulario(null)}
          aoSalvar={async (respostas) => {
            const ok = await agir(
              () => api.post(`/necropsia/${banca.necropsia.id}/formulario/preencher`, { respostas }),
              'Não foi possível salvar o formulário.',
            );
            if (ok) setFormulario(null);
          }}
          ocupado={ocupado}
        />
      )}

      {formulario === 'enviar' && (
        <DialogoEnviarFormulario
          necropsiaId={banca.necropsia.id}
          contatoSugerido={banca.necropsia.contatoResponsavel}
          aoFechar={() => setFormulario(null)}
        />
      )}

      {/*
        Quinta revisao: a observacao do tutor fica ACIMA de tudo, com o botao
        "Ciente" ao lado. E um pedido que so se cumpre com o corpo na mesa, e
        por isso nao pode estar escondido numa aba - lido depois do descarte,
        nao se cumpre mais.
      */}
      {banca.necropsia.observacaoTutor && (
        <Card
          sx={{
            p: 2,
            mb: 2.5,
            borderLeft: 4,
            borderColor: banca.necropsia.cienteEm ? 'success.main' : 'warning.main',
          }}
        >
          <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8, color: 'text.secondary' }}>
            OBSERVAÇÃO DO TUTOR
          </Typography>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            sx={{ mt: 0.5, alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
          >
            <Typography sx={{ fontSize: 14 }}>{banca.necropsia.observacaoTutor}</Typography>
            {banca.necropsia.cienteEm ? (
              <Chip
                size="small"
                color="success"
                label={`Ciente · ${banca.cientePor ?? 'equipe'} · ${new Date(banca.necropsia.cienteEm).toLocaleDateString('pt-BR')}`}
              />
            ) : (
              <Button
                variant="contained"
                disabled={!editavel || ocupado}
                onClick={() =>
                  void agir(
                    () => api.post(`/necropsia/${banca.necropsia.id}/ciente`),
                    'Não foi possível registrar a ciência.',
                  )
                }
              >
                Ciente
              </Button>
            )}
          </Stack>
        </Card>
      )}

      {!banca.necropsia.observacaoTutor && editavel && (
        <Box sx={{ mb: 2.5 }}>
          <Button
            size="small"
            variant="text"
            onClick={() => {
              const texto = window.prompt('Pedido do tutor sobre o corpo (carimbo da pata, tufo de pelos…)');
              if (texto && texto.trim()) {
                void agir(
                  () =>
                    api.post(`/necropsia/${banca.necropsia.id}/cabecalho`, {
                      observacaoTutor: texto.trim(),
                    }),
                  'Não foi possível salvar a observação.',
                );
              }
            }}
          >
            + Registrar pedido do tutor
          </Button>
        </Box>
      )}

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

      {/*
        As abas do documento: Historico, Anexos, Exame externo, Exame interno,
        Microscopia, Conclusao. Antes era tudo empilhado numa pagina so - o que
        funciona para ler, e nao para trabalhar: o patologista esta de luva,
        alternando entre a cavidade aberta e a tela, e rolar meia pagina para
        achar a secao certa custa cada vez.
      */}
      <Tabs
        value={aba}
        onChange={(_, v) => setAba(v as Aba)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab value="historico" label="Histórico" />
        <Tab value="anexos" label="Anexos" />
        <Tab value="externo" label="Exame externo" />
        <Tab value="interno" label="Exame interno" />
        <Tab value="microscopia" label="Microscopia" />
        <Tab value="conclusao" label="Conclusão" />
      </Tabs>

      {aba === 'historico' && <Historico banca={banca} dossie={dossie} />}

      {aba === 'anexos' && <Anexos casoId={dossie.caso.id} editavel={editavel} />}

      {aba === 'externo' && (
        <>
          <ExameExterno banca={banca} editavel={editavel} agir={agir} ocupado={ocupado} />
          <MapaCorporal banca={banca} editavel={editavel} agir={agir} ocupado={ocupado} />
        </>
      )}

      {aba === 'interno' && (
        <>
          <SugestoesDaIa necropsiaId={banca.necropsia.id} />
          <ExameInterno banca={banca} editavel={editavel} agir={agir} ocupado={ocupado} />
          <AmostrasColetadas banca={banca} editavel={editavel} agir={agir} ocupado={ocupado} />
          <Lesoes banca={banca} editavel={editavel} agir={agir} ocupado={ocupado} />
        </>
      )}

      {aba === 'microscopia' && (
        <Card sx={{ p: 2.5 }}>
          <Typography variant="h3" sx={{ mb: 0.5 }}>
            Microscopia
          </Typography>
          <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 2 }}>
            A descrição microscópica e os diagnósticos ficam no laudo, junto das lâminas — é lá
            que a assinatura acontece, e duplicar o campo aqui criaria duas versões do mesmo
            texto.
          </Typography>
          <Button variant="outlined" onClick={() => navegar(`/casos/${dossie.caso.id}/laudo`)}>
            Abrir laudo e microscopia
          </Button>
        </Card>
      )}

      {aba === 'conclusao' && (
        <CausaMortis
          banca={banca}
          editavel={podeConcluir && !concluida}
          agir={agir}
          ocupado={ocupado}
        />
      )}

      {/* Secao 116-118: o que o Guardian achou, ANTES do clique de concluir. */}
      {aba === 'conclusao' && conferencia.length > 0 && (
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
        {concluida && (
          <Button variant="outlined" onClick={() => navegar(`/casos/${dossie.caso.id}/laudo`)}>
            Gerar laudo
          </Button>
        )}
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

/**
 * A aba Historico: "Informacoes do formulario" (quinta revisao).
 *
 * E a primeira coisa que o patologista le, e por isso e a aba que abre. O
 * relato do tutor nao e dado observado - vem como o tutor contou, e e assim que
 * tem de ser lido. Por isso o rotulo de quem respondeu fica visivel: relato
 * colhido por telefone pelo tecnico e relato escrito pelo tutor nao valem o
 * mesmo quando o laudo precisa citar a fonte.
 */
function Historico({ banca, dossie }: { banca: BancadaNecropsia; dossie: Dossie }) {
  const respostas = (banca.formulario?.respostas ?? {}) as Record<string, unknown>;
  const texto = (chave: string) => {
    const v = respostas[chave];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };

  if (!banca.formulario) {
    return (
      <Alert severity="info">
        O formulário de solicitação ainda não foi respondido. Use <strong>Preencher
        formulário</strong> ou <strong>Enviar formulário</strong> no topo da tela — o relato do
        tutor é o que orienta o exame.
      </Alert>
    );
  }

  return (
    <Card sx={{ p: 2.5 }}>
      <Stack
        direction="row"
        spacing={2}
        sx={{ mb: 2, alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap' }}
      >
        <Typography variant="h3">Informações do formulário</Typography>
        <Chip
          size="small"
          variant="outlined"
          color={banca.formulario.respondidoPor === 'tutor' ? 'success' : 'default'}
          label={
            banca.formulario.respondidoPor === 'tutor'
              ? 'Respondido pelo tutor'
              : 'Preenchido pelo laboratório'
          }
        />
      </Stack>

      <Stack spacing={2}>
        <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap' }}>
          <Box>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Data do óbito</Typography>
            <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
              {banca.necropsia.obitoEm
                ? new Date(banca.necropsia.obitoEm).toLocaleString('pt-BR', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })
                : 'Não informada'}
            </Typography>
          </Box>
          <Box>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Local</Typography>
            <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
              {texto('localObito') ?? 'Não informado'}
            </Typography>
          </Box>
          <Box>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>Entrada do material</Typography>
            <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
              {dossie.caso.entradaEm
                ? new Date(dossie.caso.entradaEm).toLocaleDateString('pt-BR')
                : '—'}
            </Typography>
          </Box>
        </Stack>

        {PERGUNTAS_FORMULARIO_NECROPSIA.filter((p) => p.tipo === 'texto_longo').map((pergunta) => {
          const resposta =
            texto(pergunta.chave) ??
            (pergunta.destino === 'circunstanciasMorte'
              ? banca.necropsia.circunstanciasMorte
              : pergunta.destino === 'perguntasSolicitante'
                ? banca.necropsia.perguntasSolicitante
                : null);
          if (!resposta) return null;
          return (
            <Box key={pergunta.chave}>
              <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{pergunta.rotulo}</Typography>
              <Typography sx={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{resposta}</Typography>
            </Box>
          );
        })}
      </Stack>
    </Card>
  );
}

/**
 * A aba Anexos: os dois quadros de imagem do documento.
 *
 * "Imagens anexadas pelo LAPATO" e "Imagens enviadas pelo tutor" - a mesma
 * galeria do M16, recortada por origem. Separadas porque a foto do animal vivo
 * que o tutor mandou pelo WhatsApp e a foto do orgao na bancada nao tem o mesmo
 * peso, e o laudo nao pode citar uma pela outra.
 */
function Anexos({ casoId, editavel }: { casoId: string; editavel: boolean }) {
  const permissoes = editavel ? ['imagem:enviar', 'imagem:editar'] : [];
  return (
    <Stack spacing={2.5}>
      <Card sx={{ p: 2.5 }}>
        <GaleriaDoCaso
          casoId={casoId}
          permissoes={permissoes}
          moduloContexto="M14_NECROPSIA"
          tipoPadrao="necropsia"
          origens={['produzida_lapato']}
          titulo="Imagens anexadas pelo LAPATO"
          resumo="O que a bancada fotografou: corpo, cavidades, órgãos e lesões."
        />
      </Card>
      <Card sx={{ p: 2.5 }}>
        <GaleriaDoCaso
          casoId={casoId}
          permissoes={permissoes}
          moduloContexto="M14_NECROPSIA"
          tipoPadrao="documento"
          origens={[
            'enviada_cliente',
            'enviada_veterinario',
            'importada',
            'laboratorio_parceiro',
            'pericial_externa',
          ]}
          titulo="Imagens enviadas pelo tutor"
          resumo="O que veio de fora — cada imagem mostra a origem, porque uma foto do tutor e um laudo de imagem da clínica não valem o mesmo no exame."
        />
      </Card>
    </Stack>
  );
}

/**
 * As sugestoes do Copiloto na bancada (M17 + quinta revisao).
 *
 * "E importante que o suporte de IA sempre considere os exames previos do
 * animal, bem como o historico apontado, sugerindo sistemas indispensaveis para
 * exame e suspeitas diagnosticas."
 *
 * Sem provedor de IA, o cartao de indisponibilidade aparece e o exame segue: a
 * secao 110 do M17 e explicita que o LAPATO funciona sem IA. A tela diz isso em
 * vez de ficar em branco, para ninguem achar que a IA concordou com tudo.
 */
function SugestoesDaIa({ necropsiaId }: { necropsiaId: string }) {
  const [dados, setDados] = useState<SugestoesCopiloto | null>(null);
  const [carregado, setCarregado] = useState(false);

  useEffect(() => {
    api
      .get<SugestoesCopiloto>(`/necropsia/${necropsiaId}/sugestoes`)
      .then(setDados)
      .catch(() => setDados({ cartoes: [], disponivel: false }))
      .finally(() => setCarregado(true));
  }, [necropsiaId]);

  if (!carregado) return <Skeleton variant="rounded" height={64} sx={{ mb: 2.5 }} />;

  if (!dados?.disponivel) {
    return (
      <Alert severity="info" sx={{ mb: 2.5 }}>
        Assistência de IA temporariamente indisponível. O exame segue normalmente — o que você
        descrever e concluir não depende dela.
      </Alert>
    );
  }

  if (dados.cartoes.length === 0) return null;

  return (
    <Stack spacing={1.5} sx={{ mb: 2.5 }}>
      {dados.cartoes.map((c) => (
        <Alert
          key={c.id}
          severity={
            c.nivel === 'critico'
              ? 'error'
              : c.nivel === 'atencao'
                ? 'warning'
                : c.nivel === 'sugestao'
                  ? 'info'
                  : 'success'
          }
        >
          <AlertTitle sx={{ fontSize: 14 }}>{c.titulo}</AlertTitle>
          <Typography sx={{ fontSize: 13.5, whiteSpace: 'pre-wrap' }}>{c.corpo}</Typography>
          {/*
            M17 secao 15: a sugestao diz quais dados usou e se houve inferencia.
            Sem isso, o parecer da IA se confunde com achado observado - que e
            exatamente o erro que um laudo de necropsia nao pode conter.
          */}
          <Typography sx={{ fontSize: 11.5, color: 'text.secondary', mt: 0.75 }}>
            {c.inferencia ? 'Inferência da IA' : 'Leitura direta dos dados'}
            {c.fontes.length > 0 ? ` · fontes: ${c.fontes.join(', ')}` : ''}
            {dados.modelo ? ` · ${dados.modelo}` : ''}
          </Typography>
        </Alert>
      ))}
    </Stack>
  );
}

/**
 * "INDICAR QUAIS AMOSTRAS FORAM COLETADAS" (quinta revisao).
 *
 * Marcado no proprio orgao examinado: e ali que a decisao acontece, com a
 * cavidade aberta. A pergunta que isto responde chega meses depois - "ainda tem
 * material do rim?" -, e sem o registro a resposta e procurar no freezer.
 */
function AmostrasColetadas({
  banca,
  editavel,
  agir,
  ocupado,
}: {
  banca: BancadaNecropsia;
  editavel: boolean;
  agir: (a: () => Promise<unknown>, p: string) => Promise<boolean>;
  ocupado: boolean;
}) {
  const examinados = banca.orgaos.filter((o) => o.estado !== 'nao_examinado');
  const coletados = examinados.filter((o) => o.amostraColetada);

  return (
    <Card sx={{ p: 2.5, mb: 2.5 }}>
      <Stack
        direction="row"
        spacing={2}
        sx={{ alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap' }}
      >
        <Typography variant="h3">Amostras coletadas</Typography>
        <Chip
          size="small"
          variant="outlined"
          label={`${coletados.length} de ${examinados.length} órgãos examinados`}
        />
      </Stack>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 0.5, mb: 2 }}>
        Marque o que foi para o formol. Órgão não examinado não aparece aqui — não há de onde
        coletar.
      </Typography>

      {examinados.length === 0 ? (
        <Typography sx={{ fontSize: 13.5, color: 'text.secondary' }}>
          Nenhum órgão examinado ainda.
        </Typography>
      ) : (
        <Stack spacing={1}>
          {examinados.map((o) => (
            <Stack
              key={o.id}
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1.5}
              sx={{ alignItems: { sm: 'center' } }}
            >
              <FormControlLabel
                sx={{ minWidth: 220 }}
                control={
                  <Checkbox
                    checked={o.amostraColetada}
                    disabled={!editavel || ocupado}
                    onChange={(e) =>
                      void agir(
                        () =>
                          api.post(`/necropsia/orgaos/${o.id}/coleta`, {
                            coletada: e.target.checked,
                            observacao: o.amostraObservacao,
                          }),
                        'Não foi possível registrar a coleta.',
                      )
                    }
                  />
                }
                label={
                  <Typography sx={{ fontSize: 14 }}>
                    {o.orgao}
                    {o.sistema ? (
                      <Typography component="span" sx={{ fontSize: 12, color: 'text.secondary' }}>
                        {' '}
                        · {o.sistema}
                      </Typography>
                    ) : null}
                  </Typography>
                }
              />
              {o.amostraColetada && (
                <TextField
                  size="small"
                  placeholder="Fixador, frasco, destino"
                  defaultValue={o.amostraObservacao ?? ''}
                  disabled={!editavel || ocupado}
                  sx={{ flex: 1 }}
                  onBlur={(e) => {
                    if ((e.target.value || '') === (o.amostraObservacao ?? '')) return;
                    void agir(
                      () =>
                        api.post(`/necropsia/orgaos/${o.id}/coleta`, {
                          coletada: true,
                          observacao: e.target.value.trim() || null,
                        }),
                      'Não foi possível salvar a observação da coleta.',
                    );
                  }}
                />
              )}
            </Stack>
          ))}
        </Stack>
      )}
    </Card>
  );
}

/**
 * O formulario preenchido pelo proprio tecnico (quinta revisao: "o formulario e
 * aberto e o proprio tecnico ira preenche-lo").
 *
 * Os mesmos campos da tela do tutor, vindos do mesmo componente. O que o caso
 * ja sabe vem preenchido: o tecnico corrige, nao redigita.
 */
function DialogoPreencherFormulario({
  necropsia,
  aoFechar,
  aoSalvar,
  ocupado,
}: {
  necropsia: BancadaNecropsia['necropsia'];
  aoFechar: () => void;
  aoSalvar: (respostas: Record<string, string>) => void;
  ocupado: boolean;
}) {
  const [valores, setValores] = useState<Record<string, string>>(() => ({
    responsavelSolicitacao: necropsia.responsavelSolicitacao ?? '',
    contatoResponsavel: necropsia.contatoResponsavel ?? '',
    responsavelDocumento: necropsia.responsavelDocumento ?? '',
    responsavelCidade: necropsia.responsavelCidade ?? '',
    responsavelUf: necropsia.responsavelUf ?? '',
    obitoEm: necropsia.obitoEm ? necropsia.obitoEm.slice(0, 16) : '',
    relatoCronologico: necropsia.circunstanciasMorte ?? '',
    principalDuvida: necropsia.perguntasSolicitante ?? '',
  }));

  return (
    <Dialog open onClose={aoFechar} maxWidth="sm" fullWidth>
      <DialogTitle>Formulário de solicitação e autorização</DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 2 }}>
          Preenchido por você, com o responsável presente ou por telefone. Fica registrado que
          quem respondeu foi o laboratório, e não o tutor.
        </Typography>
        <CamposDoFormularioNecropsia valores={valores} aoMudar={setValores} />
      </DialogContent>
      <DialogActions>
        <Button onClick={aoFechar}>Cancelar</Button>
        <Button
          variant="contained"
          disabled={ocupado || (valores.responsavelSolicitacao ?? '').trim().length < 3}
          onClick={() => aoSalvar(valores)}
        >
          Salvar formulário
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * O envio do link ao tutor (quinta revisao: "enviado via whatsapp e/ou email
 * para o tutor, finalizar o preenchimento").
 *
 * O link aparece aqui depois de gerado, com "Copiar": o envio automatico passa
 * pela fila do M26, e quando o WhatsApp do laboratorio ainda nao esta ligado a
 * recepcao cola o link na conversa que ja tem aberta - e o mesmo caminho do
 * convite de autocadastro do cliente.
 */
function DialogoEnviarFormulario({
  necropsiaId,
  contatoSugerido,
  aoFechar,
}: {
  necropsiaId: string;
  contatoSugerido: string | null;
  aoFechar: () => void;
}) {
  const [canal, setCanal] = useState<'whatsapp' | 'email' | 'ambos'>('whatsapp');
  const [telefone, setTelefone] = useState(
    contatoSugerido && !contatoSugerido.includes('@') ? contatoSugerido : '',
  );
  const [email, setEmail] = useState(
    contatoSugerido && contatoSugerido.includes('@') ? contatoSugerido : '',
  );
  const [link, setLink] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function enviar() {
    setOcupado(true);
    setErro(null);
    try {
      const r = await api.post<{ caminho: string; expiraEm: string }>(
        `/necropsia/${necropsiaId}/formulario/enviar`,
        {
          canal,
          telefone: telefone.trim() || null,
          email: email.trim() || null,
        },
      );
      setLink(`${window.location.origin}${r.caminho}`);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.detalhe : 'Não foi possível gerar o link.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Dialog open onClose={aoFechar} maxWidth="sm" fullWidth>
      <DialogTitle>Enviar formulário ao tutor</DialogTitle>
      <DialogContent>
        {link ? (
          <Stack spacing={2}>
            <Alert severity="success">
              Link gerado e na fila de envio. Vale uma única vez, por sete dias.
            </Alert>
            <TextField label="Link do formulário" value={link} slotProps={{ input: { readOnly: true } }} />
            <Box>
              <Button
                variant="outlined"
                onClick={() => void navigator.clipboard?.writeText(link)}
              >
                Copiar link
              </Button>
            </Box>
          </Stack>
        ) : (
          <Stack spacing={2}>
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
              O tutor recebe o formulário e preenche o que falta. Ele edita tudo, menos o valor
              combinado.
            </Typography>
            <TextField
              select
              label="Canal"
              value={canal}
              onChange={(e) => setCanal(e.target.value as typeof canal)}
            >
              <MenuItem value="whatsapp">WhatsApp</MenuItem>
              <MenuItem value="email">E-mail</MenuItem>
              <MenuItem value="ambos">WhatsApp e e-mail</MenuItem>
            </TextField>
            {canal !== 'email' && (
              <TextField
                label="WhatsApp"
                value={telefone}
                onChange={(e) => setTelefone(e.target.value)}
              />
            )}
            {canal !== 'whatsapp' && (
              <TextField
                label="E-mail"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
            {erro && <Alert severity="error">{erro}</Alert>}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={aoFechar}>{link ? 'Fechar' : 'Cancelar'}</Button>
        {!link && (
          <Button variant="contained" onClick={enviar} disabled={ocupado}>
            {ocupado ? 'Gerando…' : 'Gerar e enviar'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

/**
 * "1.250,00" e "1250.00" chegam da mesma mao, em dias diferentes. Se o campo
 * recusasse a virgula, a recepcao digitaria o valor errado em vez de digitar
 * de novo.
 */
function valorEmNumero(bruto: string): number | null {
  const limpo = bruto.trim();
  if (!limpo) return null;
  const n = Number(limpo.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
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
  // Quinta revisao: o combinado com o tutor, fechado ANTES de o corpo chegar.
  const [devolucao, setDevolucao] = useState('');
  const [valor, setValor] = useState('');
  const [documento, setDocumento] = useState('');
  const [cidade, setCidade] = useState('');
  const [uf, setUf] = useState('');

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
            helperText="Forense exige fotodocumentação de cada etapa; hospitalar, não."
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

          {/*
            O responsavel legal com CPF, cidade e UF: e ele quem assina a
            autorizacao do exame, e o documento de autorizacao precisa
            identificar quem autorizou - nome solto nao identifica.
          */}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="CPF do responsável"
              value={documento}
              onChange={(e) => setDocumento(e.target.value)}
              sx={{ flex: 1.2 }}
              helperText="Vai na autorização do exame."
            />
            <TextField
              label="Cidade"
              value={cidade}
              onChange={(e) => setCidade(e.target.value)}
              sx={{ flex: 1.2 }}
              helperText=" "
            />
            <TextField
              label="UF"
              value={uf}
              onChange={(e) => setUf(e.target.value.toUpperCase().slice(0, 2))}
              sx={{ width: 110 }}
              helperText=" "
            />
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              select
              label="Devolução do corpo"
              value={devolucao}
              onChange={(e) => setDevolucao(e.target.value)}
              sx={{ flex: 1 }}
              helperText="Combinado na entrada; o destino do corpo segue no controle de cadáveres."
            >
              <MenuItem value="">A combinar</MenuItem>
              <MenuItem value="sim">Com devolução</MenuItem>
              <MenuItem value="nao">Sem devolução</MenuItem>
            </TextField>
            <TextField
              label="Valor combinado"
              value={valor}
              onChange={(e) => setValor(e.target.value.replace(/[^\d.,]/g, ''))}
              sx={{ flex: 1 }}
              helperText="Em reais. O tutor vê, mas não edita, no formulário."
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
                  devolucaoCorpo: devolucao === '' ? null : devolucao === 'sim',
                  valorCombinado: valorEmNumero(valor),
                  responsavelDocumento: documento.trim() || null,
                  responsavelCidade: cidade.trim() || null,
                  responsavelUf: uf.trim() || null,
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
  agir: (a: () => Promise<unknown>, p: string) => Promise<boolean>;
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
  agir: (a: () => Promise<unknown>, p: string) => Promise<boolean>;
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
  agir: (a: () => Promise<unknown>, p: string) => Promise<boolean>;
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
  agir: (a: () => Promise<unknown>, p: string) => Promise<boolean>;
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

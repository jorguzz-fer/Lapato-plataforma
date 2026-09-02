import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddOutlined from '@mui/icons-material/AddOutlined';
import DeleteOutline from '@mui/icons-material/DeleteOutlined';
import { LATERALIDADE, PRIORIDADE, type Lateralidade, type Prioridade } from '@lapato/shared';
import {
  api,
  ErroApi,
  type CasoCriado,
  type PacienteEncontrado,
  type ClienteResumo,
  type Servico,
  type Termo,
  type VeterinarioResumo,
} from '../api';

/**
 * M05 - Cadastro do caso anatomopatologico.
 *
 * Regras do modulo que a tela precisa preservar, e nao apenas exibir:
 *
 * - **Um paciente por caso.** Uma remessa com tres animais gera tres casos.
 *   Por isso nao ha "adicionar paciente" aqui.
 * - **Cadastrado nao e Recebido.** Este formulario registra o que foi
 *   declarado; a conferencia fisica acontece depois, na tela de recebimento.
 *   A quantidade digitada aqui e a **declarada**.
 * - **Lateralidade importa.** O Guardian compara a lateralidade do cadastro com
 *   a do laudo e bloqueia a assinatura se divergirem - o campo aqui e a origem
 *   dessa checagem.
 */

const PRIORIDADE_LABEL: Record<Prioridade, string> = {
  rotina: 'Rotina',
  prioritaria: 'Prioritária',
  urgente: 'Urgente',
  critica: 'Crítica',
};

const LATERALIDADE_LABEL: Record<Lateralidade, string> = {
  direito: 'Direito',
  esquerdo: 'Esquerdo',
  bilateral: 'Bilateral',
  nao_aplicavel: 'Não se aplica',
};

interface Amostra {
  descricao: string;
  orgaoId: string;
  regiaoAnatomica: string;
  lateralidade: Lateralidade;
}

interface Recipiente {
  tipoId: string;
  fixadorId: string;
  identificacaoExterna: string;
  quantidadeDeclarada: string;
}

const AMOSTRA_VAZIA: Amostra = {
  descricao: '',
  orgaoId: '',
  regiaoAnatomica: '',
  lateralidade: 'nao_aplicavel',
};

const RECIPIENTE_VAZIO: Recipiente = {
  tipoId: '',
  fixadorId: '',
  identificacaoExterna: '',
  quantidadeDeclarada: '1',
};

export function NovoCaso() {
  const navegar = useNavigate();

  const [servicos, setServicos] = useState<Servico[]>([]);
  const [clientes, setClientes] = useState<ClienteResumo[]>([]);
  const [veterinarios, setVeterinarios] = useState<VeterinarioResumo[]>([]);
  const [especies, setEspecies] = useState<Termo[]>([]);
  const [orgaos, setOrgaos] = useState<Termo[]>([]);
  const [tiposRecipiente, setTiposRecipiente] = useState<Termo[]>([]);
  const [fixadores, setFixadores] = useState<Termo[]>([]);

  const [servicoId, setServicoId] = useState('');
  const [cliente, setCliente] = useState<ClienteResumo | null>(null);
  const [veterinario, setVeterinario] = useState<VeterinarioResumo | null>(null);
  const [prioridade, setPrioridade] = useState<Prioridade>('rotina');
  /**
   * Data de entrada do material (segunda review): volume grande chega hoje e
   * e cadastrado amanha - o prazo conta da entrada, nao do cadastro.
   * `datetime-local` sem fuso; converte para ISO no envio.
   */
  const [entradaEm, setEntradaEm] = useState(agoraLocal());

  const [nome, setNome] = useState('');
  const [especieId, setEspecieId] = useState('');
  const [sexo, setSexo] = useState('');
  const [microchip, setMicrochip] = useState('');
  const [tutorNome, setTutorNome] = useState('');
  const [tutorTelefone, setTutorTelefone] = useState('');
  const [tutorEmail, setTutorEmail] = useState('');
  const [raca, setRaca] = useState('');
  const [idadeInformada, setIdadeInformada] = useState('');
  const [dataNascimento, setDataNascimento] = useState('');
  /**
   * Convenio x particular (documento do Hugo): no particular nao ha cliente
   * nem veterinario cadastrados - o responsavel traz a amostra, paga na
   * entrada e recebe o laudo; clinica e veterinario ficam como texto.
   */
  const [modalidade, setModalidade] = useState<'convenio' | 'particular'>('convenio');
  const [clinicaOrigem, setClinicaOrigem] = useState('');
  const [veterinarioInformado, setVeterinarioInformado] = useState('');
  /** Paciente ja atendido, reaproveitado: "so inserir o exame". */
  const [pacienteExistente, setPacienteExistente] = useState<PacienteEncontrado | null>(null);
  const [buscaPaciente, setBuscaPaciente] = useState('');
  const [encontrados, setEncontrados] = useState<PacienteEncontrado[]>([]);

  useEffect(() => {
    const q = buscaPaciente.trim();
    if (q.length < 2) {
      setEncontrados([]);
      return;
    }
    const alca = setTimeout(() => {
      api
        .get<PacienteEncontrado[]>(`/pacientes?q=${encodeURIComponent(q)}`)
        .then(setEncontrados)
        .catch(() => setEncontrados([]));
    }, 250);
    return () => clearTimeout(alca);
  }, [buscaPaciente]);

  function usarPaciente(p: PacienteEncontrado | null) {
    setPacienteExistente(p);
    if (!p) return;
    setNome(p.nome);
    setRaca(p.raca ?? '');
    setSexo(p.sexo ?? '');
    setMicrochip(p.microchip ?? '');
    setIdadeInformada(p.idadeInformada ?? '');
    setDataNascimento(p.dataNascimento ?? '');
    setTutorNome(p.tutorNome ?? '');
    setTutorTelefone(p.tutorTelefone ?? '');
    setTutorEmail(p.tutorEmail ?? '');
    const especie = especies.find((e) => e.valor === p.especie);
    if (especie) setEspecieId(especie.id);
  }
  const [historicoClinico, setHistoricoClinico] = useState('');

  const [amostras, setAmostras] = useState<Amostra[]>([{ ...AMOSTRA_VAZIA }]);
  const [recipientes, setRecipientes] = useState<Recipiente[]>([{ ...RECIPIENTE_VAZIO }]);

  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    void Promise.all([
      api.get<Servico[]>('/catalogo/servicos').then(setServicos),
      api.get<ClienteResumo[]>('/catalogo/clientes').then(setClientes),
      api.get<Termo[]>('/catalogo/tabelas/especie').then(setEspecies),
      api.get<Termo[]>('/catalogo/tabelas/orgao').then(setOrgaos),
      api.get<Termo[]>('/catalogo/tabelas/recipiente').then(setTiposRecipiente),
      api.get<Termo[]>('/catalogo/tabelas/fixador').then(setFixadores),
    ]).catch(() => setErro('Não foi possível carregar os dados de cadastro.'));
  }, []);

  /**
   * M03: o veterinario e pessoa unica com N vinculos. Filtrar por cliente usa o
   * vinculo - por isso a lista recarrega quando o cliente muda, e a selecao
   * anterior e descartada se nao pertencer ao novo cliente.
   */
  useEffect(() => {
    const caminho = cliente ? `/catalogo/veterinarios?clienteId=${cliente.id}` : '/catalogo/veterinarios';
    api
      .get<VeterinarioResumo[]>(caminho)
      .then((lista) => {
        setVeterinarios(lista);
        setVeterinario((atual) => (atual && lista.some((v) => v.id === atual.id) ? atual : null));
      })
      .catch(() => setVeterinarios([]));
  }, [cliente]);

  const servico = useMemo(() => servicos.find((s) => s.id === servicoId), [servicos, servicoId]);

  /** M07: as flags do serviço decidem o caminho. Dizer isso antes de salvar
      evita a surpresa de um caso que "sumiu" numa etapa inesperada. */
  const etapasPrevistas = useMemo(() => {
    if (!servico) return [];
    return [
      'Recebimento',
      servico.exigeTriagem && 'Triagem',
      servico.exigeMacroscopia && 'Macroscopia',
      servico.exigeProcessamento && 'Processamento',
      servico.exigeMicroscopia && 'Microscopia',
      'Laudo',
    ].filter((e): e is string => Boolean(e));
  }, [servico]);

  // Convenio: precisa do cliente. Particular: precisa do responsavel com um
  // contato - e dele que se cobra e para ele que vai o laudo. Paciente
  // reaproveitado ja traz o responsavel.
  const origemOk =
    modalidade === 'convenio'
      ? cliente !== null
      : pacienteExistente !== null ||
        (tutorNome.trim() !== '' && (tutorTelefone.trim() !== '' || tutorEmail.trim() !== ''));
  const valido = servicoId !== '' && origemOk && nome.trim() !== '';

  function alterarAmostra(i: number, campo: keyof Amostra, valor: string) {
    setAmostras((atual) => atual.map((a, j) => (i === j ? { ...a, [campo]: valor } : a)));
  }

  function alterarRecipiente(i: number, campo: keyof Recipiente, valor: string) {
    setRecipientes((atual) => atual.map((r, j) => (i === j ? { ...r, [campo]: valor } : r)));
  }

  async function submeter(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);

    try {
      const caso = await api.post<CasoCriado>('/casos', {
        servicoId,
        modalidade,
        ...(modalidade === 'convenio' && cliente ? { clienteId: cliente.id } : {}),
        ...(modalidade === 'convenio' && veterinario ? { veterinarioId: veterinario.id } : {}),
        ...(modalidade === 'particular' && clinicaOrigem.trim()
          ? { clinicaOrigem: clinicaOrigem.trim() }
          : {}),
        ...(modalidade === 'particular' && veterinarioInformado.trim()
          ? { veterinarioInformado: veterinarioInformado.trim() }
          : {}),
        prioridade,
        ...(entradaEm ? { entradaEm: new Date(entradaEm).toISOString() } : {}),
        paciente: {
          // Reaproveitado: so o id - o cadastro do animal ja existe.
          ...(pacienteExistente ? { id: pacienteExistente.id } : {}),
          nome: nome.trim(),
          ...(especieId ? { especieId } : {}),
          ...(raca.trim() ? { raca: raca.trim() } : {}),
          ...(sexo ? { sexo } : {}),
          ...(dataNascimento ? { dataNascimento } : {}),
          ...(idadeInformada.trim() ? { idadeInformada: idadeInformada.trim() } : {}),
          ...(microchip.trim() ? { microchip: microchip.trim() } : {}),
          ...(tutorNome.trim() ? { tutorNome: tutorNome.trim() } : {}),
          ...(tutorTelefone.trim() ? { tutorTelefone: tutorTelefone.trim() } : {}),
          ...(tutorEmail.trim() ? { tutorEmail: tutorEmail.trim() } : {}),
        },
        ...(historicoClinico.trim() ? { historicoClinico: historicoClinico.trim() } : {}),
        amostras: amostras.map((a) => ({
          ...(a.descricao.trim() ? { descricao: a.descricao.trim() } : {}),
          ...(a.orgaoId ? { orgaoId: a.orgaoId } : {}),
          ...(a.regiaoAnatomica.trim() ? { regiaoAnatomica: a.regiaoAnatomica.trim() } : {}),
          lateralidade: a.lateralidade,
        })),
        recipientes: recipientes.map((r) => ({
          ...(r.tipoId ? { tipoId: r.tipoId } : {}),
          ...(r.fixadorId ? { fixadorId: r.fixadorId } : {}),
          ...(r.identificacaoExterna.trim()
            ? { identificacaoExterna: r.identificacaoExterna.trim() }
            : {}),
          ...(Number(r.quantidadeDeclarada) > 0
            ? { quantidadeDeclarada: Number(r.quantidadeDeclarada) }
            : {}),
        })),
      });

      navegar(`/casos/${caso.id}`);
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível cadastrar o caso.');
      setEnviando(false);
    }
  }

  return (
    <Box component="form" onSubmit={submeter} noValidate sx={{ maxWidth: 900 }}>
      <Typography variant="h2" sx={{ mb: 0.5 }}>
        Novo caso
      </Typography>
      <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 3 }}>
        Um paciente por caso. Uma remessa com vários animais gera um caso para cada um.
      </Typography>

      <Stack spacing={2.5}>
        <Secao titulo="Exame e origem">
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              select
              required
              label="Serviço"
              value={servicoId}
              onChange={(e) => setServicoId(e.target.value)}
              sx={{ flex: 1 }}
            >
              {servicos.map((s) => (
                <MenuItem key={s.id} value={s.id}>
                  {s.nome}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              select
              label="Prioridade"
              value={prioridade}
              onChange={(e) => setPrioridade(e.target.value as Prioridade)}
              sx={{ flex: 1 }}
              helperText={
                servico?.prazoDiasUteis
                  ? `Prazo padrão: ${servico.prazoDiasUteis} dias úteis`
                  : ' '
              }
            >
              {PRIORIDADE.map((p) => (
                <MenuItem key={p} value={p}>
                  {PRIORIDADE_LABEL[p]}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              type="datetime-local"
              label="Entrada do material"
              value={entradaEm}
              onChange={(e) => setEntradaEm(e.target.value)}
              sx={{ flex: 1 }}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: agoraLocal() } }}
              helperText="Quando chegou ao laboratório — o prazo conta daqui."
            />
          </Stack>

          {etapasPrevistas.length > 0 && (
            <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', gap: 0.75 }}>
              <Typography sx={{ fontSize: 11.5, color: 'text.secondary', alignSelf: 'center' }}>
                Etapas previstas:
              </Typography>
              {etapasPrevistas.map((e) => (
                <Chip key={e} size="small" variant="outlined" label={e} />
              ))}
            </Stack>
          )}

          {/* Documento do Hugo: "quem cadastra escolhe convênio ou particular no início". */}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: 'center' }}>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={modalidade}
              onChange={(_, v: 'convenio' | 'particular' | null) => v && setModalidade(v)}
            >
              <ToggleButton value="convenio" sx={{ px: 2 }}>
                Convênio
              </ToggleButton>
              <ToggleButton value="particular" sx={{ px: 2 }}>
                Particular
              </ToggleButton>
            </ToggleButtonGroup>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
              {modalidade === 'convenio'
                ? 'Parceiro cadastrado: cobrado no fechamento do mês, laudo enviado a ele.'
                : 'O responsável traz a amostra: cobrado na entrada, laudo enviado a ele.'}
            </Typography>
          </Stack>

          {modalidade === 'particular' && (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="Clínica de origem"
                value={clinicaOrigem}
                onChange={(e) => setClinicaOrigem(e.target.value)}
                sx={{ flex: 1 }}
                helperText="Sem parceria — só o nome, como veio"
              />
              <TextField
                label="Veterinário solicitante"
                value={veterinarioInformado}
                onChange={(e) => setVeterinarioInformado(e.target.value)}
                sx={{ flex: 1 }}
                helperText=" "
              />
            </Stack>
          )}

          {modalidade === 'convenio' && (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <Autocomplete
              options={clientes}
              value={cliente}
              onChange={(_, v) => setCliente(v)}
              getOptionLabel={(o) => o.nomeFantasia}
              sx={{ flex: 1 }}
              renderInput={(params) => (
                <TextField {...params} required={modalidade === 'convenio'} label="Cliente" />
              )}
            />

            <Autocomplete
              options={veterinarios}
              value={veterinario}
              onChange={(_, v) => setVeterinario(v)}
              getOptionLabel={(o) =>
                o.crmv ? `${o.nome} — CRMV ${o.crmv}/${o.crmvUf ?? ''}` : o.nome
              }
              sx={{ flex: 1 }}
              /**
               * Lista vazia com cliente escolhido é o caso que mais confunde:
               * o veterinário existe no cadastro, mas não atende ESTE cliente
               * (M03 §§12-13). Sem dizer isso, a tela parece quebrada — e o
               * caminho para resolver fica a três cliques de distância, numa
               * seção de outra tela.
               */
              noOptionsText={
                cliente
                  ? 'Nenhum veterinário vinculado a este cliente.'
                  : 'Selecione o cliente primeiro.'
              }
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Veterinário solicitante"
                  helperText={
                    !cliente ? (
                      'Selecione o cliente primeiro'
                    ) : veterinarios.length === 0 ? (
                      <>
                        Nenhum veterinário vinculado a {cliente.nomeFantasia}. O vínculo se
                        cria na{' '}
                        <Link to="/clientes" style={{ color: 'inherit' }}>
                          ficha do cliente
                        </Link>
                        , em “Veterinários vinculados”.
                      </>
                    ) : (
                      'Vinculados a este cliente'
                    )
                  }
                />
              )}
            />
          </Stack>
          )}
        </Secao>

        <Secao
          titulo="Paciente"
          descricao="Já atendido? Busque por nome, responsável ou microchip e só insira o exame."
        >
          <Autocomplete
            options={encontrados}
            value={pacienteExistente}
            onChange={(_, v) => usarPaciente(v)}
            inputValue={buscaPaciente}
            onInputChange={(_, v, motivo) => {
              if (motivo !== 'reset') setBuscaPaciente(v);
            }}
            getOptionLabel={(o) => o.nome}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            filterOptions={(x) => x}
            noOptionsText={
              buscaPaciente.trim().length < 2 ? 'Digite ao menos 2 letras' : 'Nenhum paciente com esse nome'
            }
            renderOption={(props, o) => (
              <li {...props} key={o.id}>
                <Box>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 500 }}>
                    {o.nome}
                    {o.especie ? ` · ${o.especie}` : ''}
                    {o.raca ? ` · ${o.raca}` : ''}
                  </Typography>
                  <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>
                    {[
                      o.tutorNome ? `Responsável: ${o.tutorNome}` : null,
                      o.ultimoCaso
                        ? `Último exame ${o.ultimoCaso}${
                            o.ultimaEntrada
                              ? ` em ${new Date(o.ultimaEntrada).toLocaleDateString('pt-BR')}`
                              : ''
                          }`
                        : null,
                      `${o.totalCasos} exame${o.totalCasos === 1 ? '' : 's'}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Typography>
                </Box>
              </li>
            )}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Paciente já atendido"
                helperText={
                  pacienteExistente
                    ? `Cadastro reaproveitado — ${pacienteExistente.totalCasos} exame(s) anteriores. Os campos abaixo vêm dele.`
                    : 'Opcional. Sem correspondência, preencha abaixo e o paciente é criado.'
                }
              />
            )}
          />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              required
              label="Nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              sx={{ flex: 2 }}
            />
            <TextField
              select
              label="Espécie"
              value={especieId}
              onChange={(e) => setEspecieId(e.target.value)}
              sx={{ flex: 1 }}
            >
              <MenuItem value="">—</MenuItem>
              {especies.map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.valor}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Sexo"
              value={sexo}
              onChange={(e) => setSexo(e.target.value)}
              sx={{ flex: 1 }}
            >
              <MenuItem value="">—</MenuItem>
              <MenuItem value="macho">Macho</MenuItem>
              <MenuItem value="femea">Fêmea</MenuItem>
              <MenuItem value="indeterminado">Indeterminado</MenuItem>
            </TextField>
          </Stack>

          {/* Documento do Hugo: raça e idade faltavam; a idade vem na maioria das
              requisições, a data de nascimento em algumas. */}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Raça"
              value={raca}
              onChange={(e) => setRaca(e.target.value)}
              sx={{ flex: 1.4 }}
            />
            <TextField
              label="Idade"
              value={idadeInformada}
              onChange={(e) => setIdadeInformada(e.target.value)}
              placeholder="Ex.: 12 anos"
              sx={{ flex: 1 }}
            />
            <TextField
              type="date"
              label="Nascimento"
              value={dataNascimento}
              onChange={(e) => setDataNascimento(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ flex: 1 }}
            />
            <TextField
              label="Microchip"
              value={microchip}
              onChange={(e) => setMicrochip(e.target.value)}
              sx={{ flex: 1 }}
              // O Guardian trata microchip repetido em pacientes distintos como
              // achado crítico: é o sinal clássico de troca de identidade.
              helperText="Identifica o paciente entre casos"
            />
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Responsável"
              value={tutorNome}
              onChange={(e) => setTutorNome(e.target.value)}
              required={modalidade === 'particular'}
              sx={{ flex: 1.4 }}
            />
            <TextField
              label="Telefone do responsável"
              value={tutorTelefone}
              onChange={(e) => setTutorTelefone(e.target.value)}
              required={modalidade === 'particular' && !tutorEmail.trim()}
              sx={{ flex: 1 }}
              helperText={modalidade === 'particular' ? 'Telefone ou e-mail: é dele que se cobra' : ' '}
            />
            <TextField
              label="E-mail do responsável"
              type="email"
              value={tutorEmail}
              onChange={(e) => setTutorEmail(e.target.value)}
              sx={{ flex: 1 }}
              helperText={modalidade === 'particular' ? 'Para onde vai o laudo' : ' '}
            />
          </Stack>

          <TextField
            label="Histórico clínico"
            value={historicoClinico}
            onChange={(e) => setHistoricoClinico(e.target.value)}
            multiline
            minRows={3}
            fullWidth
            // M05/M11: o texto do solicitante nunca é substituído depois.
            helperText="Texto do solicitante. Fica preservado como veio."
          />
        </Secao>

        <Secao
          titulo="Amostras"
          descricao="O que foi coletado. A lateralidade é comparada com o laudo antes da assinatura."
          acao={
            <Button
              size="small"
              startIcon={<AddOutlined />}
              onClick={() => setAmostras((a) => [...a, { ...AMOSTRA_VAZIA }])}
            >
              Adicionar
            </Button>
          }
        >
          {amostras.map((a, i) => (
            <Stack
              key={i}
              direction={{ xs: 'column', md: 'row' }}
              spacing={2}
              sx={{ alignItems: 'flex-start' }}
            >
              <TextField
                label="Descrição"
                value={a.descricao}
                onChange={(e) => alterarAmostra(i, 'descricao', e.target.value)}
                sx={{ flex: 2 }}
              />
              <TextField
                select
                label="Órgão"
                value={a.orgaoId}
                onChange={(e) => alterarAmostra(i, 'orgaoId', e.target.value)}
                sx={{ flex: 1, minWidth: 130 }}
              >
                <MenuItem value="">—</MenuItem>
                {orgaos.map((t) => (
                  <MenuItem key={t.id} value={t.id}>
                    {t.valor}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Região anatômica"
                value={a.regiaoAnatomica}
                onChange={(e) => alterarAmostra(i, 'regiaoAnatomica', e.target.value)}
                sx={{ flex: 1 }}
              />
              <TextField
                select
                label="Lateralidade"
                value={a.lateralidade}
                onChange={(e) => alterarAmostra(i, 'lateralidade', e.target.value)}
                sx={{ flex: 1, minWidth: 140 }}
              >
                {LATERALIDADE.map((l) => (
                  <MenuItem key={l} value={l}>
                    {LATERALIDADE_LABEL[l]}
                  </MenuItem>
                ))}
              </TextField>

              <Remover
                rotulo="Remover amostra"
                desabilitado={amostras.length === 1}
                aoRemover={() => setAmostras((atual) => atual.filter((_, j) => j !== i))}
              />
            </Stack>
          ))}
        </Secao>

        <Secao
          titulo="Recipientes"
          descricao="O que chegou fisicamente. A quantidade aqui é a declarada — a conferência acontece no recebimento."
          acao={
            <Button
              size="small"
              startIcon={<AddOutlined />}
              onClick={() => setRecipientes((r) => [...r, { ...RECIPIENTE_VAZIO }])}
            >
              Adicionar
            </Button>
          }
        >
          {recipientes.map((r, i) => (
            <Stack
              key={i}
              direction={{ xs: 'column', md: 'row' }}
              spacing={2}
              sx={{ alignItems: 'flex-start' }}
            >
              <TextField
                select
                label="Tipo"
                value={r.tipoId}
                onChange={(e) => alterarRecipiente(i, 'tipoId', e.target.value)}
                sx={{ flex: 1, minWidth: 150 }}
              >
                <MenuItem value="">—</MenuItem>
                {tiposRecipiente.map((t) => (
                  <MenuItem key={t.id} value={t.id}>
                    {t.valor}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="Fixador"
                value={r.fixadorId}
                onChange={(e) => alterarRecipiente(i, 'fixadorId', e.target.value)}
                sx={{ flex: 1, minWidth: 150 }}
              >
                <MenuItem value="">—</MenuItem>
                {fixadores.map((t) => (
                  <MenuItem key={t.id} value={t.id}>
                    {t.valor}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Identificação externa"
                value={r.identificacaoExterna}
                onChange={(e) => alterarRecipiente(i, 'identificacaoExterna', e.target.value)}
                sx={{ flex: 1 }}
                helperText="Como veio rotulado pelo solicitante"
              />
              <TextField
                label="Qtd. declarada"
                type="number"
                value={r.quantidadeDeclarada}
                onChange={(e) => alterarRecipiente(i, 'quantidadeDeclarada', e.target.value)}
                sx={{ width: 130 }}
                slotProps={{ htmlInput: { min: 1 } }}
              />

              <Remover
                rotulo="Remover recipiente"
                desabilitado={recipientes.length === 1}
                aoRemover={() => setRecipientes((atual) => atual.filter((_, j) => j !== i))}
              />
            </Stack>
          ))}
        </Secao>

        {erro && <Alert severity="error">{erro}</Alert>}

        <Stack direction="row" spacing={1.5} sx={{ justifyContent: 'flex-end' }}>
          <Button onClick={() => navegar('/casos')} disabled={enviando}>
            Cancelar
          </Button>
          <Button type="submit" variant="contained" disabled={enviando || !valido}>
            {enviando ? 'Cadastrando…' : 'Cadastrar caso'}
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
}

function Secao({
  titulo,
  descricao,
  acao,
  children,
}: {
  titulo: string;
  descricao?: string;
  acao?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card sx={{ p: 2.5 }}>
      <Stack
        direction="row"
        sx={{ mb: 2, alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}
      >
        <Box>
          <Typography variant="h4">{titulo}</Typography>
          {descricao && (
            <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.25 }}>
              {descricao}
            </Typography>
          )}
        </Box>
        {acao}
      </Stack>

      <Divider sx={{ mb: 2.5 }} />

      <Stack spacing={2.5}>{children}</Stack>
    </Card>
  );
}

/**
 * O ultimo item nunca pode ser removido: a API exige ao menos uma amostra e um
 * recipiente. Desabilitar com explicacao evita o 400 que o usuario nao entenderia.
 */
function Remover({
  rotulo,
  desabilitado,
  aoRemover,
}: {
  rotulo: string;
  desabilitado: boolean;
  aoRemover: () => void;
}) {
  return (
    <Tooltip title={desabilitado ? 'É preciso ao menos um' : rotulo}>
      <span>
        <IconButton
          onClick={aoRemover}
          disabled={desabilitado}
          aria-label={rotulo}
          sx={{ mt: 0.5 }}
        >
          <DeleteOutline fontSize="small" />
        </IconButton>
      </span>
    </Tooltip>
  );
}

/** Agora, no formato do `datetime-local` (sem segundos, hora local). */
function agoraLocal(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

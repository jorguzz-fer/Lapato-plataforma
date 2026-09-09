import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { api, ErroApi, type Dossie as DadosDossie } from '../api';

/**
 * Correcao da identificacao do animal e do responsavel, depois do cadastro
 * (documento do Hugo: "quem inseriu pode errar ou nao entender a informacao -
 * e bem comum"; terceira revisao: "as vezes voce vai fazer a macro e olha, tem
 * um erro aqui, ta como femea"). O dialogo e um so, e aparece no dossie e no
 * cabecalho do material das bancadas. Cada correcao fica na auditoria; o
 * Guardian continua comparando identidade antes da assinatura.
 */
export function DialogoIdentificacao({
  dados,
  aberto,
  aoFechar,
  aoMudar,
}: {
  dados: DadosDossie;
  aberto: boolean;
  aoFechar: () => void;
  aoMudar: () => void;
}) {
  const [especies, setEspecies] = useState<Array<{ id: string; valor: string }>>([]);
  const [nome, setNome] = useState(dados.paciente.nome);
  const [especieId, setEspecieId] = useState(dados.paciente.especieId ?? '');
  const [raca, setRaca] = useState(dados.paciente.raca ?? '');
  const [sexo, setSexo] = useState(dados.paciente.sexo ?? '');
  const [dataNascimento, setDataNascimento] = useState(dados.paciente.dataNascimento ?? '');
  const [idadeInformada, setIdadeInformada] = useState(dados.paciente.idadeInformada ?? '');
  const [microchip, setMicrochip] = useState(dados.paciente.microchip ?? '');
  const [tutorNome, setTutorNome] = useState(dados.responsavel?.nome ?? '');
  const [tutorTelefone, setTutorTelefone] = useState(dados.responsavel?.telefone ?? '');
  const [tutorEmail, setTutorEmail] = useState(dados.responsavel?.email ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    // Reabrir parte do que esta gravado agora, nao do que estava quando a tela abriu.
    setNome(dados.paciente.nome);
    setEspecieId(dados.paciente.especieId ?? '');
    setRaca(dados.paciente.raca ?? '');
    setSexo(dados.paciente.sexo ?? '');
    setDataNascimento(dados.paciente.dataNascimento ?? '');
    setIdadeInformada(dados.paciente.idadeInformada ?? '');
    setMicrochip(dados.paciente.microchip ?? '');
    setTutorNome(dados.responsavel?.nome ?? '');
    setTutorTelefone(dados.responsavel?.telefone ?? '');
    setTutorEmail(dados.responsavel?.email ?? '');
    setErro(null);
    api
      .get<Array<{ id: string; valor: string }>>('/catalogo/tabelas/especie')
      .then(setEspecies)
      .catch(() => setEspecies([]));
  }, [aberto, dados]);

  async function salvar() {
    setOcupado(true);
    setErro(null);
    try {
      await api.post(`/pacientes/${dados.paciente.id}`, {
        nome: nome.trim(),
        especieId: especieId || '',
        raca,
        sexo,
        dataNascimento,
        idadeInformada,
        microchip,
        tutorNome,
        tutorTelefone,
        tutorEmail,
      });
      aoFechar();
      aoMudar();
    } catch (err) {
      setErro(err instanceof ErroApi ? err.detalhe : 'Não foi possível salvar.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Dialog open={aberto} onClose={aoFechar} fullWidth maxWidth="sm">
      <DialogTitle>Corrigir identificação do animal</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
            A correção fica registrada na auditoria, campo a campo.
          </Typography>
          <TextField label="Nome" value={nome} onChange={(e) => setNome(e.target.value)} required />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
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
            <TextField label="Raça" value={raca} onChange={(e) => setRaca(e.target.value)} sx={{ flex: 1 }} />
            <TextField select label="Sexo" value={sexo} onChange={(e) => setSexo(e.target.value)} sx={{ flex: 1 }}>
              <MenuItem value="">—</MenuItem>
              <MenuItem value="macho">Macho</MenuItem>
              <MenuItem value="femea">Fêmea</MenuItem>
              <MenuItem value="indeterminado">Indeterminado</MenuItem>
            </TextField>
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Idade"
              value={idadeInformada}
              onChange={(e) => setIdadeInformada(e.target.value)}
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
            />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Responsável"
              value={tutorNome}
              onChange={(e) => setTutorNome(e.target.value)}
              sx={{ flex: 1.4 }}
            />
            <TextField
              label="Telefone"
              value={tutorTelefone}
              onChange={(e) => setTutorTelefone(e.target.value)}
              sx={{ flex: 1 }}
            />
            <TextField
              label="E-mail"
              type="email"
              value={tutorEmail}
              onChange={(e) => setTutorEmail(e.target.value)}
              sx={{ flex: 1 }}
            />
          </Stack>
          {erro && <Alert severity="error">{erro}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={aoFechar} disabled={ocupado}>
          Cancelar
        </Button>
        <Button variant="contained" onClick={() => void salvar()} disabled={ocupado || !nome.trim()}>
          {ocupado ? 'Salvando…' : 'Salvar correção'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Bloco do dossiê: os campos e o botão de correção. */
export function IdentificacaoDoAnimal({
  dados,
  podeEditar,
  aoMudar,
}: {
  dados: DadosDossie;
  podeEditar: boolean;
  aoMudar: () => void;
}) {
  const [editando, setEditando] = useState(false);

  return (
    <>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>Identificação do animal</Typography>
        {podeEditar && (
          <Button size="small" onClick={() => setEditando(true)}>
            Corrigir identificação
          </Button>
        )}
      </Stack>
      <Campo rotulo="Raça" valor={dados.paciente.raca ?? '—'} />
      <Campo
        rotulo="Idade"
        valor={
          dados.paciente.idadeInformada ??
          (dados.paciente.dataNascimento
            ? `nascido em ${new Date(`${dados.paciente.dataNascimento}T12:00:00`).toLocaleDateString('pt-BR')}`
            : '—')
        }
      />
      <Campo rotulo="Microchip" valor={dados.paciente.microchip ?? '—'} />
      <Campo
        rotulo="Responsável"
        valor={
          dados.responsavel
            ? [dados.responsavel.nome, dados.responsavel.telefone, dados.responsavel.email]
                .filter(Boolean)
                .join(' · ')
            : '—'
        }
      />
      {dados.caso.modalidade === 'particular' && (
        <>
          <Campo rotulo="Clínica de origem" valor={dados.caso.clinicaOrigem ?? '—'} />
          <Campo rotulo="Veterinário solicitante" valor={dados.caso.veterinarioInformado ?? '—'} />
        </>
      )}

      <DialogoIdentificacao dados={dados} aberto={editando} aoFechar={() => setEditando(false)} aoMudar={aoMudar} />
    </>
  );
}

function Campo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <Box>
      <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{rotulo}</Typography>
      <Typography sx={{ fontSize: 13.5 }}>{valor}</Typography>
    </Box>
  );
}

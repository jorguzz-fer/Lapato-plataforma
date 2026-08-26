import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import InboxOutlined from '@mui/icons-material/InboxOutlined';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import { api } from '../../api';

/**
 * Peças comuns das duas telas de cadastro do M03 (Clientes e Veterinários).
 *
 * As duas telas nasceram como abas de uma só e foram separadas: são cadastros
 * de entidades diferentes, com buscas, ações e permissões próprias. O que
 * continua igual mora aqui — o cabeçalho, a busca, o vazio, e o botão que
 * materializa a regra estruturante do módulo: **inativar, nunca excluir**.
 */

export const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };

/** Compartilhado porque a lista de duplicidades do veterinário também o usa. */
export const STATUS_LABEL: Record<string, string> = {
  ativo: 'Ativo',
  aguardando_aprovacao: 'Aguardando aprovação',
  pendente_documentacao: 'Pendente de documentação',
  suspenso: 'Suspenso',
  inativo: 'Inativo',
  bloqueado: 'Bloqueado',
  encerrado: 'Encerrado',
};

/**
 * M03: a ficha histórica continua acessível; inativo apenas some das opções de
 * exame novo. Por isso nunca há "excluir" — só este botão, que vai e volta.
 */
export function BotaoAtivacao({
  inativo,
  caminho,
  aoMudar,
}: {
  inativo: boolean;
  caminho: string;
  aoMudar: () => void;
}) {
  const [ocupado, setOcupado] = useState(false);

  async function alternar() {
    setOcupado(true);
    try {
      await api.post(`${caminho}/${inativo ? 'reativacao' : 'inativacao'}`);
      aoMudar();
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Button
      size="small"
      color={inativo ? 'primary' : 'inherit'}
      onClick={() => void alternar()}
      disabled={ocupado}
    >
      {inativo ? 'Reativar' : 'Inativar'}
    </Button>
  );
}

export function Vazio({ texto }: { texto: string }) {
  return (
    <Box sx={{ py: 7, textAlign: 'center' }}>
      <InboxOutlined sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
      <Typography sx={{ fontSize: 13.5, color: 'text.secondary' }}>{texto}</Typography>
    </Box>
  );
}

/** Título, subtítulo e a ação principal da tela, na mesma linha. */
export function CabecalhoCadastro({
  titulo,
  descricao,
  acao,
}: {
  titulo: string;
  descricao: string;
  acao?: React.ReactNode;
}) {
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      sx={{
        mb: 1.5,
        alignItems: { xs: 'stretch', sm: 'center' },
        justifyContent: 'space-between',
        gap: 1.5,
      }}
    >
      <Box>
        <Typography variant="h2">{titulo}</Typography>
        <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>{descricao}</Typography>
      </Box>
      {acao}
    </Stack>
  );
}

export function CampoBusca({
  valor,
  aoMudar,
  placeholder,
}: {
  valor: string;
  aoMudar: (v: string) => void;
  placeholder: string;
}) {
  return (
    <TextField
      size="small"
      placeholder={placeholder}
      value={valor}
      onChange={(e) => aoMudar(e.target.value)}
      sx={{ mb: 2, width: '100%', maxWidth: 520 }}
      slotProps={{
        input: {
          startAdornment: (
            <SearchOutlined sx={{ fontSize: 18, color: 'text.disabled', mr: 1 }} />
          ),
        },
      }}
    />
  );
}

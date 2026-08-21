import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import LockOutlined from '@mui/icons-material/LockOutlined';
import { marca, raio } from '@lapato/design-tokens';
import type { ReactNode } from 'react';

/**
 * Moldura das telas de entrada: login, segundo fator, troca de senha e cadastro
 * de MFA.
 *
 * Divide a tela em dois: a esquerda escura diz o que o sistema e, a direita
 * clara pede o que precisa. O usuario atravessa ate tres destas telas em
 * sequencia, e manter o enquadramento evita a impressao de que algo quebrou no
 * meio do caminho.
 *
 * Em telas estreitas o painel escuro desaparece: num celular ele custaria a
 * altura toda antes de mostrar o primeiro campo.
 */

export interface DestaqueEntrada {
  icone: ReactNode;
  titulo: string;
  descricao: string;
}

export function MolduraEntrada({
  titulo,
  descricao,
  children,
  vitrine,
}: {
  /** Cabecalho do formulario, a direita. */
  titulo: string;
  descricao?: string;
  children: ReactNode;
  /** Conteudo do painel escuro. Ausente, a tela fica so com o formulario. */
  vitrine?: {
    etiqueta: string;
    manchete: ReactNode;
    texto: string;
    destaques: DestaqueEntrada[];
  };
}) {
  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      {vitrine && (
        <Box
          sx={{
            display: { xs: 'none', md: 'flex' },
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            width: '52%',
            p: 6,
            position: 'relative',
            overflow: 'hidden',
            backgroundColor: '#16181d',
            // Brilho radial atras da marca: da profundidade sem imagem, o que
            // mantem a tela leve e independente de asset externo.
            backgroundImage: `radial-gradient(circle at 50% 38%, ${marca.primaria.main}22 0%, transparent 55%)`,
          }}
        >
          <Stack spacing={3} sx={{ maxWidth: 460, textAlign: 'center', alignItems: 'center' }}>
            <Typography
              sx={{ fontSize: 34, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em' }}
            >
              LAPATO
            </Typography>

            <Box
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 1,
                px: 2,
                py: 0.75,
                borderRadius: `${raio.pilula}px`,
                border: '1px solid #ffffff1f',
                backgroundColor: '#ffffff0a',
              }}
            >
              <Box
                sx={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  backgroundColor: marca.primaria[400],
                }}
              />
              <Typography sx={{ fontSize: 12, color: '#cfd3dc' }}>{vitrine.etiqueta}</Typography>
            </Box>

            <Typography
              component="h2"
              sx={{ fontSize: 30, fontWeight: 700, color: '#fff', lineHeight: 1.25 }}
            >
              {vitrine.manchete}
            </Typography>

            <Typography sx={{ fontSize: 14, color: '#9aa1ae', lineHeight: 1.7 }}>
              {vitrine.texto}
            </Typography>

            <Stack direction="row" spacing={1.5} sx={{ pt: 2, width: '100%' }}>
              {vitrine.destaques.map((d) => (
                <Box
                  key={d.titulo}
                  sx={{
                    flex: 1,
                    p: 1.75,
                    textAlign: 'left',
                    borderRadius: `${raio.grande}px`,
                    border: '1px solid #ffffff14',
                    backgroundColor: '#ffffff08',
                  }}
                >
                  <Box sx={{ color: marca.primaria[400], mb: 0.75, display: 'flex' }}>{d.icone}</Box>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: '#fff' }}>
                    {d.titulo}
                  </Typography>
                  <Typography sx={{ fontSize: 11.5, color: '#8b93a1', lineHeight: 1.4 }}>
                    {d.descricao}
                  </Typography>
                </Box>
              ))}
            </Stack>
          </Stack>
        </Box>
      )}

      <Box
        sx={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: { xs: 3, sm: 6 },
          backgroundColor: 'background.default',
        }}
      >
        <Box sx={{ width: '100%', maxWidth: 380 }}>
          <Typography component="h1" sx={{ fontSize: 24, fontWeight: 700, mb: 0.5 }}>
            {titulo}
          </Typography>

          {descricao && (
            <Typography sx={{ fontSize: 13.5, color: 'text.secondary', mb: 3.5 }}>
              {descricao}
            </Typography>
          )}

          {children}

          <Stack
            direction="row"
            spacing={0.75}
            sx={{ mt: 3, justifyContent: 'center', alignItems: 'center', color: 'text.secondary' }}
          >
            <LockOutlined sx={{ fontSize: 13 }} />
            <Typography sx={{ fontSize: 11.5 }}>
              Conexão segura — sessão protegida por cookie e segundo fator
            </Typography>
          </Stack>
        </Box>
      </Box>
    </Box>
  );
}

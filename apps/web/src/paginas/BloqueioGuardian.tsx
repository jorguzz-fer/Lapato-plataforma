import { Alert, AlertTitle, Box, Stack, Typography } from '@mui/material';
import type { ErroApi } from '../api';

/**
 * O bloqueio do Guardian, do jeito que quem foi barrado precisa ler.
 *
 * Duas coisas que a versao anterior errava, e que so aparecem quando alguem
 * usa de verdade:
 *
 * 1. **Repetia.** Mostrava o `detalhe` do erro - que e a concatenacao das
 *    mensagens - e logo abaixo a lista com as mesmas frases. O usuario lia
 *    tudo duas vezes e nao ganhava nada na segunda.
 * 2. **Nao dizia a saida.** "O profissional nao possui assinatura ativa e
 *    valida" descreve o impedimento e para por ai. O M17 secao 11 poe a
 *    decisao no profissional, e decidir exige saber qual e o caminho - por
 *    isso cada achado agora carrega o `comoResolver`.
 *
 * As tres telas que barram (triagem, macroscopia e laudo) usam este mesmo
 * componente: um bloqueio deve se parecer com um bloqueio em qualquer lugar.
 */
export function BloqueioGuardian({ erro, acao }: { erro: ErroApi; acao?: string }) {
  return (
    <Alert severity="error" sx={{ mt: 2.5 }}>
      <AlertTitle>{acao ? `Não foi possível ${acao}` : 'Ação impedida pelo Guardian'}</AlertTitle>

      <Stack component="ul" spacing={1.5} sx={{ m: 0, pl: 2.5 }}>
        {(erro.achados ?? []).map((achado) => (
          <Box component="li" key={achado.codigo}>
            <Typography sx={{ fontSize: 13 }}>{achado.mensagem}</Typography>

            {achado.comoResolver && (
              <Typography sx={{ fontSize: 13, mt: 0.25, fontWeight: 500 }}>
                {achado.comoResolver}
              </Typography>
            )}

            {achado.evidencias && (
              <Typography sx={{ fontSize: 11.5, color: 'text.secondary', mt: 0.25 }}>
                {Object.entries(achado.evidencias)
                  .map(([chave, valor]) => `${chave}: ${String(valor)}`)
                  .join(' · ')}
              </Typography>
            )}
          </Box>
        ))}
      </Stack>

      {/* Sem achados estruturados o `detalhe` e tudo o que ha - raro, mas o
          usuario nao pode ficar com um alerta vazio. */}
      {!erro.achados?.length && <Typography sx={{ fontSize: 13 }}>{erro.detalhe}</Typography>}

      {/* M17 secao 15: quem produziu o alerta fica dito. O titulo carrega a
          consequencia, que e o que a pessoa precisa ler primeiro; a autoria
          vem aqui, sem competir com ela. */}
      <Typography sx={{ fontSize: 11.5, color: 'text.secondary', mt: 1.5 }}>
        Verificação automática do LAPATO Guardian.
      </Typography>
    </Alert>
  );
}

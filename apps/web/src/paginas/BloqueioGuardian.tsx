import { Alert, AlertTitle, Box, Divider, Stack, Typography } from '@mui/material';
import type { AchadoGuardian } from '@lapato/shared';
import type { ErroApi } from '../api';

/**
 * O bloqueio do Guardian, do jeito que quem foi barrado precisa ler.
 *
 * Tres coisas que a versao anterior errava, e que so apareceram quando alguem
 * usou de verdade:
 *
 * 1. **Repetia.** Mostrava o `detalhe` do erro - que e a concatenacao das
 *    mensagens - e logo abaixo a lista com as mesmas frases.
 * 2. **Nao dizia a saida.** "O profissional nao possui assinatura ativa e
 *    valida" descreve o impedimento e para ai. O M17 secao 11 poe a decisao no
 *    profissional, e decidir exige saber o caminho - dai o `comoResolver`.
 * 3. **Misturava o que barra com o que so avisa.** A resposta traz todos os
 *    achados, e uma observacao de nivel `atencao` aparecia no meio do alerta
 *    vermelho com o mesmo peso do que realmente impede. O M17 secao 11 pede
 *    padrao visual consistente por nivel: aqui isso vira separacao, e nao so
 *    cor - o M07 exige que o indicador nao dependa apenas dela.
 *
 * As tres telas que barram (triagem, macroscopia e laudo) usam este mesmo
 * componente: um bloqueio deve se parecer com um bloqueio em qualquer lugar.
 */
export function BloqueioGuardian({ erro, acao }: { erro: ErroApi; acao?: string }) {
  const achados = erro.achados ?? [];
  const impedem = achados.filter((a) => a.nivel === 'critico');
  const observacoes = achados.filter((a) => a.nivel !== 'critico');

  return (
    <Alert severity="error" sx={{ mt: 2.5 }}>
      <AlertTitle>{acao ? `Não foi possível ${acao}` : 'Ação impedida pelo Guardian'}</AlertTitle>

      <ListaDeAchados achados={impedem} />

      {observacoes.length > 0 && (
        <>
          <Divider sx={{ my: 1.5 }} />
          <Typography sx={{ fontSize: 12, fontWeight: 600, mb: 0.75 }}>
            Não impedem, mas vale conferir
          </Typography>
          <ListaDeAchados achados={observacoes} />
        </>
      )}

      {/* Sem achados estruturados o `detalhe` e tudo o que ha - raro, mas o
          usuario nao pode ficar com um alerta vazio. */}
      {achados.length === 0 && <Typography sx={{ fontSize: 13 }}>{erro.detalhe}</Typography>}

      {/* M17 secao 15: quem produziu o alerta fica dito. O titulo carrega a
          consequencia, que e o que a pessoa precisa ler primeiro; a autoria
          vem aqui, sem competir com ela. */}
      <Typography sx={{ fontSize: 11.5, color: 'text.secondary', mt: 1.5 }}>
        Verificação automática do LAPATO Guardian.
      </Typography>
    </Alert>
  );
}

function ListaDeAchados({ achados }: { achados: AchadoGuardian[] }) {
  if (achados.length === 0) return null;

  return (
    <Stack component="ul" spacing={1.5} sx={{ m: 0, pl: 2.5 }}>
      {achados.map((achado, i) => (
        /* A chave leva o indice porque a mesma regra dispara varias vezes numa
           varredura de acervo - dez materiais esgotados sao dez achados com o
           mesmo codigo. */
        <Box component="li" key={`${achado.codigo}-${i}`}>
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
  );
}

/**
 * Varredura do Guardian sobre um acervo inteiro, e nao sobre uma acao.
 *
 * A diferenca com `BloqueioGuardian` nao e visual, e de natureza: la o achado
 * barrou alguem agora; aqui ele descreve incoerencia que **ja existe** e
 * continua existindo ate alguem resolver (M15 secao 70, M18 secao 86). Por
 * isso o severity acompanha o pior nivel encontrado em vez de ser sempre
 * vermelho - um acervo com tres avisos informativos nao e um acervo em
 * emergencia.
 */
export function ConferenciaGuardian({
  achados,
  titulo,
}: {
  achados: AchadoGuardian[];
  titulo: string;
}) {
  if (achados.length === 0) return null;

  const impedem = achados.filter((a) => a.nivel === 'critico');
  const observacoes = achados.filter((a) => a.nivel !== 'critico');

  return (
    <Alert severity={impedem.length > 0 ? 'error' : 'warning'}>
      <AlertTitle>
        {titulo}
        {impedem.length > 0 ? ` — ${impedem.length} exige(m) ação` : ''}
      </AlertTitle>

      <ListaDeAchados achados={impedem} />

      {observacoes.length > 0 && (
        <>
          {impedem.length > 0 && <Divider sx={{ my: 1.5 }} />}
          {impedem.length > 0 && (
            <Typography sx={{ fontSize: 12, fontWeight: 600, mb: 0.75 }}>
              Não impedem, mas vale conferir
            </Typography>
          )}
          <ListaDeAchados achados={observacoes} />
        </>
      )}

      <Typography sx={{ fontSize: 11.5, color: 'text.secondary', mt: 1.5 }}>
        Verificação automática do LAPATO Guardian.
      </Typography>
    </Alert>
  );
}

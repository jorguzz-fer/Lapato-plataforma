import { Alert, AlertTitle, Box, Button } from '@mui/material';
import { Link } from 'react-router-dom';
import { motivoBancadaBloqueada, type EtapaBancada } from '@lapato/shared';
import type { Dossie } from '../api';

/**
 * Por que a etapa de bancada ainda nao pode comecar, ou `null` se puder.
 *
 * A regra vem de `@lapato/shared`, a mesma funcao que a API usa para recusar.
 * Isso e proposital: tela e API precisam concordar sobre o que e "pronto para a
 * bancada". Com a regra duplicada elas divergem no primeiro ajuste, e a
 * divergencia aparece como o usuario clicando num botao que so devolve erro.
 *
 * A tela nao decide nada - ela antecipa. Quem barra continua sendo o servidor
 * (Blueprint secao 1.3).
 */
export function impedimentoDeBancada(dossie: Dossie, etapa: EtapaBancada): string | null {
  return motivoBancadaBloqueada(
    {
      recebidoEm: dossie.caso.recebidoEm,
      triadoEm: dossie.caso.triadoEm,
      resultadoTriagem: dossie.caso.resultadoTriagem,
      exigeTriagem: dossie.servico.exigeTriagem,
    },
    etapa,
  );
}

export function AvisoBancadaBloqueada({
  dossie,
  etapa,
}: {
  dossie: Dossie;
  etapa: EtapaBancada;
}) {
  const motivo = impedimentoDeBancada(dossie, etapa);
  if (!motivo) return null;

  // Leva a etapa que efetivamente falta, nao ao dossie generico: o proximo
  // passo de quem le isto e registrar o recebimento ou triar.
  const faltaReceber = !dossie.caso.recebidoEm;
  const destino = faltaReceber
    ? `/casos/${dossie.caso.id}/recebimento`
    : `/casos/${dossie.caso.id}/triagem`;

  return (
    <Box sx={{ maxWidth: 860 }}>
      <Alert
        severity="info"
        action={
          <Button size="small" component={Link} to={destino}>
            {faltaReceber ? 'Ir ao recebimento' : 'Ir à triagem'}
          </Button>
        }
      >
        <AlertTitle>
          {faltaReceber ? 'Material ainda não recebido' : 'Triagem pendente'}
        </AlertTitle>
        {motivo} ({dossie.caso.identificador})
      </Alert>
    </Box>
  );
}

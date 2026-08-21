import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import { estadoPrazo, raio, type EstadoPrazo } from '@lapato/design-tokens';

/**
 * Indicador de prazo do caso (M07).
 *
 * O modulo exige que o estado seja perceptivel **sem depender apenas de cor**.
 * Por isso o chip carrega tres sinais redundantes: cor, simbolo geometrico e
 * texto. Quem nao distingue vermelho de verde continua vendo `▲ Atrasado`.
 *
 * E componente, e nao um `<Chip color="error">` em cada tela, exatamente para
 * que essa exigencia nao dependa de alguem lembrar dela.
 */
export function IndicadorPrazo({
  estado,
  previsao,
  tamanho = 'small',
}: {
  estado: EstadoPrazo;
  /** Data prevista de liberacao, exibida na dica. */
  previsao?: string | null;
  tamanho?: 'small' | 'medium';
}) {
  const def = estadoPrazo[estado];

  const chip = (
    <Chip
      size={tamanho}
      label={`${def.simbolo} ${def.rotulo}`}
      sx={{
        color: def.cor,
        backgroundColor: def.fundo,
        borderRadius: `${raio.pilula}px`,
        fontVariantNumeric: 'tabular-nums',
      }}
    />
  );

  if (!previsao) return chip;

  return (
    <Tooltip title={`Previsão de liberação: ${previsao}`}>
      <span>{chip}</span>
    </Tooltip>
  );
}

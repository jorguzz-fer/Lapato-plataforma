import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ETAPA, type AlertaPrazo } from '@lapato/shared';
import { api, type CasoNaFila } from '../api';

/**
 * M07 - Central de Casos.
 *
 * "Onde o caso esta, em que etapa, o que falta, quem e responsavel, se ha
 * pendencia e se esta no prazo."
 */

/**
 * M07 exige indicadores que **nao dependam exclusivamente de cores** - por
 * acessibilidade. Cada alerta tem cor, simbolo e rotulo textual.
 */
const ALERTA: Record<AlertaPrazo, { rotulo: string; simbolo: string; cor: string }> = {
  normal: { rotulo: 'No prazo', simbolo: '●', cor: 'var(--lapato-sucesso)' },
  atencao: { rotulo: 'Atenção', simbolo: '▲', cor: 'var(--lapato-atencao)' },
  critico: { rotulo: 'Crítico', simbolo: '◆', cor: 'var(--lapato-perigo)' },
  atrasado: { rotulo: 'Atrasado', simbolo: '■', cor: 'var(--lapato-perigo)' },
};

const ETAPA_LABEL: Record<string, string> = {
  aguardando_recebimento: 'Aguardando recebimento',
  aguardando_triagem: 'Aguardando triagem',
  aguardando_macroscopia: 'Aguardando macroscopia',
  aguardando_processamento: 'Em processamento',
  aguardando_microscopia: 'Aguardando microscopia',
  aguardando_revisao: 'Aguardando revisão',
  aguardando_assinatura: 'Aguardando assinatura',
  liberado: 'Liberado',
};

export function CentralDeCasos() {
  const [casos, setCasos] = useState<CasoNaFila[]>([]);
  const [etapa, setEtapa] = useState('');
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    setCarregando(true);
    api
      .get<CasoNaFila[]>(`/fluxo/casos${etapa ? `?etapa=${etapa}` : ''}`)
      .then(setCasos)
      .finally(() => setCarregando(false));
  }, [etapa]);

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Central de Casos</h1>

        <label className="flex items-center gap-2 text-xs">
          <span className="rotulo">Etapa</span>
          <select
            value={etapa}
            onChange={(e) => setEtapa(e.target.value)}
            className="rounded border px-2 py-1"
            style={{ borderColor: 'var(--lapato-borda)', background: 'var(--lapato-superficie)' }}
          >
            <option value="">Todas</option>
            {ETAPA.map((e) => (
              <option key={e} value={e}>
                {ETAPA_LABEL[e] ?? e}
              </option>
            ))}
          </select>
        </label>
      </div>

      {carregando && <p className="rotulo">Carregando…</p>}

      {!carregando && casos.length === 0 && (
        <p className="rotulo">Nenhum caso nesta visão.</p>
      )}

      {casos.length > 0 && (
        <div className="cartao overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--lapato-borda)' }}>
                <th className="p-3 rotulo">Registro</th>
                <th className="p-3 rotulo">Paciente</th>
                <th className="p-3 rotulo">Cliente</th>
                <th className="p-3 rotulo">Exame</th>
                <th className="p-3 rotulo">Etapa</th>
                <th className="p-3 rotulo">Previsão</th>
                <th className="p-3 rotulo">Prazo</th>
              </tr>
            </thead>
            <tbody>
              {casos.map((c) => {
                const alerta = ALERTA[c.alertaPrazo];
                return (
                  <tr
                    key={c.casoId}
                    className="border-b last:border-0"
                    style={{ borderColor: 'var(--lapato-borda)' }}
                  >
                    <td className="p-3 font-mono text-xs">
                      <Link to={`/casos/${c.casoId}`} className="underline">
                        {c.identificador}
                      </Link>
                    </td>
                    <td className="p-3">{c.paciente}</td>
                    <td className="p-3">{c.cliente}</td>
                    <td className="p-3">{c.servico}</td>
                    <td className="p-3">
                      {ETAPA_LABEL[c.etapa] ?? c.etapa}
                      {c.bloqueado && (
                        <span
                          className="ml-2 rounded px-1.5 py-0.5 text-[0.7rem] text-white"
                          style={{ background: 'var(--lapato-perigo)' }}
                        >
                          bloqueado
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-xs">
                      {c.previsaoLiberacao
                        ? new Date(c.previsaoLiberacao).toLocaleDateString('pt-BR')
                        : '—'}
                    </td>
                    <td className="p-3">
                      <span className="inline-flex items-center gap-1 text-xs">
                        <span aria-hidden style={{ color: alerta.cor }}>
                          {alerta.simbolo}
                        </span>
                        {alerta.rotulo}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

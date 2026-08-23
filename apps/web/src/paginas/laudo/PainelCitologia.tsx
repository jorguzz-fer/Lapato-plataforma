import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { AvaliacaoCitologica, CitologiaDaVersao, VocabularioCitologia } from '../../api';

/**
 * M12 - Citopatologia: a avaliacao morfologica dentro da bancada do M11.
 *
 * O que o modulo pede e a tela obedece:
 *
 * - **Uma avaliacao por amostra** (secoes 115 e 142): tres massas aspiradas no
 *   mesmo caso podem ter tres adequacoes e tres conclusoes. Por isso um bloco
 *   por amostra, e nao um formulario unico do laudo.
 * - **A citologia nao e histopatologia sem macroscopia** (secao 145). A ordem
 *   dos campos e a do raciocinio citologico da secao 143: que material e este,
 *   a amostra e adequada, qual a celularidade, como esta o fundo, que
 *   populacoes existem, ha criterios de malignidade, ha inflamacao ou agentes,
 *   e so entao a interpretacao.
 * - **Adequacao nao se simplifica** (secoes 10-12): marcar limitacao pede o
 *   motivo, e "adequada com limitacoes" nao vira "insatisfatoria".
 * - **Nao existe diagnostico por cliques** (secao 73). Os campos estruturados
 *   nao somam para lugar nenhum: nenhuma contagem de criterios vira conclusao,
 *   e a descricao livre continua ao lado deles, nao no lugar deles (secao 142).
 * - **Grau de certeza e interno** (secao 66) - fica marcado como tal na tela,
 *   porque quem preenche precisa saber que aquilo nao sai no documento.
 */

const ADEQUACAO_LABEL: Record<string, string> = {
  adequada: 'Adequada',
  adequada_com_limitacoes: 'Adequada com limitações',
  pouco_representativa: 'Pouco representativa',
  insatisfatoria: 'Insatisfatória',
  nao_diagnostica: 'Não diagnóstica',
};

const CELULARIDADE_LABEL: Record<string, string> = {
  acelular: 'Acelular',
  muito_baixa: 'Muito baixa',
  baixa: 'Baixa',
  moderada: 'Moderada',
  alta: 'Alta',
  muito_alta: 'Muito alta',
};

const PRESERVACAO_LABEL: Record<string, string> = {
  excelente: 'Excelente',
  boa: 'Boa',
  moderada: 'Moderada',
  ruim: 'Ruim',
  acentuadamente_degenerada: 'Acentuadamente degenerada',
};

const INTENSIDADE_LABEL: Record<string, string> = {
  ausente: 'Ausente',
  discreta: 'Discreta',
  moderada: 'Moderada',
  acentuada: 'Acentuada',
};

const CERTEZA_LABEL: Record<string, string> = {
  alta: 'Alta confiança',
  moderada: 'Moderada',
  limitada: 'Limitada',
};

/** Intensidade por criterio (secao 28) - o criterio so existe se tiver grau. */
const GRAUS_CRITERIO = ['discreto', 'moderado', 'acentuado'] as const;

export type AvaliacaoEditavel = Omit<AvaliacaoCitologica, 'amostraId'>;

export function avaliacaoVazia(): AvaliacaoEditavel {
  return {
    tipoColeta: null,
    sitio: null,
    numeroLaminas: null,
    coloracoes: [],
    adequacao: null,
    motivosLimitacao: [],
    celularidade: null,
    preservacao: null,
    fundo: [],
    hemorragia: null,
    achadosHemorragia: [],
    necrose: null,
    materialExtracelular: [],
    populacoes: [],
    criteriosMalignidade: {},
    mitoses: null,
    inflamacao: null,
    agentes: [],
    descricaoCitologica: null,
    interpretacao: null,
    grauCerteza: null,
    limitacoes: [],
    recomendacoes: null,
  };
}

/** Uma avaliacao "em branco" nao e enviada ao servidor - nao ha o que gravar. */
export function temConteudo(a: AvaliacaoEditavel): boolean {
  return (
    a.tipoColeta !== null ||
    a.adequacao !== null ||
    a.celularidade !== null ||
    a.preservacao !== null ||
    a.fundo.length > 0 ||
    a.populacoes.length > 0 ||
    Object.keys(a.criteriosMalignidade).length > 0 ||
    a.agentes.length > 0 ||
    a.inflamacao !== null ||
    Boolean(a.descricaoCitologica?.trim()) ||
    Boolean(a.interpretacao?.trim()) ||
    Boolean(a.recomendacoes?.trim()) ||
    a.limitacoes.length > 0
  );
}

interface Props {
  amostras: CitologiaDaVersao['amostras'];
  valores: Record<string, AvaliacaoEditavel>;
  vocabulario: VocabularioCitologia;
  editavel: boolean;
  aoAlterar: (amostraId: string, avaliacao: AvaliacaoEditavel) => void;
}

export function PainelCitologia({
  amostras,
  valores,
  vocabulario,
  editavel,
  aoAlterar,
}: Props) {
  if (amostras.length === 0) {
    return (
      <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
        Este caso não tem amostras cadastradas.
      </Typography>
    );
  }

  return (
    <Stack spacing={2.5}>
      {amostras.map((amostra) => {
        const a = valores[amostra.id] ?? avaliacaoVazia();
        const mudar = <C extends keyof AvaliacaoEditavel>(
          campo: C,
          valor: AvaliacaoEditavel[C],
        ) => aoAlterar(amostra.id, { ...a, [campo]: valor });

        const limitada =
          a.adequacao !== null && a.adequacao !== 'adequada';

        return (
          <Card key={amostra.id} variant="outlined" sx={{ p: 2.5 }}>
            <Stack
              direction="row"
              sx={{ alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mb: 2 }}
            >
              <Chip label={amostra.identificador} size="small" />
              <Typography sx={{ fontSize: 13.5 }}>
                {[amostra.descricao, amostra.regiaoAnatomica].filter(Boolean).join(' · ') ||
                  'Sem descrição'}
              </Typography>
              {amostra.metodoColeta && (
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                  coleta informada no cadastro: {amostra.metodoColeta}
                </Typography>
              )}
            </Stack>

            <Divider sx={{ mb: 2.5 }} />

            <Stack spacing={2.5}>
              {/* --- material (§8) --- */}
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                <TextField
                  select
                  label="Tipo de coleta"
                  value={a.tipoColeta ?? ''}
                  onChange={(e) => mudar('tipoColeta', e.target.value || null)}
                  disabled={!editavel}
                  sx={{ flex: 1.4 }}
                >
                  <MenuItem value="">—</MenuItem>
                  {vocabulario.tiposColeta.map((t) => (
                    <MenuItem key={t.chave} value={t.chave}>
                      {t.rotulo}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  label="Sítio / cavidade"
                  value={a.sitio ?? ''}
                  onChange={(e) => mudar('sitio', e.target.value || null)}
                  disabled={!editavel}
                  sx={{ flex: 1 }}
                />
                <TextField
                  label="Lâminas"
                  type="number"
                  value={a.numeroLaminas ?? ''}
                  onChange={(e) =>
                    mudar('numeroLaminas', e.target.value ? Number(e.target.value) : null)
                  }
                  disabled={!editavel}
                  sx={{ width: { xs: '100%', md: 110 } }}
                  slotProps={{ htmlInput: { min: 1, step: 1 } }}
                />
              </Stack>

              {/* --- adequação (§§9-12) --- */}
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                <TextField
                  select
                  label="Adequação"
                  value={a.adequacao ?? ''}
                  onChange={(e) => mudar('adequacao', e.target.value || null)}
                  disabled={!editavel}
                  sx={{ minWidth: 240 }}
                  helperText="“Não diagnóstica” não é o mesmo que “negativa”."
                >
                  <MenuItem value="">—</MenuItem>
                  {vocabulario.adequacao.map((v) => (
                    <MenuItem key={v} value={v}>
                      {ADEQUACAO_LABEL[v] ?? v}
                    </MenuItem>
                  ))}
                </TextField>

                <Autocomplete
                  multiple
                  freeSolo
                  options={[...vocabulario.motivosLimitacao]}
                  value={a.motivosLimitacao}
                  onChange={(_e, v) => mudar('motivosLimitacao', v as string[])}
                  disabled={!editavel}
                  sx={{ flex: 1 }}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Motivo da limitação"
                      /* §10: sem o motivo, a adequação vira rótulo solto. */
                      helperText={
                        limitada && a.motivosLimitacao.length === 0
                          ? 'Registre por que o material limita a interpretação.'
                          : ' '
                      }
                    />
                  )}
                />
              </Stack>

              {/* --- preparação (§§13-20) --- */}
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                <TextField
                  select
                  label="Celularidade"
                  value={a.celularidade ?? ''}
                  onChange={(e) => mudar('celularidade', e.target.value || null)}
                  disabled={!editavel}
                  sx={{ flex: 1 }}
                >
                  <MenuItem value="">—</MenuItem>
                  {vocabulario.celularidade.map((v) => (
                    <MenuItem key={v} value={v}>
                      {CELULARIDADE_LABEL[v] ?? v}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  label="Preservação"
                  value={a.preservacao ?? ''}
                  onChange={(e) => mudar('preservacao', e.target.value || null)}
                  disabled={!editavel}
                  sx={{ flex: 1 }}
                >
                  <MenuItem value="">—</MenuItem>
                  {vocabulario.preservacao.map((v) => (
                    <MenuItem key={v} value={v}>
                      {PRESERVACAO_LABEL[v] ?? v}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  label="Hemorragia"
                  value={a.hemorragia ?? ''}
                  onChange={(e) => mudar('hemorragia', e.target.value || null)}
                  disabled={!editavel}
                  sx={{ flex: 1 }}
                >
                  <MenuItem value="">—</MenuItem>
                  {vocabulario.intensidade.map((v) => (
                    <MenuItem key={v} value={v}>
                      {INTENSIDADE_LABEL[v] ?? v}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  label="Necrose"
                  value={a.necrose ?? ''}
                  onChange={(e) => mudar('necrose', e.target.value || null)}
                  disabled={!editavel}
                  sx={{ flex: 1 }}
                >
                  <MenuItem value="">—</MenuItem>
                  {vocabulario.intensidade.map((v) => (
                    <MenuItem key={v} value={v}>
                      {INTENSIDADE_LABEL[v] ?? v}
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>

              {/* §16: múltiplos componentes do fundo coexistem. */}
              <Autocomplete
                multiple
                freeSolo
                options={[...vocabulario.fundo]}
                value={a.fundo}
                onChange={(_e, v) => mudar('fundo', v as string[])}
                disabled={!editavel}
                renderInput={(params) => <TextField {...params} label="Fundo da preparação" />}
              />

              <Autocomplete
                multiple
                freeSolo
                options={[...vocabulario.materialExtracelular]}
                value={a.materialExtracelular}
                onChange={(_e, v) => mudar('materialExtracelular', v as string[])}
                disabled={!editavel}
                renderInput={(params) => (
                  <TextField {...params} label="Material extracelular / matriz" />
                )}
              />

              {/* --- populações (§§21-22) --- */}
              <Autocomplete
                multiple
                freeSolo
                options={[...vocabulario.populacoes]}
                value={a.populacoes.map((p) => String(p.tipo ?? ''))}
                onChange={(_e, v) =>
                  mudar(
                    'populacoes',
                    (v as string[]).map((tipo) => ({ tipo })),
                  )
                }
                disabled={!editavel}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Populações celulares"
                    helperText="“Indeterminada” é resposta válida — o módulo não obriga decidir a origem cedo demais."
                  />
                )}
              />

              {/* --- critérios de malignidade (§§27-28) --- */}
              <Box>
                <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mb: 1 }}>
                  Critérios de malignidade — cada um com sua intensidade. A soma não vira
                  diagnóstico: a conclusão continua sendo decisão profissional.
                </Typography>
                <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
                  {vocabulario.criteriosMalignidade.map((criterio) => {
                    const atual = a.criteriosMalignidade[criterio];
                    return (
                      <Chip
                        key={criterio}
                        label={atual ? `${criterio}: ${atual}` : criterio}
                        size="small"
                        color={atual ? 'primary' : 'default'}
                        variant={atual ? 'filled' : 'outlined'}
                        disabled={!editavel}
                        onClick={() => {
                          if (!editavel) return;
                          const proximo = { ...a.criteriosMalignidade };
                          const i = atual ? GRAUS_CRITERIO.indexOf(atual as never) : -1;
                          const seguinte = GRAUS_CRITERIO[i + 1];
                          if (seguinte) proximo[criterio] = seguinte;
                          else delete proximo[criterio];
                          mudar('criteriosMalignidade', proximo);
                        }}
                      />
                    );
                  })}
                </Stack>
              </Box>

              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                <TextField
                  select
                  label="Mitoses"
                  value={a.mitoses ?? ''}
                  onChange={(e) => mudar('mitoses', e.target.value || null)}
                  disabled={!editavel}
                  sx={{ flex: 1 }}
                >
                  <MenuItem value="">—</MenuItem>
                  {vocabulario.mitoses.map((v) => (
                    <MenuItem key={v} value={v}>
                      {v}
                    </MenuItem>
                  ))}
                </TextField>

                {/* --- inflamação (§§31-32) --- */}
                <TextField
                  select
                  label="Inflamação"
                  value={String(a.inflamacao?.tipo ?? '')}
                  onChange={(e) =>
                    mudar(
                      'inflamacao',
                      e.target.value
                        ? { ...(a.inflamacao ?? {}), tipo: e.target.value }
                        : null,
                    )
                  }
                  disabled={!editavel}
                  sx={{ flex: 1 }}
                >
                  <MenuItem value="">—</MenuItem>
                  {vocabulario.tiposInflamacao.map((v) => (
                    <MenuItem key={v} value={v}>
                      {v}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  label="Intensidade da inflamação"
                  value={String(a.inflamacao?.intensidade ?? '')}
                  onChange={(e) =>
                    mudar('inflamacao', {
                      ...(a.inflamacao ?? {}),
                      intensidade: e.target.value,
                    })
                  }
                  disabled={!editavel || !a.inflamacao?.tipo}
                  sx={{ flex: 1 }}
                >
                  <MenuItem value="">—</MenuItem>
                  {vocabulario.intensidade.map((v) => (
                    <MenuItem key={v} value={v}>
                      {INTENSIDADE_LABEL[v] ?? v}
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>

              {/* --- agentes (§§43-46) --- */}
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                <TextField
                  select
                  label="Agente infeccioso"
                  value={String(a.agentes[0]?.grupo ?? '')}
                  onChange={(e) =>
                    mudar(
                      'agentes',
                      e.target.value
                        ? [{ ...(a.agentes[0] ?? {}), grupo: e.target.value }]
                        : [],
                    )
                  }
                  disabled={!editavel}
                  sx={{ flex: 1 }}
                >
                  <MenuItem value="">—</MenuItem>
                  {vocabulario.gruposAgente.map((v) => (
                    <MenuItem key={v} value={v}>
                      {v}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  label="Localização"
                  value={String(a.agentes[0]?.localizacao ?? '')}
                  onChange={(e) =>
                    mudar('agentes', [
                      { ...(a.agentes[0] ?? {}), localizacao: e.target.value },
                    ])
                  }
                  disabled={!editavel || !a.agentes[0]?.grupo}
                  sx={{ flex: 1 }}
                >
                  <MenuItem value="">—</MenuItem>
                  {vocabulario.localizacoesAgente.map((v) => (
                    <MenuItem key={v} value={v}>
                      {v}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  label="Significância"
                  value={String(a.agentes[0]?.significancia ?? '')}
                  onChange={(e) =>
                    mudar('agentes', [
                      { ...(a.agentes[0] ?? {}), significancia: e.target.value },
                    ])
                  }
                  disabled={!editavel || !a.agentes[0]?.grupo}
                  sx={{ flex: 1.4 }}
                  /* §46: a leitura do achado é interpretativa, não automática. */
                  helperText="Agente, achado sem significado ou contaminação — quem decide é você."
                >
                  <MenuItem value="">—</MenuItem>
                  {vocabulario.significanciasAgente.map((v) => (
                    <MenuItem key={v} value={v}>
                      {v}
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>

              <Divider />

              {/* --- descrição e interpretação (§§64-67) --- */}
              <TextField
                label="Descrição citológica"
                value={a.descricaoCitologica ?? ''}
                onChange={(e) => mudar('descricaoCitologica', e.target.value || null)}
                disabled={!editavel}
                multiline
                minRows={3}
              />
              <TextField
                label="Interpretação citológica"
                value={a.interpretacao ?? ''}
                onChange={(e) => mudar('interpretacao', e.target.value || null)}
                disabled={!editavel}
                multiline
                minRows={2}
                helperText="Ex.: achados compatíveis com processo inflamatório piogranulomatoso séptico."
              />

              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                <TextField
                  select
                  label="Grau de certeza (interno)"
                  value={a.grauCerteza ?? ''}
                  onChange={(e) => mudar('grauCerteza', e.target.value || null)}
                  disabled={!editavel}
                  sx={{ minWidth: 220 }}
                  helperText="Não sai no laudo entregue."
                >
                  <MenuItem value="">—</MenuItem>
                  {vocabulario.grauCerteza.map((v) => (
                    <MenuItem key={v} value={v}>
                      {CERTEZA_LABEL[v] ?? v}
                    </MenuItem>
                  ))}
                </TextField>

                <Autocomplete
                  multiple
                  freeSolo
                  options={[...vocabulario.limitacoes]}
                  value={a.limitacoes}
                  onChange={(_e, v) => mudar('limitacoes', v as string[])}
                  disabled={!editavel}
                  sx={{ flex: 1 }}
                  renderInput={(params) => <TextField {...params} label="Limitações" />}
                />
              </Stack>

              <TextField
                label="Recomendações"
                value={a.recomendacoes ?? ''}
                onChange={(e) => mudar('recomendacoes', e.target.value || null)}
                disabled={!editavel}
                multiline
                minRows={2}
                /* §69: "recomenda-se histopatologia" não entra sozinho em todo laudo. */
                helperText="Escrita caso a caso — o sistema não insere recomendação automática."
              />
            </Stack>
          </Card>
        );
      })}
    </Stack>
  );
}

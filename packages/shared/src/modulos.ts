/**
 * Os 26 modulos oficiais do LAPATO.
 *
 * Fonte: `0 DIRETRIZES DE INTEGRACAO.docx` secao 6, que declara que qualquer
 * numeracao de documentos anteriores deve ser desconsiderada.
 *
 * Os arquivos .docx 05 em diante usam numeracao antiga deslocada em -1, porque
 * o arquivo 05 funde os oficiais 05 e 06. Ver docs/modulos/README.md.
 */
export const MODULOS = {
  M01_ADMINISTRACAO: 'M01_ADMINISTRACAO',
  M02_USUARIOS: 'M02_USUARIOS',
  M03_CLIENTES: 'M03_CLIENTES',
  M04_PORTAL: 'M04_PORTAL',
  M05_RECEBIMENTO: 'M05_RECEBIMENTO',
  M06_TRIAGEM: 'M06_TRIAGEM',
  M07_RASTREAMENTO: 'M07_RASTREAMENTO',
  M08_MACROSCOPIA: 'M08_MACROSCOPIA',
  M09_PROCESSAMENTO: 'M09_PROCESSAMENTO',
  M10_SOLICITACOES: 'M10_SOLICITACOES',
  M11_LAUDOS: 'M11_LAUDOS',
  M12_CITOPATOLOGIA: 'M12_CITOPATOLOGIA',
  M13_HISTOPATOLOGIA: 'M13_HISTOPATOLOGIA',
  M14_NECROPSIA: 'M14_NECROPSIA',
  M15_CADAVERES: 'M15_CADAVERES',
  M16_IMAGENS: 'M16_IMAGENS',
  M17_IA: 'M17_IA',
  M18_BIOTECA: 'M18_BIOTECA',
  M19_LOGISTICA: 'M19_LOGISTICA',
  M20_FINANCEIRO: 'M20_FINANCEIRO',
  M21_BIBLIOTECA: 'M21_BIBLIOTECA',
  M22_QUALIDADE: 'M22_QUALIDADE',
  M23_ENSINO: 'M23_ENSINO',
  M24_PERICIA: 'M24_PERICIA',
  M25_RELATORIOS: 'M25_RELATORIOS',
  M26_INTEGRACOES: 'M26_INTEGRACOES',
} as const;

export type Modulo = (typeof MODULOS)[keyof typeof MODULOS];

/** Rotulo legivel de cada modulo, para UI e logs. */
export const MODULO_LABEL: Record<Modulo, string> = {
  M01_ADMINISTRACAO: 'Administração e Configurações',
  M02_USUARIOS: 'Usuários, Perfis e Permissões',
  M03_CLIENTES: 'Cadastro de Clientes e Veterinários',
  M04_PORTAL: 'Portal do Cliente',
  M05_RECEBIMENTO: 'Recebimento e Cadastro de Amostras',
  M06_TRIAGEM: 'Triagem de Amostras',
  M07_RASTREAMENTO: 'Rastreamento e Gestão de Fluxo',
  M08_MACROSCOPIA: 'Macroscopia',
  M09_PROCESSAMENTO: 'Processamento Histológico e Colorações',
  M10_SOLICITACOES: 'Solicitações e Pendências',
  M11_LAUDOS: 'Laudos e Microscopia',
  M12_CITOPATOLOGIA: 'Citopatologia',
  M13_HISTOPATOLOGIA: 'Histopatologia',
  M14_NECROPSIA: 'Necropsia',
  M15_CADAVERES: 'Controle de Cadáveres',
  M16_IMAGENS: 'Imagens e Scanner de Lâminas',
  M17_IA: 'Inteligência Artificial',
  M18_BIOTECA: 'Bioteca e Gestão de Acervo Biológico',
  M19_LOGISTICA: 'Logística',
  M20_FINANCEIRO: 'Financeiro',
  M21_BIBLIOTECA: 'Biblioteca',
  M22_QUALIDADE: 'Qualidade e Auditoria',
  M23_ENSINO: 'Ensino e Pesquisa',
  M24_PERICIA: 'Perícia e Patologia Forense',
  M25_RELATORIOS: 'Relatórios e Indicadores',
  M26_INTEGRACOES: 'Integrações e Notificações',
};

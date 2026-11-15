// Indicadores oficiais e gratuitos do Banco Central (API SGS).
export const BCB_SERIES: { id: number; nome: string; unidade: string; dica: string }[] = [
  { id: 432, nome: 'Selic (meta)', unidade: '% ao ano', dica: 'Base dos juros: puxa a renda fixa pós-fixada (Tesouro Selic, CDB, LCI).' },
  { id: 4389, nome: 'CDI', unidade: '% ao ano', dica: 'Referência dos CDBs e fundos de renda fixa (ex.: “110% do CDI”).' },
  { id: 13522, nome: 'IPCA 12 meses', unidade: '%', dica: 'Inflação oficial: seu dinheiro precisa render acima disso.' },
  { id: 1, nome: 'Dólar (PTAX)', unidade: 'R$', dica: 'Cotação oficial de venda do Banco Central.' },
];

export interface Indicator { nome: string; valor: number; data: string; unidade: string; dica: string }

/** Formato da API: [{"data":"14/11/2026","valor":"10.50"}] */
export function parseSgs(json: unknown): { data: string; valor: number } | null {
  if (!Array.isArray(json) || !json.length) return null;
  const last = json[json.length - 1] as { data?: string; valor?: string };
  const v = Number(String(last.valor).replace(',', '.'));
  if (!last.data || Number.isNaN(v)) return null;
  const [d, m, y] = last.data.split('/');
  return { data: `${y}-${m}-${d}`, valor: v };
}

/** Rendimento real aproximado (acima da inflação). */
export function realRate(nominalPct: number, inflationPct: number): number {
  return ((1 + nominalPct / 100) / (1 + inflationPct / 100) - 1) * 100;
}

// Carteiras de ações (Brasil e exterior): cotações grátis (Yahoo Finance) e um
// "termômetro" técnico simples para ajudar a decidir — não é recomendação de investimento.

export type Market = 'BR' | 'INT';

export interface Quote {
  symbol: string;
  name: string | null;
  currency: string;
  price: number;
  prevClose: number | null;
  time: number; // epoch s da última cotação
  closes: number[]; // fechamentos diários (até ~1 ano)
  times: number[];
}

export interface Buy { id: string; date: string; qty: number; price: number; owner: string; broker: string }
export interface WatchItem { symbol: string; label: string; name: string; sector: string; market: Market; buys: Buy[] }

/** Empresas líderes de cada setor para acompanhar (lista inicial; dá para remover/adicionar). */
export const SEED_BR: Omit<WatchItem, 'buys'>[] = [
  { symbol: 'ITUB4.SA', label: 'ITUB4', name: 'Itaú Unibanco', sector: 'Bancos', market: 'BR' },
  { symbol: 'BBAS3.SA', label: 'BBAS3', name: 'Banco do Brasil', sector: 'Bancos', market: 'BR' },
  { symbol: 'BPAC11.SA', label: 'BPAC11', name: 'BTG Pactual', sector: 'Bancos de investimento', market: 'BR' },
  { symbol: 'B3SA3.SA', label: 'B3SA3', name: 'B3', sector: 'Bolsa / serviços financeiros', market: 'BR' },
  { symbol: 'PETR4.SA', label: 'PETR4', name: 'Petrobras', sector: 'Petróleo e gás', market: 'BR' },
  { symbol: 'VALE3.SA', label: 'VALE3', name: 'Vale', sector: 'Mineração', market: 'BR' },
  { symbol: 'AXIA3.SA', label: 'AXIA3', name: 'Axia Energia (ex-Eletrobras)', sector: 'Energia elétrica', market: 'BR' },
  { symbol: 'EQTL3.SA', label: 'EQTL3', name: 'Equatorial', sector: 'Energia elétrica', market: 'BR' },
  { symbol: 'SBSP3.SA', label: 'SBSP3', name: 'Sabesp', sector: 'Saneamento', market: 'BR' },
  { symbol: 'WEGE3.SA', label: 'WEGE3', name: 'WEG', sector: 'Indústria / bens de capital', market: 'BR' },
  { symbol: 'EMBJ3.SA', label: 'EMBJ3', name: 'Embraer', sector: 'Aeroespacial e defesa', market: 'BR' },
  { symbol: 'SUZB3.SA', label: 'SUZB3', name: 'Suzano', sector: 'Papel e celulose', market: 'BR' },
  { symbol: 'ABEV3.SA', label: 'ABEV3', name: 'Ambev', sector: 'Consumo / bebidas', market: 'BR' },
  { symbol: 'RDOR3.SA', label: 'RDOR3', name: "Rede D'Or", sector: 'Saúde', market: 'BR' },
  { symbol: 'RENT3.SA', label: 'RENT3', name: 'Localiza', sector: 'Mobilidade / aluguel de carros', market: 'BR' },
  { symbol: 'TOTS3.SA', label: 'TOTS3', name: 'TOTVS', sector: 'Tecnologia', market: 'BR' },
];
export const SEED_INT: Omit<WatchItem, 'buys'>[] = [
  { symbol: 'NVDA', label: 'NVDA', name: 'NVIDIA', sector: 'Semicondutores / IA', market: 'INT' },
  { symbol: 'MSFT', label: 'MSFT', name: 'Microsoft', sector: 'Software / nuvem', market: 'INT' },
  { symbol: 'GOOGL', label: 'GOOGL', name: 'Alphabet (Google)', sector: 'Internet / IA', market: 'INT' },
  { symbol: 'ANT', label: 'ANT', name: 'Anthropic', sector: 'IA (Claude)', market: 'INT' },
  { symbol: 'SPCX', label: 'SPCX', name: 'SpaceX', sector: 'Espaço / satélites', market: 'INT' },
  { symbol: 'TSLA', label: 'TSLA', name: 'Tesla', sector: 'Veículos elétricos / energia', market: 'INT' },
  { symbol: 'AAPL', label: 'AAPL', name: 'Apple', sector: 'Hardware / consumo', market: 'INT' },
  { symbol: 'AMZN', label: 'AMZN', name: 'Amazon', sector: 'Varejo online / nuvem', market: 'INT' },
  { symbol: 'META', label: 'META', name: 'Meta', sector: 'Redes sociais / IA', market: 'INT' },
];

/** "petr4" → PETR4.SA (Brasil); "nvda" → NVDA (exterior). */
export function toSymbol(input: string, market: Market): { symbol: string; label: string } {
  const t = input.trim().toUpperCase().replace(/\.SA$/, '');
  return market === 'BR' ? { symbol: `${t}.SA`, label: t } : { symbol: t, label: t };
}

/** Lê a resposta do endpoint v8/chart do Yahoo. */
export function parseYahooChart(json: unknown): Quote | null {
  const r = (json as { chart?: { result?: unknown[] } })?.chart?.result?.[0] as
    | { meta: Record<string, unknown>; timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[]; adjclose?: { adjclose?: (number | null)[] }[] } }
    | undefined;
  if (!r?.meta) return null;
  const m = r.meta;
  const ts = r.timestamp ?? [];
  const raw = r.indicators?.quote?.[0]?.close ?? [];
  const closes: number[] = [], times: number[] = [];
  raw.forEach((c, i) => { if (typeof c === 'number' && Number.isFinite(c)) { closes.push(c); times.push(ts[i]); } });
  const price = Number(m.regularMarketPrice ?? closes[closes.length - 1]);
  if (!Number.isFinite(price)) return null;
  const prev = m.chartPreviousClose ?? m.previousClose;
  // o último candle diário pode ser o de hoje: o "fechamento anterior" do dia é o penúltimo
  const dayPrev = closes.length >= 2 ? closes[closes.length - 2] : (typeof prev === 'number' ? prev : null);
  return {
    symbol: String(m.symbol ?? ''),
    name: (m.longName as string) ?? (m.shortName as string) ?? null,
    currency: String(m.currency ?? (String(m.symbol).endsWith('.SA') ? 'BRL' : 'USD')),
    price,
    prevClose: dayPrev,
    time: Number(m.regularMarketTime ?? times[times.length - 1] ?? 0),
    closes, times,
  };
}

const sma = (a: number[], n: number) => (a.length >= n ? a.slice(-n).reduce((s, x) => s + x, 0) / n : null);

/** RSI de 14 períodos (Wilder). */
export function rsi(closes: number[], n = 14): number | null {
  if (closes.length <= n) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) { const d = closes[i] - closes[i - 1]; if (d >= 0) gain += d; else loss -= d; }
  gain /= n; loss /= n;
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

export type Level = 'desconto' | 'bom' | 'neutro' | 'esticado' | 'novo';
export const LEVELS: Record<Level, { label: string; color: string; bg: string; hint: string }> = {
  desconto: { label: 'Zona de desconto', color: '#1F7A4D', bg: '#E3F4EA', hint: 'Preço baixo em relação ao último ano.' },
  bom: { label: 'Bom ponto de entrada', color: '#1D5FA8', bg: '#E4EEFA', hint: 'Tendência de alta com recuo recente.' },
  neutro: { label: 'Neutro', color: '#8A6D1E', bg: '#FBF3DC', hint: 'Sem sinal claro: acompanhar.' },
  esticado: { label: 'Esticado / caro', color: '#B42318', bg: '#FDE8E6', hint: 'Subiu muito e está perto da máxima.' },
  novo: { label: 'Pouco histórico', color: '#6F675F', bg: '#EEEAE5', hint: 'Ação nova: ainda não há dados para o termômetro.' },
};

export interface Analysis {
  level: Level;
  reasons: string[];
  rsi: number | null;
  sma50: number | null;
  sma200: number | null;
  high52: number | null;
  low52: number | null;
  pos52: number | null; // 0 = mínima de 52 sem., 1 = máxima
  trend: 'alta' | 'baixa' | 'lateral' | null;
  ret: { d1: number | null; m1: number | null; m3: number | null; m6: number | null; y1: number | null; ytd: number | null };
}

const pct = (a: number | null | undefined, b: number | null | undefined) => (a && b ? (a / b - 1) * 100 : null);

/** Termômetro técnico a partir dos fechamentos diários. */
export function analyze(q: Pick<Quote, 'price' | 'prevClose' | 'closes' | 'times'>): Analysis {
  const c = q.closes.length && Math.abs(q.closes[q.closes.length - 1] - q.price) / q.price < 0.0001 ? q.closes : [...q.closes, q.price];
  const p = q.price;
  const back = (days: number) => (c.length > days ? c[c.length - 1 - days] : null);
  const yStart = (() => {
    const y = new Date().getFullYear();
    const i = q.times.findIndex((t) => new Date(t * 1000).getFullYear() === y);
    return i > 0 ? q.closes[i - 1] : null;
  })();
  const ret = { d1: pct(p, q.prevClose), m1: pct(p, back(21)), m3: pct(p, back(63)), m6: pct(p, back(126)), y1: pct(p, c.length >= 240 ? c[0] : null), ytd: pct(p, yStart) };
  const win = c.slice(-252);
  const high52 = win.length ? Math.max(...win) : null;
  const low52 = win.length ? Math.min(...win) : null;
  const pos52 = high52 !== null && low52 !== null && high52 > low52 ? (p - low52) / (high52 - low52) : null;
  const s50 = sma(c, 50), s200 = sma(c, 200), r = rsi(c);
  const trend = s50 && s200 ? (s50 > s200 * 1.01 ? 'alta' : s50 < s200 * 0.99 ? 'baixa' : 'lateral') : s50 ? (p > s50 ? 'alta' : 'baixa') : null;
  const base = { rsi: r, sma50: s50, sma200: s200, high52, low52, pos52, trend, ret } as const;

  if (c.length < 30 || r === null) {
    return { ...base, level: 'novo', reasons: [`Só ${c.length} pregões de histórico — o termômetro precisa de pelo menos 30.`] };
  }
  const reasons: string[] = [];
  const dd = high52 ? (p / high52 - 1) * 100 : 0;
  if (pos52 !== null) reasons.push(`Está a ${Math.round(pos52 * 100)}% da faixa de 52 semanas (0% = mínima, 100% = máxima)${dd < -1 ? `, ${Math.abs(dd).toFixed(0)}% abaixo da máxima` : ''}.`);
  reasons.push(`RSI ${r.toFixed(0)} ${r >= 70 ? '(sobrecomprado)' : r <= 30 ? '(sobrevendido)' : r <= 45 ? '(fraco/descontado)' : '(normal)'}.`);
  if (s200) reasons.push(`Preço ${p >= s200 ? 'acima' : 'abaixo'} da média de 200 dias (${pct(p, s200)!.toFixed(1)}%).`);
  if (trend) reasons.push(`Tendência de ${trend}${s50 && s200 ? ' (média de 50 vs 200 dias)' : ''}.`);

  let level: Level = 'neutro';
  const overS50 = s50 ? p / s50 - 1 : 0;
  if (r >= 70 || (pos52 !== null && pos52 >= 0.9 && overS50 > 0.08)) level = 'esticado';
  else if ((pos52 !== null && pos52 <= 0.3 && r <= 50) || r <= 30 || dd <= -30) level = 'desconto';
  else if (trend === 'alta' && (r <= 50 || (s50 !== null && p <= s50 * 1.02))) level = 'bom';
  return { ...base, level, reasons };
}

/** Valor investido e posição atual de uma ação acompanhada. */
export function holding(item: WatchItem, price: number | null) {
  const qty = item.buys.reduce((s, b) => s + b.qty, 0);
  const cost = item.buys.reduce((s, b) => s + b.qty * b.price, 0);
  const value = price !== null ? qty * price : null;
  return { qty, cost, avg: qty ? cost / qty : 0, value, pl: value !== null ? value - cost : null, plPct: value !== null && cost ? (value / cost - 1) * 100 : null };
}

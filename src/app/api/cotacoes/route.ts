import { NextResponse } from 'next/server';
import { parseYahooChart, type Quote } from '@/lib/market';

// Cotações grátis (Yahoo Finance, gráfico diário de 1 ano). B3 com ~15 min de atraso; EUA quase em tempo real.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

async function fetchOne(symbol: string): Promise<Quote | null> {
  for (const host of ['query1', 'query2']) {
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d&includePrePost=false`, {
        headers: { 'user-agent': UA, accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) continue;
      const q = parseYahooChart(await r.json());
      if (q) return q;
    } catch { /* tenta o outro servidor */ }
  }
  return stooq(symbol);
}

/** Reserva: histórico diário do Stooq (ações americanas; fechamento do dia). */
async function stooq(symbol: string): Promise<Quote | null> {
  if (symbol.includes('.') || symbol.includes('=') || symbol.startsWith('^')) return null;
  const d = (dt: Date) => dt.toISOString().slice(0, 10).replace(/-/g, '');
  const to = new Date(), from = new Date(Date.now() - 370 * 86400000);
  try {
    const r = await fetch(`https://stooq.com/q/d/l/?s=${symbol.toLowerCase()}.us&i=d&d1=${d(from)}&d2=${d(to)}`, { headers: { 'user-agent': UA }, cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const rows = (await r.text()).trim().split('\n').slice(1).map((l) => l.split(',')).filter((c) => c.length >= 5 && Number.isFinite(Number(c[4])));
    if (rows.length < 2) return null;
    const closes = rows.map((c) => Number(c[4]));
    const times = rows.map((c) => Math.floor(Date.parse(`${c[0]}T21:00:00Z`) / 1000));
    return { symbol, name: null, currency: 'USD', price: closes[closes.length - 1], prevClose: closes[closes.length - 2], time: times[times.length - 1], closes, times };
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbols = (url.searchParams.get('symbols') ?? '').split(',').map((s) => s.trim()).filter((s) => /^[A-Za-z0-9.^=-]{1,15}$/.test(s)).slice(0, 40);
  if (!symbols.length) return NextResponse.json({ error: 'informe symbols' }, { status: 400 });
  const out: Record<string, Quote | null> = {};
  await Promise.all(symbols.map(async (s) => { out[s] = await fetchOne(s); }));
  return NextResponse.json({ quotes: out, updated: new Date().toISOString() }, {
    headers: { 'cache-control': 'public, s-maxage=60, stale-while-revalidate=300' },
  });
}

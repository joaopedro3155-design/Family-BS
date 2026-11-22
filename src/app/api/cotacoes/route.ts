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
  return null;
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

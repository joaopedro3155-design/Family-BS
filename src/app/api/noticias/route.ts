import { NextResponse } from 'next/server';
import { gnSearch, mergeHeadlines, NEWS_FEEDS, parseRss, type Headline } from '@/lib/rss';

// Manchetes gratuitas (Google Notícias RSS). Cache de 30 min na Vercel.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const cat = url.searchParams.get('cat') ?? 'principais';
  const city = (url.searchParams.get('cidade') ?? 'Jundiaí').slice(0, 40);
  const q = url.searchParams.get('q')?.trim().slice(0, 80);
  // busca livre (ex.: notícias de uma empresa): "q=Petrobras PETR4"
  const cfg = q ? { label: q, feeds: [gnSearch(q)] } : NEWS_FEEDS[cat];
  if (!cfg) return NextResponse.json({ error: 'categoria inválida' }, { status: 400 });
  const lists = await Promise.all(cfg.feeds.map(async (f): Promise<Headline[]> => {
    try {
      const r = await fetch(f.replaceAll('%7Bcidade%7D', encodeURIComponent(city)).replaceAll('{cidade}', encodeURIComponent(city)), {
        headers: { 'user-agent': 'Mozilla/5.0 (FamilyBS)', 'accept-language': 'pt-BR' }, cache: 'no-store',
      });
      return r.ok ? parseRss(await r.text()) : [];
    } catch { return []; }
  }));
  const items = mergeHeadlines(lists, q ? 10 : 25);
  return NextResponse.json({ items, updated: new Date().toISOString() }, {
    headers: { 'cache-control': 'public, s-maxage=1800, stale-while-revalidate=3600' },
  });
}

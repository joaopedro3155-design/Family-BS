import { NextResponse } from 'next/server';
import { BCB_SERIES, parseSgs, type Indicator } from '@/lib/bcb';

// Indicadores do Banco Central (gratuito). Cache de 6 h na Vercel.
export async function GET() {
  const out: Indicator[] = [];
  await Promise.all(BCB_SERIES.map(async (s) => {
    try {
      const r = await fetch(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${s.id}/dados/ultimos/1?formato=json`, { cache: 'no-store', headers: { accept: 'application/json' } });
      const p = parseSgs(await r.json());
      if (p) out.push({ nome: s.nome, valor: p.valor, data: p.data, unidade: s.unidade, dica: s.dica });
    } catch { /* fonte fora do ar: segue sem esse indicador */ }
  }));
  out.sort((a, b) => BCB_SERIES.findIndex((s) => s.nome === a.nome) - BCB_SERIES.findIndex((s) => s.nome === b.nome));
  return NextResponse.json({ items: out }, { headers: { 'cache-control': 'public, s-maxage=21600, stale-while-revalidate=43200' } });
}

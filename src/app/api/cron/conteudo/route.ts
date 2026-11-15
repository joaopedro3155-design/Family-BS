import { NextResponse } from 'next/server';
import { claudeConfigured } from '@/lib/claude';
import { generateBrief, generateNews, newsPrefs, weekStart } from '@/lib/content';
import { admin } from '@/lib/server';
import { todayISO } from '@/lib/format';

export const maxDuration = 120;

/**
 * Chamado a cada 10 minutos pelo Supabase (supabase/cron.sql).
 * Faz UMA tarefa por chamada (cabe no tempo da Vercel): a próxima categoria de notícias
 * que ainda não saiu hoje (a partir das 6h) ou o resumo semanal de investimentos (domingo/segunda).
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('x-cron-secret') !== secret) return NextResponse.json({ error: 'não autorizado' }, { status: 401 });
  if (!claudeConfigured()) return NextResponse.json({ ok: true, skipped: 'Claude não configurado' });
  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: 'America/Sao_Paulo' }).format(now));
  if (hour < 6 || hour > 22) return NextResponse.json({ ok: true, skipped: 'fora do horário' });
  const sb = admin();
  const today = todayISO(now);
  const { data: households } = await sb.from('households').select('id');

  for (const h of households ?? []) {
    const prefs = await newsPrefs(sb, h.id);
    const { data: done } = await sb.from('news_digests').select('category').eq('household_id', h.id).eq('digest_date', today);
    const doneSet = new Set((done ?? []).map((d) => d.category));
    const next = prefs.categories.find((c) => !doneSet.has(c));
    if (next) {
      try {
        const n = await generateNews(sb, h.id, next);
        return NextResponse.json({ ok: true, household: h.id, news: next, items: n });
      } catch (e) {
        // grava vazio para não travar a fila do dia
        await sb.from('news_digests').upsert({ household_id: h.id, category: next, digest_date: today, items: [] }, { onConflict: 'household_id,category,digest_date' });
        return NextResponse.json({ ok: false, news: next, error: e instanceof Error ? e.message : String(e) });
      }
    }
    const { data: brief } = await sb.from('investment_briefs').select('id').eq('household_id', h.id).eq('week_start', weekStart(today)).maybeSingle();
    if (!brief && hour >= 7) {
      await generateBrief(sb, h.id);
      return NextResponse.json({ ok: true, household: h.id, brief: true });
    }
  }
  return NextResponse.json({ ok: true, nothing: true });
}

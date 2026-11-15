import { NextResponse } from 'next/server';
import { claudeConfigured, NEWS_CATEGORIES } from '@/lib/claude';
import { generateNews } from '@/lib/content';
import { requireMember } from '@/lib/server';

export const maxDuration = 120;

export async function POST(req: Request) {
  if (!claudeConfigured()) return NextResponse.json({ error: 'Claude não configurado' }, { status: 503 });
  const auth = await requireMember(req);
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { category } = (await req.json().catch(() => ({}))) as { category?: string };
  if (!category || !NEWS_CATEGORIES[category]) return NextResponse.json({ error: 'categoria inválida' }, { status: 400 });
  try {
    const n = await generateNews(auth.sb, auth.householdId, category);
    return NextResponse.json({ ok: true, items: n });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'falhou' }, { status: 502 });
  }
}

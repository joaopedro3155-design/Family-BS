import { NextResponse } from 'next/server';
import { claudeConfigured, interpretMessage } from '@/lib/claude';
import { householdContext, requireMember } from '@/lib/server';
import { todayISO } from '@/lib/format';

export const maxDuration = 30;

export async function POST(req: Request) {
  if (!claudeConfigured()) return NextResponse.json({ error: 'Claude não configurado' }, { status: 503 });
  const auth = await requireMember(req);
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  if (!text?.trim()) return NextResponse.json({ error: 'mensagem vazia' }, { status: 400 });
  const ctx = await householdContext(auth.sb, auth.householdId);
  try {
    const r = await interpretMessage(text.slice(0, 1000), {
      today: todayISO(), categoriesPF: ctx.categoriesPF, categoriesPJ: ctx.categoriesPJ,
      members: ctx.members.map((m) => m.display_name), pjName: ctx.pj?.name ?? 'Empresa',
    });
    const account = r.conta === 'PJ' ? ctx.pj : ctx.pf;
    const cat = ctx.categories.find((c) => c.account_id === account?.id && c.name === r.categoria && c.tipo === r.tipo);
    const who = ctx.members.find((m) => r.quem && m.display_name.toLowerCase().startsWith(r.quem.toLowerCase().split(' ')[0]));
    return NextResponse.json({ ...r, category_id: cat?.id ?? null, spent_by: who?.user_id ?? null });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'falhou' }, { status: 502 });
  }
}

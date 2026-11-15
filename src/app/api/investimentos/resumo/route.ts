import { NextResponse } from 'next/server';
import { claudeConfigured } from '@/lib/claude';
import { generateBrief } from '@/lib/content';
import { requireMember } from '@/lib/server';

export const maxDuration = 120;

export async function POST(req: Request) {
  if (!claudeConfigured()) return NextResponse.json({ error: 'Claude não configurado' }, { status: 503 });
  const auth = await requireMember(req);
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    await generateBrief(auth.sb, auth.householdId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'falhou' }, { status: 502 });
  }
}

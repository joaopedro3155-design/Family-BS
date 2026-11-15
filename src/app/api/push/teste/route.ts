import { NextResponse } from 'next/server';
import { admin, pushToHousehold } from '@/lib/server';

export async function POST(req: Request) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'faça login' }, { status: 401 });
  const sb = admin();
  const { data: u, error } = await sb.auth.getUser(token);
  if (error || !u.user) return NextResponse.json({ error: 'sessão inválida' }, { status: 401 });
  const { data: m } = await sb.from('members').select('household_id').eq('user_id', u.user.id).limit(1);
  if (!m?.length) return NextResponse.json({ error: 'sem família' }, { status: 400 });
  try {
    const sent = await pushToHousehold(sb, m[0].household_id, { title: 'Family BS', body: 'Notificações funcionando ✓', url: '/' }, [u.user.id]);
    return NextResponse.json({ ok: true, sent });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'falhou' }, { status: 500 });
  }
}

import { admin } from '@/lib/server';
import { buildIcs } from '@/lib/ics';
import { rrule } from '@/lib/recurrence';

// Endereço secreto do calendário: /api/agenda/ics?t=TOKEN (gerado em Ajustes)
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('t');
  if (!token || token.length < 32) return new Response('não encontrado', { status: 404 });
  const sb = admin();
  const { data: h } = await sb.from('households').select('id,name').eq('ics_token', token).maybeSingle();
  if (!h) return new Response('não encontrado', { status: 404 });
  const from = new Date(Date.now() - 60 * 86400000).toISOString();
  const [{ data: events }, { data: members }] = await Promise.all([
    sb.from('events').select('*').eq('household_id', h.id).or(`starts_at.gte.${from},recurrence.neq.none`).order('starts_at').limit(2000),
    sb.from('members').select('user_id,display_name').eq('household_id', h.id),
  ]);
  const name = (id: string | null) => (id ? members?.find((m) => m.user_id === id)?.display_name.split(' ')[0] ?? '' : '');
  const ics = buildIcs(`${h.name} · Family BS`, (events ?? []).map((e) => ({
    id: e.id, title: e.title, starts_at: e.starts_at, ends_at: e.ends_at, location: e.location, notes: e.notes, reminders: e.reminders ?? [], who: e.company ? 'CBS Engenharia' : name(e.owner_user), rrule: rrule(e),
  })));
  return new Response(ics, { headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'no-store' } });
}

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EventItem } from './types';
import { expandEvents } from './recurrence';

/** "Todos" (sem dono) aparece para a família inteira; o que é de uma pessoa ou da empresa só para o dono e quem criou. */
export function isVisibleTo(e: Pick<EventItem, 'owner_user' | 'created_by'>, uid: string | undefined) {
  return !e.owner_user || !uid || e.owner_user === uid || e.created_by === uid;
}

export type Occurrence = EventItem & { occ: string; done: boolean };

/** Compromissos e tarefas no intervalo, com as repetições já abertas e o "feito" de cada dia. */
export async function fetchOccurrences(sb: SupabaseClient, householdId: string, from: string, to: string, opts: { company?: boolean; limit?: number } = {}): Promise<Occurrence[]> {
  let a = sb.from('events').select('*').eq('household_id', householdId).eq('recurrence', 'none').gte('starts_at', from).lte('starts_at', to).order('starts_at').limit(opts.limit ?? 1000);
  let b = sb.from('events').select('*').eq('household_id', householdId).neq('recurrence', 'none').lte('starts_at', to).or(`recurrence_until.is.null,recurrence_until.gte.${from.slice(0, 10)}`);
  if (opts.company !== undefined) { a = a.eq('company', opts.company); b = b.eq('company', opts.company); }
  const [{ data: one }, { data: rec }, { data: sess }] = await Promise.all([a, b, sb.auth.getSession()]);
  const uid = sess.session?.user.id;
  const mine = (e: EventItem) => isVisibleTo(e, uid);
  let list = expandEvents([...((one ?? []) as EventItem[]), ...((rec ?? []) as EventItem[])].filter(mine), from, to);
  if (opts.limit) list = list.slice(0, opts.limit);
  const taskIds = [...new Set(list.map((e) => e.id))];
  const done = new Set<string>();
  if (taskIds.length) {
    const { data } = await sb.from('event_done').select('event_id,occurs_on').in('event_id', taskIds).gte('occurs_on', list[0]?.occ ?? from.slice(0, 10)).lte('occurs_on', list[list.length - 1]?.occ ?? to.slice(0, 10));
    for (const r of data ?? []) done.add(`${r.event_id}|${r.occurs_on}`);
  }
  return list.map((e) => ({ ...e, done: done.has(`${e.id}|${e.occ}`) }));
}

export async function setDone(sb: SupabaseClient, eventId: string, occ: string, done: boolean) {
  if (done) await sb.from('event_done').upsert({ event_id: eventId, occurs_on: occ });
  else await sb.from('event_done').delete().eq('event_id', eventId).eq('occurs_on', occ);
}

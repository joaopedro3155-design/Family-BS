// Repetição de compromissos/tarefas: diária, semanal, mensal ou anual.
// As contas são feitas no horário de Brasília (UTC-3, sem horário de verão).

export type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface RecurringLike {
  starts_at: string;
  ends_at?: string | null;
  recurrence?: Recurrence | null;
  recurrence_interval?: number | null;
  recurrence_until?: string | null; // YYYY-MM-DD
}

export const RECURRENCES: { id: Recurrence; label: string; every: string; plural: string }[] = [
  { id: 'none', label: 'Não repete', every: '', plural: '' },
  { id: 'daily', label: 'Todo dia', every: 'dia', plural: 'dias' },
  { id: 'weekly', label: 'Toda semana', every: 'semana', plural: 'semanas' },
  { id: 'monthly', label: 'Todo mês', every: 'mês', plural: 'meses' },
  { id: 'yearly', label: 'Todo ano', every: 'ano', plural: 'anos' },
];

const OFFSET_MS = 3 * 3600 * 1000;
const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** Data (YYYY-MM-DD) e hora (HH:MM) no horário de Brasília. */
export function spParts(iso: string): { date: string; time: string } {
  const s = new Date(Date.parse(iso) - OFFSET_MS).toISOString();
  return { date: s.slice(0, 10), time: s.slice(11, 16) };
}
export const spIso = (date: string, time: string) => new Date(`${date}T${time}:00-03:00`).toISOString();

const ymd = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const addDaysStr = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

/** n-ésima ocorrência (a partir de 0) de uma série, como data local. Mês/ano curtos usam o último dia. */
function nth(first: string, rec: Recurrence, interval: number, n: number): string {
  const [y, m, d] = first.split('-').map(Number);
  if (rec === 'daily') return addDaysStr(first, n * interval);
  if (rec === 'weekly') return addDaysStr(first, n * interval * 7);
  if (rec === 'monthly') {
    const t = (m - 1) + n * interval;
    const yy = y + Math.floor(t / 12), mm = (t % 12) + 1;
    return ymd(yy, mm, Math.min(d, daysIn(yy, mm)));
  }
  const yy = y + n * interval;
  return ymd(yy, m, Math.min(d, daysIn(yy, m)));
}

/** Datas de início (ISO) das ocorrências entre `from` e `to` (ISO, inclusive). */
export function occurrences(e: RecurringLike, from: string, to: string, max = 400): string[] {
  const rec = (e.recurrence ?? 'none') as Recurrence;
  const fromMs = Date.parse(from), toMs = Date.parse(to);
  const startMs = Date.parse(e.starts_at);
  if (rec === 'none') return startMs >= fromMs && startMs <= toMs ? [e.starts_at] : [];
  const interval = Math.max(1, e.recurrence_interval ?? 1);
  const { date: first, time } = spParts(e.starts_at);
  const until = e.recurrence_until ?? null;
  // pula direto para perto de `from`
  const fromDate = spParts(new Date(Math.max(fromMs, startMs)).toISOString()).date;
  const gap = Math.max(0, dayDiff(first, fromDate));
  const approxDays = rec === 'daily' ? interval : rec === 'weekly' ? 7 * interval : rec === 'monthly' ? 28 * interval : 365 * interval;
  let n = Math.max(0, Math.floor(gap / approxDays) - 2);
  const out: string[] = [];
  for (let guard = 0; guard < max + 50 && out.length < max; guard++, n++) {
    const date = nth(first, rec, interval, n);
    if (until && date > until) break;
    const iso = spIso(date, time);
    const ms = Date.parse(iso);
    if (ms > toMs) break;
    if (ms >= fromMs) out.push(iso);
  }
  return out;
}

/** Próxima ocorrência a partir de agora (ou null se a série acabou). */
export function nextOccurrence(e: RecurringLike, now = new Date()): string | null {
  const from = now.toISOString();
  const to = new Date(now.getTime() + 800 * 86400000).toISOString();
  return occurrences(e, from, to, 1)[0] ?? null;
}

/** Texto curto da regra: "Toda semana · quarta", "A cada 2 meses · dia 10". */
export function recurrenceLabel(e: RecurringLike): string {
  const rec = (e.recurrence ?? 'none') as Recurrence;
  if (rec === 'none') return '';
  const i = Math.max(1, e.recurrence_interval ?? 1);
  const r = RECURRENCES.find((x) => x.id === rec)!;
  const base = i === 1 ? r.label : `A cada ${i} ${r.plural}`;
  const { date } = spParts(e.starts_at);
  const [, m, d] = date.split('-').map(Number);
  const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
  const detail = rec === 'weekly' ? WEEKDAYS[wd] : rec === 'monthly' ? `dia ${d}` : rec === 'yearly' ? `${d} ${MONTHS[m - 1]}` : '';
  const until = e.recurrence_until ? ` · até ${e.recurrence_until.split('-').reverse().join('/')}` : '';
  return `${base}${detail ? ` · ${detail}` : ''}${until}`;
}

/** Expande uma lista de eventos (alguns recorrentes) em ocorrências dentro do intervalo. */
export function expandEvents<T extends RecurringLike & { id: string }>(events: T[], from: string, to: string): (T & { occ: string })[] {
  const out: (T & { occ: string })[] = [];
  for (const e of events) {
    const dur = e.ends_at ? Date.parse(e.ends_at) - Date.parse(e.starts_at) : null;
    for (const s of occurrences(e, from, to)) {
      out.push({ ...e, starts_at: s, ends_at: dur !== null ? new Date(Date.parse(s) + dur).toISOString() : null, occ: spParts(s).date });
    }
  }
  return out.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

/** RRULE para o calendário do iPhone (iCal). */
export function rrule(e: RecurringLike): string | null {
  const rec = (e.recurrence ?? 'none') as Recurrence;
  if (rec === 'none') return null;
  const freq = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY' }[rec];
  const parts = [`FREQ=${freq}`];
  if ((e.recurrence_interval ?? 1) > 1) parts.push(`INTERVAL=${e.recurrence_interval}`);
  if (e.recurrence_until) parts.push(`UNTIL=${e.recurrence_until.replace(/-/g, '')}T235959Z`);
  return `RRULE:${parts.join(';')}`;
}

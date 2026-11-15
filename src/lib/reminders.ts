import type { EventItem } from './types';

/** Lembretes de compromissos que devem sair agora (e ainda não saíram). */
export function dueEventReminders(
  events: Pick<EventItem, 'id' | 'starts_at' | 'reminders'>[],
  sent: Set<string>, // `${event_id}:${minutes}`
  now: Date,
): { eventId: string; minutes: number }[] {
  const out: { eventId: string; minutes: number }[] = [];
  for (const e of events) {
    const start = Date.parse(e.starts_at);
    if (start < now.getTime()) continue; // já começou
    // só o lembrete mais próximo do início que já venceu (evita mandar "1 dia antes" e "1 hora antes" juntos)
    const due = (e.reminders ?? []).filter((m) => now.getTime() >= start - m * 60000).sort((a, b) => a - b);
    if (due.length === 0) continue;
    const m = due[0];
    if (sent.has(`${e.id}:${m}`)) continue;
    out.push({ eventId: e.id, minutes: m });
  }
  return out;
}

export function reminderText(minutes: number): string {
  if (minutes >= 1440) return minutes === 1440 ? 'amanhã' : `em ${Math.round(minutes / 1440)} dias`;
  if (minutes >= 60) return minutes === 60 ? 'em 1 hora' : `em ${Math.round(minutes / 60)} horas`;
  return `em ${minutes} min`;
}

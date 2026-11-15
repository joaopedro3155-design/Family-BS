// Gera o calendário (iCal) para assinar no app Calendário do iPhone.
export interface IcsEvent { id: string; title: string; starts_at: string; ends_at: string | null; location: string | null; notes: string | null; reminders: number[]; who: string }

const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const escText = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');

/** Quebra linhas longas (máx. 75 caracteres), como pede o padrão iCal. */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 75) { out.push(rest.slice(0, 75)); rest = ` ${rest.slice(75)}`; }
  out.push(rest);
  return out.join('\r\n');
}

export function buildIcs(calName: string, events: IcsEvent[], now = new Date()): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Family BS//PT-BR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${escText(calName)}`, 'X-WR-TIMEZONE:America/Sao_Paulo', 'REFRESH-INTERVAL;VALUE=DURATION:PT15M'];
  for (const e of events) {
    const end = e.ends_at ?? new Date(Date.parse(e.starts_at) + 3600000).toISOString();
    lines.push('BEGIN:VEVENT', `UID:${e.id}@familybs`, `DTSTAMP:${stamp(now.toISOString())}`, `DTSTART:${stamp(e.starts_at)}`, `DTEND:${stamp(end)}`,
      `SUMMARY:${escText(e.who ? `${e.title} (${e.who})` : e.title)}`);
    if (e.location) lines.push(`LOCATION:${escText(e.location)}`);
    if (e.notes) lines.push(`DESCRIPTION:${escText(e.notes)}`);
    for (const m of e.reminders ?? []) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escText(e.title)}`, `TRIGGER:-PT${m}M`, 'END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

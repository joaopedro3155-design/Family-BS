// Compromissos/tarefas "sem data definida": guardados numa data reservada (31/12/2099 12:00)
// e lembrados todo dia ao meio-dia, menos aos sábados.
export const UNDATED_ISO = '2099-12-31T15:00:00.000Z';
export const UNDATED_DAY = '2099-12-31';
export const UNDATED_LOCAL = '2099-12-31T12:00';
export const isUndated = (iso?: string | null) => !!iso && iso.slice(0, 4) >= '2099';
/** Dia da semana em Brasília (0 = domingo … 6 = sábado). */
export function weekdaySP(now = new Date()): number {
  const w = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'America/Sao_Paulo' }).format(now);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(w);
}

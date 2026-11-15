export const TZ = 'America/Sao_Paulo';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function money(v: number | null | undefined, show: boolean): string {
  if (!show) return 'R$ •••••';
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return brl.format(v);
}

/** "2026-11-14" no fuso de São Paulo */
export function todayISO(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
}

export function monthKey(d: Date = new Date()): string {
  return todayISO(d).slice(0, 7);
}

export function monthRange(key: string): { start: string; end: string } {
  const [y, m] = key.split('-').map(Number);
  const start = `${key}-01`;
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return { start, end: `${next}-01` };
}

export function addMonths(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** soma meses a uma data ISO mantendo o dia (limitado ao fim do mês) */
export function addMonthsToDate(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const key = addMonths(`${y}-${String(m).padStart(2, '0')}`, delta);
  const [ny, nm] = key.split('-').map(Number);
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${key}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function dayLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(d);
}

export function timeLabel(ts: string): string {
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ }).format(new Date(ts));
}

export function parseMoney(s: string): number {
  const clean = s.replace(/[^\d,.-]/g, '');
  if (!clean) return NaN;
  // "1.234,56" -> 1234.56 ; "87,50" -> 87.5 ; "87.50" -> 87.5
  if (clean.includes(',')) return Number(clean.replace(/\./g, '').replace(',', '.'));
  // "2.500" ou "1.250.000" = milhar no padrão brasileiro
  if (/^-?\d{1,3}(\.\d{3})+$/.test(clean)) return Number(clean.replace(/\./g, ''));
  return Number(clean);
}

/** divide um valor em N parcelas, ajustando centavos na última */
export function splitInstallments(total: number, n: number): number[] {
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / n);
  const rest = cents - base * n;
  const out = Array.from({ length: n }, (_, i) => base + (i < rest ? 1 : 0));
  return out.map((c) => c / 100);
}

import type { RecurringBill } from './types';

function iso(y: number, m: number, d: number): string {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** Próximo vencimento (>= hoje) de uma conta recorrente, ou null se faltar o dia. */
export function nextDue(bill: Pick<RecurringBill, 'due_day' | 'due_month' | 'frequency'>, today: string): string | null {
  if (!bill.due_day) return null;
  const [y, m] = today.split('-').map(Number);
  if (bill.frequency === 'anual') {
    const mm = bill.due_month ?? 1;
    const d = iso(y, mm, bill.due_day);
    return d >= today ? d : iso(y + 1, mm, bill.due_day);
  }
  const d = iso(y, m, bill.due_day);
  if (d >= today) return d;
  return m === 12 ? iso(y + 1, 1, bill.due_day) : iso(y, m + 1, bill.due_day);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

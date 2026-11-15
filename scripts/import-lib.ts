// Converte o CSV do histórico (historico_family_bs_2025_2026.csv) em linhas para o banco.
export interface CsvRow { mes: string; conta: string; tipo: 'receita' | 'despesa'; grupo: string; item: string; valor: number; recorrente: string }

export function parseCsv(text: string): CsvRow[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const head = lines[0].split(';').map((h) => h.trim());
  const idx = (k: string) => {
    const i = head.indexOf(k);
    if (i < 0) throw new Error(`Coluna "${k}" não encontrada no CSV`);
    return i;
  };
  const I = { mes: idx('mes'), conta: idx('conta'), tipo: idx('tipo'), grupo: idx('grupo'), item: idx('item'), valor: idx('valor'), rec: idx('recorrente') };
  return lines.slice(1).map((l, n) => {
    const c = l.split(';');
    const valor = Number(c[I.valor].replace(/\./g, '').replace(',', '.'));
    if (!/^\d{4}-\d{2}$/.test(c[I.mes]) || Number.isNaN(valor)) throw new Error(`Linha ${n + 2} inválida: ${l}`);
    return { mes: c[I.mes], conta: c[I.conta], tipo: c[I.tipo] as CsvRow['tipo'], grupo: c[I.grupo], item: c[I.item], valor, recorrente: (c[I.rec] ?? '').trim() };
  });
}

export function accountKind(conta: string): 'PF' | 'PJ' {
  return /\(PJ\)/i.test(conta) ? 'PJ' : 'PF';
}

/** Nome da categoria no app (o lucro da PJ vira "Lucro <empresa>" na família). */
export function categoryName(r: CsvRow, pjName: string): string {
  if (accountKind(r.conta) === 'PF' && r.tipo === 'receita' && /^Lucro /i.test(r.item)) return `Lucro ${pjName}`;
  return r.item;
}

export interface RecurringPlan { kind: 'PF' | 'PJ'; tipo: 'receita' | 'despesa'; name: string; grupo: string; amount: number | null; variable: boolean; frequency: 'mensal' | 'anual'; due_month: number | null; active: boolean }

/** Uma conta recorrente por item marcado, com o valor do mês mais recente. */
export function recurringPlan(rows: CsvRow[], pjName: string): RecurringPlan[] {
  const latest = new Map<string, CsvRow>();
  for (const r of rows) {
    if (!r.recorrente) continue;
    const k = `${accountKind(r.conta)}|${r.tipo}|${r.item}`;
    const prev = latest.get(k);
    if (!prev || r.mes > prev.mes) latest.set(k, r);
  }
  const maxMes = rows.reduce((m, r) => (r.mes > m ? r.mes : m), '0000-00');
  const shift = (mes: string, d: number) => { const [y, m] = mes.split('-').map(Number); const t = y * 12 + m - 1 + d; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
  return Array.from(latest.values()).map((r) => ({
    kind: accountKind(r.conta),
    tipo: r.tipo,
    name: categoryName(r, pjName),
    grupo: r.grupo,
    amount: r.recorrente === 'mensal variável' ? null : r.valor,
    variable: r.recorrente === 'mensal variável',
    frequency: r.recorrente === 'anual' ? 'anual' : 'mensal',
    due_month: r.recorrente === 'anual' ? Number(r.mes.slice(5, 7)) : null,
    // ainda ativa se apareceu nos últimos 2 meses da planilha (anual: últimos 13 meses)
    active: r.mes >= shift(maxMes, r.recorrente === 'anual' ? -13 : -2),
  }));
}

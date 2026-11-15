import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { investmentBrief, researchNews, NEWS_CATEGORIES } from './claude';
import { todayISO } from './format';

export async function newsPrefs(sb: SupabaseClient, householdId: string) {
  const { data } = await sb.from('news_preferences').select('*').eq('household_id', householdId).maybeSingle();
  return {
    categories: ((data?.categories as string[]) ?? Object.keys(NEWS_CATEGORIES)).filter((c) => NEWS_CATEGORIES[c]),
    city: (data?.city as string) ?? 'Jundiaí',
    region: (data?.region as string) ?? 'São Paulo',
    extra: (data?.extra_topics as string) ?? null,
  };
}

export async function generateNews(sb: SupabaseClient, householdId: string, category: string): Promise<number> {
  const p = await newsPrefs(sb, householdId);
  const today = todayISO();
  const items = await researchNews(category, { today, city: p.city, region: p.region, extra: p.extra });
  await sb.from('news_digests').upsert({ household_id: householdId, category, digest_date: today, items }, { onConflict: 'household_id,category,digest_date' });
  return items.length;
}

export function weekStart(today = todayISO()): string {
  const d = new Date(`${today}T12:00:00Z`);
  const wd = (d.getUTCDay() + 6) % 7; // segunda = 0
  d.setUTCDate(d.getUTCDate() - wd);
  return d.toISOString().slice(0, 10);
}

const CLASS_LABEL: Record<string, string> = { reserva: 'Reserva', renda_fixa: 'Renda fixa', fii: 'Fundos imobiliários', acoes: 'Ações', previdencia: 'Previdência', cripto: 'Cripto', outros: 'Outros' };

export async function generateBrief(sb: SupabaseClient, householdId: string): Promise<void> {
  const [{ data: pos }, { data: prof }] = await Promise.all([
    sb.from('portfolio_positions').select('asset_class,amount').eq('household_id', householdId),
    sb.from('investor_profile').select('*').eq('household_id', householdId).maybeSingle(),
  ]);
  const total = (pos ?? []).reduce((s, p) => s + Number(p.amount), 0);
  const byClass = new Map<string, number>();
  for (const p of pos ?? []) byClass.set(p.asset_class, (byClass.get(p.asset_class) ?? 0) + Number(p.amount));
  // só percentuais vão para o Claude, nunca os valores
  const allocation = total ? Array.from(byClass.entries()).map(([k, v]) => `${CLASS_LABEL[k] ?? k} ${Math.round((v / total) * 100)}%`).join(', ') : '';
  const content = await investmentBrief({ today: todayISO(), risk: (prof?.risk as string) ?? 'moderado', goals: (prof?.goals as string) ?? null, allocation });
  await sb.from('investment_briefs').upsert({ household_id: householdId, week_start: weekStart(), content }, { onConflict: 'household_id,week_start' });
}

/**
 * Importa o histórico da planilha para o Family BS.
 *
 * Uso (no computador, dentro da pasta do projeto, com o .env.local preenchido):
 *   npm run importar -- historico_family_bs_2025_2026.csv seu@email.com
 *
 * - Cria as categorias que faltarem (Família PF e empresa PJ)
 * - Lança cada valor mensal no dia 1º do mês (origem "importacao")
 * - Cria as contas recorrentes marcadas (sem dia de vencimento: você completa no app)
 * - Pode rodar de novo: apaga a importação anterior antes de lançar de novo
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { accountKind, categoryName, parseCsv, recurringPlan } from './import-lib';

function loadEnv() {
  try {
    for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
    }
  } catch { /* sem .env.local */ }
}

async function main() {
  loadEnv();
  const [file, email] = process.argv.slice(2);
  if (!file || !email) throw new Error('Uso: npm run importar -- arquivo.csv seu@email.com');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Preencha NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.local');
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // achar a família pelo e-mail de quem já entrou no app
  let userId: string | null = null;
  for (let page = 1; page < 20 && !userId; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    userId = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id ?? null;
    if (data.users.length < 200) break;
  }
  if (!userId) throw new Error(`Ninguém entrou no app com ${email} ainda. Entre e crie a família primeiro.`);
  const { data: mem } = await sb.from('members').select('household_id').eq('user_id', userId).limit(1);
  if (!mem?.length) throw new Error('Esse usuário ainda não criou a família no app.');
  const h = mem[0].household_id as string;

  const { data: accounts } = await sb.from('accounts').select('*').eq('household_id', h);
  const acc = { PF: accounts?.find((a) => a.kind === 'PF'), PJ: accounts?.find((a) => a.kind === 'PJ') };
  if (!acc.PF || !acc.PJ) throw new Error('Contas PF/PJ não encontradas.');
  const pjName = acc.PJ.name as string;

  const rows = parseCsv(readFileSync(file, 'utf8'));
  console.log(`${rows.length} linhas lidas de ${file}`);

  // categorias
  const { data: existing } = await sb.from('categories').select('id,account_id,tipo,name').eq('household_id', h);
  const catKey = (accountId: string, tipo: string, name: string) => `${accountId}|${tipo}|${name.toLowerCase()}`;
  const cats = new Map<string, string>((existing ?? []).map((c) => [catKey(c.account_id, c.tipo, c.name), c.id]));
  const toCreate = new Map<string, { household_id: string; account_id: string; tipo: string; name: string; grupo: string }>();
  for (const r of rows) {
    const a = acc[accountKind(r.conta)]!;
    const name = categoryName(r, pjName);
    const k = catKey(a.id, r.tipo, name);
    if (!cats.has(k) && !toCreate.has(k)) toCreate.set(k, { household_id: h, account_id: a.id, tipo: r.tipo, name, grupo: r.grupo });
  }
  if (toCreate.size) {
    const { data, error } = await sb.from('categories').insert(Array.from(toCreate.values())).select('id,account_id,tipo,name');
    if (error) throw error;
    for (const c of data ?? []) cats.set(catKey(c.account_id, c.tipo, c.name), c.id);
  }
  console.log(`${toCreate.size} categorias novas`);

  // lançamentos (refaz a importação anterior)
  await sb.from('transactions').delete().eq('household_id', h).eq('source', 'importacao');
  const txs = rows.map((r) => {
    const a = acc[accountKind(r.conta)]!;
    const name = categoryName(r, pjName);
    return {
      household_id: h, account_id: a.id, category_id: cats.get(catKey(a.id, r.tipo, name)) ?? null, tipo: r.tipo,
      amount: r.valor, occurred_on: `${r.mes}-01`, description: name, source: 'importacao',
    };
  });
  for (let i = 0; i < txs.length; i += 500) {
    const { error } = await sb.from('transactions').insert(txs.slice(i, i + 500));
    if (error) throw error;
  }
  console.log(`${txs.length} lançamentos importados`);

  // contas recorrentes
  const { data: bills } = await sb.from('recurring_bills').select('name,account_id').eq('household_id', h);
  const have = new Set((bills ?? []).map((b) => `${b.account_id}|${b.name.toLowerCase()}`));
  const plan = recurringPlan(rows, pjName)
    .map((p) => {
      const a = acc[p.kind]!;
      return {
        household_id: h, account_id: a.id, category_id: cats.get(catKey(a.id, p.tipo, p.name)) ?? null, name: p.name, tipo: p.tipo,
        amount: p.amount, variable: p.variable, frequency: p.frequency, due_month: p.due_month, remind_days_before: 3, active: p.active,
      };
    })
    .filter((b) => !have.has(`${b.account_id}|${b.name.toLowerCase()}`));
  if (plan.length) {
    const { error } = await sb.from('recurring_bills').insert(plan);
    if (error) throw error;
  }
  console.log(`${plan.length} contas recorrentes criadas. Abra o app e informe o dia de vencimento de cada uma.`);
}

main().catch((e) => { console.error('Erro:', e.message ?? e); process.exit(1); });

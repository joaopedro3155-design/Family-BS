'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Account, Category, Member } from '@/lib/types';

type Status = 'loading' | 'signed-out' | 'onboarding' | 'ready' | 'error';

interface AppState {
  status: Status;
  error: string | null;
  session: Session | null;
  householdId: string | null;
  householdName: string;
  members: Member[];
  me: Member | null;
  accounts: Account[];
  categories: Category[];
  showValues: boolean;
  toggleValues: () => void;
  reload: () => Promise<void>;
  reloadCategories: () => Promise<void>;
  memberName: (userId: string | null) => string;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp fora do AppProvider');
  return v;
}

type SB = ReturnType<typeof supabase>;

/**
 * Se a pessoa ficou em duas famílias (criou a própria antes de aceitar o convite),
 * usa a família com mais pessoas e leva para ela o que foi criado na família "sozinha".
 */
async function pickHousehold(sb: SB, uid: string, mine: Member[]): Promise<string> {
  if (mine.length === 1) return mine[0].household_id;
  const ids = mine.map((m) => m.household_id);
  const { data: all } = await sb.from('members').select('household_id,user_id').in('household_id', ids);
  const count = new Map<string, number>();
  for (const r of all ?? []) count.set(r.household_id, (count.get(r.household_id) ?? 0) + 1);
  const main = [...ids].sort((a, b) => (count.get(b) ?? 0) - (count.get(a) ?? 0))[0];
  for (const other of ids) {
    if (other === main || (count.get(other) ?? 0) > 1) continue;
    await mergeHousehold(sb, other, main).catch(() => {});
  }
  return main;
}

async function mergeHousehold(sb: SB, from: string, to: string) {
  // compromissos, estoque, lista de compras e investimentos
  for (const t of ['events', 'stock_items', 'stock_movements', 'shopping_items', 'portfolio_positions', 'push_subscriptions']) {
    await sb.from(t).update({ household_id: to }).eq('household_id', from);
  }
  // lançamentos e contas: troca conta (PF/PJ) e categoria (pelo nome) para as da família principal
  const [{ data: accFrom }, { data: accTo }, { data: catFrom }, { data: catTo }] = await Promise.all([
    sb.from('accounts').select('id,kind').eq('household_id', from),
    sb.from('accounts').select('id,kind').eq('household_id', to),
    sb.from('categories').select('id,name,tipo').eq('household_id', from),
    sb.from('categories').select('id,name,tipo,account_id').eq('household_id', to),
  ]);
  const accMap = new Map((accFrom ?? []).map((a) => [a.id, (accTo ?? []).find((b) => b.kind === a.kind)?.id]));
  const catMap = new Map((catFrom ?? []).map((c) => [c.id, (catTo ?? []).find((d) => d.name.toLowerCase() === c.name.toLowerCase() && d.tipo === c.tipo)?.id ?? null]));
  for (const t of ['transactions', 'recurring_bills']) {
    const { data: rows } = await sb.from(t).select('id,account_id,category_id').eq('household_id', from);
    for (const r of rows ?? []) {
      const acc = accMap.get(r.account_id);
      if (!acc) continue;
      await sb.from(t).update({ household_id: to, account_id: acc, category_id: r.category_id ? catMap.get(r.category_id) ?? null : null }).eq('id', r.id);
    }
  }
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const [status, setStatus] = useState<Status>(configured ? 'loading' : 'error');
  const [error, setError] = useState<string | null>(configured ? null : 'Configure NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY (veja o README).');
  const [session, setSession] = useState<Session | null>(null);
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [householdName, setHouseholdName] = useState('Família');
  const [members, setMembers] = useState<Member[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  // valores sempre começam ocultos; o olho vale até fechar o app
  const [showValues, setShowValues] = useState(false);

  const loadCategories = useCallback(async (h: string) => {
    const { data } = await supabase().from('categories').select('*').eq('household_id', h).order('grupo').order('name');
    setCategories((data as Category[]) ?? []);
  }, []);

  const load = useCallback(async (s: Session | null) => {
    setSession(s);
    if (!s) { setStatus('signed-out'); return; }
    try {
      const sb = supabase();
      // convite pendente para este e-mail? entra na família de quem convidou
      await sb.rpc('accept_invite');
      const { data: mine } = await sb.from('members').select('*').eq('user_id', s.user.id).order('created_at');
      if (!mine || mine.length === 0) { setStatus('onboarding'); return; }
      const h = await pickHousehold(sb, s.user.id, mine as Member[]);
      setHouseholdId(h);
      const [hh, mem, acc] = await Promise.all([
        sb.from('households').select('name').eq('id', h).single(),
        sb.from('members').select('*').eq('household_id', h).order('created_at'),
        sb.from('accounts').select('*').eq('household_id', h).order('kind'),
      ]);
      setHouseholdName((hh.data?.name as string) ?? 'Família');
      // cores antigas (azul/laranja-escuro) → nova paleta
      const remap: Record<string, string> = { '#1D4ED8': '#57524C', '#C2410C': '#E8590C', '#0F766E': '#E8590C' };
      setMembers(((mem.data as Member[]) ?? []).map((m) => ({ ...m, color: remap[m.color?.toUpperCase()] ?? m.color })));
      setAccounts((acc.data as Account[]) ?? []);
      await loadCategories(h);
      setStatus('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }, [loadCategories]);

  useEffect(() => {
    if (!configured) return;
    const sb = supabase();
    sb.auth.getSession().then(({ data }) => load(data.session));
    const { data: sub } = sb.auth.onAuthStateChange((event, s) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') load(s);
      else setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, [load, configured]);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {});
    }
  }, []);

  const value = useMemo<AppState>(() => {
    const me = members.find((m) => m.user_id === session?.user.id) ?? null;
    return {
      status, error, session, householdId, householdName, members, me, accounts, categories, showValues,
      toggleValues: () => setShowValues((v) => !v),
      reload: async () => { const { data } = await supabase().auth.getSession(); await load(data.session); },
      reloadCategories: async () => { if (householdId) await loadCategories(householdId); },
      memberName: (id) => (id ? members.find((m) => m.user_id === id)?.display_name ?? '—' : 'Todos'),
    };
  }, [status, error, session, householdId, householdName, members, accounts, categories, showValues, load, loadCategories]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

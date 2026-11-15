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
      let { data: mine } = await sb.from('members').select('*').eq('user_id', s.user.id).limit(1);
      if (!mine || mine.length === 0) {
        await sb.rpc('accept_invite');
        ({ data: mine } = await sb.from('members').select('*').eq('user_id', s.user.id).limit(1));
      }
      if (!mine || mine.length === 0) { setStatus('onboarding'); return; }
      const h = (mine[0] as Member).household_id;
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
      memberName: (id) => (id ? members.find((m) => m.user_id === id)?.display_name ?? '—' : 'Os dois'),
    };
  }, [status, error, session, householdId, householdName, members, accounts, categories, showValues, load, loadCategories]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

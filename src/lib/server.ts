import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { sendNotification, setVapidDetails } from 'web-push';

export function admin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

let vapidReady = false;
function setupVapid() {
  if (vapidReady) return;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) throw new Error('Faltam as chaves VAPID');
  setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:contato@familybs.app', pub, priv);
  vapidReady = true;
}

export interface PushPayload { title: string; body: string; url?: string; tag?: string }

/** Envia para todos os aparelhos da família (ou só para os usuários indicados). */
export async function pushToHousehold(sb: SupabaseClient, householdId: string, payload: PushPayload, userIds?: string[]): Promise<number> {
  setupVapid();
  let q = sb.from('push_subscriptions').select('*').eq('household_id', householdId);
  if (userIds && userIds.length) q = q.in('user_id', userIds);
  const { data: subs } = await q;
  let sent = 0;
  for (const s of subs ?? []) {
    try {
      await sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload));
      sent++;
    } catch (e: unknown) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await sb.from('push_subscriptions').delete().eq('id', s.id);
    }
  }
  return sent;
}

/** Valida o usuário logado (token do Supabase no header Authorization) e devolve a família. */
export async function requireMember(req: Request): Promise<{ sb: SupabaseClient; userId: string; householdId: string } | { error: string; status: number }> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return { error: 'faça login', status: 401 };
  const sb = admin();
  const { data: u, error } = await sb.auth.getUser(token);
  if (error || !u.user) return { error: 'sessão inválida', status: 401 };
  const { data: m } = await sb.from('members').select('household_id').eq('user_id', u.user.id).limit(1);
  if (!m?.length) return { error: 'sem família', status: 400 };
  return { sb, userId: u.user.id, householdId: m[0].household_id as string };
}

/** Categorias e membros da família, no formato que os prompts usam. */
export async function householdContext(sb: SupabaseClient, householdId: string) {
  const [acc, cats, mem] = await Promise.all([
    sb.from('accounts').select('id,kind,name').eq('household_id', householdId),
    sb.from('categories').select('id,account_id,name,tipo,archived').eq('household_id', householdId),
    sb.from('members').select('user_id,display_name').eq('household_id', householdId),
  ]);
  const pf = acc.data?.find((a) => a.kind === 'PF');
  const pj = acc.data?.find((a) => a.kind === 'PJ');
  const active = (cats.data ?? []).filter((c) => !c.archived);
  return {
    pf, pj,
    categories: active,
    categoriesPF: active.filter((c) => c.account_id === pf?.id).map((c) => c.name as string),
    categoriesPJ: active.filter((c) => c.account_id === pj?.id).map((c) => c.name as string),
    members: (mem.data ?? []) as { user_id: string; display_name: string }[],
  };
}

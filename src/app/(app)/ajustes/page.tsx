'use client';
import { useEffect, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { PageHeader } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useStatus } from '@/lib/api';

function b64ToBytes(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export default function Ajustes() {
  const { members, me, householdId, householdName, session, reload } = useApp();
  const [name, setName] = useState(me?.display_name ?? '');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('Kamila');
  const [invites, setInvites] = useState<{ id: string; email: string; display_name: string }[]>([]);
  const [pushState, setPushState] = useState<'unsupported' | 'off' | 'on' | 'ios-install'>('off');
  const [msg, setMsg] = useState<string | null>(null);
  const [newPass, setNewPass] = useState('');
  const status = useStatus();
  const [tgCode, setTgCode] = useState<string | null>(null);
  const [tgLinked, setTgLinked] = useState(0);
  const [icsToken, setIcsToken] = useState<string | null>(null);

  useEffect(() => {
    if (!householdId) return;
    supabase().from('invites').select('id,email,display_name').eq('household_id', householdId).then(({ data }) => setInvites(data ?? []));
    supabase().from('households').select('ics_token').eq('id', householdId).maybeSingle().then(({ data }) => setIcsToken((data?.ics_token as string) ?? null));
    supabase().from('telegram_links').select('chat_id', { count: 'exact', head: true }).eq('household_id', householdId).then(({ count }) => setTgLinked(count ?? 0));
    (async () => {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone;
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) { setPushState(ios && !standalone ? 'ios-install' : 'unsupported'); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setPushState(sub ? 'on' : 'off');
    })();
  }, [householdId]);

  async function saveName() {
    if (!me) return;
    await supabase().from('members').update({ display_name: name.trim() }).eq('household_id', me.household_id).eq('user_id', me.user_id);
    setMsg('Nome atualizado.');
    reload();
  }

  async function changePassword() {
    const { error } = await supabase().auth.updateUser({ password: newPass });
    setMsg(error ? error.message : 'Senha trocada.');
    setNewPass('');
  }

  async function invite() {
    const { data, error } = await supabase().from('invites').insert({ household_id: householdId, email: inviteEmail.trim().toLowerCase(), display_name: inviteName.trim() || 'Convidado' }).select('id,email,display_name').single();
    if (error) { setMsg(error.message); return; }
    setInvites((l) => [...l, data]);
    setInviteEmail('');
    setMsg('Convite criado. Ela cria a conta com esse e-mail (Criar conta) e já cai na família.');
  }

  async function enablePush() {
    setMsg(null);
    const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!key) { setMsg('Falta configurar NEXT_PUBLIC_VAPID_PUBLIC_KEY.'); return; }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { setMsg('Permissão de notificação negada nos ajustes do aparelho.'); return; }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
    const j = sub.toJSON();
    const { error } = await supabase().from('push_subscriptions').upsert({
      household_id: householdId, user_id: session?.user.id, endpoint: j.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth,
    }, { onConflict: 'endpoint' });
    if (error) { setMsg(error.message); return; }
    setPushState('on');
    setMsg('Notificações ligadas neste aparelho.');
  }

  async function telegramCode() {
    const code = Array.from(crypto.getRandomValues(new Uint8Array(4))).map((b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('') + String(Date.now() % 100).padStart(2, '0');
    const { error } = await supabase().from('telegram_codes').insert({ code, household_id: householdId, user_id: session?.user.id });
    if (error) { setMsg(error.message); return; }
    setTgCode(code);
  }

  const icsUrl = icsToken && typeof window !== 'undefined' ? `${window.location.origin}/api/agenda/ics?t=${icsToken}` : null;

  async function testPush() {
    const token = (await supabase().auth.getSession()).data.session?.access_token;
    const r = await fetch('/api/push/teste', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? `Notificação de teste enviada (${j.sent ?? 0} aparelho(s)).` : j.error ?? 'Falhou.');
  }

  return (
    <>
      <PageHeader title="Ajustes" subtitle={householdName} />
      {msg && <div className="card soft small">{msg}</div>}

      <div className="cols">
        <section className="card stack">
          <h2>Você</h2>
          <span className="small muted">{session?.user.email}</span>
          <label className="field"><span>Seu nome no app</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <button className="btn" onClick={saveName}>Salvar nome</button>
          <label className="field"><span>Nova senha</span><input type="password" autoComplete="new-password" value={newPass} onChange={(e) => setNewPass(e.target.value)} /></label>
          <button className="btn" disabled={newPass.length < 8} onClick={changePassword}>Trocar senha</button>
          <button className="btn danger" onClick={() => supabase().auth.signOut()}>Sair</button>
        </section>

        <section className="card stack">
          <h2>Família</h2>
          <p className="small muted">Um e-mail basta para usar o app inteiro. Convide a Kamila se ela quiser o próprio acesso: ela vê e alimenta tudo.</p>
          {members.map((m) => (
            <div key={m.user_id} className="row gap12">
              <span className="avatar" style={{ background: m.color }}>{m.display_name[0]}</span>
              <span className="grow strong">{m.display_name}</span>
              <span className="pill gray">{m.role === 'admin' ? 'Administrador' : 'Membro'}</span>
            </div>
          ))}
          {invites.map((i) => <span key={i.id} className="small muted">Convite pendente: {i.display_name} ({i.email})</span>)}
          <div className="grid2">
            <label className="field"><span>Nome</span><input value={inviteName} onChange={(e) => setInviteName(e.target.value)} /></label>
            <label className="field"><span>E-mail</span><input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} /></label>
          </div>
          <button className="btn" disabled={!inviteEmail.includes('@')} onClick={invite}>Convidar</button>
        </section>

        <section className="card stack">
          <h2>Notificações</h2>
          {pushState === 'ios-install' && <p className="small">No iPhone, primeiro instale o app: Safari → Compartilhar → “Adicionar à Tela de Início”. Depois abra pelo ícone e volte aqui.</p>}
          {pushState === 'unsupported' && <p className="small muted">Este navegador não aceita notificações.</p>}
          {pushState === 'off' && <button className="btn primary" onClick={enablePush}>Ligar notificações neste aparelho</button>}
          {pushState === 'on' && <><span className="pill">Ligadas neste aparelho</span><button className="btn" onClick={testPush}>Enviar notificação de teste</button></>}
          <p className="small muted">Avisos de compromissos, contas a vencer e limites de gasto (80% e 100%).</p>
        </section>

        <section className="card stack">
          <h2>Telegram</h2>
          {!status?.telegram && <p className="small muted">O bot ainda não foi configurado (veja o README: TELEGRAM_BOT_TOKEN).</p>}
          {status?.telegram && (
            <>
              <p className="small">Mande gastos em texto ou foto do cupom pelo Telegram e eles caem aqui. {tgLinked ? `${tgLinked} conversa(s) conectada(s).` : ''}</p>
              {tgCode ? (
                <div className="card soft stack" style={{ padding: 12 }}>
                  <span className="small">Abra {status.telegramBot ? <a href={`https://t.me/${status.telegramBot}`} target="_blank" rel="noopener noreferrer">@{status.telegramBot}</a> : 'o bot'} e mande (vale 15 min):</span>
                  <span className="mid">/vincular {tgCode}</span>
                </div>
              ) : <button className="btn" onClick={telegramCode}>Conectar meu Telegram</button>}
            </>
          )}
        </section>

        <section className="card stack">
          <h2>Agenda no calendário do iPhone</h2>
          <p className="small">Assine a agenda da família no app Calendário: os compromissos aparecem lá, com os mesmos alertas.</p>
          {icsUrl && (
            <>
              <a className="btn" href={icsUrl.replace(/^https?:/, 'webcal:')}>Assinar no iPhone / Mac</a>
              <button className="btn small" onClick={() => { navigator.clipboard.writeText(icsUrl); setMsg('Link copiado. No Google Agenda: Outras agendas → Do URL.'); }}>Copiar link (Google Agenda / Outlook)</button>
              <span className="small muted">O link é secreto: não compartilhe fora da família.</span>
            </>
          )}
        </section>

        <section className="card stack">
          <h2>Integrações</h2>
          <div className="row between"><span className="strong">Claude (leitura de notas, notícias, investimentos)</span><span className={status?.claude ? 'pill' : 'pill gray'}>{status?.claude ? 'Ligado' : 'Configurar'}</span></div>
          <div className="row between"><span className="strong">Bot do Telegram</span><span className={status?.telegram ? 'pill' : 'pill gray'}>{status?.telegram ? 'Ligado' : 'Configurar'}</span></div>
          <div className="row between"><span className="strong">Open Finance (Pluggy / Belvo)</span><span className="pill gray">Pausado</span></div>
        </section>
      </div>
    </>
  );
}

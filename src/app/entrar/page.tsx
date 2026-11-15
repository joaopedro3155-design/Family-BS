'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/components/AppProvider';
import { Segmented } from '@/components/ui';

type Mode = 'senha' | 'criar' | 'codigo';

export default function Entrar() {
  const { status } = useApp();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('senha');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'ready' || status === 'onboarding') router.replace('/');
  }, [status, router]);

  const reset = (m: Mode) => { setMode(m); setErr(null); setMsg(null); setCodeSent(false); setCode(''); };

  async function signIn() {
    setBusy(true); setErr(null);
    const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) {
      setErr(/confirm/i.test(error.message) ? 'Confirme o e-mail primeiro: abra o link que enviamos (pode estar no spam).' : 'E-mail ou senha incorretos.');
      return;
    }
    router.replace('/');
  }

  async function signUp() {
    if (password.length < 8) { setErr('Use uma senha com pelo menos 8 caracteres.'); return; }
    setBusy(true); setErr(null);
    const { data, error } = await supabase().auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: window.location.origin } });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    if (data.session) { router.replace('/'); return; }
    setMsg('Conta criada! Abra o link de confirmação que chegou no seu e-mail (veja o spam) e depois entre aqui com a senha.');
    setMode('senha');
  }

  async function sendCode() {
    setBusy(true); setErr(null); setMsg(null);
    const { error } = await supabase().auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false, emailRedirectTo: window.location.origin } });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setCodeSent(true);
    setMsg('Enviamos um e-mail. Se vier um código de 6 dígitos, digite abaixo; se vier um link, toque nele.');
  }

  async function verify() {
    setBusy(true); setErr(null);
    const { error } = await supabase().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
    setBusy(false);
    if (error) { setErr('Código inválido ou vencido. Peça outro.'); return; }
    router.replace('/');
  }

  const emailOk = email.includes('@');

  return (
    <div className="center-screen">
      <div className="stack" style={{ maxWidth: 420, width: '100%' }}>
        <div className="brand"><span className="logo">BS</span><span>Family BS</span></div>
        <p className="muted">Agenda, finanças e casa da família.</p>
        <Segmented value={mode} onChange={reset} options={[{ id: 'senha', label: 'Entrar' }, { id: 'criar', label: 'Criar conta' }, { id: 'codigo', label: 'Sem senha' }]} />
        <div className="card stack">
          <label className="field"><span>E-mail</span>
            <input type="email" inputMode="email" autoComplete="email" placeholder="seu@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>

          {mode !== 'codigo' && (
            <label className="field"><span>Senha</span>
              <input type="password" autoComplete={mode === 'criar' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && emailOk && password && (mode === 'senha' ? signIn() : signUp())} />
            </label>
          )}

          {mode === 'senha' && <button className="btn primary" disabled={busy || !emailOk || !password} onClick={signIn}>{busy ? 'Entrando…' : 'Entrar'}</button>}
          {mode === 'criar' && (
            <>
              <button className="btn primary" disabled={busy || !emailOk || !password} onClick={signUp}>{busy ? 'Criando…' : 'Criar conta'}</button>
              <p className="muted small">Um e-mail basta para usar o app completo. A Kamila pode criar a conta dela depois de convidada em Ajustes.</p>
            </>
          )}
          {mode === 'codigo' && (
            !codeSent ? (
              <button className="btn primary" disabled={busy || !emailOk} onClick={sendCode}>{busy ? 'Enviando…' : 'Receber e-mail de acesso'}</button>
            ) : (
              <>
                <label className="field"><span>Código (se vier no e-mail)</span>
                  <input inputMode="numeric" autoComplete="one-time-code" maxLength={8} placeholder="000000" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
                </label>
                <button className="btn primary" disabled={busy || code.length < 6} onClick={verify}>{busy ? 'Entrando…' : 'Entrar com o código'}</button>
              </>
            )
          )}
          {msg && <p className="ok">{msg}</p>}
          {err && <p className="error">{err}</p>}
        </div>
        <p className="muted small">No iPhone, entre com e-mail e senha dentro do app instalado (pelo ícone na tela de início).</p>
      </div>
    </div>
  );
}

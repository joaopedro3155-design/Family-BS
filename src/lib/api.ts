'use client';
import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const token = (await supabase().auth.getSession()).data.session?.access_token;
  const r = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `Erro ${r.status}`);
  return j as T;
}

export interface Status { claude: boolean; telegram: boolean; telegramBot: string | null; push: boolean }
let cached: Promise<Status> | null = null;

export function useStatus(): Status | null {
  const [s, setS] = useState<Status | null>(null);
  useEffect(() => {
    if (!cached) cached = fetch('/api/status').then((r) => r.json()).catch(() => ({ claude: false, telegram: false, telegramBot: null, push: false }));
    let alive = true;
    cached.then((v) => { if (alive) setS(v); });
    return () => { alive = false; };
  }, []);
  return s;
}

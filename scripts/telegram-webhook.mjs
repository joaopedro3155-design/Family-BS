// Liga o bot do Telegram ao app publicado.
// Uso: npm run telegram -- https://SEU-APP.vercel.app
import { readFileSync } from 'node:fs';
try {
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
} catch {}
const base = process.argv[2]?.replace(/\/$/, '');
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
if (!base || !token || !secret) {
  console.error('Uso: npm run telegram -- https://SEU-APP.vercel.app  (com TELEGRAM_BOT_TOKEN e TELEGRAM_WEBHOOK_SECRET no .env.local)');
  process.exit(1);
}
const api = (m, body) => fetch(`https://api.telegram.org/bot${token}/${m}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const r = await api('setWebhook', { url: `${base}/api/telegram/webhook`, secret_token: secret, allowed_updates: ['message'] });
console.log('setWebhook:', r.ok ? 'ok' : r.description);
await api('setMyCommands', { commands: [
  { command: 'hoje', description: 'Agenda de hoje' },
  { command: 'lista', description: 'Lista de compras' },
  { command: 'estoque', description: 'O que está acabando' },
  { command: 'desfazer', description: 'Apagar o último lançamento feito aqui' },
] });
const me = await fetch(`https://api.telegram.org/bot${token}/getMe`).then((x) => x.json());
console.log(`Bot: @${me.result?.username} → coloque TELEGRAM_BOT_USERNAME=${me.result?.username} na Vercel.`);

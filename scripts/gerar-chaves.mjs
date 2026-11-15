// Gera as chaves das notificações (VAPID) e um segredo para o agendador.
import { generateVAPIDKeys } from 'web-push';
import { randomBytes } from 'node:crypto';
const k = generateVAPIDKeys();
console.log('Copie para o .env.local e para a Vercel (Settings → Environment Variables):\n');
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${k.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${k.privateKey}`);
console.log(`CRON_SECRET=${randomBytes(24).toString('hex')}`);
console.log(`TELEGRAM_WEBHOOK_SECRET=${randomBytes(24).toString('hex')}`);

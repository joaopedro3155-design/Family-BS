import { NextResponse, connection } from 'next/server';
import { claudeConfigured } from '@/lib/claude';

export async function GET() {
  await connection(); // lê as variáveis na hora, não na compilação
  return NextResponse.json({
    claude: claudeConfigured(),
    telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    telegramBot: process.env.TELEGRAM_BOT_USERNAME || null,
    push: Boolean(process.env.VAPID_PRIVATE_KEY),
  });
}

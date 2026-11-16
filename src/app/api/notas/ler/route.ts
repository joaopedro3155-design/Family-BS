import { NextResponse } from 'next/server';
import { claudeConfigured, readReceipt } from '@/lib/claude';
import { householdContext, requireMember } from '@/lib/server';
import { htmlToText, parseNfceHtml, parseNfceQr } from '@/lib/nfce';
import type { ReadReceiptResponse } from '@/lib/stock';

export const maxDuration = 60;


export async function POST(req: Request) {
  const auth = await requireMember(req);
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = (await req.json().catch(() => ({}))) as { qr?: string; image?: string; mediaType?: string };
  const ctx = await householdContext(auth.sb, auth.householdId);

  try {
    // 1) QR code da NFC-e: busca a página pública da SEFAZ
    if (body.qr) {
      const q = parseNfceQr(body.qr);
      if (!q) return NextResponse.json({ error: 'Esse QR não é de uma nota fiscal (NFC-e).' }, { status: 400 });
      let res: Response;
      try {
        res = await fetch(q.url, { headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1', 'accept-language': 'pt-BR' }, cache: 'no-store', signal: AbortSignal.timeout(20000) });
      } catch {
        return NextResponse.json({ error: 'O QR foi lido, mas o site da SEFAZ não respondeu agora (fora do ar ou lento). Tente de novo mais tarde ou use a foto do cupom.' }, { status: 504 });
      }
      const html = await res.text();
      const parsed = parseNfceHtml(html);
      if (parsed.items.length) {
        return NextResponse.json({ source: 'nfce', accessKey: q.accessKey, ...parsed, suggestedCategory: null } satisfies ReadReceiptResponse);
      }
      const why = sefazReason(res.status, htmlToText(html));
      if (why || !claudeConfigured()) return NextResponse.json({ error: why ?? 'O QR foi lido, mas a página da SEFAZ veio sem os itens. Tente de novo mais tarde ou use a foto do cupom.' }, { status: 422 });
      const r = await readReceipt({ pageText: htmlToText(html) }, ctx.categoriesPF);
      return NextResponse.json(fromClaude('nfce', q.accessKey, r));
    }
    // 2) Foto do comprovante: o Claude lê
    if (body.image) {
      if (!claudeConfigured()) return NextResponse.json({ error: 'Para ler fotos é preciso configurar o Claude (ANTHROPIC_API_KEY).' }, { status: 503 });
      const r = await readReceipt({ imageBase64: body.image, mediaType: body.mediaType }, ctx.categoriesPF);
      return NextResponse.json(fromClaude('foto', null, r));
    }
    return NextResponse.json({ error: 'envie o QR ou a foto' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'falhou' }, { status: 502 });
  }
}

/** Explica por que a SEFAZ não mostrou a nota. */
function sefazReason(status: number, text: string): string | null {
  const t = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (status >= 500) return 'O QR foi lido, mas o site da SEFAZ está fora do ar agora. Tente mais tarde ou use a foto do cupom.';
  if (status === 403 || status === 429 || /captcha|acesso negado|bloquead/.test(t)) return 'O QR foi lido, mas a SEFAZ bloqueou a consulta automática agora. Tente mais tarde ou use a foto do cupom.';
  if (/(nao|n\.o)\s*(foi\s*)?(encontrad|localizad)|inexistente|nao consta|nao existe|nenhum(a)? (nota|registro)/.test(t)) return 'O QR foi lido, mas a SEFAZ ainda não tem essa nota: a loja não transmitiu a NFC-e (cupom impresso sem protocolo de autorização ou em contingência). Costuma aparecer em até 24 h; até lá, use a foto do cupom.';
  if (/rejeic|denegad|cancelad/.test(t)) return 'O QR foi lido, mas a SEFAZ informa que essa nota foi rejeitada ou cancelada pela loja.';
  return null;
}

function fromClaude(source: 'nfce' | 'foto', accessKey: string | null, r: Awaited<ReturnType<typeof readReceipt>>): ReadReceiptResponse {
  return {
    source, accessKey, store: r.loja, cnpj: r.cnpj, issuedOn: r.data, total: r.total, paymentMethod: r.forma_pagamento,
    suggestedCategory: r.categoria_sugerida,
    items: r.itens.map((i) => ({ name: i.nome, qty: Number(i.quantidade) || 1, unit: i.unidade, unitPrice: i.preco_unitario, total: i.total })),
  };
}

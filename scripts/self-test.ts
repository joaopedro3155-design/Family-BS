// Testes rápidos da lógica (npm test). Não precisa de internet nem do Supabase.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { addMonthsToDate, parseMoney, splitInstallments, money } from '../src/lib/format';
import { parseMessage } from '../src/lib/parse-message';
import { dueEventReminders } from '../src/lib/reminders';
import { nextDue, daysBetween } from '../src/lib/recurring';
import { parseCsv, recurringPlan, categoryName } from './import-lib';
import type { Category } from '../src/lib/types';
import { normalizeName, matchStockItem, estimateDailyUsage, daysLeft, needsBuying, whatsappText } from '../src/lib/stock';
import { parseNfceQr, parseNfceHtml } from '../src/lib/nfce';
import { extractJson, filterSourced } from '../src/lib/ai-utils';
import { buildIcs } from '../src/lib/ics';
import { parseRss, mergeHeadlines } from '../src/lib/rss';
import { parseSgs, realRate } from '../src/lib/bcb';
import { parseReceiptText, splitByBucket, classifyItem } from '../src/lib/receipt-text';
import { occurrences, recurrenceLabel, nextOccurrence, rrule } from '../src/lib/recurrence';
import { parseVoiceEvent } from '../src/lib/voice-event';

let n = 0;
const t = (name: string, fn: () => void) => { fn(); n++; console.log('ok -', name); };

t('valores em reais', () => {
  assert.equal(parseMoney('87,50'), 87.5);
  assert.equal(parseMoney('1.234,56'), 1234.56);
  assert.equal(parseMoney('R$ 2.500'), 2500);
  assert.equal(money(10, false), 'R$ •••••');
});

t('parcelas somam o total', () => {
  const p = splitInstallments(100, 3);
  assert.deepEqual(p, [33.34, 33.33, 33.33]);
  assert.deepEqual(splitInstallments(87.5, 3), [29.17, 29.17, 29.16]);
  assert.equal(addMonthsToDate('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonthsToDate('2026-11-15', 2), '2027-01-15');
});

t('mensagem rápida', () => {
  const cats = [
    { id: 'm', name: 'Supermercado', tipo: 'despesa', archived: false },
    { id: 'r', name: 'Restaurantes', tipo: 'despesa', archived: false },
  ] as Category[];
  const p = parseMessage('gastei 87,50 no mercado no crédito em 3x', cats);
  assert.equal(p.amount, 87.5);
  assert.equal(p.payment_method, 'credito');
  assert.equal(p.installments, 3);
  assert.equal(p.category_id, 'm');
  const q = parseMessage('almoço 45 no pix', cats);
  assert.equal(q.amount, 45);
  assert.equal(q.payment_method, 'pix');
  assert.equal(q.category_id, 'r');
});

t('lembretes de compromisso', () => {
  const now = new Date('2026-11-16T10:00:00-03:00');
  const ev = [
    { id: 'a', starts_at: '2026-11-16T10:50:00-03:00', reminders: [1440, 60] }, // 1 h antes já venceu
    { id: 'b', starts_at: '2026-11-17T09:00:00-03:00', reminders: [1440, 60] }, // 1 dia antes já venceu
    { id: 'c', starts_at: '2026-11-18T09:00:00-03:00', reminders: [1440] },     // ainda não
  ];
  assert.deepEqual(dueEventReminders(ev, new Set(), now), [{ eventId: 'a', minutes: 60 }, { eventId: 'b', minutes: 1440 }]);
  assert.deepEqual(dueEventReminders(ev, new Set(['a:60', 'b:1440']), now), []);
});

t('vencimento de contas', () => {
  assert.equal(nextDue({ due_day: 10, due_month: null, frequency: 'mensal' }, '2026-11-14'), '2026-12-10');
  assert.equal(nextDue({ due_day: 20, due_month: null, frequency: 'mensal' }, '2026-11-14'), '2026-11-20');
  assert.equal(nextDue({ due_day: 31, due_month: null, frequency: 'mensal' }, '2026-02-10'), '2026-02-28');
  assert.equal(nextDue({ due_day: 15, due_month: 1, frequency: 'anual' }, '2026-11-14'), '2027-01-15');
  assert.equal(daysBetween('2026-11-14', '2026-11-20'), 6);
});


t('estoque: nomes e correspondência com a nota', () => {
  assert.equal(normalizeName('CAFÉ PILÃO 500G Tradicional'), 'cafe pilao tradicional');
  const items = [{ id: 'cafe', name: 'Café', aliases: [] }, { id: 'papel', name: 'Papel higiênico', aliases: [] }, { id: 'leite', name: 'Leite', aliases: ['LT ITALAC INT 1L'] }];
  assert.equal(matchStockItem('CAFE PILAO 500G', items), 'cafe');
  assert.equal(matchStockItem('PAPEL HIG NEVE 12UN', items), 'papel');
  assert.equal(matchStockItem('LT ITALAC INT 1L', items), 'leite');
  assert.equal(matchStockItem('BANANA PRATA KG', items), null);
});

t('estoque: consumo e dias restantes', () => {
  const d = (s: string) => new Date(s).toISOString();
  // comprou 2 em 01/10 e 2 em 25/10 -> 2 pacotes em 24 dias
  const u1 = estimateDailyUsage([{ delta: 2, kind: 'compra', occurred_at: d('2026-10-01T10:00:00Z') }, { delta: 2, kind: 'compra', occurred_at: d('2026-10-25T10:00:00Z') }])!;
  assert.ok(Math.abs(u1 - 2 / 24) < 1e-9);
  // ciclo "acabou": 3 rolos em 15 dias
  const u2 = estimateDailyUsage([{ delta: 3, kind: 'compra', occurred_at: d('2026-10-01T10:00:00Z') }, { delta: -3, kind: 'acabou', occurred_at: d('2026-10-16T10:00:00Z') }])!;
  assert.ok(Math.abs(u2 - 0.2) < 1e-9);
  assert.equal(estimateDailyUsage([{ delta: 1, kind: 'compra', occurred_at: d('2026-10-01T10:00:00Z') }]), null);
  const item = { quantity: 2, quantity_updated_at: d('2026-11-01T10:00:00Z'), daily_usage: 0.2, min_days: 5 };
  const now = new Date('2026-11-06T10:00:00Z'); // 5 dias depois: sobrou 1 -> 5 dias
  assert.ok(Math.abs(daysLeft(item, now)! - 5) < 1e-9);
  assert.equal(needsBuying(item, now), true);
  assert.equal(needsBuying({ ...item, quantity: 10 }, now), false);
  assert.ok(whatsappText('Lista', [{ name: 'Café', quantity: '2' }], [{ name: 'Azeite' }]).includes('• Café (2)'));
});

t('NFC-e: QR e página da SEFAZ', () => {
  const key = '35261112345678000190650010000123451000123456';
  const q = parseNfceQr(`https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?p=${key}|2|1|1|ABCDEF`)!;
  assert.equal(q.accessKey, key);
  assert.equal(parseNfceQr('https://google.com/?q=1'), null);
  const html = `<div id="u20" class="txtTopo">SUPERMERCADO BOM PRECO LTDA</div><div class="text">CNPJ: 12.345.678/0001-90</div>
  <table id="tabResult"><tr id="Item + 1"><td valign="top"><span class="txtTit2">CAFE PILAO 500G</span><span class="RCod">(Código: 789 )</span><br /><span class="Rqtd"><strong>Qtde.:</strong>2</span><span class="RUN"><strong>UN: </strong>UN</span><span class="RvlUnit"><strong>Vl. Unit.:</strong>&nbsp;16,9</span></td><td align="right" valign="top" class="txtTit noWrap">Vl. Total<br /><span class="valor">33,80</span></td></tr>
  <tr id="Item + 2"><td><span class="txtTit2">BANANA PRATA KG</span><span class="Rqtd"><strong>Qtde.:</strong>1,235</span><span class="RUN"><strong>UN: </strong>KG</span><span class="RvlUnit"><strong>Vl. Unit.:</strong>&nbsp;6,99</span></td><td><span class="valor">8,63</span></td></tr></table>
  <span class="totalNumb txtMax">42,43</span><label class="tx">Cartão de Crédito</label><li><strong> Emissão: </strong>14/11/2026 10:22:01</li>`;
  const p = parseNfceHtml(html);
  assert.equal(p.store, 'SUPERMERCADO BOM PRECO LTDA');
  assert.equal(p.cnpj, '12.345.678/0001-90');
  assert.equal(p.items.length, 2);
  assert.deepEqual(p.items[0], { name: 'CAFE PILAO 500G', qty: 2, unit: 'UN', unitPrice: 16.9, total: 33.8 });
  assert.equal(p.items[1].qty, 1.235);
  assert.equal(p.total, 42.43);
  assert.equal(p.paymentMethod, 'credito');
  assert.equal(p.issuedOn, '2026-11-14');
});

t('respostas do Claude: JSON e fontes', () => {
  assert.deepEqual(extractJson<{ a: number }>('Claro! ```json\n{"a": 1}\n``` pronto'), { a: 1 });
  assert.deepEqual(extractJson<{ s: string }>('texto {"s": "chave } dentro"} fim'), { s: 'chave } dentro' });
  const items = [
    { titulo: 'A', resumo: '', fontes: [{ titulo: 'g1', url: 'https://g1.globo.com/economia/x' }] },
    { titulo: 'B', resumo: '', fontes: [{ titulo: 'inventada', url: 'https://site-inventado.com/y' }] },
  ];
  const kept = filterSourced(items, new Set(['https://g1.globo.com/economia/x?utm=1']));
  assert.equal(kept.length, 1);
  assert.equal(kept[0].titulo, 'A');
});

t('agenda iCal', () => {
  const ics = buildIcs('Família BS', [{ id: 'e1', title: 'Reunião, cliente', starts_at: '2026-11-16T11:30:00.000Z', ends_at: null, location: null, notes: null, reminders: [60], who: 'João' }], new Date('2026-11-14T00:00:00Z'));
  assert.ok(ics.includes('DTSTART:20261116T113000Z'));
  assert.ok(ics.includes('DTEND:20261116T123000Z'));
  assert.ok(ics.includes('SUMMARY:Reunião\\, cliente (João)'));
  assert.ok(ics.includes('TRIGGER:-PT60M'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
});

const csv = 'dados/historico_family_bs_2025_2026.csv';
if (existsSync(csv)) {
  t('importação da planilha', () => {
    const rows = parseCsv(readFileSync(csv, 'utf8'));
    assert.equal(rows.length, 897);
    const pfSet = rows.filter((r) => r.mes === '2026-09' && r.conta.startsWith('Fam') && r.tipo === 'despesa').reduce((s, r) => s + r.valor, 0);
    assert.equal(Math.round(pfSet * 100) / 100, 26994.54);
    const lucro = rows.find((r) => r.tipo === 'receita' && r.item.startsWith('Lucro'))!;
    assert.equal(categoryName(lucro, 'CBS Engenharia'), 'Lucro CBS Engenharia');
    const plan = recurringPlan(rows, 'CBS Engenharia');
    const aluguel = plan.find((p) => p.name === 'Aluguel')!;
    assert.equal(aluguel.amount, 2500);
    assert.equal(aluguel.active, true);
    assert.equal(plan.find((p) => p.name === 'Cursos Inglês')!.active, false);
    assert.equal(plan.find((p) => p.name === 'Luz')!.variable, true);
    console.log(`   ${plan.length} recorrentes (${plan.filter((p) => p.active).length} ativas)`);
  });
}

t('notícias grátis (RSS) e indicadores do BC', () => {
  const xml = `<rss><channel><item><title>Selic sobe para 15% - G1</title><link>https://news.google.com/a</link><pubDate>Fri, 14 Nov 2026 10:00:00 GMT</pubDate><source url="https://g1.globo.com">G1</source></item><item><title><![CDATA[Jundiaí &amp; região: obras]]></title><link>https://news.google.com/b</link><pubDate>Fri, 14 Nov 2026 12:00:00 GMT</pubDate></item></channel></rss>`;
  const items = parseRss(xml);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Selic sobe para 15%');
  assert.equal(items[0].source, 'G1');
  assert.ok(items[1].title.includes('Jundiaí & região'));
  const merged = mergeHeadlines([items, items], 10);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].link, 'https://news.google.com/b');
  const v = parseSgs([{ data: '13/11/2026', valor: '15.00' }]);
  assert.deepEqual(v, { data: '2026-11-13', valor: 15 });
  assert.ok(Math.abs(realRate(15, 5) - 9.52) < 0.01);
});

t('cupom pela foto: tipo de loja e divisão por categoria', () => {
  const merc = `SUPERMERCADO BOA COMPRA LTDA\nCNPJ 12.345.678/0001-90\n14/11/2026 18:32\n001 7891000100103 PAO FRANCES KG 0,512 KG X 14,99 7,67\n002 2000001 PATINHO MOIDO KG 1,020 KG X 45,90 46,82\n003 7896 TOMATE ITALIANO KG 0,800 KG X 8,99 7,19\n004 7891234 DETERGENTE YPE 500ML 1 UN X 2,79 2,79\n005 789 BANANA PRATA KG\n1,2 KG X 6,99 8,39\nTOTAL R$ 72,86\nCARTAO DEBITO 72,86`;
  const r = parseReceiptText(merc);
  assert.equal(r.storeKind, 'mercado');
  assert.equal(r.total, 72.86);
  assert.equal(r.issuedOn, '2026-11-14');
  assert.equal(r.paymentMethod, 'debito');
  assert.equal(r.items.length, 5);
  assert.equal(r.items[0].name, 'PAO FRANCES');
  const sp = splitByBucket(r.items, r.total, r.storeKind);
  assert.deepEqual(sp.map((x) => x.bucket), ['acougue', 'feira', 'padaria', 'mercado']);
  assert.equal(Math.round(sp.reduce((s, x) => s + x.amount, 0) * 100) / 100, 72.86);
  const p = parseReceiptText(`AUTO POSTO JUNDIAI LTDA\n15/11/2026 08:10\nBICO 03 ETANOL COMUM\n32,150 L X 4,190 134,71\nVALOR TOTAL R$ 134,71\nCREDITO`);
  assert.equal(p.storeKind, 'posto');
  assert.deepEqual(splitByBucket(p.items, p.total, p.storeKind), [{ bucket: 'combustivel', amount: 134.71, items: [] }]);
  assert.equal(classifyItem('FRALDA PAMPERS G'), 'bebe');
  assert.equal(classifyItem('QUEIJO MUSSARELA', 'padaria'), 'padaria');
});

t('agenda: repetição diária, semanal, mensal e anual', () => {
  const base = { starts_at: '2026-01-31T12:00:00.000Z' }; // 31/01 09:00 em Brasília
  const days = (r: string[]) => r.map((x) => new Date(Date.parse(x) - 3 * 3600000).toISOString().slice(0, 16));
  assert.deepEqual(days(occurrences({ ...base, recurrence: 'monthly' }, '2026-01-01T00:00:00Z', '2026-05-01T00:00:00Z')),
    ['2026-01-31T09:00', '2026-02-28T09:00', '2026-03-31T09:00', '2026-04-30T09:00']);
  assert.equal(occurrences({ ...base, recurrence: 'daily', recurrence_interval: 2 }, '2026-02-01T00:00:00Z', '2026-02-10T23:00:00Z').length, 5);
  const wk = occurrences({ ...base, recurrence: 'weekly', recurrence_until: '2026-02-21' }, '2026-01-01T00:00:00Z', '2026-12-31T00:00:00Z');
  assert.deepEqual(days(wk).map((d) => d.slice(0, 10)), ['2026-01-31', '2026-02-07', '2026-02-14', '2026-02-21']);
  assert.deepEqual(days(occurrences({ starts_at: '2024-02-29T12:00:00Z', recurrence: 'yearly' }, '2025-01-01T00:00:00Z', '2028-12-31T00:00:00Z')).map((d) => d.slice(0, 10)), ['2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
  assert.equal(recurrenceLabel({ starts_at: '2026-11-18T12:00:00Z', recurrence: 'weekly' }), 'Toda semana · quarta');
  assert.equal(recurrenceLabel({ starts_at: '2026-11-10T12:00:00Z', recurrence: 'monthly', recurrence_interval: 3 }), 'A cada 3 meses · dia 10');
  assert.equal(nextOccurrence({ starts_at: '2020-01-01T12:00:00Z', recurrence: 'yearly' }, new Date('2026-11-15T12:00:00Z')), '2027-01-01T12:00:00.000Z');
  assert.equal(rrule({ starts_at: base.starts_at, recurrence: 'weekly', recurrence_interval: 2, recurrence_until: '2026-12-31' }), 'RRULE:FREQ=WEEKLY;INTERVAL=2;UNTIL=20261231T235959Z');
  assert.deepEqual(occurrences({ starts_at: '2026-11-20T12:00:00Z' }, '2026-11-01T00:00:00Z', '2026-11-30T00:00:00Z'), ['2026-11-20T12:00:00Z']);
});

t('comprovante de Pix e de boleto pela foto', () => {
  const pix = parseReceiptText(`itaú\nComprovante de Pix\nR$ 183,96\nRealizado em 16/11/2026 às 15:36:30\nDe\nJoao Pedro Costa Boa Sorte\nCPF: ***.484.862-**\nInstituição: ITAÚ UNIBANCO S.A\nPara\nENEL DISTRIBUICAO SAO PAULO\nCPF/CNPJ: 61695227000193\nInstituição: ITAÚ UNIBANCO S.A.\nDados da transação\nIdentificador: 010280161383`);
  assert.equal(pix.docType, 'pix');
  assert.equal(pix.total, 183.96);
  assert.equal(pix.issuedOn, '2026-11-16');
  assert.equal(pix.store, 'ENEL DISTRIBUICAO SAO PAULO');
  assert.equal(pix.cnpj, '61695227000193');
  assert.equal(pix.paymentMethod, 'pix');
  assert.ok(new RegExp(pix.suggestedCategory!, 'i').test('Luz'));
  const bol = parseReceiptText(`Comprovante de pagamento de boleto\nBeneficiário: SABESP CIA SANEAMENTO BASICO\nData de vencimento 10/11/2026\nData do pagamento 09/11/2026\nValor do documento R$ 98,40\nValor pago R$ 98,40`);
  assert.equal(bol.docType, 'boleto');
  assert.equal(bol.total, 98.4);
  assert.equal(bol.issuedOn, '2026-11-09');
  assert.ok(new RegExp(bol.suggestedCategory!, 'i').test('Água'));
  // cupom de mercado pago com Pix continua sendo cupom
  const cupom = parseReceiptText(`SUPERMERCADO X\nCUPOM FISCAL\n001 PAO FRANCES 7,67\nTOTAL R$ 7,67\nPIX 7,67`);
  assert.equal(cupom.docType, undefined);
  assert.equal(cupom.items.length, 1);
});

t('agenda por voz: data, horário, endereço, link e observação', () => {
  const now = new Date(2026, 10, 16, 16, 40); // segunda 16/11/2026
  const a = parseVoiceEvent('Reunião com cliente amanhã às 14h na Rua das Flores, 120, Centro, observação levar o projeto impresso', now);
  assert.deepEqual([a.title, a.date, a.start, a.end, a.location, a.notes, a.category], ['Reunião com cliente', '2026-11-17', '14:00', null, 'Rua das Flores, 120, Centro', 'Levar o projeto impresso', 'cliente']);
  const b = parseVoiceEvent('Consulta pediatra 25/11 das 10 às 11 da manhã endereço Avenida Jundiaí 1000 Anhangabaú', now);
  assert.deepEqual([b.title, b.date, b.start, b.end, b.location], ['Consulta pediatra', '2026-11-25', '10:00', '11:00', 'Avenida Jundiaí 1000 Anhangabaú']);
  const c = parseVoiceEvent('Entrega do projeto da AGCO na sexta às 18 horas para a CBS', now);
  assert.deepEqual([c.title, c.date, c.start, c.who, c.category], ['Entrega do projeto da AGCO', '2026-11-20', '18:00', 'cbs', 'entrega']);
  const d = parseVoiceEvent('Reunião online quinta às 15:30 link meet ponto google ponto com barra abc', now);
  assert.deepEqual([d.title, d.date, d.start, d.location], ['Reunião online', '2026-11-19', '15:30', 'meet.google.com/abc']);
  const e = parseVoiceEvent('Culto sábado às duas da tarde', now);
  assert.deepEqual([e.title, e.date, e.start], ['Culto', '2026-11-21', '14:00']);
  const f = parseVoiceEvent('Terapia toda quinta às 9h para a Camila', now);
  assert.deepEqual([f.title, f.recurrence, f.start, f.who, f.date], ['Terapia', 'weekly', '09:00', 'kamila', '2026-11-19']);
  const g = parseVoiceEvent('Médico às 3 da tarde', now);
  assert.deepEqual([g.title, g.date, g.start, g.end], ['Médico', null, '15:00', null]);
  const h = parseVoiceEvent('Definir data do projeto da casa da Vila Arens, sem data definida', now);
  assert.deepEqual([h.title, h.undated, h.date, h.start], ['Definir data do projeto da casa da Vila Arens', true, null, null]);
});

console.log(`\n${n} grupos de teste passaram.`);

// Entende um compromisso falado (ou ditado) em português e separa os campos.
// Ex.: "Reunião com cliente amanhã às 14h na Rua das Flores 120, observação levar o projeto impresso"
// Tudo roda no aparelho, sem custo.

import type { Recurrence } from './recurrence';

export interface VoiceEvent {
  title: string;
  date: string | null; // YYYY-MM-DD
  start: string | null; // HH:MM
  end: string | null; // HH:MM
  location: string | null; // endereço ou link
  notes: string | null;
  who: 'cbs' | 'both' | string | null; // 'cbs', 'both' ou primeiro nome falado
  category: 'cliente' | 'escritorio' | 'casa' | 'pessoal' | 'familia' | 'entrega' | null;
  recurrence: Recurrence | null;
  isTask: boolean;
  undated: boolean;
}

/** minúsculas e sem acento, mantendo o MESMO tamanho do texto (para casar posições). */
const fold = (s: string) => s.normalize('NFC').split('').map((ch) => ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().charAt(0) || ' ').join('');
const pad = (n: number) => String(n).padStart(2, '0');
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const MONTHS = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const WD = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
const NUM: [string, number][] = [
  ['vinte e tres', 23], ['vinte e duas', 22], ['vinte e dois', 22], ['vinte e uma', 21], ['vinte e um', 21],
  ['dezesseis', 16], ['dezessete', 17], ['dezenove', 19], ['dezoito', 18], ['quatorze', 14], ['catorze', 14], ['cinquenta', 50],
  ['quarenta', 40], ['quinze', 15], ['treze', 13], ['trinta', 30], ['quatro', 4], ['cinco', 5], ['vinte', 20], ['duas', 2], ['dois', 2],
  ['tres', 3], ['seis', 6], ['sete', 7], ['oito', 8], ['nove', 9], ['onze', 11], ['doze', 12], ['dez', 10], ['uma', 1], ['um', 1],
];

/** Texto de trabalho: W (original com números em dígitos) e L (dobrado, mesmo tamanho), com máscara do que já foi usado. */
class Work {
  W: string;
  L: string;
  used: boolean[];
  constructor(text: string) {
    let w = ` ${text.normalize('NFC').replace(/\s+/g, ' ').trim()} `;
    // números por extenso → dígitos (comparando sem acento, mantendo o resto do texto)
    const sub = (re: RegExp, f: (m: RegExpExecArray) => string) => {
      let out = '', last = 0;
      const l = fold(w);
      re.lastIndex = 0;
      for (let m = re.exec(l); m; m = re.exec(l)) { out += w.slice(last, m.index) + f(m); last = m.index + m[0].length; }
      w = out + w.slice(last);
    };
    sub(/\bmeio[ -]dia e meia\b/g, () => '12:30');
    sub(/\bmeio[ -]dia\b/g, () => '12:00');
    sub(/\bmeia[ -]noite\b/g, () => '00:00');
    for (const [k, n] of NUM) sub(new RegExp(`(?<=[\\s,])${k}(?=[\\s,.]|$)`, 'g'), () => String(n));
    sub(/\b(\d{1,2}) e meia\b/g, (m) => `${m[1]}:30`);
    sub(/\b(\d{1,2}) horas? e (\d{1,2})( minutos?)?\b/g, (m) => `${m[1]}:${pad(+m[2])}`);
    this.W = w;
    this.L = fold(w);
    this.used = new Array(w.length).fill(false);
  }
  /** procura no texto ainda não usado; marca como usado e devolve o match (com índice). */
  take(re: RegExp): RegExpMatchArray | null {
    const masked = this.L.split('').map((c, i) => (this.used[i] ? '\u0000' : c)).join('');
    const m = masked.match(re);
    if (!m || m.index === undefined) return null;
    for (let i = m.index; i < m.index + m[0].length; i++) this.used[i] = true;
    return m;
  }
  orig(m: RegExpMatchArray, group = 0): string {
    if (group === 0) return this.W.slice(m.index!, m.index! + m[0].length);
    const g = m[group];
    if (!g) return '';
    const at = m[0].indexOf(g);
    return this.W.slice(m.index! + at, m.index! + at + g.length);
  }
  markRange(a: number, b: number) { for (let i = a; i < b; i++) this.used[i] = true; }
  rest(): string { return this.W.split('').map((c, i) => (this.used[i] ? ' ' : c)).join('').replace(/\s{2,}/g, ' ').trim(); }
}

function toTime(h: number, m: number, period?: string): string | null {
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  if (period && /tarde|noite/.test(period) && h < 12) h += 12;
  if (period && /manha|madrugada/.test(period) && h === 12) h = 0;
  if (h > 23 || m > 59) return null;
  return `${pad(h)}:${pad(m)}`;
}

/** Fala "meet ponto google ponto com barra abc" → "meet.google.com/abc". */
function spokenUrl(t: string): string {
  return t.replace(/\s*\bponto\b\s*/gi, '.').replace(/\s*\bbarra\b\s*/gi, '/').replace(/\s*\bdois pontos\b\s*/gi, ':').replace(/\s+/g, '').replace(/[.,;]+$/, '');
}

export function parseVoiceEvent(text: string, now = new Date()): VoiceEvent {
  const w = new Work(text);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const addDays = (n: number) => { const d = new Date(today); d.setDate(d.getDate() + n); return isoDate(d); };

  // 1) trechos marcados por palavra-chave: endereço / site / observação (vão até a próxima palavra-chave)
  const MARK = /\b(no endereco|endereco|localizacao|no local|local|no site|site|link|observacoes|observacao|obs|anotacao)\b\s*:?/g;
  const marks: { kind: 'loc' | 'url' | 'obs'; at: number; end: number }[] = [];
  for (const m of w.L.matchAll(MARK)) {
    const k = m[1];
    marks.push({ kind: /site|link/.test(k) ? 'url' : /obs|anotac/.test(k) ? 'obs' : 'loc', at: m.index!, end: m.index! + m[0].length });
  }
  let location: string | null = null, url: string | null = null, notes: string | null = null;
  const firstMark = marks.length ? marks[0].at : w.W.length;
  marks.forEach((mk, i) => {
    const stop = i + 1 < marks.length ? marks[i + 1].at : w.W.length;
    const v = w.W.slice(mk.end, stop).replace(/^[\s,.:;-]+|[\s,;-]+$/g, '').replace(/\s+e$/i, '').trim();
    w.markRange(mk.at, stop);
    if (!v) return;
    if (mk.kind === 'loc') location = location ? `${location}, ${v}` : v;
    else if (mk.kind === 'url') url = /^\S+\.\S+$/.test(v) ? v : spokenUrl(v);
    else notes = notes ? `${notes}. ${v}` : v.charAt(0).toUpperCase() + v.slice(1);
  });
  const mainL = w.L.slice(0, firstMark);

  // endereço sem dizer "endereço": "na Rua X, 120", "na Avenida Y 1000"
  if (!location) {
    const m = w.take(/\b(?:n[ao]s?|em)\s+((?:rua|r\.|avenida|av\.?|alameda|estrada|rodovia|praca|travessa|largo)\s+[^,]+?(?:,?\s*(?:n[º°o.]?\s*)?\d+)?(?:,\s*[^,\d\u0000]+?)?)(?=\s+(?:as|a partir|das|de \d|hoje|amanha|no dia|dia \d|para|pra)\b|[.;]|[,\s]*\u0000|\s*$)/);
    if (m) location = w.orig(m, 1).replace(/[.,;\s]+$/, '');
  }
  if (!url) {
    const m = w.take(/\b(https?:\/\/\S+|www\.\S+|[a-z0-9-]+\.(?:com|net|org|io)(?:\.br)?(?:\/\S*)?)/);
    if (m) url = w.orig(m, 1).replace(/[.,;]+$/, '');
  }

  // 2) repetição
  let recurrence: Recurrence | null = null;
  let recWeekday: number | null = null;
  const rec = w.take(/\b(todo dia|todos os dias|diariamente|toda semana|semanalmente|todo mes|mensalmente|todo ano|anualmente|tod[ao]s? (?:as |os )?(domingo|segunda|terca|quarta|quinta|sexta|sabado)s?(?:-feiras?)?)\b/);
  if (rec) {
    const r = rec[1];
    recurrence = /dia|diaria/.test(r) ? 'daily' : /mes|mensal/.test(r) ? 'monthly' : /ano|anual/.test(r) ? 'yearly' : 'weekly';
    if (rec[2]) recWeekday = WD.indexOf(rec[2]);
  }

  // 3) horário
  const T = String.raw`(?<hA>\d{1,2})(?:\s*(?::|h)\s*(?<mA>\d{2}))?\s*(?:horas?|hs|h)?`;
  const T2 = String.raw`(?<hB>\d{1,2})(?:\s*(?::|h)\s*(?<mB>\d{2}))?\s*(?:horas?|hs|h)?`;
  const PA = String.raw`(?:\s*(?:da|de)\s*(?<pA>manha|tarde|noite|madrugada))?`;
  const PB = String.raw`(?:\s*(?:da|de)\s*(?<pB>manha|tarde|noite|madrugada))?`;
  let start: string | null = null, end: string | null = null;
  const range = w.take(new RegExp(String.raw`\b(?:das|de|entre)\s+${T}${PA}\s*(?:as|a|ate|e)\s+${T2}${PB}`));
  if (range?.groups) {
    const g = range.groups;
    start = toTime(+g.hA, +(g.mA ?? 0), g.pA ?? g.pB);
    end = toTime(+g.hB, +(g.mB ?? 0), g.pB);
  } else {
    const one = w.take(new RegExp(String.raw`\b(?:as|a partir das|por volta das|la pelas|umas|ao|a)\s+${T}${PA}`))
      ?? w.take(new RegExp(String.raw`\b(?<hA>\d{1,2})\s*(?:\s*horas?\b|:(?<mA>\d{2})|h(?<mA2>\d{2})?\b)${PA}`));
    if (one?.groups) start = toTime(+one.groups.hA, +(one.groups.mA ?? one.groups.mA2 ?? 0), one.groups.pA);
  }

  // 4) data
  let date: string | null = null;
  let m: RegExpMatchArray | null;
  if ((m = w.take(/\b(?:para |pra )?depois de amanha\b/))) date = addDays(2);
  else if ((m = w.take(/\b(?:para |pra )?amanha\b/))) date = addDays(1);
  else if ((m = w.take(/\b(?:para |pra )?hoje\b/))) date = addDays(0);
  else if ((m = w.take(/\b(?:(?:no |para o |pra )?dia\s+)?(\d{1,2})\s*(?:\/|de\s+)(\d{1,2}|janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s*(?:\/|de\s+)(\d{2,4}))?\b/))) {
    const d = +m[1];
    const mo = /\d/.test(m[2]) ? +m[2] : MONTHS.indexOf(m[2]) + 1;
    let y = m[3] ? +m[3] : today.getFullYear();
    if (y < 100) y += 2000;
    if (!m[3] && new Date(y, mo - 1, d) < today) y++;
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) date = `${y}-${pad(mo)}-${pad(d)}`;
  } else if ((m = w.take(/\b(?:no |para o |pra )?dia\s+(\d{1,2})\b/))) {
    const d = +m[1];
    let y = today.getFullYear(), mo = today.getMonth() + 1;
    if (d < today.getDate()) { mo++; if (mo > 12) { mo = 1; y++; } }
    date = `${y}-${pad(mo)}-${pad(d)}`;
  } else if ((m = w.take(/\b(n[ao]\s+|nest[ae]\s+|(?:n[ao]\s+)?proxim[ao]\s+|para\s+(?:[ao]\s+)?|pra\s+)?(domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:-feira| feira)?\b/))) {
    const n = WD.indexOf(m[2]);
    let diff = (n - today.getDay() + 7) % 7;
    if (diff === 0) diff = 7;
    date = addDays(diff);
  } else if (recWeekday !== null) {
    date = addDays((recWeekday - today.getDay() + 7) % 7);
  }

  // 5) de quem
  let who: VoiceEvent['who'] = null;
  if (w.take(/\b(?:da|pela|na|para a|pra)\s+(?:cbs(?: engenharia)?|empresa)\b/) || w.take(/\bcbs(?: engenharia)?\b/)) who = 'cbs';
  else if (w.take(/\b(?:para |pra )?(?:nos dois|os dois|todos|todo mundo|a familia toda|a familia)\b/)) who = 'both';
  else {
    const pm = w.take(/\b(?:para|pra)\s+(?:a\s+|o\s+)?(kamila|camila|joao(?: pedro)?|mim)\b/);
    if (pm) who = pm[1] === 'camila' ? 'kamila' : pm[1] === 'mim' ? 'me' : pm[1];
  }

  // 6) tipo (pelo que foi dito antes das observações)
  let category: VoiceEvent['category'] = null;
  if (/\b(entrega|entregar|prazo|enviar (o )?projeto|aprovacao)\b/.test(mainL)) category = 'entrega';
  else if (/\b(cliente|reuniao com|visita tecnica|obra)\b/.test(mainL)) category = 'cliente';
  else if (/\b(escritorio|trabalho|expediente)\b/.test(mainL)) category = 'escritorio';
  else if (/\b(aniversario|familia|igreja|culto)\b/.test(mainL)) category = 'familia';
  else if (/\b(casa|mudanca|faxina|conserto|manutencao|diarista)\b/.test(mainL)) category = 'casa';
  else if (/\b(medico|consulta|exame|dentista|terapia|academia|cabeleireiro|manicure|pediatra|vacina)\b/.test(mainL)) category = 'pessoal';
  const isTask = /^\s*(tarefa|lembrar de|lembrete|preciso|tenho que)\b/.test(w.L);
  const undated = !!w.take(/\b(sem data( definida)?|sem prazo|data a definir|a definir|quando der|em aberto)\b/);

  // 7) título = o que sobrou
  let title = w.rest()
    .replace(/^(?:(?:marcar|marca|agendar|agenda|criar|cria|adicionar|anotar|anota|colocar|coloca|novo|nova|um|uma|compromisso|evento|tarefa|lembrete|lembrar de|tenho que|tenho|preciso|vou ter|vou)\b[\s:,-]*)+/i, '')
    .replace(/(\s+(?:no|na|nos|nas|em|de|do|da|para|pra|com|e|às|as|a|o|ao|dia|no dia))+\s*[,.;]?\s*$/i, '')
    .replace(/\s+([,.;])/g, '$1')
    .replace(/^[,.;:\s-]+|[,.;:\s-]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (title) title = title.charAt(0).toUpperCase() + title.slice(1);

  const finalLocation = url ?? location;
  const extra = url && location ? `Endereço: ${location}` : null;
  return {
    title, date, start, end, location: finalLocation,
    notes: [extra, notes].filter(Boolean).join('. ') || null,
    who, category, recurrence, isTask, undated: undated && !date && !start,
  };
}

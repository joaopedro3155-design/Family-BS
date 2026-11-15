// Funções puras usadas com as respostas do Claude (testáveis sem servidor).
export interface NewsItem { titulo: string; resumo: string; fontes: { titulo: string; url: string }[] }

/** Pega o primeiro JSON (objeto ou lista) que aparecer no texto. */
export function extractJson<T>(text: string): T {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const src = fence ? fence[1] : text;
  const start = src.search(/[[{]/);
  if (start < 0) throw new Error('Resposta sem JSON');
  const open = src[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0; let inStr = false; let esc = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0) return JSON.parse(src.slice(start, i + 1)) as T; }
  }
  throw new Error('JSON incompleto');
}

/** Mantém só fontes que vieram de fato da busca (evita links inventados). */
export function filterSourced(items: NewsItem[], urls: Set<string>): NewsItem[] {
  const norm = (u: string) => u.replace(/^https?:\/\/(www\.)?/, '').replace(/[#?].*$/, '').replace(/\/$/, '');
  const known = new Set(Array.from(urls).map(norm));
  return items
    .map((i) => ({ ...i, fontes: (i.fontes ?? []).filter((f) => f.url && (urls.size === 0 ? false : known.has(norm(f.url)))) }))
    .filter((i) => i.fontes.length > 0);
}


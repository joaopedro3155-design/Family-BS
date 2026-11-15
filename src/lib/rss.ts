// Leitura de feeds RSS gratuitos (Google Notícias e outros), sem IA e sem custo.

export interface Headline { title: string; link: string; source: string | null; published: string | null }

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
    .trim();
}

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decode(m[1]) : null;
}

export function parseRss(xml: string): Headline[] {
  const out: Headline[] = [];
  const re = /<item[\s>][\s\S]*?<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const b = m[0];
    let title = tag(b, 'title') ?? '';
    let source = tag(b, 'source');
    // Google Notícias põe " - Veículo" no fim do título
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    else if (!source) { const g = title.match(/^(.*) - ([^-]{2,40})$/); if (g) { title = g[1]; source = g[2]; } }
    const link = tag(b, 'link') ?? '';
    const pub = tag(b, 'pubDate');
    if (title && link) out.push({ title: title.trim(), link, source: source?.trim() ?? null, published: pub ? new Date(pub).toISOString() : null });
  }
  return out;
}

const GN = 'hl=pt-BR&gl=BR&ceid=BR:pt-419';
export const gnSearch = (q: string) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&${GN}`;

/** Feeds por categoria. {cidade} vira a cidade da família. */
export const NEWS_FEEDS: Record<string, { label: string; feeds: string[] }> = {
  principais: { label: 'Principais', feeds: [`https://news.google.com/rss?${GN}`] },
  jundiai: { label: '{cidade}', feeds: [gnSearch('{cidade} when:3d')] },
  financas: { label: 'Finanças', feeds: [gnSearch('(Selic OR Ibovespa OR IPCA OR dólar OR "renda fixa" OR "Tesouro Direto") when:2d')] },
  descontos: { label: 'Descontos', feeds: [gnSearch('(promoção OR ofertas OR cupom) (supermercado OR farmácia OR {cidade}) when:4d')] },
  engenharia: { label: 'Engenharia', feeds: [gnSearch('("engenharia estrutural" OR "NBR 6118" OR "concreto protendido" OR "estrutura metálica" OR "norma ABNT" construção) when:14d')] },
  direito: { label: 'Direito', feeds: [gnSearch('(TST OR INSS OR previdenciário OR "direito do trabalho" OR trabalhista) decisão when:3d')] },
  politica: { label: 'Política', feeds: [gnSearch('(Congresso OR Senado OR "Câmara dos Deputados" OR Planalto OR "governo de São Paulo") when:1d')] },
  esportes: { label: 'Esportes', feeds: [`https://news.google.com/rss/headlines/section/topic/SPORTS?${GN}`] },
};

/** Junta feeds, tira repetidos e ordena do mais novo para o mais antigo. */
export function mergeHeadlines(lists: Headline[][], max = 25): Headline[] {
  const seen = new Set<string>();
  const all = lists.flat().filter((h) => {
    const k = h.title.toLowerCase().replace(/\W+/g, ' ').slice(0, 80);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  all.sort((a, b) => (b.published ?? '').localeCompare(a.published ?? ''));
  return all.slice(0, max);
}

import 'server-only';
import { extractJson, filterSourced, type NewsItem } from './ai-utils';

export type { NewsItem };

// Chamadas ao Claude (API da Anthropic). A chave fica só no servidor: ANTHROPIC_API_KEY.
const API = 'https://api.anthropic.com/v1/messages';

export function claudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

type Block = { type: string; text?: string; content?: unknown; [k: string]: unknown };

export interface ClaudeResult { text: string; blocks: Block[]; searchUrls: Set<string> }

export async function callClaude(opts: {
  system: string;
  content: unknown; // string ou blocos (texto + imagem)
  maxTokens?: number;
  webSearch?: { maxUses: number; city?: string; region?: string };
  model?: string;
}): Promise<ClaudeResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('Claude não configurado (ANTHROPIC_API_KEY).');
  const body: Record<string, unknown> = {
    model: opts.model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
    max_tokens: opts.maxTokens ?? 2000,
    system: opts.system,
    messages: [{ role: 'user', content: opts.content }],
  };
  if (opts.webSearch) {
    body.tools = [{
      type: process.env.ANTHROPIC_WEB_SEARCH_TOOL || 'web_search_20250305',
      name: 'web_search',
      max_uses: opts.webSearch.maxUses,
      user_location: { type: 'approximate', city: opts.webSearch.city || 'Jundiaí', region: opts.webSearch.region || 'São Paulo', country: 'BR', timezone: 'America/Sao_Paulo' },
    }];
  }
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': process.env.ANTHROPIC_VERSION || '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude respondeu ${res.status}: ${err.slice(0, 300)}`);
  }
  const data = (await res.json()) as { content: Block[] };
  const blocks = data.content ?? [];
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
  const searchUrls = new Set<string>();
  for (const b of blocks) {
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
      for (const r of b.content as { url?: string }[]) if (r.url) searchUrls.add(r.url);
    }
    if (b.type === 'text' && Array.isArray(b.citations)) {
      for (const c of b.citations as { url?: string }[]) if (c.url) searchUrls.add(c.url);
    }
  }
  return { text, blocks, searchUrls };
}

// ---------------------------------------------------------------------
// Lançamento por mensagem
// ---------------------------------------------------------------------
export interface Interpreted {
  tipo: 'receita' | 'despesa';
  conta: 'PF' | 'PJ';
  valor: number | null;
  descricao: string;
  categoria: string | null;
  forma_pagamento: 'credito' | 'debito' | 'pix' | 'dinheiro' | 'boleto' | 'transferencia' | null;
  parcelas: number;
  data: string; // YYYY-MM-DD
  quem: string | null;
  itens_estoque: { nome: string; quantidade: number }[];
}

export async function interpretMessage(text: string, ctx: { today: string; categoriesPF: string[]; categoriesPJ: string[]; members: string[]; pjName: string }): Promise<Interpreted> {
  const system = `Você transforma mensagens curtas de uma família brasileira em lançamentos financeiros. Responda APENAS um JSON, sem comentários.
Hoje é ${ctx.today} (fuso America/Sao_Paulo). Membros: ${ctx.members.join(', ')}. Empresa (conta PJ): ${ctx.pjName}.
Categorias da família (PF): ${ctx.categoriesPF.join(' | ')}
Categorias da empresa (PJ): ${ctx.categoriesPJ.join(' | ')}
Formato: {"tipo":"despesa|receita","conta":"PF|PJ","valor":number|null,"descricao":string,"categoria":string|null (copie exatamente uma das categorias da conta escolhida, ou null),"forma_pagamento":"credito|debito|pix|dinheiro|boleto|transferencia"|null,"parcelas":number,"data":"YYYY-MM-DD","quem":nome do membro ou null,"itens_estoque":[{"nome":string,"quantidade":number}]}
Regras: conta PJ só se a mensagem falar da empresa, de cliente/projeto da empresa ou de imposto/contador da empresa. "ontem" = um dia antes de hoje. Valores em reais com vírgula decimal ("87,50" = 87.5). itens_estoque só quando a mensagem citar produtos de mercado, higiene ou casa com quantidade (senão lista vazia).`;
  const r = await callClaude({ system, content: text, maxTokens: 600, model: process.env.ANTHROPIC_MODEL_FAST || undefined });
  const j = extractJson<Interpreted>(r.text);
  j.parcelas = Math.max(1, Number(j.parcelas) || 1);
  j.itens_estoque = Array.isArray(j.itens_estoque) ? j.itens_estoque : [];
  return j;
}

// ---------------------------------------------------------------------
// Comprovante (foto) ou texto da página da NFC-e
// ---------------------------------------------------------------------
export interface ReceiptData {
  loja: string | null;
  cnpj: string | null;
  cidade: string | null;
  data: string | null;
  total: number | null;
  forma_pagamento: string | null;
  categoria_sugerida: string | null;
  itens: { nome: string; quantidade: number; unidade: string | null; preco_unitario: number | null; total: number | null }[];
}

const RECEIPT_FORMAT = `{"loja":string|null,"cnpj":string|null,"cidade":string|null,"data":"YYYY-MM-DD"|null,"total":number|null,"forma_pagamento":"credito|debito|pix|dinheiro|boleto|transferencia"|null,"categoria_sugerida":string|null,"itens":[{"nome":string,"quantidade":number,"unidade":string|null,"preco_unitario":number|null,"total":number|null}]}`;

export async function readReceipt(input: { imageBase64?: string; mediaType?: string; pageText?: string }, categoriesPF: string[]): Promise<ReceiptData> {
  const system = `Você lê comprovantes e cupons fiscais brasileiros (NFC-e, recibos, comprovantes de cartão e Pix). Responda APENAS um JSON no formato ${RECEIPT_FORMAT}.
categoria_sugerida deve ser exatamente uma destas (ou null): ${categoriesPF.join(' | ')}.
Números com ponto decimal. Se for comprovante sem itens (cartão/Pix), itens = []. Não invente itens ilegíveis.`;
  const content = input.imageBase64
    ? [
        { type: 'image', source: { type: 'base64', media_type: input.mediaType || 'image/jpeg', data: input.imageBase64 } },
        { type: 'text', text: 'Leia este comprovante.' },
      ]
    : `Texto da página da nota fiscal:\n\n${(input.pageText ?? '').slice(0, 15000)}`;
  const r = await callClaude({ system, content, maxTokens: 3000 });
  const j = extractJson<ReceiptData>(r.text);
  j.itens = Array.isArray(j.itens) ? j.itens : [];
  return j;
}

// ---------------------------------------------------------------------
// Notícias com pesquisa na web
// ---------------------------------------------------------------------
export const NEWS_CATEGORIES: Record<string, { label: string; prompt: string; searches: number }> = {
  principais: { label: 'Principais', prompt: 'as notícias mais importantes do Brasil e do mundo hoje', searches: 4 },
  financas: { label: 'Finanças', prompt: 'economia e mercado financeiro no Brasil: Selic, inflação (IPCA), Ibovespa, dólar, renda fixa, fundos imobiliários e imposto de renda de pessoa física', searches: 4 },
  descontos: { label: 'Descontos', prompt: 'promoções e cupons válidos agora em supermercados, farmácias e lojas online com entrega em {cidade}/{estado}; inclua só ofertas com fonte e prazo', searches: 4 },
  engenharia: { label: 'Engenharia', prompt: 'engenharia estrutural no Brasil: normas ABNT (NBR 6118, 8800, 6122, 15575 e outras) em revisão ou consulta pública, concreto armado e protendido, estruturas metálicas, softwares BIM e de cálculo estrutural, mercado da construção', searches: 4 },
  direito: { label: 'Direito', prompt: 'direito do trabalho e previdenciário no Brasil: decisões do TST, STF e STJ, súmulas e teses, regras e prazos do INSS, mudanças legislativas', searches: 4 },
  politica: { label: 'Política', prompt: 'política brasileira: Congresso, governo federal e governo de São Paulo, com fontes de linhas editoriais variadas e tom neutro', searches: 3 },
  esportes: { label: 'Esportes', prompt: 'esportes no Brasil: principais resultados e próximos jogos', searches: 3 },
};


export async function researchNews(category: string, ctx: { today: string; city: string; region: string; extra?: string | null }): Promise<NewsItem[]> {
  const cat = NEWS_CATEGORIES[category];
  if (!cat) throw new Error('categoria desconhecida');
  const topic = cat.prompt.replace('{cidade}', ctx.city).replace('{estado}', ctx.region);
  const system = `Você é um editor de notícias que pesquisa na web e resume em português do Brasil, com neutralidade.
Hoje é ${ctx.today}. Use a ferramenta de busca. Só inclua fatos que aparecem nas fontes encontradas, de preferência das últimas 48 horas (descontos: ainda válidos).
No final, responda APENAS um JSON: {"itens":[{"titulo":string,"resumo":"2 a 3 frases com suas palavras, sem copiar trechos","fontes":[{"titulo":string,"url":string}]}]} com 4 a 6 itens. Cada item precisa de pelo menos uma fonte com a URL exata de um resultado da busca.`;
  const r = await callClaude({
    system,
    content: `Pesquise e resuma: ${topic}.${ctx.extra ? ` Interesses extras da família: ${ctx.extra}.` : ''}`,
    maxTokens: 3500,
    webSearch: { maxUses: cat.searches, city: ctx.city, region: ctx.region },
  });
  const j = extractJson<{ itens: NewsItem[] }>(r.text);
  return filterSourced(j.itens ?? [], r.searchUrls);
}

// ---------------------------------------------------------------------
// Resumo semanal de investimentos
// ---------------------------------------------------------------------
export interface InvestmentBrief {
  resumo: string;
  indicadores: { nome: string; valor: string; comentario: string }[];
  carteira: string;
  ideias: { curto: string[]; medio: string[]; longo: string[] };
  fontes: { titulo: string; url: string }[];
}

export async function investmentBrief(ctx: { today: string; risk: string; goals: string | null; allocation: string }): Promise<InvestmentBrief> {
  const system = `Você prepara um resumo semanal EDUCATIVO de investimentos para uma família brasileira (não é recomendação individual; não indique ativos específicos para comprar; fale de classes de ativos e critérios).
Hoje é ${ctx.today}. Use a busca na web para os indicadores atuais (Selic, IPCA 12 meses, Ibovespa, dólar, CDI) e para os fatos da semana.
Responda APENAS um JSON: {"resumo":"3 a 4 frases sobre a semana","indicadores":[{"nome":string,"valor":string,"comentario":string}],"carteira":"2 a 3 frases sobre como a semana afeta a alocação informada","ideias":{"curto":[string],"medio":[string],"longo":[string]},"fontes":[{"titulo":string,"url":string}]}. Fontes com URLs exatas dos resultados da busca.`;
  const r = await callClaude({
    system,
    content: `Perfil: ${ctx.risk}. Objetivos: ${ctx.goals || 'não informados'}. Alocação atual (percentuais por classe): ${ctx.allocation || 'não informada'}.`,
    maxTokens: 3000,
    webSearch: { maxUses: 5 },
  });
  const j = extractJson<InvestmentBrief>(r.text);
  const urls = r.searchUrls;
  j.fontes = filterSourced([{ titulo: '', resumo: '', fontes: j.fontes ?? [] }], urls)[0]?.fontes ?? [];
  return j;
}

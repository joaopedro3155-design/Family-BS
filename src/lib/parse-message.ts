import type { Category } from './types';
import { parseMoney } from './format';

export interface ParsedMessage {
  amount: number | null;
  payment_method: string | null;
  installments: number;
  category_id: string | null;
  tipo: 'receita' | 'despesa';
  description: string;
}

const KEYWORDS: Record<string, string[]> = {
  supermercado: ['mercado', 'supermercado', 'atacad'],
  'feira / padaria': ['feira', 'padaria', 'pão'],
  'açougue': ['açougue', 'acougue', 'carne'],
  restaurantes: ['restaurante', 'almoço', 'almoco', 'jantar', 'lanche', 'pizza', 'hamburguer'],
  'ifood/app': ['ifood', 'delivery', 'rappi'],
  'combustível': ['gasolina', 'combustível', 'combustivel', 'posto', 'etanol'],
  'táxi / uber': ['uber', 'taxi', 'táxi', '99'],
  'estacionamento/sem parar': ['estacionamento', 'sem parar', 'pedágio', 'pedagio'],
  'exames / farmácia': ['farmácia', 'farmacia', 'remédio', 'remedio', 'drogaria'],
  presentes: ['presente'],
  luz: ['luz', 'energia', 'enel', 'cpfl'],
  'água': ['água', 'agua', 'dae', 'sabesp'],
  'gás': ['gás', 'gas', 'botijão'],
};

/** Lê frases como "gastei 87,50 no mercado no crédito em 3x" (sem IA — a IA entra na Fase 2). */
export function parseMessage(text: string, categories: Category[]): ParsedMessage {
  const t = text.toLowerCase();
  const num = t.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})|\d+(?:[.,]\d{1,2})?)/);
  const amount = num ? parseMoney(num[1]) : null;
  let payment_method: string | null = null;
  if (/cr[eé]dito|cart[aã]o/.test(t)) payment_method = 'credito';
  else if (/d[eé]bito/.test(t)) payment_method = 'debito';
  else if (/\bpix\b/.test(t)) payment_method = 'pix';
  else if (/dinheiro|esp[eé]cie/.test(t)) payment_method = 'dinheiro';
  else if (/boleto/.test(t)) payment_method = 'boleto';
  const parc = t.match(/(\d{1,2})\s*x\b|em\s+(\d{1,2})\s+vezes/);
  const installments = parc ? Number(parc[1] || parc[2]) : 1;
  const tipo = /recebi|entrou|ganhei|pagamento de cliente/.test(t) ? 'receita' : 'despesa';

  let category_id: string | null = null;
  const pool = categories.filter((c) => c.tipo === tipo && !c.archived);
  // 1) nome da categoria aparece na frase
  for (const c of pool) {
    if (t.includes(c.name.toLowerCase())) { category_id = c.id; break; }
  }
  // 2) palavras-chave
  if (!category_id) {
    for (const [name, words] of Object.entries(KEYWORDS)) {
      if (words.some((w) => t.includes(w))) {
        const c = pool.find((x) => x.name.toLowerCase() === name);
        if (c) { category_id = c.id; break; }
      }
    }
  }
  return { amount: amount && !Number.isNaN(amount) ? amount : null, payment_method, installments: Math.max(1, installments), category_id, tipo, description: text.trim() };
}

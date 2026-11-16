export type Kind = 'PF' | 'PJ';
export type Tipo = 'receita' | 'despesa';

export interface Member {
  household_id: string;
  user_id: string;
  display_name: string;
  color: string;
  role: 'admin' | 'membro';
}

export interface Account {
  id: string;
  household_id: string;
  name: string;
  kind: Kind;
}

export interface Category {
  id: string;
  household_id: string;
  account_id: string;
  grupo: string;
  name: string;
  tipo: Tipo;
  monthly_limit: number | null;
  archived: boolean;
}

export interface Transaction {
  id: string;
  household_id: string;
  account_id: string;
  category_id: string | null;
  tipo: Tipo;
  amount: number;
  occurred_on: string;
  description: string | null;
  payment_method: string | null;
  installments: number;
  installment_no: number;
  installment_group: string | null;
  spent_by: string | null;
  recurring_id: string | null;
  source: string;
  is_profit_transfer: boolean;
}

export interface RecurringBill {
  id: string;
  household_id: string;
  account_id: string;
  category_id: string | null;
  name: string;
  tipo: Tipo;
  amount: number | null;
  variable: boolean;
  frequency: 'mensal' | 'anual';
  due_day: number | null;
  due_month: number | null;
  remind_days_before: number;
  active: boolean;
}

export interface EventItem {
  id: string;
  household_id: string;
  title: string;
  notes: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  owner_user: string | null;
  company: boolean;
  created_by?: string | null;
  recurrence: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
  recurrence_interval: number;
  recurrence_until: string | null;
  is_task: boolean;
  category: 'cliente' | 'escritorio' | 'casa' | 'pessoal' | 'familia' | 'entrega';
  reminders: number[];
}

export const PAYMENT_METHODS: { id: string; label: string }[] = [
  { id: 'credito', label: 'Crédito' },
  { id: 'debito', label: 'Débito' },
  { id: 'pix', label: 'Pix' },
  { id: 'dinheiro', label: 'Dinheiro' },
  { id: 'boleto', label: 'Boleto' },
  { id: 'transferencia', label: 'Transferência' },
];

export const EVENT_CATEGORIES: { id: EventItem['category']; label: string }[] = [
  { id: 'entrega', label: 'Entrega de projeto' },
  { id: 'cliente', label: 'Cliente' },
  { id: 'escritorio', label: 'Escritório' },
  { id: 'familia', label: 'Família' },
  { id: 'casa', label: 'Casa' },
  { id: 'pessoal', label: 'Pessoal' },
];

export const NEWS_LABELS: { id: string; label: string }[] = [
  { id: 'principais', label: 'Principais' },
  { id: 'financas', label: 'Finanças' },
  { id: 'descontos', label: 'Descontos' },
  { id: 'engenharia', label: 'Engenharia' },
  { id: 'direito', label: 'Direito' },
  { id: 'politica', label: 'Política' },
  { id: 'esportes', label: 'Esportes' },
];

export const ASSET_CLASSES: { id: string; label: string; color: string }[] = [
  { id: 'reserva', label: 'Reserva', color: '#A8A29E' },
  { id: 'renda_fixa', label: 'Renda fixa', color: '#E8590C' },
  { id: 'fii', label: 'Fundos imobiliários', color: '#57524C' },
  { id: 'acoes', label: 'Ações', color: '#F59F00' },
  { id: 'previdencia', label: 'Previdência', color: '#9C6644' },
  { id: 'cripto', label: 'Cripto', color: '#D6336C' },
  { id: 'outros', label: 'Outros', color: '#78716C' },
];

/** Ordem das categorias igual à planilha (as subcategorias ficam dentro de cada uma). */
export const GROUP_ORDER = ['Receitas', 'Moradia', 'Alimentação', 'Transporte', 'Saúde', 'Educação', 'Filha', 'Lazer', 'Cuidados Pessoais', 'Vestuário', 'Pet', 'Animal Estimação', 'Despesas Bancárias', 'Gratidão', 'Investimento', 'Despesas gerais', 'Outros'];
export const groupRank = (g: string) => { const i = GROUP_ORDER.indexOf(g); return i < 0 ? 90 : i; };
export const sortGroups = (gs: string[]) => [...new Set(gs)].sort((a, b) => groupRank(a) - groupRank(b) || a.localeCompare(b, 'pt-BR'));

// Leitura de cupom a partir do texto (OCR feito no próprio celular) e
// separação dos itens nas categorias da família. Sem custo de API.
import type { ReadReceiptResponse, ReceiptItem } from './stock';

export type StoreKind = 'posto' | 'padaria' | 'acougue' | 'mercado' | 'farmacia' | 'pet' | 'restaurante' | null;

/** Grupos de itens → padrão do nome da categoria (igual à planilha). */
export const BUCKETS = {
  combustivel: { label: 'Combustível', cat: /combust/i },
  acougue: { label: 'Açougue', cat: /a[çc]ougue/i },
  padaria: { label: 'Padaria', cat: /padaria/i },
  feira: { label: 'Feira / hortifrúti', cat: /feira|hortifr/i },
  mercado: { label: 'Supermercado', cat: /supermercado|mercado/i },
  farmacia: { label: 'Farmácia', cat: /farm[aá]cia|exames/i },
  pet: { label: 'Pet', cat: /ra[çc][aã]o|pet/i },
  bebe: { label: 'Bebê', cat: /beb[eê]|fralda/i },
  restaurante: { label: 'Restaurante', cat: /restaurante|lanche|ifood/i },
} as const;
export type Bucket = keyof typeof BUCKETS;

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

const KW: [Bucket, RegExp][] = [
  ['combustivel', /\b(GASOLINA|ETANOL|ALCOOL\s*(COMUM|HIDRAT)|DIESEL|GNV|ADITIVAD|COMBUST)/],
  ['acougue', /\b(CARNE|BOVIN|SUIN|FRANGO|PEITO|COXA|SOBRECOXA|ASA\b|FILE|FILET|ALCATRA|PICANHA|PATINHO|ACEM|COXAO|MUSCULO|CUPIM|FRALDINHA|CONTRA\s*FILE|COSTELA|MAMINHA|MIOLO|MOIDA|LINGUICA|BACON|PERNIL|LOMBO|BISTECA|CALABRESA|PEIXE|TILAPIA|SALMAO|SARDINHA\s*FRESCA|CAMARAO|ACOUGUE|HAMBURGUER|ALMONDEGA|MIUDO|FIGADO|CORACAO)/],
  ['padaria', /\b(PAO|PAES|BAGUETE|BISNAGA|CROISSANT|SONHO|BOLO|ROSCA|BROA|SALGADO|COXINHA|ESFIHA|PAO\s*DE\s*QUEIJO|TORTA|CUCA|BISCOITO\s*CASEIRO|PADARIA|FRANCES|CAFE\s*EXPRESSO|PINGADO)/],
  ['feira', /\b(TOMATE|ALFACE|CEBOLA|ALHO|BATATA|CENOURA|BETERRABA|ABOBRINHA|ABOBORA|BERINJELA|PIMENTAO|PEPINO|CHUCHU|QUIABO|VAGEM|BROCOLIS|COUVE|REPOLHO|RUCULA|AGRIAO|ESPINAFRE|CHEIRO\s*VERDE|SALSINHA|CEBOLINHA|COENTRO|MANDIOCA|AIPIM|INHAME|BANANA|MACA\b|MACA\s|LARANJA|LIMAO|MAMAO|MELAO|MELANCIA|ABACAXI|UVA|MORANGO|MANGA|PERA|GOIABA|KIWI|ABACATE|MARACUJA|TANGERINA|MEXERICA|PONKAN|LEGUME|VERDURA|FRUTA|HORTI|FLV|OVOS?\b)/],
  ['farmacia', /\b(DIPIRONA|PARACETAMOL|IBUPROFENO|DORFLEX|NOVALGINA|VITAMINA|REMEDIO|COMPRIMIDO|CAPSULA|XAROPE|POMADA|SORO\s*FISIO|DRAGEA|\d+\s*MG\b)/],
  ['pet', /\b(RACAO|PETISCO|AREIA\s*(SANIT|GATO)|GRANULADO\s*SANIT|PEDIGREE|WHISKAS|GOLDEN|PREMIER|SPECIAL\s*DOG|PET\b)/],
  ['bebe', /\b(FRALDA|LENCO\s*UMED|POMPOM|PAMPERS|HUGGIES|MAMADEIRA|CHUPETA|LEITE\s*(EM\s*PO\s*)?(NAN|APTAMIL|INFANT)|NESTOGENO|MUCILON|PAPINHA)/],
];

/** Em qual grupo cai um item do cupom. */
export function classifyItem(name: string, storeKind: StoreKind = null): Bucket {
  const n = strip(name);
  for (const [b, re] of KW) if (re.test(n)) return b;
  if (storeKind === 'posto') return /\b(LITRO|LT|L\b)/.test(n) ? 'combustivel' : 'mercado';
  if (storeKind === 'padaria') return 'padaria';
  if (storeKind === 'acougue') return 'acougue';
  if (storeKind === 'farmacia') return 'farmacia';
  if (storeKind === 'pet') return 'pet';
  if (storeKind === 'restaurante') return 'restaurante';
  return 'mercado';
}

/** Tipo de estabelecimento pelo cabeçalho/texto do cupom. */
export function detectStore(text: string): StoreKind {
  const t = strip(text);
  if (/\b(AUTO\s*POSTO|POSTO\s|COMBUSTIVE|SHELL|IPIRANGA|PETROBRAS|BR\s*MANIA|RAIZEN|ALE\s*COMB|GASOLINA|ETANOL|BICO\s*\d|BOMBA\s*\d|ENCERRANTE)/.test(t)) return 'posto';
  if (/\b(PANIFICADORA|PADARIA|CONFEITARIA|PANIFIC)/.test(t)) return 'padaria';
  if (/\b(ACOUGUE|CASA\s*DE\s*CARNES?|BOUTIQUE\s*DE\s*CARNES?|FRIGORIFICO)/.test(t)) return 'acougue';
  if (/\b(DROGARIA|FARMACIA|DROGA\s*RAIA|DROGASIL|PAGUE\s*MENOS|PACHECO)/.test(t)) return 'farmacia';
  if (/\b(PET\s*SHOP|COBASI|PETZ|AGROPECUARIA)/.test(t)) return 'pet';
  if (/\b(RESTAURANTE|LANCHONETE|PIZZARIA|HAMBURGUERIA|CHURRASCARIA)/.test(t)) return 'restaurante';
  if (/\b(SUPERMERCADO|MERCADO|ATACAD|ASSAI|CARREFOUR|EXTRA|PAO\s*DE\s*ACUCAR|SONDA|DIA\s*BRASIL|OXXO|SAMS|MAKRO|HORTIFRUTI|SACOLAO|QUITANDA|VAREJAO|ENXUTO|GOOD\s*BOM|COVABRA|SAO\s*VICENTE|JAU\s*SERVE|TENDA)/.test(t)) return 'mercado';
  return null;
}

const MONEY = /(\d{1,3}(?:[.\s]\d{3})*,\d{2}|\d+[.,]\d{2})/g;
const toNum = (s: string) => {
  const t = s.replace(/\s/g, '');
  if (/,\d{2}$/.test(t)) return Number(t.replace(/\./g, '').replace(',', '.'));
  return Number(t.replace(/,/g, ''));
};
const SKIP = /\b(SUB\s*-?TOTAL|TOTAL|TROCO|DESCONTO|DESC\.|ACRESC|VALOR\s*PAGO|VALOR\s*A\s*PAGAR|DINHEIRO|CARTAO|CREDITO|DEBITO|PIX|CNPJ|CPF|INSC|\bIE\b|TRIBUT|LEI\s*\d|ICMS|PIS|COFINS|IBPT|QTD|QTDE|ITENS|ITEM\s*COD|CODIGO|PAGAMENTO|SALDO|APROVAD|AUTORIZ|NSU|\bDOC\b|\bVIA\b|CONSUMIDOR|PROTOCOLO|CHAVE|SERIE|EMISSAO|CAIXA|OPERADOR|VENDEDOR|FONE|TEL\b|RUA|AV\.|AVENIDA|CEP|BAIRRO|ENDERECO|CUPOM|EXTRATO|SAT\b|NFC|DANFE|FORMA|ENCERRANTE|BICO|BOMBA|PLACA|KM\b|MOTORISTA|FRENTISTA)/;

function cleanName(line: string): string {
  return line
    .replace(MONEY, ' ')
    .replace(/\b\d+[.,]?\d*\s*(UN|UND|KG|G|GR|L|LT|LTS|ML|PC|PCT|CX)\b\.?/gi, ' ')
    .replace(/\b[xX*]\b/g, ' ')
    .replace(/^\s*\d{1,4}\s+/, '')
    .replace(/\b\d{3,14}\b/g, ' ')
    .replace(/\s(KG|UN|UND|LT|L|PC|PCT)\s*$/i, ' ')
    .replace(/\b[A-Z]?\d{2}[A-Z]?\b\s*$/, ' ')
    .replace(/[|_=~^"'`#@]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Lê loja, data, total, pagamento e itens do texto do cupom. */
export function parseReceiptText(raw: string): ReadReceiptResponse & { storeKind: StoreKind } {
  const pay = parsePaymentProof(raw);
  if (pay) return pay;
  const lines = raw.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const T = strip(raw);
  const storeKind = detectStore(raw);

  // loja: primeira linha com bastante letras que não seja endereço/CNPJ
  const store = lines.slice(0, 6).find((l) => {
    const u = strip(l);
    return (u.match(/[A-Z]/g)?.length ?? 0) >= 4 && !/CNPJ|CPF|\bIE\b|RUA|AV\.|AVENIDA|CEP|FONE|DOCUMENTO|CUPOM|EXTRATO|DANFE/.test(u);
  }) ?? null;

  const cnpj = raw.match(/\d{2}\.?\d{3}\.?\d{3}\s*\/?\s*\d{4}\s*-?\s*\d{2}/)?.[0].replace(/\D/g, '') ?? null;

  let issuedOn: string | null = null;
  for (const m of raw.matchAll(/(\d{2})[/.-](\d{2})[/.-](\d{2,4})/g)) {
    const d = +m[1], mo = +m[2]; let y = +m[3]; if (y < 100) y += 2000;
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && y >= 2020 && y <= 2100) { issuedOn = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`; break; }
  }

  // total: prioriza "valor a pagar" / "total"; senão o maior valor que não seja troco/pago
  const totalPatterns = [/VALOR\s*A\s*PAGAR/, /VALOR\s*TOTAL/, /TOTAL\s*(A\s*PAGAR|GERAL|R\$)?/, /VL\.?\s*TOTAL/];
  let total: number | null = null;
  for (const re of totalPatterns) {
    for (let i = lines.length - 1; i >= 0; i--) {
      const u = strip(lines[i]);
      if (!re.test(u) || /SUB\s*-?TOTAL|TRIBUT|ITENS|QTD/.test(u)) continue;
      const nums = [...lines[i].matchAll(MONEY), ...(lines[i + 1] ? [...lines[i + 1].matchAll(MONEY)] : [])].map((m) => toNum(m[0])).filter((n) => n > 0 && n < 100000);
      if (nums.length) { total = nums[0]; break; }
    }
    if (total) break;
  }

  let paymentMethod: string | null = null;
  if (/\bPIX\b/.test(T)) paymentMethod = 'pix';
  else if (/DEBITO/.test(T)) paymentMethod = 'debito';
  else if (/CREDITO/.test(T)) paymentMethod = 'credito';
  else if (/DINHEIRO/.test(T)) paymentMethod = 'dinheiro';

  // itens: linha com nome + valor no fim (ou nome numa linha e "qtd x preço  total" na seguinte)
  const items: ReceiptItem[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const u = strip(line);
    if (SKIP.test(u)) continue;
    const prices = [...line.matchAll(MONEY)].map((m) => toNum(m[0]));
    let qtyLine = line;
    let name = cleanName(line);
    let lineTotal: number | null = prices.length ? prices[prices.length - 1] : null;
    if (!lineTotal && (name.match(/[A-Za-zÀ-ú]/g)?.length ?? 0) >= 3 && lines[i + 1]) {
      const next = lines[i + 1];
      const nextLetters = cleanName(next).match(/[A-Za-zÀ-ú]/g)?.length ?? 0;
      const np = [...next.matchAll(MONEY)].map((m) => toNum(m[0]));
      if (np.length && nextLetters < 3 && !SKIP.test(strip(next))) { lineTotal = np[np.length - 1]; i++; qtyLine = next; }
    }
    if (!lineTotal || lineTotal <= 0 || lineTotal > 20000) continue;
    if ((name.match(/[A-Za-zÀ-ú]/g)?.length ?? 0) < 3) continue;
    name = name.replace(/\s*-\s*$/, '');
    const qm = qtyLine.match(/(\d+[.,]?\d*)\s*(UN|UND|KG|L|LT|PC)\s*[xX*]\s*(\d+[.,]\d{2,3})/i);
    const qty = qm ? Number(qm[1].replace(',', '.')) || 1 : 1;
    items.push({ name: name.slice(0, 60), qty, unit: qm ? qm[2].toUpperCase() : null, unitPrice: qm ? toNum(qm[3]) : lineTotal, total: lineTotal });
  }

  if (!total) {
    const sum = items.reduce((s, x) => s + (x.total ?? 0), 0);
    total = sum > 0 ? Math.round(sum * 100) / 100 : null;
  }
  // descarta "itens" que na verdade são o próprio total
  const filtered = items.filter((x) => !(total && x.total === total && items.length > 1));

  return { source: 'foto', accessKey: null, store, cnpj, issuedOn, total, paymentMethod, suggestedCategory: null, items: filtered, storeKind };
}

export interface Split { bucket: Bucket; amount: number; items: string[] }

/** Soma os itens por grupo e acerta a diferença (desconto/itens ilegíveis) no grupo principal. */
export function splitByBucket(items: ReceiptItem[], total: number | null, storeKind: StoreKind): Split[] {
  const map = new Map<Bucket, Split>();
  for (const it of items) {
    const b = classifyItem(it.name, storeKind);
    const s = map.get(b) ?? { bucket: b, amount: 0, items: [] };
    s.amount += it.total ?? 0;
    s.items.push(it.name);
    map.set(b, s);
  }
  const fallback: Bucket = storeKind === 'posto' ? 'combustivel' : storeKind === 'padaria' ? 'padaria' : storeKind === 'acougue' ? 'acougue' : storeKind === 'farmacia' ? 'farmacia' : storeKind === 'pet' ? 'pet' : storeKind === 'restaurante' ? 'restaurante' : 'mercado';
  let list = [...map.values()];
  if (!list.length) return total ? [{ bucket: fallback, amount: total, items: [] }] : [];
  const sum = list.reduce((s, x) => s + x.amount, 0);
  if (total && Math.abs(total - sum) >= 0.01) {
    if (total < sum) {
      // desconto: reduz proporcionalmente
      const f = total / sum;
      list = list.map((x) => ({ ...x, amount: x.amount * f }));
    } else {
      // itens que não deram para ler: vão para o grupo principal da loja
      const main = list.find((x) => x.bucket === fallback) ?? list.sort((a, b) => b.amount - a.amount)[0];
      main.amount += total - sum;
    }
  }
  list = list.map((x) => ({ ...x, amount: Math.round(x.amount * 100) / 100 })).filter((x) => x.amount > 0).sort((a, b) => b.amount - a.amount);
  // fecha centavos de arredondamento
  if (total) { const d = Math.round((total - list.reduce((s, x) => s + x.amount, 0)) * 100) / 100; if (d && list[0]) list[0].amount = Math.round((list[0].amount + d) * 100) / 100; }
  return list;
}

/** Subcategoria provável pelo nome de quem recebeu (conta de luz, água, plano…). */
const PAYEE_RULES: [RegExp, RegExp][] = [
  [/\b(ENEL|CPFL|ELEKTRO|LIGHT\b|CEMIG|COPEL|CELESC|EDP|NEOENERGIA|ENERGISA|COELBA|EQUATORIAL|ENERGIA|ELETROPAULO)/, /^luz$/i],
  [/\b(SABESP|DAE\b|SANASA|SAAE|COPASA|SANEPAR|CEDAE|EMBASA|AGUAS|SANEAMENTO)/, /^[aá]gua$/i],
  [/\b(COMGAS|NATURGY|ULTRAGAZ|LIQUIGAS|SUPERGASBRAS|COPAGAZ|NACIONAL\s*GAS|\bGAS\b)/, /^g[aá]s$/i],
  [/\b(VIVO|TELEFONICA|CLARO|\bTIM\b|\bOI\b|NET\s*SERV|SKY|ALGAR|INTERNET|FIBRA|DESKTOP)/, /celular|internet/i],
  [/\b(ALICE|UNIMED|AMIL|SULAMERICA\s*SAUDE|BRADESCO\s*SAUDE|HAPVIDA|NOTREDAME|PREVENT|PORTO\s*SAUDE|PLANO\s*DE\s*SAUDE)/, /^plano de sa[uú]de$/i],
  [/\b(PRUDENTIAL|SEGURO\s*DE\s*VIDA|MAPFRE\s*VIDA|ICATU)/, /seguro de vida/i],
  [/\b(DETRAN|IPVA|LICENCIAMENTO|SEFAZ.*VEIC)/, /licenciamento|ipva/i],
  [/\b(PORTO\s*SEGURO|AZUL\s*SEGUROS|YOUSE|TOKIO|ALLIANZ|HDI|LIBERTY|SUHAI)/, /seguro carro/i],
  [/\b(IMOBILIARIA|ALUGUEL|LOCACAO|QUINTO\s*ANDAR|QUINTOANDAR|CONDOMINIO)/, /^aluguel$/i],
  [/\b(TOYOTA|BANCO\s*TOYOTA|FINANCIAMENTO|AYMORE|BV\s*FINANC|SANTANDER\s*FINANC)/, /presta[cç][aã]o carro/i],
  [/\b(CONSORCIO|EMBRACON|RODOBENS|PORTO\s*CONSORCIO)/, /cons[oó]rcio/i],
  [/\b(SEM\s*PARAR|CONECTCAR|VELOE|ESTACIONAMENTO|ESTAPAR|ZONA\s*AZUL)/, /estacionamento|sem parar/i],
  [/\b(IFOOD|RAPPI|99\s*FOOD|UBER\s*EATS)/, /ifood/i],
  [/\b(UBER|99\s*(POP|TAXI|TECNOLOGIA)|CABIFY|TAXI)/, /t[aá]xi|uber/i],
  [/\b(NETFLIX|SPOTIFY|DISNEY|HBO|MAX\b|GLOBOPLAY|PRIME\s*VIDEO|DEEZER|YOUTUBE)/, /streaming/i],
  [/\b(SMART\s*FIT|BLUEFIT|BODYTECH|ACADEMIA|SELFIT|TOTALPASS|GYMPASS|WELLHUB)/, /academia/i],
  [/\b(IGREJA|ADVENTISTA|DIZIMO|OFERTA|ASSOC.*IGREJA)/, /d[ií]zimo/i],
  [/\b(PET\s*SHOP|COBASI|PETZ|VETERIN)/, /banho|ra[cç][aã]o/i],
  [/\b(DROGARIA|FARMACIA|DROGA\s*RAIA|DROGASIL|PAGUE\s*MENOS|PACHECO|LABORAT|FLEURY|DASA|LAVOISIER|DELBONI)/, /exames|farm[aá]cia/i],
  [/\b(POSTO|COMBUST|SHELL|IPIRANGA|PETROBRAS)/, /combust/i],
  [/\b(SUPERMERCADO|MERCADO|ATACAD|ASSAI|CARREFOUR|PAO\s*DE\s*ACUCAR|COVABRA|GOOD\s*BOM|SAO\s*VICENTE)/, /supermercado/i],
  [/\b(PADARIA|PANIFIC)/, /padaria/i],
];

/** Padrão do nome da subcategoria sugerida para quem recebeu o pagamento. */
export function payeeCategoryPattern(payee: string): RegExp | null {
  const t = strip(payee);
  for (const [re, cat] of PAYEE_RULES) if (re.test(t)) return cat;
  return null;
}

const LABEL_LINE = /^(PARA|DE|FAVORECIDO|BENEFICIARIO|BENEFICIARIO\s*FINAL|RECEBEDOR|NOME\s*DO\s*RECEBEDOR|DESTINATARIO|DADOS\s*DO\s*RECEBEDOR|QUEM\s*RECEBEU|PAGO\s*PARA|CEDENTE|EMPRESA|RAZAO\s*SOCIAL|NOME)\s*:?\s*(.*)$/;

/** Comprovante de Pix, boleto ou transferência (sem itens). */
export function parsePaymentProof(raw: string): (ReadReceiptResponse & { storeKind: StoreKind }) | null {
  const T = strip(raw);
  const isPix = /\bPIX\b/.test(T) && /(COMPROVANTE|ENVIADO|REALIZADO|TRANSFERENCIA|PAGAMENTO|EFETUAD|CONCLUID)/.test(T);
  const isBoleto = /(BOLETO|LINHA\s*DIGITAVEL|CODIGO\s*DE\s*BARRAS|PAGAMENTO\s*DE\s*(CONTA|TITULO|CONVENIO|CONCESSIONARIA)|CONVENIO|DATA\s*DE\s*VENCIMENTO|VENCIMENTO)/.test(T) && /(COMPROVANTE|PAGAMENTO|PAGO|AUTENTICA)/.test(T);
  const isTed = /(COMPROVANTE\s*DE\s*TRANSFERENCIA|\bTED\b|\bDOC\b\s*ELETR)/.test(T);
  if (!isPix && !isBoleto && !isTed) return null;
  // cupom fiscal com Pix como pagamento continua sendo cupom
  if (/(CUPOM\s*FISCAL|NFC-?E|DANFE|EXTRATO\s*N|SAT\b)/.test(T) && !/COMPROVANTE\s*DE\s*PIX/.test(T)) return null;

  const lines = raw.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);

  // valor: "R$ 183,96" perto de "valor"/topo; senão o primeiro R$
  let total: number | null = null;
  for (let i = 0; i < lines.length && total === null; i++) {
    const u = strip(lines[i]);
    if (/(VALOR|TOTAL|PAGO|R\$)/.test(u) && !/(TARIFA|JUROS|MULTA|DESCONTO|SALDO|LIMITE)/.test(u)) {
      const m = [...lines[i].matchAll(MONEY), ...(/(VALOR|TOTAL)/.test(u) && lines[i + 1] ? [...lines[i + 1].matchAll(MONEY)] : [])][0];
      if (m) total = toNum(m[0]);
    }
  }
  if (total === null) { const m = raw.match(MONEY); if (m) total = toNum(m[0]); }

  // data: prioriza "realizado em", "pago em", "data do pagamento"
  let issuedOn: string | null = null;
  const dated = lines.find((l) => /(REALIZAD|PAGO\s*EM|PAGAMENTO\s*EM|DATA\s*(DO|DA)?\s*(PAGAMENTO|TRANSF|OPERA)|EFETUAD|EM\s*\d{2}\/)/.test(strip(l)) && /\d{2}[/.-]\d{2}[/.-]\d{2,4}/.test(l)) ?? raw;
  const dm = dated.match(/(\d{2})[/.-](\d{2})[/.-](\d{2,4})/) ?? raw.match(/(\d{2})[/.-](\d{2})[/.-](\d{2,4})/);
  if (dm) { let y = +dm[3]; if (y < 100) y += 2000; issuedOn = `${y}-${dm[2]}-${dm[1]}`; }

  // quem recebeu: linha depois de "Para"/"Favorecido"/"Beneficiário"
  let payee: string | null = null;
  for (let i = 0; i < lines.length && !payee; i++) {
    const m = strip(lines[i]).match(LABEL_LINE);
    if (!m || m[1] === 'DE') continue;
    const rest = lines[i].slice(lines[i].length - m[2].length).trim();
    const cand = rest.length >= 3 ? rest : lines[i + 1] ?? '';
    const cu = strip(cand);
    if (cand && !/(CPF|CNPJ|INSTITUI|AGENCIA|CONTA|CHAVE|BANCO\s*:)/.test(cu) && (cu.match(/[A-Z]/g)?.length ?? 0) >= 3) payee = cand.replace(/[|_]/g, '').trim();
  }
  // CNPJ de quem recebeu = o que aparece depois de "Para"
  const paraIdx = lines.findIndex((l) => /^(PARA|FAVORECIDO|BENEFICIARIO|RECEBEDOR|DESTINATARIO)/.test(strip(l)));
  const cnpjSrc = paraIdx >= 0 ? lines.slice(paraIdx).join(' ') : raw;
  const cnpj = cnpjSrc.match(/\b\d{2}\.?\d{3}\.?\d{3}\s*\/?\s*\d{4}\s*-?\s*\d{2}\b/)?.[0].replace(/\D/g, '') ?? null;

  const docType = isPix ? 'pix' : isBoleto ? 'boleto' : 'transferencia';
  const pattern = payeeCategoryPattern(`${payee ?? ''} ${isBoleto ? raw : ''}`);
  return {
    source: 'foto', docType, accessKey: null, store: payee, cnpj, issuedOn, total,
    paymentMethod: docType === 'transferencia' ? 'transferencia' : docType,
    suggestedCategory: pattern ? pattern.source : null, items: [], storeKind: null,
  };
}

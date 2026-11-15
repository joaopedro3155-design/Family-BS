# Family BS — Fases 1 e 2

App instalável (PWA) da família: agenda com lembretes, finanças da família (PF) e da CBS Engenharia (PJ), contas recorrentes, limites de gasto e importação da planilha. Funciona no iPhone (pela Tela de Início) e no computador (pelo navegador).

**O que já funciona nesta fase**
- Entrar com e-mail e código de 6 dígitos (sem senha). Um e-mail basta; a Kamila pode ter o próprio acesso por convite.
- Agenda da família com lembretes no celular (1 dia, 1 hora, 30 ou 10 min antes).
- Finanças: Família (PF) e empresa (PJ), filtro "quem gastou", limites mensais com alerta em 80% e 100%, possíveis vazamentos, gastos por grupo, transferência do lucro da PJ para a família sem contar duas vezes.
- Contas recorrentes (aluguel, carro, plano de saúde, contador, anuais como IPVA e CREA), com aviso antes do vencimento e botão "Lançar".
- Lançar gasto: frase rápida ("gastei 87,50 no mercado no crédito em 3x") ou formulário com categoria, forma de pagamento e parcelas.
- Olho para mostrar/ocultar valores em cada tela (sempre começa oculto).
- Importação do histórico da planilha (abr/2025 a out/2026).

**Fase 2 (já incluída)**
- **Estoque** de comida, higiene, casa, bebê e pet: o app aprende quanto tempo cada item dura (pelas compras e pelo botão “Acabou”) e avisa o que está acabando.
- **Lista de compras**: urgentes vindos do estoque + itens que vocês incluírem, com **exportação para o WhatsApp** (ou compartilhar/copiar).
- **Nota fiscal**: foto do **QR code da NFC-e** (busca itens e preços na SEFAZ) ou foto de qualquer **comprovante** (lido pelo Claude). Lança o gasto, abastece o estoque e marca a lista como comprada.
- **Onde está mais barato**: cada nota alimenta um histórico de preços por loja.
- **Claude**: interpreta mensagens (“gastei 87,50 no mercado no crédito em 3x”), lê comprovantes, pesquisa as **notícias** (com fontes) e faz o **resumo semanal de investimentos** (educativo, com fontes; o Claude recebe só os percentuais da carteira).
- **Bot do Telegram**: mande gasto em texto ou foto do cupom; comandos /hoje, /lista, /estoque e /desfazer.
- **Investimentos**: posições da XP (cadastro manual), alocação por classe, perfil e objetivos.
- **Resumo do dia às 7h** no celular: agenda, contas que vencem e itens acabando.
- **Agenda no Calendário do iPhone** (ou Google Agenda/Outlook) por assinatura.

**Pausado:** Open Finance (Pluggy/Belvo).

---

## Passo a passo para colocar no ar (≈ 40 minutos)

Você vai precisar de: um computador, o [Node.js LTS](https://nodejs.org) instalado e contas gratuitas no **GitHub**, no **Supabase** e na **Vercel**.

### 1. Supabase (banco de dados e login)
1. Em [supabase.com](https://supabase.com), crie um projeto (região: São Paulo). Guarde a senha do banco.
2. **SQL Editor → New query**: cole todo o conteúdo de `supabase/schema.sql` e clique **Run**.
3. **Authentication → Sign In / Providers → Email**: deixe "Email" ligado.
4. **Authentication → Emails**: nos modelos **Confirm signup** e **Magic Link**, troque o corpo do e-mail por algo assim (é o que faz chegar o **código** de 6 dígitos, que funciona dentro do app instalado no iPhone):
   ```html
   <h2>Seu código do Family BS</h2>
   <p style="font-size:28px;letter-spacing:4px"><strong>{{ .Token }}</strong></p>
   ```
5. **Project Settings → API**: copie a *Project URL*, a chave *anon public* e a chave *service_role*.

> O envio de e-mail do Supabase gratuito tem limite baixo por hora. Para uso da família costuma bastar; se travar, configure um SMTP próprio em Authentication → Emails → SMTP.

### 2. No seu computador
```bash
cd family-bs
npm install
cp .env.example .env.local      # no Windows: copy .env.example .env.local
npm run chaves                  # gera as chaves de notificação e o CRON_SECRET
```
Abra o `.env.local` e preencha com os valores do Supabase e os gerados acima. Teste:
```bash
npm test        # testes da lógica
npm run dev     # abre em http://localhost:3000
```
Entre com seu e-mail, digite o código e crie a família (nome, seu nome, empresa "CBS Engenharia").

### 3. Importar a planilha
Com a família já criada no app:
```bash
npm run importar -- dados/historico_family_bs_2025_2026.csv seu@email.com
```
Isso cria as categorias, os 897 lançamentos e as contas recorrentes. Depois, no app, vá em **Finanças → Contas recorrentes** e informe o **dia de vencimento** de cada uma (sem isso não há lembrete). Atualize o aluguel com o valor de Jundiaí.

### 4. Publicar na Vercel
1. Crie um repositório **privado** no GitHub e envie a pasta (a pasta `dados/` e o `.env.local` ficam de fora automaticamente).
2. Em [vercel.com](https://vercel.com) → **Add New → Project** → escolha o repositório.
3. Em **Environment Variables**, cole todas as variáveis do `.env.local`.
4. **Deploy**. Anote o endereço (ex.: `https://family-bs.vercel.app`).
5. No Supabase, **Authentication → URL Configuration → Site URL**: coloque esse endereço.

### 5. Ligar os lembretes automáticos
1. Supabase → **Database → Extensions**: ative `pg_cron` e `pg_net`.
2. Abra `supabase/cron.sql`, troque o endereço do app e o `CRON_SECRET`, cole no SQL Editor e rode.
3. A cada 5 minutos o Supabase chama o app, que envia: compromissos, contas a vencer (a partir das 8h) e limites estourados.

### 5b. Fase 2: banco, Claude e Telegram
1. No Supabase, rode `supabase/schema-fase2.sql` (SQL Editor → Run). Pode rodar de novo sem problema.
2. **Claude**: em [console.anthropic.com](https://console.anthropic.com) crie uma chave de API, coloque créditos e cadastre `ANTHROPIC_API_KEY` na Vercel. Defina um limite mensal de gasto no Console para ficar tranquilo. (A assinatura Pro/Max do claude.ai não pode ser usada por apps de terceiros.)
3. O `cron.sql` atualizado também agenda as notícias e o resumo de investimentos: rode-o de novo com seu endereço e `CRON_SECRET`.
4. **Telegram** (opcional): no Telegram, fale com **@BotFather** → `/newbot` → copie o token para `TELEGRAM_BOT_TOKEN`. Coloque `TELEGRAM_WEBHOOK_SECRET` (do `npm run chaves`) na Vercel e no `.env.local`, faça o deploy e rode:
   ```bash
   npm run telegram -- https://SEU-APP.vercel.app
   ```
   Ponha o nome do bot que aparecer em `TELEGRAM_BOT_USERNAME` na Vercel. No app: **Ajustes → Telegram → Conectar** e mande o código ao bot.
5. **Calendário**: em **Ajustes → Agenda no calendário do iPhone → Assinar**.

> **Custos da Fase 2:** só o Claude é pago (por uso). As notícias fazem uma pesquisa por categoria por dia; desligue categorias em Notícias → engrenagem para gastar menos. Ler notas pelo QR code não usa o Claude quando a página da SEFAZ é lida direto.
> **Região:** o `vercel.json` coloca o servidor em São Paulo (`gru1`), perto do Supabase e das SEFAZ.

### 6. Instalar no iPhone
1. Abra o endereço no **Safari** → botão **Compartilhar** → **Adicionar à Tela de Início**.
2. Abra pelo ícone **Family BS**, entre com o código.
3. **Ajustes → Ligar notificações neste aparelho** → permitir → **Enviar notificação de teste**.

### 7. Acesso da Kamila (opcional)
Em **Ajustes → Família → Convidar**, coloque o e-mail dela. Quando ela entrar com esse e-mail, já cai na mesma família e vê tudo.

---

## Estrutura
```
src/app/(app)/        telas: Hoje, Agenda, Finanças, Recorrentes, Categorias, Lançar, Ajustes
src/app/entrar/       login por código
src/app/api/cron/     lembretes, resumo das 7h, notícias e investimentos (chamados pelo Supabase)
src/app/api/notas/    leitura da NFC-e e de comprovantes
src/app/api/telegram/ bot do Telegram
src/app/api/agenda/   calendário (iCal) para assinar
src/lib/              regras: valores, parcelas, vencimentos, lembretes, frase rápida
supabase/schema.sql   tabelas + segurança (cada família só vê os próprios dados)
supabase/schema-fase2.sql  estoque, notas, lista, notícias, investimentos, Telegram
supabase/cron.sql     agendador dos lembretes e do conteúdo
scripts/              importação da planilha, chaves, testes
dados/                histórico da planilha (dados pessoais: não publique)
```

## Custos
Supabase e Vercel nos planos gratuitos atendem bem duas pessoas. O Claude é cobrado por uso, na chave de API do Claude Console (defina um limite mensal lá).

## Limitações conhecidas
- Algumas SEFAZ mudam o layout da página da NFC-e; quando o app não consegue ler direto, ele manda o texto para o Claude (se configurado). Se a SEFAZ bloquear, use a foto do cupom.
- Promoções de lojas físicas: vêm do histórico das suas notas e das ofertas que o Claude encontra com fonte. Não existe uma base pública com os preços de todos os mercados.
- Notícias, ideias de investimento e leitura de comprovantes são feitas por IA: confira as fontes e os valores.

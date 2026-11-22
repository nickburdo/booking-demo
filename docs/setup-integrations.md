# Setup: Telegram bot and Turnstile (v3)

One-time steps for the owner of the deployment. They create the three secrets the API needs
(ADR-018, ADR-019) and the public Turnstile site key the website needs.

| Value | Where it comes from | Secret? | Where it goes |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | @BotFather | **yes** | `wrangler secret put`, optionally `apps/api/.dev.vars` |
| `TELEGRAM_CHAT_ID` | Telegram `getUpdates` | **yes** (treat as private) | `wrangler secret put`, optionally `apps/api/.dev.vars` |
| `TURNSTILE_SECRET` | Cloudflare dashboard | **yes** | `wrangler secret put` only |
| Turnstile site key | Cloudflare dashboard | no (it is in every page) | `apps/web/nuxt.config.ts` → `runtimeConfig.public.turnstileSiteKey` |
| `STRIPE_SECRET_KEY` (v7) | Stripe dashboard → Developers → API keys (`sk_test_…`) | **yes** | `wrangler secret put`, `apps/api/.dev.vars` |
| `STRIPE_WEBHOOK_SECRET` (v7) | Stripe dashboard → Webhooks → endpoint (`whsec_…`) | **yes** | `wrangler secret put`, optionally `apps/api/.dev.vars` |

No need to keep a private copy of the values: each can be found again at its source.
- Bot token: @BotFather → `/mybots` → the bot → **API Token**.
- Chat id: run `getUpdates` again (step 2).
- Turnstile keys: Cloudflare dashboard → **Turnstile** → the widget → **Settings**.
- Values stored with `wrangler secret put` cannot be read back; put them again if needed.

Rules:
- Never commit secret values, never paste them into chats, issues or screenshots.
- `apps/api/.dev.vars` and `apps/web/.env.local` are git-ignored; the `.example` files next to
  them are the committed templates.
- If a secret leaks, revoke it (BotFather `/revoke`, or rotate the Turnstile secret key in the
  dashboard) and put the new value again. When BotFather asks which bot, tap the bot's button
  on its keyboard, or send the username with `@` (e.g. `@my_bot`); a bare username or the
  display name gives "Invalid bot selected". `/mybots` shows the exact username.

## 1. Telegram bot

1. In Telegram, open **@BotFather** and send `/newbot`.
2. Enter a display name (e.g. `Linden Coffee Bookings`), then a username ending in `bot`
   (e.g. `linden_coffee_bookings_bot`). It must be unique across Telegram.
3. BotFather replies with the **bot token**, which looks like `1234567890:AAE…`.
   Copy it somewhere private for the next steps. Do not share it.
4. Open the link to your new bot from BotFather's message and press **Start** (or send any
   message). A bot cannot write to a user who has never started it, and step 2 below needs
   at least one message from you.

## 2. Chat id

The chat id of a private chat with the bot is your Telegram user id (a positive number).

1. Make sure you have sent the bot at least one message (step 1.4).
2. In PowerShell, replace `<TOKEN>` with the bot token and run:

   ```powershell
   (Invoke-RestMethod "https://api.telegram.org/bot<TOKEN>/getUpdates").result.message.chat.id
   ```

   Or with real curl, and look for `"chat":{"id":…}` in the output. In Windows PowerShell 5.1,
   plain `curl` is an alias of `Invoke-WebRequest`, which cuts the response off with `...`, so
   type `curl.exe` there:

   ```sh
   curl.exe "https://api.telegram.org/bot<TOKEN>/getUpdates"
   ```

3. The printed number is the **chat id**. In a private chat it equals `message.from.id`
   (your user id), so if the output is cut off before `"chat"`, the `"from":{"id":…}` number
   is the same value.
   - Empty output: send the bot another message and run the command again (updates are kept
     for about 24 hours).
   - The same id printed several times: that is fine, one per message.

Optional check that the bot can write to you (replace both placeholders):

```powershell
Invoke-RestMethod "https://api.telegram.org/bot<TOKEN>/sendMessage" -Method Post -Body @{ chat_id = "<CHAT_ID>"; text = "test" }
```

These commands leave the token in the shell history. In PowerShell, `Clear-History` is not
enough: the arrow-key history comes from PSReadLine, which also saves it to a file. To remove
the lines with the token (then close all terminal windows):

```powershell
$p = (Get-PSReadLineOption).HistorySavePath
(Get-Content $p) | Where-Object { $_ -notmatch 'api\.telegram\.org' } | Set-Content $p -Encoding utf8
[Microsoft.PowerShell.PSConsoleReadLine]::ClearHistory()
```

## 3. Turnstile widget

1. Open the Cloudflare dashboard → **Turnstile** → **Add widget**.
2. Fill in:
   - **Widget name:** e.g. `booking-demo`.
   - **Hostnames:** `booking-demo-web.nick-burdo.workers.dev` and `localhost`.
   - **Widget mode:** Managed.
   - **Skip future security rule challenges for verified visitors** (this is pre-clearance):
     leave the toggle off. It only matters for sites proxied through Cloudflare on their own
     zone, not for `*.workers.dev`.
3. Create the widget. The dashboard shows two keys:
   - **Site Key** — public. It goes into `apps/web/nuxt.config.ts`
     (`runtimeConfig.public.turnstileSiteKey`) and is baked into the site at build time.
   - **Secret Key** — private. It goes only into the API secret `TURNSTILE_SECRET`.

Local development does not use these keys: `apps/web/.env.local` and `apps/api/.dev.vars`
hold Cloudflare's public test keys (always pass), see ADR-019.

## 4. Store the production secrets

The value is never typed into the command itself. Wrangler asks for it after the command
starts, so it does not end up in the shell history.

1. Open a terminal in the API folder:

   ```sh
   cd apps/api
   ```

2. Run the command for the first secret (only the name, no value):

   ```sh
   npx wrangler secret put TELEGRAM_BOT_TOKEN
   ```

3. Wait for the prompt `Enter a secret value:`. Paste the bot token and press Enter.
   Nothing is shown while you paste: that is expected.
4. Wait for `✨ Success! Uploaded secret TELEGRAM_BOT_TOKEN`.
5. Repeat steps 2–4 for the other two secrets:
   - `npx wrangler secret put TELEGRAM_CHAT_ID` → paste the chat id;
   - `npx wrangler secret put TURNSTILE_SECRET` → paste the Turnstile **Secret Key**.
6. Check:

   ```sh
   npx wrangler secret list
   ```

   It must list all three names. Values are never shown.

Each `secret put` applies to the deployed Worker right away. A mistyped value is fixed by
running the same `secret put` again.

## 5. Optional: real Telegram messages from the local API

**Why a second place.** The secrets from step 4 live in Cloudflare and are used only by the
deployed API. The API running on your computer (`wrangler dev`) does not see them: it reads
its secrets from the local file `apps/api/.dev.vars`. That file is git-ignored.

**When you need it.** Only if you want the local API to send real Telegram messages, e.g. to
check the message texts before deploying. Without it everything else works locally; the API
just skips notifications and logs a warning.

Steps:

1. Open `apps/api/.dev.vars` (if it does not exist, copy `apps/api/.dev.vars.example` to it).
2. Put the values right after `=`, without quotes or spaces:

   ```
   TELEGRAM_BOT_TOKEN=1234567890:AAE...
   TELEGRAM_CHAT_ID=123456789
   ```

3. Do **not** change the `TURNSTILE_SECRET` line: it must stay at the test value
   `1x0000000000000000000000000000000AA`. The local site uses the Turnstile test site key,
   and the real Secret Key would reject it.
4. Save the file.
5. Restart the local API: stop `pnpm --filter api dev` with Ctrl+C and start it again.
   Wrangler reads `.dev.vars` only at start.
6. Make a booking on the local site: a message from the bot should arrive.


## 6. Admin demo password (v4)

The admin area has one account: username `demo` (set in `apps/api/wrangler.jsonc`) and the
password from the API secret `ADMIN_PASSWORD`. While the admin is a public demo (ADR-021), the
password is **not a secret**: the login page shows it.

- Local: `apps/api/.dev.vars` has `ADMIN_PASSWORD=linden-demo` (copied from
  `.dev.vars.example`).
- Production: from `apps/api`, run `npx wrangler secret put ADMIN_PASSWORD`, wait for
  `Enter a secret value:`, type the demo password (the one the login page shows) and press
  Enter.

To close the demo later, put a different, private password with the same command and remove
the demo hint from the login page.

## 7. AI chat (v6)

Nothing to set up: the AI chat uses Cloudflare Workers AI through the `AI` binding in
`apps/api/wrangler.jsonc`, on the same Cloudflare account and free plan (10,000 neurons per day,
no card). Usage is visible in the Cloudflare dashboard under **AI → Workers AI**.

Local `wrangler dev` also calls the real models on Cloudflare (the binding always runs remotely),
so local tries use the same daily free quota. Automated tests never call the models.


## 8. Stripe test mode (v7)

The pre-order payments use a **Stripe account in test mode**. Test mode needs no activation, no
company details and no card; real money never moves. The keys are never pasted in the chat.

### 8.1 Create the account

1. Open https://dashboard.stripe.com/register and sign up with an e-mail.
2. If Stripe asks for a country and Ukraine is not offered, stop and tell the developer (plan v7,
   risk R1): the choice affects the currency and the terms.
3. Do **not** activate the account ("Activate payments"): the demo uses test mode only.
4. Make sure the dashboard shows **Test mode** (or a sandbox).

### 8.2 Keys for local development

1. In the dashboard open **Developers → API keys**.
2. Copy the **Secret key** (it starts with `sk_test_`). The publishable key is not needed.
3. Open `apps/api/.dev.vars` (git-ignored) in an editor and add a line:

   ```
   STRIPE_SECRET_KEY=sk_test_…
   ```

4. The webhook secret for local development is optional (see 8.4).

### 8.3 Production secrets and the webhook (at deploy time)

1. In the dashboard open **Developers → Webhooks → Add endpoint**.
2. Endpoint URL: `https://booking-demo-api.nick-burdo.workers.dev/payments/stripe/webhook`.
3. Events: `checkout.session.completed` and `checkout.session.expired`.
4. Save, then open the endpoint and reveal its **Signing secret** (starts with `whsec_`).
5. In a terminal in `apps/api`, store both secrets as in section 4 (the value is pasted at the
   prompt, never typed into the command):

   ```sh
   npx wrangler secret put STRIPE_SECRET_KEY
   npx wrangler secret put STRIPE_WEBHOOK_SECRET
   ```

6. Check with `npx wrangler secret list`.

### 8.4 Optional: webhooks on the local API

Without this, the local API learns about a payment when the guest returns to the reservation page.
To receive real webhooks locally, install the Stripe CLI (https://docs.stripe.com/stripe-cli), then:

```sh
stripe login
stripe listen --forward-to localhost:8787/payments/stripe/webhook
```

It prints a signing secret (`whsec_…`); put it into `apps/api/.dev.vars` as
`STRIPE_WEBHOOK_SECRET=…` and restart the local API.

### 8.5 Test cards

- `4242 4242 4242 4242` — paid; any future date, any CVC.
- `4000 0000 0000 0002` — declined.

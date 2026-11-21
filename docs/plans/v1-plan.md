# v1 plan — Landing page

- **Status:** Approved (2026-11-21); revisions R1–R6 approved (2026-11-21)
- **Scope:** stage 0 of the roadmap (`docs/overview.md`): one-page site with menu, opening
  hours, map, "booking coming soon" section; EN/RU/UK; responsive; deployed to Cloudflare.
- **Out of scope:** any backend, database, booking logic, forms, chat, analytics,
  today's-hours highlighting, dark mode, images beyond what the design step decides.
- **Testing:** no automated tests (per project rules). Verification is manual, listed in
  each step under "Done when".

## Decision log

| # | Decision | Source |
|---|---|---|
| D1 | One version per stage; this is v1 | ADR-002 |
| D2 | Nuxt 4 static generation, served as Workers static assets | ADR-003, ADR-004 |
| D3 | ~~`prefix` strategy, detect on root~~ → **R1:** `prefix_except_default` (`/` = EN, `/ru`, `/uk`), no browser detection, chosen language remembered in `localStorage` | ADR-006 (rev. R1) |
| D4 | Leaflet + OSM via `@nuxtjs/leaflet` | ADR-007 |
| D5 | Tailwind CSS v4 via `@tailwindcss/vite`, own components | ADR-008 |
| D6 | "Book a table" button → "coming soon" section | ADR-010 |
| D7 | pnpm workspaces monorepo; public GitHub repo at the end | ADR-009 |
| D8 | Domain: `*.workers.dev`, Worker name `booking-demo-web` | user (Cloudflare account exists) |
| D9 | Content from `docs/cafe.md` | ADR-001 |
| D10 | Docs written in English (public portfolio repo) | user, plan approval |
| D11 | Git: docs committed on `main`; v1 work on branch `feature/v1-landing` | user, plan approval |
| D12 | Visual direction chosen by the user from mockups in step 3.1 → B2 "Podil poster, photo" (`docs/design.md`) | user, plan approval |
| D13 | Hero stock photo (Unsplash, Kris Atomic), stored as WebP in the repo, credited in the footer | R3 (approved) |
| D14 | Fonts self-hosted via `@fontsource-variable/*` (Unbounded, Golos Text) | R3 (approved) |

## Revision R1 (2026-11-21) — root path and language persistence

**Trigger:** step 2.6 confirmed the known risk below. With `prefix`, `nuxt generate` emits no
page for `/`. Checked under local `wrangler dev` with `not_found_handling: "404-page"`: `/` is
served `404.html` with **HTTP 404**, Nuxt then redirects client-side (`/en` for an EN browser,
`/ru` with cookie `ru`). Functionally OK, but the main URL answers 404 (bad for search engines
and link previews) and a blank page flashes before the redirect.

**Options considered:** (A) keep as is; (B) `_redirects` rule `/ → /en` (no language detection);
(C) tiny Worker on `/` only (`run_worker_first: ["/"]`) redirecting by cookie/`Accept-Language`;
(D) `prefix_except_default`.

**Decision (user):** D, with these rules:
- `/` is the English page; Russian and Ukrainian are `/ru` and `/uk`.
- No browser-language detection (`detectBrowserLanguage: false`): a first visit is always English;
  the user switches with the language switcher.
- The chosen language is saved to `localStorage` on every switch.
- On app start, **only when the URL is the English (unprefixed) page** and the saved language is
  `ru` or `uk`, the app switches to the saved language (history `replace`). A direct link to
  `/ru` or `/uk` always opens as is and is never overridden.
- Accepted trade-off: a returning RU/UK visitor briefly sees the English page before the switch,
  because `localStorage` is readable only in the browser after the static page loads.

**Plan changes:** step 2.4 re-done (config), step 2.6 re-verified, new step 2.7, step 6.2
extended. Steps 0.1–2.5 are already done and are not affected otherwise.

## Revision R2 (2026-11-21) — trailing slash on locale pages

**Trigger:** step 2.6-R1 under local `wrangler dev`: `/` → 200, but `/ru` and `/uk` → **307**
to `/ru/` and `/uk/`. Cause: Workers static assets default `html_handling: auto-trailing-slash`
serves folder `index.html` files with a trailing slash, while Nuxt links use `/ru` without one.

**Decision (user):** add `"html_handling": "drop-trailing-slash"` to the Wrangler config
(step 7.1). Verified in a temporary config: `/`, `/ru`, `/uk` → 200 with the right language;
`/ru/` → 307 to `/ru` (single canonical URL); `/en` and unknown paths → 404.
Rejected alternative: changing Nuxt output to `ru.html` files (alters the build, less obvious).

## Revision R3 (2026-11-21) — design: hero photo, self-hosted fonts (approved)

**Trigger:** step 3.1/3.2. The user chose direction B with a full-bleed photo instead of the
plain colour block (B2), and confirmed `docs/design.md`. Three things in it are not covered by
the original steps.

**Changes:**
- **D13 (new):** hero uses one stock photo — Unsplash, author Kris Atomic, Unsplash License;
  stored in the repo as WebP (no hotlinking); author credited in the footer.
- **D14 (new):** fonts Unbounded + Golos Text self-hosted from npm
  (`@fontsource-variable/unbounded`, `@fontsource-variable/golos-text`), no Google Fonts request.
- **Step 3.3** extended: install the two font packages, import them in `main.css`.
- **Step 5.3** extended: download the photo (ask first: file, source, size), convert to
  `hero-1200.webp` and `hero-2400.webp` (≤ 300 KB for the larger), place in
  `apps/web/public/images/`, render with `srcset` and the gradient from `docs/design.md` §3.
- **Step 5.8** extended: one-line photo credit with a link to the photo page.

Steps 0.1–3.2 are done and not affected.

## Revision R4 (2026-11-21) — absolute URLs for SEO links (approved)

**Trigger:** step 5.9. `useLocaleHead` produces `hreflang` alternates and the canonical link,
but without the i18n `baseUrl` option they are relative (`/ru`), and the module warns
"I18n `baseUrl` is required to generate valid SEO tag links". Search engines expect absolute URLs.
The site's address is known only after the first deploy (`*.workers.dev` subdomain).

**Change:** step 7.3 extended — after the first deploy, set `i18n.baseUrl` in `nuxt.config.ts`
to the live URL, redeploy, and check that the generated HTML has absolute `hreflang` and
canonical links.

## Revision R5 (2026-11-21) — smooth scrolling and sticky header (approved)

**Trigger:** user review of the finished landing (after Phase 6).
**Decision (user):** smooth scrolling between sections, option A — CSS `scroll-behavior: smooth`
under `prefers-reduced-motion: no-preference` (rejected: Nuxt `scrollBehaviorType: 'smooth'`,
which ignores reduced motion); and a header fixed at the top so navigation and booking are
reachable from anywhere. Details in `docs/design.md` §8–9.

**Plan changes:** new step 5.2-R5; steps 6.1–6.3 re-run for the header and anchor jumps.

## Revision R6 (2026-11-21) — commit before the first deploy (approved)

**Decision (user):** commit the v1 work on `feature/v1-landing` before Phase 7, so the deployed
site matches a known commit. Step 8.3 still commits the README/docs updates and merges to `main`.

## Known risk to verify early (resolved by R1)

**Root path `/` with `prefix` strategy on a static host.** With `prefix`, there is no
unprefixed page, and a static host has no server to redirect `/` → `/en`. The expectation is
that `nuxt generate` emits a root page and the i18n module redirects on the client
(browser-language detection runs from `navigator` client-side). This is verified in step 2.6.
If it does not work as expected, **stop and revise this plan** (options would be discussed
then, e.g. a static redirect rule or a tiny Worker script).

---

## Phase 0 — Repository

### 0.1 Initialise git
- `git init -b main` in `C:\Users\nikbu\projects\booking-demo`.
- Add `.gitignore` (node_modules, `.output`, `.nuxt`, `.wrangler`, `.env*`, OS files).
- **Done when:** `git status` shows `docs/` and `.gitignore` untracked, branch `main`.

### 0.2 Commit approved docs on `main`
- Commit `docs/` (with this plan marked Approved) and `.gitignore`.
- **Done when:** one commit on `main`.

### 0.3 Create the v1 branch
- `git switch -c feature/v1-landing`.
- **Done when:** current branch is `feature/v1-landing`.

### 0.4 Workspace root
- Root `package.json` (private, name `booking-demo`, scripts delegating to `apps/web`).
- `pnpm-workspace.yaml` with `apps/*`.
- **Done when:** `pnpm install` at the root runs without errors.

## Phase 1 — Toolchain check

### 1.1 Check Node.js and pnpm
- `node -v`, `pnpm -v`. If pnpm is missing, enable it via `corepack enable` (ask first).
- **Done when:** both print versions compatible with Nuxt 4 (Node per Nuxt's current requirement).

## Phase 2 — Nuxt scaffold

### 2.1 Create the Nuxt app
- `pnpm create nuxt@latest apps/web` (minimal template, no extra modules).
- **Done when:** `apps/web` exists with `nuxt.config.ts` and `app/` directory.

### 2.2 Run the dev server
- Add a `.claude/launch.json` entry for the dev server; start it.
- **Done when:** the default page renders at `http://localhost:3000`.

### 2.3 Add Tailwind CSS v4
- Install `tailwindcss` and `@tailwindcss/vite`; register the Vite plugin in `nuxt.config.ts`;
  create `app/assets/css/main.css` with `@import "tailwindcss";` and add it to `css`.
- **Done when:** a test utility class visibly applies in the dev server; test class removed.

### 2.4 Add `@nuxtjs/i18n`
- Install; configure `locales` (`en`, `ru`, `uk` with `language` codes `en-US`, `ru-RU`, `uk-UA`),
  `defaultLocale: 'en'`, `strategy: 'prefix'`, `detectBrowserLanguage`
  (`useCookie: true`, `redirectOn: 'root'`); locale files `en.json`, `ru.json`, `uk.json`
  with one test key.
- **Done when:** `/en`, `/ru`, `/uk` each show the test key in their language.

### 2.4-R1 Switch i18n to `prefix_except_default`
- In `nuxt.config.ts`: `strategy: 'prefix_except_default'`, `detectBrowserLanguage: false`
  (other i18n settings unchanged).
- **Done when:** `/` shows the EN test key, `/ru` and `/uk` show theirs; `/en` is not a page.

### 2.5 Add `@nuxtjs/leaflet`
- Install the module (no map rendered yet).
- **Done when:** dev server starts without errors.

### 2.6 Verify static generation (checkpoint)
- Run `nuxt generate`; inspect `.output/public`: `en/`, `ru/`, `uk/` pages and the root page.
- Serve `.output/public` locally with a static server and open `/` with browser language set
  to RU and to an unsupported language.
- **Done when:** `/` → `/ru` for RU browser, `/` → `/en` for unsupported language; direct
  `/uk` opens without redirect. **If not — stop, revise plan (see Known risk).**
- **Result:** not met → Revision R1.

### 2.6-R1 Re-verify static generation
- `nuxt generate`; check `.output/public` has `index.html` (EN), `ru/index.html`, `uk/index.html`.
- Serve with local `wrangler dev` (same assets settings as step 7.1).
- **Done when:** `/`, `/ru`, `/uk` answer HTTP 200 with the right language and no redirect.
- **Result:** met with the R2 setting (`drop-trailing-slash`); without it `/ru`, `/uk` → 307.

### 2.7 Remember the chosen language (`localStorage`)
- Client-only Nuxt plugin `app/plugins/remember-locale.client.ts`:
  - on a user-initiated locale switch (i18n `beforeLocaleSwitch` hook with
    `initialSetup === false`) → save the new locale code to `localStorage` under key `locale`.
    The initial locale setup on page load is **not** saved, so merely opening a direct `/uk`
    link does not change the remembered language (approved with R1);
  - on app start → if the current locale is `en` (unprefixed URL) and the saved value is
    `ru` or `uk`, navigate to the same page in the saved locale with `replace`;
  - all `localStorage` access wrapped in `try/catch` (private mode / blocked storage → behave as
    if nothing is saved); unknown saved values ignored.
- **Done when:** (a) fresh visit to `/` stays EN; (b) switch to RU, reload `/` → `/ru`;
  (c) with RU saved, open `/uk` directly → stays `/uk`, and saved value is still `ru`;
  (d) switch to EN, reload `/` → stays EN;
  (e) checked both in dev and in the generated build under `wrangler dev`.

## Phase 3 — Visual direction

### 3.1 Propose visual directions
- Prepare 2 contrasting mockups of the hero + menu block (palette, fonts, spacing, mood)
  in the "modern, light" brief. Shown to the user in the browser.
- **Done when:** the user picks one (or asks for changes).

### 3.2 Record the design
- Write `docs/design.md`: palette (CSS variables / Tailwind theme tokens), fonts and their
  source, spacing scale, breakpoints, section order.
- **Done when:** the user confirms `docs/design.md`.

### 3.3 Apply design tokens
- Tailwind theme variables (`@theme`) and font loading according to `docs/design.md`.
- (R3) Install `@fontsource-variable/unbounded` and `@fontsource-variable/golos-text` in
  `apps/web`; import them in `main.css`; register both families as theme font tokens.
- **Done when:** tokens usable as Tailwind classes in the dev server; both fonts load from
  the site itself (no request to fonts.googleapis.com), Cyrillic renders in them.

## Phase 4 — Content and translations

### 4.1 Cafe data file
- `apps/web/app/data/cafe.ts`: typed data — name, address (3 languages), coordinates,
  opening hours, menu categories and items with names in 3 languages and prices.
  Mirrors `docs/cafe.md`.
- **Done when:** the file type-checks and matches `docs/cafe.md`.

### 4.2 UI translations
- All UI strings (navigation, section titles, buttons, "coming soon", footer demo note,
  day names, currency label) in `en.json`, `ru.json`, `uk.json`.
- **Done when:** the three files have identical key sets.

## Phase 5 — Page sections (one component each)

### 5.1 Page shell
- `app/pages/index.vue` composing the sections; `app/app.vue` with `<NuxtPage />`.
- **Done when:** empty sections render in order with anchors.

### 5.2 Header
- Logo/name, anchor navigation (Menu, Hours, Location, Booking), language switcher
  (keeps current section anchor), "Book a table" button; mobile menu toggle.
- **Done when:** works at 375 px and 1280 px; switcher changes URL prefix.

### 5.2-R5 Sticky header and smooth scrolling
- Header `position: sticky` at the top (all widths) per `docs/design.md` §9; sections get
  `scroll-margin-top` = header height; mobile panel scrolls inside if too tall.
- `html { scroll-behavior: smooth }` inside `@media (prefers-reduced-motion: no-preference)`.
- **Done when:** at 375 and 1280 px, anchor links (mouse and keyboard) scroll smoothly and the
  section heading is visible below the header; with reduced motion emulated the jump is instant;
  the header stays above the map; no horizontal scroll.

### 5.3 Hero
- Name, tagline, "Book a table" CTA → booking section.
- (R3) Full-bleed photo per `docs/design.md` §3: download it (ask first), convert to
  `hero-1200.webp` / `hero-2400.webp` in `apps/web/public/images/`, `srcset`, bottom gradient,
  espresso fallback background, `alt=""`.
- **Done when:** renders in all 3 languages; tagline on one line at 375 px; larger WebP ≤ 300 KB.

### 5.4 Menu section
- Categories with items and prices (UAH) from `cafe.ts`.
- **Done when:** all items from `docs/cafe.md` shown in all 3 languages.

### 5.5 Opening hours section
- Weekly hours from `cafe.ts`, day names localised.
- **Done when:** matches `docs/cafe.md` in all 3 languages.

### 5.6 Location section
- Address + Leaflet map (client-only) with a marker at the cafe coordinates,
  OSM attribution visible, scroll-wheel zoom disabled so the page scrolls normally.
- **Done when:** map renders, marker correct, page scroll is not hijacked on desktop or mobile.

### 5.7 Booking "coming soon" section
- Short text that online booking is coming; anchor target for all "Book a table" buttons.
- **Done when:** every "Book a table" button scrolls here.

### 5.8 Footer
- Name, address, "This is a demo project — the coffee shop is fictional" note,
  link to the GitHub repo (filled in at step 8.4).
- (R3) Photo credit: "Photo: Kris Atomic / Unsplash" linking to the photo page.
- **Done when:** renders in all 3 languages.

### 5.9 SEO and document head
- Per-locale `<title>` and meta description; `html lang`; `hreflang` alternates via the
  i18n module's locale head helpers; favicon.
- **Done when:** generated HTML for each locale has correct `lang`, title, description and
  alternates.

## Phase 6 — Manual verification

### 6.1 Responsive check
- Viewports 375×812, 768×1024, 1280×800 in each language (longest strings: RU/UK).
- **Done when:** no horizontal scroll, no overflowing text, menu toggle works.

### 6.2 Interaction check
- Anchor navigation by click and keyboard (Tab/Enter), language switch, map interaction
  by mouse and touch emulation.
- (R1) Language memory: repeat checks (a)–(d) of step 2.7 on the final page with the real
  language switcher.
- **Done when:** all work; issues fixed within this plan's scope or raised for discussion.

### 6.3 Production build check
- `nuxt generate`, serve `.output/public`, repeat 6.1 quickly on the built output.
- **Done when:** built site behaves the same as dev.

## Phase 7 — Deploy to Cloudflare

### 7.1 Wrangler setup
- Add `wrangler` as a dev dependency of `apps/web`; `apps/web/wrangler.jsonc`:
  `name: "booking-demo-web"`, current `compatibility_date`,
  `assets.directory: "./.output/public"`, `assets.not_found_handling: "404-page"`,
  `assets.html_handling: "drop-trailing-slash"` (R2).
- **Done when:** `wrangler deploy --dry-run` succeeds.

### 7.2 Cloudflare login (user)
- The user runs `wrangler login` in their terminal (browser sign-in is the user's).
- **Done when:** `wrangler whoami` shows the account.

### 7.3 First deploy
- `pnpm --filter web deploy` (= generate + `wrangler deploy`). Ask before running.
- **Done when:** the site is live at `https://booking-demo-web.<subdomain>.workers.dev`;
  `/`, `/en`, `/ru`, `/uk` and an unknown path (404 page) behave as locally.
- (R4) Set `i18n.baseUrl` to the live URL in `nuxt.config.ts`; redeploy (ask first).
  **Done when (R4):** generated HTML has absolute `hreflang` and canonical links.

## Phase 8 — Wrap-up

### 8.1 README
- Root `README.md`: what it is, live link, stack, roadmap, how to run locally and deploy.

### 8.2 Update docs
- `docs/architecture.md`: mark v1 parts as implemented, note anything learned.
- This plan: status → Done, with notes on any approved revisions.

### 8.3 Merge to `main`
- (R6) The v1 code is already committed before Phase 7; here commit the Phase 8 changes; merge `feature/v1-landing` into `main` (ask first).

### 8.4 Publish to GitHub
- Create public repo `booking-demo` with `gh`, push `main` (ask first); put the repo link
  into the footer and README; redeploy.
- **Done when:** repo is public, live site footer links to it.

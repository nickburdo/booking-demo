# v1 plan — Landing page

- **Status:** Approved (2026-11-21)
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
| D3 | `@nuxtjs/i18n`, `en` (default) / `ru` / `uk`, `prefix` strategy, detect on root | ADR-006 |
| D4 | Leaflet + OSM via `@nuxtjs/leaflet` | ADR-007 |
| D5 | Tailwind CSS v4 via `@tailwindcss/vite`, own components | ADR-008 |
| D6 | "Book a table" button → "coming soon" section | ADR-010 |
| D7 | pnpm workspaces monorepo; public GitHub repo at the end | ADR-009 |
| D8 | Domain: `*.workers.dev`, Worker name `booking-demo-web` | user (Cloudflare account exists) |
| D9 | Content from `docs/cafe.md` | ADR-001 |
| D10 | Docs written in English (public portfolio repo) | user, plan approval |
| D11 | Git: docs committed on `main`; v1 work on branch `feature/v1-landing` | user, plan approval |
| D12 | Visual direction chosen by the user from mockups in step 3.1 | user, plan approval |

## Known risk to verify early

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

### 2.5 Add `@nuxtjs/leaflet`
- Install the module (no map rendered yet).
- **Done when:** dev server starts without errors.

### 2.6 Verify static generation (checkpoint)
- Run `nuxt generate`; inspect `.output/public`: `en/`, `ru/`, `uk/` pages and the root page.
- Serve `.output/public` locally with a static server and open `/` with browser language set
  to RU and to an unsupported language.
- **Done when:** `/` → `/ru` for RU browser, `/` → `/en` for unsupported language; direct
  `/uk` opens without redirect. **If not — stop, revise plan (see Known risk).**

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
- **Done when:** tokens usable as Tailwind classes in the dev server.

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

### 5.3 Hero
- Name, tagline, "Book a table" CTA → booking section.
- **Done when:** renders in all 3 languages.

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
- **Done when:** all work; issues fixed within this plan's scope or raised for discussion.

### 6.3 Production build check
- `nuxt generate`, serve `.output/public`, repeat 6.1 quickly on the built output.
- **Done when:** built site behaves the same as dev.

## Phase 7 — Deploy to Cloudflare

### 7.1 Wrangler setup
- Add `wrangler` as a dev dependency of `apps/web`; `apps/web/wrangler.jsonc`:
  `name: "booking-demo-web"`, current `compatibility_date`,
  `assets.directory: "./.output/public"`, `assets.not_found_handling: "404-page"`.
- **Done when:** `wrangler deploy --dry-run` succeeds.

### 7.2 Cloudflare login (user)
- The user runs `wrangler login` in their terminal (browser sign-in is the user's).
- **Done when:** `wrangler whoami` shows the account.

### 7.3 First deploy
- `pnpm --filter web deploy` (= generate + `wrangler deploy`). Ask before running.
- **Done when:** the site is live at `https://booking-demo-web.<subdomain>.workers.dev`;
  `/`, `/en`, `/ru`, `/uk` and an unknown path (404 page) behave as locally.

## Phase 8 — Wrap-up

### 8.1 README
- Root `README.md`: what it is, live link, stack, roadmap, how to run locally and deploy.

### 8.2 Update docs
- `docs/architecture.md`: mark v1 parts as implemented, note anything learned.
- This plan: status → Done, with notes on any approved revisions.

### 8.3 Merge to `main`
- Commit; merge `feature/v1-landing` into `main` (ask first).

### 8.4 Publish to GitHub
- Create public repo `booking-demo` with `gh`, push `main` (ask first); put the repo link
  into the footer and README; redeploy.
- **Done when:** repo is public, live site footer links to it.

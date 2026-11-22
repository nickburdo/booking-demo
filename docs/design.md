# Design — Linden Coffee landing

**Status:** Confirmed by the user (2026-11-21, v1 plan, step 3.2)
**Direction:** B2 "Podil poster, photo" — chosen by the user in step 3.1 (D12).

Bold, graphic, urban: an oversized wide headline over a full-bleed café photo,
clean menu rows, one cobalt action colour and a young-linden accent.

## 1. Palette

Defined once as Tailwind theme tokens (`@theme` in `app/assets/css/main.css`, step 3.3),
used as classes such as `bg-milk`, `text-espresso`, `bg-cobalt`.

| Token | Hex | Role |
|---|---|---|
| `--color-milk` | `#F7F7F2` | Page background; text on the hero photo |
| `--color-espresso` | `#2A1A12` | Main text; hero photo fallback; gradient base |
| `--color-cobalt` | `#2D4FC2` | Buttons, links, focus ring |
| `--color-linden` | `#D4DE6A` | Accent only (see rules below) |
| `--color-steam` | `#6F746B` | Secondary text (notes, captions) |
| `--color-line` | `#DCDDD4` | Hairlines between menu / hours rows |
| `--color-error-on-dark` | `#FFB4A6` | (v3) Error text and invalid-field border on espresso |
| `--color-error` | `#B3261E` | (v3) Error text and destructive action on milk |

Rules:
- **Linden is never text on a light background** (too low contrast). It is used as:
  the tagline on the dark hero, the 4px underline of menu category headings,
  and the active-language pill (with espresso text).
- **Cobalt is the only action colour.** Buttons are cobalt with white text;
  links are cobalt on milk.
- White on cobalt and espresso on milk both pass WCAG AA for body text.

## 2. Typography

| Family | Weights | Use |
|---|---|---|
| **Unbounded** | 900, 700, 400 | Hero name (900), section headings and brand (700), sub-headings (400) |
| **Golos Text** | 400, 500, 600 | Body, navigation, buttons, prices |

Both fonts have Cyrillic, so EN / RU / UK look the same.

**Source:** self-hosted from npm packages
`@fontsource-variable/unbounded` and `@fontsource-variable/golos-text` (v5.3.0, OFL-1.1),
imported in CSS, instead of a Google Fonts `<link>`.
Why: no request to Google from the visitor's browser (privacy) and no third-party
dependency at runtime; the font files ship with the site.

Type scale (desktop → mobile where different):

| Element | Size | Line height / tracking |
|---|---|---|
| Hero name | `clamp(64px, 15vw, 210px)` | 0.85 / −0.03em; one line per word |
| Hero tagline | `clamp(17px, 5.2vw, 24px)`, weight 500 | always one line (`nowrap`) |
| Section heading (h2) | 40px → 30px | Unbounded 700 |
| Sub-heading (h3) | 20px | Unbounded 400 |
| Body | 17px | 1.55 |
| Small / notes | 15px | steam colour |
| Prices | body size, weight 600 | tabular figures |

## 3. Hero photo

- **Photo:** round wooden table with a French press among plants (photo 1 from step 3.1).
- **Author:** Kris Atomic, on Unsplash —
  https://unsplash.com/photos/round-brown-wooden-table-with-french-press-on-top-with-white-ceramic-teacup-beside-3b2tADGAWnU
- **Licence:** Unsplash License (free to use, attribution not required).
  We credit the author in the footer anyway (one short line next to the demo note).
- **File:** downloaded once (with the user's permission, step 5.3), converted to WebP,
  stored in the repo at `apps/web/public/images/hero-1200.webp` and `hero-2400.webp`
  (target ≤ 300 KB for the larger one), served via `srcset`. No hotlinking.
- **Treatment:** `object-fit: cover`, full width, height `min(88vh, 820px)`;
  espresso gradient from the bottom (90% → 60% at 45% → 15% at 85%) so the milk-white
  headline is readable; espresso background shows while the photo loads.
- **Alt text:** empty (`alt=""`) — the photo is decorative; the name and tagline are real text.

## 4. Layout and spacing

- **Spacing scale:** Tailwind default (4px steps). No custom scale.
- **Container:** max width 1200px, side padding 24px (16px below 400px).
- **Section padding:** 72px top / 88px bottom on desktop, 48px / 56px on mobile.
- **Alignment:** everything left-aligned; no centred text blocks.
- **Radii:** buttons 10px, language pill 6px; sections and photo have no radius.
- **Shadows:** none.

## 5. Breakpoints

Mobile-first, Tailwind default breakpoints:

| Width | Changes |
|---|---|
| < 768px | One-column menu; header shows brand + "Menu" button (mobile menu) |
| ≥ 768px (`md`) | Menu in three columns; location in two columns (text + map) |
| ≥ 1024px (`lg`) | Full header: navigation, language switcher, "Book a table" button |

The mockup switched at 820px; using Tailwind's `md`/`lg` instead avoids a custom
breakpoint, and the full header needs ~1000px to fit without crowding.
Checked widths in step 6.1: 375, 768, 1280.

## 6. Components

- **Button (primary):** cobalt background, white Golos 600, padding 14px × 24px, radius 10px.
  Hover: slightly darker cobalt. Focus: 2px cobalt ring with 2px offset (milk gap).
- **Language switcher:** `EN RU UK`, Golos 500 15px; the active one sits on a linden pill
  with espresso text; others are plain links.
- **Menu row:** name left, price right, 10px vertical padding, 1px `line` border on top.
- **Menu category heading:** Unbounded 400 20px with a 4px linden underline.
- **Hours row:** same as a menu row (days left, time right).
- **Map:** full column width, 360px tall (280px on mobile), no radius, OSM attribution visible.
- **Booking section (v3, variant A approved in v3 step 3.1):** espresso background, milk text,
  heading in Unbounded 700 linden — repeats the hero contrast at the end of the page.
  Two columns from `md` (steps 1–2 left: date, guests, times; step 3 right: details,
  Turnstile, submit), one column on mobile. Step titles Unbounded 400 20px with a bold number.
  - **Fields:** milk background, espresso text, 48px tall, radius 10px; label Golos 500 15px
    above; hint 15px in milk at 70%; invalid field gets a 2px `error-on-dark` border and the
    message below in `error-on-dark`.
  - **Chips (guests, times):** 44px tall, radius 10px, 2px border in milk at 35%; selected =
    linden background with espresso text (same idea as the language pill). Times: 4 per row on
    mobile, 6 from `sm`. Loading = 8 placeholder blocks; no times = dashed box with a hint.
  - **Submit:** primary button; its label repeats the choice ("Book a table for Sat, Dec 5,
    19:00"); "Booking…" while sending.
  - **General error:** box with a 4px `error-on-dark` left border above the fields, focused
    and announced.
  - **Confirmation:** replaces the form; 4px linden left border, Unbounded heading in linden,
    details list, the private link with a "Copy link" outline button, "Book another table".
- **Reservation page (v3):** milk page with a minimal header (brand + language switcher) and
  the footer; status pill (linden = waiting, line grey = cancelled / started); details list;
  "Cancel booking" as an outline button in `error`, then an inline confirm with a solid
  `error` button.

- **Admin (v4, mockup approved in v4 step 3.1):** light milk pages, like the reservation page —
  a working tool, not the espresso marketing look. Header: brand + espresso "Admin demo" badge,
  language switcher, "Site" and "Log out" links; 1px `line` border below.
  - **Login:** left-aligned column (max 420px), heading Unbounded 700; demo box with a 4px
    linden left border on white, credentials in monospace, "Fill in demo login" outline
    button; fields white with a 2px `line` border; primary "Log in" (full width on mobile);
    errors in a box with a 4px `error` left border.
  - **Day view:** toolbar with ←/→ icon buttons (44px), native date input and "Today"; "Add
    demo reservations" outline button on the right (below the list on mobile). Day heading
    Unbounded 400 20px with "N reservations · M guests" in steam. Status filter chips (36px,
    white with `line` border; selected = espresso with milk text) with counts.
  - **Rows:** from `lg` (1024px) a grid — time–end (tabular, 600) · table + guests · masked name / phone
    (steam) / comment · status · actions on the right; 1px `line` between rows. Below `lg`: cards
    (time · table · guests and the status on one line, guest below, actions under them).
    Cancelled and no-show rows in steam colour. Small "DEMO" tag for demo reservations;
    "⚠ Telegram not delivered" under the status when the owner was not notified.
  - **Status pills** (6px radius, 13px 600): waiting = white with a 1.5px espresso border;
    confirmed = linden; cancelled = `line` grey ("Cancelled by guest / by the café"); no-show =
    pale red `#F3D5D2` with dark red `#7A1C16` text.
  - **Actions:** "Confirm" = small primary (cobalt); "Cancel…" = outline in `error`, opens an
    inline panel under the row: optional reason textarea with a 200-character counter and the
    hint that the guest sees it, then solid `error` "Cancel reservation" and outline "Keep it";
    "No-show" = espresso outline (only after the start). Only actions the API allows are shown.
  - **Empty day:** dashed `line` box with a link to add demo reservations.
- **Reservation page, v4 states:** "Confirmed" (linden pill, "The café has confirmed your
  booking"), "Cancelled by the café" (grey pill + the reason), "Marked as no-show" (pale red
  pill); "Cancel booking" also for confirmed bookings.

- **Chat widget (v5, mockup approved in v5 step 3.1), landing page only:**
  - **Launcher:** cobalt pill in the bottom-right corner (56px tall, white chat icon + "Chat
    with us", fully rounded, soft shadow); hidden while the panel is open.
  - **Panel:** 380 × 600px milk card, radius 16px, soft shadow, above the page in the corner;
    full screen below `md`. Espresso header with "Linden Coffee" (Unbounded 700 16px), a small
    "Chat bot · demo" line and a close button (outline on espresso). Esc closes.
  - **Start screen:** demo note, "Quick check that you're not a bot", the Turnstile widget.
  - **Messages:** bot = white bubble with a 1px `line` border (tail corner bottom-left); guest =
    espresso bubble with milk text, right-aligned (tail bottom-right); 15.5px text, line breaks
    kept; links in cobalt. Demo notes from the bot = dashed `line` border, steam text. "…" while
    waiting.
  - **Inputs:** choices as chips under the messages — main ones white with a 2px cobalt border
    and cobalt text (fully rounded), secondary ones ("Main menu", "Skip", "Another day") with a
    `line` border and espresso text; free times as square chips (radius 10px), like the
    booking form. Text input: white field with a 2px `line` border + square cobalt send button,
    quick chips above it.
  - **Errors:** box with a 4px `error` left border inside the messages; an ended conversation
    shows a note and "Start a new chat".
- **Admin "Chats" (v5):** tabs "Reservations | Chats" under the admin header (active tab
  underlined in linden). List of the last 7 days (time, language tag, message count, outcome
  pill: booked = linden, asked a person = pale blue `#DFE6FB` / `#1F3A8F`, found a booking =
  white with espresso border, questions = `line` grey, left = dashed); the selected row is
  white. Transcript on the right (below the list on narrow screens) in a white card with the same
  bubbles (bot bubbles on milk), a link to the booking's day.

## 7. Section order

1. Header (brand, nav, language switcher, "Book a table")
2. Hero (photo, name, tagline, address, "Book a table")
3. Menu
4. Hours
5. Location (address + map)
6. Booking — form (v3; "coming soon" in v1)
7. Footer (demo note, photo credit, repo link)

## 8. Motion

None on load. Only state changes the user triggers: button hover/focus, the
mobile menu opening, and (R5) **smooth scrolling** to a section after an anchor link
(CSS `scroll-behavior: smooth` on `html`, only under `prefers-reduced-motion: no-preference`;
with reduced motion the jump is instant).

## 9. Sticky header (R5)

The header stays at the top of the viewport at every width, so navigation, the language
switcher and "Book a table" are reachable from anywhere on the page.
- Milk background with a 1px `line` border at the bottom (no shadow, §4).
- Stacks above the map (Leaflet controls use z-index up to 1000).
- Sections get `scroll-margin-top` equal to the header height, so an anchor jump does not
  hide the section heading under the header.
- The mobile navigation panel scrolls inside itself if it is taller than the screen.

## Decisions confirmed with this document

1. Fonts self-hosted via `@fontsource-variable/*` instead of Google Fonts (§2).
2. Breakpoints `md` 768 / `lg` 1024 instead of the mockup's 820 (§5).
3. Photo credit line in the footer although the licence does not require it (§3).
4. Booking teaser on an espresso background without a button (§6) — replaced in v3 by the
   booking form on the same background (variant A, user approval in v3 step 3.1).
5. (v3) Error colour tokens `error-on-dark` / `error` (§1).

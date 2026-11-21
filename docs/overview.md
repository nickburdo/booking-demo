# Overview

## What this is

A demo website for a fictional small coffee shop in Kyiv, with online table booking.
The coffee shop is only a convenient domain: the real subject is **how online booking
(and, by extension, online purchase) works end to end**.

## Why

- Learn, hands-on, how online booking/purchase systems are built: availability,
  reservations, preventing double booking, notifications, admin workflow,
  chat-based and AI-based booking interfaces, payments.
- Produce a portfolio project that shows this end to end, deployed publicly.

This is **not** a client project. There is no real coffee shop and no real customers.

## Goals

- A public, mobile-friendly, modern-looking one-page site (menu, hours, map).
- Table booking through several interfaces built on one shared booking backend:
  form → scripted chat → AI chat.
- Each version is a finished, deployed, demonstrable step.

## Non-goals

- Production readiness for a real business (multi-venue support, real payments,
  GDPR compliance work, marketing features).
- Supporting a real coffee shop's content or brand.

## Anti-goals (failure even if it "works")

- Using a real business's name, brand, or address.
- An AI chat that books directly without going through the same validated backend
  as the form (the AI must be only another interface).
- A codebase that looks like an unmodified template.

## Roadmap (one version per stage)

| Version | Scope | Key concept learned |
|---|---|---|
| v1 | Landing: menu, hours, map, i18n (EN/RU/UK), responsive, deployed | Frontend, static hosting |
| v2 | API + DB: tables, slots, reservations, double-booking protection | Booking core |
| v3 | Booking form + Telegram notification to the owner | Where requests land |
| v4 | Admin: list reservations, confirm/cancel | Reservation lifecycle |
| v5 | Scripted chat (no AI) on the same API | Chat as an interface |
| v6 | AI chat calling the same API via tool calls | AI as an interface |
| v7 | Prepayment/deposit in a payment provider's test mode | Bridge to "purchase" |

Each version gets its own plan in `docs/plans/` before any code is written.

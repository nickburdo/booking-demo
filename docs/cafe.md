# The fictional coffee shop

Status: **Approved** (2026-11-21, with the v1 plan).
Everything here is invented. It is the single source of truth for site content;
the app's data file mirrors it.

## Identity

- **Name:** Linden Coffee (the same in all three languages)
- **Tagline:**
  - EN: Slow coffee under the lindens
  - UK: Повільна кава під липами
  - RU: Неспешный кофе под липами
- **Size:** small, 24 seats at 8 tables (see "Tables" below; defined in the v2 plan)

## Address and location

- **Address (invented street):**
  - EN: 7 Lypova Alley, Podil, Kyiv
  - UK: Липова алея, 7, Поділ, Київ
  - RU: Липовая аллея, 7, Подол, Киев
- **Map point:** 50.4655, 30.5150 (Podil area; the point is real, the coffee shop is not)
- **Phone / email:** none shown (demo); a "This is a demo" note is shown in the footer instead.

## Opening hours

| Days | Hours |
|---|---|
| Mon–Fri | 08:00–21:00 |
| Sat–Sun | 09:00–22:00 |

## Tables

Added in v2. Guests never choose a table; the booking API assigns one.

| Table | Seats |
|---|---|
| T1, T2, T3, T4 | 2 |
| T5, T6, T7, T8 | 4 |

## Booking rules

Added in v2. All times are Kyiv local time (Europe/Kyiv).

- **Duration:** every reservation lasts 90 minutes.
- **Start times:** on a 30-minute grid, from opening time until 90 minutes before closing:
  Mon–Fri 08:00–19:30, Sat–Sun 09:00–20:30.
- **Lead time:** a reservation must start at least 1 hour from now.
- **Horizon:** at most 30 days ahead.
- **Party size:** 1–4 guests. Larger parties cannot book online.
- **Table assignment:** the smallest free table that fits the party; a party of 1–2 gets a
  4-seat table if all 2-seat tables are taken.
- **Guest details:** name and phone (required), comment (optional).
- **Status:** a new reservation is `pending` and holds its table. The guest can cancel it
  with the private link (token) received on booking, until the start time. Owner
  confirmation arrives in v4.

## Menu (prices in UAH)

Category names (added in v1 step 4.1):

| EN | UK | RU |
|---|---|---|
| Coffee | Кава | Кофе |
| Not coffee | Не кава | Не кофе |
| Breakfast & pastry | Сніданки та випічка | Завтраки и выпечка |

### Coffee
| EN | UK | RU | Price |
|---|---|---|---|
| Espresso | Еспресо | Эспрессо | 55 |
| Americano | Американо | Американо | 60 |
| Cappuccino | Капучино | Капучино | 75 |
| Flat white | Флет вайт | Флэт уайт | 85 |
| Latte | Лате | Латте | 80 |
| Filter coffee (V60) | Фільтр-кава (V60) | Фильтр-кофе (V60) | 90 |

### Not coffee
| EN | UK | RU | Price |
|---|---|---|---|
| Linden tea | Липовий чай | Липовый чай | 60 |
| Matcha latte | Матча лате | Матча латте | 95 |
| Hot chocolate | Гарячий шоколад | Горячий шоколад | 85 |

### Breakfast & pastry
| EN | UK | RU | Price |
|---|---|---|---|
| Croissant | Круасан | Круассан | 65 |
| Syrnyky with sour cream | Сирники зі сметаною | Сырники со сметаной | 150 |
| Avocado toast | Тост з авокадо | Тост с авокадо | 170 |
| Cheesecake | Чизкейк | Чизкейк | 120 |

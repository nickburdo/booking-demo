// Chat texts in EN / RU / UK (v5, D8: the server writes the texts, as the AI will in v6).
// Dates and day names come from Intl, so only phrases live here.

import type { Locale } from "./types";

const INTL_TAG: Record<Locale, string> = { en: "en-US", ru: "ru-RU", uk: "uk-UA" };

/** "Wed, Nov 25" in the guest's language; the date is a calendar date (no time zone shift). */
export function formatDate(locale: Locale, date: string): string {
  return new Intl.DateTimeFormat(INTL_TAG[locale], { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(`${date}T00:00:00Z`));
}

/** Short weekday name for a day code, e.g. "Mon" / "пн". 2026-11-23 is a Monday. */
export function dayName(locale: Locale, day: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun"): string {
  const offset = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 }[day];
  return new Intl.DateTimeFormat(INTL_TAG[locale], { weekday: "short", timeZone: "UTC" })
    .format(new Date(Date.UTC(2026, 10, 23 + offset)));
}

/** One / few / many for Russian and Ukrainian (1 гість, 2 гості, 5 гостей). */
function slavic(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export interface ChatTexts {
  greeting: string;
  demoNotice: string;
  menuQuestion: string;
  anythingElse: string;
  opt: Record<
    | "book" | "find" | "faq" | "person" | "menu" | "more" | "otherDay" | "skip" | "confirm" | "change"
    | "cancelBooking" | "yes" | "no" | "hours" | "address" | "menuItems" | "today" | "tomorrow",
    string
  >;
  guests(n: number): string;
  askDate: string;
  askGuests(date: string): string;
  noTimes(guests: string, date: string): string;
  askTime(date: string, guests: string): string;
  askName: string;
  badName: string;
  askPhone: string;
  badPhone: string;
  askComment: string;
  tooLong(max: number): string;
  summary(lines: { when: string; guests: string; name: string; phone: string; comment: string | null }): string;
  booked: string;
  bookedLink(link: string): string;
  bookedDemo: string;
  slotTaken: string;
  askLink: string;
  badLink: string;
  notFound: string;
  found(lines: { when: string; guests: string; status: string }): string;
  status: Record<"pending" | "confirmed" | "cancelled" | "no_show" | "started", string>;
  cancelQuestion: string;
  cancelled: string;
  notCancellable: string;
  faqQuestion: string;
  hours(lines: string[]): string;
  address(address: string): string;
  menu(lines: string[]): string;
  askQuestion: string;
  emptyText: string;
  askPersonName: string;
  askPersonPhone: string;
  personSent: string;
  personAlready: string;
  placeholder: Record<"name" | "phone" | "comment" | "link" | "question", string>;
  error: string;
}

const en: ChatTexts = {
  greeting: "Hi! I'm the Linden Coffee chat bot. I can book a table, find your booking, tell you about the café or pass a question to the staff.",
  demoNotice: "Demo: this chat is scripted (no AI). Conversations are visible in the public demo admin with names and phones hidden.",
  menuQuestion: "What would you like to do?",
  anythingElse: "Anything else?",
  opt: {
    book: "Book a table", find: "Find my booking", faq: "Hours, address, menu", person: "Ask a person",
    menu: "Main menu", more: "Later dates", otherDay: "Another day", skip: "Skip", confirm: "Confirm booking",
    change: "Change", cancelBooking: "Cancel this booking", yes: "Yes, cancel", no: "No, keep it",
    hours: "Opening hours", address: "Address", menuItems: "Menu", today: "Today", tomorrow: "Tomorrow",
  },
  guests: (n) => `${n} ${n === 1 ? "guest" : "guests"}`,
  askDate: "Which day?",
  askGuests: (date) => `${date} — how many guests? Online booking is for 1–4 people.`,
  noTimes: (guests, date) => `Sorry, there are no free times for ${guests} on ${date}. Please pick another day.`,
  askTime: (date, guests) => `Free start times on ${date} for ${guests}. A booking lasts 90 minutes.`,
  askName: "What name should the booking be under?",
  badName: "Please type a name (up to 80 characters).",
  askPhone: "Your phone number? International with + or Ukrainian starting with 0.",
  badPhone: "That doesn't look like a phone number. Use + and the country code, or a Ukrainian number starting with 0.",
  askComment: "Any wishes for the café? Type them, or skip.",
  tooLong: (max) => `That's too long — up to ${max} characters, please.`,
  summary: (l) => [
    "Please check your booking:",
    `• ${l.when}`, `• ${l.guests}`, `• ${l.name}, ${l.phone}`, ...(l.comment ? [`• “${l.comment}”`] : []),
  ].join("\n"),
  booked: "Done! Your table is booked. The café has been notified.",
  bookedLink: (link) => `Your private link to view or cancel the booking. Save it now — for privacy it is hidden in this chat after a reload:\n${link}`,
  bookedDemo: "Demo: a real café would also send you a message when it confirms. Here, open the link to see the status.",
  slotTaken: "Sorry, someone has just taken that time. Here are the times still free:",
  askLink: "Paste the link you got after booking (it contains #…).",
  badLink: "That doesn't look like a booking link. Paste the whole link, including the part after #.",
  notFound: "I couldn't find a booking for this link. Check that you copied all of it.",
  found: (l) => [`Your booking: ${l.status}`, `• ${l.when}`, `• ${l.guests}`].join("\n"),
  status: { pending: "waiting for the café to confirm", confirmed: "confirmed by the café", cancelled: "cancelled", no_show: "marked as a no-show", started: "already started" },
  cancelQuestion: "Cancel this booking? The table will be freed for others.",
  cancelled: "The booking is cancelled. The café has been notified.",
  notCancellable: "This booking can no longer be cancelled.",
  faqQuestion: "What would you like to know?",
  hours: (lines) => ["Opening hours:", ...lines].join("\n"),
  address: (address) => `We're at ${address}. The map is on this page, in the "How to find us" section.`,
  menu: (lines) => ["Our menu (prices in UAH):", ...lines].join("\n"),
  askQuestion: "What's your question? A person from the café will get it.",
  emptyText: "Please type something.",
  askPersonName: "How should we call you?",
  askPersonPhone: "And your phone number, so the café can call you back?",
  personSent: "Thanks! Your question has been passed to the café. Demo: in this demo nobody will actually call you back.",
  personAlready: "Your question has already been passed to the café in this conversation.",
  placeholder: { name: "Name", phone: "+380 67 123 45 67", comment: "Wishes (optional)", link: "https://…/reservation#…", question: "Your question" },
  error: "Something went wrong. Please try again.",
};

const ru: ChatTexts = {
  greeting: "Здравствуйте! Я чат-бот Linden Coffee. Могу забронировать столик, найти вашу бронь, рассказать о кафе или передать вопрос сотрудникам.",
  demoNotice: "Демо: этот чат работает по сценарию (без ИИ). Переписки видны в публичной демо-админке, имена и телефоны скрыты.",
  menuQuestion: "Что вы хотите сделать?",
  anythingElse: "Что-нибудь ещё?",
  opt: {
    book: "Забронировать столик", find: "Найти мою бронь", faq: "Часы, адрес, меню", person: "Спросить человека",
    menu: "Главное меню", more: "Другие даты", otherDay: "Другой день", skip: "Пропустить", confirm: "Подтвердить бронь",
    change: "Изменить", cancelBooking: "Отменить эту бронь", yes: "Да, отменить", no: "Нет, оставить",
    hours: "Часы работы", address: "Адрес", menuItems: "Меню", today: "Сегодня", tomorrow: "Завтра",
  },
  guests: (n) => `${n} ${slavic(n, "гость", "гостя", "гостей")}`,
  askDate: "На какой день?",
  askGuests: (date) => `${date} — сколько будет гостей? Онлайн можно забронировать на 1–4 человека.`,
  noTimes: (guests, date) => `К сожалению, на ${date} нет свободного времени для: ${guests}. Выберите другой день.`,
  askTime: (date, guests) => `Свободное время начала на ${date}, ${guests}. Бронь длится 90 минут.`,
  askName: "На какое имя оформить бронь?",
  badName: "Введите имя (до 80 символов).",
  askPhone: "Ваш телефон? Международный с + или украинский, начинающийся с 0.",
  badPhone: "Это не похоже на номер телефона. Укажите + и код страны или украинский номер, начинающийся с 0.",
  askComment: "Есть пожелания для кафе? Напишите или пропустите.",
  tooLong: (max) => `Слишком длинно — не больше ${max} символов.`,
  summary: (l) => [
    "Проверьте бронь:",
    `• ${l.when}`, `• ${l.guests}`, `• ${l.name}, ${l.phone}`, ...(l.comment ? [`• «${l.comment}»`] : []),
  ].join("\n"),
  booked: "Готово! Столик забронирован. Кафе получило уведомление.",
  bookedLink: (link) => `Ваша личная ссылка, чтобы посмотреть или отменить бронь. Сохраните её сейчас — ради приватности после перезагрузки в чате она будет скрыта:\n${link}`,
  bookedDemo: "Демо: настоящее кафе ещё прислало бы сообщение, когда подтвердит бронь. Здесь откройте ссылку, чтобы увидеть статус.",
  slotTaken: "К сожалению, это время только что заняли. Вот что ещё свободно:",
  askLink: "Вставьте ссылку, которую вы получили после бронирования (в ней есть #…).",
  badLink: "Это не похоже на ссылку на бронь. Вставьте ссылку целиком, вместе с частью после #.",
  notFound: "Не нашёл бронь по этой ссылке. Проверьте, что скопировали её полностью.",
  found: (l) => [`Ваша бронь: ${l.status}`, `• ${l.when}`, `• ${l.guests}`].join("\n"),
  status: { pending: "ждёт подтверждения кафе", confirmed: "подтверждена кафе", cancelled: "отменена", no_show: "отмечена: не пришли", started: "уже началась" },
  cancelQuestion: "Отменить эту бронь? Столик освободится для других.",
  cancelled: "Бронь отменена. Кафе получило уведомление.",
  notCancellable: "Эту бронь уже нельзя отменить.",
  faqQuestion: "Что вы хотите узнать?",
  hours: (lines) => ["Часы работы:", ...lines].join("\n"),
  address: (address) => `Мы находимся по адресу: ${address}. Карта есть на странице, в разделе «Как нас найти».`,
  menu: (lines) => ["Наше меню (цены в гривнах):", ...lines].join("\n"),
  askQuestion: "Какой у вас вопрос? Его получит сотрудник кафе.",
  emptyText: "Пожалуйста, напишите что-нибудь.",
  askPersonName: "Как к вам обращаться?",
  askPersonPhone: "И ваш телефон, чтобы кафе могло перезвонить?",
  personSent: "Спасибо! Ваш вопрос передан в кафе. Демо: в этом демо вам на самом деле никто не перезвонит.",
  personAlready: "В этом разговоре ваш вопрос уже передан в кафе.",
  placeholder: { name: "Имя", phone: "+380 67 123 45 67", comment: "Пожелания (необязательно)", link: "https://…/reservation#…", question: "Ваш вопрос" },
  error: "Что-то пошло не так. Попробуйте ещё раз.",
};

const uk: ChatTexts = {
  greeting: "Вітаю! Я чат-бот Linden Coffee. Можу забронювати столик, знайти ваше бронювання, розповісти про кавʼярню або передати питання працівникам.",
  demoNotice: "Демо: цей чат працює за сценарієм (без ШІ). Листування видно в публічній демо-адмінці, імена й телефони приховані.",
  menuQuestion: "Що ви хочете зробити?",
  anythingElse: "Щось іще?",
  opt: {
    book: "Забронювати столик", find: "Знайти моє бронювання", faq: "Години, адреса, меню", person: "Запитати людину",
    menu: "Головне меню", more: "Інші дати", otherDay: "Інший день", skip: "Пропустити", confirm: "Підтвердити бронювання",
    change: "Змінити", cancelBooking: "Скасувати це бронювання", yes: "Так, скасувати", no: "Ні, залишити",
    hours: "Години роботи", address: "Адреса", menuItems: "Меню", today: "Сьогодні", tomorrow: "Завтра",
  },
  guests: (n) => `${n} ${slavic(n, "гість", "гості", "гостей")}`,
  askDate: "На який день?",
  askGuests: (date) => `${date} — скільки буде гостей? Онлайн можна забронювати на 1–4 особи.`,
  noTimes: (guests, date) => `На жаль, на ${date} немає вільного часу для: ${guests}. Оберіть інший день.`,
  askTime: (date, guests) => `Вільний час початку на ${date}, ${guests}. Бронювання триває 90 хвилин.`,
  askName: "На яке імʼя оформити бронювання?",
  badName: "Введіть імʼя (до 80 символів).",
  askPhone: "Ваш телефон? Міжнародний із + або український, що починається з 0.",
  badPhone: "Це не схоже на номер телефону. Вкажіть + і код країни або український номер, що починається з 0.",
  askComment: "Є побажання для кавʼярні? Напишіть або пропустіть.",
  tooLong: (max) => `Задовго — не більше ${max} символів.`,
  summary: (l) => [
    "Перевірте бронювання:",
    `• ${l.when}`, `• ${l.guests}`, `• ${l.name}, ${l.phone}`, ...(l.comment ? [`• «${l.comment}»`] : []),
  ].join("\n"),
  booked: "Готово! Столик заброньовано. Кавʼярня отримала сповіщення.",
  bookedLink: (link) => `Ваше особисте посилання, щоб переглянути або скасувати бронювання. Збережіть його зараз — заради приватності після перезавантаження в чаті воно буде приховане:\n${link}`,
  bookedDemo: "Демо: справжня кавʼярня ще надіслала б повідомлення, коли підтвердить бронювання. Тут відкрийте посилання, щоб побачити статус.",
  slotTaken: "На жаль, цей час щойно зайняли. Ось що ще вільне:",
  askLink: "Вставте посилання, яке ви отримали після бронювання (у ньому є #…).",
  badLink: "Це не схоже на посилання на бронювання. Вставте посилання повністю, разом із частиною після #.",
  notFound: "Не знайшов бронювання за цим посиланням. Перевірте, що скопіювали його повністю.",
  found: (l) => [`Ваше бронювання: ${l.status}`, `• ${l.when}`, `• ${l.guests}`].join("\n"),
  status: { pending: "чекає на підтвердження кавʼярні", confirmed: "підтверджене кавʼярнею", cancelled: "скасоване", no_show: "позначене: не прийшли", started: "вже почалося" },
  cancelQuestion: "Скасувати це бронювання? Столик звільниться для інших.",
  cancelled: "Бронювання скасовано. Кавʼярня отримала сповіщення.",
  notCancellable: "Це бронювання вже не можна скасувати.",
  faqQuestion: "Що ви хочете дізнатися?",
  hours: (lines) => ["Години роботи:", ...lines].join("\n"),
  address: (address) => `Ми за адресою: ${address}. Мапа є на сторінці, у розділі «Як нас знайти».`,
  menu: (lines) => ["Наше меню (ціни в гривнях):", ...lines].join("\n"),
  askQuestion: "Яке у вас питання? Його отримає працівник кавʼярні.",
  emptyText: "Будь ласка, напишіть щось.",
  askPersonName: "Як до вас звертатися?",
  askPersonPhone: "І ваш телефон, щоб кавʼярня могла передзвонити?",
  personSent: "Дякую! Ваше питання передано до кавʼярні. Демо: у цьому демо вам насправді ніхто не передзвонить.",
  personAlready: "У цій розмові ваше питання вже передано до кавʼярні.",
  placeholder: { name: "Імʼя", phone: "+380 67 123 45 67", comment: "Побажання (необовʼязково)", link: "https://…/reservation#…", question: "Ваше питання" },
  error: "Щось пішло не так. Спробуйте ще раз.",
};

export const TEXTS: Record<Locale, ChatTexts> = { en, ru, uk };

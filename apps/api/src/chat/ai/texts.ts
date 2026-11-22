// Fixed texts of the AI chat in EN / RU / UK (v6): everything the server says itself, without the
// model — greeting, proposals, confirmations, limits and failures.

import type { Locale } from "../types";

export interface AiTexts {
  greeting: string;
  demoNotice: string;
  placeholder: string;
  confirm: { booking: string; cancellation: string; message: string };
  change: string;
  changeAsk: string;
  cancellationSummary(lines: { when: string; guests: string }): string;
  messageSummary(lines: { question: string; name: string; phone: string }): string;
  bookingNote(when: string, guests: number): string;
  cancelledNote: string;
  messageNote: string;
  budgetUsed: string;
  unavailable: string;
  tooManySteps: string;
  emptyText: string;
}

const en: AiTexts = {
  greeting: "Hi! I'm the AI assistant of Linden Coffee. Tell me in your own words what you need: a table, your booking, our hours or menu, or a question for the staff.",
  demoNotice: "Demo: replies come from an open AI model on Cloudflare and can be wrong. Nothing happens until you press a confirm button. Conversations are visible in the public demo admin with names and phones hidden.",
  placeholder: "Your message",
  confirm: { booking: "Confirm booking", cancellation: "Yes, cancel it", message: "Send to the café" },
  change: "Change",
  changeAsk: "Sure — what would you like to change?",
  cancellationSummary: (l) => ["Cancel this booking?", `• ${l.when}`, `• ${l.guests}`].join("\n"),
  messageSummary: (l) => ["Send this question to the café?", `“${l.question}”`, `• ${l.name}, ${l.phone}`].join("\n"),
  bookingNote: (when, guests) => `(The guest confirmed. Booked: ${when}, ${guests} guests. The private link was shown to the guest.)`,
  cancelledNote: "(The guest confirmed. The booking is cancelled.)",
  messageNote: "(The guest confirmed. The question was sent to the café's Telegram.)",
  budgetUsed: "Today's free AI demo limit is used up — it resets every night at 00:00 UTC. The Scripted tab works without limits.",
  unavailable: "The AI is unavailable right now. Please try again a bit later, or use the Scripted tab.",
  tooManySteps: "Sorry, I got lost. Could you say it again in other words?",
  emptyText: "Please type something.",
};

const ru: AiTexts = {
  greeting: "Здравствуйте! Я ИИ-помощник Linden Coffee. Напишите своими словами, что нужно: столик, ваша бронь, часы работы или меню, вопрос сотрудникам.",
  demoNotice: "Демо: отвечает открытая ИИ-модель на Cloudflare, она может ошибаться. Ничего не произойдёт, пока вы не нажмёте кнопку подтверждения. Переписки видны в публичной демо-админке, имена и телефоны скрыты.",
  placeholder: "Ваше сообщение",
  confirm: { booking: "Подтвердить бронь", cancellation: "Да, отменить", message: "Отправить в кафе" },
  change: "Изменить",
  changeAsk: "Хорошо — что изменить?",
  cancellationSummary: (l) => ["Отменить эту бронь?", `• ${l.when}`, `• ${l.guests}`].join("\n"),
  messageSummary: (l) => ["Отправить этот вопрос в кафе?", `«${l.question}»`, `• ${l.name}, ${l.phone}`].join("\n"),
  bookingNote: (when, guests) => `(The guest confirmed. Booked: ${when}, ${guests} guests. The private link was shown to the guest.)`,
  cancelledNote: "(The guest confirmed. The booking is cancelled.)",
  messageNote: "(The guest confirmed. The question was sent to the café's Telegram.)",
  budgetUsed: "Бесплатный дневной лимит ИИ-демо исчерпан — он обновляется каждую ночь в 00:00 UTC. Вкладка «Сценарий» работает без ограничений.",
  unavailable: "ИИ сейчас недоступен. Попробуйте чуть позже или воспользуйтесь вкладкой «Сценарий».",
  tooManySteps: "Извините, я запутался. Можете сказать это другими словами?",
  emptyText: "Пожалуйста, напишите что-нибудь.",
};

const uk: AiTexts = {
  greeting: "Вітаю! Я ШІ-помічник Linden Coffee. Напишіть своїми словами, що потрібно: столик, ваше бронювання, години роботи чи меню, питання працівникам.",
  demoNotice: "Демо: відповідає відкрита ШІ-модель на Cloudflare, вона може помилятися. Нічого не станеться, доки ви не натиснете кнопку підтвердження. Листування видно в публічній демо-адмінці, імена й телефони приховані.",
  placeholder: "Ваше повідомлення",
  confirm: { booking: "Підтвердити бронювання", cancellation: "Так, скасувати", message: "Надіслати до кавʼярні" },
  change: "Змінити",
  changeAsk: "Гаразд — що змінити?",
  cancellationSummary: (l) => ["Скасувати це бронювання?", `• ${l.when}`, `• ${l.guests}`].join("\n"),
  messageSummary: (l) => ["Надіслати це питання до кавʼярні?", `«${l.question}»`, `• ${l.name}, ${l.phone}`].join("\n"),
  bookingNote: (when, guests) => `(The guest confirmed. Booked: ${when}, ${guests} guests. The private link was shown to the guest.)`,
  cancelledNote: "(The guest confirmed. The booking is cancelled.)",
  messageNote: "(The guest confirmed. The question was sent to the café's Telegram.)",
  budgetUsed: "Безкоштовний денний ліміт ШІ-демо вичерпано — він оновлюється щоночі о 00:00 UTC. Вкладка «Сценарій» працює без обмежень.",
  unavailable: "ШІ зараз недоступний. Спробуйте трохи пізніше або скористайтеся вкладкою «Сценарій».",
  tooManySteps: "Вибачте, я заплутався. Можете сказати це іншими словами?",
  emptyText: "Будь ласка, напишіть щось.",
};

export const AI_TEXTS: Record<Locale, AiTexts> = { en, ru, uk };

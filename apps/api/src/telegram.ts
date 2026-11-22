// Owner notifications via the Telegram Bot API (ADR-018). Messages are in Ukrainian,
// whatever language the guest used.

export interface NotificationData {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  endTime: string; // HH:MM
  guests: number;
  tableLabel: string;
  name: string;
  phone: string;
  comment: string | null;
}

export type NotificationKind = "created" | "cancelled";

const HEADERS: Record<NotificationKind, string> = {
  created: "🆕 Нове бронювання",
  cancelled: "❌ Скасовано бронювання",
};

// The date is a calendar date, so it is formatted in UTC to avoid any time-zone shift.
const ukDate = new Intl.DateTimeFormat("uk-UA", {
  weekday: "short",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

/** "сб, 5 грудня" for "2026-12-05". */
export function formatDateUk(date: string): string {
  return ukDate.format(new Date(`${date}T00:00:00Z`));
}

/** Ukrainian plural for 1–4 guests: 1 гість, 2–4 гості. */
function guestsUk(guests: number): string {
  return `${guests} ${guests === 1 ? "гість" : "гості"}`;
}

/** Escapes text for Telegram's HTML parse mode. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function buildMessage(kind: NotificationKind, d: NotificationData): string {
  const lines = [
    HEADERS[kind],
    `${formatDateUk(d.date)} · ${d.time}–${d.endTime}`,
    `${guestsUk(d.guests)} · стіл ${escapeHtml(d.tableLabel)}`,
    `${escapeHtml(d.name)} · ${escapeHtml(d.phone)}`,
  ];
  if (d.comment) lines.push(`«${escapeHtml(d.comment)}»`);
  return lines.join("\n");
}

export interface TelegramConfig {
  botToken?: string;
  chatId?: string;
}

/** "Ask a person" from the chat (v5 plan, P7): question and contact, in Ukrainian like ADR-018. */
export function buildHandoffMessage(d: { question: string; name: string; phone: string }): string {
  return ["💬 Питання з чату", `«${escapeHtml(d.question)}»`, `${escapeHtml(d.name)} · ${escapeHtml(d.phone)}`].join("\n");
}

/**
 * Sends a message to the owner's chat. Returns true if Telegram accepted it.
 * Without configuration the message is skipped (local development).
 */
export async function sendTelegram(config: TelegramConfig, text: string): Promise<boolean> {
  if (!config.botToken || !config.chatId) {
    console.warn("Telegram is not configured; notification skipped");
    return false;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: config.chatId, text, parse_mode: "HTML" }),
    });
    const data = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
    if (res.ok && data?.ok === true) return true;
    console.error(`Telegram sendMessage failed: HTTP ${res.status} ${data?.description ?? ""}`);
    return false;
  } catch (error) {
    console.error("Telegram unreachable:", error);
    return false;
  }
}

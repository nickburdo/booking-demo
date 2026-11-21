import { describe, expect, it } from "vitest";
import { buildMessage, escapeHtml, formatDateUk, type NotificationData } from "../src/telegram";

const data: NotificationData = {
  date: "2026-12-05",
  time: "19:00",
  endTime: "20:30",
  guests: 4,
  tableLabel: "T5",
  name: "Олена",
  phone: "+380671234567",
  comment: "Біля вікна, якщо можна",
};

describe("formatDateUk", () => {
  it("formats a calendar date in Ukrainian (runs in workerd, v3 plan R2)", () => {
    expect(formatDateUk("2026-12-05")).toBe("сб, 5 грудня");
    expect(formatDateUk("2027-01-01")).toBe("пт, 1 січня");
  });
});

describe("buildMessage", () => {
  it("builds the new-reservation message from the plan", () => {
    expect(buildMessage("created", data)).toBe(
      [
        "🆕 Нове бронювання",
        "сб, 5 грудня · 19:00–20:30",
        "4 гості · стіл T5",
        "Олена · +380671234567",
        "«Біля вікна, якщо можна»",
      ].join("\n"),
    );
  });

  it("uses the cancellation header and the singular for one guest, without a comment", () => {
    expect(buildMessage("cancelled", { ...data, guests: 1, comment: null })).toBe(
      ["❌ Скасовано бронювання", "сб, 5 грудня · 19:00–20:30", "1 гість · стіл T5", "Олена · +380671234567"].join(
        "\n",
      ),
    );
  });

  it("escapes guest text for Telegram HTML", () => {
    const text = buildMessage("created", {
      ...data,
      name: '<b>Bob</b> & "Co"',
      comment: "<a href='x'>click</a>",
    });
    expect(text).toContain("&lt;b&gt;Bob&lt;/b&gt; &amp; &quot;Co&quot;");
    expect(text).toContain("«&lt;a href='x'&gt;click&lt;/a&gt;»");
    expect(text).not.toMatch(/<[ab][ >]/);
  });
});

describe("escapeHtml", () => {
  it("escapes &, <, > and double quotes", () => {
    expect(escapeHtml(`a & b < c > d "e"`)).toBe("a &amp; b &lt; c &gt; d &quot;e&quot;");
  });
});

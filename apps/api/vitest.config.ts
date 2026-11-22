import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
      return {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            // Test-only binding: the setup file applies these migrations to the local D1.
            TEST_MIGRATIONS: migrations,
            // Fixed secrets so tests never depend on a developer's .dev.vars; outbound
            // calls to Turnstile and Telegram are mocked in test/outbound.ts.
            TURNSTILE_SECRET: "test-turnstile-secret",
            TELEGRAM_BOT_TOKEN: "test-bot-token",
            TELEGRAM_CHAT_ID: "42",
            ADMIN_PASSWORD: "test-admin-password",
          },
        },
      };
    }),
  ],
  test: {
    setupFiles: ["./test/apply-migrations.ts", "./test/outbound.ts"],
  },
});

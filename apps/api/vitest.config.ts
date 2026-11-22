import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
      return {
        wrangler: { configPath: "./wrangler.jsonc" },
        // Workers AI has no local simulator; tests replace the model call (test/outbound.ts), so no
        // remote session is opened (v6).
        remoteBindings: false,
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
            // v7: Stripe calls are replaced in test/outbound.ts; the webhook secret signs test events.
            STRIPE_SECRET_KEY: "sk_test_fake",
            STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
          },
        },
      };
    }),
  ],
  test: {
    setupFiles: ["./test/apply-migrations.ts", "./test/outbound.ts"],
  },
});

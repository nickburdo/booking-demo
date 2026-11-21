import type { D1Migration } from "@cloudflare/vitest-plugin";

// Test-only bindings added in vitest.config.ts. `env` from "cloudflare:workers"
// is typed as Cloudflare.Env by the output of `wrangler types`.
declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

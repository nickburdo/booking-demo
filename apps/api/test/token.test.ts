import { describe, expect, it } from "vitest";
import { generateToken, hashToken } from "../src/token";

describe("token", () => {
  it("is 43 base64url characters", () => {
    expect(generateToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("is different every time", () => {
    expect(generateToken()).not.toBe(generateToken());
  });

  it("hashes to a stable 64-char hex SHA-256", async () => {
    const token = generateToken();
    const hash = await hashToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashToken(token)).toBe(hash);
    expect(await hashToken(generateToken())).not.toBe(hash);
  });
});

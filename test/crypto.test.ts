import { describe, expect, it } from "vitest";

import { decryptJson, encryptJson, validateEncryptionKey } from "../src/crypto";

const key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("encrypted state", () => {
  it("round-trips with associated data without exposing plaintext", async () => {
    const encrypted = await encryptJson({ secret: "group-secret" }, key, "group:holiday");
    expect(encrypted).not.toContain("group-secret");
    await expect(
      decryptJson<{ secret: string }>(encrypted, key, "group:holiday")
    ).resolves.toEqual({ secret: "group-secret" });
    await expect(decryptJson(encrypted, key, "group:work")).rejects.toThrow(
      "Encrypted state could not be read"
    );
  });

  it("requires a 256-bit hexadecimal key", () => {
    expect(() => validateEncryptionKey("short")).toThrow("64 hexadecimal");
    expect(() => validateEncryptionKey(key)).not.toThrow();
  });
});

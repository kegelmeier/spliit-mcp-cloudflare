const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface EncryptedEnvelope {
  v: 1;
  iv: string;
  data: string;
}

export class EncryptionError extends Error {
  override name = "EncryptionError";
}

export function validateEncryptionKey(secret: string): void {
  if (!/^[0-9a-fA-F]{64}$/.test(secret)) {
    throw new EncryptionError("DATA_ENCRYPTION_KEY must contain exactly 64 hexadecimal characters");
  }
}

export async function encryptJson(
  value: unknown,
  secret: string,
  associatedData: string
): Promise<string> {
  const key = await importKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(associatedData) },
    key,
    plaintext
  );
  const envelope: EncryptedEnvelope = {
    v: 1,
    iv: bytesToBase64Url(iv),
    data: bytesToBase64Url(new Uint8Array(ciphertext))
  };
  return JSON.stringify(envelope);
}

export async function decryptJson<T>(
  encrypted: string,
  secret: string,
  associatedData: string
): Promise<T> {
  try {
    const envelope = JSON.parse(encrypted) as Partial<EncryptedEnvelope>;
    if (envelope.v !== 1 || typeof envelope.iv !== "string" || typeof envelope.data !== "string") {
      throw new Error("invalid envelope");
    }
    const key = await importKey(secret);
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64UrlToBytes(envelope.iv),
        additionalData: encoder.encode(associatedData)
      },
      key,
      base64UrlToBytes(envelope.data)
    );
    return JSON.parse(decoder.decode(plaintext)) as T;
  } catch {
    throw new EncryptionError("Encrypted state could not be read");
  }
}

async function importKey(secret: string): Promise<CryptoKey> {
  validateEncryptionKey(secret);
  return crypto.subtle.importKey("raw", hexToBytes(secret), "AES-GCM", false, [
    "encrypt",
    "decrypt"
  ]);
}

function hexToBytes(value: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid base64url");
  const padded = `${value.replace(/-/g, "+").replace(/_/g, "/")}${"=".repeat((4 - (value.length % 4)) % 4)}`;
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

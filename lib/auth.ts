const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmac(payload: string): Promise<string> {
  const secret = process.env.ZYRON_AUTH_SECRET || process.env.ZYRON_OWNER_KEY;
  if (!secret) throw new Error("Missing ZYRON_AUTH_SECRET or ZYRON_OWNER_KEY");

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return toBase64Url(new Uint8Array(signature));
}

export async function createOwnerSession(ttlSeconds = 60 * 60 * 24 * 30): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = toBase64Url(encoder.encode(JSON.stringify({ sub: "aaron", exp: expiresAt })));
  const signature = await hmac(payload);
  return `${payload}.${signature}`;
}

export async function verifyOwnerSession(token?: string | null): Promise<boolean> {
  if (!token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;

  const expected = await hmac(payload);
  if (expected.length !== signature.length) return false;

  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  }
  if (mismatch !== 0) return false;

  try {
    const decoded = new TextDecoder().decode(fromBase64Url(payload));
    const data = JSON.parse(decoded) as { sub?: string; exp?: number };
    return data.sub === "aaron" && typeof data.exp === "number" && data.exp > Date.now() / 1000;
  } catch {
    return false;
  }
}

export async function ownerKeyMatches(candidate: string): Promise<boolean> {
  const expected = process.env.ZYRON_OWNER_KEY;
  if (!expected || !candidate) return false;

  const left = encoder.encode(candidate);
  const right = encoder.encode(expected);
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", left),
    crypto.subtle.digest("SHA-256", right),
  ]);

  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);
  let mismatch = a.length ^ b.length;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    mismatch |= a[index] ^ b[index];
  }
  return mismatch === 0;
}

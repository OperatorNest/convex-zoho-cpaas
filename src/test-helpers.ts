/** Signs a fixture using Zoho's URL-decoded webhook body convention. */
export async function signWebhook(
  body: string,
  secret = "test-key",
  timestamp = Date.now(),
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
  );
  const signature = encodeURIComponent(btoa(String.fromCharCode(...bytes)));
  return `ts=${timestamp};s=${signature};s-algorithm=HmacSHA256`;
}

export function atOrThrow<T>(values: readonly T[], index: number): T {
  const value = values.at(index);
  if (value === undefined) throw new Error(`Missing test fixture at index ${index}`);
  return value;
}

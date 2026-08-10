const textEncoder = new TextEncoder();

export async function isAuthorized(
  request: Request,
  expectedToken: string
): Promise<boolean> {
  if (expectedToken.length < 32) {
    return false;
  }

  const authorization = request.headers.get("Authorization");
  const match = authorization?.match(/^Bearer[ \t]+([^\s]+)$/i);
  const suppliedToken = match?.[1] ?? "";
  const [suppliedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", textEncoder.encode(suppliedToken)),
    crypto.subtle.digest("SHA-256", textEncoder.encode(expectedToken))
  ]);
  return constantTimeEqual(
    new Uint8Array(suppliedHash),
    new Uint8Array(expectedHash)
  );
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

export function unauthorizedResponse(realm = "spliit-mcp"): Response {
  return Response.json(
    { error: "Unauthorized" },
    {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "WWW-Authenticate": `Bearer realm="${realm}"`
      }
    }
  );
}

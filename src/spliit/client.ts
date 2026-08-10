import { z } from "zod";

import type { ConfiguredGroup } from "../config";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export class SpliitAPIError extends Error {
  override name = "SpliitAPIError";

  constructor(
    message: string,
    readonly procedure: string,
    readonly status?: number
  ) {
    super(message);
  }
}

export class SpliitClient {
  constructor(
    private readonly group: ConfiguredGroup,
    private readonly timeoutMs: number,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  query<Schema extends z.ZodType>(
    procedure: string,
    input: unknown,
    outputSchema: Schema
  ): Promise<z.output<Schema>> {
    const url = new URL(`${this.group.trpcBaseUrl}/${procedure}`);
    url.searchParams.set("input", JSON.stringify({ json: input }));
    return this.request(procedure, url, { method: "GET" }, outputSchema);
  }

  queryWithoutInput<Schema extends z.ZodType>(
    procedure: string,
    outputSchema: Schema
  ): Promise<z.output<Schema>> {
    return this.request(
      procedure,
      new URL(`${this.group.trpcBaseUrl}/${procedure}`),
      { method: "GET" },
      outputSchema
    );
  }

  mutation<Schema extends z.ZodType>(
    procedure: string,
    input: unknown,
    outputSchema: Schema
  ): Promise<z.output<Schema>> {
    return this.request(
      procedure,
      new URL(`${this.group.trpcBaseUrl}/${procedure}`),
      {
        method: "POST",
        body: JSON.stringify({ json: input }),
        headers: { "Content-Type": "application/json" }
      },
      outputSchema
    );
  }

  private async request<Schema extends z.ZodType>(
    procedure: string,
    url: URL,
    init: RequestInit,
    outputSchema: Schema
  ): Promise<z.output<Schema>> {
    let response: Response;
    try {
      const headers = new Headers(init.headers);
      headers.set("Accept", "application/json");
      headers.set("User-Agent", "spliit-mcp-cloudflare/1.0");
      response = await this.fetcher(url, {
        ...init,
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      const reason = error instanceof Error ? error.name : "NetworkError";
      throw new SpliitAPIError(
        `The configured Spliit server could not be reached (${reason}).`,
        procedure
      );
    }

    const payload = await readLimitedJson(response, procedure);
    if (!response.ok) {
      throw new SpliitAPIError(
        `Spliit rejected the request with HTTP ${response.status}.`,
        procedure,
        response.status
      );
    }

    const envelope = z
      .object({
        result: z.object({ data: z.object({ json: z.unknown() }) })
      })
      .safeParse(payload);
    if (!envelope.success) {
      throw new SpliitAPIError(
        `Spliit returned an incompatible response for ${procedure}.`,
        procedure,
        response.status
      );
    }
    const output = outputSchema.safeParse(envelope.data.result.data.json);
    if (!output.success) {
      throw new SpliitAPIError(
        `Spliit returned an incompatible response for ${procedure}.`,
        procedure,
        response.status
      );
    }
    return output.data;
  }
}

async function readLimitedJson(
  response: Response,
  procedure: string
): Promise<unknown> {
  const declaredLength = Number(response.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new SpliitAPIError("Spliit returned an oversized response.", procedure);
  }
  if (response.body === null) {
    throw new SpliitAPIError("Spliit returned an empty response.", procedure);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    totalBytes += result.value.byteLength;
    if (totalBytes > MAX_RESPONSE_BYTES) {
      await reader.cancel("response too large");
      throw new SpliitAPIError("Spliit returned an oversized response.", procedure);
    }
    chunks.push(result.value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new SpliitAPIError("Spliit returned invalid JSON.", procedure);
  }
}

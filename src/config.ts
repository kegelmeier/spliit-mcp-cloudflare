import { z } from "zod";

export const aliasSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(40)
  .regex(/^[a-z][a-z0-9_-]*$/, "Use a lowercase alias beginning with a letter");

export const configuredGroupInputSchema = z.object({
  alias: aliasSchema,
  url: z.url(),
  participantId: z.string().trim().min(1).max(200).optional()
});

const configuredGroupsSchema = z
  .array(configuredGroupInputSchema)
  .superRefine((groups, context) => {
    const aliases = new Set<string>();
    for (const [index, group] of groups.entries()) {
      if (aliases.has(group.alias)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate alias: ${group.alias}`,
          path: [index, "alias"]
        });
      }
      aliases.add(group.alias);
    }
  });

export interface ConfiguredGroup {
  alias: string;
  groupId: string;
  participantId?: string;
  trpcBaseUrl: string;
  webUrl: string;
}

export class ConfigurationError extends Error {
  override name = "ConfigurationError";
}

export function parseConfiguredGroups(secret: string): ConfiguredGroup[] {
  let raw: unknown;
  try {
    raw = JSON.parse(secret);
  } catch {
    throw new ConfigurationError("SPLIIT_GROUPS_JSON is not valid JSON");
  }

  const parsed = configuredGroupsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigurationError(
      `SPLIIT_GROUPS_JSON is invalid: ${z.prettifyError(parsed.error)}`
    );
  }

  return parsed.data.map(parseConfiguredGroup);
}

export function parseConfiguredGroup(
  input: unknown
): ConfiguredGroup {
  const parsed = configuredGroupInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ConfigurationError(`Invalid group configuration: ${z.prettifyError(parsed.error)}`);
  }
  const reference = parseGroupUrl(parsed.data.url);
  return {
    alias: parsed.data.alias,
    groupId: reference.groupId,
    ...(parsed.data.participantId === undefined
      ? {}
      : { participantId: parsed.data.participantId }),
    trpcBaseUrl: reference.trpcBaseUrl,
    webUrl: reference.webUrl
  };
}

export function assertAllowedUpstreamHost(
  group: ConfiguredGroup,
  allowedHostnames: readonly string[]
): void {
  const hostname = new URL(group.webUrl).hostname.toLowerCase();
  if (!allowedHostnames.includes(hostname)) {
    throw new ConfigurationError(
      "This Spliit hostname is not permitted by ALLOWED_SPLIIT_HOSTNAMES."
    );
  }
}

export function parseHostnameAllowlist(value: string, variableName: string): string[] {
  const hostnames = value
    .split(",")
    .map((hostname) => hostname.trim().toLowerCase())
    .filter((hostname) => hostname !== "");
  for (const hostname of hostnames) {
    if (
      hostname.includes(":") ||
      hostname.includes("/") ||
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
        hostname
      )
    ) {
      throw new ConfigurationError(`${variableName} contains an invalid hostname`);
    }
  }
  return [...new Set(hostnames)];
}

function parseGroupUrl(value: string): {
  groupId: string;
  trpcBaseUrl: string;
  webUrl: string;
} {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new ConfigurationError("Configured Spliit group URLs must use HTTPS");
  }
  if (url.username !== "" || url.password !== "") {
    throw new ConfigurationError("Configured Spliit group URLs cannot contain credentials");
  }
  if (url.search !== "" || url.hash !== "") {
    throw new ConfigurationError("Configured Spliit group URLs cannot contain a query or fragment");
  }

  const segments = url.pathname.split("/").filter((segment) => segment !== "");
  const groupsIndex = segments.lastIndexOf("groups");
  const encodedGroupId = groupsIndex >= 0 ? segments[groupsIndex + 1] : undefined;
  if (encodedGroupId === undefined || groupsIndex + 2 !== segments.length) {
    throw new ConfigurationError(
      "Each configured URL must have the form https://host[/prefix]/groups/GROUP_ID"
    );
  }

  let groupId: string;
  try {
    groupId = decodeURIComponent(encodedGroupId);
  } catch {
    throw new ConfigurationError("A configured Spliit group URL has invalid encoding");
  }
  if (!/^[A-Za-z0-9_-]{4,200}$/.test(groupId)) {
    throw new ConfigurationError("A configured Spliit group URL has an invalid group ID");
  }

  const prefixSegments = segments.slice(0, groupsIndex);
  const prefix = prefixSegments.length === 0 ? "" : `/${prefixSegments.join("/")}`;
  return {
    groupId,
    trpcBaseUrl: `${url.origin}${prefix}/api/trpc`,
    webUrl: `${url.origin}${prefix}/groups/${encodeURIComponent(groupId)}`
  };
}

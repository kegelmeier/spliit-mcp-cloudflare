import { z } from "zod";

const configuredGroupSchema = z.object({
  alias: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z][a-z0-9_-]*$/, "Use a lowercase alias beginning with a letter"),
  url: z.url(),
  participantId: z.string().min(1).max(200).optional()
});

const configuredGroupsSchema = z
  .array(configuredGroupSchema)
  .min(1, "Configure at least one Spliit group")
  .max(20, "At most 20 groups can be configured")
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

  return parsed.data.map((group) => {
    const reference = parseGroupUrl(group.url);
    return {
      alias: group.alias,
      groupId: reference.groupId,
      ...(group.participantId === undefined
        ? {}
        : { participantId: group.participantId }),
      trpcBaseUrl: reference.trpcBaseUrl,
      webUrl: reference.webUrl
    };
  });
}

export function findConfiguredGroup(
  groups: readonly ConfiguredGroup[],
  alias: string
): ConfiguredGroup {
  const normalizedAlias = alias.trim().toLowerCase();
  const group = groups.find((candidate) => candidate.alias === normalizedAlias);
  if (group === undefined) {
    throw new ConfigurationError(
      `Unknown group alias ${JSON.stringify(alias)}. Call list_groups first.`
    );
  }
  return group;
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

  const segments = url.pathname.split("/").filter((segment) => segment !== "");
  const groupsIndex = segments.lastIndexOf("groups");
  const encodedGroupId = groupsIndex >= 0 ? segments[groupsIndex + 1] : undefined;
  if (encodedGroupId === undefined) {
    throw new ConfigurationError(
      "Each configured URL must have the form https://host[/prefix]/groups/GROUP_ID"
    );
  }

  const groupId = decodeURIComponent(encodedGroupId);
  if (!/^[A-Za-z0-9_-]{4,200}$/.test(groupId)) {
    throw new ConfigurationError("A configured Spliit group URL has an invalid group ID");
  }

  const prefixSegments = segments.slice(0, groupsIndex);
  const prefix = prefixSegments.length === 0 ? "" : `/${prefixSegments.join("/")}`;
  const origin = url.origin;
  return {
    groupId,
    trpcBaseUrl: `${origin}${prefix}/api/trpc`,
    webUrl: `${origin}${prefix}/groups/${encodeURIComponent(groupId)}`
  };
}

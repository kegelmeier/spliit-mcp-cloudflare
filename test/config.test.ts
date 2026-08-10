import { describe, expect, it } from "vitest";

import {
  assertAllowedUpstreamHost,
  ConfigurationError,
  parseConfiguredGroups,
  parseHostnameAllowlist
} from "../src/config";

describe("group configuration", () => {
  it("derives the public Spliit tRPC endpoint", () => {
    const [group] = parseConfiguredGroups(
      JSON.stringify([
        {
          alias: "holiday",
          url: "https://spliit.app/groups/EXAMPLE_GROUP_ID",
          participantId: "person-1"
        }
      ])
    );
    expect(group).toEqual({
      alias: "holiday",
      groupId: "EXAMPLE_GROUP_ID",
      participantId: "person-1",
      trpcBaseUrl: "https://spliit.app/api/trpc",
      webUrl: "https://spliit.app/groups/EXAMPLE_GROUP_ID"
    });
  });

  it("supports a path-prefixed self-hosted Spliit instance", () => {
    const [group] = parseConfiguredGroups(
      JSON.stringify([
        { alias: "home", url: "https://example.test/spliit/groups/secret_123" }
      ])
    );
    expect(group?.trpcBaseUrl).toBe("https://example.test/spliit/api/trpc");
  });

  it("rejects insecure URLs and duplicate aliases", () => {
    expect(() =>
      parseConfiguredGroups(
        JSON.stringify([{ alias: "home", url: "http://example.test/groups/secret" }])
      )
    ).toThrow(ConfigurationError);
    expect(() =>
      parseConfiguredGroups(
        JSON.stringify([
          { alias: "home", url: "https://example.test/groups/secret1" },
          { alias: "home", url: "https://example.test/groups/secret2" }
        ])
      )
    ).toThrow("Duplicate alias");
  });

  it("normalizes aliases and enforces the outbound hostname allowlist", () => {
    const [group] = parseConfiguredGroups(
      JSON.stringify([{ alias: "Home", url: "https://example.test/groups/secret_123" }])
    );
    expect(group?.alias).toBe("home");
    expect(() =>
      assertAllowedUpstreamHost(group!, parseHostnameAllowlist("spliit.app", "TEST"))
    ).toThrow("not permitted");
  });

  it("accepts an empty import list for fresh stateful installations", () => {
    expect(parseConfiguredGroups("[]")).toEqual([]);
  });
});

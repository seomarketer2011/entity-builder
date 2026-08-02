import { describe, expect, it } from "vitest";
import { assessCapability, type CapabilityRecord } from "../src/capability.js";

function cap(kind: string, value: string): CapabilityRecord {
  return { kind, value };
}

describe("assessCapability — non-negotiable rule 1", () => {
  const cases: Array<{
    name: string;
    entity: string;
    capabilities: CapabilityRecord[];
    supported: boolean | null;
  }> = [
    {
      name: "declared provided",
      entity: "Lock replacement",
      capabilities: [cap("service_provided", "lock replacement")],
      supported: true,
    },
    {
      name: "declared via common_job",
      entity: "Burglary repair",
      capabilities: [cap("common_job", "burglary repair")],
      supported: true,
    },
    {
      name: "declared NOT provided",
      entity: "Safe opening",
      capabilities: [cap("service_not_provided", "safe opening")],
      supported: false,
    },
    {
      name: "no matching record",
      entity: "Car key programming",
      capabilities: [cap("service_provided", "lock replacement")],
      supported: null,
    },
    {
      name: "no records at all",
      entity: "Anything",
      capabilities: [],
      supported: null,
    },
    {
      name: "matching is case-insensitive",
      entity: "LOCK REPLACEMENT",
      capabilities: [cap("service_provided", "Lock Replacement")],
      supported: true,
    },
    {
      name: "capability value contained in the entity name",
      entity: "Emergency safe opening service",
      capabilities: [cap("service_not_provided", "safe opening")],
      supported: false,
    },
    {
      name: "entity name contained in the capability value",
      entity: "safe opening",
      capabilities: [cap("service_not_provided", "emergency safe opening")],
      supported: false,
    },
    {
      name: "unrelated kinds are ignored",
      entity: "Croydon",
      capabilities: [cap("geographic_limit", "Croydon")],
      supported: null,
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(assessCapability(c.entity, c.capabilities).supported).toBe(c.supported);
    });
  }

  it("an exclusion beats a matching provided record", () => {
    // A business saying it does not do something must always win, however
    // many other records look like a match.
    const verdict = assessCapability("Safe opening", [
      cap("service_provided", "safe opening"),
      cap("service_not_provided", "safe opening"),
    ]);
    expect(verdict.supported).toBe(false);
  });

  it("names the offending record so the reviewer can fix it", () => {
    const verdict = assessCapability("Safe opening", [
      cap("service_not_provided", "safe opening"),
    ]);
    expect(verdict.note).toContain("safe opening");
  });

  it("distinguishes 'no records' from 'no match'", () => {
    expect(assessCapability("x", []).note).toContain("No business capabilities recorded");
    expect(assessCapability("x", [cap("service_provided", "y")]).note).toContain(
      "No capability record matches",
    );
  });

  it("ignores empty capability values rather than matching everything", () => {
    // substring logic would otherwise make "" match every entity name.
    expect(assessCapability("Lock replacement", [cap("service_not_provided", "")]).supported).toBe(
      null,
    );
  });

  it("ignores an empty entity name", () => {
    expect(assessCapability("   ", [cap("service_not_provided", "safe opening")]).supported).toBe(
      null,
    );
  });
});

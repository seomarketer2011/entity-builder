import { describe, expect, it } from "vitest";
import {
  bestClusterName,
  buildLocationVocabulary,
  ENTITY_MINING,
  inferEntityType,
  mineEntityCandidates,
  splitLocation,
  type KnownEntity,
  type MinedQuery,
} from "../src/entity-mining.js";

function q(query: string, impressions: number, clicks = 0, position: number | null = 20): MinedQuery {
  return { query, impressions, clicks, position };
}

function entity(canonicalName: string, aliases: string[] = []): KnownEntity {
  return { id: `id-${canonicalName}`, canonicalName, entityType: "service", aliases };
}

describe("buildLocationVocabulary", () => {
  it("normalises and de-duplicates place names from every source", () => {
    const vocab = buildLocationVocabulary({
      siteNames: ["Croydon"],
      capabilityValues: ["croydon", "Sutton"],
      locationNames: ["Milton Keynes"],
    });
    expect(vocab).toContain("croydon");
    expect(vocab).toContain("sutton");
    expect(vocab).toContain("milton keynes");
    expect(vocab.filter((v) => v === "croydon")).toHaveLength(1);
  });

  it("orders longest first so multi-word places match before their parts", () => {
    const vocab = buildLocationVocabulary({ locationNames: ["Bromwich", "West Bromwich"] });
    expect(vocab[0]).toBe("west bromwich");
  });

  it("drops values too short to be a place", () => {
    expect(buildLocationVocabulary({ locationNames: ["NW"] })).toEqual([]);
  });
});

describe("splitLocation", () => {
  const vocab = buildLocationVocabulary({
    locationNames: ["Croydon", "West Bromwich", "Bromwich"],
  });

  const cases: Array<{ name: string; query: string; service: string; location: string | null }> = [
    {
      name: "trailing location",
      query: "emergency locksmith croydon",
      service: "emergency locksmith",
      location: "croydon",
    },
    {
      name: "leading location",
      query: "Croydon emergency locksmith",
      service: "emergency locksmith",
      location: "croydon",
    },
    {
      name: "multi-word location wins over its substring",
      query: "locksmith west bromwich",
      service: "locksmith",
      location: "west bromwich",
    },
    {
      name: "no location present",
      query: "upvc door lock repair",
      service: "upvc door lock repair",
      location: null,
    },
    {
      name: "location only leaves no service",
      query: "croydon",
      service: "",
      location: "croydon",
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const result = splitLocation(c.query, vocab);
      expect(result.service).toBe(c.service);
      expect(result.location).toBe(c.location);
    });
  }

  it("does not strip a place name embedded in a longer word", () => {
    const result = splitLocation("croydonshire locksmith", vocab);
    expect(result.location).toBeNull();
  });
});

describe("bestClusterName", () => {
  it("prefers the longest phrase most members share over the top query", () => {
    const name = bestClusterName([
      { text: "locked out of car at night in the rain", impressions: 500 },
      { text: "locked out of car", impressions: 100 },
      { text: "locked out of car no key", impressions: 80 },
    ]);
    expect(name).toBe("Locked out of car");
  });

  it("caps the name length at maxNameTokens", () => {
    const name = bestClusterName([
      { text: "one two three four five six", impressions: 10 },
      { text: "one two three four five six", impressions: 10 },
    ]);
    expect(name.split(" ")).toHaveLength(ENTITY_MINING.maxNameTokens);
  });

  it("falls back sensibly when members share nothing", () => {
    const name = bestClusterName([
      { text: "alpha", impressions: 10 },
      { text: "beta", impressions: 5 },
    ]);
    expect(["Alpha", "Beta"]).toContain(name);
  });

  it("returns empty for no members", () => {
    expect(bestClusterName([])).toBe("");
  });
});

describe("inferEntityType", () => {
  const cases: Array<[string, string]> = [
    ["lock replacement", "service"],
    ["broken lock", "problem_defect"],
    ["locked out of car", "problem_defect"],
    ["locksmith cost", "commercial"],
    ["bs 3621 standard", "standard_regulation"],
  ];
  for (const [text, expected] of cases) {
    it(`${text} -> ${expected}`, () => {
      expect(inferEntityType(text)).toBe(expected);
    });
  }
});

describe("mineEntityCandidates", () => {
  const vocab = buildLocationVocabulary({ locationNames: ["Croydon", "Sutton"] });

  it("proposes uncovered demand and ignores what the graph already covers", () => {
    const queries = [
      q("lock replacement croydon", 200),
      q("lock replacement sutton", 150),
      q("car key programming croydon", 300),
      q("car key programming sutton", 250),
    ];
    const entities = [entity("Lock replacement", ["lock change"])];

    const result = mineEntityCandidates(queries, entities, {
      locationVocabulary: vocab,
    });

    const names = result.map((r) => r.suggestedName.toLowerCase());
    expect(names.some((n) => n.includes("car key"))).toBe(true);
    expect(names.some((n) => n.includes("lock replacement"))).toBe(false);
  });

  it("collapses the same service across locations into one proposal", () => {
    const result = mineEntityCandidates(
      [q("car key programming croydon", 300), q("car key programming sutton", 250)],
      [],
      { locationVocabulary: vocab },
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.impressions).toBe(550);
    expect(result[0]!.queryCount).toBe(2);
  });

  it("carries evidence on every proposal", () => {
    const result = mineEntityCandidates(
      [q("car key programming croydon", 300, 5, 12), q("car key programming sutton", 250, 3, 8)],
      [],
      { locationVocabulary: vocab },
    );
    const candidate = result[0]!;
    expect(candidate.sampleQueries.length).toBeGreaterThan(0);
    expect(candidate.clicks).toBe(8);
    expect(candidate.bestPosition).toBe(8);
    expect(candidate.rationale).toContain("impressions");
  });

  it("records the dominant location", () => {
    const result = mineEntityCandidates(
      [q("car key programming croydon", 900), q("car key programming sutton", 100)],
      [],
      { locationVocabulary: vocab },
    );
    expect(result[0]!.locationName).toBe("croydon");
  });

  it("ignores demand below the impression floor", () => {
    const result = mineEntityCandidates(
      [q("car key programming croydon", 5), q("car key programming sutton", 5)],
      [],
      { locationVocabulary: vocab },
    );
    expect(result).toEqual([]);
  });

  it("ignores a single one-off query", () => {
    const result = mineEntityCandidates([q("car key programming croydon", 5000)], [], {
      locationVocabulary: vocab,
    });
    expect(result).toEqual([]);
  });

  it("excludes branded queries", () => {
    const result = mineEntityCandidates(
      [q("lockhub reviews", 400), q("lockhub opening hours", 300)],
      [],
      { siteDomain: "lockhub.co.uk", locationVocabulary: vocab },
    );
    expect(result).toEqual([]);
  });

  it("drops bare location queries that describe no service", () => {
    const result = mineEntityCandidates([q("croydon", 900), q("sutton", 800)], [], {
      locationVocabulary: vocab,
    });
    expect(result).toEqual([]);
  });

  it("orders proposals by the demand behind them", () => {
    const result = mineEntityCandidates(
      [
        q("car key programming croydon", 100),
        q("car key programming sutton", 100),
        q("safe opening croydon", 900),
        q("safe opening sutton", 900),
      ],
      [],
      { locationVocabulary: vocab },
    );
    expect(result[0]!.impressions).toBeGreaterThan(result[1]!.impressions);
  });

  it("respects a caller-supplied match threshold", () => {
    const loose = mineEntityCandidates(
      [q("car key programming croydon", 300), q("car key programming sutton", 250)],
      [entity("Car key cutting")],
      { locationVocabulary: vocab, matchThreshold: 0.3 },
    );
    expect(loose).toEqual([]);
  });
});

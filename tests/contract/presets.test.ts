import { describe, expect, it } from "vitest";
import { parsePresetNames } from "../../src/server/presets.js";

describe("parsePresetNames", () => {
  it("splits, trims, and drops empty entries", () => {
    expect(parsePresetNames("service-desk, admin ,,finance")).toEqual([
      "service-desk",
      "admin",
      "finance",
    ]);
  });

  it("returns a single-element array for one preset", () => {
    expect(parsePresetNames("service-desk")).toEqual(["service-desk"]);
  });

  it("returns an empty array for an empty string", () => {
    expect(parsePresetNames("")).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import {
  InvalidEnvironmentError,
  loadEnvironment,
} from "../../src/config/environment.js";

const BASE_VALID_ENV = {
  TRANSPORT: "stdio",
  SERVER_NAME: "test-server",
  SERVER_VERSION: "0.0.1",
  MCP_PRESETS: "service-desk",
  VENDOR_BASE_URL: "https://vendor.test",
};

describe("loadEnvironment", () => {
  it("parses a minimal valid environment and applies defaults", () => {
    const config = loadEnvironment(BASE_VALID_ENV);
    expect(config.READ_ONLY).toBe(true); // default
    expect(config.AUTH_MODE).toBe("none"); // default
    expect(config.MCP_PRESETS).toEqual(["service-desk"]);
    expect(config.PORT).toBe(3000);
  });

  it("splits MCP_PRESETS on commas and trims whitespace", () => {
    const config = loadEnvironment({
      ...BASE_VALID_ENV,
      MCP_PRESETS: "service-desk, admin , finance",
    });
    expect(config.MCP_PRESETS).toEqual(["service-desk", "admin", "finance"]);
  });

  it("throws InvalidEnvironmentError, not a raw zod error, on missing required fields", () => {
    expect(() => loadEnvironment({})).toThrow(InvalidEnvironmentError);
  });

  it("refuses AUTH_MODE=none over TRANSPORT=http", () => {
    expect(() =>
      loadEnvironment({ ...BASE_VALID_ENV, TRANSPORT: "http", AUTH_MODE: "none" }),
    ).toThrow(/AUTH_MODE=none is single-tenant local dev only/);
  });

  it("requires API_KEYS when AUTH_MODE=api-key", () => {
    expect(() =>
      loadEnvironment({ ...BASE_VALID_ENV, TRANSPORT: "http", AUTH_MODE: "api-key" }),
    ).toThrow(/API_KEYS is required/);
  });

  it("accepts AUTH_MODE=api-key over http when API_KEYS is set", () => {
    const config = loadEnvironment({
      ...BASE_VALID_ENV,
      TRANSPORT: "http",
      AUTH_MODE: "api-key",
      API_KEYS: "key:subject:org:role",
    });
    expect(config.AUTH_MODE).toBe("api-key");
  });

  it("requires all three ENTRA_* fields when AUTH_MODE=entra", () => {
    expect(() =>
      loadEnvironment({ ...BASE_VALID_ENV, TRANSPORT: "http", AUTH_MODE: "entra" }),
    ).toThrow(InvalidEnvironmentError);
  });

  it("rejects an out-of-range MAX_PAGE_SIZE", () => {
    expect(() => loadEnvironment({ ...BASE_VALID_ENV, MAX_PAGE_SIZE: "9999" })).toThrow(
      InvalidEnvironmentError,
    );
  });
});

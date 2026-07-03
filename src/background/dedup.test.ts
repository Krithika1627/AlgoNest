import { describe, it, expect } from "vitest";

import { sha256 } from "../shared/crypto";

describe("sha256 dedup", () => {
  it("returns same hash for identical code", async () => {
    const a = await sha256("class Solution: pass");
    const b = await sha256("class Solution: pass");
    expect(a).toBe(b);
  });

  it("returns different hash for different code", async () => {
    const a = await sha256("class Solution: pass");
    const b = await sha256("class Solution: return 1");
    expect(a).not.toBe(b);
  });
});
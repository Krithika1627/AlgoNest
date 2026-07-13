import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

describe("analyzeComplexity", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("returns null when API URL is missing", async () => {
    vi.stubEnv("VITE_COMPLEXITY_API_URL", "");

    const { analyzeComplexity } =
      await import("./complexity-api");

    const result = await analyzeComplexity({
      code: "int main() {}",
      language: "cpp",
      problem_title: "Test",
      problem_slug: "test"
    });

    expect(result).toBeNull();
  });

  it("returns validated complexity analysis", async () => {
    vi.stubEnv(
      "VITE_COMPLEXITY_API_URL",
      "https://example.test/ai/complexity"
    );

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          time_complexity: "O(n)",
          space_complexity: "O(1)",
          explanation: "One pass."
        }),
        { status: 200 }
      )
    );

    const { analyzeComplexity } =
      await import("./complexity-api");

    const result = await analyzeComplexity({
      code: "int main() {}",
      language: "cpp",
      problem_title: "Test",
      problem_slug: "test"
    });

    expect(result).toEqual({
      time_complexity: "O(n)",
      space_complexity: "O(1)",
      explanation: "One pass."
    });
  });

  it("returns null for malformed response", async () => {
    vi.stubEnv(
      "VITE_COMPLEXITY_API_URL",
      "https://example.test/ai/complexity"
    );

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          time: "O(n)"
        }),
        { status: 200 }
      )
    );

    const { analyzeComplexity } =
      await import("./complexity-api");

    const result = await analyzeComplexity({
      code: "int main() {}",
      language: "cpp",
      problem_title: "Test",
      problem_slug: "test"
    });

    expect(result).toBeNull();
  });

  it("returns null when Worker responds with an error", async () => {
    vi.stubEnv(
      "VITE_COMPLEXITY_API_URL",
      "https://example.test/ai/complexity"
    );

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Too many requests", {
        status: 429
      })
    );

    const { analyzeComplexity } =
      await import("./complexity-api");

    const result = await analyzeComplexity({
      code: "int main() {}",
      language: "cpp",
      problem_title: "Test",
      problem_slug: "test"
    });

    expect(result).toBeNull();
  });

  it("returns null on network failure", async () => {
    vi.stubEnv(
      "VITE_COMPLEXITY_API_URL",
      "https://example.test/ai/complexity"
    );

    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("offline"));

    const { analyzeComplexity } =
      await import("./complexity-api");

    const result = await analyzeComplexity({
      code: "int main() {}",
      language: "cpp",
      problem_title: "Test",
      problem_slug: "test"
    });

    expect(result).toBeNull();
  });
});
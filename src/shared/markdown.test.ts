import { describe, it, expect } from "vitest";
import { generateMarkdown, patchMarkdownForVersion } from "./markdown";
import type { SubmissionPayload } from "./types";

const mockPayload = (overrides = {}): SubmissionPayload => ({
  problem_slug: "two-sum",
  problem_title: "Two Sum",
  language: "python",
  code: "class Solution:\n    pass",
  difficulty: "Easy",
  tags: ["array"],
  runtime_ms: 48,
  memory_mb: 17.2,
  submission_id: "123",
  timestamp: "2026-06-01T00:00:00.000Z",
  action: "overwrite",
  notes: "used a hashmap",
  ...overrides
});

describe("generateMarkdown", () => {
  it("includes the problem title", () => {
    const md = generateMarkdown(mockPayload(), "Arrays", "solutions/Arrays/two-sum.py");
    expect(md).toContain("# Two Sum");
  });

  it("includes the difficulty badge", () => {
    const md = generateMarkdown(mockPayload(), "Arrays", "solutions/Arrays/two-sum.py");
    expect(md).toContain("00b8a3"); // Easy color
  });

  it("includes the code", () => {
    const md = generateMarkdown(mockPayload(), "Arrays", "solutions/Arrays/two-sum.py");
    expect(md).toContain("class Solution:");
  });

  it("includes user notes in Approach section", () => {
    const md = generateMarkdown(mockPayload(), "Arrays", "solutions/Arrays/two-sum.py");
    expect(md).toContain("used a hashmap");
  });

  it("shows placeholder when no notes provided", () => {
    const md = generateMarkdown(mockPayload({ notes: "" }), "Arrays", "solutions/Arrays/two-sum.py");
    expect(md).toContain("describe your approach here");
  });

  it("includes runtime and memory", () => {
    const md = generateMarkdown(mockPayload(), "Arrays", "solutions/Arrays/two-sum.py");
    expect(md).toContain("48");
    expect(md).toContain("17.2");
  });
});

describe("patchMarkdownForVersion", () => {
  const baseMarkdown = generateMarkdown(mockPayload({ notes: "v1 approach" }), "Arrays", "solutions/Arrays/two-sum.py");

  it("appends version notes to Approach section", () => {
    const patched = patchMarkdownForVersion(baseMarkdown, mockPayload({ notes: "v2 is faster", runtime_ms: 10, memory_mb: 15 }), "two-sum", "py", 2, "2026-06-10");
    expect(patched).toContain("v1 approach");
    expect(patched).toContain("**v2 (2026-06-10):** v2 is faster");
  });

  it("appends runtime and memory to version note", () => {
    const patched = patchMarkdownForVersion(baseMarkdown, mockPayload({ notes: "faster", runtime_ms: 10, memory_mb: 15 }), "two-sum", "py", 2, "2026-06-10");
    expect(patched).toContain("10 ms");
    expect(patched).toContain("15 MB");
  });

  it("adds new row to Versions table", () => {
    const patched = patchMarkdownForVersion(baseMarkdown, mockPayload({ notes: "v2" }), "two-sum", "py", 2, "2026-06-10");
    expect(patched).toContain("two-sum_v2.py");
  });

  it("does not modify the code block", () => {
    const patched = patchMarkdownForVersion(baseMarkdown, mockPayload({ notes: "v2" }), "two-sum", "py", 2, "2026-06-10");
    expect(patched).toContain("class Solution:");
  });
});

it("renders complexity analysis when provided", () => {
  const payload = mockPayload({
    complexity: {
      time_complexity: "O(n)",
      space_complexity: "O(1)",
      explanation: "The algorithm scans the input once."
    }
  });

  const markdown = generateMarkdown(
    payload,
    "Arrays",
    "solutions/Arrays/two-sum.cpp"
  );

  expect(markdown).toContain("- **Time:** O(n)");
  expect(markdown).toContain("- **Space:** O(1)");
  expect(markdown).toContain(
    "The algorithm scans the input once."
  );
});

it("uses complexity placeholders when analysis is unavailable", () => {
  const markdown = generateMarkdown(
    mockPayload(),
    "Arrays",
    "solutions/Arrays/two-sum.cpp"
  );

  expect(markdown).toContain(
    "- **Time:** <!-- e.g. O(n) -->"
  );

  expect(markdown).toContain(
    "- **Space:** <!-- e.g. O(1) -->"
  );
});
it("renders zero runtime and memory", () => {
  const md = generateMarkdown(
    mockPayload({
      runtime_ms: 0,
      memory_mb: 0
    }),
    "Arrays",
    "solutions/Arrays/two-sum.py"
  );

  expect(md).toContain("**Runtime:** 0 ms");
  expect(md).toContain("**Memory:** 0 MB");
});

it("updates complexity when patching a version", () => {
  const base = generateMarkdown(
    mockPayload({
      complexity: undefined
    }),
    "Arrays",
    "solutions/Arrays/two-sum.py"
  );

  const patched = patchMarkdownForVersion(
    base,
    mockPayload({
      complexity: {
        time_complexity: "O(n)",
        space_complexity: "O(1)",
        explanation: "Scans the array once."
      }
    }),
    "two-sum",
    "py",
    2,
    "2026-07-13"
  );

  expect(patched).toContain("- **Time:** O(n)");
  expect(patched).toContain("- **Space:** O(1)");
  expect(patched).toContain("Scans the array once.");
});
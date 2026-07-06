import { describe, it, expect } from "vitest";
import { updateStats, defaultStats } from "./stats";
import type { SubmissionPayload } from "./types";

const mockPayload = (overrides = {}): SubmissionPayload => ({
  problem_slug: "two-sum",
  problem_title: "Two Sum",
  language: "python",
  code: "class Solution: pass",
  difficulty: "Easy",
  tags: ["array"],
  runtime_ms: 48,
  memory_mb: 17.2,
  submission_id: "123",
  timestamp: new Date().toISOString(),
  action: "overwrite",
  ...overrides
});

describe("updateStats", () => {
  it("increments total_solved", () => {
    const stats = defaultStats();
    const updated = updateStats(stats, mockPayload(), "Arrays");
    expect(updated.total_solved).toBe(1);
  });

  it("increments by_topic for the correct topic", () => {
    const stats = defaultStats();
    const updated = updateStats(stats, mockPayload(), "Arrays");
    expect(updated.by_topic["Arrays"]).toBe(1);
  });

  it("increments by_difficulty correctly", () => {
    const stats = defaultStats();
    const updated = updateStats(stats, mockPayload({ difficulty: "Hard" }), "Graphs");
    expect(updated.by_difficulty.Hard).toBe(1);
    expect(updated.by_difficulty.Easy).toBe(0);
  });

  it("sets streak to 1 on first solve", () => {
    const stats = defaultStats();
    const updated = updateStats(stats, mockPayload(), "Arrays");
    expect(updated.current_streak).toBe(1);
  });

  it("does not increment streak if already solved today", () => {
    const stats = defaultStats();
    const today = new Date().toISOString().split("T")[0];
    stats.last_solved_date = today;
    stats.current_streak = 5;
    const updated = updateStats(stats, mockPayload(), "Arrays");
    expect(updated.current_streak).toBe(5);
  });

  it("resets streak to 1 if last solve was more than 1 day ago", () => {
    const stats = defaultStats();
    stats.last_solved_date = "2020-01-01";
    stats.current_streak = 10;
    const updated = updateStats(stats, mockPayload(), "Arrays");
    expect(updated.current_streak).toBe(1);
  });

  it("keeps solve_log to max 10 entries", () => {
    let stats = defaultStats();
    for (let i = 0; i < 12; i++) {
      stats = updateStats(stats, mockPayload({ problem_slug: `problem-${i}` }), "Arrays");
    }
    expect(stats.solve_log.length).toBe(10);
  });

  it("puts newest solve first in solve_log", () => {
    let stats = defaultStats();
    stats = updateStats(stats, mockPayload({ problem_slug: "first" }), "Arrays");
    stats = updateStats(stats, mockPayload({ problem_slug: "second" }), "Arrays");
    expect(stats.solve_log[0].slug).toBe("second");
  });
});
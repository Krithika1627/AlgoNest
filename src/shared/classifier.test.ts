import { describe, it, expect } from "vitest";
import { classifyTopic } from "./classifier";

describe("classifyTopic", () => {
  it("maps dynamic-programming tag correctly", () => {
    expect(classifyTopic(["dynamic-programming"], "Some Problem", {}))
      .toBe("DynamicProgramming");
  });

  it("uses highest priority tag when multiple tags exist", () => {
    // tree is higher priority than array
    expect(classifyTopic(["array", "tree"], "Some Problem", {}))
      .toBe("Trees");
  });

  it("falls back to title keyword when tags are empty", () => {
    expect(classifyTopic([], "Binary Tree Inorder Traversal", {}))
      .toBe("Trees");
  });

  it("falls back to Misc when no tag or keyword matches", () => {
    expect(classifyTopic([], "Random Problem", {}))
      .toBe("Misc");
  });

  it("respects user overrides over canonical mapping", () => {
    expect(classifyTopic(["array"], "Two Sum", { array: "MyCustomFolder" }))
      .toBe("MyCustomFolder");
  });

  it("maps depth-first-search to Graphs", () => {
    expect(classifyTopic(["depth-first-search"], "Number of Islands", {}))
      .toBe("Graphs");
  });

  it("maps sliding-window tag correctly", () => {
    expect(classifyTopic(["sliding-window"], "Longest Substring", {}))
      .toBe("SlidingWindow");
  });

  it("classifies longest-substring as SlidingWindow not Strings when tag present", () => {
    expect(classifyTopic(["sliding-window", "string"], "Longest Substring Without Repeating Characters", {}))
        .toBe("SlidingWindow");
  });
});
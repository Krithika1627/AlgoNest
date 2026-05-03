const TAG_MAP: Record<string, string> = {
  "dynamic-programming": "DynamicProgramming",
  graph: "Graphs",
  tree: "Trees",
  "binary-search": "BinarySearch",
  "two-pointers": "TwoPointers",
  "sliding-window": "SlidingWindow",
  backtracking: "Backtracking",
  stack: "Stack",
  queue: "Queue",
  "heap-priority-queue": "Heap",
  "linked-list": "LinkedList",
  "binary-search-tree": "Trees",
  "depth-first-search": "Graphs",
  "breadth-first-search": "Graphs",
  "union-find": "Graphs",
  trie: "Trie",
  "bit-manipulation": "BitManipulation",
  math: "Math",
  string: "Strings",
  "hash-table": "Arrays",
  sorting: "Arrays",
  array: "Arrays"
};

const PRIORITY_TAGS = [
  "dynamic-programming",
  "graph",
  "tree",
  "binary-search",
  "two-pointers",
  "sliding-window",
  "backtracking",
  "stack",
  "queue",
  "heap-priority-queue",
  "linked-list",
  "binary-search-tree",
  "depth-first-search",
  "breadth-first-search",
  "union-find",
  "trie",
  "bit-manipulation",
  "math",
  "string",
  "hash-table",
  "sorting",
  "array"
];

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

export function classifyTopic(
  tags: string[],
  title: string,
  overrides: Record<string, string> = {}
): string {
  const overrideMap: Record<string, string> = {};
  for (const [key, value] of Object.entries(overrides)) {
    overrideMap[normalizeTag(key)] = value;
  }

  for (const tag of tags) {
    const normalized = normalizeTag(tag);
    if (overrideMap[normalized]) {
      return overrideMap[normalized];
    }
  }

  for (const tag of tags) {
    const normalized = normalizeTag(tag);
    if (PRIORITY_TAGS.includes(normalized)) {
      return TAG_MAP[normalized];
    }
  }

  const titleLower = title.toLowerCase();
  if (titleLower.includes("tree") || titleLower.includes("bst")) {
    return "Trees";
  }
  if (titleLower.includes("graph") || titleLower.includes("path")) {
    return "Graphs";
  }
  if (titleLower.includes("string") || titleLower.includes("substring")) {
    return "Strings";
  }
  if (titleLower.includes("sum") || titleLower.includes("array")) {
    return "Arrays";
  }
  return "Uncategorized";
}

const TAG_MAP: Record<string, string> = {
  "dynamic-programming": "DynamicProgramming",
  "dp": "DynamicProgramming",
  graph: "Graphs",
  "topological-sort": "Graphs",
  "shortest-path": "Graphs",
  "minimum-spanning-tree": "Graphs",
  "union-find": "Graphs",
  tree: "Trees",
  "binary-tree": "Trees",
  "binary-search": "BinarySearch",
  "two-pointers": "TwoPointers",
  "sliding-window": "SlidingWindow",
  backtracking: "Backtracking",
  recursion: "Recursion",
  "divide-and-conquer": "DivideAndConquer",
  greedy: "Greedy",
  intervals: "Intervals",
  "line-sweep": "Intervals",
  "prefix-sum": "PrefixSum",
  stack: "Stack",
  queue: "Queue",
  "monotonic-stack": "MonotonicStack",
  "monotonic-queue": "MonotonicQueue",
  "heap-priority-queue": "Heap",
  heap: "Heap",
  "linked-list": "LinkedList",
  "binary-search-tree": "Trees",
  "depth-first-search": "Graphs",
  "breadth-first-search": "Graphs",
  trie: "Trie",
  "bitmask": "Bitmask",
  "bit-manipulation": "BitManipulation",
  math: "Math",
  geometry: "Geometry",
  "probability-and-statistics": "Probability",
  string: "Strings",
  "string-matching": "Strings",
  "rolling-hash": "Strings",
  "hash-table": "Arrays",
  hashing: "Arrays",
  sorting: "Arrays",
  array: "Arrays",
  matrix: "Matrix",
  "binary-indexed-tree": "FenwickTree",
  "segment-tree": "SegmentTree",
  "ordered-set": "OrderedSet",
  counting: "Counting",
  combinatorics: "Combinatorics",
  simulation: "Simulation",
  design: "Design",
  "game-theory": "GameTheory",
  database: "Database",
  shell: "Shell"
};

const PRIORITY_TAGS = [
  "dynamic-programming",
  "dp",
  "graph",
  "topological-sort",
  "shortest-path",
  "minimum-spanning-tree",
  "union-find",
  "tree",
  "binary-tree",
  "binary-search",
  "two-pointers",
  "sliding-window",
  "backtracking",
  "recursion",
  "divide-and-conquer",
  "greedy",
  "intervals",
  "line-sweep",
  "prefix-sum",
  "stack",
  "queue",
  "monotonic-stack",
  "monotonic-queue",
  "heap-priority-queue",
  "heap",
  "linked-list",
  "binary-search-tree",
  "depth-first-search",
  "breadth-first-search",
  "trie",
  "bitmask",
  "bit-manipulation",
  "math",
  "geometry",
  "probability-and-statistics",
  "string",
  "string-matching",
  "rolling-hash",
  "hash-table",
  "hashing",
  "sorting",
  "array",
  "matrix",
  "binary-indexed-tree",
  "segment-tree",
  "ordered-set",
  "counting",
  "combinatorics",
  "simulation",
  "design",
  "game-theory",
  "database",
  "shell"
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
  return "Misc";
}

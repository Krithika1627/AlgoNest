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

  const normalizedTags = new Set(tags.map(normalizeTag));

  for (const tag of normalizedTags) {
    if (overrideMap[tag]) {
      return overrideMap[tag];
    }
  }

  for (const priorityTag of PRIORITY_TAGS) {
    if (normalizedTags.has(priorityTag)) {
      return TAG_MAP[priorityTag];
    }
  }

  const titleLower = title.toLowerCase();

  if (titleLower.includes("tree") || titleLower.includes("bst") || 
      titleLower.includes("trie")) return "Trees";

  if (titleLower.includes("graph") || titleLower.includes("path") ||
      titleLower.includes("island") || titleLower.includes("network") ||
      titleLower.includes("course") || titleLower.includes("route")) return "Graphs";

  if (titleLower.includes("string") || titleLower.includes("substring") ||
      titleLower.includes("palindrome") || titleLower.includes("anagram") ||
      titleLower.includes("parenthes") || titleLower.includes("bracket")) return "Strings";

  if (titleLower.includes("array") || titleLower.includes("subarray") ||
      titleLower.includes("matrix") || titleLower.includes("grid")) return "Arrays";

  if (titleLower.includes("list") || titleLower.includes("node") ||
      titleLower.includes("pointer")) return "LinkedList";

  if (titleLower.includes("stack") || titleLower.includes("queue")) return "Stack";

  if (titleLower.includes("search") || titleLower.includes("binary")) return "BinarySearch";

  if (titleLower.includes("dynamic") || titleLower.includes("maximum") ||
      titleLower.includes("minimum") || titleLower.includes("longest") ||
      titleLower.includes("shortest") || titleLower.includes("count") ||
      titleLower.includes("ways")) return "DynamicProgramming";

  if (titleLower.includes("sum") || titleLower.includes("number") ||
      titleLower.includes("integer") || titleLower.includes("digit")) return "Math";
  return "Misc";
}

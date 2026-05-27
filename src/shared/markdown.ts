import type { SubmissionPayload } from "./types";

const DIFFICULTY_BADGES: Record<string, string> = {
  Easy: "https://img.shields.io/badge/Easy-00b8a3?style=flat-square",
  Medium: "https://img.shields.io/badge/Medium-ffa116?style=flat-square",
  Hard: "https://img.shields.io/badge/Hard-ff375f?style=flat-square"
};

function safeDate(input: string): string {
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return parsed.toISOString().slice(0, 10);
}

function badge(label: string, url: string): string {
  return `![${label}](${url})`;
}

function encodeBadgeText(text: string): string {
  return encodeURIComponent(text);
}

function extractExtension(filePath: string): string {
  const fileName = filePath.split("/").pop() ?? "";
  const match = fileName.match(/\.([^.]+)$/);
  return match ? match[1] : "";
}

function extractVersion(filePath: string): number | null {
  const match = filePath.match(/_v(\d+)\.[^.]+$/);
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

function formatMetric(value: number, placeholder: string): string {
  if (Number.isFinite(value) && value > 0) {
    return String(value);
  }
  return `<!-- ${placeholder} -->`;
}

function buildVersionsTable(
  slug: string,
  ext: string,
  filePath: string,
  date: string
): string {
  const rows = [`| v1 | [${slug}.${ext}](./${slug}.${ext}) | ${date} |`];
  const version = extractVersion(filePath);
  if (version && version > 1) {
    rows.push(`| v${version} | [${slug}_v${version}.${ext}](./${slug}_v${version}.${ext}) | ${date} |`);
  }
  return [
    "| Version | File | Date |",
    "|---------|------|------|",
    ...rows
  ].join("\n");
}

export function generateMarkdown(
  payload: SubmissionPayload,
  topic: string,
  filePath: string
): string {
  const date = safeDate(payload.timestamp);
  const slug = payload.problem_slug;
  const ext = extractExtension(filePath) || "txt";
  const approach = payload.notes?.trim()
    ? payload.notes
    : "<!-- describe your approach here -->";

  const difficultyBadge = badge(payload.difficulty, DIFFICULTY_BADGES[payload.difficulty]);
  const topicBadge = badge(
    topic,
    `https://img.shields.io/badge/${encodeBadgeText(topic)}-0a84ff?style=flat-square`
  );
  const languageBadge = badge(
    payload.language,
    `https://img.shields.io/badge/${encodeBadgeText(payload.language)}-555555?style=flat-square`
  );
  const streakBadgePlaceholder = "<!-- streak badge placeholder -->";

  const runtime = formatMetric(payload.runtime_ms, "runtime_ms");
  const memory = formatMetric(payload.memory_mb, "memory_mb");

  const versionsTable = buildVersionsTable(slug, ext, filePath, date);
  const fence = "```";

  return `---
# ${payload.problem_title}

<!-- badges -->
${difficultyBadge}  ${topicBadge}  ${languageBadge}  ${streakBadgePlaceholder}

**LeetCode:** https://leetcode.com/problems/${slug}/  
**Solved:** ${date}  
**Runtime:** ${runtime} ms | **Memory:** ${memory} MB

---

## Approach
${approach}

## Complexity
- **Time:** <!-- e.g. O(n) -->
- **Space:** <!-- e.g. O(1) -->

## Solution

${fence}${ext}
${payload.code}
${fence}

## Versions
${versionsTable}

## Mistakes & Notes
<!-- post-solve reflections: what did you miss, what patterns did you notice -->

## Related Problems
<!-- links to related problems will be auto-populated in Part 3 -->

---
`;
}

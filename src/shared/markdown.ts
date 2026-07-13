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

function formatMetric(value: number): string {
  return Number.isFinite(value)
    ? String(value)
    : "N/A";
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

  const runtime = formatMetric(payload.runtime_ms);
  const memory = formatMetric(payload.memory_mb);

  const versionsTable = buildVersionsTable(slug, ext, filePath, date);
  const fence = "```";

  const timeComplexity = payload.complexity?.time_complexity ?? "<!-- e.g. O(n) -->";
  const spaceComplexity = payload.complexity?.space_complexity ?? "<!-- e.g. O(1) -->";
  const complexityExplanation = payload.complexity?.explanation?.trim();

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
- **Time:** ${timeComplexity}
- **Space:** ${spaceComplexity}
${complexityExplanation ? `\n${complexityExplanation}` : ""}

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

function appendVersionRow(markdown: string, row: string): string {
  if (markdown.includes(row)) {
    return markdown;
  }

  const lines = markdown.split("\n");
  const headerIndex = lines.findIndex((line) => line.trim() === "## Versions");
  if (headerIndex === -1) {
    return `${markdown.trimEnd()}\n\n## Versions\n| Version | File | Date |\n|---------|------|------|\n${row}\n`;
  }

  let tableStart = -1;
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("## ")) {
      break;
    }
    if (trimmed.startsWith("|")) {
      tableStart = i;
      break;
    }
  }

  if (tableStart === -1) {
    const insertAt = headerIndex + 1;
    const tableBlock = [
      "| Version | File | Date |",
      "|---------|------|------|",
      row
    ];
    lines.splice(insertAt, 0, ...tableBlock);
    return lines.join("\n");
  }

  let insertAt = tableStart + 1;
  for (let i = tableStart + 1; i < lines.length; i += 1) {
    if (!lines[i].trim().startsWith("|")) {
      insertAt = i;
      break;
    }
    insertAt = i + 1;
  }

  lines.splice(insertAt, 0, row);
  return lines.join("\n");
}

export function patchMarkdownForVersion(
  existingContent: string,
  payload: SubmissionPayload,
  slug: string,
  ext: string,
  version: number,
  date: string
): string {
  let patched = existingContent;

  if (payload.notes?.trim()) {
    const runtime = Number.isFinite(payload.runtime_ms) ? ` · ${payload.runtime_ms} ms` : "";
    const memory = Number.isFinite(payload.memory_mb) ? ` · ${payload.memory_mb} MB` : "";
    const versionNote = `\n\n**v${version} (${date}):** ${payload.notes.trim()}${runtime}${memory}`;
    const approachIndex = patched.indexOf("## Approach");
    if (approachIndex !== -1) {
      const nextSection = patched.indexOf("\n## ", approachIndex + 11);
      const insertPoint = nextSection !== -1 ? nextSection : patched.length;
      patched = patched.slice(0, insertPoint) + versionNote + patched.slice(insertPoint);
    }
  }
  if (payload.complexity) {
    const explanation = payload.complexity.explanation?.trim();

    const complexitySection = `## Complexity
    - **Time:** ${payload.complexity.time_complexity}
    - **Space:** ${payload.complexity.space_complexity}${
      explanation ? `\n\n${explanation}` : ""
    }`;

    patched = patched.replace(
      /## Complexity[\s\S]*?(?=\n## Solution)/,
      `${complexitySection}\n`
    );
  }

  const versionRow = `| v${version} | [${slug}_v${version}.${ext}](./${slug}_v${version}.${ext}) | ${date} |`;
  return appendVersionRow(patched, versionRow);
}

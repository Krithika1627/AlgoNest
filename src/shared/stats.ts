import type { SubmissionPayload } from "./types";
import { getFileContent, putFile } from "./github-api";

export type StatsEntry = {
  slug: string;
  title: string;
  topic: string;
  difficulty: string;
  language: string;
  date: string;
};

export type StatsData = {
  total_solved: number;
  by_topic: Record<string, number>;
  by_difficulty: Record<string, number>;
  by_language: Record<string, number>;
  current_streak: number;
  longest_streak: number;
  last_solved_date: string;
  solve_log: StatsEntry[];
};

function base64Decode(content: string): string {
  const normalized = content.replace(/\s/g, "");
  return decodeURIComponent(escape(atob(normalized)));
}

function todayString(): string {
  return new Date().toISOString().split("T")[0];
}

function yesterdayString(today: string): string {
  const current = new Date(`${today}T00:00:00Z`);
  current.setUTCDate(current.getUTCDate() - 1);
  return current.toISOString().split("T")[0];
}

function normalizeLanguage(value: string): string {
  return value.trim().toLowerCase();
}

export function defaultStats(): StatsData {
  return {
    total_solved: 0,
    by_topic: {},
    by_difficulty: {
      Easy: 0,
      Medium: 0,
      Hard: 0
    },
    by_language: {},
    current_streak: 0,
    longest_streak: 0,
    last_solved_date: "",
    solve_log: []
  };
}

export async function fetchStats(
  token: string,
  repoFullName: string,
  branch: string
): Promise<{ stats: StatsData; sha: string | null }> {
  const result = await getFileContent(token, repoFullName, "stats/stats.json", branch);
  if (!result) {
    return { stats: defaultStats(), sha: null };
  }

  try {
    const decoded = base64Decode(result.content);
    const parsed = JSON.parse(decoded) as StatsData;
    return { stats: parsed, sha: result.sha };
  } catch {
    return { stats: defaultStats(), sha: result.sha };
  }
}

export function updateStats(
  stats: StatsData,
  payload: SubmissionPayload,
  topic: string,
): StatsData {
  const next: StatsData = {
    ...stats,
    by_topic: { ...stats.by_topic },
    by_difficulty: { ...stats.by_difficulty },
    by_language: { ...stats.by_language },
    solve_log: [...stats.solve_log]
  };

  next.total_solved += 1;

  next.by_topic[topic] = (next.by_topic[topic] ?? 0) + 1;
  next.by_difficulty[payload.difficulty] =
    (next.by_difficulty[payload.difficulty] ?? 0) + 1;

  const langKey = normalizeLanguage(payload.language || "unknown");
  next.by_language[langKey] = (next.by_language[langKey] ?? 0) + 1;

  const today = todayString();
  const last = next.last_solved_date;
  if (last !== today) {
    const yesterday = yesterdayString(today);
    if (last === yesterday) {
      next.current_streak = (next.current_streak || 0) + 1;
    } else {
      next.current_streak = 1;
    }
    next.longest_streak = Math.max(next.longest_streak, next.current_streak);
    next.last_solved_date = today;
  }

  next.solve_log.unshift({
    slug: payload.problem_slug,
    title: payload.problem_title,
    topic,
    difficulty: payload.difficulty,
    language: langKey,
    date: today,
  });
  next.solve_log = next.solve_log.slice(0, 10);

  return next;
}

export async function commitStats(
  token: string,
  repoFullName: string,
  branch: string,
  stats: StatsData,
  existingSHA: string | null
): Promise<void> {
  const slug = stats.solve_log[0]?.slug ?? "solution";
  const content = JSON.stringify(stats, null, 2);
  await putFile(
    token,
    repoFullName,
    "stats/stats.json",
    content,
    `stats: update after solving ${slug}`,
    branch,
    existingSHA ?? undefined
  );
}

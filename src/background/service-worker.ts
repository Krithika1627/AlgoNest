import { classifyTopic } from "../shared/classifier";
import { DEFAULT_SETTINGS } from "../shared/defaults";
import { generateMarkdown } from "../shared/markdown";
import { generateREADME } from "../shared/readme";
import { fetchStats, updateStats, StatsData } from "../shared/stats";
import type {
  CommitResult,
  PendingDocsPayload,
  QueuedSubmission,
  SubmissionPayload,
  UserSettings
} from "../shared/types";
import {
  AuthError,
  NetworkError,
  RateLimitError,
  commitMultipleFiles,
  getFileContent,
  getFileSHA
} from "../shared/github-api";

const STORAGE_KEYS = {
  settings: "settings",
  pending: "pending_submission",
  queue: "submission_queue",
  hashes: "code_hashes",
  authError: "auth_error",
  lastSubmission: "last_submission",
  pendingDocs: "pending_docs"
} as const;

const EXT_MAP: Record<string, string> = {
  python: "py",
  cpp: "cpp",
  c: "c",
  java: "java",
  javascript: "js",
  typescript: "ts",
  go: "go",
  cs: "cs",
  kt: "kt",
  swift: "swift",
  rust: "rs",
  ruby: "rb",
  php: "php",
  scala: "scala",
  dart: "dart",
  r: "r",
  sql: "sql",
  sh: "sh",
  objectivec: "m",
  objectivecpp: "mm",
  fsharp: "fs",
  ocaml: "ml",
  haskell: "hs",
  lua: "lua",
  perl: "pl"
};

function openPopupWindow(): void {
  chrome.windows.create(
    {
      url: chrome.runtime.getURL("src/popup/index.html"),
      type: "popup",
      width: 380,
      height: 600
    },
    () => {
      void chrome.runtime.lastError;
    }
  );
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("queue-flush", { periodInMinutes: 5 });
  chrome.alarms.create("keepalive", { periodInMinutes: 0.4 });
});

chrome.alarms.onAlarm.addListener((alarm: chrome.alarms.Alarm) => {
  if (alarm.name === "queue-flush") {
    void flushQueue();
  }
  if (alarm.name === "keepalive") {
    // no-op, just keeps SW alive
  }
});

chrome.runtime.onMessage.addListener(
  (
    message: { type: string; [key: string]: unknown },
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ) => {
    console.log("📥 MESSAGE RECEIVED:", message);
    if (message.type === "SUBMISSION_DETECTED") {
      handleSubmission(message.payload as SubmissionPayload).then(sendResponse);
      return true;
    }
    if (message.type === "POPUP_RESPONSE") {
      handleSubmission(message.payload as SubmissionPayload).then(sendResponse);
      return true;
    }
    if (message.type === "GET_SETTINGS") {
      getSettings().then(sendResponse);
      return true;
    }
    if (message.type === "SAVE_SETTINGS") {
      saveSettings(message.settings as UserSettings).then(sendResponse);
      return true;
    }
    if (message.type === "FLUSH_QUEUE") {
      flushQueue().then(sendResponse);
      return true;
    }
    if (message.type === "GET_QUEUE_COUNT") {
      getQueueCount().then(sendResponse);
      return true;
    }
    if (message.type === "PING") {
      sendResponse({ ok: true });
      return true;
    }
    return false;
  }
);

async function getFromStorage<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result: Record<string, unknown>) => {
      resolve(result[key] as T | undefined);
    });
  });
}

async function setStorage(values: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(values, () => resolve());
  });
}

async function removeStorage(keys: string | string[]): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove(keys, () => resolve());
  });
}

export async function getSettings(): Promise<UserSettings> {
  const stored = await getFromStorage<UserSettings>(STORAGE_KEYS.settings);
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    classification_overrides: stored?.classification_overrides ?? {}
  };
}

export async function saveSettings(settings: UserSettings): Promise<UserSettings> {
  const next = {
    ...DEFAULT_SETTINGS,
    ...settings,
    classification_overrides: settings.classification_overrides ?? {}
  };
  await setStorage({ [STORAGE_KEYS.settings]: next, [STORAGE_KEYS.authError]: false });
  return next;
}

export async function handleSubmission(payload: SubmissionPayload): Promise<CommitResult> {
  try {
    console.info("AlgoNest: handleSubmission", payload.problem_slug, payload.submission_id);
    const settings = await getSettings();
    if (!settings.github_token || !settings.repo_full_name) {
      return { status: "error", message: "Not configured" };
    }

    const normalizedPayload: SubmissionPayload = {
      ...payload,
      action: payload.action ?? settings.default_action,
      timestamp: payload.timestamp ?? new Date().toISOString()
    };

    if (normalizedPayload.notes === undefined) {
      const isDuplicate = await isDuplicateSubmission(normalizedPayload);
      if (isDuplicate) {
        return { status: "skipped", message: "Duplicate submission" };
      }
    }

    await removeStorage(STORAGE_KEYS.pending);

    if (normalizedPayload.notes !== undefined) {
      await markLastSubmission(normalizedPayload);
    }

    if (!settings.silent_mode && normalizedPayload.notes === undefined) {
      const pending = await getFromStorage<SubmissionPayload>(STORAGE_KEYS.pending);
      if (pending && getSubmissionKey(pending) === getSubmissionKey(normalizedPayload)) {
        return { status: "queued", message: "Already pending" };
      }
      await setStorage({ [STORAGE_KEYS.pending]: normalizedPayload });
      try {
        chrome.action.openPopup(() => {
          if (chrome.runtime.lastError) {
            openPopupWindow();
          }
        });
      } catch {
        openPopupWindow();
      }
      return { status: "queued", message: "Waiting for popup" };
    }

    try {
      const result = await commitSolution(normalizedPayload, settings);
      console.info("AlgoNest: commit result", result.status, result.file_path);
      return result;
    } catch (err) {
      if (isRetryableError(err)) {
        await enqueue(normalizedPayload);
        console.warn("AlgoNest: queued for retry", err);
        return { status: "queued", message: "Queued for retry" };
      }
      if (err instanceof AuthError) {
        await setStorage({ [STORAGE_KEYS.authError]: true });
        return { status: "error", message: "Authentication required" };
      }
      return {
        status: "error",
        message: err instanceof Error ? err.message : "Unknown error"
      };
    }
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Unknown error"
    };
  }
}

function normalizeLanguage(raw: string): string {
  const value = raw.trim().toLowerCase();
  const cleaned = value.replace(/\([^)]*\)/g, "").trim();
  const compact = cleaned.replace(/[\s-]+/g, "");
  const map: Record<string, string> = {
    python3: "python",
    python: "python",
    py: "python",
    "python2": "python",
    "python 3": "python",
    cpp: "cpp",
    "c++": "cpp",
    cplusplus: "cpp",
    c: "c",
    java: "java",
    javascript: "javascript",
    js: "javascript",
    typescript: "typescript",
    ts: "typescript",
    golang: "go",
    go: "go",
    csharp: "cs",
    "c#": "cs",
    "csharp.net": "cs",
    kotlin: "kt",
    swift: "swift",
    rust: "rust",
    rustlang: "rust",
    ruby: "ruby",
    php: "php",
    scala: "scala",
    dart: "dart",
    r: "r",
    mysql: "sql",
    mssql: "sql",
    postgres: "sql",
    postgresql: "sql",
    bash: "sh",
    shell: "sh",
    zsh: "sh",
    "objective-c": "objectivec",
    objectivec: "objectivec",
    "objective-c++": "objectivecpp",
    objectivecpp: "objectivecpp",
    "f#": "fsharp",
    fsharp: "fsharp",
    ocaml: "ocaml",
    haskell: "haskell",
    lua: "lua",
    perl: "perl"
  };

  return map[cleaned] ?? map[compact] ?? map[value] ?? cleaned;
}

function safeDate(input: string): string {
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return parsed.toISOString().slice(0, 10);
}

function decodeGitHubContent(content: string): string {
  const normalized = content.replace(/\s/g, "");
  return decodeURIComponent(escape(atob(normalized)));
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

async function commitSolution(
  payload: SubmissionPayload,
  settings: UserSettings
): Promise<CommitResult> {
  if (payload.action === "skip") {
    await markLastSubmission(payload);
    return { status: "skipped", message: "Skipped by user" };
  }

  if (!payload.code) {
    return { status: "error", message: "Missing code" };
  }

  const topic = payload.topic_override ?? classifyTopic(
    payload.tags,
    payload.problem_title,
    settings.classification_overrides
  );

  const normalizedLanguage = normalizeLanguage(payload.language);
  const ext = EXT_MAP[normalizedLanguage] ?? "txt";

  const slug = payload.problem_slug
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-");

  const codeHash = await sha256(payload.code);
  const existingHash = await getStoredHash(slug);
  if (codeHash === existingHash && payload.action === "overwrite") {
    return { status: "skipped", topic };
  }

  let filePath = `solutions/${topic}/${slug}.${ext}`;
  let version = 1;
  if (payload.action === "version") {
    version = await getNextVersion(slug, topic, ext, settings);
    if (version > 1) {
      filePath = `solutions/${topic}/${slug}_v${version}.${ext}`;
    }
  }

  const mdPath = `solutions/${topic}/${slug}.md`;

  // --- Build docs content ---
  let mdContent = generateMarkdown(payload, topic, filePath);

  if (payload.action === "version") {
    const mdFile = await getFileContent(
      settings.github_token,
      settings.repo_full_name,
      mdPath,
      settings.branch
    );
    if (mdFile?.content) {
      const date = safeDate(payload.timestamp);
      const decoded = decodeGitHubContent(mdFile.content);

      let patched = decoded;
      if (payload.notes?.trim()) {
        const runtime = payload.runtime_ms > 0 ? ` · ${payload.runtime_ms} ms` : "";
        const memory = payload.memory_mb > 0 ? ` · ${payload.memory_mb} MB` : "";
        const versionNote = `\n\n**v${version} (${date}):** ${payload.notes.trim()}${runtime}${memory}`;
        const approachIndex = patched.indexOf("## Approach");
        if (approachIndex !== -1) {
          const nextSection = patched.indexOf("\n## ", approachIndex + 11);
          const insertPoint = nextSection !== -1 ? nextSection : patched.length;
          patched = patched.slice(0, insertPoint) + versionNote + patched.slice(insertPoint);
        }
      }

      const versionRow = `| v${version} | [${slug}_v${version}.${ext}](./${slug}_v${version}.${ext}) | ${date} |`;
      mdContent = appendVersionRow(patched, versionRow);
    }
  }

  // --- Build commit messages ---
  const topicLabel = topic;
  const approach = payload.notes?.split(" ").slice(0, 5).join(" ") ?? "";
  const codeSHA = await getFileSHA(
    settings.github_token,
    settings.repo_full_name,
    filePath,
    settings.branch
  );
  const actionLabel = codeSHA && payload.action !== "version" ? "update" : "add";
  const codeCommitMessage =
    payload.action === "version"
      ? `[${topicLabel}] ${slug} · ${payload.language} · v${version}`
      : settings.commit_message_style === "rich"
        ? `[${topicLabel}] ${slug} · ${payload.language} · ${actionLabel}${approach ? ` (${approach})` : ""}`
        : `Add ${slug}`;

  const docsCommitMessage = `docs: ${slug} explanation`;

  // --- Fetch and update stats ---
  const { stats } = await fetchStats(
    settings.github_token,
    settings.repo_full_name,
    settings.branch
  );

  // We use a placeholder commit SHA for stats; it gets replaced with the real one after commit 1
  const tempCommitSha = "pending";
  const updatedStats = updateStats(stats, payload, topic, tempCommitSha);
  const statsContent = JSON.stringify(updatedStats, null, 2);

  // --- COMMIT 1: solution code + stats.json ---
  console.info("AlgoNest: starting commit 1 (code + stats)", filePath);
  const commitSha = await commitMultipleFiles(
    settings.github_token,
    settings.repo_full_name,
    settings.branch,
    [
      { path: filePath, content: payload.code },
      { path: "stats/stats.json", content: statsContent }
    ],
    codeCommitMessage
  );
  console.info("AlgoNest: commit 1 succeeded", commitSha);

  // Cache stats locally for popup display (upstream feature)
  await setStorage({ cached_stats: updatedStats });

  // Patch the commit_sha in stats log now that we have the real SHA
  updatedStats.solve_log[0] = { ...updatedStats.solve_log[0], commit_sha: commitSha };

  // --- Build README using final stats ---
  const readmeContent = generateREADME(updatedStats, settings.repo_full_name.split("/")[1]);

  // --- COMMIT 2: markdown explanation + README ---
  console.info("AlgoNest: starting commit 2 (docs + README)", mdPath);
  try {
    const docsCommitSha = await commitMultipleFiles(
      settings.github_token,
      settings.repo_full_name,
      settings.branch,
      [
        { path: mdPath, content: mdContent },
        { path: "README.md", content: readmeContent }
      ],
      docsCommitMessage,
      commitSha  // Use commit 1 SHA as parent since HEAD just moved
    );
    console.info("AlgoNest: commit 2 succeeded", docsCommitSha);
  } catch (err) {
    // Code is already committed — store docs for retry on next flush
    console.error("AlgoNest: commit 2 failed", err);
    if (isRetryableError(err)) {
      const pendingDocs: PendingDocsPayload = {
        mdPath,
        mdContent,
        readmeContent,
        commitMessage: docsCommitMessage,
        slug
      };
      await setStorage({ [STORAGE_KEYS.pendingDocs]: pendingDocs });
      console.warn("AlgoNest: docs commit failed, stored for retry", err);
    } else {
      console.error("AlgoNest: docs commit failed (non-retryable), error details:",
        err instanceof Error ? err.message : String(err));
    }
  }

  await storeHash(slug, codeHash);
  await markLastSubmission(payload);

  return {
    status: payload.action === "version" ? "versioned" : "committed",
    topic,
    file_path: filePath,
    commit_sha: commitSha,
    commit_message: codeCommitMessage,
    version
  };
}

function getSubmissionKey(payload: SubmissionPayload): string {
  const id = payload.submission_id?.trim();
  if (id) {
    return id;
  }
  return `${payload.problem_slug}:${payload.timestamp}`;
}

async function isDuplicateSubmission(payload: SubmissionPayload): Promise<boolean> {
  const last = await getFromStorage<{ key: string; at: string }>(STORAGE_KEYS.lastSubmission);
  if (!last) {
    return false;
  }
  if (last.key !== getSubmissionKey(payload)) {
    return false;
  }
  const lastAt = new Date(last.at).getTime();
  if (Number.isNaN(lastAt)) {
    return false;
  }
  return Date.now() - lastAt < 60000;
}

async function markLastSubmission(payload: SubmissionPayload): Promise<void> {
  await setStorage({
    [STORAGE_KEYS.lastSubmission]: {
      key: getSubmissionKey(payload),
      at: new Date().toISOString()
    }
  });
}

async function getNextVersion(
  slug: string,
  topic: string,
  ext: string,
  settings: UserSettings
): Promise<number> {
  let version = 2;
  while (version < 100) {
    const path = `solutions/${topic}/${slug}_v${version}.${ext}`;
    const sha = await getFileSHA(
      settings.github_token,
      settings.repo_full_name,
      path,
      settings.branch
    );
    if (!sha) {
      return version;
    }
    version += 1;
  }
  return version;
}

async function enqueue(payload: SubmissionPayload): Promise<void> {
  const queue = (await getQueue()) ?? [];
  queue.push({
    payload,
    queued_at: new Date().toISOString(),
    retry_count: 0
  });
  await setStorage({ [STORAGE_KEYS.queue]: queue });
}

async function flushQueue(): Promise<{ processed: number; remaining: number }> {
  const settings = await getSettings();

  // --- Retry pending docs commit from a previous solve ---
  const pendingDocs = await getFromStorage<PendingDocsPayload>(STORAGE_KEYS.pendingDocs);
  if (pendingDocs) {
    try {
      await commitMultipleFiles(
        settings.github_token,
        settings.repo_full_name,
        settings.branch,
        [
          { path: pendingDocs.mdPath, content: pendingDocs.mdContent },
          { path: "README.md", content: pendingDocs.readmeContent }
        ],
        pendingDocs.commitMessage
      );
      await removeStorage(STORAGE_KEYS.pendingDocs);
      console.info("AlgoNest: pending docs committed successfully", pendingDocs.slug);
    } catch (err) {
      if (err instanceof AuthError) {
        await setStorage({ [STORAGE_KEYS.authError]: true });
        console.warn("AlgoNest: pending docs retry failed — auth error");
        return { processed: 0, remaining: (await getQueue())?.length ?? 0 };
      }
      // Leave pendingDocs in storage for the next flush if retryable
      console.warn("AlgoNest: pending docs retry failed, will retry next flush", err);
    }
  }

  // --- Process the submission queue ---
  const queue = (await getQueue()) ?? [];
  const nextQueue: QueuedSubmission[] = [];
  let processed = 0;

  for (const item of queue) {
    try {
      await commitSolution(item.payload, settings);
      processed += 1;
    } catch (err) {
      if (err instanceof AuthError) {
        await setStorage({ [STORAGE_KEYS.authError]: true });
        nextQueue.push(item);
        break;
      }

      if (isRetryableError(err)) {
        const retryCount = item.retry_count + 1;
        if (retryCount <= 3) {
          nextQueue.push({ ...item, retry_count: retryCount });
        }
      } else {
        nextQueue.push(item);
      }
    }
  }

  await setStorage({ [STORAGE_KEYS.queue]: nextQueue });
  return { processed, remaining: nextQueue.length };
}

async function getQueue(): Promise<QueuedSubmission[] | undefined> {
  return getFromStorage<QueuedSubmission[]>(STORAGE_KEYS.queue);
}

async function getQueueCount(): Promise<number> {
  const queue = await getQueue();
  return queue?.length ?? 0;
}

async function getStoredHash(slug: string): Promise<string | undefined> {
  const hashes = (await getFromStorage<Record<string, string>>(STORAGE_KEYS.hashes)) ?? {};
  return hashes[slug];
}

async function storeHash(slug: string, hash: string): Promise<void> {
  const hashes = (await getFromStorage<Record<string, string>>(STORAGE_KEYS.hashes)) ?? {};
  hashes[slug] = hash;
  await setStorage({ [STORAGE_KEYS.hashes]: hashes });
}

async function sha256(text: string): Promise<string> {
  const encoded = new TextEncoder().encode(text);
  const buffer = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function isRetryableError(err: unknown): boolean {
  return err instanceof NetworkError || err instanceof RateLimitError;
}

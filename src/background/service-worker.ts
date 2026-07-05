import { classifyTopic } from "../shared/classifier";
import { DEFAULT_SETTINGS } from "../shared/defaults";
import { generateMarkdown, patchMarkdownForVersion } from "../shared/markdown";
import { generateREADME } from "../shared/readme";
import { commitStats, fetchStats, updateStats, StatsData } from "../shared/stats";
import type {
  CommitResult,
  QueuedSubmission,
  SubmissionPayload,
  UserSettings
} from "../shared/types";
import {
  AuthError,
  NetworkError,
  RateLimitError,
  getFileContent,
  getFileSHA,
  putFile
} from "../shared/github-api";

void chrome.storage.local.setAccessLevel({
  accessLevel: "TRUSTED_CONTEXTS"
});

const STORAGE_KEYS = {
  settings: "settings",
  pending: "pending_submission",
  queue: "submission_queue",
  hashes: "code_hashes",
  authError: "auth_error",
  lastSubmission: "last_submission"
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
    if (message.type === "GET_CONTENT_CONFIG") {
      void getSettings()
        .then((settings) => {
          sendResponse({
            debounce_ms: settings.debounce_ms
          });
        })
        .catch(() => {
          sendResponse({
            debounce_ms: 3000
          });
        });

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

  const codeSHA = await getFileSHA(
    settings.github_token,
    settings.repo_full_name,
    filePath,
    settings.branch
  );

  let mdContent = generateMarkdown(payload, topic, filePath);
  let mdSHA: string | null = null;

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

      mdContent = patchMarkdownForVersion(decoded, payload, slug, ext, version, date);
      mdSHA = mdFile.sha;
    }
  } else {
    mdSHA = await getFileSHA(
      settings.github_token,
      settings.repo_full_name,
      mdPath,
      settings.branch
    );
  }

  const topicLabel = topic;
  const approach = payload.notes?.split(" ").slice(0, 5).join(" ") ?? "";
  const actionLabel = codeSHA && payload.action !== "version" ? "update" : "add";
  const message =
    payload.action === "version"
      ? `[${topicLabel}] ${slug} · ${payload.language} · v${version}`
      : settings.commit_message_style === "rich"
        ? `[${topicLabel}] ${slug} · ${payload.language} · ${actionLabel}${
            approach ? ` (${approach})` : ""
          }`
        : `Add ${slug}`;

  const commitSHA = await putFile(
    settings.github_token,
    settings.repo_full_name,
    filePath,
    payload.code,
    message,
    settings.branch,
    codeSHA ?? undefined
  );

  let markdownCommitted = false;
  try {
    await putFile(
      settings.github_token,
      settings.repo_full_name,
      mdPath,
      mdContent,
      `docs: ${slug} explanation`,
      settings.branch,
      mdSHA ?? undefined
    );
    markdownCommitted = true;
  } catch (err) {
    console.warn("Markdown commit failed", err);
  }

  if (markdownCommitted) {
    const { stats, sha } = await fetchStats(
      settings.github_token,
      settings.repo_full_name,
      settings.branch
    );
    const updated = updateStats(stats, payload, topic, commitSHA);
    await commitStats(
      settings.github_token,
      settings.repo_full_name,
      settings.branch,
      updated,
      sha
    );
    await setStorage({ cached_stats: updated });

    const readmeSHA = await getFileSHA(settings.github_token, settings.repo_full_name, "README.md", settings.branch);
    const readmeContent = generateREADME(updated, settings.repo_full_name.split("/")[1]);
    try {
      await putFile(settings.github_token, settings.repo_full_name, "README.md", readmeContent,
        "docs: update README", settings.branch, readmeSHA ?? undefined);
    } catch(e) { console.warn("README commit failed", e); }
  }

  await storeHash(slug, codeHash);
  await markLastSubmission(payload);

  return {
    status: payload.action === "version" ? "versioned" : "committed",
    topic,
    file_path: filePath,
    commit_sha: commitSHA,
    commit_message: message,
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

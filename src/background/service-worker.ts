import { classifyTopic } from "../shared/classifier";
import { DEFAULT_SETTINGS } from "../shared/defaults";
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
  getFileSHA,
  putFile
} from "../shared/github-api";

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

  const topic = classifyTopic(
    payload.tags,
    payload.problem_title,
    settings.classification_overrides
  );

  const ext = EXT_MAP[payload.language] ?? "txt";

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

  const mdContent = generateMarkdown(payload, topic, filePath);
  const mdPath = `solutions/${topic}/${slug}.md`;

  const [codeSHA, mdSHA] = await Promise.all([
    getFileSHA(settings.github_token, settings.repo_full_name, filePath, settings.branch),
    getFileSHA(settings.github_token, settings.repo_full_name, mdPath, settings.branch)
  ]);

  const topicLabel = topic;
  const approach = payload.notes?.split(" ").slice(0, 5).join(" ") ?? "";
  const actionLabel = codeSHA && payload.action !== "version" ? "update" : "add";
  const message =
    settings.commit_message_style === "rich"
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
  } catch (err) {
    console.warn("Markdown commit failed", err);
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

function generateMarkdown(
  payload: SubmissionPayload,
  topic: string,
  _filePath: string
): string {
  const date = new Date(payload.timestamp).toISOString().slice(0, 10);
  const slug = payload.problem_slug;
  const ext = EXT_MAP[payload.language] ?? payload.language;
  const fence = "```";
  const approach = payload.notes?.trim()
    ? payload.notes
    : "<!-- add your approach here -->";
  const formatMetric = (value: unknown, unit: string): string => {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return `${value} ${unit}`;
    }
    return "N/A";
  };
  const runtimeLabel = formatMetric(payload.runtime_ms, "ms");
  const memoryLabel = formatMetric(payload.memory_mb, "MB");

  return `# ${payload.problem_title}\n\n**Difficulty:** ${payload.difficulty} | **Topic:** ${topic} | **Language:** ${payload.language}  \n**Solved:** ${date}  \n**LeetCode:** https://leetcode.com/problems/${slug}/\n\n## Approach\n${approach}\n\n## Complexity\n- Time: <!-- e.g. O(n) -->\n- Space: <!-- e.g. O(1) -->\n\n## Solution\n${fence}${ext}\n${payload.code}\n${fence}\n\n## Runtime & Memory\n- Runtime: ${runtimeLabel}\n- Memory: ${memoryLabel}\n\n## Mistakes & Notes\n<!-- use this section for post-solve reflections -->\n\n## Related Problems\n<!-- links to similar problems will be added in Part 2 -->\n`;
}

function isRetryableError(err: unknown): boolean {
  return err instanceof NetworkError || err instanceof RateLimitError;
}

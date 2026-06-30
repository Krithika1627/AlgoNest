import type { SubmissionPayload } from "../shared/types";

const DEFAULT_DEBOUNCE_MS = 3000;
const ALGONEST_SOURCE = "algonest";
const ACCEPTED_COOLDOWN_MS = 15000;
const SUBMIT_ARM_WINDOW_MS = 5 * 60 * 1000;
let debounceMs = DEFAULT_DEBOUNCE_MS;
let lastSubmissionId = "";
let lastSentAt = 0;
let debounceTimer: number | undefined;
let lastAcceptedSlug = "";
let lastAcceptedAt = 0;
let lastDetectedSlug = "";
let lastDetectedAt = 0;
let submitArmed = false;
let submitArmedAt = 0;
let hasSentForSubmit = false;
let lastHandledSlug = "";
let submissionHandled = false;
let capturedCode = "";
let capturedDifficulty = "";

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

function normalizeDifficulty(raw: string | null | undefined): "Easy" | "Medium" | "Hard" {
  const value = (raw ?? "").toLowerCase();
  if (value.includes("hard")) {
    return "Hard";
  }
  if (value.includes("medium")) {
    return "Medium";
  }
  return "Easy";
}

function parseNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  const match = String(value ?? "").match(/([\d.]+)/);
  return match ? Number(match[1]) : 0;
}

function normalizeTimestamp(raw: unknown): string {
  if (typeof raw === "number") {
    const ms = raw < 1e12 ? raw * 1000 : raw;
    return new Date(ms).toISOString();
  }
  if (typeof raw === "string" && raw.trim().length > 0) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return new Date().toISOString();
}

function extractTags(input: unknown): string[] {
  if (Array.isArray(input)) {
    if (input.length === 0) {
      return [];
    }
    if (typeof input[0] === "string") {
      return input.map((tag) => String(tag));
    }
    return input
      .map((item) =>
        typeof item === "object" && item
          ? String((item as { slug?: string; name?: string }).slug ?? (item as { name?: string }).name ?? "")
          : ""
      )
      .filter((tag) => tag.length > 0);
  }
  return [];
}

function getSlugFromUrl(): string {
  const parts = window.location.pathname.split("/");
  return parts[2] ?? "";
}

async function fetchTagsForSlug(slug: string): Promise<string[]> {
  try {
    const res = await fetch("https://leetcode.com/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `
          query getQuestionDetail($titleSlug: String!) {
            question(titleSlug: $titleSlug) {
              topicTags { slug }
            }
          }
        `,
        variables: { titleSlug: slug }
      })
    });
    const data = await res.json();
    return (data?.data?.question?.topicTags ?? []).map((t: { slug: string }) => t.slug);
  } catch {
    return [];
  }
}

function getTitleFromDom(): string {
  const titleEl = document.querySelector("[data-cy='question-title']");
  if (titleEl?.textContent) {
    return titleEl.textContent.trim();
  }
  return document.title.split(" - ")[0] ?? "";
}

function getDifficultyFromDom(): string | null {
  const badge = document.querySelector("[diff]");
  if (badge?.textContent) {
    return badge.textContent.trim();
  }
  const candidates = Array.from(document.querySelectorAll("span, div, button"));
  const difficulty = candidates.find((node) => {
    const text = node.textContent?.trim().toLowerCase();
    return text === "easy" || text === "medium" || text === "hard";
  });
  return difficulty?.textContent?.trim() ?? null;
}

function getLanguageFromDom(): string {
  const button = document.querySelector("button[data-cy='lang-select']");
  if (button?.textContent) {
    return normalizeLanguage(button.textContent);
  }
  const languageButton = Array.from(document.querySelectorAll("button")).find((node) =>
    node.textContent?.toLowerCase().includes("python")
  );
  return languageButton?.textContent ? normalizeLanguage(languageButton.textContent) : "";
}

function getMetricFromText(regex: RegExp): string {
  const text = document.body?.innerText ?? "";
  const match = text.match(regex);
  return match ? match[1] : "";
}

function getMetricFromDom(label: string): string {
  const nodes = Array.from(document.querySelectorAll("span, div, p"));
  const target = nodes.find((node) => node.textContent?.includes(label));
  return target?.textContent ?? "";
}

function getRuntimeFromDom(): number {
  const byLabel = parseNumber(getMetricFromDom("Runtime"));
  if (byLabel > 0) {
    return byLabel;
  }
  return parseNumber(getMetricFromText(/Runtime\s*:?\s*([\d.]+)\s*ms/i));
}

function getMemoryFromDom(): number {
  const byLabel = parseNumber(getMetricFromDom("Memory"));
  if (byLabel > 0) {
    return byLabel;
  }
  return parseNumber(getMetricFromText(/Memory\s*:?\s*([\d.]+)\s*MB/i));
}

function extractSubmissionFromGraphQL(raw: unknown): Partial<SubmissionPayload> | null {
  const data = typeof raw === "object" && raw ? raw as Record<string, unknown> : {};

  if (data.state !== undefined) {
    if (data.state !== "SUCCESS") return null;           
    if (data.status_code !== 10 && data.status_msg !== "Accepted") return null;
    return {
      submission_id: String(data.submission_id ?? data.id ?? Date.now()),
      code:          String(data.code ?? ""),
      runtime_ms: parseNumber((data as any).status_runtime ?? (data as any).display_runtime ?? ""),
      memory_mb:  parseNumber((data as any).status_memory ?? ""),
      language:   normalizeLanguage(String((data as any).lang ?? (data as any).pretty_lang ?? "")),
      tags:          [],
      problem_title: "",
      problem_slug:  "",
      difficulty:    normalizeDifficulty(""),
      timestamp:     new Date().toISOString(),
    } as Partial<SubmissionPayload>;
  }

  const submission =
    (data as { submissionDetails?: unknown }).submissionDetails ??
    (data as { submissionDetail?: unknown }).submissionDetail ??
    (data as { submission?: unknown }).submission ??
    null;

  if (!submission || typeof submission !== "object") {
    return null;
  }

  const statusCode = (submission as { statusCode?: number; status_code?: number }).statusCode ??
    (submission as { status_code?: number }).status_code;
  const statusDisplay =
    (submission as { statusDisplay?: string; status_display?: string }).statusDisplay ??
    (submission as { status_display?: string }).status_display ??
    (submission as { status?: string }).status;

  if (statusCode !== 10 && statusDisplay !== "Accepted") {
    return null;
  }

  const question =
    (submission as { question?: unknown }).question ??
    (data as { question?: unknown }).question ??
    {};

  const langValue =
    (submission as { lang?: { name?: string; verboseName?: string } | string }).lang ??
    (submission as { language?: string }).language ??
    "";
  const language =
    typeof langValue === "string"
      ? langValue
      : langValue?.name ?? langValue?.verboseName ?? "";

  return {
    submission_id: String(
      (submission as { submissionId?: string; submission_id?: string; id?: string }).submissionId ??
        (submission as { submission_id?: string }).submission_id ??
        (submission as { id?: string }).id ??
        ""
    ),
    code: String((submission as { code?: string }).code ?? ""),
    language: normalizeLanguage(String(language)),
    runtime_ms: parseNumber(
      (submission as { runtimeDisplay?: string; runtime?: string | number }).runtimeDisplay ??
        (submission as { runtime?: string | number }).runtime ??
        ""
    ),

    memory_mb: parseNumber(
      (submission as { memoryDisplay?: string; memory?: string | number }).memoryDisplay ??
        (submission as { memory?: string | number }).memory ??
        ""
    ),
    tags: extractTags(
      (submission as { topicTags?: unknown }).topicTags ??
        (question as { topicTags?: unknown }).topicTags
    ),
    problem_title: String((question as { title?: string }).title ?? ""),
    problem_slug: String((question as { titleSlug?: string }).titleSlug ?? ""),
    difficulty: normalizeDifficulty(String((question as { difficulty?: string }).difficulty ?? "")),
    timestamp: normalizeTimestamp((submission as { timestamp?: unknown }).timestamp)
  } as Partial<SubmissionPayload>;
}

function buildPayload(partial: Partial<SubmissionPayload>): SubmissionPayload | null {
  const slug = partial.problem_slug?.trim() || getSlugFromUrl();
  const title = partial.problem_title?.trim() || getTitleFromDom();
  const difficulty = normalizeDifficulty(partial.difficulty ?? getDifficultyFromDom());
  const language = partial.language?.trim() || getLanguageFromDom();
  const runtime =
    partial.runtime_ms && partial.runtime_ms > 0 ? partial.runtime_ms : getRuntimeFromDom() || 0;

  const memory =
    partial.memory_mb && partial.memory_mb > 0 ? partial.memory_mb : getMemoryFromDom() || 0;
  const submissionId = partial.submission_id?.trim() || `${Date.now()}`;
    // Remove getCodeFromDom() fallback — Monaco is fetched async before buildPayload is called
  const code = partial.code?.trim().length ? partial.code : "";
  if (!code || !slug) {
    return null;
  }

  return {
    problem_slug: slug,
    problem_title: title,
    language: normalizeLanguage(language || "text"),
    code,
    difficulty,
    tags: partial.tags ?? [],
    runtime_ms: runtime,
    memory_mb: memory,
    submission_id: submissionId,
    timestamp: partial.timestamp ?? new Date().toISOString(),
    action: "overwrite"
  };
}

function scheduleSend(payload: SubmissionPayload): void {
  if (payload.tags.length === 0 && hasSentForSubmit) return;

  if (submissionHandled) {
    return;
  }
  const now = Date.now();
  if (!submitArmed) {
    return;
  }
  if (submitArmedAt && now - submitArmedAt > SUBMIT_ARM_WINDOW_MS) {
    submitArmed = false;
    return;
  }
  if (hasSentForSubmit) {
    return;
  }
  if (payload.problem_slug === lastHandledSlug) {
    return;
  }
  const incomingId = payload.submission_id?.trim() ?? "";
  if (incomingId && incomingId === lastSubmissionId) {
    return;
  }
  if (now - lastSentAt < debounceMs) {
    return;
  }

  if (payload.problem_slug === lastAcceptedSlug && now - lastAcceptedAt < ACCEPTED_COOLDOWN_MS) {
    return;
  }

  if (debounceTimer) {
    window.clearTimeout(debounceTimer);
  }

  debounceTimer = window.setTimeout(() => {
    lastSubmissionId = payload.submission_id;
    lastSentAt = Date.now();
    lastAcceptedSlug = payload.problem_slug;
    lastAcceptedAt = lastSentAt;
    hasSentForSubmit = true;
    lastHandledSlug = payload.problem_slug;
    submitArmed = false;
    try {
      console.info("AlgoNest: submission detected", payload.problem_slug);
      chrome.runtime.sendMessage({ type: "SUBMISSION_DETECTED", payload }, () => {
        void chrome.runtime.lastError;

        submissionHandled = true;
        submitArmed = false;
        hasSentForSubmit = true;
      });
    } catch {
      // ignore context invalidated
    }
  }, debounceMs);
}

async function handleGraphQLPayload(raw: unknown): Promise<void> {
  const extracted = extractSubmissionFromGraphQL(raw);
  if (!extracted) return;

  if (!capturedCode) {
    await new Promise(r => setTimeout(r, 500));
  }

  if (!extracted.tags || extracted.tags.length === 0) {
    const slug = extracted.problem_slug?.trim() || getSlugFromUrl();
    extracted.tags = await fetchTagsForSlug(slug);
  }

  extracted.code = capturedCode;
  if (!extracted.code) {
    console.warn("AlgoNest: no code captured, aborting");
    return;
  }

  if (!extracted.difficulty || extracted.difficulty === "Easy") {
    if (capturedDifficulty) {
      extracted.difficulty = normalizeDifficulty(capturedDifficulty);
    }
  }

  const payload = buildPayload(extracted);
  if (payload) scheduleSend(payload);
}

function listenForGraphQLMessages(): void {
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data as { source?: string; type?: string; payload?: unknown } | null;
    if (!data || data.source !== ALGONEST_SOURCE || data.type !== "GRAPHQL_RESPONSE") return;
    void handleGraphQLPayload(data.payload);  // void the promise
  });
}
function listenForCapturedCode(): void {
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data as { source?: string; type?: string; payload?: { code?: string; difficulty?: string } } | null;
    if (!data || data.source !== ALGONEST_SOURCE || data.type !== "CODE_CAPTURED") return;
    if (data.payload?.code) {
      capturedCode = data.payload.code;
      console.info("AlgoNest: code captured from injector, length:", capturedCode.length);
    }
    if (data.payload?.difficulty) {
      capturedDifficulty = data.payload.difficulty;
    }
  });
}

function injectNetworkInterceptor(): void {
  if (document.querySelector("script[data-algonest-injector='true']")) {
    return;
  }
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("injector.js");
  script.type = "text/javascript";
  script.async = true;
  script.dataset.algonestInjector = "true";
  script.onerror = () => {
    console.warn("AlgoNest: injector failed to load");
  };
  script.onload = () => script.remove();
  (document.documentElement || document.head || document.body).appendChild(script);
}

function findAcceptedBadge(): HTMLElement | null {
  const nodes = Array.from(document.querySelectorAll("span, div, p"));
  for (const node of nodes) {
    const text = node.textContent?.trim();
    if (text !== "Accepted") {
      continue;
    }
    const el = node as HTMLElement;
    const className = String(el.className || "").toLowerCase();
    if (className.includes("success") || className.includes("green")) {
      return el;
    }
    if (el.closest("div[role='dialog'], div[data-e2e-locator*='submission'], div[class*='result']")) {
      return el;
    }
  }
  return null;
}

function setupMutationObserver(): void {
  const observer = new MutationObserver(() => {
    const acceptedBadge = findAcceptedBadge();
    if (!acceptedBadge) return;
    if (!submitArmed) return;

    const now = Date.now();
    const slug = getSlugFromUrl();
    if (slug === lastDetectedSlug && now - lastDetectedAt < ACCEPTED_COOLDOWN_MS) return;
    lastDetectedSlug = slug;
    lastDetectedAt = now;
    console.info("AlgoNest: accepted badge detected in DOM");

    void (async () => {
    if (!capturedCode) {
      await new Promise(r => setTimeout(r, 500));
    }
    const code = capturedCode;
    if (!code) {
      console.warn("AlgoNest: no code captured at submit time");
      return;
    }
    const payload = buildPayload({
      problem_slug: slug,
      problem_title: getTitleFromDom(),
      difficulty: normalizeDifficulty(capturedDifficulty || getDifficultyFromDom()),
      language: getLanguageFromDom(),
      runtime_ms: getRuntimeFromDom(),
      memory_mb: getMemoryFromDom(),
      submission_id: `${Date.now()}`,
      timestamp: new Date().toISOString(),
      tags: [],
      code
    });
    if (payload) scheduleSend(payload);
  })();
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

function loadDebounceMs(): void {
  try {
    chrome.storage.local.get(["settings"], (result) => {
      const settings = result.settings as { debounce_ms?: number } | undefined;
      if (settings?.debounce_ms) {
        debounceMs = settings.debounce_ms;
      }
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes.settings?.newValue) {
        return;
      }
      const next = changes.settings.newValue as { debounce_ms?: number };
      if (next.debounce_ms) {
        debounceMs = next.debounce_ms;
      }
    });
  } catch {
    // ignore context invalidated
  }
}

function startKeepAlivePing(): void {
  window.setInterval(() => {
    try {
      chrome.runtime.sendMessage({ type: "PING" }, () => {
        void chrome.runtime.lastError;
      });
    } catch {
      // ignore context invalidated
    }
  }, 20000);
}

function setupSubmitClickListener(): void {
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target as Element | null;
      const button = target?.closest("button, [role='button']");
      if (!button) return;

      const text = button.textContent?.trim().toLowerCase() ?? "";
      if (text.includes("run") && !text.includes("submit")) return;

      const isSubmitButton =
        button.getAttribute("data-cy") === "submit-code-btn" ||
        button.getAttribute("data-e2e-locator") === "console-submit-button" ||
        text === "submit" ||
        text.includes("submit");
      if (!isSubmitButton) return;

      submitArmed = true;
      submissionHandled = false;
      submitArmedAt = Date.now();
      hasSentForSubmit = false;
      lastSubmissionId = "";
      lastSentAt = 0;
      lastAcceptedSlug = "";
      lastAcceptedAt = 0;
      lastDetectedSlug = "";
      lastDetectedAt = 0;
      lastHandledSlug = "";
      capturedCode = "";
      capturedDifficulty = "";
    },
    { capture: true }
  );
}

(function init() {
  try {
    console.info("AlgoNest: content script loaded");
    loadDebounceMs();
    injectNetworkInterceptor();
    listenForGraphQLMessages();
    listenForCapturedCode();
    setupMutationObserver();
    setupSubmitClickListener();
    startKeepAlivePing();
  } catch (err) {
    console.warn("AlgoNest content script failed", err);
  }
})();

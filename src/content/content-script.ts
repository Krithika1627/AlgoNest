import type { SubmissionPayload } from "../shared/types";

const DEFAULT_DEBOUNCE_MS = 3000;
let debounceMs = DEFAULT_DEBOUNCE_MS;
let lastSubmissionId = "";
let lastSentAt = 0;
let debounceTimer: number | undefined;

function normalizeLanguage(raw: string): string {
  const value = raw.trim().toLowerCase();
  const map: Record<string, string> = {
    python3: "python",
    python: "python",
    cpp: "cpp",
    c: "c",
    java: "java",
    javascript: "javascript",
    typescript: "typescript",
    golang: "go",
    go: "go",
    csharp: "cs",
    "c#": "cs",
    kotlin: "kt",
    swift: "swift",
    rust: "rust"
  };
  return map[value] ?? value;
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

function getMetricFromDom(label: string): string {
  const nodes = Array.from(document.querySelectorAll("span, div, p"));
  const target = nodes.find((node) => node.textContent?.includes(label));
  return target?.textContent ?? "";
}

function getRuntimeFromDom(): number {
  return parseNumber(getMetricFromDom("Runtime"));
}

function getMemoryFromDom(): number {
  return parseNumber(getMetricFromDom("Memory"));
}

function getCodeFromDom(): string {
  const lines = Array.from(document.querySelectorAll(".view-lines .view-line"));
  if (lines.length === 0) {
    const textarea = document.querySelector("textarea");
    if (textarea instanceof HTMLTextAreaElement) {
      return textarea.value;
    }
    return "";
  }
  return lines.map((line) => line.textContent ?? "").join("\n");
}

function extractSubmissionFromGraphQL(raw: unknown): Partial<SubmissionPayload> | null {
  const data = typeof raw === "object" && raw ? (raw as { data?: unknown }).data ?? raw : raw;
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

  return {
    submission_id: String(
      (submission as { submissionId?: string; submission_id?: string; id?: string }).submissionId ??
        (submission as { submission_id?: string }).submission_id ??
        (submission as { id?: string }).id ??
        ""
    ),
    code: String((submission as { code?: string }).code ?? ""),
    language: normalizeLanguage(
      String(
        (submission as { lang?: string; language?: string }).lang ??
          (submission as { language?: string }).language ??
          ""
      )
    ),
    runtime_ms: parseNumber(
      (submission as { runtime?: string | number; runtimeDisplay?: string }).runtime ??
        (submission as { runtimeDisplay?: string }).runtimeDisplay ??
        ""
    ),
    memory_mb: parseNumber(
      (submission as { memory?: string | number; memoryDisplay?: string }).memory ??
        (submission as { memoryDisplay?: string }).memoryDisplay ??
        ""
    ),
    tags: extractTags((question as { topicTags?: unknown }).topicTags),
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
  const runtime = partial.runtime_ms ?? getRuntimeFromDom();
  const memory = partial.memory_mb ?? getMemoryFromDom();
  const submissionId = partial.submission_id?.trim() || `${Date.now()}`;
  const code = partial.code?.length ? partial.code : getCodeFromDom();

  if (!code || !slug) {
    return null;
  }

  return {
    problem_slug: slug,
    problem_title: title,
    language: language || "text",
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
  const now = Date.now();
  if (payload.submission_id === lastSubmissionId && now - lastSentAt < debounceMs) {
    return;
  }

  if (debounceTimer) {
    window.clearTimeout(debounceTimer);
  }

  debounceTimer = window.setTimeout(() => {
    lastSubmissionId = payload.submission_id;
    lastSentAt = Date.now();
    chrome.runtime.sendMessage({ type: "SUBMISSION_DETECTED", payload }, () => {
      void chrome.runtime.lastError;
    });
  }, debounceMs);
}

function handleGraphQLPayload(raw: unknown): void {
  const extracted = extractSubmissionFromGraphQL(raw);
  if (!extracted) {
    return;
  }

  const payload = buildPayload(extracted);
  if (payload) {
    scheduleSend(payload);
  }
}

function interceptFetch(): void {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const url = typeof args[0] === "string" ? args[0] : args[0]?.url;

    if (url && url.includes("/graphql")) {
      response
        .clone()
        .json()
        .then((data) => handleGraphQLPayload(data))
        .catch(() => null);
    }

    return response;
  };
}

function interceptXHR(): void {
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function open(...args) {
    const url = args[1];
    (this as XMLHttpRequest & { _algonestUrl?: string })._algonestUrl = String(url);
    return originalOpen.apply(this, args as Parameters<typeof originalOpen>);
  };

  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function send(...args) {
    this.addEventListener("load", () => {
      const url = (this as XMLHttpRequest & { _algonestUrl?: string })._algonestUrl;
      if (url && url.includes("/graphql")) {
        try {
          const data = JSON.parse(this.responseText);
          handleGraphQLPayload(data);
        } catch {
          // ignore
        }
      }
    });
    return originalSend.apply(this, args as Parameters<typeof originalSend>);
  };
}

function setupMutationObserver(): void {
  const observer = new MutationObserver(() => {
    const acceptedBadge = Array.from(document.querySelectorAll("span, div"))
      .filter((node) => node.textContent?.trim() === "Accepted")
      .find((node) => (node as HTMLElement).className.toLowerCase().includes("success"));

    if (!acceptedBadge) {
      return;
    }

    const payload = buildPayload({
      problem_slug: getSlugFromUrl(),
      problem_title: getTitleFromDom(),
      difficulty: normalizeDifficulty(getDifficultyFromDom()),
      language: getLanguageFromDom(),
      runtime_ms: getRuntimeFromDom(),
      memory_mb: getMemoryFromDom(),
      submission_id: `${Date.now()}`,
      timestamp: new Date().toISOString(),
      tags: []
    });

    if (payload) {
      scheduleSend(payload);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

function loadDebounceMs(): void {
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
}

function startKeepAlivePing(): void {
  window.setInterval(() => {
    chrome.runtime.sendMessage({ type: "PING" }, () => {
      void chrome.runtime.lastError;
    });
  }, 20000);
}

(function init() {
  try {
    loadDebounceMs();
    interceptFetch();
    interceptXHR();
    setupMutationObserver();
    startKeepAlivePing();
  } catch (err) {
    console.warn("AlgoNest content script failed", err);
  }
})();

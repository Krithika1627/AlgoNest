import type { ComplexityAnalysis } from "./types";

const COMPLEXITY_API_URL =
  import.meta.env.VITE_COMPLEXITY_API_URL as string | undefined;

const MAX_CODE_LENGTH = 50_000;
const REQUEST_TIMEOUT_MS = 30_000;

const COMPLEXITY_CACHE_KEY = "complexity_cache";
const MAX_COMPLEXITY_CACHE_ENTRIES = 250;

interface ComplexityRequest {
  code: string;
  language: string;
  problem_title: string;
  problem_slug: string;
}

interface ComplexityCacheEntry {
  analysis: ComplexityAnalysis;
  last_accessed: number;
}

type ComplexityCache = Record<string, ComplexityCacheEntry>;

function isComplexityAnalysis(
  value: unknown
): value is ComplexityAnalysis {
  if (!value || typeof value !== "object") {
    return false;
  }

  const result = value as Record<string, unknown>;

  return (
    typeof result.time_complexity === "string" &&
    result.time_complexity.length > 0 &&
    result.time_complexity.length <= 100 &&

    typeof result.space_complexity === "string" &&
    result.space_complexity.length > 0 &&
    result.space_complexity.length <= 100 &&

    typeof result.explanation === "string" &&
    result.explanation.length > 0 &&
    result.explanation.length <= 300
  );
}

function isComplexityCacheEntry(
  value: unknown
): value is ComplexityCacheEntry {
  if (!value || typeof value !== "object") {
    return false;
  }

  const entry = value as Record<string, unknown>;

  return (
    isComplexityAnalysis(entry.analysis) &&
    typeof entry.last_accessed === "number" &&
    Number.isFinite(entry.last_accessed)
  );
}

function parseComplexityCache(
  value: unknown
): ComplexityCache {
  if (!value || typeof value !== "object") {
    return {};
  }

  const raw = value as Record<string, unknown>;
  const cache: ComplexityCache = {};

  for (const [hash, entry] of Object.entries(raw)) {
    if (isComplexityCacheEntry(entry)) {
      cache[hash] = entry;
    }
  }

  return cache;
}

export async function analyzeComplexity(
  request: ComplexityRequest
): Promise<ComplexityAnalysis | null> {

  if (!COMPLEXITY_API_URL) {
    console.error("AI: COMPLEXITY_API_URL is missing");
    return null;
  }

  if (!request.code.trim()) {
    console.error("AI: empty code");
    return null;
  }

  if (request.code.length > MAX_CODE_LENGTH) {
    console.error("AI: code too large");
    return null;
  }

  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(COMPLEXITY_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(request),
      signal: controller.signal
    });

    if (!response.ok) {
      console.error(
        "AI: Worker error response",
        await response.text()
      );

      return null;
    }

    const data: unknown = await response.json();

    if (!isComplexityAnalysis(data)) {
      console.error("AI: invalid response shape", data);
      return null;
    }

    return data;
    } catch (err) {
    if (
      err instanceof DOMException &&
      err.name === "AbortError"
    ) {
      console.warn("AI: complexity analysis timed out");
      return null;
    }

    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getCachedComplexity(
  codeHash: string
): Promise<ComplexityAnalysis | null> {
  const result = await chrome.storage.local.get(
    COMPLEXITY_CACHE_KEY
  );

  const cache = parseComplexityCache(
    result[COMPLEXITY_CACHE_KEY]
  );

  const entry = cache[codeHash];

  if (!entry) {
    return null;
  }

  entry.last_accessed = Date.now();

  await chrome.storage.local.set({
    [COMPLEXITY_CACHE_KEY]: cache
  });

  return entry.analysis;
}


export async function cacheComplexity(
  codeHash: string,
  analysis: ComplexityAnalysis
): Promise<void> {
  const result = await chrome.storage.local.get(
    COMPLEXITY_CACHE_KEY
  );

  const cache = parseComplexityCache(
    result[COMPLEXITY_CACHE_KEY]
  );

  cache[codeHash] = {
    analysis,
    last_accessed: Date.now()
  };

  const entries = Object.entries(cache);

  if (entries.length > MAX_COMPLEXITY_CACHE_ENTRIES) {
    entries.sort(
      ([, a], [, b]) =>
        b.last_accessed - a.last_accessed
    );

    const trimmedCache = Object.fromEntries(
      entries.slice(0, MAX_COMPLEXITY_CACHE_ENTRIES)
    );

    await chrome.storage.local.set({
      [COMPLEXITY_CACHE_KEY]: trimmedCache
    });

    return;
  }

  await chrome.storage.local.set({
    [COMPLEXITY_CACHE_KEY]: cache
  });
}
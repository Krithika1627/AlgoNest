import { z } from "zod";

const BASE_URL = "https://api.github.com";
const RETRY_DELAYS_MS = [1000, 2000, 4000];

const fileSchema = z.object({
  sha: z.string()
});

const contentSchema = z.object({
  sha: z.string(),
  content: z.string()
});

const commitSchema = z.object({
  commit: z.object({
    sha: z.string()
  })
});

const userSchema = z.object({
  login: z.string(),
  avatar_url: z.string()
});

export class AuthError extends Error {
  constructor(message = "GitHub token is invalid") {
    super(message);
    this.name = "AuthError";
  }
}

export class RateLimitError extends Error {
  constructor(message = "GitHub rate limit exceeded") {
    super(message);
    this.name = "RateLimitError";
  }
}

export class NetworkError extends Error {
  constructor(message = "Network error") {
    super(message);
    this.name = "NetworkError";
  }
}

class RetryableResponseError extends Error {
  status: number;
  statusText: string;

  constructor(status: number, statusText: string) {
    super(`Retryable response: ${status} ${statusText}`);
    this.name = "RetryableResponseError";
    this.status = status;
    this.statusText = statusText;
  }
}

export class ConflictError extends Error {
  constructor(message = "Git branch changed during commit") {
    super(message);
    this.name = "ConflictError";
  }
}

function handleGitHubError(res: Response, operation: string): void {
  if (res.status === 401) {
    throw new AuthError();
  }

  if (isRateLimitResponse(res)) {
    throw new RateLimitError();
  }

  if (!res.ok) {
    throw new NetworkError(
      `GitHub ${operation} failed: ${res.status}`
    );
  }
}

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitResponse(res: Response): boolean {
  return res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0";
}

function wrapNetworkError(err: unknown): Error {
  if (err instanceof NetworkError) {
    return err;
  }
  if (err instanceof RetryableResponseError) {
    return new NetworkError(`GitHub server error: ${err.status}`);
  }
  if (err instanceof TypeError) {
    return new NetworkError("Network request failed");
  }
  return err instanceof Error ? err : new Error("Unknown error");
}

async function fetchWithRetry(url: string, init: RequestInit, retries = 3): Promise<Response> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, init);
      if (res.status >= 500) {
        throw new RetryableResponseError(res.status, res.statusText);
      }
      return res;
    } catch (err) {
      lastError = err;
      const shouldRetry =
        err instanceof RetryableResponseError || err instanceof TypeError;
      if (!shouldRetry || attempt === retries) {
        throw wrapNetworkError(err);
      }
      await delay(RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]);
    }
  }

  throw wrapNetworkError(lastError);
}

function encodeContent(content: string): string {
  return btoa(unescape(encodeURIComponent(content)));
}

export async function verifyRepo(token: string, repoFullName: string): Promise<boolean> {
  const res = await fetch(`${BASE_URL}/repos/${repoFullName}`, {
    method: "GET",
    headers: authHeaders(token)
  });

  if (res.status === 404) {
    return false;
  }
  if (res.status === 401) {
    throw new AuthError();
  }
  if (isRateLimitResponse(res)) {
    throw new RateLimitError();
  }
  if (!res.ok) {
    throw new Error(`GitHub repo check failed: ${res.status}`);
  }
  return true;
}

export async function createRepo(token: string, repoName: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/user/repos`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      name: repoName,
      private: false,
      auto_init: true
    })
  });

  if (res.status === 401) {
    throw new AuthError();
  }
  if (isRateLimitResponse(res)) {
    throw new RateLimitError();
  }
  if (!res.ok) {
    throw new Error(`GitHub repo create failed: ${res.status}`);
  }
}

export async function getFileSHA(
  token: string,
  repoFullName: string,
  path: string,
  branch: string
): Promise<string | null> {
  const res = await fetchWithRetry(
    `${BASE_URL}/repos/${repoFullName}/contents/${path}?ref=${encodeURIComponent(branch)}`,
    {
      method: "GET",
      headers: authHeaders(token)
    }
  );

  if (res.status === 404) {
    return null;
  }
  if (res.status === 401) {
    throw new AuthError();
  }
  if (isRateLimitResponse(res)) {
    throw new RateLimitError();
  }
  if (!res.ok) {
    throw new Error(`GitHub get SHA failed: ${res.status}`);
  }

  const json = fileSchema.parse(await res.json());
  return json.sha;
}

export async function getFileContent(
  token: string,
  repoFullName: string,
  path: string,
  branch: string
): Promise<{ content: string; sha: string } | null> {
  const res = await fetchWithRetry(
    `${BASE_URL}/repos/${repoFullName}/contents/${path}?ref=${encodeURIComponent(branch)}`,
    {
      method: "GET",
      headers: authHeaders(token)
    }
  );

  if (res.status === 404) {
    return null;
  }
  if (res.status === 401) {
    throw new AuthError();
  }
  if (isRateLimitResponse(res)) {
    throw new RateLimitError();
  }
  if (!res.ok) {
    throw new Error(`GitHub get content failed: ${res.status}`);
  }

  const json = contentSchema.parse(await res.json());
  return { content: json.content, sha: json.sha };
}

export async function putFile(
  token: string,
  repoFullName: string,
  path: string,
  content: string,
  message: string,
  branch: string,
  sha?: string
): Promise<string> {
  let currentSha = sha;
  let hasRetriedConflict = false;

  for (;;) {
    const body: Record<string, string> = {
      message,
      content: encodeContent(content),
      branch
    };
    if (currentSha) {
      body.sha = currentSha;
    }

    const res = await fetchWithRetry(
      `${BASE_URL}/repos/${repoFullName}/contents/${path}`,
      {
        method: "PUT",
        headers: authHeaders(token),
        body: JSON.stringify(body)
      }
    );

    if (res.status === 409 && !hasRetriedConflict) {
      hasRetriedConflict = true;
      currentSha = (await getFileSHA(token, repoFullName, path, branch)) ?? undefined;
      continue;
    }

    if (res.status === 401) {
      throw new AuthError();
    }
    if (isRateLimitResponse(res)) {
      throw new RateLimitError();
    }
    if (!res.ok) {
      throw new Error(`GitHub put file failed: ${res.status}`);
    }

    const json = commitSchema.parse(await res.json());
    return json.commit.sha;
  }
}

export async function getAuthenticatedUser(
  token: string
): Promise<{ login: string; avatar_url: string }> {
  const res = await fetch(`${BASE_URL}/user`, {
    method: "GET",
    headers: authHeaders(token)
  });

  if (res.status === 401) {
    throw new AuthError();
  }
  if (isRateLimitResponse(res)) {
    throw new RateLimitError();
  }
  if (!res.ok) {
    throw new Error(`GitHub user lookup failed: ${res.status}`);
  }

  return userSchema.parse(await res.json());
}

export async function commitMultipleFiles(
  token: string,
  repoFullName: string,
  branch: string,
  files: Array<{ path: string; content: string }>,
  message: string
): Promise<string> {
  const encodedBranch = encodeURIComponent(branch);

  // 1-Get current branch tip
  const refRes = await fetchWithRetry(
    `${BASE_URL}/repos/${repoFullName}/git/ref/heads/${encodedBranch}`,
    {
      method: "GET",
      headers: authHeaders(token)
    }
  );

  handleGitHubError(refRes, "get branch ref");

  const refData = (await refRes.json()) as {
    object: {
      sha: string;
    };
  };
  const currentCommitSha = refData.object.sha;

  // 2-Create a new tree containing all changed files
  const treeRes = await fetchWithRetry(
    `${BASE_URL}/repos/${repoFullName}/git/trees`,
    {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        base_tree: currentCommitSha,

        tree: files.map((file) => ({
          path: file.path,
          mode: "100644",
          type: "blob",
          content: file.content
        }))
      })
    }
  );

  handleGitHubError(treeRes, "create tree");

  const treeData = (await treeRes.json()) as {
    sha: string;
  };
  const newTreeSha = treeData.sha;

  // 3-Create one commit pointing to the new tree
  const commitRes = await fetchWithRetry(
    `${BASE_URL}/repos/${repoFullName}/git/commits`,
    {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        message,
        tree: newTreeSha,
        parents: [currentCommitSha]
      })
    }
  );

  handleGitHubError(commitRes, "create commit");

  const commitData = (await commitRes.json()) as {
    sha: string;
  };
  const newCommitSha = commitData.sha;

  //4-Move the branch to the new commit
  const updateRefRes = await fetchWithRetry(
    `${BASE_URL}/repos/${repoFullName}/git/refs/heads/${encodedBranch}`,
    {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify({
        sha: newCommitSha,
        force: false
      })
    }
  );

  // Someone pushed to the branch after STEP 1.
  // Never force-push over their changes.
  if (updateRefRes.status === 422) {
    throw new ConflictError();
  }

  handleGitHubError(updateRefRes, "update branch ref");

  return newCommitSha;
}
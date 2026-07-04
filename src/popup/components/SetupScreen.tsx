import React, { useEffect, useState } from "react";
import type { UserSettings } from "../../shared/types";
import { DEFAULT_SETTINGS } from "../../shared/defaults";
import {
  AuthError,
  RateLimitError,
  createRepo,
  getAuthenticatedUser,
  verifyRepo
} from "../../shared/github-api";
import { usePopupStore } from "../store";
import { sendMessage } from "../utils";
import {
  generateRandomString,
  createCodeChallenge
} from "../../shared/oauth";

type UserInfo = { login: string; avatar_url: string };

export default function SetupScreen(): JSX.Element {
  const { settings, setSettings, setToast, setLoading } = usePopupStore();
  const [tokenInput, setTokenInput] = useState("");
  const [repoInput, setRepoInput] = useState(settings?.repo_full_name ?? "");
  const [user, setUser] = useState<UserInfo | null>(null);
  const [needsCreate, setNeedsCreate] = useState(false);
  const baseSettings = settings ?? DEFAULT_SETTINGS;
  const repoReady = repoInput.trim().length > 0;

  const hasToken = Boolean(settings?.github_token);

  useEffect(() => {
    if (!settings?.github_token) {
      return;
    }
    getAuthenticatedUser(settings.github_token)
      .then((info) => setUser(info))
      .catch(() => null);
  }, [settings?.github_token]);

  const saveSettings = async (next: UserSettings) => {
    setLoading(true);
    const saved = await sendMessage<UserSettings>({ type: "SAVE_SETTINGS", settings: next });
    setSettings(saved ?? next);
    setLoading(false);
  };

  const handleManualToken = async () => {
    if (!tokenInput.trim()) {
      setToast({ message: "Paste a GitHub token first.", type: "error" });
      return;
    }
    const next = {
      ...DEFAULT_SETTINGS,
      ...baseSettings,
      github_token: tokenInput.trim()
    };
    await saveSettings(next);
    setTokenInput("");
    setToast({ message: "Token saved. Connect a repo next.", type: "success" });
  };

  const handleOAuth = async () => {
    const clientId =
      import.meta.env.VITE_GITHUB_OAUTH_CLIENT_ID as string | undefined;
    const workerUrl =
      import.meta.env.VITE_AUTH_WORKER_URL as string | undefined;
    if (!clientId || !workerUrl) {
      setToast({
        message: "OAuth configuration missing.",
        type: "error"
      });
      return;
    }
    const state = generateRandomString(16);
    const codeVerifier = generateRandomString(32);
    const codeChallenge = await createCodeChallenge(codeVerifier);
    await chrome.storage.local.set({
      oauth_state: state,
      oauth_code_verifier: codeVerifier
    });
    const redirectUri = chrome.identity.getRedirectURL();
    const authUrl = new URL(
      "https://github.com/login/oauth/authorize"
    );
    authUrl.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: "repo",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256"
    }).toString();
    chrome.identity.launchWebAuthFlow(
      {
        url: authUrl.toString(),
        interactive: true
      },
      async (redirectUrl) => {
        if (chrome.runtime.lastError || !redirectUrl) {
          await chrome.storage.local.remove([
            "oauth_state", "oauth_code_verifier"
          ]);
          setToast({
            message: "OAuth cancelled.",
            type: "error"
          });
          return;
        }
        const url = new URL(redirectUrl);
        const code = url.searchParams.get("code");
        const returnedState = url.searchParams.get("state");
        const stored =
          await chrome.storage.local.get([
            "oauth_state", "oauth_code_verifier"
          ]);
        const storedState = stored.oauth_state as string | undefined;
        const storedVerifier = stored.oauth_code_verifier as string | undefined;
        if ( !returnedState || returnedState !== storedState ) {
          await chrome.storage.local.remove([
            "oauth_state", "oauth_code_verifier"
          ]);
          setToast({
            message: "OAuth state mismatch.",
            type: "error"
          });
          return;
        }
        if (!code || !storedVerifier) {
          await chrome.storage.local.remove([
            "oauth_state", "oauth_code_verifier"
          ]);
          setToast({
            message: "Incomplete OAuth response.",
            type: "error"
          });
          return;
        }
        try {
          setLoading(true);
          const res = await fetch(workerUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              code,
              code_verifier: storedVerifier
            })
          });
          const data = await res.json() as {
            access_token?: string;
            error?: string;
          };
          if (!res.ok || !data.access_token) {
            setToast({
              message:
                data.error ?? "OAuth exchange failed.",
              type: "error"
            });
            return;
          }
          const next = {
            ...DEFAULT_SETTINGS,
            ...baseSettings,
            github_token: data.access_token
          };
          await saveSettings(next);
          setToast({
            message: "GitHub connected.", type: "success"
          });
        } catch {
          setToast({
            message: "OAuth exchange failed.", type: "error"
          });
        } finally {
          await chrome.storage.local.remove([
            "oauth_state", "oauth_code_verifier"
          ]);
          setLoading(false);
        }
      }
    );
  };

  const connectRepo = async () => {
    if (!baseSettings.github_token) {
      setToast({ message: "Save a token before connecting a repo.", type: "error" });
      return;
    }
    if (!repoInput.trim()) {
      setToast({ message: "Enter a repo like username/leetcode-solutions", type: "error" });
      return;
    }

    setLoading(true);
    try {
      const exists = await verifyRepo(baseSettings.github_token, repoInput.trim());
      if (!exists) {
        setNeedsCreate(true);
        setToast({ message: "Repo not found. Create it?", type: "error" });
        setLoading(false);
        return;
      }

      await saveSettings({ ...baseSettings, repo_full_name: repoInput.trim() });
      setToast({ message: "Repo connected.", type: "success" });
      setNeedsCreate(false);
    } catch (err) {
      if (err instanceof AuthError) {
        setToast({ message: "Token invalid. Paste a new token.", type: "error" });
      } else if (err instanceof RateLimitError) {
        setToast({ message: "GitHub rate limit hit. Try later.", type: "error" });
      } else {
        setToast({ message: "Repo check failed.", type: "error" });
      }
    } finally {
      setLoading(false);
    }
  };

  const createRepoFromInput = async () => {
    if (!baseSettings.github_token) {
      return;
    }
    if (!repoInput.trim()) {
      setToast({ message: "Enter a repo name first.", type: "error" });
      return;
    }
    setLoading(true);
    try {
      const currentUser = await getAuthenticatedUser(baseSettings.github_token);
      const parts = repoInput.trim().split("/");
      const repoName = parts.length > 1 ? parts[1] : parts[0];
      await createRepo(baseSettings.github_token, repoName);
      const fullName = parts.length > 1 ? repoInput.trim() : `${currentUser.login}/${repoName}`;
      await saveSettings({ ...baseSettings, repo_full_name: fullName });
      setToast({ message: "Repo created and connected.", type: "success" });
      setNeedsCreate(false);
    } catch (err) {
      setToast({ message: "Repo creation failed.", type: "error" });
    } finally {
      setLoading(false);
    }
  };

  const disconnectAccount = async () => {
    await saveSettings({ ...DEFAULT_SETTINGS });
    setUser(null);
    setRepoInput("");
    setNeedsCreate(false);
    setToast({ message: "Disconnected GitHub account.", type: "success" });
  };

  return (
    <div className="fade-in flex flex-1 flex-col gap-4 p-4">
      <div className="rounded-xl bg-white/5 p-3">
        <h2 className="text-lg font-semibold">Connect your GitHub</h2>
        <p className="mt-1 text-sm text-slate-400">
          AlgoNest runs fully in the extension. Paste a token to connect first.
        </p>
      </div>

      <div className="rounded-xl bg-white/5 p-3">
        <label className="text-[11px] font-medium uppercase tracking-[0.04em] text-slate-400">
          Github OAuth
        </label>
        <p className="mt-1 text-xs text-slate-400">
          Connect your GitHub account securely.
        </p>
        <button
          onClick={() => void handleOAuth()}
          className="mt-3 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-500"
        >
          Connect GitHub
        </button>
      </div>

      <div className="rounded-xl bg-white/5 p-3">
        <label className="text-[11px] font-medium uppercase tracking-[0.04em] text-slate-400">
          Personal Access Token
        </label>
        <p className="mt-1 text-xs text-slate-400">
          Paste a PAT with <code className="text-slate-300">repo</code> and{" "}
          <code className="text-slate-300">user:email</code> scopes.
        </p>
        <input
          value={tokenInput}
          onChange={(event) => setTokenInput(event.target.value)}
          placeholder="ghp_..."
          className="mt-3 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500"
        />
        <button
          onClick={handleManualToken}
          className="mt-2 w-full rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-white/90"
        >
          Save token
        </button>
      </div>

      {hasToken && (
        <div className="rounded-xl bg-white/5 p-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 overflow-hidden rounded-full">
              {user?.avatar_url ? (
                <img src={user.avatar_url} alt={user.login} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center rounded-full bg-slate-600 text-sm font-medium text-white">
                  {(user?.login ?? "GH").slice(0, 2).toUpperCase()}
                </div>
              )}
            </div>
            <div>
              <div className="text-sm font-semibold">{user?.login ?? "GitHub"}</div>
              <div className="text-xs text-slate-400">Token connected</div>
            </div>
          </div>

          <div className="mt-3 flex flex-col gap-2">
            <label className="text-[11px] font-medium uppercase tracking-[0.04em] text-slate-400">
              Repository
            </label>
            <input
              value={repoInput}
              onChange={(event) => {
                setRepoInput(event.target.value);
                setNeedsCreate(false);
              }}
              placeholder="username/leetcode-solutions"
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500"
            />
            <div className="mt-1 flex gap-2">
              <button
                onClick={connectRepo}
                disabled={!repoReady}
                className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition ${
                  repoReady
                    ? "border border-white/20 bg-white/5 text-slate-200 hover:bg-white/10"
                    : "cursor-not-allowed border border-white/10 bg-white/5 text-slate-500"
                }`}
              >
                Connect repo
              </button>
              <button
                onClick={createRepoFromInput}
                disabled={!repoReady}
                className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition ${
                  repoReady
                    ? "border border-indigo-500/40 bg-indigo-500/10 text-indigo-200 hover:bg-indigo-500/20"
                    : "cursor-not-allowed border border-white/10 bg-white/5 text-slate-500"
                }`}
              >
                Create repo
              </button>
            </div>
            {needsCreate && (
              <div className="text-xs text-amber-400">
                Repo not found. Create it to continue.
              </div>
            )}
          </div>

          <button
            onClick={disconnectAccount}
            className="mt-4 w-full rounded-xl border border-red-500/40 bg-transparent px-4 py-2 text-sm font-medium text-red-400 transition hover:bg-red-500/10"
          >
            Disconnect account
          </button>
        </div>
      )}
    </div>
  );
}

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

  const handleOAuth = () => {
    const clientId = import.meta.env.VITE_GITHUB_OAUTH_CLIENT_ID as string | undefined;
    if (!clientId || clientId === "your_client_id_here") {
      setToast({ message: "Add your OAuth client ID in .env to use OAuth.", type: "error" });
      return;
    }
    const url = `https://github.com/login/oauth/authorize?client_id=${clientId}&scope=repo,user:email`;
    chrome.identity.launchWebAuthFlow({ url, interactive: true }, (redirect) => {
      if (chrome.runtime.lastError || !redirect) {
        setToast({ message: "OAuth flow canceled.", type: "error" });
        return;
      }
      const code = new URL(redirect).searchParams.get("code");
      if (code) {
        setToast({
          message: "OAuth code captured. Paste a PAT for now to finish setup.",
          type: "success"
        });
      }
    });
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
    <div className="card fade-in flex flex-1 flex-col gap-4 p-4">
      <div>
        <h2 className="text-xl font-semibold">Connect your GitHub</h2>
        <p className="text-sm text-slate-300">
          AlgoNest runs fully in the extension. Paste a token to connect first.
        </p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
        <div className="text-sm font-medium">OAuth (disabled for now)</div>
        <p className="text-xs text-slate-300">
          OAuth exchange needs a tiny proxy. Click to capture the code.
        </p>
        <button
          disabled
          className="mt-3 cursor-not-allowed rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-400"
        >
          Connect GitHub
        </button>
      </div>

      <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-3">
        <div className="text-sm font-medium text-emerald-100">Developer option</div>
        <p className="text-xs text-emerald-100/80">
          Paste a Personal Access Token with repo + user:email scopes.
        </p>
        <input
          value={tokenInput}
          onChange={(event) => setTokenInput(event.target.value)}
          placeholder="ghp_..."
          className="mt-3 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
        />
        <button
          onClick={handleManualToken}
          className="mt-3 w-full rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950"
        >
          Save token
        </button>
      </div>

      {hasToken && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 overflow-hidden rounded-xl border border-white/10 bg-white/10">
              {user?.avatar_url ? (
                <img src={user.avatar_url} alt={user.login} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-slate-300">
                  GH
                </div>
              )}
            </div>
            <div>
              <div className="text-sm font-semibold">{user?.login ?? "GitHub"}</div>
              <div className="text-xs text-slate-300">Token connected</div>
            </div>
          </div>
          <div className="mt-3">
            <label className="text-xs uppercase text-slate-400">Repository</label>
            <input
              value={repoInput}
              onChange={(event) => {
                setRepoInput(event.target.value);
                setNeedsCreate(false);
              }}
              placeholder="username/leetcode-solutions"
              className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
            />
            <div className="mt-3 flex gap-2">
              <button
                onClick={connectRepo}
                disabled={!repoReady}
                className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold ${
                  repoReady
                    ? "border border-white/20 bg-white/5"
                    : "cursor-not-allowed border border-white/10 bg-white/5 text-slate-400"
                }`}
              >
                Connect repo
              </button>
              <button
                onClick={createRepoFromInput}
                className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold ${
                  repoReady
                    ? "bg-indigo-400/80 text-slate-900"
                    : "cursor-not-allowed bg-white/5 text-slate-400"
                }`}
              >
                Create repo
              </button>
            </div>
            {needsCreate && (
              <div className="mt-2 text-xs text-amber-200">
                Repo not found. Create it to continue.
              </div>
            )}
          </div>
          <button
            onClick={disconnectAccount}
            className="mt-4 w-full rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-100"
          >
            Disconnect account
          </button>
        </div>
      )}
    </div>
  );
}

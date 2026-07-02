import React, { useEffect, useState } from "react";
import type { UserSettings } from "../../shared/types";
import { DEFAULT_SETTINGS } from "../../shared/defaults";
import { getAuthenticatedUser } from "../../shared/github-api";
import { usePopupStore } from "../store";
import { sendMessage } from "../utils";
import type { StatsData } from "../../shared/stats";

type UserInfo = { login: string; avatar_url: string };

type Props = {
  settings: UserSettings;
};

export default function MainScreen({ settings }: Props): JSX.Element {
  const { setSettings, queueCount, setQueueCount, setToast, setLoading } = usePopupStore();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [stats, setStats] = useState<StatsData | null>(null);

  useEffect(() => {
    if (!settings.github_token) {
      return;
    }
    getAuthenticatedUser(settings.github_token)
      .then((info) => setUser(info))
      .catch(() => null);
  }, [settings.github_token]);

  useEffect(() => {
    chrome.storage.local.get(["cached_stats"], (result) => {
      const s = result.cached_stats as StatsData | undefined;
      setStats(s ?? null);
    });
  }, []);

  const updateSettings = async (next: UserSettings) => {
    setLoading(true);
    const saved = await sendMessage<UserSettings>({ type: "SAVE_SETTINGS", settings: next });
    setSettings(saved ?? next);
    setLoading(false);
  };

  const handleToggle = () => {
    void updateSettings({ ...settings, silent_mode: !settings.silent_mode });
  };

  const handleDefaultAction = (value: UserSettings["default_action"]) => {
    void updateSettings({ ...settings, default_action: value });
  };

  const handleCommitStyle = (value: UserSettings["commit_message_style"]) => {
    void updateSettings({ ...settings, commit_message_style: value });
  };

  const handleBranch = (value: string) => {
    void updateSettings({ ...settings, branch: value || "main" });
  };

  const handleFlush = async () => {
    setLoading(true);
    const result = await sendMessage<{ processed: number; remaining: number }>({
      type: "FLUSH_QUEUE"
    });
    if (result) {
      setQueueCount(result.remaining);
      setToast({ message: `Flushed ${result.processed} submissions.`, type: "success" });
    }
    setLoading(false);
  };

  const handleDisconnect = async () => {
    await updateSettings({ ...DEFAULT_SETTINGS });
    setToast({ message: "Disconnected GitHub.", type: "success" });
  };

  const metricValue = (value: number | undefined): string => {
    if (stats === null) return "\u2014";
    return String(value ?? 0);
  };

  return (
    <div className="fade-in flex flex-1 flex-col gap-4 p-4">
      <div className="flex items-center gap-3 rounded-xl bg-white/5 p-3">
        <div className="h-10 w-10 overflow-hidden rounded-full">
          {user?.avatar_url ? (
            <img src={user.avatar_url} alt={user.login} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center rounded-full bg-slate-600 text-sm font-medium text-white">
              {(user?.login ?? "GH").slice(0, 2).toUpperCase()}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{user?.login ?? "GitHub"}</div>
          <div className="truncate text-xs text-slate-400">{settings.repo_full_name}</div>
        </div>
      </div>

      <div className="rounded-xl bg-white/5 p-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">Silent mode</div>
          <button
            onClick={handleToggle}
            className={`h-6 w-12 rounded-full p-1 transition ${
              settings.silent_mode ? "bg-emerald-500" : "bg-slate-600"
            }`}
          >
            <span
              className={`block h-4 w-4 rounded-full bg-white transition ${
                settings.silent_mode ? "translate-x-6" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-[11px] font-medium uppercase tracking-[0.04em] text-slate-400">
          Default action
        </label>
        <div className="relative">
          <select
            value={settings.default_action}
            onChange={(event) => handleDefaultAction(event.target.value as UserSettings["default_action"])}
            className="w-full appearance-none rounded-xl border border-white/10 bg-white/5 px-3 py-2 pr-8 text-sm text-white outline-none"
          >
            <option value="overwrite">Overwrite</option>
            <option value="version">New version</option>
            <option value="skip">Skip</option>
          </select>
          <svg className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </div>

        <label className="mt-3 text-[11px] font-medium uppercase tracking-[0.04em] text-slate-400">
          Commit style
        </label>
        <div className="relative">
          <select
            value={settings.commit_message_style}
            onChange={(event) => handleCommitStyle(event.target.value as UserSettings["commit_message_style"])}
            className="w-full appearance-none rounded-xl border border-white/10 bg-white/5 px-3 py-2 pr-8 text-sm text-white outline-none"
          >
            <option value="rich">Rich</option>
            <option value="simple">Simple</option>
          </select>
          <svg className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </div>

        <label className="mt-3 text-[11px] font-medium uppercase tracking-[0.04em] text-slate-400">
          Branch
        </label>
        <input
          value={settings.branch}
          onChange={(event) => handleBranch(event.target.value)}
          className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500"
          placeholder="main"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-[11px] font-medium uppercase tracking-[0.04em] text-slate-400">
          Your stats
        </label>
        <div className="flex gap-2">
          <div className="flex flex-1 flex-col items-center rounded-xl bg-white/5 p-3">
            <span
              className={`text-[20px] font-medium ${
                stats !== null && stats.total_solved > 0 ? "text-cyan-400" : "text-slate-500"
              }`}
            >
              {metricValue(stats?.total_solved)}
            </span>
            <span className="mt-0.5 text-[11px] text-slate-500">solved</span>
          </div>
          <div className="flex flex-1 flex-col items-center rounded-xl bg-white/5 p-3">
            <span
              className={`text-[20px] font-medium ${
                stats !== null && stats.current_streak > 0 ? "text-amber-400" : "text-slate-500"
              }`}
            >
              {metricValue(stats?.current_streak)}
            </span>
            <span className="mt-0.5 text-[11px] text-slate-500">streak</span>
          </div>
          <div className="flex flex-1 flex-col items-center rounded-xl bg-white/5 p-3">
            <span
              className={`text-[20px] font-medium ${
                stats !== null && stats.longest_streak > 0 ? "text-amber-400" : "text-slate-500"
              }`}
            >
              {metricValue(stats?.longest_streak)}
            </span>
            <span className="mt-0.5 text-[11px] text-slate-500">best streak</span>
          </div>
        </div>
        <div className="flex gap-2">
          <span className="rounded-full bg-[#00b8a3]/15 px-3 py-1 text-xs font-medium text-[#00b8a3]">
            Easy {stats?.by_difficulty?.Easy ?? "\u2014"}
          </span>
          <span className="rounded-full bg-[#ffa116]/15 px-3 py-1 text-xs font-medium text-[#ffa116]">
            Medium {stats?.by_difficulty?.Medium ?? "\u2014"}
          </span>
          <span className="rounded-full bg-[#ff375f]/15 px-3 py-1 text-xs font-medium text-[#ff375f]">
            Hard {stats?.by_difficulty?.Hard ?? "\u2014"}
          </span>
        </div>
      </div>

      <div className="rounded-xl bg-white/5 p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-300">
            {queueCount === 0
              ? "0 submissions pending"
              : `${queueCount} submission${queueCount === 1 ? "" : "s"} pending`}
          </span>
          <button
            onClick={handleFlush}
            disabled={queueCount === 0}
            className={`rounded-lg border px-3 py-1 text-xs font-medium uppercase tracking-wide transition ${
              queueCount === 0
                ? "border-white/5 text-slate-600"
                : "border-white/20 text-slate-300 hover:bg-white/10"
            }`}
          >
            Flush
          </button>
        </div>
      </div>

      <button
        onClick={handleDisconnect}
        className="rounded-xl border border-red-500/40 bg-transparent px-4 py-2 text-sm font-medium text-red-400 transition hover:bg-red-500/10"
      >
        Disconnect GitHub
      </button>
    </div>
  );
}

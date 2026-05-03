import React, { useEffect, useState } from "react";
import type { UserSettings } from "../../shared/types";
import { DEFAULT_SETTINGS } from "../../shared/defaults";
import { getAuthenticatedUser } from "../../shared/github-api";
import { usePopupStore } from "../store";
import { sendMessage } from "../utils";

type UserInfo = { login: string; avatar_url: string };

type Props = {
  settings: UserSettings;
};

export default function MainScreen({ settings }: Props): JSX.Element {
  const { setSettings, queueCount, setQueueCount, setToast, setLoading } = usePopupStore();
  const [user, setUser] = useState<UserInfo | null>(null);

  useEffect(() => {
    if (!settings.github_token) {
      return;
    }
    getAuthenticatedUser(settings.github_token)
      .then((info) => setUser(info))
      .catch(() => null);
  }, [settings.github_token]);

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

  return (
    <div className="card fade-in flex flex-1 flex-col gap-4 p-4">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 overflow-hidden rounded-2xl border border-white/10 bg-white/10">
          {user?.avatar_url ? (
            <img src={user.avatar_url} alt={user.login} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-sm text-slate-300">
              GH
            </div>
          )}
        </div>
        <div>
          <div className="text-base font-semibold">{user?.login ?? "GitHub"}</div>
          <div className="text-xs text-slate-300">{settings.repo_full_name}</div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
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

      <div className="grid gap-3">
        <label className="text-xs uppercase text-slate-400">Default action</label>
        <select
          value={settings.default_action}
          onChange={(event) => handleDefaultAction(event.target.value as UserSettings["default_action"])}
          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
        >
          <option value="overwrite">Overwrite</option>
          <option value="version">New version</option>
          <option value="skip">Skip</option>
        </select>

        <label className="text-xs uppercase text-slate-400">Commit style</label>
        <select
          value={settings.commit_message_style}
          onChange={(event) => handleCommitStyle(event.target.value as UserSettings["commit_message_style"])}
          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
        >
          <option value="rich">Rich</option>
          <option value="simple">Simple</option>
        </select>

        <label className="text-xs uppercase text-slate-400">Branch</label>
        <input
          value={settings.branch}
          onChange={(event) => handleBranch(event.target.value)}
          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
          placeholder="main"
        />
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
        <div className="flex items-center justify-between text-sm">
          <span>{queueCount} submissions pending</span>
          <button
            onClick={handleFlush}
            className="rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-wide"
          >
            Flush
          </button>
        </div>
      </div>

      <button
        onClick={handleDisconnect}
        className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-100"
      >
        Disconnect GitHub
      </button>
    </div>
  );
}

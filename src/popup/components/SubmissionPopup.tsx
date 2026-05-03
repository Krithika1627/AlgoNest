import React, { useEffect, useMemo, useState } from "react";
import type { CommitResult, SubmissionPayload, UserSettings } from "../../shared/types";
import { classifyTopic } from "../../shared/classifier";
import { usePopupStore } from "../store";
import { sendMessage } from "../utils";

type Props = {
  pending: SubmissionPayload;
  settings: UserSettings;
};

function difficultyClass(diff: string): string {
  if (diff === "Hard") {
    return "bg-rose-500/20 text-rose-100";
  }
  if (diff === "Medium") {
    return "bg-amber-500/20 text-amber-100";
  }
  return "bg-emerald-500/20 text-emerald-100";
}

export default function SubmissionPopup({ pending, settings }: Props): JSX.Element {
  const { setToast, setLoading, setPendingSubmission, setScreen } = usePopupStore();
  const [notes, setNotes] = useState("");
  const [action, setAction] = useState<UserSettings["default_action"]>(
    pending.action ?? settings.default_action
  );

  const topic = useMemo(
    () =>
      classifyTopic(
        pending.tags,
        pending.problem_title,
        settings.classification_overrides
      ),
    [pending.problem_title, pending.tags, settings.classification_overrides]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void handleSkip();
    }, 30000);
    return () => window.clearTimeout(timer);
  }, []);

  const handleSave = async () => {
    setLoading(true);
    const payload: SubmissionPayload = {
      ...pending,
      notes: notes.trim() || undefined,
      action
    };

    await chrome.storage.local.set({ pending_submission: null });

    const result = await sendMessage<CommitResult>({
      type: "POPUP_RESPONSE",
      payload
    });

    setLoading(false);
    setPendingSubmission(null);
    setScreen("main");

    if (result?.status === "committed" || result?.status === "versioned") {
      setToast({ message: "Committed to GitHub.", type: "success" });
    } else if (result?.status === "queued") {
      setToast({ message: "Queued for retry.", type: "success" });
    } else {
      setToast({ message: result?.message ?? "Commit failed.", type: "error" });
    }
  };

  const handleSkip = async () => {
    await chrome.storage.local.set({ pending_submission: null });
    setPendingSubmission(null);
    setScreen("main");
    window.close();
  };

  return (
    <div className="card fade-in flex flex-1 flex-col gap-4 p-4">
      <div className="progress-track">
        <div className="progress-bar" style={{ animationDuration: "30s" }} />
      </div>

      <div>
        <div className="text-lg font-semibold">{pending.problem_title}</div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className={`rounded-full px-3 py-1 ${difficultyClass(pending.difficulty)}`}>
            {pending.difficulty}
          </span>
          <span className="tag">{pending.language}</span>
          <span className="tag">→ {topic}</span>
        </div>
      </div>

      <textarea
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        placeholder="Notes / approach (optional)"
        className="min-h-[120px] rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
      />

      <div className="flex gap-2 text-xs">
        {["overwrite", "version", "skip"].map((value) => (
          <button
            key={value}
            onClick={() => setAction(value as UserSettings["default_action"])}
            className={`flex-1 rounded-xl px-3 py-2 uppercase tracking-wide ${
              action === value ? "bg-indigo-500 text-white" : "bg-white/5 text-slate-200"
            }`}
          >
            {value === "overwrite" ? "Overwrite" : value === "version" ? "New version" : "Skip"}
          </button>
        ))}
      </div>

      <button
        onClick={handleSave}
        className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-900"
      >
        Save & Commit
      </button>

      <button onClick={handleSkip} className="text-xs text-slate-300">
        Skip
      </button>
    </div>
  );
}

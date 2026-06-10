import React, { useMemo, useState, useEffect, useCallback } from "react";
import type { CommitResult, SubmissionPayload, UserSettings } from "../../shared/types";
import { classifyTopic } from "../../shared/classifier";
import { usePopupStore } from "../store";
import { sendMessage } from "../utils";

type Props = {
  pending: SubmissionPayload;
  settings: UserSettings;
};

const TOPICS = [
  "Arrays",
  "DynamicProgramming",
  "Graphs",
  "Trees",
  "BinarySearch",
  "TwoPointers",
  "SlidingWindow",
  "Backtracking",
  "Stack",
  "Queue",
  "Heap",
  "LinkedList",
  "Trie",
  "BitManipulation",
  "Math",
  "Strings",
  "Uncategorized"
] as const;

const DIFFICULTY_STYLES: Record<string, { bg: string; text: string }> = {
  Easy: { bg: "#00b8a3", text: "#ffffff" },
  Medium: { bg: "#ffa116", text: "#ffffff" },
  Hard: { bg: "#ff375f", text: "#ffffff" }
};

export default function PopupV2({ pending, settings }: Props): JSX.Element {
  const { setToast, setLoading, setPendingSubmission, setScreen } = usePopupStore();
  const [notes, setNotes] = useState("");
  const [action, setAction] = useState<UserSettings["default_action"]>(
    pending.action ?? settings.default_action
  );
  const [topicOverride, setTopicOverride] = useState<string | undefined>(pending.topic_override);
  const [showTopicDropdown, setShowTopicDropdown] = useState(false);
  const [wasSolvedBefore, setWasSolvedBefore] = useState(false);

  const initialTopic = useMemo(
    () =>
      classifyTopic(
        pending.tags,
        pending.problem_title,
        settings.classification_overrides
      ),
    [pending.problem_title, pending.tags, settings.classification_overrides]
  );

  const topic = topicOverride ?? initialTopic;

  // Check if this slug was solved before (exists in code_hashes)
  useEffect(() => {
    chrome.storage.local.get("code_hashes", (result: { code_hashes?: Record<string, string> }) => {
      const hashes = result.code_hashes ?? {};
      if (hashes[pending.problem_slug]) {
        setWasSolvedBefore(true);
        setAction("version");
      }
    });
  }, [pending.problem_slug]);

  const handleTopicSelect = useCallback((selected: string) => {
    setTopicOverride(selected);
    setShowTopicDropdown(false);
  }, []);

  const getToastDetails = (result: CommitResult) => {
    if (!result.file_path) {
      return { message: "Committed to GitHub." };
    }

    const cleanedPath = result.file_path.replace(/^\/+/, "");
    const pathParts = cleanedPath.split("/");
    const fileName = pathParts[pathParts.length - 1] ?? "";
    const topicSegment = result.topic ?? pathParts[pathParts.length - 2] ?? "";
    const baseSlug = fileName.replace(/\.[^.]+$/, "").replace(/_v\d+$/, "");
    const mdPath = `solutions/${topicSegment}/${baseSlug}.md`;
    const branch = settings.branch || "main";
    const repo = settings.repo_full_name;
    const url = repo ? `https://github.com/${repo}/blob/${branch}/${mdPath}` : "";

    return {
      message: `✓ Committed to ${topicSegment}/${baseSlug}.md`,
      linkUrl: url,
      linkLabel: "View on GitHub →"
    };
  };

  const handleSave = async () => {
    setLoading(true);
    const trimmedNotes = notes.trim();
    const payload: SubmissionPayload = {
      ...pending,
      notes: trimmedNotes,
      action,
      topic_override: topicOverride
    };

    let result: CommitResult | undefined;

    try {
      await new Promise<void>((resolve) => {
        chrome.storage.local.remove("pending_submission", () => resolve());
      });

      result = await sendMessage<CommitResult>({
        type: "POPUP_RESPONSE",
        payload
      });
    } catch (err) {
      console.warn("Commit failed", err);
      setToast({ message: "Commit failed. Check service worker logs.", type: "error" });
    } finally {
      setLoading(false);
    }

    if (!result) {
      setToast({ message: "Commit failed. No response from service worker.", type: "error" });
      setPendingSubmission(null);
      setScreen("main");
      return;
    }

    if (result.status === "committed" || result.status === "versioned") {
      const toastDetails = getToastDetails(result);
      setToast({ ...toastDetails, type: "success" });
      setPendingSubmission(null);
      setScreen("main");
      window.setTimeout(() => window.close(), 3500);
    } else if (result.status === "queued") {
      setToast({ message: "Queued for retry.", type: "success" });
      setPendingSubmission(null);
      setScreen("main");
      window.setTimeout(() => window.close(), 3500);
    } else if (result.status === "skipped") {
      setToast({ message: "Submission skipped.", type: "success" });
      setPendingSubmission(null);
      setScreen("main");
      window.setTimeout(() => window.close(), 3500);
    } else {
      setToast({ message: result.message ?? "Commit failed.", type: "error" });
      setPendingSubmission(null);
      setScreen("main");
    }
  };

  const handleSkip = async () => {
    const payload: SubmissionPayload = {
      ...pending,
      notes: "",
      action: "skip",
      topic_override: topicOverride
    };

    await chrome.storage.local.remove("pending_submission");

    await sendMessage<CommitResult>({
      type: "POPUP_RESPONSE",
      payload
    });

    setPendingSubmission(null);
    setScreen("main");

    window.close();
  };

  // --- MAIN POPUP CONTENT ---
  const diffStyle = DIFFICULTY_STYLES[pending.difficulty];

  return (
    <div className="card fade-in flex flex-1 flex-col gap-4 p-4">
      {/* Problem Title + Difficulty Badge */}
      <div>
        <div className="flex items-start justify-between gap-2">
          <div className="text-lg font-semibold">{pending.problem_title}</div>
          <span
            className="inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide"
            style={{
              backgroundColor: diffStyle.bg,
              color: diffStyle.text
            }}
          >
            {pending.difficulty}
          </span>
        </div>

        {/* Classification Pill / Language */}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          {/* Clickable topic pill */}
          <div className="relative">
            <button
              onClick={() => setShowTopicDropdown((prev) => !prev)}
              className="tag flex items-center gap-1 transition hover:border-white/40"
            >
              → {topic}
              <svg
                className={`h-3 w-3 transition ${showTopicDropdown ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
            </button>
            {showTopicDropdown && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowTopicDropdown(false)} />
                <div className="absolute left-0 top-full z-20 mt-1 max-h-48 w-48 overflow-y-auto rounded-xl border border-white/10 bg-[#1d2340] p-1 shadow-2xl backdrop-blur-xl">
                  {TOPICS.map((t) => (
                    <button
                      key={t}
                      onClick={() => handleTopicSelect(t)}
                      className={`w-full rounded-lg px-3 py-1.5 text-left text-xs transition ${
                        t === topic
                          ? "bg-indigo-500/40 text-indigo-100"
                          : "text-slate-300 hover:bg-white/10"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <span className="tag">{pending.language}</span>
        </div>

        {/* Version Indicator */}
        {wasSolvedBefore && (
          <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-1 text-xs text-amber-200">
            <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
            </svg>
            You've solved this before
          </div>
        )}
      </div>

      {/* Notes textarea */}
      <textarea
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        placeholder="Notes / approach (optional)"
        className="min-h-[120px] rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
      />

      {/* Action buttons */}
      <div className="flex gap-2 text-xs">
        {(["overwrite", "version", "skip"] as const).map((value) => (
          <button
            key={value}
            onClick={() => setAction(value)}
            className={`flex-1 rounded-xl px-3 py-2 uppercase tracking-wide transition ${
              action === value ? "bg-indigo-500 text-white" : "bg-white/5 text-slate-200"
            }`}
          >
            {value === "overwrite" ? "Overwrite" : value === "version" ? "New version" : "Skip"}
          </button>
        ))}
      </div>

      {/* Save & Commit */}
      <button
        onClick={handleSave}
        className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-white/90"
      >
        Save & Commit
      </button>

      {/* Skip link */}
      <button onClick={handleSkip} className="text-xs text-slate-300 hover:text-slate-100">
        Skip
      </button>
    </div>
  );
}

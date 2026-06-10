import React, { useEffect } from "react";
import SetupScreen from "./components/SetupScreen";
import PopupV2 from "./components/PopupV2";
import MainScreen from "./components/MainScreen";
import { usePopupStore } from "./store";
import { sendMessage } from "./utils";
import type { SubmissionPayload, UserSettings } from "../shared/types";

export default function App(): JSX.Element {
  const {
    screen,
    setScreen,
    settings,
    setSettings,
    pendingSubmission,
    setPendingSubmission,
    queueCount,
    setQueueCount,
    toast,
    setToast,
    isLoading
  } = usePopupStore();

  useEffect(() => {
    const load = async () => {
      const storedSettings = await sendMessage<UserSettings>({ type: "GET_SETTINGS" });
      if (storedSettings) {
        setSettings(storedSettings);
      }

      const count = await sendMessage<number>({ type: "GET_QUEUE_COUNT" });
      if (typeof count === "number") {
        setQueueCount(count);
      }

      chrome.storage.local.get(
        ["pending_submission", "auth_error"],
        (result: { pending_submission?: SubmissionPayload; auth_error?: boolean }) => {
          if (result.pending_submission) {
            setPendingSubmission(result.pending_submission);
          }
          if (result.auth_error) {
            setToast({ message: "GitHub auth expired. Reconnect to continue.", type: "error" });
          }
        }
      );
    };

    void load();
  }, [setPendingSubmission, setQueueCount, setSettings, setToast]);

  useEffect(() => {
    if (!settings?.github_token || !settings.repo_full_name) {
      setScreen("setup");
    } else if (pendingSubmission) {
      setScreen("popup");
    } else {
      setScreen("main");
    }
  }, [pendingSubmission, setScreen, settings]);

  useEffect(() => {
    const listener = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (areaName !== "local") {
        return;
      }
      if (changes.pending_submission) {
        setPendingSubmission(changes.pending_submission.newValue ?? null);
      }
      if (changes.settings) {
        setSettings(changes.settings.newValue ?? null);
      }
      if (changes.submission_queue) {
        const nextQueue = changes.submission_queue.newValue as unknown[] | undefined;
        setQueueCount(nextQueue?.length ?? 0);
      }
    };

    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [setPendingSubmission, setSettings]);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }
    const timer = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timer);
  }, [setToast, toast]);

  const openToastLink = (url: string) => {
    if (!url) {
      return;
    }
    if (chrome?.tabs?.create) {
      chrome.tabs.create({ url });
    } else {
      window.open(url, "_blank");
    }
  };

  return (
    <div className="relative flex w-full flex-1 flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div className="text-lg font-semibold tracking-tight">AlgoNest</div>
        <div className="text-xs uppercase text-slate-300">{queueCount} queued</div>
      </div>

      {toast && (
        <div
          className={`rounded-xl px-4 py-3 text-sm shadow-lg backdrop-blur ${
            toast.type === "success"
              ? "bg-emerald-500/20 text-emerald-50"
              : "bg-rose-500/20 text-rose-50"
          }`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span>{toast.message}</span>
            {toast.linkUrl && (
              <button
                onClick={() => openToastLink(toast.linkUrl ?? "")}
                className="underline underline-offset-2"
              >
                {toast.linkLabel ?? "View on GitHub →"}
              </button>
            )}
          </div>
        </div>
      )}

      {screen === "setup" && <SetupScreen />}
      {screen === "popup" && pendingSubmission && settings && (
        <PopupV2 pending={pendingSubmission} settings={settings} />
      )}
      {screen === "main" && settings && <MainScreen settings={settings} />}

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/40">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        </div>
      )}
    </div>
  );
}

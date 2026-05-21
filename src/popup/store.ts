import { create } from "zustand";
import type { SubmissionPayload, UserSettings } from "../shared/types";

type Screen = "setup" | "popup" | "main";

type Toast = {
  message: string;
  type: "success" | "error";
  linkUrl?: string;
  linkLabel?: string;
} | null;

interface PopupStore {
  settings: UserSettings | null;
  pendingSubmission: SubmissionPayload | null;
  queueCount: number;
  screen: Screen;
  isLoading: boolean;
  toast: Toast;
  setSettings: (settings: UserSettings | null) => void;
  setPendingSubmission: (payload: SubmissionPayload | null) => void;
  setQueueCount: (count: number) => void;
  setScreen: (screen: Screen) => void;
  setLoading: (loading: boolean) => void;
  setToast: (toast: Toast) => void;
}

export const usePopupStore = create<PopupStore>((set) => ({
  settings: null,
  pendingSubmission: null,
  queueCount: 0,
  screen: "setup",
  isLoading: false,
  toast: null,
  setSettings: (settings) => set({ settings }),
  setPendingSubmission: (pendingSubmission) => set({ pendingSubmission }),
  setQueueCount: (queueCount) => set({ queueCount }),
  setScreen: (screen) => set({ screen }),
  setLoading: (isLoading) => set({ isLoading }),
  setToast: (toast) => set({ toast })
}));

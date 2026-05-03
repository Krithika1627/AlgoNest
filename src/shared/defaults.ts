import type { UserSettings } from "./types";

export const DEFAULT_SETTINGS: UserSettings = {
  github_token: "",
  repo_full_name: "",
  branch: "main",
  silent_mode: false,
  default_action: "overwrite",
  debounce_ms: 3000,
  commit_message_style: "rich",
  classification_overrides: {},
  track_streaks: false
};

export interface SubmissionPayload {
  problem_slug: string;
  problem_title: string;
  language: string;
  code: string;
  difficulty: "Easy" | "Medium" | "Hard";
  tags: string[];
  runtime_ms: number;
  memory_mb: number;
  submission_id: string;
  timestamp: string;
  notes?: string;
  action: "overwrite" | "version" | "skip";
}

export interface UserSettings {
  github_token: string;
  repo_full_name: string;
  branch: string;
  silent_mode: boolean;
  default_action: "overwrite" | "version" | "skip";
  debounce_ms: number;
  commit_message_style: "rich" | "simple";
  classification_overrides: Record<string, string>;
  track_streaks: boolean;
}

export interface QueuedSubmission {
  payload: SubmissionPayload;
  queued_at: string;
  retry_count: number;
}

export interface CommitResult {
  status: "committed" | "queued" | "skipped" | "versioned" | "error";
  topic?: string;
  file_path?: string;
  commit_sha?: string;
  commit_message?: string;
  version?: number;
  message?: string;
}

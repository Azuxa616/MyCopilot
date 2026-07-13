/**
 * Shared types for debug mode functionality.
 * Used across web and server for build info, environment info, and store snapshots.
 */

export interface BuildInfo {
  git: {
    branch: string | null; // null = detached or git unavailable
    commit: string | null; // 7+ char hash
    commitDate: string | null; // ISO format
    describe: string | null; // includes -dirty marker
    dirty: boolean;
  } | null; // null = git completely unavailable
  buildTime: string; // ISO8601 format
  note?: string; // e.g., "git unavailable"
}

export interface DebugEnvInfo {
  nodeVersion: string;
  platform: string;
  arch: string;
  uptime: number; // seconds
  dbPath: string; // basename only, e.g., "mycopilot.db"
  nodeEnv: string;
}

export interface StoreSnapshot {
  serialized: string; // redacted JSON string
  redactedFields: string[]; // list of redacted field names
  truncated: boolean; // whether data was truncated due to size
  sessionCount: number;
  messageCount: number;
}
import { appendFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface RunAuditEntry {
  profileId: string;
  runId: string;
  url: string;
  timestamp: string;
}

export interface SessionAuditEntry {
  profileId: string;
  sessionId: string;
  event: 'opened' | 'closed' | 'recording_started' | 'recording_stopped';
  at: string;
}

export type AuditEntry = RunAuditEntry | SessionAuditEntry;

export class AuditLogger {
  constructor(private readonly artifactsRoot: string) {}

  private logPath(): string {
    return resolve(this.artifactsRoot, 'audit.log');
  }

  async append(entry: AuditEntry): Promise<void> {
    await mkdir(this.artifactsRoot, { recursive: true });
    await appendFile(this.logPath(), JSON.stringify(entry) + '\n', 'utf8');
  }
}

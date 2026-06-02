export type RunStatus = 'completed' | 'failed';

export interface RunRecord {
  id: string;
  profileId: string;
  url: string;
  status: RunStatus;
  startedAt: string;
  finishedAt: string;
  error: string | null;
  page: { title: string; finalUrl: string } | null;
  artifacts: { screenshot: string | null };
}

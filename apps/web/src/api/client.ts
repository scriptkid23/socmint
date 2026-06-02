export interface Profile {
  id: string;
  label: string;
  proxy: string | null;
  status: 'idle' | 'authenticating';
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type WaitUntil = 'load' | 'domcontentloaded' | 'commit';

export interface ProfileNodeData {
  profileId: string | null;
}
export interface GotoNodeData {
  url: string;
  waitUntil?: WaitUntil;
  timeoutMs?: number;
}
export interface WaitNodeData {
  ms: number;
}
export type BoardNodeData = ProfileNodeData | GotoNodeData | WaitNodeData | Record<string, never>;

export interface BoardNode {
  id: string;
  type: 'profile' | 'goto' | 'wait' | 'screenshot';
  position: { x: number; y: number };
  data: BoardNodeData;
}
export interface BoardEdge {
  id: string;
  source: string;
  target: string;
}
export interface BoardGraph {
  nodes: BoardNode[];
  edges: BoardEdge[];
}
export interface Board {
  id: string;
  name: string;
  graph: BoardGraph;
  createdAt: string;
  updatedAt: string;
}

export interface FlowStepRecord {
  type: 'goto' | 'wait' | 'screenshot';
  status: 'completed' | 'failed';
  error: string | null;
  title?: string;
  finalUrl?: string;
  screenshot?: string | null;
}
export interface FlowRunRecord {
  id: string;
  profileId: string;
  status: 'completed' | 'failed';
  startedAt: string;
  finishedAt: string;
  error: string | null;
  steps: FlowStepRecord[];
}
export interface BoardRunRecord {
  id: string;
  boardId: string;
  startedAt: string;
  finishedAt: string;
  runs: FlowRunRecord[];
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.message) message = String(body.message);
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  listProfiles: () => req<Profile[]>('/profiles'),
  getProfile: (id: string) => req<Profile>(`/profiles/${id}`),
  createProfile: (body: { label: string; proxy?: string | null }) =>
    req<Profile>('/profiles', { method: 'POST', body: JSON.stringify(body) }),
  updateProfile: (id: string, body: { label?: string; proxy?: string | null }) =>
    req<Profile>(`/profiles/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteProfile: (id: string) => req<void>(`/profiles/${id}`, { method: 'DELETE' }),
  openLoginSession: (id: string) =>
    req<{ sessionId: string; status: 'authenticating' }>(`/profiles/${id}/login-session`, {
      method: 'POST',
    }),
  closeLoginSession: (id: string) =>
    req<void>(`/profiles/${id}/login-session`, { method: 'DELETE' }),
  listBoards: () => req<Board[]>('/boards'),
  getBoard: (id: string) => req<Board>(`/boards/${id}`),
  createBoard: (body: { name: string }) =>
    req<Board>('/boards', { method: 'POST', body: JSON.stringify(body) }),
  updateBoard: (id: string, body: { name?: string; graph?: BoardGraph }) =>
    req<Board>(`/boards/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteBoard: (id: string) => req<void>(`/boards/${id}`, { method: 'DELETE' }),
  runBoard: (id: string) =>
    req<BoardRunRecord>(`/boards/${id}/run`, { method: 'POST' }),
};

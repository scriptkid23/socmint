import type { WaitUntil } from '@socmint/browser-core';
import type { FlowRunRecord } from '../runs/run.types';

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
export type ScreenshotNodeData = Record<string, never>;

interface NodeBase {
  id: string;
  position: { x: number; y: number };
}

export type BoardNode =
  | (NodeBase & { type: 'profile'; data: ProfileNodeData })
  | (NodeBase & { type: 'goto'; data: GotoNodeData })
  | (NodeBase & { type: 'wait'; data: WaitNodeData })
  | (NodeBase & { type: 'screenshot'; data: ScreenshotNodeData });

export interface BoardEdge {
  id: string;
  source: string;
  target: string;
}

export interface BoardGraph {
  nodes: BoardNode[];
  edges: BoardEdge[];
}

export interface BoardRecord {
  id: string;
  name: string;
  graph: BoardGraph;
  createdAt: string;
  updatedAt: string;
}

export interface BoardRunRecord {
  id: string;
  boardId: string;
  startedAt: string;
  finishedAt: string;
  runs: FlowRunRecord[];
}

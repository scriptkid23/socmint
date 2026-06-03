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
export type AgentProvider = 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'openrouter';
export interface AgentNodeData {
  prompt: string;
  provider: AgentProvider;
  model: string;
  apiKey: string;
  /** Ollama base URL (default http://127.0.0.1:11434). */
  baseUrl?: string;
  maxSteps?: number;
  timeoutMs?: number;
  allowDomains?: string[];
  /** When true, agent may only navigate to hosts from prior Goto nodes (blocks opening external result links via navigate). */
  restrictToGotoDomains?: boolean;
  readOnly?: boolean;
}
export type ScreenshotNodeData = Record<string, never>;

export type RecordedStep =
  | { type: 'navigate'; url: string; title?: string; at: string }
  | {
      type: 'click';
      tag: string;
      text: string;
      href: string | null;
      selector: string;
      at: string;
    }
  | {
      type: 'type';
      tag: string;
      text: string;
      selector: string;
      value: string;
      at: string;
    }
  | { type: 'scroll'; direction: 'up' | 'down'; at: string };

export interface RecordNodeData {
  steps: RecordedStep[];
}

interface NodeBase {
  id: string;
  position: { x: number; y: number };
}

export type BoardNode =
  | (NodeBase & { type: 'profile'; data: ProfileNodeData })
  | (NodeBase & { type: 'goto'; data: GotoNodeData })
  | (NodeBase & { type: 'wait'; data: WaitNodeData })
  | (NodeBase & { type: 'agent'; data: AgentNodeData })
  | (NodeBase & { type: 'screenshot'; data: ScreenshotNodeData })
  | (NodeBase & { type: 'record'; data: RecordNodeData });

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

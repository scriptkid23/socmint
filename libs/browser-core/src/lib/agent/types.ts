export type AgentProvider = 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'openrouter';

export const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';

export type AgentActionType =
  | 'navigate'
  | 'click'
  | 'type'
  | 'pressEnter'
  | 'scroll'
  | 'extract'
  | 'finish';

export interface AgentAction {
  type: AgentActionType;
  url?: string;
  index?: number;
  text?: string;
  direction?: 'up' | 'down';
  data?: unknown;
  result?: unknown;
}

export interface AgentDecision {
  thought: string;
  action: AgentAction;
  done?: boolean;
}

export interface AgentLimits {
  maxSteps: number;
  timeoutMs: number;
  allowDomains: string[];
  readOnly: boolean;
}

export interface AgentTask {
  prompt: string;
  provider: AgentProvider;
  model: string;
  apiKey: string;
  /** Ollama server URL (e.g. http://127.0.0.1:11434). Ignored for cloud providers. */
  baseUrl?: string;
}

export type AgentStopReason = 'finished' | 'max-steps' | 'timeout' | 'error';

export interface AgentResult {
  status: 'completed' | 'failed';
  stopReason: AgentStopReason;
  stepsUsed: number;
  error: string | null;
  result: unknown | null;
  transcript: Array<{
    step: number;
    thought: string;
    action: AgentAction;
    observation: string;
    blocked?: boolean;
  }>;
}

export interface DomElement {
  index: number;
  tag: string;
  role: string | null;
  text: string;
  href: string | null;
  /** Current value for input/textarea elements. */
  value?: string | null;
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmCompleteOptions {
  signal?: AbortSignal;
}

export interface LlmClient {
  complete(messages: LlmMessage[], opts?: LlmCompleteOptions): Promise<{ content: string }>;
}

/** Browser page surface for the agent (extends PageLike). */
export interface PageActions {
  goto(url: string, opts: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  title(): Promise<string>;
  url(): string;
  screenshot(opts: { path: string; fullPage: boolean }): Promise<unknown>;
  click(index: number): Promise<void>;
  type(index: number, text: string): Promise<void>;
  /** Set the value of a specific input/textarea/contenteditable by CSS selector. */
  fill(selector: string, value: string): Promise<void>;
  /** Click a specific element by CSS selector. */
  clickSelector(selector: string): Promise<void>;
  pressEnter(): Promise<void>;
  scroll(direction: 'up' | 'down'): Promise<void>;
  /** True when `document.querySelector(selector)` matches at least one element. */
  selectorExists(selector: string): Promise<boolean>;
  /** Run arbitrary JavaScript in the page context (e.g. alert, DOM tweaks). */
  runScript(code: string): Promise<void>;
  readDom(): Promise<DomElement[]>;
  isClosed?(): boolean;
}

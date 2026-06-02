import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { AgentProvider } from '../../../api/client';

export interface AgentNodeProps extends NodeProps {
  data: {
    prompt: string;
    provider: AgentProvider;
    model: string;
    apiKey: string;
    baseUrl?: string;
    maxSteps?: number;
    timeoutMs?: number;
    readOnly?: boolean;
    onChange?: (patch: Record<string, unknown>) => void;
  };
}

const PROVIDERS: AgentProvider[] = ['openai', 'anthropic', 'gemini', 'ollama'];

const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';

const MODEL_PLACEHOLDER: Record<AgentProvider, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-20241022',
  gemini: 'gemini-2.0-flash',
  ollama: 'gemma3:4b',
};

export function AgentNode({ data }: AgentNodeProps) {
  const patch = (p: Record<string, unknown>) => data.onChange?.(p);
  const isOllama = data.provider === 'ollama';

  return (
    <div className="min-w-56 max-w-xs border-2 border-foreground bg-background">
      <Handle type="target" position={Position.Left} />
      <div className="border-b-2 border-foreground bg-foreground px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-background">
        AI Agent
      </div>
      <div className="space-y-2 p-2">
        <textarea
          className="h-16 w-full resize-y border-2 border-foreground bg-background px-2 py-1 font-mono text-xs"
          placeholder="Prompt: what should the agent do?"
          value={data.prompt}
          onChange={(e) => patch({ prompt: e.target.value })}
        />
        <select
          className="w-full border-2 border-foreground bg-background px-2 py-1 font-mono text-[10px] uppercase"
          value={data.provider}
          onChange={(e) => {
            const provider = e.target.value as AgentProvider;
            const next: Record<string, unknown> = { provider };
            if (provider === 'ollama' && !data.baseUrl?.trim()) {
              next.baseUrl = DEFAULT_OLLAMA_BASE_URL;
            }
            patch(next);
          }}
        >
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        {isOllama ? (
          <input
            className="w-full border-2 border-foreground bg-background px-2 py-1 font-mono text-xs"
            placeholder="Ollama URL"
            value={data.baseUrl ?? DEFAULT_OLLAMA_BASE_URL}
            onChange={(e) => patch({ baseUrl: e.target.value })}
          />
        ) : null}
        <input
          className="w-full border-2 border-foreground bg-background px-2 py-1 font-mono text-xs"
          placeholder={`Model (e.g. ${MODEL_PLACEHOLDER[data.provider]})`}
          value={data.model}
          onChange={(e) => patch({ model: e.target.value })}
        />
        <input
          type="password"
          className="w-full border-2 border-foreground bg-background px-2 py-1 font-mono text-xs"
          placeholder={isOllama ? 'API key (optional)' : 'API key'}
          value={data.apiKey}
          onChange={(e) => patch({ apiKey: e.target.value })}
        />
        <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest">
          <input
            type="checkbox"
            checked={data.readOnly !== false}
            onChange={(e) => patch({ readOnly: e.target.checked })}
          />
          Read-only
        </label>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

import { formatDomForPrompt, parseAgentDecision } from './dom-serializer';
import { AGENT_SYSTEM_PROMPT } from './llm-client';
import type {
  AgentAction,
  AgentDecision,
  AgentLimits,
  AgentResult,
  AgentStopReason,
  AgentTask,
  LlmClient,
  LlmMessage,
  PageActions,
} from './types';

const BLOCKED_TYPES = new Set(['submit', 'delete', 'send']);

function hostnameAllowed(url: string, allowDomains: string[]): boolean {
  if (allowDomains.length === 0) return true;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return allowDomains.some((d) => host === d.replace(/^www\./, '') || host.endsWith(`.${d.replace(/^www\./, '')}`));
  } catch {
    return false;
  }
}

export function isBlockedAction(action: AgentAction, limits: AgentLimits): string | null {
  if (BLOCKED_TYPES.has(action.type)) {
    return `Action type "${action.type}" is not allowed`;
  }
  if (limits.readOnly && action.type === 'navigate' && action.url) {
    if (!hostnameAllowed(action.url, limits.allowDomains)) {
      return `Navigation to ${action.url} is outside allowed domains`;
    }
  }
  return null;
}

export async function executeAction(
  page: PageActions,
  action: AgentAction,
  limits: AgentLimits,
): Promise<void> {
  switch (action.type) {
    case 'navigate':
      if (!action.url) throw new Error('navigate requires url');
      if (!hostnameAllowed(action.url, limits.allowDomains)) {
        throw new Error(`Domain not allowed: ${action.url}`);
      }
      await page.goto(action.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      break;
    case 'click':
      if (action.index === undefined) throw new Error('click requires index');
      await page.click(action.index);
      break;
    case 'type':
      if (action.index === undefined || action.text === undefined) throw new Error('type requires index and text');
      await page.type(action.index, action.text);
      break;
    case 'pressEnter':
      await page.pressEnter();
      break;
    case 'scroll':
      await page.scroll(action.direction ?? 'down');
      break;
    case 'extract':
    case 'finish':
      break;
    default:
      throw new Error(`Unknown action type: ${(action as AgentAction).type}`);
  }
}

export function buildMessages(
  prompt: string,
  url: string,
  observation: string,
  limits: AgentLimits,
): LlmMessage[] {
  const guard = limits.readOnly
    ? `Read-only mode: only browse and extract. Allowed domains: ${limits.allowDomains.join(', ') || '(none specified)'}.`
    : `Allowed domains: ${limits.allowDomains.join(', ') || '(any)'}.`;
  return [
    { role: 'system', content: AGENT_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Task: ${prompt}\n\nCurrent URL: ${url}\n\n${guard}\n\nDOM elements:\n${observation}\n\nRespond with the next single action as JSON.`,
    },
  ];
}

function finish(
  stopReason: AgentStopReason,
  stepsUsed: number,
  result: unknown | null,
  transcript: AgentResult['transcript'],
  err: unknown,
): AgentResult {
  const hasResult = result !== null && result !== undefined;
  const status =
    stopReason === 'finished' || (hasResult && stopReason !== 'error')
      ? 'completed'
      : 'failed';
  return {
    status,
    stopReason,
    stepsUsed,
    error: err instanceof Error ? err.message : err ? String(err) : null,
    result: hasResult ? result : null,
    transcript,
  };
}

/** Run the LLM call but abort it if the browser window closes mid-request. */
async function completeWithClose(
  llm: LlmClient,
  messages: LlmMessage[],
  page: PageActions,
): Promise<{ content: string }> {
  if (!page.isClosed) {
    return llm.complete(messages);
  }
  const controller = new AbortController();
  const poll = setInterval(() => {
    if (page.isClosed?.()) controller.abort();
  }, 500);
  try {
    return await llm.complete(messages, { signal: controller.signal });
  } finally {
    clearInterval(poll);
  }
}

export async function runAgent(
  page: PageActions,
  task: AgentTask,
  llm: LlmClient,
  limits: AgentLimits,
): Promise<AgentResult> {
  const started = Date.now();
  const transcript: AgentResult['transcript'] = [];
  let stepsUsed = 0;
  let collected: unknown = null;
  let lastActionKey: string | null = null;
  let repeatCount = 0;

  while (stepsUsed < limits.maxSteps) {
    if (page.isClosed?.()) {
      return finish('error', stepsUsed, collected, transcript, new Error('Browser window was closed'));
    }
    if (Date.now() - started > limits.timeoutMs) {
      return finish('timeout', stepsUsed, collected, transcript, null);
    }
    stepsUsed++;

    const dom = await page.readDom();
    const observation = formatDomForPrompt(dom);
    const messages = buildMessages(task.prompt, page.url(), observation, limits);

    let decision: AgentDecision;
    try {
      const { content } = await completeWithClose(llm, messages, page);
      decision = parseAgentDecision(content);
    } catch (e) {
      if (page.isClosed?.()) {
        return finish('error', stepsUsed, collected, transcript, new Error('Browser window was closed'));
      }
      return finish('error', stepsUsed, collected, transcript, e);
    }

    if (page.isClosed?.()) {
      return finish('error', stepsUsed, collected, transcript, new Error('Browser window was closed'));
    }

    const actionKey = JSON.stringify(decision.action);
    if (actionKey === lastActionKey && decision.action.type !== 'scroll') {
      repeatCount++;
    } else {
      repeatCount = 0;
    }
    lastActionKey = actionKey;
    if (repeatCount >= 2) {
      return finish(
        'error',
        stepsUsed,
        collected,
        transcript,
        new Error(
          `Agent repeated the same action 3 times without progress: ${decision.action.type}. ` +
            `The model (likely a small local model) may be stuck — try a stronger model or a clearer prompt.`,
        ),
      );
    }

    const blockReason = isBlockedAction(decision.action, limits);
    if (blockReason) {
      transcript.push({
        step: stepsUsed,
        thought: decision.thought,
        action: decision.action,
        observation: blockReason,
        blocked: true,
      });
      continue;
    }

    try {
      await executeAction(page, decision.action, limits);
      if (decision.action.type === 'extract') {
        collected = decision.action.data ?? collected;
      }
      if (decision.action.type === 'finish') {
        const result = decision.action.result ?? collected;
        return finish('finished', stepsUsed, result, transcript, null);
      }
      if (decision.done) {
        return finish('finished', stepsUsed, collected, transcript, null);
      }
    } catch (e) {
      return finish('error', stepsUsed, collected, transcript, e);
    }

    transcript.push({
      step: stepsUsed,
      thought: decision.thought,
      action: decision.action,
      observation,
    });
  }

  return finish('max-steps', stepsUsed, collected, transcript, null);
}

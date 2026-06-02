/** Strip apiKey from objects before persisting transcripts. */
export function redactSecrets<T extends Record<string, unknown>>(obj: T): T {
  const out = { ...obj };
  if ('apiKey' in out) delete out['apiKey'];
  return out;
}

export function redactTranscript(
  transcript: Array<{ step: number; thought: string; action: unknown; observation: string; blocked?: boolean }>,
) {
  return transcript.map((entry) => ({
    ...entry,
    action: typeof entry.action === 'object' && entry.action !== null ? redactSecrets(entry.action as Record<string, unknown>) : entry.action,
  }));
}

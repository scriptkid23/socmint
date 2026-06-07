export type BoardResultStatus = 'pass' | 'fail';
export type ResultKind = 'pass' | 'fail';

type ResultLike = { type: string; nodeId?: string; kind?: ResultKind };

export function resultNodeStatesFromRecords(
  records: ResultLike[],
): Record<string, ResultKind> {
  const out: Record<string, ResultKind> = {};
  for (const r of records) {
    if (r.type === 'result' && r.nodeId && r.kind) out[r.nodeId] = r.kind;
  }
  return out;
}

export function aggregateBoardResult(records: ResultLike[]): BoardResultStatus | undefined {
  let sawPass = false;
  for (const r of records) {
    if (r.type !== 'result' || !r.kind) continue;
    if (r.kind === 'fail') return 'fail';
    sawPass = true;
  }
  return sawPass ? 'pass' : undefined;
}

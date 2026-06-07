import { Handle, Position, type NodeProps } from '@xyflow/react';

type ResultNodeData = {
  kind: 'pass' | 'fail';
  runtimeKind?: 'pass' | 'fail';
  onChange?: (patch: { kind: 'pass' | 'fail' }) => void;
};

const borderAccent = (runtime?: 'pass' | 'fail') =>
  runtime === 'pass'
    ? 'border-green-600'
    : runtime === 'fail'
      ? 'border-red-600'
      : 'border-foreground';

const headerAccent = (runtime?: 'pass' | 'fail') =>
  runtime === 'pass'
    ? 'bg-green-600'
    : runtime === 'fail'
      ? 'bg-red-600'
      : 'bg-foreground';

export function ResultNode({ data }: NodeProps) {
  const d = data as ResultNodeData;
  const kind = d.kind ?? 'pass';
  return (
    <div className={`min-w-44 border-2 bg-background ${borderAccent(d.runtimeKind)}`}>
      <Handle type="target" position={Position.Left} />
      <div
        className={`border-b-2 border-foreground px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-background ${headerAccent(d.runtimeKind)}`}
      >
        Result
      </div>
      <div className="space-y-2 px-3 py-2 font-mono text-[10px]">
        <select
          className="w-full border border-foreground bg-background px-1 py-0.5 uppercase"
          value={kind}
          onChange={(e) => d.onChange?.({ kind: e.target.value as 'pass' | 'fail' })}
        >
          <option value="pass">Pass</option>
          <option value="fail">Fail</option>
        </select>
        <p className="text-muted-foreground">Marks this path as board result</p>
      </div>
    </div>
  );
}

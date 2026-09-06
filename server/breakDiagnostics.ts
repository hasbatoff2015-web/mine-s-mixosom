import { serverLog } from './log';

export interface BreakAttemptTrace {
  readonly playerId: string;
  readonly playerName: string;
  readonly gamemode: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly blockId: number;
  readonly miningTarget?: { x: number; y: number; z: number };
  readonly miningProgress: number;
  readonly miningStartCommandSeq?: number;
  readonly appliedCommandSeq?: number;
  readonly commandSeq?: number;
  readonly stage: string;
  readonly reason?: string;
  readonly eventCancelled?: boolean;
  readonly blockAfter?: number;
  readonly mutated: boolean;
  readonly claimOverlap?: number;
  readonly claimFlag?: boolean;
  readonly claimTrusted?: boolean;
}

export function formatBreakAttempt(trace: BreakAttemptTrace): string {
  const mine = trace.miningTarget
    ? `${trace.miningTarget.x},${trace.miningTarget.y},${trace.miningTarget.z}@${trace.miningProgress.toFixed(3)}`
    : '—';
  const claim = trace.claimOverlap === undefined
    ? ''
    : ` claims=${trace.claimOverlap} flag=${trace.claimFlag ?? '—'} trusted=${trace.claimTrusted ?? '—'}`;
  return [
    `break ${trace.reason ? `REJECT ${trace.reason}` : 'OK'}`,
    `${trace.playerName}/${trace.playerId.slice(0, 8)}`,
    `mode=${trace.gamemode}`,
    `at=${trace.x},${trace.y},${trace.z}`,
    `id=${trace.blockId}`,
    `after=${trace.blockAfter ?? '—'}`,
    `mutated=${trace.mutated ? 1 : 0}`,
    `stage=${trace.stage}`,
    `cancelled=${trace.eventCancelled === true ? 1 : 0}`,
    `mine=${mine}`,
    `cmd=${trace.commandSeq ?? '—'}`,
    `startCmd=${trace.miningStartCommandSeq ?? '—'}`,
    `applied=${trace.appliedCommandSeq ?? '—'}`,
  ].join(' ') + claim;
}

export function logBreakAttempt(trace: BreakAttemptTrace): void {
  const line = formatBreakAttempt(trace);
  if (trace.reason) serverLog(line, 'warn');
  else if (process.env.FC_DEBUG_BREAK === '1') serverLog(line);
}

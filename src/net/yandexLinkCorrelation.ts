/** Client wait for one LINK. `requestId` correlates the reply. It is not a credential. */
export interface YandexLinkWait {
  readonly busy: boolean;
  readonly op: number;
  readonly waitOp: number;
  readonly requestId: string;
}

/**
 * A reply finishes the wait only when it names the request this session is
 * still waiting for. A late reply from the previous request does not.
 */
export function yandexLinkResultApplies(
  wait: YandexLinkWait,
  message: { readonly requestId?: string },
): boolean {
  if (!wait.busy || wait.op !== wait.waitOp) return false;
  if (wait.requestId.length === 0) return false;
  return message.requestId === wait.requestId;
}

import { appearanceFromSkinId, type PlayerAppearance } from './PlayerAppearance';
import {
  REWARDED_SKIN_COPY,
  RewardedSkinFlow,
  type RewardedFlowSettlement,
  type RewardedVideoPort,
} from './rewardedSkinFlow';
import { skinStoreEntry } from './skinStoreCatalog';

/**
 * One screen's rewarded request.
 * The click handler only calls `request`. Grant, cancel, and error land here.
 */

export type SkinRewardPhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'pending'; readonly skinId: string; readonly detail: string }
  | { readonly kind: 'message'; readonly detail: string };

export interface SkinRewardUi {
  present(phase: SkinRewardPhase): void;
  acceptEquipped(skinId: string, detail: string): void;
}

export interface SkinRewardHost {
  beginPresentation(): void;
  endPresentation(): void;
  apply(appearance: PlayerAppearance): void;
  currentAppearance(): PlayerAppearance;
  stillOpen(): boolean;
}

export function commitRewardedSkinSwitch(
  appearance: PlayerAppearance,
  grant: { readonly skinId: string } | undefined,
): PlayerAppearance | undefined {
  if (!grant || appearance.skinId !== grant.skinId) return undefined;
  if (skinStoreEntry(grant.skinId)?.acquisition !== 'rewarded_ad') return undefined;
  return appearance;
}

export function appearanceForRewardedGrant(
  grant: { readonly skinId: string } | undefined,
  layers: PlayerAppearance['layers'],
): PlayerAppearance | undefined {
  if (!grant) return undefined;
  return commitRewardedSkinSwitch(appearanceFromSkinId(grant.skinId, layers), grant);
}

export class SkinRewardController {
  private readonly flow: RewardedSkinFlow;
  private holding = false;

  constructor(
    port: RewardedVideoPort,
    private readonly ui: SkinRewardUi,
    private readonly host: SkinRewardHost,
    flow?: RewardedSkinFlow,
  ) {
    this.flow = flow ?? new RewardedSkinFlow(port);
    this.flow.onOpened = (event) => {
      if (!this.host.stillOpen()) return;
      this.ui.present({ kind: 'pending', skinId: event.skinId, detail: REWARDED_SKIN_COPY.opened });
    };
    this.flow.onSettled = (event) => this.finish(event);
  }

  request(skinId: string): void {
    if (this.flow.isBusy) return;
    if (skinStoreEntry(skinId)?.acquisition !== 'rewarded_ad') return;
    this.host.beginPresentation();
    this.holding = true;
    const started = this.flow.start(skinId);
    if (!started.ok) {
      this.releaseHold();
      if (started.reason === 'unavailable') {
        this.ui.present({ kind: 'message', detail: REWARDED_SKIN_COPY.unavailable });
      }
      return;
    }
    if (!this.flow.isBusy) return;
    const detail = started.phase === 'ad_open' ? REWARDED_SKIN_COPY.opened : REWARDED_SKIN_COPY.loading;
    this.ui.present({ kind: 'pending', skinId, detail });
  }

  dispose(): void {
    this.flow.dispose();
    this.releaseHold();
  }

  private finish(event: RewardedFlowSettlement): void {
    this.releaseHold();
    if (!this.host.stillOpen()) return;
    if (event.outcome !== 'success') {
      const detail = event.outcome === 'cancelled' ? REWARDED_SKIN_COPY.closed : REWARDED_SKIN_COPY.unavailable;
      this.ui.present({ kind: 'message', detail });
      return;
    }
    const grant = this.flow.consume();
    if (!grant || grant.skinId !== event.skinId || grant.requestId !== event.requestId) return;
    const appearance = appearanceForRewardedGrant(grant, this.host.currentAppearance().layers);
    if (!appearance) {
      this.ui.present({ kind: 'message', detail: REWARDED_SKIN_COPY.unavailable });
      return;
    }
    this.host.apply(appearance);
    if (!this.host.stillOpen()) return;
    this.ui.acceptEquipped(appearance.skinId, REWARDED_SKIN_COPY.applied);
  }

  private releaseHold(): void {
    if (!this.holding) return;
    this.holding = false;
    this.host.endPresentation();
  }
}

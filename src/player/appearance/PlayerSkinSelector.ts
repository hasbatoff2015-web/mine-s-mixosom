import {
  appearanceFromSkinId,
  appearancesEqual,
  createPlayerAppearance,
  type PlayerAppearance,
  type PlayerModelVariant,
} from './PlayerAppearance';
import { isProductionSkinId, skinDescriptor } from './builtinSkins';
import { orderedPlayerSkins } from './skinStoreCatalog';

/** Temporary selector draft. Confirm commits; cancel restores the original appearance. */
export class PlayerSkinSelectorSession {
  private committedAppearance: PlayerAppearance;
  private previewValue: PlayerAppearance;

  constructor(committed: PlayerAppearance) {
    this.committedAppearance = createPlayerAppearance(committed);
    this.previewValue = this.committedAppearance;
  }

  get committed(): PlayerAppearance {
    return this.committedAppearance;
  }

  /**
   * The worn skin changed without leaving the selector.
   * Preview selection stays where the player left it.
   */
  adoptCommitted(appearance: PlayerAppearance): void {
    this.committedAppearance = createPlayerAppearance(appearance);
  }

  get preview(): PlayerAppearance {
    return this.previewValue;
  }

  get skins(): ReturnType<typeof orderedPlayerSkins> {
    return orderedPlayerSkins();
  }

  selectSkin(skinId: string): PlayerAppearance {
    if (!isProductionSkinId(skinId)) return this.previewValue;
    const descriptor = skinDescriptor(skinId);
    this.previewValue = appearanceFromSkinId(
      skinId,
      this.previewValue.layers,
      descriptor?.defaultModel,
    );
    return this.previewValue;
  }

  setModel(model: PlayerModelVariant): PlayerAppearance {
    this.previewValue = createPlayerAppearance({
      ...this.previewValue,
      model,
    });
    return this.previewValue;
  }

  isSelected(skinId: string): boolean {
    return this.previewValue.skinId === skinId;
  }

  get dirty(): boolean {
    return !appearancesEqual(this.committed, this.previewValue);
  }

  /**
   * Returns the preview draft. It does not decide whether the skin may be worn.
   * `commitSelectedSkinAppearance` is the gate in front of `setPlayerAppearance`.
   */
  confirm(): PlayerAppearance {
    return this.previewValue;
  }

  cancel(): PlayerAppearance {
    this.previewValue = this.committed;
    return this.committed;
  }
}

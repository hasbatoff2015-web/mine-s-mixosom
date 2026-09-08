import {
  appearanceFromSkinId,
  appearancesEqual,
  createPlayerAppearance,
  type PlayerAppearance,
  type PlayerModelVariant,
} from './PlayerAppearance';
import { PRODUCTION_PLAYER_SKINS, isProductionSkinId, skinDescriptor } from './builtinSkins';

/** Temporary selector draft. Confirm commits; cancel restores the original appearance. */
export class PlayerSkinSelectorSession {
  readonly committed: PlayerAppearance;
  private previewValue: PlayerAppearance;

  constructor(committed: PlayerAppearance) {
    this.committed = createPlayerAppearance(committed);
    this.previewValue = this.committed;
  }

  get preview(): PlayerAppearance {
    return this.previewValue;
  }

  get skins(): typeof PRODUCTION_PLAYER_SKINS {
    return PRODUCTION_PLAYER_SKINS;
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

  confirm(): PlayerAppearance {
    return this.previewValue;
  }

  cancel(): PlayerAppearance {
    this.previewValue = this.committed;
    return this.committed;
  }
}

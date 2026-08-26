import type { DamageSource } from '../survival';

export const PLAYER_CHAT_NAME = 'Player';

export function deathMessage(source: DamageSource, name = PLAYER_CHAT_NAME): string {
  switch (source) {
    case 'lava':
      return `${name} tried to swim in lava`;
    case 'fire':
      return `${name} burned to death`;
    case 'drowning':
      return `${name} drowned`;
    case 'fall':
      return `${name} fell from a high place`;
    case 'explosion':
      return `${name} was blown up by TNT`;
    case 'cactus':
      return `${name} was pricked to death`;
    case 'starvation':
      return `${name} starved to death`;
    case 'suffocation':
      return `${name} suffocated in a wall`;
    case 'void':
      return `${name} fell out of the world`;
    case 'projectile':
      return `${name} was shot`;
    case 'melee':
      return `${name} was slain`;
    default:
      return `${name} died`;
  }
}

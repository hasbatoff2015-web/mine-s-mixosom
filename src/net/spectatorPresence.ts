/** What other clients should draw for one remote player. */
export function remotePlayerPresence(input: {
  readonly invisible?: boolean;
  readonly gamemode?: string;
}): {
  readonly hideModel: boolean;
  readonly hideNameplate: boolean;
  readonly invisibilityParticles: boolean;
} {
  const spectator = input.gamemode === 'spectator';
  return {
    hideModel: spectator || input.invisible === true,
    hideNameplate: spectator || input.invisible === true,
    invisibilityParticles: input.invisible === true && !spectator,
  };
}

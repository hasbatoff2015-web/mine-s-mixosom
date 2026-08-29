/**
 * Online Anarchy: the server owns world/fluid/mob/combat ticks.
 * The client still renders and sends input; it must not run a second sim.
 */
export function shouldRunClientWorldSimulation(online: boolean): boolean {
  return !online;
}

export function shouldRunClientFluidSimulation(online: boolean): boolean {
  return shouldRunClientWorldSimulation(online);
}

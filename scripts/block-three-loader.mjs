/**
 * Node-side loader: fail if any module resolves `three`.
 * Used by scripts/sim-node-smoke.ts via --import.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'three' || specifier.startsWith('three/')) {
    throw new Error(`Forbidden Three.js import: ${specifier} (importer ${context.parentURL ?? 'unknown'})`);
  }
  return nextResolve(specifier, context);
}

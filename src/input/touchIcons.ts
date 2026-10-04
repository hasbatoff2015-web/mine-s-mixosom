/** Pixel icons for the coarse action buttons. Integer rects, no emoji. */

const svgOpen = (label: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" shape-rendering="crispEdges" aria-hidden="true" focusable="false"${label}>`;

export const JUMP_ICON = `${svgOpen('')}
  <rect x="7" y="1" width="2" height="2" fill="currentColor"/>
  <rect x="5" y="3" width="6" height="2" fill="currentColor"/>
  <rect x="3" y="5" width="10" height="2" fill="currentColor"/>
  <rect x="1" y="7" width="14" height="2" fill="currentColor"/>
  <rect x="6" y="9" width="4" height="6" fill="currentColor"/>
</svg>`;

export const CROUCH_ICON = `${svgOpen('')}
  <rect x="6" y="1" width="4" height="6" fill="currentColor"/>
  <rect x="1" y="7" width="14" height="2" fill="currentColor"/>
  <rect x="3" y="9" width="10" height="2" fill="currentColor"/>
  <rect x="5" y="11" width="6" height="2" fill="currentColor"/>
  <rect x="7" y="13" width="2" height="2" fill="currentColor"/>
</svg>`;

/** Leather backpack: handle, flap, pack. Reads as a bag at slot size. */
export const INVENTORY_ICON = `${svgOpen('')}
  <rect x="6" y="1" width="4" height="1" fill="#e6d2a8"/>
  <rect x="5" y="2" width="1" height="2" fill="#6b4423"/>
  <rect x="10" y="2" width="1" height="2" fill="#6b4423"/>
  <rect x="6" y="2" width="4" height="1" fill="#c4a06a"/>
  <rect x="3" y="4" width="10" height="3" fill="#a67c4e"/>
  <rect x="4" y="5" width="8" height="1" fill="#e6d2a8"/>
  <rect x="7" y="6" width="2" height="2" fill="#3d2a1a"/>
  <rect x="2" y="7" width="12" height="7" fill="#6e4524"/>
  <rect x="3" y="8" width="10" height="5" fill="#8d5e34"/>
  <rect x="4" y="8" width="2" height="4" fill="#c4a06a"/>
  <rect x="6" y="10" width="4" height="2" fill="#3d2a1a"/>
  <rect x="7" y="10" width="2" height="1" fill="#e6d2a8"/>
</svg>`;

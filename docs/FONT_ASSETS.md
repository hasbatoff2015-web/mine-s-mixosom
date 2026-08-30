# Font assets

Frontier Cubes self-hosts only the Cyrillic and Latin WOFF2 subsets needed by
the production UI. No font CDN is used at runtime.

| Family | Files | Source | License |
| --- | --- | --- | --- |
| Inter | `public/fonts/inter/inter-{cyrillic,latin}-400-700.woff2` | Google Fonts Inter v20 webfont output; upstream Inter project by Rasmus Andersson | SIL Open Font License 1.1; local copy: `docs/licenses/fonts/Inter-OFL-1.1.txt` |
| Press Start 2P | `public/fonts/press-start-2p/press-start-2p-{cyrillic,latin}-400.woff2` | Google Fonts Press Start 2P v16 webfont output; design by CodeMan38 | SIL Open Font License 1.1; local copy: `docs/licenses/fonts/Press-Start-2P-OFL-1.1.txt` |

The exact runtime URLs and Unicode ranges are recorded in `src/uiTokens.css`.
Inter is used for body UI and long Russian strings. Press Start 2P is limited
to brand, headings and short labels so Cyrillic remains legible at small
landscape sizes.

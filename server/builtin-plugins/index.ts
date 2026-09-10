import type { Plugin } from '../PluginManager';
import type { BuiltinPluginContext } from './context';
import { createAuctionPlugin } from './auction';
import { createAutoMinePlugin } from './autoMine';
import { createBackPlugin } from './back';
import { createClaimsPlugin } from './claims';
import { createEconomyPlugin } from './economy';
import { createHomePlugin } from './home';
import { createHologramsPlugin } from './holograms';
import { createPermissionsPlugin } from './permissions';
import { createPluginAdminPlugin } from './pluginAdmin';
import { createRtpPlugin } from './rtp';
import { createRtpPortalPlugin } from './rtpPortal';
import { createSpawnPlugin } from './spawn';
import { createTpaPlugin } from './tpa';

/** Trader is intentionally not registered. Auction House is the inventory-style market. */
export function createBuiltinPlugins(ctx: BuiltinPluginContext): Plugin[] {
  return [
    createPermissionsPlugin(ctx),
    createPluginAdminPlugin(ctx),
    createEconomyPlugin(ctx),
    createAuctionPlugin(ctx),
    createTpaPlugin(ctx),
    createSpawnPlugin(ctx),
    createHomePlugin(ctx),
    createBackPlugin(),
    createRtpPlugin(ctx),
    createRtpPortalPlugin(ctx),
    createClaimsPlugin(ctx),
    createHologramsPlugin(ctx),
    createAutoMinePlugin(ctx),
  ];
}

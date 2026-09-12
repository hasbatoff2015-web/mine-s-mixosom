import type { Plugin } from '../PluginManager';
import type { BuiltinPluginContext } from './context';
import { createAuctionPlugin } from './auction';
import { createBuyerPlugin } from './buyer';
import { createAutoMinePlugin } from './autoMine';
import { createBackPlugin } from './back';
import { createClaimsPlugin } from './claims';
import { createClanPlugin } from './clan';
import { createEconomyPlugin } from './economy';
import { createHomePlugin } from './home';
import { createHologramsPlugin } from './holograms';
import { createPermissionsPlugin } from './permissions';
import { createPluginAdminPlugin } from './pluginAdmin';
import { createRtpPlugin } from './rtp';
import { createRtpPortalPlugin } from './rtpPortal';
import { createSpawnPlugin } from './spawn';
import { createTpaPlugin } from './tpa';

/** Auction House is the player market. Buyers are static NPC vendors that buy one item each for Megacoins. */
export function createBuiltinPlugins(ctx: BuiltinPluginContext): Plugin[] {
  return [
    createPermissionsPlugin(ctx),
    createPluginAdminPlugin(ctx),
    createEconomyPlugin(ctx),
    createAuctionPlugin(ctx),
    createClanPlugin(ctx),
    createTpaPlugin(ctx),
    createSpawnPlugin(ctx),
    createHomePlugin(ctx),
    createBackPlugin(),
    createRtpPlugin(ctx),
    createRtpPortalPlugin(ctx),
    createClaimsPlugin(ctx),
    createHologramsPlugin(ctx),
    createBuyerPlugin(ctx),
    createAutoMinePlugin(ctx),
  ];
}

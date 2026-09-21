import type { Plugin } from '../PluginManager';
import type { BuiltinPluginContext } from './context';
import { createAuctionPlugin } from './auction';
import { createBuyerPlugin } from './buyer';
import { createAutoMinePlugin } from './autoMine';
import { createWandPlugin } from './wand';
import { createWorldEventsPlugin } from './worldEvents';
import { createBackPlugin } from './back';
import { createClaimsPlugin } from './claims';
import { createClanPlugin } from './clan';
import { createEconomyPlugin } from './economy';
import { createHomePlugin } from './home';
import { createHologramsPlugin } from './holograms';
import { createMenuPlugin } from './menu';
import { createPermissionsPlugin } from './permissions';
import { createPluginAdminPlugin } from './pluginAdmin';
import { createRtpPlugin } from './rtp';
import { createRtpPortalPlugin } from './rtpPortal';
import { createSpawnPlugin } from './spawn';
import { createTpaPlugin } from './tpa';
import { createFriendsPlugin } from './friends';
import { createTradePlugin } from './trade';

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
    createFriendsPlugin(ctx),
    createTradePlugin(ctx),
    createMenuPlugin(ctx),
    createBackPlugin(),
    createRtpPlugin(ctx),
    createRtpPortalPlugin(ctx),
    createClaimsPlugin(ctx),
    createHologramsPlugin(ctx),
    createBuyerPlugin(ctx),
    createWandPlugin(ctx),
    createWorldEventsPlugin(ctx),
    createAutoMinePlugin(ctx),
  ];
}

import type { Plugin } from '../PluginManager';
import type { BuiltinPluginContext } from './context';
import { createBackPlugin } from './back';
import { createClaimsPlugin } from './claims';
import { createHomePlugin } from './home';
import { createHologramsPlugin } from './holograms';
import { createPermissionsPlugin } from './permissions';
import { createPluginAdminPlugin } from './pluginAdmin';
import { createRtpPlugin } from './rtp';
import { createRtpPortalPlugin } from './rtpPortal';
import { createSpawnPlugin } from './spawn';
import { createTpaPlugin } from './tpa';

/** Auction House is intentionally not registered. Needs an inventory/GUI market later. */
export function createBuiltinPlugins(ctx: BuiltinPluginContext): Plugin[] {
  return [
    createPermissionsPlugin(ctx),
    createPluginAdminPlugin(ctx),
    createTpaPlugin(ctx),
    createSpawnPlugin(ctx),
    createHomePlugin(ctx),
    createBackPlugin(),
    createRtpPlugin(ctx),
    createRtpPortalPlugin(ctx),
    createClaimsPlugin(ctx),
    createHologramsPlugin(ctx),
  ];
}

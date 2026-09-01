import type { Plugin } from '../../../server/PluginManager';

export const plugin: Plugin = {
  name: 'broken-enable',
  apiVersion: 1,
  onEnable() {
    throw new Error('broken-enable boom');
  },
};

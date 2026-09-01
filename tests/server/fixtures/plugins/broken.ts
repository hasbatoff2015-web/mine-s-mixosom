export const plugin = {
  name: 'broken-enable',
  apiVersion: 1,
  onEnable() {
    throw new Error('broken-enable boom');
  },
};

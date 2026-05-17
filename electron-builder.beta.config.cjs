const { createConfig } = require('./electron-builder.common.cjs');

module.exports = createConfig({
  appId: 'com.yusufaltunbicak.whiteboardtodos.beta',
  productName: 'Whiteboard Todos Beta',
  artifactPrefix: 'Whiteboard-Todos-Beta',
  channel: 'beta',
  prerelease: true,
  version: process.env.BETA_VERSION || '1.0.0-beta.1',
});

const { createConfig } = require('./electron-builder.common.cjs');

module.exports = createConfig({
  appId: 'com.yusufaltunbicak.whiteboardtodos',
  productName: 'Whiteboard Todos',
  artifactPrefix: 'Whiteboard-Todos',
  channel: 'latest',
});

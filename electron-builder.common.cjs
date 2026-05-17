const path = require('node:path');

const teamId = 'V8NZP84A55';
const signingIdentity = `EYUP YUSUF ALTUNBICAK (${teamId})`;

function createConfig({
  appId,
  productName,
  artifactPrefix,
  channel,
  prerelease = false,
  version,
}) {
  return {
    appId,
    productName,
    copyright: 'Copyright © 2026 Yusuf Altunbıçak',
    asar: true,
    compression: 'normal',
    generateUpdatesFilesForAllChannels: true,
    artifactName: `${artifactPrefix}-\${version}-\${arch}.\${ext}`,
    directories: {
      buildResources: 'build',
      output: prerelease ? 'release/beta' : 'release/stable',
    },
    files: [
      'dist/**/*',
      'electron/**/*',
      'package.json',
    ],
    extraMetadata: {
      name: prerelease ? 'whiteboard-mac-app-beta' : 'whiteboard-mac-app',
      productName,
      ...(version ? { version } : {}),
    },
    mac: {
      category: 'public.app-category.productivity',
      type: 'distribution',
      icon: 'build/icon.icns',
      hardenedRuntime: true,
      gatekeeperAssess: false,
      entitlements: 'build/entitlements.mac.plist',
      entitlementsInherit: 'build/entitlements.mac.inherit.plist',
      identity: signingIdentity,
      target: [
        { target: 'dmg', arch: ['arm64'] },
        { target: 'zip', arch: ['arm64'] },
      ],
      extendInfo: {
        NSHumanReadableCopyright: 'Copyright © 2026 Yusuf Altunbıçak',
        NSMicrophoneUsageDescription: 'Whiteboard Todos uses the microphone when you turn on the voice assistant to manage your board by speech.',
      },
    },
    dmg: {
      title: '${productName} ${version}',
      iconSize: 128,
      window: {
        x: 100,
        y: 100,
        width: 540,
        height: 380,
      },
      contents: [
        { x: 145, y: 205 },
        { x: 395, y: 205, type: 'link', path: '/Applications' },
      ],
    },
    publish: {
      provider: 'github',
      owner: 'yusufaltunbicak',
      repo: 'whiteboard-mac-app',
      private: false,
      releaseType: prerelease ? 'prerelease' : 'release',
      channel,
      tagNamePrefix: 'v',
    },
    afterSign: path.join(__dirname, 'scripts', 'notarize.cjs'),
  };
}

module.exports = { createConfig };

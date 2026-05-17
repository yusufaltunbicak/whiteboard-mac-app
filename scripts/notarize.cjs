const path = require('node:path');
const { notarize } = require('@electron/notarize');

const defaultTeamId = 'V8NZP84A55';

function buildAuthorizationOptions() {
  if (process.env.APPLE_KEYCHAIN_PROFILE) {
    return {
      keychainProfile: process.env.APPLE_KEYCHAIN_PROFILE,
    };
  }

  if (process.env.APPLE_API_KEY && process.env.APPLE_API_ISSUER) {
    const inferredKeyId = path.basename(process.env.APPLE_API_KEY).match(/^AuthKey_(.+)\.p8$/)?.[1];
    return {
      appleApiKey: process.env.APPLE_API_KEY,
      appleApiIssuer: process.env.APPLE_API_ISSUER,
      appleApiKeyId: process.env.APPLE_API_KEY_ID || inferredKeyId,
    };
  }

  if (process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD) {
    return {
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID || defaultTeamId,
    };
  }

  throw new Error(
    'NOTARIZE=true requires APPLE_KEYCHAIN_PROFILE, APPLE_API_KEY/APPLE_API_ISSUER, or APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD.',
  );
}

module.exports = async function notarizeMac(context) {
  if (process.platform !== 'darwin' || process.env.NOTARIZE !== 'true') return;

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);

  await notarize({
    appBundleId: context.packager.appInfo.id,
    appPath,
    teamId: process.env.APPLE_TEAM_ID || defaultTeamId,
    ...buildAuthorizationOptions(),
  });
};

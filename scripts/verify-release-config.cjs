const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.BETA_VERSION ||= '1.0.0-beta.999';

const stable = require('../electron-builder.config.cjs');
const beta = require('../electron-builder.beta.config.cjs');

assert.equal(stable.appId, 'com.yusufaltunbicak.whiteboardtodos');
assert.equal(stable.productName, 'Whiteboard Todos');
assert.equal(stable.publish.channel, 'latest');
assert.equal(stable.publish.releaseType, 'release');
assert.equal(stable.directories.output, 'release/stable');
assert.equal(stable.extraMetadata.name, 'whiteboard-mac-app');
assert.ok(stable.files.includes('src/boardActions.js'));

assert.equal(beta.appId, 'com.yusufaltunbicak.whiteboardtodos.beta');
assert.equal(beta.productName, 'Whiteboard Todos Beta');
assert.equal(beta.publish.channel, 'beta');
assert.equal(beta.publish.releaseType, 'prerelease');
assert.equal(beta.directories.output, 'release/beta');
assert.equal(beta.extraMetadata.name, 'whiteboard-mac-app-beta');
assert.match(beta.extraMetadata.version, /^\d+\.\d+\.\d+-beta\.\d+$/);
assert.ok(beta.files.includes('src/boardActions.js'));

assert.notEqual(stable.appId, beta.appId);
assert.notEqual(stable.productName, beta.productName);
assert.notEqual(stable.publish.channel, beta.publish.channel);
assert.notEqual(stable.directories.output, beta.directories.output);

const mainProcess = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf-8');
assert.match(mainProcess, /Whiteboard Todos Beta/);
assert.match(mainProcess, /whiteboard-todos-beta\.md/);
assert.match(mainProcess, /autoUpdater\.channel = getReleaseChannel\(\)/);
assert.match(mainProcess, /autoUpdater\.allowPrerelease = isBetaApp\(\)/);

console.log('Release config isolation verified.');

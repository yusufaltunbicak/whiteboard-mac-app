const fs = require('node:fs');
const path = require('node:path');

const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
const baseVersion = process.env.BETA_BASE_VERSION || packageJson.version;
const runNumber = process.env.GITHUB_RUN_NUMBER || process.env.BETA_BUILD_NUMBER;

if (!/^\d+\.\d+\.\d+$/.test(baseVersion)) {
  throw new Error(`BETA_BASE_VERSION must be a stable semver like 1.1.0. Received: ${baseVersion}`);
}

if (!runNumber || !/^[1-9]\d*$/.test(runNumber)) {
  throw new Error('GITHUB_RUN_NUMBER or BETA_BUILD_NUMBER must be a positive integer.');
}

const betaVersion = `${baseVersion}-beta.${runNumber}`;
fs.appendFileSync(process.env.GITHUB_ENV || '/dev/stdout', `BETA_VERSION=${betaVersion}\n`);
console.log(betaVersion);

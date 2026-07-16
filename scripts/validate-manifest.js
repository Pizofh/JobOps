const fs = require('node:fs');
const path = require('node:path');

const manifestPath = path.join(__dirname, '..', 'appsscript.json');
const allowedKeys = new Set(['dependencies', 'exceptionLogging', 'runtimeVersion', 'timeZone']);
const forbiddenKeys = ['addOns', 'executionApi', 'oauthScopes', 'urlFetchWhitelist', 'webapp'];

function assertManifest(condition, message) {
  if (!condition) {
    throw new Error(`Invalid Apps Script manifest: ${message}`);
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const rawManifest = fs.readFileSync(manifestPath, 'utf8');
const manifest = JSON.parse(rawManifest);

assertManifest(isPlainObject(manifest), 'the root value must be an object');
assertManifest(manifest.timeZone === 'America/Bogota', 'timeZone must be America/Bogota');
assertManifest(manifest.runtimeVersion === 'V8', 'runtimeVersion must be V8');
assertManifest(manifest.exceptionLogging === 'STACKDRIVER', 'exceptionLogging must be STACKDRIVER');
assertManifest(isPlainObject(manifest.dependencies), 'dependencies must be an object');
assertManifest(
  Object.keys(manifest.dependencies).length === 0,
  'Phase 0 must not enable advanced services or libraries',
);

const unexpectedKeys = Object.keys(manifest).filter((key) => !allowedKeys.has(key));
assertManifest(unexpectedKeys.length === 0, `unexpected keys: ${unexpectedKeys.join(', ')}`);

for (const key of forbiddenKeys) {
  assertManifest(!(key in manifest), `Phase 0 must not declare ${key}`);
}

console.log('Manifest validation passed: appsscript.json');

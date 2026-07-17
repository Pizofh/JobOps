const fs = require('node:fs');
const path = require('node:path');

const manifestPath = path.join(__dirname, '..', 'appsscript.json');
const allowedKeys = new Set([
  'dependencies',
  'exceptionLogging',
  'oauthScopes',
  'runtimeVersion',
  'timeZone',
]);
const allowedScopes = new Set([
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/script.scriptapp',
  'https://www.googleapis.com/auth/script.send_mail',
  'https://www.googleapis.com/auth/spreadsheets',
]);
const forbiddenKeys = ['addOns', 'executionApi', 'urlFetchWhitelist', 'webapp'];

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
  'JobOps must not enable advanced services or libraries',
);
assertManifest(Array.isArray(manifest.oauthScopes), 'oauthScopes must be an array');
assertManifest(
  manifest.oauthScopes.length === allowedScopes.size &&
    new Set(manifest.oauthScopes).size === allowedScopes.size &&
    manifest.oauthScopes.every((scope) => allowedScopes.has(scope)),
  'oauthScopes must contain only the JobOps Gmail, Sheets, trigger and mail scopes',
);

const unexpectedKeys = Object.keys(manifest).filter((key) => !allowedKeys.has(key));
assertManifest(unexpectedKeys.length === 0, `unexpected keys: ${unexpectedKeys.join(', ')}`);

for (const key of forbiddenKeys) {
  assertManifest(!(key in manifest), `JobOps must not declare ${key}`);
}

console.log('Manifest validation passed: appsscript.json');

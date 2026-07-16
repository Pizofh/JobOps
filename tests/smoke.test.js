const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const sourceDirectory = path.join(__dirname, '..', 'src');
const sourceFiles = fs
  .readdirSync(sourceDirectory)
  .filter((fileName) => fileName.endsWith('.js'))
  .sort();
const sourceEntries = sourceFiles.map((fileName) => ({
  filePath: path.join(sourceDirectory, fileName),
  source: fs.readFileSync(path.join(sourceDirectory, fileName), 'utf8'),
}));
const entrypointNames = [
  'setupJobOps',
  'installJobOpsTriggers',
  'ingestJobs',
  'sendDailyDigest',
  'handleStatusEdit',
  'rescoreJobs',
  'dryRunIngestion',
  'validateJobOpsConfiguration',
];

test('Phase 0 exposes eight safe Apps Script entrypoints', () => {
  const context = vm.createContext({});

  for (const entry of sourceEntries) {
    vm.runInContext(entry.source, context, { filename: entry.filePath });
  }

  assert.deepEqual(Object.keys(context).sort(), [...entrypointNames].sort());

  for (const name of entrypointNames) {
    assert.equal(typeof context[name], 'function', `${name} must be globally accessible`);
    assert.equal(context[name]({}), undefined, `${name} must remain inert in Phase 0`);
  }
});

test('Phase 0 entrypoints do not reference Google services', () => {
  const forbiddenServices = ['GmailApp', 'MailApp', 'PropertiesService', 'SpreadsheetApp'];
  const deployedSource = sourceEntries.map((entry) => entry.source).join('\n');

  for (const service of forbiddenServices) {
    assert.doesNotMatch(deployedSource, new RegExp(`\\b${service}\\b`, 'u'));
  }
});

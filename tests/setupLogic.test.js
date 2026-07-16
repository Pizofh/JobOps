const assert = require('node:assert/strict');
const test = require('node:test');

const { loadJobOpsContext } = require('./helpers/load-jobops');

test('static sheet definitions have unique keys and correct row widths', () => {
  const context = loadJobOpsContext();
  assert.doesNotThrow(() => context.assertValidJobOpsDefinitions_());
});

test('header planning initializes empty sheets and extends only compatible prefixes', () => {
  const context = loadJobOpsContext();
  const expected = ['A', 'B', 'C'];

  assert.deepEqual(JSON.parse(JSON.stringify(context.getJobOpsHeaderWritePlan_([], expected))), {
    startColumn: 1,
    missingHeaders: expected,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(context.getJobOpsHeaderWritePlan_(['A'], expected))), {
    startColumn: 2,
    missingHeaders: ['B', 'C'],
  });
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(context.getJobOpsHeaderWritePlan_(['A', 'B', 'C', 'CUSTOM'], expected)),
    ),
    { startColumn: 4, missingHeaders: [] },
  );
  assert.throws(
    () => context.getJobOpsHeaderWritePlan_(['USER_DATA'], expected),
    (error) => error.code === 'CONFIGURATION_ERROR' && error.message.includes('Incompatible'),
  );
});

test('seed selection appends only missing keys without mutating seed rows', () => {
  const context = loadJobOpsContext();
  const seeds = [
    ['A', 1],
    ['B', 2],
  ];
  const missing = context.getMissingJobOpsSeedRows_(['a'], seeds);

  assert.deepEqual(JSON.parse(JSON.stringify(missing)), [['B', 2]]);
  missing[0][1] = 99;
  assert.equal(seeds[1][1], 2);
});

test('Gmail label setup is idempotent', () => {
  const labels = new Map([['Jobs/Processed', { name: 'Jobs/Processed' }]]);
  const GmailApp = {
    getUserLabelByName(name) {
      return labels.get(name) || null;
    },
    createLabel(name) {
      const label = { name };
      labels.set(name, label);
      return label;
    },
  };
  const context = loadJobOpsContext({ GmailApp });

  const first = context.ensureJobOpsGmailLabels_();
  const second = context.ensureJobOpsGmailLabels_();

  assert.deepEqual(Array.from(first.created), [
    'Jobs/Failed',
    'Jobs/Recruiters',
    'Jobs/Processing',
  ]);
  assert.deepEqual(Array.from(first.existing), ['Jobs/Processed']);
  assert.deepEqual(Array.from(second.created), []);
  assert.equal(second.existing.length, 4);
  assert.equal(labels.size, 4);
});

test('setup rejects missing private properties before opening Google services', () => {
  let spreadsheetOpened = false;
  let gmailAccessed = false;
  const context = loadJobOpsContext({
    PropertiesService: {
      getScriptProperties() {
        return { getProperties: () => ({}) };
      },
    },
    SpreadsheetApp: {
      openById() {
        spreadsheetOpened = true;
      },
    },
    GmailApp: {
      getUserLabelByName() {
        gmailAccessed = true;
      },
    },
  });

  assert.throws(
    () => context.setupJobOps(),
    (error) => error.code === 'CONFIGURATION_ERROR',
  );
  assert.equal(spreadsheetOpened, false);
  assert.equal(gmailAccessed, false);
});

test('spreadsheet access failures do not expose the private ID', () => {
  const privateId = 'privateSpreadsheetId123456789';
  const context = loadJobOpsContext({
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperties: () => ({
            SPREADSHEET_ID: privateId,
            USER_EMAIL: 'user@example.test',
          }),
        };
      },
    },
    SpreadsheetApp: {
      openById() {
        throw new Error(`No access to ${privateId}`);
      },
    },
  });

  assert.throws(
    () => context.setupJobOps(),
    (error) =>
      error.code === 'CONFIGURATION_ERROR' &&
      error.message.includes('Unable to open SPREADSHEET_ID') &&
      !error.message.includes(privateId),
  );
});

const assert = require('node:assert/strict');
const test = require('node:test');

const { createFakeGoogleServices } = require('./helpers/fake-google');
const { loadJobOpsContext } = require('./helpers/load-jobops');

test('setup migrates the untouched entry-level rule to include internships and trainees', () => {
  const services = createFakeGoogleServices();
  const context = loadJobOpsContext(services.globals);
  const result = context.setupJobOps();
  const sheet = services.spreadsheet.getSheetByName('ScoringRules');
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const row = values.find((candidate) => candidate[0] === 'BONUS_JUNIOR');
  const pattern = row[headers.indexOf('PATTERN')];

  assert.equal(result.spreadsheet.migratedEntryLevelRule, true);
  assert.match(pattern, /intern/);
  assert.match(pattern, /trainee/);
  assert.match(pattern, /practicante/);

  const rules = context.readJobOpsScoringRules_(services.spreadsheet);
  const score = context.calculateJobOpsScore_(
    {
      position: 'SRE / Platform Infrastructure Engineer Intern',
      descriptionText: '',
      requiredTechnologies: [],
      isRecruiter: false,
    },
    rules,
    {
      HIGH_PRIORITY_THRESHOLD: 15,
      REVIEW_THRESHOLD: 10,
      OPTIONAL_THRESHOLD: 6,
      RECRUITER_SCORE_BONUS: 5,
    },
  );
  assert.match(score.strongMatches.join('\n'), /\+4/);
});

test('entry-level migration preserves a user-customized BONUS_JUNIOR rule', () => {
  const services = createFakeGoogleServices();
  const context = loadJobOpsContext(services.globals);
  context.setupJobOps();
  const sheet = services.spreadsheet.getSheetByName('ScoringRules');
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const rowNumber = values.findIndex((candidate) => candidate[0] === 'BONUS_JUNIOR') + 1;
  const patternColumn = headers.indexOf('PATTERN') + 1;
  sheet.getRange(rowNumber, patternColumn).setValue('custom junior signal');

  const second = context.setupJobOps();
  assert.equal(second.spreadsheet.migratedEntryLevelRule, false);
  assert.equal(sheet.getRange(rowNumber, patternColumn).getValue(), 'custom junior signal');
});

const assert = require('node:assert/strict');
const test = require('node:test');

const { createFakeGoogleServices } = require('./helpers/fake-google');
const { loadJobOpsContext } = require('./helpers/load-jobops');

test('default entry-level rule includes internships but does not treat analyst as junior', () => {
  const services = createFakeGoogleServices();
  const context = loadJobOpsContext(services.globals);
  const result = context.setupJobOps();
  const sheet = services.spreadsheet.getSheetByName('ScoringRules');
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const row = values.find((candidate) => candidate[0] === 'BONUS_JUNIOR');
  const pattern = row[headers.indexOf('PATTERN')];

  assert.equal(result.spreadsheet.migratedEntryLevelRule, false);
  assert.match(pattern, /intern/);
  assert.match(pattern, /trainee/);
  assert.match(pattern, /practicante/);
  assert.doesNotMatch(pattern, /analyst/);

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
  sheet.getRange(rowNumber, patternColumn).setValues([['custom junior signal']]);

  const second = context.setupJobOps();
  const updatedValues = sheet.getDataRange().getValues();
  assert.equal(second.spreadsheet.migratedEntryLevelRule, false);
  assert.equal(updatedValues[rowNumber - 1][patternColumn - 1], 'custom junior signal');
});


test('entry-level migration upgrades the previous analyst-inclusive standard rule', () => {
  const services = createFakeGoogleServices();
  const context = loadJobOpsContext(services.globals);
  context.setupJobOps();
  const sheet = services.spreadsheet.getSheetByName('ScoringRules');
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const rowNumber = values.findIndex((candidate) => candidate[0] === 'BONUS_JUNIOR') + 1;
  const patternColumn = headers.indexOf('PATTERN') + 1;

  sheet
    .getRange(rowNumber, patternColumn)
    .setValues([
      ['\\b(?:junior|jr\\.?|associate|analyst|engineer i|level 1|entry level|intern(?:ship)?|trainee|practicante)\\b'],
    ]);

  const result = context.setupJobOps();
  const updated = sheet.getDataRange().getValues()[rowNumber - 1][patternColumn - 1];

  assert.equal(result.spreadsheet.migratedEntryLevelRule, true);
  assert.doesNotMatch(updated, /analyst/);
  assert.match(updated, /intern/);
});

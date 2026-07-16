const assert = require('node:assert/strict');

class FakeRange {
  constructor(sheet, row, column, rowCount, columnCount) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
    this.rowCount = rowCount;
    this.columnCount = columnCount;
  }

  getValues() {
    return Array.from({ length: this.rowCount }, (_, rowOffset) =>
      Array.from({ length: this.columnCount }, (_, columnOffset) =>
        this.sheet.getCell(this.row + rowOffset, this.column + columnOffset),
      ),
    );
  }

  setValues(values) {
    assert.equal(values.length, this.rowCount);
    for (let rowOffset = 0; rowOffset < this.rowCount; rowOffset += 1) {
      assert.equal(values[rowOffset].length, this.columnCount);
      for (let columnOffset = 0; columnOffset < this.columnCount; columnOffset += 1) {
        this.sheet.setCell(
          this.row + rowOffset,
          this.column + columnOffset,
          values[rowOffset][columnOffset],
        );
      }
    }
    return this;
  }

  getDataValidations() {
    return Array.from({ length: this.rowCount }, (_, rowOffset) =>
      Array.from(
        { length: this.columnCount },
        (_, columnOffset) =>
          this.sheet.validations.get(`${this.row + rowOffset}:${this.column + columnOffset}`) ||
          null,
      ),
    );
  }

  setDataValidations(validations) {
    assert.equal(validations.length, this.rowCount);
    for (let rowOffset = 0; rowOffset < this.rowCount; rowOffset += 1) {
      for (let columnOffset = 0; columnOffset < this.columnCount; columnOffset += 1) {
        this.sheet.validations.set(
          `${this.row + rowOffset}:${this.column + columnOffset}`,
          validations[rowOffset][columnOffset],
        );
      }
    }
    return this;
  }

  createFilter() {
    this.sheet.filter = { range: this };
    return this.sheet.filter;
  }

  setBackground() {
    return this;
  }

  setFontColor() {
    return this;
  }

  setFontWeight() {
    return this;
  }

  setVerticalAlignment() {
    return this;
  }

  setNumberFormat() {
    return this;
  }
}

class FakeSheet {
  constructor(name) {
    this.name = name;
    this.maxRows = 100;
    this.maxColumns = 26;
    this.cells = new Map();
    this.validations = new Map();
    this.conditionalRules = [];
    this.filter = null;
    this.frozenRows = 0;
  }

  getCell(row, column) {
    return this.cells.has(`${row}:${column}`) ? this.cells.get(`${row}:${column}`) : '';
  }

  setCell(row, column, value) {
    this.cells.set(`${row}:${column}`, value);
  }

  getLastRow() {
    let maximum = 0;
    for (const [position, value] of this.cells.entries()) {
      if (value !== '' && value !== null && value !== undefined) {
        maximum = Math.max(maximum, Number(position.split(':')[0]));
      }
    }
    return maximum;
  }

  getLastColumn() {
    let maximum = 0;
    for (const [position, value] of this.cells.entries()) {
      if (value !== '' && value !== null && value !== undefined) {
        maximum = Math.max(maximum, Number(position.split(':')[1]));
      }
    }
    return maximum;
  }

  getDataRange() {
    return this.getRange(1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1));
  }

  getRange(row, column, rowCount = 1, columnCount = 1) {
    assert.ok(row >= 1 && column >= 1 && rowCount >= 1 && columnCount >= 1);
    assert.ok(row + rowCount - 1 <= this.maxRows, 'Range exceeds fake sheet rows');
    assert.ok(column + columnCount - 1 <= this.maxColumns, 'Range exceeds fake sheet columns');
    return new FakeRange(this, row, column, rowCount, columnCount);
  }

  getMaxRows() {
    return this.maxRows;
  }

  getMaxColumns() {
    return this.maxColumns;
  }

  insertRowsAfter(_position, count) {
    this.maxRows += count;
    return this;
  }

  insertColumnsAfter(_position, count) {
    this.maxColumns += count;
    return this;
  }

  setFrozenRows(count) {
    this.frozenRows = count;
    return this;
  }

  autoResizeColumns() {
    return this;
  }

  setColumnWidth() {
    return this;
  }

  getFilter() {
    return this.filter;
  }

  getConditionalFormatRules() {
    return this.conditionalRules.slice();
  }

  setConditionalFormatRules(rules) {
    this.conditionalRules = rules.slice();
    return this;
  }
}

class FakeSpreadsheet {
  constructor() {
    this.sheets = new Map();
  }

  getSheetByName(name) {
    return this.sheets.get(name) || null;
  }

  insertSheet(name) {
    assert.equal(this.sheets.has(name), false);
    const sheet = new FakeSheet(name);
    this.sheets.set(name, sheet);
    return sheet;
  }
}

class FakeBuilder {
  constructor(type) {
    this.rule = { type };
  }

  requireValueInList(values, showDropdown) {
    this.rule.criteria = 'VALUE_IN_LIST';
    this.rule.values = values.slice();
    this.rule.showDropdown = showDropdown;
    return this;
  }

  requireCheckbox() {
    this.rule.criteria = 'CHECKBOX';
    return this;
  }

  setAllowInvalid(value) {
    this.rule.allowInvalid = value;
    return this;
  }

  setHelpText(value) {
    this.rule.helpText = value;
    return this;
  }

  whenTextEqualTo(value) {
    this.rule.criteria = 'TEXT_EQUAL_TO';
    this.rule.value = value;
    return this;
  }

  setBackground(value) {
    this.rule.background = value;
    return this;
  }

  setRanges(value) {
    this.rule.ranges = value.slice();
    return this;
  }

  build() {
    return { ...this.rule };
  }
}

class FakeGmailMessage {
  constructor(data) {
    this.data = { ...data, date: new Date(data.date) };
  }

  getSubject() {
    return this.data.subject;
  }

  getFrom() {
    return this.data.from;
  }

  getDate() {
    return this.data.date;
  }

  getPlainBody() {
    return this.data.plainBody || '';
  }

  getBody() {
    return this.data.htmlBody || '';
  }

  getId() {
    return this.data.messageId;
  }
}

class FakeGmailThread {
  constructor(data) {
    this.id = data.threadId;
    this.messages = data.messages.map((message) => new FakeGmailMessage(message));
    this.labelNames = new Set();
  }

  getId() {
    return this.id;
  }
}

class FakeGmailLabel {
  constructor(name) {
    this.name = name;
  }

  addToThreads(threads) {
    for (const thread of threads) {
      thread.labelNames.add(this.name);
    }
    return this;
  }

  removeFromThreads(threads) {
    for (const thread of threads) {
      thread.labelNames.delete(this.name);
    }
    return this;
  }
}

function createFakeGoogleServices(options = {}) {
  const spreadsheetId = 'fakeSpreadsheetId1234567890';
  const userEmail = 'user@example.test';
  const spreadsheet = new FakeSpreadsheet();
  const labels = new Map();
  const threads = (options.gmailThreads || []).map((thread) => new FakeGmailThread(thread));
  const logs = [];
  let lockHeld = false;

  return {
    spreadsheet,
    labels,
    threads,
    logs,
    globals: {
      PropertiesService: {
        getScriptProperties() {
          return {
            getProperties() {
              return { SPREADSHEET_ID: spreadsheetId, USER_EMAIL: userEmail };
            },
          };
        },
      },
      SpreadsheetApp: {
        openById(requestedId) {
          assert.equal(requestedId, spreadsheetId);
          return spreadsheet;
        },
        newDataValidation() {
          return new FakeBuilder('DATA_VALIDATION');
        },
        newConditionalFormatRule() {
          return new FakeBuilder('CONDITIONAL_FORMAT');
        },
      },
      GmailApp: {
        search(_query, start, maximum) {
          return threads
            .filter(
              (thread) =>
                !['Jobs/Processed', 'Jobs/Failed', 'Jobs/Processing'].some((name) =>
                  thread.labelNames.has(name),
                ),
            )
            .slice(start, start + maximum);
        },
        getMessagesForThreads(requestedThreads) {
          return requestedThreads.map((thread) => thread.messages.slice());
        },
        getUserLabelByName(name) {
          return labels.get(name) || null;
        },
        createLabel(name) {
          const label = new FakeGmailLabel(name);
          labels.set(name, label);
          return label;
        },
      },
      LockService: {
        getScriptLock() {
          return {
            tryLock() {
              if (lockHeld) {
                return false;
              }
              lockHeld = true;
              return true;
            },
            releaseLock() {
              lockHeld = false;
            },
          };
        },
      },
      Logger: {
        log(message) {
          logs.push(message);
        },
      },
    },
  };
}

module.exports = { createFakeGoogleServices };

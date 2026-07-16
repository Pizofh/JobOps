const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourceDirectory = path.join(__dirname, '..', '..', 'src');
const sourceFiles = fs
  .readdirSync(sourceDirectory)
  .filter((fileName) => fileName.endsWith('.js'))
  .sort();

/**
 * Loads Apps Script files as classic scripts in their shared global context.
 *
 * @param {Object=} globals
 * @returns {vm.Context}
 */
function loadJobOpsContext(globals = {}) {
  const context = vm.createContext({ ...globals });

  for (const fileName of sourceFiles) {
    const filePath = path.join(sourceDirectory, fileName);
    const source = fs.readFileSync(filePath, 'utf8');
    vm.runInContext(source, context, { filename: filePath });
  }

  return context;
}

module.exports = { loadJobOpsContext };

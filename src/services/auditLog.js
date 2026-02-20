const sheets = require('./googleSheets');
const config = require('../config');
const { nowISO } = require('../utils/dateUtils');

async function log(action, entity, entityId, changes, user = 'system') {
  try {
    await sheets.appendRow(config.sheets.auditLog, [
      nowISO(),
      action,
      entity,
      entityId,
      typeof changes === 'string' ? changes : JSON.stringify(changes),
      user,
    ]);
  } catch (err) {
    console.error('Audit log error:', err.message);
  }
}

module.exports = { log };

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  dbPath: path.resolve(process.cwd(), process.env.DB_PATH || 'src/data/db.json'),
  // Accept the earlier MONGODB_URL spelling too, so existing local .env files
  // keep working while MONGODB_URI remains the documented variable.
  mongoUri: (process.env.MONGODB_URI || process.env.MONGODB_URL || '').trim(),
  mongoDbName: process.env.MONGODB_DB_NAME,
  persist: process.env.PERSIST_DB !== 'false',
  seedStartDate: process.env.SEED_START_DATE || '2026-10-07',
  seedDays: parseInt(process.env.SEED_DAYS || '14', 10),
  enableAdminReset: process.env.ENABLE_ADMIN_RESET !== 'false',
};

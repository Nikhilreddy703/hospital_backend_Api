const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000,http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  // Accept the earlier MONGODB_URL spelling too, so existing local .env files
  // keep working while MONGODB_URI remains the documented variable.
  mongoUri: (process.env.MONGODB_URI || process.env.MONGODB_URL || '').trim(),
  mongoDbName: process.env.MONGODB_DB_NAME,
  persist: process.env.PERSIST_DB !== 'false',
  jwtSecret: process.env.JWT_SECRET || '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  hospitalTimezone: process.env.HOSPITAL_TIMEZONE || 'Asia/Kolkata',
  staffProvisioningKey: process.env.STAFF_PROVISIONING_KEY || '',
  doctorRegistrationKey: process.env.DOCTOR_REGISTRATION_KEY || '',
  corsOrigins,
  seedStartDate: process.env.SEED_START_DATE || '2026-10-07',
  seedDays: parseInt(process.env.SEED_DAYS || '14', 10),
  enableAdminReset: process.env.ENABLE_ADMIN_RESET === 'true',
  adminResetToken: process.env.ADMIN_RESET_TOKEN || '',
};

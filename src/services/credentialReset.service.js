const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../data/db');
const { nowIso } = require('../utils/helpers');
const { errors } = require('../utils/errors');

const CONFIRMATION = 'RESET_ALL_STAFF_AND_DOCTORS';
const temporaryPassword = () => crypto.randomBytes(18).toString('base64url');

async function resetAll(confirmation) {
  if (confirmation !== CONFIRMATION) throw errors.validation([{ field: 'confirmation', message: `Set confirmation to ${CONFIRMATION} to proceed.` }]);
  const credentials = [];
  const failures = [];
  const now = nowIso();
  const staffCollection = db.getCollection('staff');
  const staffAccounts = await staffCollection.find({}).toArray();

  for (const account of staffAccounts) {
    const password = temporaryPassword();
    const authVersion = (account.authVersion || 0) + 1;
    try {
      const result = await staffCollection.updateOne({ staffId: account.staffId }, { $set: { passwordHash: await bcrypt.hash(password, 12), authVersion, mustChangePassword: true, updatedAt: now } });
      if (!result.matchedCount) throw new Error('account was not updated');
      credentials.push({ accountType: 'STAFF', identifier: account.staffId, email: account.email, role: account.role, temporaryPassword: password });
    } catch (_error) { failures.push({ accountType: 'STAFF', identifier: account.staffId }); }
  }

  const doctorCollection = db.getCollection('doctors');
  const doctors = db.data.doctors.filter((doctor) => doctor.passwordHash);
  for (const doctor of doctors) {
    const password = temporaryPassword();
    const authVersion = (doctor.authVersion || 0) + 1;
    try {
      const passwordHash = await bcrypt.hash(password, 12);
      const result = await doctorCollection.updateOne({ doctorId: doctor.doctorId }, { $set: { passwordHash, authVersion, mustChangePassword: true, updatedAt: now } });
      if (!result.matchedCount) throw new Error('account was not updated');
      Object.assign(doctor, { passwordHash, authVersion, mustChangePassword: true, updatedAt: now });
      credentials.push({ accountType: 'DOCTOR', identifier: doctor.doctorId, email: doctor.email, temporaryPassword: password });
    } catch (_error) { failures.push({ accountType: 'DOCTOR', identifier: doctor.doctorId }); }
  }

  return { resetCount: credentials.length, failedCount: failures.length, credentials, failures };
}

module.exports = { resetAll, CONFIRMATION };

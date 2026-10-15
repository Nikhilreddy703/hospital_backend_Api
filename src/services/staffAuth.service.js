const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../data/db');
const config = require('../utils/config');
const { errors } = require('../utils/errors');
const { nowIso } = require('../utils/helpers');
const { ROLES, EMAIL_RE: EMAIL, toPublic: safe } = require('../models/staff.model');

async function login({ email, password } = {}) {
  if (typeof email !== 'string' || !EMAIL.test(email.trim()) || typeof password !== 'string' || !password) throw errors.validation([{ field: 'credentials', message: 'A valid email and password are required.' }]);
  if (!config.jwtSecret) throw errors.registrationDisabled();
  const staff = await db.getCollection('staff').findOne({ email: email.trim().toLowerCase() });
  if (!staff || !staff.isActive || !(await bcrypt.compare(password, staff.passwordHash || ''))) throw errors.unauthorized();
  const token = jwt.sign({ role: 'staff' }, config.jwtSecret, { subject: staff.staffId, expiresIn: config.jwtExpiresIn, algorithm: 'HS256' });
  return { token, staff: safe(staff) };
}

async function create(input = {}, provisionKey, actor, bootstrap = false) {
  const { name, email, phone = null, password, role, department = null } = input;
  if (typeof name !== 'string' || name.trim().length < 2 || !EMAIL.test(String(email || '').trim()) || typeof password !== 'string' || password.length < 12 || password.length > 128 || !ROLES.includes(role)) {
    throw errors.validation([{ field: 'staff', message: 'Provide name (2+ chars), valid email, password (12-128 chars), and role ADMIN, RECEPTION, or MEDICAL_CENTER.' }]);
  }
  if (!config.jwtSecret) throw errors.registrationDisabled();
  if (bootstrap) {
    const count = await db.getCollection('staff').countDocuments({});
    if (count !== 0) throw errors.conflict('ADMIN_ALREADY_PROVISIONED', 'Initial administrator provisioning is only available before the first staff account exists.');
    if (!config.staffProvisioningKey || !provisionKey || provisionKey.length !== config.staffProvisioningKey.length || !crypto.timingSafeEqual(Buffer.from(provisionKey), Buffer.from(config.staffProvisioningKey))) throw errors.forbidden();
    if (role !== 'ADMIN') throw errors.forbidden();
  } else if (actor?.role !== 'ADMIN') throw errors.forbidden();
  const normalizedEmail = email.trim().toLowerCase();
  if (await db.getCollection('staff').findOne({ email: normalizedEmail })) throw errors.conflict('STAFF_ACCOUNT_EXISTS', 'A staff account with this email already exists.');
  const now = nowIso();
  const staff = { staffId: `STF${crypto.randomUUID()}`, name: name.trim(), email: normalizedEmail, phone, passwordHash: await bcrypt.hash(password, 12), role, department, isActive: true, createdAt: now, updatedAt: now };
  try { await db.getCollection('staff').insertOne(staff); }
  catch (err) { if (err.code === 11000) throw errors.conflict('STAFF_ACCOUNT_EXISTS', 'A staff account with this email already exists.'); throw err; }
  return safe(staff);
}

module.exports = { login, create, safe, ROLES };

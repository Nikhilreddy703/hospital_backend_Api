const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../data/db');
const config = require('../utils/config');
const { errors } = require('../utils/errors');
const { nowIso } = require('../utils/helpers');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function safeDoctor(doctor) {
  if (!doctor) return null;
  const { passwordHash, authVersion, ...publicDoctor } = doctor;
  return publicDoctor;
}

function validateCredentials({ email, password, doctorId }) {
  const issues = [];
  if (typeof doctorId !== 'string' || !/^DOC\d+$/i.test(doctorId.trim())) {
    issues.push({ field: 'doctorId', message: 'doctorId must look like DOC001.' });
  }
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    issues.push({ field: 'email', message: 'A valid email address is required.' });
  }
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    issues.push({ field: 'password', message: 'Password must be 12-128 characters.' });
  }
  if (issues.length) throw errors.validation(issues);
}

function issueToken(doctor) {
  return jwt.sign({ role: 'doctor', ver: doctor.authVersion || 0 }, config.jwtSecret, {
    subject: doctor.doctorId, expiresIn: config.jwtExpiresIn, algorithm: 'HS256',
  });
}

async function changePassword(doctorId, currentPassword, newPassword) {
  if (typeof currentPassword !== 'string' || !currentPassword || typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 128) {
    throw errors.validation([{ field: 'password', message: 'Provide currentPassword and a newPassword of 12-128 characters.' }]);
  }
  const doctor = db.data.doctors.find((item) => item.doctorId === doctorId);
  if (!doctor || doctor.isActive === false || !(await bcrypt.compare(currentPassword, doctor.passwordHash || ''))) throw errors.unauthorized();
  if (currentPassword === newPassword) throw errors.validation([{ field: 'newPassword', message: 'Choose a password different from the current password.' }]);
  doctor.passwordHash = await bcrypt.hash(newPassword, 12);
  doctor.authVersion = (doctor.authVersion || 0) + 1;
  doctor.mustChangePassword = false;
  doctor.updatedAt = nowIso();
  await db.save();
  return { token: issueToken(doctor), doctor: safeDoctor(doctor) };
}

async function registerDoctor(credentials = {}, registrationKey) {
  const { doctorId, email, password } = credentials;
  validateCredentials({ doctorId, email, password });
  if (!config.doctorRegistrationKey) throw errors.registrationDisabled();
  if (!registrationKey || registrationKey.length !== config.doctorRegistrationKey.length ||
      !require('crypto').timingSafeEqual(Buffer.from(registrationKey), Buffer.from(config.doctorRegistrationKey))) {
    throw errors.forbidden();
  }

  const doctor = db.data.doctors.find((item) => item.doctorId === doctorId.trim().toUpperCase());
  if (!doctor) throw errors.doctorNotFound(doctorId);
  if (doctor.isActive === false) throw errors.forbidden();

  const normalizedEmail = email.trim().toLowerCase();
  if (doctor.passwordHash || doctor.email || db.data.doctors.some((item) =>
    typeof item.email === 'string' && item.email.toLowerCase() === normalizedEmail
  )) {
    throw errors.conflict('DOCTOR_ACCOUNT_EXISTS', 'This doctor account is already registered or the email is already in use.');
  }
  if (!config.jwtSecret) throw errors.registrationDisabled();

  const now = nowIso();
  doctor.email = normalizedEmail;
  doctor.passwordHash = await bcrypt.hash(password, 12);
  doctor.isActive = true;
  doctor.accountCreatedAt = now;
  doctor.updatedAt = now;
  try {
    await db.save();
  } catch (error) {
    if (error.code === 11000) throw errors.conflict('DOCTOR_ACCOUNT_EXISTS', 'This email is already registered.');
    throw error;
  }
  return safeDoctor(doctor);
}

async function login(credentials = {}) {
  const { email, password } = credentials;
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim()) || typeof password !== 'string' || !password) {
    throw errors.validation([{ field: 'credentials', message: 'A valid email and password are required.' }]);
  }
  if (!config.jwtSecret) throw errors.registrationDisabled();
  const doctor = db.data.doctors.find((item) => item.email === email.trim().toLowerCase());
  if (!doctor || !doctor.passwordHash || doctor.isActive === false || !(await bcrypt.compare(password, doctor.passwordHash))) {
    throw errors.unauthorized();
  }

  const token = issueToken(doctor);
  return {
    token,
    doctor: {
      id: doctor.doctorId,
      name: doctor.name,
      email: doctor.email,
      specialization: doctor.specialization,
    },
    mustChangePassword: doctor.mustChangePassword === true,
  };
}

module.exports = { registerDoctor, login, changePassword, safeDoctor };

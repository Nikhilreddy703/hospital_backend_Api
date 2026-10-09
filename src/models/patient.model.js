const { errors } = require('../utils/errors');

const GENDERS = ['MALE', 'FEMALE', 'OTHER'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validates and normalises a patient payload.
 * partial=true is used for updates (only supplied fields are checked).
 */
function validatePatient(body = {}, { partial = false } = {}) {
  const errs = [];
  const out = {};
  const has = (k) => body[k] !== undefined;

  if (!partial || has('name')) {
    if (typeof body.name !== 'string' || body.name.trim().length < 2 || body.name.trim().length > 100) {
      errs.push({ field: 'name', message: 'name is required (2-100 characters).' });
    } else out.name = body.name.trim();
  }
  if (!partial || has('age')) {
    if (!Number.isInteger(body.age) || body.age < 0 || body.age > 120) {
      errs.push({ field: 'age', message: 'age is required and must be a whole number between 0 and 120.' });
    } else out.age = body.age;
  }
  if (!partial || has('gender')) {
    const g = typeof body.gender === 'string' ? body.gender.toUpperCase() : '';
    if (!GENDERS.includes(g)) {
      errs.push({ field: 'gender', message: `gender is required and must be one of ${GENDERS.join(', ')}.` });
    } else out.gender = g;
  }
  if (!partial || has('phone')) {
    if (typeof body.phone !== 'string' || !/^\d{10}$/.test(body.phone)) {
      errs.push({ field: 'phone', message: 'phone is required and must be a 10-digit string.' });
    } else out.phone = body.phone;
  }
  if (has('email')) {
    if (body.email === null || body.email === '') out.email = null;
    else if (typeof body.email !== 'string' || !EMAIL_RE.test(body.email)) {
      errs.push({ field: 'email', message: 'email must be a valid email address.' });
    } else out.email = body.email.trim();
  }

  if (!errs.length && partial && Object.keys(out).length === 0) {
    errs.push({ field: 'body', message: 'Provide at least one field to update: name, age, gender, phone, email.' });
  }
  if (errs.length) throw errors.validation(errs);
  return out;
}

module.exports = { validatePatient, GENDERS };

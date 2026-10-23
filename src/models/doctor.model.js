const { errors } = require('../utils/errors');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[\d\s().-]{7,20}$/;
const isText = (value) => typeof value === 'string' && value.trim().length > 0;

function validateDoctorProfile(body = {}) {
  const issues = [];
  for (const field of ['name', 'specialization', 'department']) {
    if (!isText(body[field])) issues.push({ field, message: `${field} is required.` });
  }
  if (typeof body.name === 'string' && (body.name.trim().length < 2 || body.name.trim().length > 100)) {
    issues.push({ field: 'name', message: 'name must be 2-100 characters.' });
  }
  for (const field of ['specialization', 'department']) {
    if (typeof body[field] === 'string' && body[field].trim().length > 100) issues.push({ field, message: `${field} must be at most 100 characters.` });
  }
  if (body.doctorType !== undefined && (typeof body.doctorType !== 'string' || !body.doctorType.trim() || body.doctorType.trim().length > 100)) {
    issues.push({ field: 'doctorType', message: 'doctorType must be a non-empty string of at most 100 characters.' });
  }
  const experience = body.experienceYears ?? body.experience;
  if (experience !== undefined && (!Number.isInteger(experience) || experience < 0 || experience > 70)) {
    issues.push({ field: 'experienceYears', message: 'experienceYears must be a whole number from 0 to 70.' });
  }
  if (body.consultationFee !== undefined && (typeof body.consultationFee !== 'number' || !Number.isFinite(body.consultationFee) || body.consultationFee < 0)) {
    issues.push({ field: 'consultationFee', message: 'consultationFee must be a non-negative number.' });
  }
  if (body.location !== undefined && body.location !== null && (typeof body.location !== 'string' || body.location.trim().length > 200)) {
    issues.push({ field: 'location', message: 'location must be at most 200 characters.' });
  }
  if (body.phone !== undefined && body.phone !== null && (typeof body.phone !== 'string' || !PHONE_RE.test(body.phone.trim()))) {
    issues.push({ field: 'phone', message: 'phone must contain 7-20 characters and use digits or common phone punctuation.' });
  }
  if (body.email !== undefined && body.email !== null && body.email !== '' && (typeof body.email !== 'string' || !EMAIL_RE.test(body.email.trim()))) {
    issues.push({ field: 'email', message: 'email must be a valid email address.' });
  }
  if (body.currency !== undefined && (typeof body.currency !== 'string' || !/^[A-Za-z]{3}$/.test(body.currency.trim()))) {
    issues.push({ field: 'currency', message: 'currency must be a three-letter code such as INR.' });
  }
  const status = body.availabilityStatus ?? body.status;
  if (status !== undefined && !['AVAILABLE', 'OFFLINE'].includes(String(status).toUpperCase())) {
    issues.push({ field: 'availabilityStatus', message: 'availabilityStatus must be AVAILABLE or OFFLINE when creating a doctor.' });
  }
  if (body.isActive !== undefined && typeof body.isActive !== 'boolean') {
    issues.push({ field: 'isActive', message: 'isActive must be a boolean.' });
  }
  if (issues.length) throw errors.validation(issues);

  return {
    name: body.name.trim(),
    specialization: body.specialization.trim(),
    department: body.department.trim(),
    doctorType: isText(body.doctorType) ? body.doctorType.trim() : body.specialization.trim(),
    experienceYears: experience ?? 0,
    consultationFee: body.consultationFee ?? 0,
    currency: (body.currency || 'INR').trim().toUpperCase(),
    location: typeof body.location === 'string' ? body.location.trim() : null,
    phone: typeof body.phone === 'string' ? body.phone.trim() : null,
    email: typeof body.email === 'string' && body.email.trim() ? body.email.trim().toLowerCase() : null,
    availabilityStatus: String(status || 'AVAILABLE').toUpperCase(),
    isActive: body.isActive ?? true,
  };
}

module.exports = { validateDoctorProfile };

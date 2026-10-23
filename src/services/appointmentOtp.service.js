const crypto = require('node:crypto');
const db = require('../data/db');
const config = require('../utils/config');
const { AppError, errors } = require('../utils/errors');
const { isValidDate, isPastDate, isPastAppointmentTime, normalize, nowIso } = require('../utils/helpers');
const doctorService = require('./doctor.service');
const slotService = require('./slot.service');
const doctorLeaveService = require('./doctorLeave.service');
const patientService = require('./patient.service');
const appointmentService = require('./appointment.service');
const mailService = require('./mail.service');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_DELAY_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

function validateRequest(input = {}) {
  const issues = [];
  const required = ['name', 'email', 'date', 'time', 'department', 'doctorName', 'reason'];
  for (const key of required) if (typeof input[key] !== 'string' || !input[key].trim()) issues.push({ field: key, message: `${key} is required.` });
  if (typeof input.name === 'string' && (input.name.trim().length < 2 || input.name.trim().length > 100)) issues.push({ field: 'name', message: 'name must be 2-100 characters.' });
  if (typeof input.email === 'string' && !EMAIL_RE.test(input.email.trim())) issues.push({ field: 'email', message: 'email must be a valid email address.' });
  if (input.date !== undefined && !isValidDate(input.date)) issues.push({ field: 'date', message: 'date must be a valid date in YYYY-MM-DD format.' });
  if (input.time !== undefined && (typeof input.time !== 'string' || !/^(?:[01]?\d|2[0-3]):[0-5]\d$|^(?:0?[1-9]|1[0-2]):[0-5]\d\s?(?:AM|PM)$/i.test(input.time.trim()))) issues.push({ field: 'time', message: 'time must use HH:mm (24-hour) or h:mm AM/PM format.' });
  if (input.reason !== undefined && input.reason !== null && (typeof input.reason !== 'string' || input.reason.length > 200)) issues.push({ field: 'reason', message: 'reason must be at most 200 characters.' });
  if (issues.length) throw errors.validation(issues);
  return { name: input.name.trim(), email: input.email.trim().toLowerCase(), date: input.date, time: input.time.trim(), department: input.department.trim(), doctorName: input.doctorName.trim(), reason: input.reason?.trim() || null };
}

function otpHash(email, code) {
  const secret = config.jwtSecret || config.staffProvisioningKey;
  if (!secret) throw new AppError(503, 'OTP_NOT_CONFIGURED', 'Configure JWT_SECRET before enabling email OTP booking.');
  return crypto.createHmac('sha256', secret).update(`${email}:${code}`).digest('hex');
}

async function resolveSlot(details) {
  if (isPastDate(details.date)) throw errors.pastAppointmentDate();
  const candidates = doctorService.findDoctors({ department: details.department });
  const doctor = candidates.find((item) => normalize(item.name) === normalize(details.doctorName));
  if (!doctor) throw errors.doctorNotFound(details.doctorName);
  if (doctor.isActive === false || doctor.availabilityStatus !== 'AVAILABLE' || ['OFFLINE', 'ON_LEAVE'].includes(doctor.status)) {
    throw errors.doctorUnavailable(doctor.name);
  }
  await slotService.ensureDoctorSlots(doctor.doctorId);
  if (await doctorLeaveService.isOnLeave(doctor.doctorId, details.date)) throw errors.doctorOnLeave();
  const slot = slotService.findSlotByDateTime(details.date, details.time, doctor.doctorId);
  if (isPastAppointmentTime(slot.date, slot.time24)) throw errors.pastAppointmentTime();
  if (slot.status !== 'AVAILABLE') throw errors.slotAlreadyBooked();
  return { doctor, slot };
}

async function requestOtp(input) {
  const details = validateRequest(input);
  const { doctor, slot } = await resolveSlot(details);
  const collection = db.getCollection('appointment_otps');
  const current = await collection.findOne({ email: details.email });
  const now = Date.now();
  if (current && new Date(current.lastSentAt).getTime() + RESEND_DELAY_MS > now) {
    throw new AppError(429, 'OTP_RATE_LIMITED', 'Wait one minute before requesting another verification code.');
  }
  const code = String(crypto.randomInt(100000, 1000000));
  const record = {
    email: details.email,
    otpHash: otpHash(details.email, code),
    details: { ...details, doctorId: doctor.doctorId, slotId: slot.slotId },
    createdAt: nowIso(),
    lastSentAt: nowIso(),
    expiresAt: new Date(now + OTP_TTL_MS),
    attempts: 0,
  };
  if (current) await collection.updateOne({ email: details.email }, { $set: record });
  else await collection.insertOne(record);
  try {
    await mailService.sendOtp(details.email, code);
  } catch (error) {
    await collection.deleteOne({ email: details.email });
    throw new AppError(503, 'EMAIL_DELIVERY_FAILED', 'The verification email could not be sent. Check SMTP configuration and try again.');
  }
  return { email: details.email, expiresInSeconds: OTP_TTL_MS / 1000, resendAfterSeconds: RESEND_DELAY_MS / 1000 };
}

async function confirmOtp({ email, otp } = {}) {
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(normalizedEmail) || typeof otp !== 'string' || !/^\d{6}$/.test(otp)) {
    throw errors.validation([{ field: 'credentials', message: 'Provide a valid email and six-digit otp.' }]);
  }
  const collection = db.getCollection('appointment_otps');
  const record = await collection.findOne({ email: normalizedEmail });
  if (!record) throw new AppError(400, 'OTP_INVALID_OR_EXPIRED', 'The verification code is invalid or expired. Request a new code.');
  if (new Date(record.expiresAt).getTime() <= Date.now()) {
    await collection.deleteOne({ email: normalizedEmail });
    throw new AppError(400, 'OTP_INVALID_OR_EXPIRED', 'The verification code is invalid or expired. Request a new code.');
  }
  if (record.attempts >= MAX_ATTEMPTS) throw new AppError(429, 'OTP_ATTEMPTS_EXCEEDED', 'Too many incorrect codes. Request a new verification code.');
  const supplied = Buffer.from(otpHash(normalizedEmail, otp), 'hex');
  const expected = Buffer.from(record.otpHash, 'hex');
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    await collection.updateOne({ email: normalizedEmail }, { $set: { attempts: record.attempts + 1 } });
    throw new AppError(400, 'OTP_INVALID_OR_EXPIRED', 'The verification code is invalid or expired.');
  }
  const { details } = record;
  await resolveSlot(details);
  const patient = await patientService.findOrCreateEmailPatient(details);
  const appointment = await appointmentService.book({ patientId: patient.patientId, doctorId: details.doctorId, slotId: details.slotId, reason: details.reason });
  await collection.deleteOne({ email: normalizedEmail });
  let confirmationEmailSent = true;
  const recordInMemory = db.data.appointments.find((item) => item.appointmentId === appointment.appointmentId);
  try {
    await mailService.sendAppointmentConfirmation(normalizedEmail, { ...appointment, patientName: details.name, department: details.department });
    recordInMemory.confirmationEmailSentAt = nowIso();
  } catch (error) {
    confirmationEmailSent = false;
    recordInMemory.confirmationEmailPending = true;
    console.error('Appointment booked but confirmation email failed:', error.message);
  }
  await db.save();
  return { appointment, confirmationEmailSent };
}

module.exports = { requestOtp, confirmOtp };

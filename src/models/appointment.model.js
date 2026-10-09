const { errors } = require('../utils/errors');

const STATUS = { CONFIRMED: 'CONFIRMED', CANCELLED: 'CANCELLED' };

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

function validateBooking(body = {}) {
  const errs = [];
  for (const f of ['patientId', 'doctorId', 'slotId']) {
    if (!isNonEmptyString(body[f])) errs.push({ field: f, message: `${f} is required.` });
  }
  if (body.reason !== undefined && body.reason !== null && (typeof body.reason !== 'string' || body.reason.length > 200)) {
    errs.push({ field: 'reason', message: 'reason must be a string of at most 200 characters.' });
  }
  if (errs.length) throw errors.validation(errs);
  return {
    patientId: body.patientId.trim(),
    doctorId: body.doctorId.trim(),
    slotId: body.slotId.trim(),
    reason: body.reason ? body.reason.trim() : null,
  };
}

function validateReschedule(body = {}) {
  const errs = [];
  if (!isNonEmptyString(body.slotId)) errs.push({ field: 'slotId', message: 'slotId (the new slot) is required.' });
  if (body.doctorId !== undefined && !isNonEmptyString(body.doctorId)) {
    errs.push({ field: 'doctorId', message: 'doctorId, if provided, must be a non-empty string.' });
  }
  if (errs.length) throw errors.validation(errs);
  return { slotId: body.slotId.trim(), doctorId: body.doctorId ? body.doctorId.trim() : undefined };
}

module.exports = { STATUS, validateBooking, validateReschedule };

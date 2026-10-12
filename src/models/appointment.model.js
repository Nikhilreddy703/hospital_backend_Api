const { errors } = require('../utils/errors');
const { isValidDate } = require('../utils/helpers');

const STATUS = { CONFIRMED: 'CONFIRMED', CANCELLED: 'CANCELLED' };

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

function validateBooking(body = {}) {
  const errs = [];
  for (const f of ['patientId', 'doctorId']) {
    if (!isNonEmptyString(body[f])) errs.push({ field: f, message: `${f} is required.` });
  }
  const hasSlotId = isNonEmptyString(body.slotId);
  const hasDate = body.date !== undefined;
  const hasTime = body.time !== undefined;
  if (!hasSlotId && !(hasDate && hasTime)) {
    errs.push({ field: 'slotId', message: 'Provide slotId or both date and time.' });
  }
  if (hasSlotId && (hasDate || hasTime)) {
    errs.push({ field: 'slotId', message: 'Use either slotId or date and time, not both.' });
  }
  if (hasDate && !isValidDate(body.date)) {
    errs.push({ field: 'date', message: 'date must be a valid date in YYYY-MM-DD format.' });
  }
  if (hasTime && (!isNonEmptyString(body.time) || !/^(?:[01]?\d|2[0-3]):[0-5]\d$|^(?:0?[1-9]|1[0-2]):[0-5]\d\s?(?:AM|PM)$/i.test(body.time.trim()))) {
    errs.push({ field: 'time', message: 'time must use HH:mm (24-hour) or h:mm AM/PM format.' });
  }
  if (body.reason !== undefined && body.reason !== null && (typeof body.reason !== 'string' || body.reason.length > 200)) {
    errs.push({ field: 'reason', message: 'reason must be a string of at most 200 characters.' });
  }
  if (errs.length) throw errors.validation(errs);
  return {
    patientId: body.patientId.trim(),
    doctorId: body.doctorId.trim(),
    slotId: hasSlotId ? body.slotId.trim() : undefined,
    date: hasDate ? body.date : undefined,
    time: hasTime ? body.time.trim() : undefined,
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

const { errors } = require('../utils/errors');
const { isValidDate, todayInIndia } = require('../utils/helpers');

const DOCTOR_STATUSES = ['AVAILABLE', 'CHECKED_IN', 'ON_LEAVE', 'OFFLINE'];

function validateStatus(body = {}) {
  const status = typeof body.status === 'string' ? body.status.toUpperCase() : '';
  if (!DOCTOR_STATUSES.includes(status)) {
    throw errors.validation([{ field: 'status', message: `status must be one of ${DOCTOR_STATUSES.join(', ')}.` }]);
  }
  return status;
}

function validateLeave(body = {}) {
  const issues = [];
  if (!isValidDate(body.startDate) || body.startDate < todayInIndia()) {
    issues.push({ field: 'startDate', message: 'startDate must be today or a future date in YYYY-MM-DD format.' });
  }
  if (!isValidDate(body.endDate) || (isValidDate(body.startDate) && body.endDate < body.startDate)) {
    issues.push({ field: 'endDate', message: 'endDate must be on or after startDate in YYYY-MM-DD format.' });
  }
  if (body.reason !== undefined && (typeof body.reason !== 'string' || body.reason.trim().length > 200)) {
    issues.push({ field: 'reason', message: 'reason must be a string of at most 200 characters.' });
  }
  if (issues.length) throw errors.validation(issues);
  return { startDate: body.startDate, endDate: body.endDate, reason: body.reason ? body.reason.trim() : null };
}

function validateAppointmentId(id) {
  if (typeof id !== 'string' || !/^APT\d+$/i.test(id)) throw errors.invalidAppointment(id);
  return id.toUpperCase();
}

function validatePrescription(body = {}) {
  const issues = [];
  if (typeof body.diagnosis !== 'string' || !body.diagnosis.trim() || body.diagnosis.trim().length > 500) {
    issues.push({ field: 'diagnosis', message: 'diagnosis is required and must not exceed 500 characters.' });
  }
  if (body.notes !== undefined && (typeof body.notes !== 'string' || body.notes.length > 2000)) {
    issues.push({ field: 'notes', message: 'notes must be a string of at most 2000 characters.' });
  }
  if (!Array.isArray(body.medicines) || body.medicines.length < 1 || body.medicines.length > 20) {
    issues.push({ field: 'medicines', message: 'Provide between 1 and 20 medicines.' });
  } else {
    body.medicines.forEach((medicine, index) => {
      for (const field of ['name', 'dosage', 'frequency', 'duration']) {
        if (typeof medicine[field] !== 'string' || !medicine[field].trim() || medicine[field].trim().length > 200) {
          issues.push({ field: `medicines[${index}].${field}`, message: `${field} is required and must not exceed 200 characters.` });
        }
      }
      if (medicine.instructions !== undefined && (typeof medicine.instructions !== 'string' || medicine.instructions.length > 500)) {
        issues.push({ field: `medicines[${index}].instructions`, message: 'instructions must be a string of at most 500 characters.' });
      }
    });
  }
  if (issues.length) throw errors.validation(issues);
  return {
    diagnosis: body.diagnosis.trim(),
    notes: body.notes ? body.notes.trim() : null,
    medicines: body.medicines.map((medicine) => ({
      name: medicine.name.trim(),
      dosage: medicine.dosage.trim(),
      frequency: medicine.frequency.trim(),
      duration: medicine.duration.trim(),
      instructions: medicine.instructions ? medicine.instructions.trim() : null,
    })),
  };
}

function validateAppointmentFilters(query = {}) {
  const issues = [];
  if (query.date !== undefined && !isValidDate(query.date)) issues.push({ field: 'date', message: 'date must use YYYY-MM-DD.' });
  const page = query.page === undefined ? 1 : Number(query.page);
  const limit = query.limit === undefined ? 50 : Number(query.limit);
  if (!Number.isInteger(page) || page < 1) issues.push({ field: 'page', message: 'page must be a positive integer.' });
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) issues.push({ field: 'limit', message: 'limit must be between 1 and 100.' });
  if (issues.length) throw errors.validation(issues);
  return { date: query.date, status: query.status, page, limit };
}

module.exports = { DOCTOR_STATUSES, validateStatus, validateLeave, validateAppointmentId, validatePrescription, validateAppointmentFilters };

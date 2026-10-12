const db = require('../data/db');
const { errors } = require('../utils/errors');
const { isValidDate, todayInIndia } = require('../utils/helpers');
const doctorService = require('./doctor.service');

const toSlotView = (s) => ({ slotId: s.slotId, date: s.date, time: s.time, status: s.status });

function availableSlotsFor(doctorId) {
  return db.data.slots
    .filter((s) => s.doctorId === doctorId && s.status === 'AVAILABLE' && s.date >= todayInIndia())
    .sort((a, b) => a.date.localeCompare(b.date) || a.time24.localeCompare(b.time24));
}

/** GET /api/doctors/:id/slots?date=YYYY-MM-DD  (AVAILABLE slots only) */
function getDoctorSlots(doctorId, date) {
  const doctor = doctorService.getDoctor(doctorId);
  if (date !== undefined && !isValidDate(date)) throw errors.invalidDate(date);

  let slots = availableSlotsFor(doctor.doctorId);
  if (date) slots = slots.filter((s) => s.date === date);

  return {
    doctorId: doctor.doctorId,
    doctorName: doctor.name,
    specialization: doctor.specialization,
    date: date || null,
    totalAvailable: slots.length,
    availableSlots: slots.map(toSlotView),
  };
}

/** GET /api/doctors/:id/available-dates  (helps the chatbot offer "pick a date") */
function getAvailableDates(doctorId) {
  const doctor = doctorService.getDoctor(doctorId);
  const counts = {};
  for (const s of availableSlotsFor(doctor.doctorId)) counts[s.date] = (counts[s.date] || 0) + 1;
  return {
    doctorId: doctor.doctorId,
    doctorName: doctor.name,
    specialization: doctor.specialization,
    availableDates: Object.entries(counts).map(([date, availableSlots]) => ({ date, availableSlots })),
  };
}

/** Internal: find a slot and make sure it belongs to the given doctor. */
function findSlotForDoctor(slotId, doctorId) {
  const slot = db.data.slots.find((s) => s.slotId === String(slotId).toUpperCase() && s.doctorId === doctorId);
  if (!slot) throw errors.slotNotFound(slotId, doctorId);
  return slot;
}

function findSlotByDateTime(date, time, doctorId) {
  const normalizedTime = normalizeTime(time);
  const slot = db.data.slots.find((item) =>
    item.doctorId === doctorId && item.date === date && item.time24 === normalizedTime
  );
  if (!slot) throw errors.slotNotFound(`${date} ${time}`, doctorId);
  return slot;
}

function normalizeTime(value) {
  const time = value.trim().toUpperCase().replace(/\s+/g, ' ');
  const twelveHour = time.match(/^(\d{1,2}):(\d{2})\s?(AM|PM)$/);
  if (twelveHour) {
    let hours = Number(twelveHour[1]) % 12;
    if (twelveHour[3] === 'PM') hours += 12;
    return `${String(hours).padStart(2, '0')}:${twelveHour[2]}`;
  }
  return time;
}

module.exports = { getDoctorSlots, getAvailableDates, findSlotForDoctor, findSlotByDateTime };

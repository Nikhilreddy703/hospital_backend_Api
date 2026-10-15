const db = require('../data/db');
const { errors } = require('../utils/errors');
const { isValidDate, todayInIndia } = require('../utils/helpers');
const doctorService = require('./doctor.service');
const doctorLeaveService = require('./doctorLeave.service');
const config = require('../utils/config');

const SLOT_TIMES = ['10:00', '10:30', '11:00', '11:30', '14:00', '14:30', '15:00', '15:30'];

/** Fill the configured booking window for an available doctor without replacing existing slots. */
async function ensureDoctorSlots(doctorId) {
  const doctor = doctorService.getDoctor(doctorId);
  if (doctor.isActive === false || doctor.availabilityStatus !== 'AVAILABLE' || ['OFFLINE', 'ON_LEAVE'].includes(doctor.status)) return 0;

  const leaves = await doctorLeaveService.listActiveForAvailability(doctor.doctorId);
  const start = new Date(`${todayInIndia()}T00:00:00Z`);
  const days = Math.max(1, Math.min(Number(config.seedDays) || 14, 90));
  const collection = db.getCollection('slots');
  const created = [];
  const operations = [];
  for (let offset = 0; offset < days; offset += 1) {
    const day = new Date(start.getTime() + offset * 86400000);
    if (day.getUTCDay() === 0) continue;
    const date = day.toISOString().slice(0, 10);
    if (leaves.some((leave) => leave.startDate <= date && leave.endDate >= date)) continue;
    for (const time24 of SLOT_TIMES) {
      const slotId = `S-${doctor.doctorId}-${date.replace(/-/g, '')}-${time24.replace(':', '')}`;
      const slot = { slotId, doctorId: doctor.doctorId, date, time24, time: require('../utils/helpers').to12h(time24), status: 'AVAILABLE' };
      operations.push({ slot, run: () => collection.updateOne(
        { doctorId: slot.doctorId, date: slot.date, time24: slot.time24 },
        { $setOnInsert: slot },
        { upsert: true }
      ) });
    }
  }
  for (let index = 0; index < operations.length; index += 32) {
    const batch = await Promise.all(operations.slice(index, index + 32).map(async ({ slot, run }) => {
      try { return { slot, result: await run() }; }
      catch (error) { if (error.code === 11000) return { slot, result: null }; throw error; }
    }));
    for (const { slot, result } of batch) if (result?.upsertedId) created.push(slot);
  }

  // The application keeps a local mirror for its existing booking services.
  const current = db.isConnected()
    ? await collection.find({ doctorId: doctor.doctorId, date: { $gte: todayInIndia() } }).toArray()
    : await collection.find({ doctorId: doctor.doctorId }).toArray();
  const byId = new Map(db.data.slots.map((slot) => [slot.slotId, slot]));
  for (const document of current) {
    const { _id, ...slot } = document;
    byId.set(slot.slotId, slot);
  }
  db.data.slots = [...byId.values()];
  return created.length;
}

const toSlotView = (s) => ({ slotId: s.slotId, date: s.date, time: s.time, status: s.status });

async function availableSlotsFor(doctorId) {
  const cutoffDate = todayInIndia();
  const slots = db.isConnected()
    ? await db.getCollection('slots').find({ doctorId, status: 'AVAILABLE', date: { $gte: cutoffDate } })
      .sort({ date: 1, time24: 1 }).toArray()
    : db.data.slots.filter((s) => s.doctorId === doctorId && s.status === 'AVAILABLE' && s.date >= cutoffDate);
  return slots.sort((a, b) => a.date.localeCompare(b.date) || a.time24.localeCompare(b.time24));
}

/** GET /api/doctors/:id/slots?date=YYYY-MM-DD  (AVAILABLE slots only) */
async function getDoctorSlots(doctorId, date) {
  const doctor = doctorService.getDoctor(doctorId);
  if (date !== undefined && !isValidDate(date)) throw errors.invalidDate(date);

  let slots = await availableSlotsFor(doctor.doctorId);
  const leaves = await doctorLeaveService.listActiveForAvailability(doctor.doctorId);
  slots = slots.filter((slot) => !leaves.some((leave) => leave.startDate <= slot.date && leave.endDate >= slot.date));
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
async function getAvailableDates(doctorId) {
  const doctor = doctorService.getDoctor(doctorId);
  const counts = {};
  const leaves = await doctorLeaveService.listActiveForAvailability(doctor.doctorId);
  const slots = (await availableSlotsFor(doctor.doctorId)).filter((slot) =>
    !leaves.some((leave) => leave.startDate <= slot.date && leave.endDate >= slot.date)
  );
  for (const s of slots) counts[s.date] = (counts[s.date] || 0) + 1;
  return {
    doctorId: doctor.doctorId,
    doctorName: doctor.name,
    specialization: doctor.specialization,
    availableDates: Object.entries(counts).map(([date, availableSlots]) => ({ date, availableSlots })),
  };
}

async function ensureAvailableDoctorSlots() {
  let created = 0;
  for (const doctor of db.data.doctors) {
    if (doctor.isActive === false || doctor.availabilityStatus !== 'AVAILABLE' || ['OFFLINE', 'ON_LEAVE'].includes(doctor.status)) continue;
    created += await ensureDoctorSlots(doctor.doctorId);
  }
  return created;
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

module.exports = { getDoctorSlots, getAvailableDates, findSlotForDoctor, findSlotByDateTime, ensureDoctorSlots, ensureAvailableDoctorSlots };

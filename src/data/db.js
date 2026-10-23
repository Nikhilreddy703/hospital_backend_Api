const { MongoClient } = require('mongodb');
const config = require('../utils/config');
const { buildSeedData } = require('./seed');
const { createMemoryCollection } = require('./memoryCollection');
const { todayInIndia, isPastAppointmentTime, nowIso } = require('../utils/helpers');

let state = null;
let client = null;
let database = null;
let collections = null;
let pendingWrite = Promise.resolve();
let persistedState = null;

const collectionNames = {
  doctors: 'doctors',
  patients: 'patients',
  appointments: 'appointments',
  slots: 'slots',
};

function withoutMongoId(document) {
  const { _id, ...record } = document;
  return record;
}

function save(clearCollections = false) {
  if (!config.persist || !collections) return Promise.resolve();
  // Persist only documents changed in this process. Rewriting every cached
  // document can overwrite concurrent changes made by another Render instance.
  const idFields = { doctors: 'doctorId', patients: 'patientId', appointments: 'appointmentId', slots: 'slotId' };
  const snapshot = JSON.parse(JSON.stringify(state));
  // MongoDB's _id is immutable; cached documents hydrated after startup may
  // contain it, so never include it in a $set payload.
  for (const key of Object.keys(idFields)) snapshot[key] = snapshot[key].map(withoutMongoId);
  const changed = {};
  for (const [key, idField] of Object.entries(idFields)) {
    const previous = new Map((persistedState?.[key] || []).map((doc) => [doc[idField], JSON.stringify(doc)]));
    changed[key] = snapshot[key].filter((doc) => clearCollections || previous.get(doc[idField]) !== JSON.stringify(doc));
  }
  const write = pendingWrite.then(async () => {
    for (const [key, collection] of Object.entries(collections)) {
      if (clearCollections) await collection.deleteMany({});
      const idField = idFields[key];
      if (changed[key].length) {
        await collection.bulkWrite(changed[key].map((doc) => ({
          updateOne: { filter: { [idField]: doc[idField] }, update: { $set: doc }, upsert: true },
        })), { ordered: true });
      }
    }
    persistedState = snapshot;
  });
  pendingWrite = write.catch((error) => console.error('Could not persist changes to MongoDB:', error.message));
  return write;
}

function load() {
  if (state) return state;
  state = buildSeedData();
  return state;
}

function reset() {
  state = buildSeedData();
  save(true);
  return state;
}

async function connect() {
  if (!config.mongoUri) throw new Error('MONGODB_URI is required to start the server.');
  client = new MongoClient(config.mongoUri);
  await client.connect();
  database = client.db(config.mongoDbName || undefined);
  collections = Object.fromEntries(Object.entries(collectionNames).map(([key, name]) => [key, database.collection(name)]));

  const data = {};
  for (const [key, collection] of Object.entries(collections)) {
    let docs = await collection.find({}).toArray();
    data[key] = docs.map(withoutMongoId);
  }

  const seeded = buildSeedData();
  if (Object.values(data).every((items) => items.length === 0)) {
    state = seeded;
    persistedState = JSON.parse(JSON.stringify(data));
    save();
  } else {
    state = {
      doctors: data.doctors.length ? data.doctors : seeded.doctors,
      patients: data.patients.length ? data.patients : seeded.patients,
      slots: data.slots.length ? data.slots : seeded.slots,
      appointments: data.appointments.length ? data.appointments : seeded.appointments,
      meta: {
        nextDoctorNumber: Math.max(0, ...(data.doctors.length ? data.doctors : seeded.doctors).map((doctor) => Number(String(doctor.doctorId).replace(/^DOC/, '')) || 0)) + 1,
        nextPatientNumber: Math.max(0, ...data.patients.map((p) => Number(String(p.patientId).replace(/^PAT/, '')) || 0)) + 1,
        nextAppointmentNumber: Math.max(10000, ...data.appointments.map((a) => Number(String(a.appointmentId).replace(/^APT/, '')) || 0)) + 1,
      },
    };
    persistedState = JSON.parse(JSON.stringify(data));
    // If only some collections were empty, initialize those with seed records.
    save();
  }
  await ensureIndexes();
}

async function ensureIndexes() {
  await Promise.all([
    collections.doctors.createIndex({ doctorId: 1 }, { unique: true, name: 'doctor_id_unique' }),
    collections.doctors.createIndex({ email: 1 }, { unique: true, sparse: true, name: 'doctor_email_unique' }),
    collections.patients.createIndex({ patientId: 1 }, { unique: true, name: 'patient_id_unique' }),
    collections.appointments.createIndex({ appointmentId: 1 }, { unique: true, name: 'appointment_id_unique' }),
    collections.appointments.createIndex({ doctorId: 1, date: 1, time24: 1 }, { name: 'appointments_doctor_schedule' }),
    collections.appointments.createIndex({ patientId: 1, date: 1 }, { name: 'appointments_patient_schedule' }),
    collections.appointments.createIndex({ doctorId: 1, status: 1, date: 1 }, { name: 'appointments_doctor_status_date' }),
    collections.slots.createIndex({ slotId: 1 }, { unique: true, name: 'slot_id_unique' }),
    collections.slots.createIndex({ doctorId: 1, date: 1, time24: 1 }, { unique: true, name: 'doctor_slot_time_unique' }),
    database.collection('doctor_attendance').createIndex(
      { doctorId: 1, date: 1 },
      { unique: true, partialFilterExpression: { checkOutTime: null }, name: 'active_daily_attendance_unique' }
    ),
    database.collection('doctor_leaves').createIndex({ doctorId: 1, status: 1, startDate: 1, endDate: 1 }, { name: 'doctor_leave_dates' }),
    database.collection('prescriptions').createIndex({ appointmentId: 1 }, { unique: true, name: 'prescription_appointment_unique' }),
    database.collection('prescriptions').createIndex({ doctorId: 1, createdAt: -1 }, { name: 'prescriptions_doctor_created' }),
    database.collection('staff').createIndex({ email: 1 }, { unique: true, name: 'staff_email_unique' }),
    database.collection('staff').createIndex({ staffId: 1 }, { unique: true, name: 'staff_id_unique' }),
    database.collection('appointments').createIndex({ status: 1, date: 1 }, { name: 'appointments_status_date' }),
    database.collection('appointment_otps').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'appointment_otp_expiry' }),
  ]);
}

function getCollection(name) {
  if (database) return database.collection(name);
  if (!config.persist) {
    if (!state) load();
    const stateKey = Object.keys(collectionNames).find((key) => collectionNames[key] === name);
    if (stateKey) return createMemoryCollection(state[stateKey]);
    state.meta.memoryCollections ||= {};
    state.meta.memoryCollections[name] ||= [];
    return createMemoryCollection(state.meta.memoryCollections[name]);
  }
  throw new Error('MongoDB is not connected.');
}

const isConnected = () => Boolean(database);

async function reserveSlot(slotId, doctorId) {
  if (!collections || !config.persist) return false;
  const result = await collections.slots.findOneAndUpdate(
    { slotId, doctorId, status: 'AVAILABLE' },
    { $set: { status: 'BOOKED' } },
    { returnDocument: 'after' }
  );
  return Boolean(result);
}

async function allocateAppointmentNumber() {
  if (!collections || !config.persist) return state.meta.nextAppointmentNumber++;
  const counters = database.collection('counters');
  const initialValue = Math.max(10000, (state.meta.nextAppointmentNumber || 10001) - 1);
  await counters.updateOne({ _id: 'appointmentNumber' }, { $setOnInsert: { value: initialValue } }, { upsert: true });
  const result = await counters.findOneAndUpdate(
    { _id: 'appointmentNumber' },
    { $inc: { value: 1 } },
    { returnDocument: 'after' }
  );
  state.meta.nextAppointmentNumber = Math.max(state.meta.nextAppointmentNumber || 10001, result.value + 1);
  return result.value;
}

async function allocatePatientNumber() {
  if (!collections || !config.persist) return state.meta.nextPatientNumber++;
  const counters = database.collection('counters');
  const initialValue = Math.max(0, (state.meta.nextPatientNumber || 1) - 1);
  await counters.updateOne({ _id: 'patientNumber' }, { $setOnInsert: { value: initialValue } }, { upsert: true });
  const result = await counters.findOneAndUpdate({ _id: 'patientNumber' }, { $inc: { value: 1 } }, { returnDocument: 'after' });
  state.meta.nextPatientNumber = Math.max(state.meta.nextPatientNumber || 1, result.value + 1);
  return result.value;
}

async function allocateDoctorNumber() {
  if (!collections || !config.persist) return state.meta.nextDoctorNumber++;
  const counters = database.collection('counters');
  const initialValue = Math.max(0, (state.meta.nextDoctorNumber || 1) - 1);
  await counters.updateOne({ _id: 'doctorNumber' }, { $setOnInsert: { value: initialValue } }, { upsert: true });
  const result = await counters.findOneAndUpdate({ _id: 'doctorNumber' }, { $inc: { value: 1 } }, { returnDocument: 'after' });
  state.meta.nextDoctorNumber = Math.max(state.meta.nextDoctorNumber || 1, result.value + 1);
  return result.value;
}

async function close() {
  await pendingWrite;
  if (client) await client.close();
}

async function prunePastAvailableSlots() {
  if (!state) load();
  const cutoffDate = todayInIndia();

  if (!collections || !config.persist) {
    const before = state.slots.length;
    state.slots = state.slots.filter((slot) => slot.status !== 'AVAILABLE' || slot.date >= cutoffDate);
    const removed = before - state.slots.length;
    if (removed) save();
    return removed;
  }

  const operation = pendingWrite.then(async () => {
    const expiredIds = state.slots
      .filter((slot) => slot.status === 'AVAILABLE' && slot.date < cutoffDate)
      .map((slot) => slot.slotId);
    if (!expiredIds.length) return 0;

    await collections.slots.deleteMany({
      slotId: { $in: expiredIds },
      status: 'AVAILABLE',
      date: { $lt: cutoffDate },
    });

    const expired = new Set(expiredIds);
    const before = state.slots.length;
    state.slots = state.slots.filter((slot) =>
      !expired.has(slot.slotId) || slot.status !== 'AVAILABLE' || slot.date >= cutoffDate
    );
    return before - state.slots.length;
  });
  pendingWrite = operation.catch((error) => {
    console.error('Could not prune past available slots:', error.message);
  });
  return operation;
}

async function completePastAppointments() {
  if (!state) load();

  if (!collections || !config.persist) {
    const completedAt = nowIso();
    const pastAppointments = state.appointments.filter((appointment) =>
      ['CONFIRMED', 'PATIENT_CHECKED_IN', 'IN_CONSULTATION'].includes(appointment.status) && isPastAppointmentTime(appointment.date, appointment.time24)
    );
    for (const appointment of pastAppointments) {
      if (appointment.status === 'CONFIRMED') {
        appointment.status = 'NO_SHOW';
        appointment.noShowAt = completedAt;
        appointment.noShowBy = null;
        appointment.noShowSource = 'SYSTEM';
      } else {
        appointment.status = 'COMPLETED';
        appointment.consultation = {
          ...(appointment.consultation || {}),
          status: 'COMPLETED',
          completedAt,
        };
      }
      appointment.updatedAt = completedAt;
    }
    if (pastAppointments.length) save();
    return pastAppointments.length;
  }

  const operation = pendingWrite.then(async () => {
    const completedAt = nowIso();
    const pastAppointments = state.appointments.filter((appointment) =>
      ['CONFIRMED', 'PATIENT_CHECKED_IN', 'IN_CONSULTATION'].includes(appointment.status) && isPastAppointmentTime(appointment.date, appointment.time24)
    );
    let changed = 0;

    for (const appointment of pastAppointments) {
      const isNoShow = appointment.status === 'CONFIRMED';
      const update = isNoShow
        ? { $set: { status: 'NO_SHOW', noShowAt: completedAt, noShowBy: null, noShowSource: 'SYSTEM', updatedAt: completedAt } }
        : { $set: { status: 'COMPLETED', 'consultation.status': 'COMPLETED', 'consultation.completedAt': completedAt, updatedAt: completedAt } };
      const result = await collections.appointments.updateOne(
        {
          appointmentId: appointment.appointmentId,
          status: appointment.status,
          date: appointment.date,
          time24: appointment.time24,
        },
        update
      );
      if (result.matchedCount && ['CONFIRMED', 'PATIENT_CHECKED_IN', 'IN_CONSULTATION'].includes(appointment.status)) {
        if (isNoShow) {
          Object.assign(appointment, { status: 'NO_SHOW', noShowAt: completedAt, noShowBy: null, noShowSource: 'SYSTEM' });
        } else {
          appointment.status = 'COMPLETED';
          appointment.consultation = { ...(appointment.consultation || {}), status: 'COMPLETED', completedAt };
        }
        appointment.updatedAt = completedAt;
        changed += 1;
      }
    }
    return changed;
  });
  pendingWrite = operation.catch((error) => {
    console.error('Could not process past appointments:', error.message);
  });
  return operation;
}

module.exports = {
  load,
  save,
  reset,
  connect,
  close,
  prunePastAvailableSlots,
  completePastAppointments,
  getCollection,
  isConnected,
  reserveSlot,
  allocateAppointmentNumber,
  allocatePatientNumber,
  allocateDoctorNumber,
  get data() {
    return load();
  },
};

const fs = require('fs');
const { MongoClient } = require('mongodb');
const config = require('../utils/config');
const { buildSeedData } = require('./seed');
const { todayInIndia } = require('../utils/helpers');

let state = null;
let client = null;
let collections = null;
let pendingWrite = Promise.resolve();

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
  if (!config.persist) return;
  if (collections) {
    // Keep the synchronous service layer; serialize snapshots so writes cannot
    // overtake one another while MongoDB performs the actual persistence.
    const snapshot = JSON.parse(JSON.stringify(state));
    pendingWrite = pendingWrite.then(async () => {
      for (const [key, collection] of Object.entries(collections)) {
        if (clearCollections) await collection.deleteMany({});
        const idField = key === 'doctors' ? 'doctorId' : key === 'patients' ? 'patientId' : key === 'appointments' ? 'appointmentId' : 'slotId';
        const docs = snapshot[key];
        if (docs.length) {
          await collection.bulkWrite(docs.map((doc) => ({
            updateOne: { filter: { [idField]: doc[idField] }, update: { $set: doc }, upsert: true },
          })), { ordered: true });
        }
      }
    }).catch((error) => console.error('Could not persist changes to MongoDB:', error.message));
    return;
  }
  // JSON persistence remains available for tests and local development.
  const configPath = config.dbPath;
  fs.mkdirSync(require('path').dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(state, null, 2));
}

function load() {
  if (state) return state;
  if (config.persist && fs.existsSync(config.dbPath)) {
    state = JSON.parse(fs.readFileSync(config.dbPath, 'utf8'));
  } else {
    state = buildSeedData();
    save();
  }
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
  const database = client.db(config.mongoDbName || undefined);
  collections = Object.fromEntries(Object.entries(collectionNames).map(([key, name]) => [key, database.collection(name)]));

  const legacy = config.persist && fs.existsSync(config.dbPath)
    ? JSON.parse(fs.readFileSync(config.dbPath, 'utf8'))
    : null;
  const data = {};
  for (const [key, collection] of Object.entries(collections)) {
    let docs = await collection.find({}).toArray();
    if (docs.length === 0 && legacy && Array.isArray(legacy[key]) && legacy[key].length) {
      await collection.insertMany(legacy[key]);
      docs = legacy[key];
      console.log(`Imported ${docs.length} ${key} from db.json into MongoDB.`);
    }
    data[key] = docs.map(withoutMongoId);
  }

  const seeded = buildSeedData();
  if (Object.values(data).every((items) => items.length === 0)) {
    state = seeded;
    save();
  } else {
    state = {
      doctors: data.doctors.length ? data.doctors : seeded.doctors,
      patients: data.patients.length ? data.patients : seeded.patients,
      slots: data.slots.length ? data.slots : seeded.slots,
      appointments: data.appointments.length ? data.appointments : seeded.appointments,
      meta: {
        nextPatientNumber: Math.max(0, ...data.patients.map((p) => Number(String(p.patientId).replace(/^PAT/, '')) || 0)) + 1,
        nextAppointmentNumber: Math.max(10000, ...data.appointments.map((a) => Number(String(a.appointmentId).replace(/^APT/, '')) || 0)) + 1,
      },
    };
    // If only some collections were empty, initialize those with seed records.
    save();
  }
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

module.exports = {
  load,
  save,
  reset,
  connect,
  close,
  prunePastAvailableSlots,
  get data() {
    return load();
  },
};

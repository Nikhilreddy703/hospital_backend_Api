const { ObjectId } = require('mongodb');
const db = require('../data/db');
const { errors } = require('../utils/errors');
const { nowIso, todayInIndia } = require('../utils/helpers');

const collection = () => db.getCollection('doctor_leaves');

async function isOnLeave(doctorId, date) {
  return Boolean(await collection().findOne({
    doctorId,
    status: 'ACTIVE',
    startDate: { $lte: date },
    endDate: { $gte: date },
  }));
}

function toView(leave) {
  const { _id, ...record } = leave;
  return { id: String(_id), ...record };
}

async function create(doctorId, input) {
  const doctor = db.data.doctors.find((item) => item.doctorId === doctorId);
  if (!doctor || doctor.isActive === false) throw errors.doctorNotFound(doctorId);
  const now = nowIso();
  const leave = {
    doctorId,
    ...input,
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
  };
  const overlapping = await collection().findOne({
    doctorId,
    status: 'ACTIVE',
    startDate: { $lte: input.endDate },
    endDate: { $gte: input.startDate },
  });
  if (overlapping) throw errors.leaveConflict();
  const result = await collection().insertOne(leave);

  const today = todayInIndia();
  if (input.startDate <= today && input.endDate >= today) {
    doctor.status = 'ON_LEAVE';
    doctor.updatedAt = now;
    await db.save();
  }
  return toView({ ...leave, _id: result.insertedId });
}

async function list(doctorId) {
  const leaves = await collection().find({ doctorId }).sort({ startDate: -1 }).toArray();
  return leaves.map(toView);
}

async function listActiveForAvailability(doctorId) {
  return collection().find({ doctorId, status: 'ACTIVE' }).toArray();
}

async function expirePastLeaves() {
  const today = todayInIndia();
  const expired = await collection().find({ status: 'ACTIVE', endDate: { $lt: today } }).toArray();
  if (!expired.length) return 0;
  const now = nowIso();
  for (const leave of expired) {
    await collection().updateOne({ _id: leave._id, status: 'ACTIVE' }, { $set: { status: 'EXPIRED', updatedAt: now } });
    const doctor = db.data.doctors.find((item) => item.doctorId === leave.doctorId);
    if (doctor?.status === 'ON_LEAVE') {
      doctor.status = doctor.availabilityStatus || 'AVAILABLE';
      doctor.updatedAt = now;
    }
  }
  await db.save();
  return expired.length;
}

async function cancel(doctorId, id) {
  if (!ObjectId.isValid(id)) throw errors.leaveNotFound();
  const leaves = collection();
  const leave = await leaves.findOne({ _id: new ObjectId(id), doctorId });
  if (!leave || leave.status !== 'ACTIVE') throw errors.leaveNotFound();
  const now = nowIso();
  await leaves.updateOne({ _id: leave._id, doctorId, status: 'ACTIVE' }, { $set: { status: 'CANCELLED', updatedAt: now } });

  const today = todayInIndia();
  if (leave.startDate <= today && leave.endDate >= today) {
    const doctor = db.data.doctors.find((item) => item.doctorId === doctorId);
    if (doctor) {
      doctor.status = doctor.availabilityStatus || 'AVAILABLE';
      doctor.updatedAt = now;
      await db.save();
    }
  }
  return toView({ ...leave, status: 'CANCELLED', updatedAt: now });
}

module.exports = { isOnLeave, create, list, listActiveForAvailability, expirePastLeaves, cancel };

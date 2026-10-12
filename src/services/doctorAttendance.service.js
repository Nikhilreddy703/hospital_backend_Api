const { ObjectId } = require('mongodb');
const db = require('../data/db');
const { errors } = require('../utils/errors');
const { nowIso, todayInIndia } = require('../utils/helpers');
const doctorLeaveService = require('./doctorLeave.service');

const collection = () => db.getCollection('doctor_attendance');

function doctorRecord(doctorId) {
  const doctor = db.data.doctors.find((item) => item.doctorId === doctorId);
  if (!doctor) throw errors.doctorNotFound(doctorId);
  if (doctor.isActive === false) throw errors.forbidden();
  return doctor;
}

function toView(record) {
  const { _id, ...value } = record;
  return { id: String(_id), ...value };
}

async function checkIn(doctorId) {
  const doctor = doctorRecord(doctorId);
  const today = todayInIndia();
  if (doctor.availabilityStatus !== 'AVAILABLE') throw errors.doctorUnavailable(doctor.name);
  if (await doctorLeaveService.isOnLeave(doctorId, today)) throw errors.doctorOnLeave();
  if (doctor.status === 'CHECKED_IN' || await collection().findOne({ doctorId, date: today, checkOutTime: null })) {
    throw errors.activeAttendanceExists();
  }

  const now = nowIso();
  const record = {
    _id: new ObjectId(),
    attendanceId: new ObjectId().toHexString(),
    doctorId,
    date: today,
    checkInTime: now,
    checkOutTime: null,
    status: 'CHECKED_IN',
    createdAt: now,
    updatedAt: now,
  };
  try {
    await collection().insertOne(record);
  } catch (error) {
    if (error.code === 11000) throw errors.activeAttendanceExists();
    throw error;
  }

  doctor.status = 'CHECKED_IN';
  doctor.updatedAt = now;
  try {
    await db.save();
  } catch (error) {
    await collection().deleteOne({ _id: record._id }).catch(() => {});
    doctor.status = doctor.availabilityStatus || 'AVAILABLE';
    throw error;
  }
  return toView(record);
}

async function checkOut(doctorId, nextStatus = 'AVAILABLE') {
  const doctor = doctorRecord(doctorId);
  const today = todayInIndia();
  if (db.data.appointments.some((appointment) =>
    appointment.doctorId === doctorId && appointment.status === 'IN_CONSULTATION'
  )) {
    throw errors.invalidAppointmentState('Complete the active consultation before checking out.');
  }
  const active = await collection().findOne({ doctorId, date: today, checkOutTime: null });
  if (!active) throw errors.noActiveAttendance();

  const now = nowIso();
  const result = await collection().updateOne(
    { _id: active._id, checkOutTime: null },
    { $set: { checkOutTime: now, status: 'CHECKED_OUT', updatedAt: now } }
  );
  if (!result.modifiedCount) throw errors.noActiveAttendance();

  const onLeave = await doctorLeaveService.isOnLeave(doctorId, today);
  doctor.status = onLeave ? 'ON_LEAVE' : nextStatus;
  doctor.updatedAt = now;
  if (onLeave) doctor.availabilityStatus = 'ON_LEAVE';
  else if (doctor.availabilityStatus === 'ON_LEAVE') doctor.availabilityStatus = 'AVAILABLE';
  await db.save();
  return { ...toView({ ...active, checkOutTime: now, status: 'CHECKED_OUT', updatedAt: now }), doctorStatus: doctor.status };
}

async function isCurrentlyCheckedIn(doctorId) {
  return Boolean(await collection().findOne({ doctorId, date: todayInIndia(), checkOutTime: null }));
}

async function list(doctorId, { date, page = 1, limit = 50 } = {}) {
  const filter = { doctorId };
  if (date) filter.date = date;
  const skip = (page - 1) * limit;
  const [records, total] = await Promise.all([
    collection().find(filter).sort({ date: -1, checkInTime: -1 }).skip(skip).limit(limit).toArray(),
    collection().countDocuments(filter),
  ]);
  return { count: total, page, limit, attendance: records.map(toView) };
}

async function updateStatus(doctorId, status) {
  const doctor = doctorRecord(doctorId);
  const today = todayInIndia();
  if (status === 'CHECKED_IN') {
    await checkIn(doctorId);
    return doctor;
  }
  const active = await collection().findOne({ doctorId, date: today, checkOutTime: null });
  if (active) {
    if (status === 'OFFLINE') return checkOut(doctorId, 'OFFLINE');
    throw errors.invalidAppointmentState('Check out before changing doctor status.');
  }
  if (status === 'ON_LEAVE' && !(await doctorLeaveService.isOnLeave(doctorId, today))) {
    throw errors.invalidAppointmentState('Create an active leave record before setting this status.');
  }
  if (status === 'AVAILABLE' && await doctorLeaveService.isOnLeave(doctorId, today)) throw errors.doctorOnLeave();
  doctor.status = status;
  if (status === 'AVAILABLE') doctor.availabilityStatus = 'AVAILABLE';
  if (status === 'ON_LEAVE') doctor.availabilityStatus = 'ON_LEAVE';
  doctor.updatedAt = nowIso();
  await db.save();
  return doctor;
}

module.exports = { checkIn, checkOut, isCurrentlyCheckedIn, list, updateStatus };

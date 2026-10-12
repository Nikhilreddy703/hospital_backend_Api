const db = require('../data/db');
const { STATUS } = require('../models/appointment.model');
const { errors } = require('../utils/errors');
const { todayInIndia } = require('../utils/helpers');
const appointmentService = require('./appointment.service');

function validateStatus(status) {
  if (status && !Object.values(STATUS).includes(String(status).toUpperCase())) {
    throw errors.validation([{ field: 'status', message: `status must be one of ${Object.values(STATUS).join(', ')}.` }]);
  }
  return status && String(status).toUpperCase();
}

function getDateRange(range) {
  const today = todayInIndia();
  if (range === 'today') return { startDate: today, endDate: today };
  if (range === 'week') {
    const start = new Date(`${today}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
    return { startDate: start.toISOString().slice(0, 10), endDate: today };
  }
  if (range === 'month') return { startDate: `${today.slice(0, 7)}-01`, endDate: today };
  throw errors.validation([{ field: 'range', message: 'range must be today, week, or month.' }]);
}

async function listAppointments(doctorId, filters = {}) {
  const status = validateStatus(filters.status);
  const query = { doctorId };
  if (filters.date) query.date = filters.date;
  if (status) query.status = status;
  const page = filters.page || 1;
  const limit = filters.limit || 50;
  const [records, total] = await Promise.all([
    db.getCollection('appointments').find(query)
      .sort({ date: 1, time24: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray(),
    db.getCollection('appointments').countDocuments(query),
  ]);
  return { count: total, page, limit, appointments: records.map(appointmentService.toView) };
}

async function todaysAppointments(doctorId) {
  return listAppointments(doctorId, { date: todayInIndia(), page: 1, limit: 100 });
}

async function checkIns(doctorId) {
  const records = await db.getCollection('appointments').find({
    doctorId,
    'patientCheckIn.status': 'CHECKED_IN',
  }).sort({ date: 1, time24: 1 }).toArray();
  return records.map((appointment) => {
    const patient = db.data.patients.find((item) => item.patientId === appointment.patientId) || {};
    return {
      appointmentId: appointment.appointmentId,
      patientId: appointment.patientId,
      patientName: patient.name || appointment.patientName || null,
      appointmentDate: appointment.date,
      appointmentTime: appointment.time,
      checkInTime: appointment.patientCheckIn.checkInTime,
      status: appointment.status,
    };
  });
}

async function analytics(doctorId, range = 'today') {
  const { startDate, endDate } = getDateRange(range);
  const match = { doctorId, date: { $gte: startDate, $lte: endDate } };
  const appointmentSummary = await db.getCollection('appointments').aggregate([
    { $match: match },
    { $group: {
      _id: null,
      totalAppointments: { $sum: 1 },
      completed: { $sum: { $cond: [{ $eq: ['$status', 'COMPLETED'] }, 1, 0] } },
      cancelled: { $sum: { $cond: [{ $eq: ['$status', 'CANCELLED'] }, 1, 0] } },
      checkedIn: { $sum: { $cond: [{ $eq: ['$patientCheckIn.status', 'CHECKED_IN'] }, 1, 0] } },
      pending: { $sum: { $cond: [{ $in: ['$status', ['CONFIRMED', 'PATIENT_CHECKED_IN', 'IN_CONSULTATION']] }, 1, 0] } },
    } },
  ]).toArray();
  const slotSummary = await db.getCollection('slots').aggregate([
    { $match: { doctorId, date: { $gte: startDate, $lte: endDate } } },
    { $group: {
      _id: null,
      totalSlots: { $sum: 1 },
      bookedSlots: { $sum: { $cond: [{ $eq: ['$status', 'BOOKED'] }, 1, 0] } },
      availableSlots: { $sum: { $cond: [{ $eq: ['$status', 'AVAILABLE'] }, 1, 0] } },
    } },
  ]).toArray();

  return {
    range,
    startDate,
    endDate,
    appointments: appointmentSummary[0] || { totalAppointments: 0, completed: 0, cancelled: 0, checkedIn: 0, pending: 0 },
    availability: slotSummary[0] || { totalSlots: 0, bookedSlots: 0, availableSlots: 0 },
  };
}

module.exports = { listAppointments, todaysAppointments, checkIns, analytics };

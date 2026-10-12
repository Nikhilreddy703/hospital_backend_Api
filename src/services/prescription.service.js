const { ObjectId } = require('mongodb');
const db = require('../data/db');
const { STATUS } = require('../models/appointment.model');
const { errors } = require('../utils/errors');
const { nowIso } = require('../utils/helpers');
const appointmentService = require('./appointment.service');

function toView(prescription) {
  if (!prescription) return null;
  const { _id, ...record } = prescription;
  return { id: String(_id), ...record };
}

async function create(appointmentId, doctorId, input) {
  const appointment = appointmentService.getAppointment(appointmentId);
  if (appointment.doctorId !== doctorId) throw errors.forbidden();
  const record = db.data.appointments.find((item) => item.appointmentId === appointment.appointmentId);
  if (![STATUS.IN_CONSULTATION, STATUS.COMPLETED].includes(record.status)) throw errors.prescriptionNotAllowed();
  const prescriptions = db.getCollection('prescriptions');
  if (await prescriptions.findOne({ appointmentId: record.appointmentId })) throw errors.prescriptionExists();

  const now = nowIso();
  const prescription = {
    _id: new ObjectId(),
    appointmentId: record.appointmentId,
    patientId: record.patientId,
    doctorId: record.doctorId,
    doctorName: appointment.doctor,
    diagnosis: input.diagnosis,
    notes: input.notes,
    medicines: input.medicines,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await prescriptions.insertOne(prescription);
  } catch (error) {
    if (error.code === 11000) throw errors.prescriptionExists();
    throw error;
  }
  record.prescriptionId = prescription._id.toHexString();
  record.updatedAt = now;
  await db.save();
  return toView(prescription);
}

async function getForAppointment(appointmentId) {
  const appointment = appointmentService.getAppointment(appointmentId);
  const record = await db.getCollection('prescriptions').findOne({ appointmentId: appointment.appointmentId });
  return toView(record);
}

module.exports = { create, getForAppointment, toView };

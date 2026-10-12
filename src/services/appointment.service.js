const db = require('../data/db');
const { errors } = require('../utils/errors');
const { nowIso, isPastDate } = require('../utils/helpers');
const { STATUS } = require('../models/appointment.model');
const doctorService = require('./doctor.service');
const patientService = require('./patient.service');
const slotService = require('./slot.service');

/** Shape returned to API consumers (hides internal fields such as time24). */
function toView(a) {
  const doctor = db.data.doctors.find((d) => d.doctorId === a.doctorId) || {};
  const patient = db.data.patients.find((p) => p.patientId === a.patientId) || {};
  const view = {
    appointmentId: a.appointmentId,
    status: a.status,
    patientId: a.patientId,
    patientName: patient.name,
    doctorId: a.doctorId,
    doctor: doctor.name,
    specialization: doctor.specialization,
    hospital: doctor.hospital,
    location: doctor.location,
    slotId: a.slotId,
    date: a.date,
    time: a.time,
    reason: a.reason,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
  if (a.status === STATUS.CANCELLED) {
    view.cancelledAt = a.cancelledAt;
    view.cancellationReason = a.cancellationReason;
  }
  return view;
}

function findAppointment(id) {
  const key = String(id).toUpperCase();
  if (!/^APT\d+$/.test(key)) throw errors.invalidAppointment(id);
  const appt = db.data.appointments.find((a) => a.appointmentId === key);
  if (!appt) throw errors.appointmentNotFound(key);
  return appt;
}

function assertDoctorAvailable(doctor) {
  if (doctor.availabilityStatus !== 'AVAILABLE') throw errors.doctorUnavailable(doctor.name);
}

/** POST /api/appointments : AVAILABLE -> BOOKED */
function book({ patientId, doctorId, slotId, date, time, reason }) {
  const doctor = doctorService.getDoctor(doctorId);
  const patient = patientService.getPatient(patientId);
  assertDoctorAvailable(doctor);
  const slot = slotId
    ? slotService.findSlotForDoctor(slotId, doctor.doctorId)
    : slotService.findSlotByDateTime(date, time, doctor.doctorId);
  if (isPastDate(slot.date)) throw errors.pastAppointmentDate();
  if (slot.status !== 'AVAILABLE') throw errors.slotAlreadyBooked();

  const now = nowIso();
  const appt = {
    appointmentId: `APT${db.data.meta.nextAppointmentNumber++}`,
    patientId: patient.patientId,
    doctorId: doctor.doctorId,
    slotId: slot.slotId,
    date: slot.date,
    time: slot.time,
    time24: slot.time24,
    reason,
    status: STATUS.CONFIRMED,
    createdAt: now,
    updatedAt: now,
  };
  slot.status = 'BOOKED';
  db.data.appointments.push(appt);
  db.save();
  return toView(appt);
}

const getAppointment = (id) => toView(findAppointment(id));

function getStatus(id) {
  const a = toView(findAppointment(id));
  return {
    appointmentId: a.appointmentId,
    status: a.status,
    doctor: a.doctor,
    specialization: a.specialization,
    date: a.date,
    time: a.time,
  };
}

/** DELETE /api/appointments/:id : BOOKED -> AVAILABLE */
function cancel(id, reason) {
  const appt = findAppointment(id);
  if (appt.status === STATUS.CANCELLED) throw errors.appointmentAlreadyCancelled(appt.appointmentId);

  const slot = db.data.slots.find((s) => s.slotId === appt.slotId);
  if (slot) slot.status = 'AVAILABLE';
  appt.status = STATUS.CANCELLED;
  appt.cancelledAt = nowIso();
  appt.cancellationReason = reason || 'Cancelled by patient';
  appt.updatedAt = appt.cancelledAt;
  db.save();
  return toView(appt);
}

/**
 * PUT /api/appointments/:id/reschedule
 * Validate everything first, then release the old slot, book the new one, update the appointment.
 */
function reschedule(id, { slotId, doctorId }) {
  const appt = findAppointment(id);
  if (appt.status === STATUS.CANCELLED) throw errors.appointmentAlreadyCancelled(appt.appointmentId);

  const doctor = doctorService.getDoctor(doctorId || appt.doctorId);
  assertDoctorAvailable(doctor);
  const newSlot = slotService.findSlotForDoctor(slotId, doctor.doctorId);
  if (isPastDate(newSlot.date)) throw errors.pastAppointmentDate();
  if (newSlot.slotId === appt.slotId) throw errors.sameSlot();
  if (newSlot.status !== 'AVAILABLE') throw errors.slotAlreadyBooked();

  const previous = { slotId: appt.slotId, doctorId: appt.doctorId, date: appt.date, time: appt.time };
  const oldSlot = db.data.slots.find((s) => s.slotId === appt.slotId);
  if (oldSlot) oldSlot.status = 'AVAILABLE';
  newSlot.status = 'BOOKED';
  Object.assign(appt, {
    doctorId: doctor.doctorId,
    slotId: newSlot.slotId,
    date: newSlot.date,
    time: newSlot.time,
    time24: newSlot.time24,
    updatedAt: nowIso(),
    rescheduleCount: (appt.rescheduleCount || 0) + 1,
  });
  db.save();
  return { appointment: toView(appt), previous };
}

/** GET /api/patients/:id/appointments?status=CONFIRMED|CANCELLED */
function listForPatient(patientId, status) {
  const patient = patientService.getPatient(patientId);
  if (status !== undefined && !Object.values(STATUS).includes(String(status).toUpperCase())) {
    throw errors.validation([{ field: 'status', message: `status must be one of ${Object.values(STATUS).join(', ')}.` }]);
  }
  return db.data.appointments
    .filter((a) => a.patientId === patient.patientId)
    .filter((a) => !status || a.status === String(status).toUpperCase())
    .sort((a, b) => a.date.localeCompare(b.date) || a.time24.localeCompare(b.time24))
    .map(toView);
}

/** Patient + appointment context (ready for a future human-agent handoff / agent assist). */
function getPatientContext(patientId) {
  const patient = patientService.getPatient(patientId);
  const all = listForPatient(patient.patientId);
  return {
    patient,
    confirmedAppointments: all.filter((a) => a.status === STATUS.CONFIRMED),
    cancelledAppointments: all.filter((a) => a.status === STATUS.CANCELLED),
  };
}

module.exports = { book, getAppointment, getStatus, cancel, reschedule, listForPatient, getPatientContext };

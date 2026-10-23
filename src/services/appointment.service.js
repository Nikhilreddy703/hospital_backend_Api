const db = require('../data/db');
const { errors } = require('../utils/errors');
const { nowIso, isPastDate } = require('../utils/helpers');
const { todayInIndia } = require('../utils/helpers');
const { STATUS } = require('../models/appointment.model');
const doctorService = require('./doctor.service');
const patientService = require('./patient.service');
const slotService = require('./slot.service');
const doctorLeaveService = require('./doctorLeave.service');
const doctorAttendanceService = require('./doctorAttendance.service');

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
    department: doctor.department,
    hospital: doctor.hospital,
    location: doctor.location,
    slotId: a.slotId,
    date: a.date,
    time: a.time,
    reason: a.reason,
    patientCheckIn: a.patientCheckIn || { status: 'NOT_CHECKED_IN', checkInTime: null },
    consultation: a.consultation || { status: 'NOT_STARTED', startedAt: null, completedAt: null },
    noShowAt: a.noShowAt || null,
    noShowBy: a.noShowBy || null,
    noShowSource: a.noShowSource || null,
    prescriptionId: a.prescriptionId || null,
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
  if (doctor.isActive === false || doctor.availabilityStatus !== 'AVAILABLE' || doctor.status === 'OFFLINE') {
    throw errors.doctorUnavailable(doctor.name);
  }
}

/** POST /api/appointments : AVAILABLE -> BOOKED */
async function book({ patientId, doctorId, slotId, date, time, reason }) {
  const doctor = doctorService.getDoctor(doctorId);
  const patient = patientService.getPatient(patientId);
  assertDoctorAvailable(doctor);
  await slotService.ensureDoctorSlots(doctor.doctorId);
  const slot = slotId
    ? slotService.findSlotForDoctor(slotId, doctor.doctorId)
    : slotService.findSlotByDateTime(date, time, doctor.doctorId);
  if (isPastDate(slot.date)) throw errors.pastAppointmentDate();
  if (await doctorLeaveService.isOnLeave(doctor.doctorId, slot.date)) throw errors.doctorOnLeave();
  if (slot.status !== 'AVAILABLE') throw errors.slotAlreadyBooked();

  if (db.isConnected() && !(await db.reserveSlot(slot.slotId, doctor.doctorId))) throw errors.slotAlreadyBooked();

  const now = nowIso();
  const appt = {
    appointmentId: `APT${await db.allocateAppointmentNumber()}`,
    patientId: patient.patientId,
    doctorId: doctor.doctorId,
    slotId: slot.slotId,
    date: slot.date,
    time: slot.time,
    time24: slot.time24,
    reason,
    status: STATUS.CONFIRMED,
    patientCheckIn: { status: 'NOT_CHECKED_IN', checkInTime: null },
    consultation: { status: 'NOT_STARTED', startedAt: null, completedAt: null },
    prescriptionId: null,
    createdAt: now,
    updatedAt: now,
  };
  slot.status = 'BOOKED';
  db.data.appointments.push(appt);
  try {
    await db.save();
  } catch (error) {
    db.data.appointments = db.data.appointments.filter((item) => item.appointmentId !== appt.appointmentId);
    slot.status = 'AVAILABLE';
    if (db.isConnected()) {
      await Promise.all([
        db.getCollection('slots').updateOne({ slotId: slot.slotId }, { $set: { status: 'AVAILABLE' } }),
        db.getCollection('appointments').deleteOne({ appointmentId: appt.appointmentId }),
      ]);
    }
    throw error;
  }
  return toView(appt);
}

const getAppointment = (id) => toView(findAppointment(id));

function getStatus(id) {
  const a = toView(findAppointment(id));
  return {
    appointmentId: a.appointmentId,
    status: a.status,
    doctor: a.doctor,
    doctorId: a.doctorId,
    specialization: a.specialization,
    date: a.date,
    time: a.time,
  };
}

async function checkIn(id) {
  const appointment = findAppointment(id);
  if (appointment.status === STATUS.CANCELLED || appointment.status === STATUS.COMPLETED || appointment.status === STATUS.NO_SHOW) {
    throw errors.invalidAppointmentState('This appointment cannot be checked in.');
  }
  if (appointment.patientCheckIn && appointment.patientCheckIn.status === 'CHECKED_IN') throw errors.duplicateCheckIn();
  if (appointment.date !== todayInIndia()) {
    throw errors.invalidAppointmentState('Patient check-in is available on the appointment date only.');
  }
  const checkedInAt = nowIso();
  appointment.patientCheckIn = { status: 'CHECKED_IN', checkInTime: checkedInAt };
  appointment.status = STATUS.PATIENT_CHECKED_IN;
  appointment.updatedAt = checkedInAt;
  await db.save();
  return toView(appointment);
}

async function startConsultation(id, doctorId) {
  const appointment = findAppointment(id);
  if (appointment.doctorId !== doctorId) throw errors.forbidden();
  if (appointment.status !== STATUS.PATIENT_CHECKED_IN || appointment.patientCheckIn?.status !== 'CHECKED_IN') {
    throw errors.notCheckedIn();
  }
  if (!(await doctorAttendanceService.isCurrentlyCheckedIn(doctorId))) {
    throw errors.invalidAppointmentState('Doctor must check in before starting a consultation.');
  }
  const startedAt = nowIso();
  appointment.status = STATUS.IN_CONSULTATION;
  appointment.consultation = { ...(appointment.consultation || {}), status: 'IN_CONSULTATION', startedAt, completedAt: null };
  appointment.updatedAt = startedAt;
  await db.save();
  return toView(appointment);
}

async function completeConsultation(id, doctorId) {
  const appointment = findAppointment(id);
  if (appointment.doctorId !== doctorId) throw errors.forbidden();
  if (appointment.status !== STATUS.IN_CONSULTATION) {
    throw errors.invalidAppointmentState('Only an in-consultation appointment can be completed.');
  }
  const completedAt = nowIso();
  appointment.status = STATUS.COMPLETED;
  appointment.consultation = { ...(appointment.consultation || {}), status: 'COMPLETED', completedAt };
  appointment.updatedAt = completedAt;
  await db.save();
  return toView(appointment);
}

/** DELETE /api/appointments/:id : BOOKED -> AVAILABLE */
async function cancel(id, reason) {
  const appt = findAppointment(id);
  if (appt.status === STATUS.CANCELLED) throw errors.appointmentAlreadyCancelled(appt.appointmentId);
  if (appt.status === STATUS.COMPLETED) throw errors.appointmentAlreadyCompleted(appt.appointmentId);
  if (appt.status === STATUS.NO_SHOW) throw errors.invalidAppointmentState('A no-show appointment cannot be cancelled.');
  if (appt.status === STATUS.IN_CONSULTATION) throw errors.invalidAppointmentState('An active consultation cannot be cancelled.');

  const slot = db.data.slots.find((s) => s.slotId === appt.slotId);
  if (slot) slot.status = 'AVAILABLE';
  appt.status = STATUS.CANCELLED;
  appt.cancelledAt = nowIso();
  appt.cancellationReason = reason || 'Cancelled by patient';
  appt.updatedAt = appt.cancelledAt;
  await db.save();
  return toView(appt);
}

/**
 * PUT /api/appointments/:id/reschedule
 * Validate everything first, then release the old slot, book the new one, update the appointment.
 */
async function reschedule(id, { slotId, doctorId }) {
  const appt = findAppointment(id);
  if (appt.status === STATUS.CANCELLED) throw errors.appointmentAlreadyCancelled(appt.appointmentId);
  if (appt.status === STATUS.COMPLETED) throw errors.appointmentAlreadyCompleted(appt.appointmentId);
  if (appt.status === STATUS.NO_SHOW) throw errors.invalidAppointmentState('A no-show appointment cannot be rescheduled.');
  if (appt.status === STATUS.PATIENT_CHECKED_IN || appt.status === STATUS.IN_CONSULTATION) {
    throw errors.invalidAppointmentState('A checked-in appointment cannot be rescheduled.');
  }

  const doctor = doctorService.getDoctor(doctorId || appt.doctorId);
  assertDoctorAvailable(doctor);
  const newSlot = slotService.findSlotForDoctor(slotId, doctor.doctorId);
  if (isPastDate(newSlot.date)) throw errors.pastAppointmentDate();
  if (await doctorLeaveService.isOnLeave(doctor.doctorId, newSlot.date)) throw errors.doctorOnLeave();
  if (newSlot.slotId === appt.slotId) throw errors.sameSlot();
  if (newSlot.status !== 'AVAILABLE') throw errors.slotAlreadyBooked();
  if (db.isConnected() && !(await db.reserveSlot(newSlot.slotId, doctor.doctorId))) throw errors.slotAlreadyBooked();

  const previous = { slotId: appt.slotId, doctorId: appt.doctorId, date: appt.date, time: appt.time };
  const oldSlot = db.data.slots.find((s) => s.slotId === appt.slotId);
  const priorAppointment = { ...appt };
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
  try {
    await db.save();
  } catch (error) {
    Object.assign(appt, priorAppointment);
    newSlot.status = 'AVAILABLE';
    if (oldSlot) oldSlot.status = 'BOOKED';
    if (db.isConnected()) {
      await Promise.all([
        db.getCollection('slots').updateOne({ slotId: newSlot.slotId }, { $set: { status: 'AVAILABLE' } }),
        oldSlot && db.getCollection('slots').updateOne({ slotId: oldSlot.slotId }, { $set: { status: 'BOOKED' } }),
        db.getCollection('appointments').updateOne({ appointmentId: appt.appointmentId }, { $set: priorAppointment }),
      ].filter(Boolean));
    }
    throw error;
  }
  return { appointment: toView(appt), previous };
}

/** GET /api/patients/:id/appointments?status=CONFIRMED|CANCELLED|COMPLETED */
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
    completedAppointments: all.filter((a) => a.status === STATUS.COMPLETED),
  };
}

async function listForDoctor(doctorId, { date, status, page = 1, limit = 50 } = {}) {
  const query = { doctorId };
  if (date) query.date = date;
  if (status) query.status = String(status).toUpperCase();
  const [records, count] = await Promise.all([
    db.getCollection('appointments').find(query).sort({ date: 1, time24: 1 }).skip((page - 1) * limit).limit(limit).toArray(),
    db.getCollection('appointments').countDocuments(query),
  ]);
  return { count, page, limit, appointments: records.map(toView) };
}

module.exports = {
  book,
  getAppointment,
  getStatus,
  cancel,
  reschedule,
  listForPatient,
  getPatientContext,
  listForDoctor,
  checkIn,
  startConsultation,
  completeConsultation,
  toView,
  findAppointment,
};

const db = require('../data/db');
const { errors } = require('../utils/errors');
const { nowIso, pad } = require('../utils/helpers');
const { validatePatient } = require('../models/patient.model');

function getPatient(id) {
  const key = String(id).toUpperCase();
  const patient = db.data.patients.find((p) => p.patientId === key);
  if (!patient) throw errors.patientNotFound(id);
  return patient;
}

function listPatients({ phone } = {}) {
  let result = db.data.patients;
  if (phone) result = result.filter((p) => p.phone === String(phone).trim());
  return result;
}

function createPatient(body) {
  const data = validatePatient(body);
  const meta = db.data.meta;
  const now = nowIso();
  const patient = {
    patientId: `PAT${pad(meta.nextPatientNumber++, 3)}`,
    email: null,
    ...data,
    createdAt: now,
    updatedAt: now,
  };
  db.data.patients.push(patient);
  db.save();
  return patient;
}

function updatePatient(id, body) {
  const patient = getPatient(id);
  const data = validatePatient(body, { partial: true });
  Object.assign(patient, data, { updatedAt: nowIso() });
  db.save();
  return patient;
}

module.exports = { getPatient, listPatients, createPatient, updatePatient };

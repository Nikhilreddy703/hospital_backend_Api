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

async function createPatient(body) {
  const data = validatePatient(body);
  const now = nowIso();
  const patient = {
    patientId: `PAT${pad(await db.allocatePatientNumber(), 3)}`,
    email: null,
    ...data,
    createdAt: now,
    updatedAt: now,
  };
  db.data.patients.push(patient);
  await db.save();
  return patient;
}

async function findOrCreateEmailPatient({ name, email }) {
  const normalizedEmail = email.trim().toLowerCase();
  const existing = db.data.patients.find((patient) => patient.email?.toLowerCase() === normalizedEmail);
  if (existing) return existing;
  const now = nowIso();
  const patient = {
    patientId: `PAT${pad(await db.allocatePatientNumber(), 3)}`,
    name: name.trim(), age: null, gender: null, phone: null, email: normalizedEmail,
    createdAt: now, updatedAt: now,
  };
  db.data.patients.push(patient);
  await db.save();
  return patient;
}

function updatePatient(id, body) {
  const patient = getPatient(id);
  const data = validatePatient(body, { partial: true });
  Object.assign(patient, data, { updatedAt: nowIso() });
  db.save();
  return patient;
}

module.exports = { getPatient, listPatients, createPatient, updatePatient, findOrCreateEmailPatient };

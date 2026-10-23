const db = require('../data/db');
const { errors } = require('../utils/errors');
const { normalize } = require('../utils/helpers');
const { nowIso } = require('../utils/helpers');
const hospital = require('../data/hospital');
const { validateDoctorProfile } = require('../models/doctor.model');

function publicDoctor(doctor) {
  const { passwordHash, email, phone, accountCreatedAt, ...record } = doctor;
  return record;
}

function countBy(key) {
  const map = new Map();
  for (const d of db.data.doctors) map.set(d[key], (map.get(d[key]) || 0) + 1);
  return [...map.entries()].map(([name, doctorCount]) => ({ name, doctorCount })).sort((a, b) => a.name.localeCompare(b.name));
}

const listSpecializations = () => countBy('specialization');
const listDepartments = () => countBy('department');

function getDoctor(id) {
  const key = String(id).toUpperCase();
  const doctor = db.data.doctors.find((d) => d.doctorId === key);
  if (!doctor) throw errors.doctorNotFound(id);
  return publicDoctor(doctor);
}

function findDoctors({ specialization, department, available, name } = {}) {
  let result = [...db.data.doctors];

  if (specialization !== undefined) {
    const valid = listSpecializations().map((s) => s.name);
    const key = normalize(specialization);
    if (!valid.some((v) => normalize(v) === key)) throw errors.invalidSpecialization(specialization, valid);
    result = result.filter((d) => normalize(d.specialization) === key);
  }
  if (department !== undefined) {
    const valid = listDepartments().map((s) => s.name);
    const key = normalize(department);
    if (!valid.some((v) => normalize(v) === key)) throw errors.invalidDepartment(department, valid);
    result = result.filter((d) => normalize(d.department) === key);
  }
  if (available === 'true') result = result.filter((d) =>
    d.availabilityStatus === 'AVAILABLE' && d.status !== 'OFFLINE' && d.status !== 'ON_LEAVE' && d.isActive !== false
  );
  if (name) result = result.filter((d) => normalize(d.name).includes(normalize(name)));
  return result.map(publicDoctor);
}

async function createDoctor(input = {}) {
  const profile = validateDoctorProfile(input);
  if (profile.email && db.data.doctors.some((doctor) => doctor.email?.toLowerCase() === profile.email)) {
    throw errors.conflict('DOCTOR_EMAIL_EXISTS', 'A doctor profile already uses this email address.');
  }
  const now = nowIso();
  const doctor = {
    doctorId: `DOC${String(await db.allocateDoctorNumber()).padStart(3, '0')}`,
    ...profile,
    status: profile.availabilityStatus,
    hospital: hospital.info.name,
    createdAt: now,
    updatedAt: now,
  };
  db.data.doctors.push(doctor);
  try {
    await db.save();
  } catch (error) {
    db.data.doctors = db.data.doctors.filter((item) => item.doctorId !== doctor.doctorId);
    if (error.code === 11000) throw errors.conflict('DOCTOR_EMAIL_EXISTS', 'A doctor profile already uses this email address.');
    throw error;
  }
  return { ...doctor };
}

module.exports = { getDoctor, findDoctors, listSpecializations, listDepartments, publicDoctor, createDoctor };

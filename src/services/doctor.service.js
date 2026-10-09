const db = require('../data/db');
const { errors } = require('../utils/errors');
const { normalize } = require('../utils/helpers');

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
  return doctor;
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
  if (available === 'true') result = result.filter((d) => d.availabilityStatus === 'AVAILABLE');
  if (name) result = result.filter((d) => normalize(d.name).includes(normalize(name)));
  return result;
}

module.exports = { getDoctor, findDoctors, listSpecializations, listDepartments };

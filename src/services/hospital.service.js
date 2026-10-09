const hospital = require('../data/hospital');
const doctorService = require('./doctor.service');
const db = require('../data/db');

const getInfo = () => hospital.info;
const getWorkingHours = () => hospital.workingHours;
const getEmergency = () => hospital.emergency;
const getContact = () => hospital.contact;

function getDepartments() {
  return hospital.departments.map((dep) => {
    const docs = db.data.doctors.filter((d) => d.department === dep.name);
    return {
      ...dep,
      doctorCount: docs.length,
      specializations: [...new Set(docs.map((d) => d.specialization))],
    };
  });
}

module.exports = { getInfo, getWorkingHours, getEmergency, getContact, getDepartments, doctorService };

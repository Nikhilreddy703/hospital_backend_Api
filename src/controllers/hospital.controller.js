const hospitalService = require('../services/hospital.service');

exports.info = (req, res) => res.json({ success: true, hospital: hospitalService.getInfo() });
exports.departments = (req, res) => {
  const departments = hospitalService.getDepartments();
  res.json({ success: true, count: departments.length, departments });
};
exports.workingHours = (req, res) => res.json({ success: true, workingHours: hospitalService.getWorkingHours() });
exports.emergency = (req, res) => res.json({ success: true, emergency: hospitalService.getEmergency() });
exports.contact = (req, res) => res.json({ success: true, contact: hospitalService.getContact() });

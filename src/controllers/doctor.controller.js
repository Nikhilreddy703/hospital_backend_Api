const doctorService = require('../services/doctor.service');
const slotService = require('../services/slot.service');

exports.list = (req, res) => {
  const doctors = doctorService.findDoctors(req.query);
  res.json({ success: true, count: doctors.length, doctors });
};

exports.get = (req, res) => {
  res.json({ success: true, doctor: doctorService.getDoctor(req.params.id) });
};

exports.slots = (req, res) => {
  res.json({ success: true, ...slotService.getDoctorSlots(req.params.id, req.query.date) });
};

exports.availableDates = (req, res) => {
  res.json({ success: true, ...slotService.getAvailableDates(req.params.id) });
};

exports.listSpecializations = (req, res) => {
  const specializations = doctorService.listSpecializations();
  res.json({ success: true, count: specializations.length, specializations });
};

exports.listDepartments = (req, res) => {
  const departments = doctorService.listDepartments();
  res.json({ success: true, count: departments.length, departments });
};

const doctorService = require('../services/doctor.service');
const doctorAuthService = require('../services/doctorAuth.service');
const doctorPortalService = require('../services/doctorPortal.service');
const doctorAttendanceService = require('../services/doctorAttendance.service');
const doctorLeaveService = require('../services/doctorLeave.service');
const slotService = require('../services/slot.service');
const {
  validateStatus,
  validateLeave,
  validateAppointmentFilters,
} = require('../models/doctorPortal.model');
const { asyncHandler } = require('../middleware/errorHandler');

const profile = (doctor) => ({
  doctorId: doctor.doctorId,
  name: doctor.name,
  email: doctor.email || null,
  phone: doctor.phone || null,
  specialization: doctor.specialization,
  department: doctor.department,
  doctorType: doctor.doctorType || doctor.specialization,
  experience: doctor.experience ?? doctor.experienceYears ?? 0,
  status: doctor.status || doctor.availabilityStatus || 'AVAILABLE',
  availabilityStatus: doctor.availabilityStatus,
  isActive: doctor.isActive !== false,
});

exports.register = asyncHandler(async (req, res) => {
  const doctor = await doctorAuthService.registerDoctor(req.body, req.get('x-doctor-registration-key'));
  res.status(201).json({ success: true, message: 'Doctor account registered successfully.', data: { doctor: profile(doctor) } });
});

exports.login = asyncHandler(async (req, res) => {
  const data = await doctorAuthService.login(req.body);
  res.json({ success: true, message: 'Login successful.', data });
});

exports.me = (req, res) => res.json({ success: true, data: { doctor: profile(req.doctor) } });

exports.updateMyStatus = asyncHandler(async (req, res) => {
  const doctor = await doctorAttendanceService.updateStatus(req.authDoctorId, validateStatus(req.body));
  res.json({ success: true, message: 'Doctor status updated.', data: { doctor: profile(doctor) } });
});

exports.checkIn = asyncHandler(async (req, res) => {
  const attendance = await doctorAttendanceService.checkIn(req.authDoctorId);
  res.status(201).json({ success: true, message: 'Doctor checked in successfully.', data: { status: 'CHECKED_IN', checkInTime: attendance.checkInTime, attendance } });
});

exports.checkOut = asyncHandler(async (req, res) => {
  const attendance = await doctorAttendanceService.checkOut(req.authDoctorId);
  res.json({ success: true, message: 'Doctor checked out successfully.', data: { status: attendance.doctorStatus, checkOutTime: attendance.checkOutTime, attendance } });
});

exports.attendance = asyncHandler(async (req, res) => {
  const filters = validateAppointmentFilters(req.query);
  const data = await doctorAttendanceService.list(req.authDoctorId, filters);
  res.json({ success: true, data });
});

exports.leave = asyncHandler(async (req, res) => {
  const leave = await doctorLeaveService.create(req.authDoctorId, validateLeave(req.body));
  res.status(201).json({ success: true, message: 'Doctor leave created.', data: leave });
});

exports.leaves = asyncHandler(async (req, res) => {
  const leaves = await doctorLeaveService.list(req.authDoctorId);
  res.json({ success: true, count: leaves.length, data: leaves });
});

exports.cancelLeave = asyncHandler(async (req, res) => {
  const leave = await doctorLeaveService.cancel(req.authDoctorId, req.params.id);
  res.json({ success: true, message: 'Doctor leave cancelled.', data: leave });
});

exports.myAvailability = asyncHandler(async (req, res) => {
  res.json({ success: true, ...await slotService.getAvailableDates(req.authDoctorId) });
});

exports.myAppointments = asyncHandler(async (req, res) => {
  const filters = validateAppointmentFilters(req.query);
  const data = await doctorPortalService.listAppointments(req.authDoctorId, filters);
  res.json({ success: true, data });
});

exports.todayAppointments = asyncHandler(async (req, res) => {
  const data = await doctorPortalService.todaysAppointments(req.authDoctorId);
  res.json({ success: true, data });
});

exports.myCheckIns = asyncHandler(async (req, res) => {
  const data = await doctorPortalService.checkIns(req.authDoctorId);
  res.json({ success: true, count: data.length, data });
});

exports.analytics = asyncHandler(async (req, res) => {
  const data = await doctorPortalService.analytics(req.authDoctorId, req.query.range || 'today');
  res.json({ success: true, data });
});

exports.list = (req, res) => {
  const doctors = doctorService.findDoctors(req.query);
  res.json({ success: true, count: doctors.length, doctors });
};

exports.get = (req, res) => {
  res.json({ success: true, doctor: doctorService.getDoctor(req.params.id) });
};

exports.slots = asyncHandler(async (req, res) => {
  res.json({ success: true, ...await slotService.getDoctorSlots(req.params.id, req.query.date) });
});

exports.availableDates = asyncHandler(async (req, res) => {
  res.json({ success: true, ...await slotService.getAvailableDates(req.params.id) });
});

exports.listSpecializations = (req, res) => {
  const specializations = doctorService.listSpecializations();
  res.json({ success: true, count: specializations.length, specializations });
};

exports.listDepartments = (req, res) => {
  const departments = doctorService.listDepartments();
  res.json({ success: true, count: departments.length, departments });
};

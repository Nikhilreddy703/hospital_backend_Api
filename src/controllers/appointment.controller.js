const appointmentService = require('../services/appointment.service');
const { validateBooking, validateReschedule } = require('../models/appointment.model');
const prescriptionService = require('../services/prescription.service');
const { validateAppointmentId, validatePrescription } = require('../models/doctorPortal.model');
const { asyncHandler } = require('../middleware/errorHandler');

exports.book = asyncHandler(async (req, res) => {
  const appointment = await appointmentService.book(validateBooking(req.body));
  res.status(201).json({ success: true, message: 'Appointment booked successfully.', ...appointment });
});

exports.get = asyncHandler(async (req, res) => {
  const appointment = appointmentService.getAppointment(req.params.id);
  if (req.authDoctorId && appointment.doctorId !== req.authDoctorId) {
    const { errors } = require('../utils/errors');
    throw errors.forbidden();
  }
  const prescription = await prescriptionService.getForAppointment(appointment.appointmentId);
  res.json({ success: true, ...appointment, prescription });
});

exports.status = (req, res, next) => {
  try {
    const appointment = appointmentService.getStatus(req.params.id);
    if (req.authDoctorId && appointment.doctorId !== req.authDoctorId) {
      const { errors } = require('../utils/errors');
      throw errors.forbidden();
    }
    res.json({ success: true, ...appointment });
  } catch (error) { next(error); }
};

exports.reschedule = asyncHandler(async (req, res) => {
  const { appointment, previous } = await appointmentService.reschedule(req.params.id, validateReschedule(req.body));
  res.json({
    success: true,
    message: 'Appointment rescheduled successfully.',
    ...appointment,
    rescheduledFrom: previous,
  });
});

exports.cancel = asyncHandler(async (req, res) => {
  const reason = req.query.reason || (req.body && req.body.reason);
  const appointment = await appointmentService.cancel(req.params.id, reason);
  res.json({ success: true, message: 'Appointment cancelled successfully.', ...appointment });
});

exports.checkIn = asyncHandler(async (req, res) => {
  if (req.staff) {
    const appointment = await require('../services/staffPortal.service').checkIn(validateAppointmentId(req.params.id), req.staff);
    return res.json({ success: true, message: 'Patient checked in successfully.', data: appointment });
  }
  const appointment = await appointmentService.checkIn(validateAppointmentId(req.params.id));
  res.json({
    success: true,
    message: 'Patient checked in successfully.',
    data: {
      appointmentId: appointment.appointmentId,
      status: appointment.status,
      checkInTime: appointment.patientCheckIn.checkInTime,
    },
  });
});

exports.staffCheckIn = asyncHandler(async (req,res)=>{
  const data=await require('../services/staffPortal.service').checkIn(validateAppointmentId(req.params.id),req.staff);
  res.json({success:true,message:'Patient checked in successfully.',data});
});

exports.noShow = asyncHandler(async(req,res)=>{
  const data=await require('../services/staffPortal.service').noShow(validateAppointmentId(req.params.id),req.staff,req.body?.confirmed);
  res.json({success:true,message:'Appointment marked no-show.',data});
});

exports.startConsultation = asyncHandler(async (req, res) => {
  const appointment = await appointmentService.startConsultation(validateAppointmentId(req.params.id), req.authDoctorId);
  res.json({ success: true, message: 'Consultation started.', data: appointment });
});

exports.completeConsultation = asyncHandler(async (req, res) => {
  const appointment = await appointmentService.completeConsultation(validateAppointmentId(req.params.id), req.authDoctorId);
  res.json({ success: true, message: 'Consultation completed.', data: appointment });
});

exports.addPrescription = asyncHandler(async (req, res) => {
  const appointment = appointmentService.getAppointment(validateAppointmentId(req.params.id));
  if (appointment.doctorId !== req.authDoctorId) {
    const { errors } = require('../utils/errors');
    throw errors.forbidden();
  }
  const prescription = await prescriptionService.create(
    validateAppointmentId(req.params.id), req.authDoctorId, validatePrescription(req.body)
  );
  res.status(201).json({ success: true, message: 'Prescription created.', data: prescription });
});

exports.getPrescription = asyncHandler(async (req, res) => {
  const id = validateAppointmentId(req.params.id);
  const appointment = appointmentService.getAppointment(id);
  if (req.authDoctorId && appointment.doctorId !== req.authDoctorId) {
    const { errors } = require('../utils/errors');
    throw errors.forbidden();
  }
  const prescription = await prescriptionService.getForAppointment(id);
  res.json({
    success: true,
    message: prescription ? 'Prescription retrieved.' : 'Prescription not available yet.',
    data: prescription,
  });
});

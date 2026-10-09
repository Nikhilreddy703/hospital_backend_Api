const appointmentService = require('../services/appointment.service');
const { validateBooking, validateReschedule } = require('../models/appointment.model');

exports.book = (req, res) => {
  const appointment = appointmentService.book(validateBooking(req.body));
  res.status(201).json({ success: true, message: 'Appointment booked successfully.', ...appointment });
};

exports.get = (req, res) => {
  res.json({ success: true, ...appointmentService.getAppointment(req.params.id) });
};

exports.status = (req, res) => {
  res.json({ success: true, ...appointmentService.getStatus(req.params.id) });
};

exports.reschedule = (req, res) => {
  const { appointment, previous } = appointmentService.reschedule(req.params.id, validateReschedule(req.body));
  res.json({
    success: true,
    message: 'Appointment rescheduled successfully.',
    ...appointment,
    rescheduledFrom: previous,
  });
};

exports.cancel = (req, res) => {
  const reason = req.query.reason || (req.body && req.body.reason);
  const appointment = appointmentService.cancel(req.params.id, reason);
  res.json({ success: true, message: 'Appointment cancelled successfully.', ...appointment });
};

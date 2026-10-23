const patientService = require('../services/patient.service');
const appointmentService = require('../services/appointment.service');
const { asyncHandler } = require('../middleware/errorHandler');

exports.create = asyncHandler(async (req, res) => {
  const patient = await patientService.createPatient(req.body);
  res.status(201).json({ success: true, message: 'Patient created successfully.', patient });
});

exports.list = (req, res) => {
  const patients = patientService.listPatients(req.query);
  res.json({ success: true, count: patients.length, patients });
};

exports.get = (req, res) => {
  res.json({ success: true, patient: patientService.getPatient(req.params.id) });
};

exports.update = (req, res) => {
  const patient = patientService.updatePatient(req.params.id, req.body);
  res.json({ success: true, message: 'Patient updated successfully.', patient });
};

exports.appointments = (req, res) => {
  const appointments = appointmentService.listForPatient(req.params.id, req.query.status);
  res.json({ success: true, patientId: req.params.id.toUpperCase(), count: appointments.length, appointments });
};

exports.context = (req, res) => {
  res.json({ success: true, ...appointmentService.getPatientContext(req.params.id) });
};

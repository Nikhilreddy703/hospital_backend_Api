const mailService = require('../../src/services/mail.service');

const otpByEmail = new Map();
let guestNumber = 0;

mailService.sendOtp = async (email, otp) => { otpByEmail.set(email, otp); };
mailService.sendAppointmentConfirmation = async () => {};
mailService.sendPrescription = async () => {};

async function book(request, app, db, { patientId, doctorId, slotId, reason = 'Automated test appointment' }) {
  const doctor = db.data.doctors.find((item) => item.doctorId === doctorId);
  const slot = db.data.slots.find((item) => item.slotId === slotId);
  const patient = db.data.patients.find((item) => item.patientId === patientId);
  const email = patient?.email || `guest-${++guestNumber}@example.test`;
  const details = {
    name: patient?.name || `Guest ${patientId || guestNumber}`,
    email,
    department: doctor?.department || 'Heart & Vascular',
    doctorName: doctor?.name || 'Unknown Doctor',
    date: slot?.date || '2099-01-01',
    time: slot?.time || '09:00 AM',
    reason,
  };
  const requested = await request(app).post('/api/appointments').send(details);
  if (requested.status !== 202) return requested;
  const otp = otpByEmail.get(email);
  return request(app).post('/api/appointments/confirm').send({ email, otp });
}

module.exports = { book };

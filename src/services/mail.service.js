const nodemailer = require('nodemailer');
const config = require('../utils/config');

function transport() {
  if (!config.smtpHost || !config.mailFrom) {
    throw new Error('Email is not configured. Set SMTP_HOST and MAIL_FROM.');
  }
  return nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth: config.smtpUser ? { user: config.smtpUser, pass: config.smtpPassword } : undefined,
  });
}

async function send(to, subject, text) {
  await transport().sendMail({ from: config.mailFrom, to, subject, text });
}

async function sendOtp(email, code) {
  await send(email, 'Your appointment verification code', `Your verification code is ${code}. It expires in 10 minutes. If you did not request an appointment, ignore this email.`);
}

async function sendAppointmentConfirmation(email, appointment) {
  await send(email, `Appointment confirmed: ${appointment.appointmentId}`, [
    `Hello ${appointment.patientName},`, '', 'Your appointment is confirmed.',
    `Appointment ID: ${appointment.appointmentId}`,
    `Doctor: ${appointment.doctor} (${appointment.department})`,
    `Date: ${appointment.date}`, `Time: ${appointment.time}`, '',
    'Please arrive before your appointment time.',
  ].join('\n'));
}

async function sendPrescription(email, appointment, prescription) {
  const medicines = (prescription.medicines || []).map((item) =>
    `- ${item.name}: ${item.dosage}; ${item.frequency}; ${item.duration}${item.instructions ? `; ${item.instructions}` : ''}`
  ).join('\n');
  await send(email, `Prescription for appointment ${appointment.appointmentId}`, [
    `Hello ${appointment.patientName},`, '',
    `Doctor: ${appointment.doctor}`, `Appointment: ${appointment.appointmentId}`,
    `Diagnosis: ${prescription.diagnosis}`, prescription.notes ? `Notes: ${prescription.notes}` : '',
    'Medicines:', medicines || 'No medicines listed.',
  ].filter(Boolean).join('\n'));
}

module.exports = { sendOtp, sendAppointmentConfirmation, sendPrescription };

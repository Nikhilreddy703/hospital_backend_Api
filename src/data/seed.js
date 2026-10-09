const fs = require('fs');
const path = require('path');
const config = require('../utils/config');
const { to12h } = require('../utils/helpers');

const HOSPITAL = 'CityCare Demo Hospital';

const doctors = [
  { doctorId: 'DOC001', name: 'Dr. Rahul Sharma', specialization: 'Cardiology', department: 'Heart & Vascular', experienceYears: 15, consultationFee: 1000, location: 'Block A, Floor 1, Room 101', availabilityStatus: 'AVAILABLE' },
  { doctorId: 'DOC002', name: 'Dr. Meera Nair', specialization: 'Cardiology', department: 'Heart & Vascular', experienceYears: 9, consultationFee: 800, location: 'Block A, Floor 1, Room 102', availabilityStatus: 'AVAILABLE' },
  { doctorId: 'DOC003', name: 'Dr. Arjun Reddy', specialization: 'Orthopedics', department: 'Bone & Joint', experienceYears: 12, consultationFee: 900, location: 'Block A, Floor 2, Room 201', availabilityStatus: 'AVAILABLE' },
  { doctorId: 'DOC004', name: 'Dr. Sneha Kapoor', specialization: 'Dermatology', department: 'Skin Care', experienceYears: 8, consultationFee: 700, location: 'Block A, Floor 2, Room 205', availabilityStatus: 'AVAILABLE' },
  { doctorId: 'DOC005', name: 'Dr. Vikram Singh', specialization: 'Neurology', department: 'Neurosciences', experienceYears: 18, consultationFee: 1200, location: 'Block B, Floor 1, Room 110', availabilityStatus: 'AVAILABLE' },
  { doctorId: 'DOC006', name: 'Dr. Ananya Iyer', specialization: 'Pediatrics', department: 'Women & Child Care', experienceYears: 10, consultationFee: 600, location: 'Block B, Floor 2, Room 215', availabilityStatus: 'AVAILABLE' },
  { doctorId: 'DOC007', name: 'Dr. Farhan Khan', specialization: 'General Medicine', department: 'Internal Medicine', experienceYears: 7, consultationFee: 500, location: 'Block A, Floor 3, Room 301', availabilityStatus: 'AVAILABLE' },
  { doctorId: 'DOC008', name: 'Dr. Kavita Menon', specialization: 'Gynecology', department: 'Women & Child Care', experienceYears: 14, consultationFee: 900, location: 'Block B, Floor 2, Room 218', availabilityStatus: 'AVAILABLE' },
  { doctorId: 'DOC009', name: 'Dr. Suresh Patel', specialization: 'ENT', department: 'ENT', experienceYears: 11, consultationFee: 700, location: 'Block B, Floor 3, Room 305', availabilityStatus: 'AVAILABLE' },
  { doctorId: 'DOC010', name: 'Dr. Priya Desai', specialization: 'Ophthalmology', department: 'Eye Care', experienceYears: 6, consultationFee: 650, location: 'Block B, Floor 3, Room 310', availabilityStatus: 'AVAILABLE' },
  { doctorId: 'DOC011', name: 'Dr. Rohan Mehta', specialization: 'Gastroenterology', department: 'Internal Medicine', experienceYears: 13, consultationFee: 1000, location: 'Block A, Floor 3, Room 308', availabilityStatus: 'AVAILABLE' },
  { doctorId: 'DOC012', name: 'Dr. Lakshmi Rao', specialization: 'Neurology', department: 'Neurosciences', experienceYears: 20, consultationFee: 1500, location: 'Block B, Floor 1, Room 112', availabilityStatus: 'ON_LEAVE' },
].map((d) => ({ ...d, currency: 'INR', hospital: HOSPITAL }));

const patients = [
  { patientId: 'PAT001', name: 'Aarav Demo', age: 34, gender: 'MALE', phone: '9000000001', email: 'aarav.demo@example.test' },
  { patientId: 'PAT002', name: 'Diya Sample', age: 28, gender: 'FEMALE', phone: '9000000002', email: 'diya.sample@example.test' },
  { patientId: 'PAT003', name: 'Kabir Test', age: 45, gender: 'MALE', phone: '9000000003', email: null },
  { patientId: 'PAT004', name: 'Isha Mock', age: 6, gender: 'FEMALE', phone: '9000000004', email: null },
  { patientId: 'PAT005', name: 'Rohit Example', age: 52, gender: 'MALE', phone: '9000000005', email: 'rohit.example@example.test' },
].map((p) => ({ ...p, createdAt: '2026-10-01T09:00:00.000Z', updatedAt: '2026-10-01T09:00:00.000Z' }));

const SLOT_TIMES = ['10:00', '10:30', '11:00', '11:30', '14:00', '14:30', '15:00', '15:30'];

const SAMPLE_APPOINTMENTS = [
  { patientId: 'PAT001', doctorId: 'DOC001', date: '2026-10-09', time24: '10:30', reason: 'Routine heart check-up' },
  { patientId: 'PAT002', doctorId: 'DOC003', date: '2026-10-08', time24: '11:00', reason: 'Knee pain' },
  { patientId: 'PAT003', doctorId: 'DOC004', date: '2026-10-09', time24: '14:00', reason: 'Skin rash' },
  { patientId: 'PAT001', doctorId: 'DOC007', date: '2026-10-12', time24: '10:00', reason: 'General check-up' },
  { patientId: 'PAT004', doctorId: 'DOC006', date: '2026-10-08', time24: '10:30', reason: 'Child fever', cancelled: true },
  { patientId: 'PAT005', doctorId: 'DOC005', date: '2026-10-13', time24: '15:00', reason: 'Recurring migraine' },
];

function buildSeedData() {
  // ---- slots: every available doctor, every day except Sunday ----
  const slots = [];
  let slotNo = 1;
  const start = new Date(`${config.seedStartDate}T00:00:00Z`);
  for (const doc of doctors) {
    if (doc.availabilityStatus !== 'AVAILABLE') continue; // doctors on leave get no slots
    for (let i = 0; i < config.seedDays; i++) {
      const day = new Date(start.getTime() + i * 86400000);
      if (day.getUTCDay() === 0) continue; // Sunday: no OPD
      const date = day.toISOString().slice(0, 10);
      for (const t of SLOT_TIMES) {
        slots.push({
          slotId: `S${String(slotNo++).padStart(4, '0')}`,
          doctorId: doc.doctorId,
          date,
          time: to12h(t),
          time24: t,
          status: 'AVAILABLE',
        });
      }
    }
  }

  // ---- sample appointments ----
  const appointments = [];
  let aptNo = 10001;
  for (const s of SAMPLE_APPOINTMENTS) {
    const slot = slots.find((x) => x.doctorId === s.doctorId && x.date === s.date && x.time24 === s.time24);
    if (!slot) continue; // seed window was changed, skip this sample
    const appt = {
      appointmentId: `APT${aptNo++}`,
      patientId: s.patientId,
      doctorId: s.doctorId,
      slotId: slot.slotId,
      date: slot.date,
      time: slot.time,
      time24: slot.time24,
      reason: s.reason,
      status: 'CONFIRMED',
      createdAt: '2026-10-05T09:00:00.000Z',
      updatedAt: '2026-10-05T09:00:00.000Z',
    };
    if (s.cancelled) {
      appt.status = 'CANCELLED';
      appt.cancelledAt = '2026-10-06T08:00:00.000Z';
      appt.cancellationReason = 'Patient request';
      // slot stays AVAILABLE
    } else {
      slot.status = 'BOOKED';
    }
    appointments.push(appt);
  }

  return {
    meta: { nextPatientNumber: patients.length + 1, nextAppointmentNumber: aptNo },
    doctors: JSON.parse(JSON.stringify(doctors)),
    patients: JSON.parse(JSON.stringify(patients)),
    slots,
    appointments,
  };
}

module.exports = { buildSeedData };

// `npm run seed` -> (re)generates the JSON database file
if (require.main === module) {
  const data = buildSeedData();
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  fs.writeFileSync(config.dbPath, JSON.stringify(data, null, 2));
  console.log(
    `Seeded ${config.dbPath}: ${data.doctors.length} doctors, ${data.slots.length} slots, ` +
      `${data.patients.length} patients, ${data.appointments.length} appointments.`
  );
}

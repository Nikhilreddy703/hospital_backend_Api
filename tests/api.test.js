process.env.NODE_ENV = 'test';
process.env.PERSIST_DB = 'false'; // keep the test database in memory only
const todayParts = new Intl.DateTimeFormat('en', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
}).formatToParts(new Date());
const todayValues = Object.fromEntries(todayParts.map(({ type, value }) => [type, value]));
const today = `${todayValues.year}-${todayValues.month}-${todayValues.day}`;
process.env.SEED_START_DATE = today;
process.env.SEED_DAYS = '35';
const testDateValue = new Date(`${today}T00:00:00Z`);
do { testDateValue.setUTCDate(testDateValue.getUTCDate() + 1); } while (testDateValue.getUTCDay() === 0);
const testDate = testDateValue.toISOString().slice(0, 10);
const sundayValue = new Date(`${today}T00:00:00Z`);
do { sundayValue.setUTCDate(sundayValue.getUTCDate() + 1); } while (sundayValue.getUTCDay() !== 0);
const sunday = sundayValue.toISOString().slice(0, 10);

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/data/db');
const { book: completeBooking } = require('./helpers/booking');

beforeEach(() => db.reset());

const getSlots = async (doctorId, date) =>
  (await request(app).get(`/api/doctors/${doctorId}/slots`).query({ date })).body.availableSlots;

const book = (patientId, doctorId, slotId) => completeBooking(request, app, db, { patientId, doctorId, slotId });

describe('Doctors', () => {
  test('lists at least 10 doctors', async () => {
    const res = await request(app).get('/api/doctors');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBeGreaterThanOrEqual(10);
  });

  test('filters by specialization (case-insensitive)', async () => {
    const res = await request(app).get('/api/doctors').query({ specialization: 'cardiology' });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    res.body.doctors.forEach((d) => expect(d.specialization).toBe('Cardiology'));
  });

  test('filters by department', async () => {
    const res = await request(app).get('/api/doctors').query({ department: 'Women & Child Care' });
    expect(res.body.count).toBe(2);
  });

  test('rejects an unknown specialization', async () => {
    const res = await request(app).get('/api/doctors').query({ specialization: 'Astrology' });
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('INVALID_SPECIALIZATION');
  });

  test('returns 404 for an unknown doctor', async () => {
    const res = await request(app).get('/api/doctors/DOC999');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, errorCode: 'DOCTOR_NOT_FOUND' });
  });

  test('lists specializations', async () => {
    const res = await request(app).get('/api/specializations');
    expect(res.body.specializations.map((s) => s.name)).toContain('Cardiology');
  });
});

describe('Slots', () => {
  test('returns available slots for a doctor and date', async () => {
    const res = await request(app).get('/api/doctors/DOC001/slots').query({ date: testDate });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ doctorId: 'DOC001', doctorName: 'Dr. Rahul Sharma', specialization: 'Cardiology', date: testDate });
    expect(res.body.availableSlots).toHaveLength(8);
    expect(res.body.availableSlots[0]).toMatchObject({ time: '10:00 AM', status: 'AVAILABLE' });
  });

  test('does not return already-booked slots', async () => {
    const [slot] = await getSlots('DOC001', testDate);
    await book('PAT001', 'DOC001', slot.slotId);
    const slots = await getSlots('DOC001', testDate);
    expect(slots).toHaveLength(7);
    expect(slots.map((s) => s.slotId)).not.toContain(slot.slotId);
  });

  test('returns no slots on a Sunday', async () => {
    expect(await getSlots('DOC001', sunday)).toHaveLength(0);
  });

  test('rejects an invalid date', async () => {
    const res = await request(app).get('/api/doctors/DOC001/slots').query({ date: '2026-13-45' });
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('INVALID_DATE');
  });
});

describe('Patients', () => {
  test('creates, reads and updates a patient', async () => {
    const created = await request(app)
      .post('/api/patients')
      .send({ name: 'Neha Demo', age: 30, gender: 'female', phone: '9000000099' });
    expect(created.status).toBe(201);
    const id = created.body.patient.patientId;
    expect(id).toMatch(/^PAT\d+$/);
    expect(created.body.patient.gender).toBe('FEMALE');

    const fetched = await request(app).get(`/api/patients/${id}`);
    expect(fetched.body.patient.name).toBe('Neha Demo');

    const updated = await request(app).put(`/api/patients/${id}`).send({ age: 31 });
    expect(updated.status).toBe(200);
    expect(updated.body.patient.age).toBe(31);
  });

  test('validates patient input', async () => {
    const res = await request(app).post('/api/patients').send({ name: 'X', age: -1, phone: '123' });
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    expect(res.body.details.length).toBeGreaterThanOrEqual(3);
  });

  test('returns 404 for an unknown patient', async () => {
    const res = await request(app).get('/api/patients/PAT999');
    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe('PATIENT_NOT_FOUND');
  });

  test('handles malformed JSON', async () => {
    const res = await request(app).post('/api/patients').set('Content-Type', 'application/json').send('{bad json');
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('INVALID_JSON');
  });
});

describe('Appointments', () => {
  test('books an appointment, marks the slot BOOKED and blocks double booking', async () => {
    const [slot] = await getSlots('DOC001', testDate);
    const res = await book('PAT001', 'DOC001', slot.slotId);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      success: true,
      status: 'CONFIRMED',
      doctor: 'Dr. Rahul Sharma',
      specialization: 'Cardiology',
      date: testDate,
      time: '10:00 AM',
    });
    expect(res.body.appointmentId).toMatch(/^APT\d+$/);

    expect((await getSlots('DOC001', testDate)).map((s) => s.slotId)).not.toContain(slot.slotId);

    const again = await book('PAT002', 'DOC001', slot.slotId);
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ success: false, errorCode: 'SLOT_ALREADY_BOOKED' });
  });

  test('validates doctor, patient and slot', async () => {
    const [slot] = await getSlots('DOC001', testDate);
    expect((await book('PAT001', 'DOC999', slot.slotId)).body.errorCode).toBe('DOCTOR_NOT_FOUND');
    expect((await book('PAT999', 'DOC001', slot.slotId)).status).toBe(201); // guest booking needs no existing patient account
    expect((await book('PAT001', 'DOC001', 'S9999')).body.errorCode).toBe('SLOT_NOT_FOUND');
    expect((await book('PAT001', 'DOC012', slot.slotId)).status).toBe(409); // doctor is on leave
    const missing = await request(app).post('/api/appointments').send({});
    expect(missing.status).toBe(400);
    expect(missing.body.errorCode).toBe('VALIDATION_ERROR');
  });

  test('cancelling releases the slot; cancelling twice returns 409', async () => {
    const [slot] = await getSlots('DOC001', testDate);
    const { body } = await book('PAT001', 'DOC001', slot.slotId);

    const cancelled = await request(app).delete(`/api/appointments/${body.appointmentId}`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('CANCELLED');
    expect((await getSlots('DOC001', testDate)).map((s) => s.slotId)).toContain(slot.slotId);

    const twice = await request(app).delete(`/api/appointments/${body.appointmentId}`);
    expect(twice.status).toBe(409);
    expect(twice.body.errorCode).toBe('APPOINTMENT_ALREADY_CANCELLED');
    const checkIn = await request(app).post(`/api/appointments/${body.appointmentId}/check-in`);
    expect(checkIn.status).toBe(409);

    const status = await request(app).get(`/api/appointments/${body.appointmentId}/status`);
    expect(status.body.status).toBe('CANCELLED');
  });

  test('rescheduling releases the old slot and books the new one', async () => {
    const [a, b] = await getSlots('DOC001', testDate);
    const { body } = await book('PAT001', 'DOC001', a.slotId);

    const res = await request(app).put(`/api/appointments/${body.appointmentId}/reschedule`).send({ slotId: b.slotId });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'CONFIRMED', time: b.time, slotId: b.slotId });
    expect(res.body.rescheduledFrom.slotId).toBe(a.slotId);

    const free = (await getSlots('DOC001', testDate)).map((s) => s.slotId);
    expect(free).toContain(a.slotId);
    expect(free).not.toContain(b.slotId);

    const same = await request(app).put(`/api/appointments/${body.appointmentId}/reschedule`).send({ slotId: b.slotId });
    expect(same.body.errorCode).toBe('SAME_SLOT');
  });

  test('cannot reschedule a cancelled appointment', async () => {
    const [slot] = await getSlots('DOC001', testDate);
    const booking = await book('PAT001', 'DOC001', slot.slotId);
    await request(app).delete(`/api/appointments/${booking.body.appointmentId}`);
    const res = await request(app).put(`/api/appointments/${booking.body.appointmentId}/reschedule`).send({ slotId: slot.slotId });
    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe('APPOINTMENT_ALREADY_CANCELLED');
  });

  test('lists a patient\'s appointments and validates appointment IDs', async () => {
    const list = await request(app).get('/api/patients/PAT001/appointments');
    expect(list.status).toBe(200);
    expect(list.body.count).toBe(db.data.appointments.filter((item) => item.patientId === 'PAT001').length);

    expect((await request(app).get('/api/appointments/XYZ')).body.errorCode).toBe('INVALID_APPOINTMENT');
    expect((await request(app).get('/api/appointments/APT99999')).status).toBe(404);
  });

  test('rejects booking a past slot ID', async () => {
    db.data.slots.push({ slotId: 'S9999', doctorId: 'DOC001', date: '2000-01-01', time: '10:00 AM', time24: '10:00', status: 'AVAILABLE' });
    const response = await book('PAT001', 'DOC001', 'S9999');
    expect(response.status).toBe(400);
    expect(response.body.errorCode).toBe('APPOINTMENT_DATE_IN_PAST');
  });
});

describe('Hospital', () => {
  test('returns hospital information', async () => {
    const res = await request(app).get('/api/hospital');
    expect(res.status).toBe(200);
    expect(res.body.hospital.name).toBe('CityCare Demo Hospital');
  });

  test('returns emergency, contact, hours and departments', async () => {
    for (const p of ['emergency', 'contact', 'working-hours', 'departments']) {
      expect((await request(app).get(`/api/hospital/${p}`)).status).toBe(200);
    }
  });

  test('unknown routes return a JSON 404', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe('ROUTE_NOT_FOUND');
  });
});

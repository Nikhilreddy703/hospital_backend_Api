process.env.NODE_ENV = 'test';
process.env.PERSIST_DB = 'false';
process.env.JWT_SECRET = 'test-only-secret-that-is-long-enough';
process.env.JWT_EXPIRES_IN = '1h';
process.env.DOCTOR_REGISTRATION_KEY = 'test-registration-key';

const todayParts = new Intl.DateTimeFormat('en', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
}).formatToParts(new Date());
const todayValues = Object.fromEntries(todayParts.map(({ type, value }) => [type, value]));
const today = `${todayValues.year}-${todayValues.month}-${todayValues.day}`;
process.env.SEED_START_DATE = today;
process.env.SEED_DAYS = '35';
const futureDateValue = new Date(`${today}T00:00:00Z`);
do { futureDateValue.setUTCDate(futureDateValue.getUTCDate() + 1); } while (futureDateValue.getUTCDay() === 0);
const futureDate = futureDateValue.toISOString().slice(0, 10);

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const db = require('../src/data/db');
const { book: completeBooking } = require('./helpers/booking');

const credentials = (doctorId, email) => ({
  doctorId,
  email,
  password: 'secure-test-password-123',
});

async function register(doctorId = 'DOC001', email = 'doctor.one@example.test') {
  return request(app).post('/api/doctors/register')
    .set('x-doctor-registration-key', process.env.DOCTOR_REGISTRATION_KEY)
    .send(credentials(doctorId, email));
}

async function login(email = 'doctor.one@example.test') {
  const response = await request(app).post('/api/doctors/login')
    .send({ email, password: 'secure-test-password-123' });
  return response.body.data.token;
}

function addTodaySlot(doctorId = 'DOC001', suffix = '1') {
  const slot = {
    slotId: `TST${doctorId.slice(-3)}${suffix}`,
    doctorId,
    date: today,
    time: '11:59 PM',
    time24: '23:59',
    status: 'AVAILABLE',
  };
  db.data.slots.push(slot);
  return slot;
}

const book = (doctorId, slotId, patientId = 'PAT001') => completeBooking(request, app, db, { doctorId, slotId, patientId, reason: 'Portal workflow test' });

beforeEach(() => db.reset());

describe('Doctor authentication and authorization', () => {
  test('requires the registration key, hashes credentials, and never returns the hash', async () => {
    const denied = await request(app).post('/api/doctors/register').send(credentials('DOC001', 'doctor.one@example.test'));
    expect(denied.status).toBe(403);

    const created = await register();
    expect(created.status).toBe(201);
    expect(created.body.data.doctor).not.toHaveProperty('passwordHash');
    expect(created.body.data.doctor).not.toHaveProperty('password');
    expect(db.data.doctors.find((doctor) => doctor.doctorId === 'DOC001').passwordHash).toMatch(/^\$2[aby]\$/);

    const duplicate = await register();
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.errorCode).toBe('DOCTOR_ACCOUNT_EXISTS');
  });

  test('logs in, returns only the doctor summary and protects the profile route', async () => {
    await register();
    const unauthorized = await request(app).get('/api/doctors/me');
    expect(unauthorized.status).toBe(401);

    const token = await login();
    const response = await request(app).get('/api/doctors/me').set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body.data.doctor).toMatchObject({ doctorId: 'DOC001', email: 'doctor.one@example.test' });
    expect(response.body.data.doctor).not.toHaveProperty('passwordHash');
    expect((await request(app).post('/api/doctors/login').send({ email: 'doctor.one@example.test', password: 'wrong-password' })).status).toBe(401);
    expect((await request(app).post('/api/doctors/login').send({ email: 'not-an-email', password: 'x' })).status).toBe(400);
    expect((await request(app).get('/api/doctors/me').set('Authorization', 'Bearer not-a-jwt')).status).toBe(401);
    const expired = jwt.sign({ role: 'doctor' }, process.env.JWT_SECRET, {
      subject: 'DOC001', expiresIn: -1, algorithm: 'HS256',
    });
    expect((await request(app).get('/api/doctors/me').set('Authorization', `Bearer ${expired}`)).status).toBe(401);
  });

  test('scopes appointments to the token owner even when a different doctorId is requested', async () => {
    await register('DOC001', 'doctor.one@example.test');
    const token = await login();
    const response = await request(app).get('/api/doctors/me/appointments')
      .query({ doctorId: 'DOC002' }).set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body.data.appointments.every((appointment) => appointment.doctorId === 'DOC001')).toBe(true);
  });

  test('status changes to CHECKED_IN create an attendance record and cannot be bypassed at checkout', async () => {
    await register();
    const token = await login();
    const response = await request(app).patch('/api/doctors/me/status')
      .set('Authorization', `Bearer ${token}`).send({ status: 'CHECKED_IN' });
    expect(response.status).toBe(200);
    expect(response.body.data.doctor.status).toBe('CHECKED_IN');
    expect((await request(app).patch('/api/doctors/me/status')
      .set('Authorization', `Bearer ${token}`).send({ status: 'AVAILABLE' })).status).toBe(409);
  });
});

describe('Doctor attendance, leave, and availability', () => {
  test('records check-in and check-out and prevents duplicate active attendance', async () => {
    await register();
    const token = await login();
    const first = await request(app).post('/api/doctors/me/check-in').set('Authorization', `Bearer ${token}`);
    expect(first.status).toBe(201);
    expect(first.body.data.attendance).toMatchObject({ doctorId: 'DOC001', date: today, status: 'CHECKED_IN' });
    expect((await request(app).post('/api/doctors/me/check-in').set('Authorization', `Bearer ${token}`)).status).toBe(409);

    const checkout = await request(app).post('/api/doctors/me/check-out').set('Authorization', `Bearer ${token}`);
    expect(checkout.status).toBe(200);
    expect(checkout.body.data.attendance.status).toBe('CHECKED_OUT');
    const history = await request(app).get('/api/doctors/me/attendance').set('Authorization', `Bearer ${token}`);
    expect(history.body.data.attendance).toHaveLength(1);
    expect((await request(app).post('/api/doctors/me/check-out').set('Authorization', `Bearer ${token}`)).status).toBe(409);
  });

  test('creates and cancels own leave, and prevents booking during leave', async () => {
    await register();
    const token = await login();
    const created = await request(app).post('/api/doctors/me/leave').set('Authorization', `Bearer ${token}`)
      .send({ startDate: futureDate, endDate: futureDate, reason: 'Personal appointment' });
    expect(created.status).toBe(201);
    const list = await request(app).get('/api/doctors/me/leave').set('Authorization', `Bearer ${token}`);
    expect(list.body.data[0]).toMatchObject({ doctorId: 'DOC001', startDate: futureDate, status: 'ACTIVE' });

    const [slot] = db.data.slots.filter((item) => item.doctorId === 'DOC001' && item.date === futureDate && item.status === 'AVAILABLE');
    expect((await book('DOC001', slot.slotId)).status).toBe(409);
    expect((await request(app).delete(`/api/doctors/me/leave/${created.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)).status).toBe(200);
    expect((await book('DOC001', slot.slotId)).status).toBe(201);
    const availability = await request(app).get('/api/doctors/me/availability').set('Authorization', `Bearer ${token}`);
    expect(availability.status).toBe(200);
    expect(availability.body.availableDates.some((item) => item.date === futureDate)).toBe(true);
  });

  test('does not let one doctor cancel another doctor’s leave', async () => {
    await register('DOC001', 'doctor.one@example.test');
    const tokenOne = await login();
    const leave = await request(app).post('/api/doctors/me/leave').set('Authorization', `Bearer ${tokenOne}`)
      .send({ startDate: futureDate, endDate: futureDate });
    await register('DOC002', 'doctor.two@example.test');
    const tokenTwo = await login('doctor.two@example.test');
    const response = await request(app).delete(`/api/doctors/me/leave/${leave.body.data.id}`)
      .set('Authorization', `Bearer ${tokenTwo}`);
    expect(response.status).toBe(404);
    expect(response.body.errorCode).toBe('LEAVE_NOT_FOUND');
  });
});

describe('Patient check-in and consultation workflow', () => {
  test('requires patient check-in and doctor attendance, then stores and retrieves a prescription', async () => {
    const slot = addTodaySlot();
    const booking = await book('DOC001', slot.slotId);
    expect(booking.status).toBe(201);
    const appointmentId = booking.body.appointmentId;
    await register();
    const token = await login();
    expect((await request(app).get(`/api/appointments/${appointmentId}/prescription`)).body.data).toBeNull();

    const early = await request(app).post(`/api/appointments/${appointmentId}/start-consultation`)
      .set('Authorization', `Bearer ${token}`);
    expect(early.status).toBe(409);
    await request(app).post(`/api/appointments/${appointmentId}/check-in`);
    expect((await request(app).post(`/api/appointments/${appointmentId}/check-in`)).status).toBe(409);
    expect((await request(app).post(`/api/appointments/${appointmentId}/start-consultation`)
      .set('Authorization', `Bearer ${token}`)).status).toBe(409);

    await request(app).post('/api/doctors/me/check-in').set('Authorization', `Bearer ${token}`);
    const started = await request(app).post(`/api/appointments/${appointmentId}/start-consultation`)
      .set('Authorization', `Bearer ${token}`);
    expect(started.status).toBe(200);
    expect(started.body.data.status).toBe('IN_CONSULTATION');

    const invalidPrescription = await request(app).post(`/api/appointments/${appointmentId}/prescription`)
      .set('Authorization', `Bearer ${token}`).send({ diagnosis: 'Test' });
    expect(invalidPrescription.status).toBe(400);

    const body = {
      diagnosis: 'Seasonal allergy', notes: 'Take with water',
      medicines: [
        { name: 'Cetirizine', dosage: '10 mg', frequency: 'Once daily', duration: '5 days' },
        { name: 'Saline spray', dosage: '2 sprays', frequency: 'Twice daily', duration: '7 days' },
      ],
    };
    const created = await request(app).post(`/api/appointments/${appointmentId}/prescription`)
      .set('Authorization', `Bearer ${token}`).send(body);
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ appointmentId, patientId: 'PAT001', doctorId: 'DOC001', diagnosis: body.diagnosis });
    expect(created.body.data.medicines).toHaveLength(2);
    expect(db.data.appointments.find((item) => item.appointmentId === appointmentId).prescriptionId).toBeTruthy();
    expect((await request(app).get(`/api/appointments/${appointmentId}/prescription`)).body.data.diagnosis).toBe(body.diagnosis);
    expect((await request(app).get(`/api/appointments/${appointmentId}`)).body.prescription.diagnosis).toBe(body.diagnosis);

    const completed = await request(app).post(`/api/appointments/${appointmentId}/complete`)
      .set('Authorization', `Bearer ${token}`);
    expect(completed.status).toBe(200);
    expect(completed.body.data.status).toBe('COMPLETED');
    expect((await request(app).post(`/api/appointments/${appointmentId}/prescription`)
      .set('Authorization', `Bearer ${token}`).send(body)).status).toBe(409);
  });

  test('enforces appointment ownership for consultations and prescription reads', async () => {
    const slot = db.data.slots.find((item) => item.doctorId === 'DOC002' && item.date === futureDate && item.status === 'AVAILABLE');
    const booking = await book('DOC002', slot.slotId);
    await register('DOC001', 'doctor.one@example.test');
    const token = await login();
    expect((await request(app).post(`/api/appointments/${booking.body.appointmentId}/complete`)
      .set('Authorization', `Bearer ${token}`)).status).toBe(403);
    expect((await request(app).post(`/api/appointments/${booking.body.appointmentId}/prescription`)
      .set('Authorization', `Bearer ${token}`).send({ diagnosis: 'X', medicines: [] })).status).toBe(403);
    expect((await request(app).get(`/api/appointments/${booking.body.appointmentId}/prescription`)
      .set('Authorization', `Bearer ${token}`)).status).toBe(403);
  });

  test('returns real appointment analytics and doctor-scoped check-ins', async () => {
    const slot = addTodaySlot();
    const booking = await book('DOC001', slot.slotId);
    await request(app).post(`/api/appointments/${booking.body.appointmentId}/check-in`);
    await register();
    const token = await login();
    const headers = { Authorization: `Bearer ${token}` };

    const todayList = await request(app).get('/api/doctors/me/appointments/today').set(headers);
    expect(todayList.body.data.appointments.some((item) => item.appointmentId === booking.body.appointmentId)).toBe(true);
    const checkIns = await request(app).get('/api/doctors/me/check-ins').set(headers);
    expect(checkIns.body.data.some((item) => item.appointmentId === booking.body.appointmentId)).toBe(true);
    const analytics = await request(app).get('/api/doctors/me/analytics?range=today').set(headers);
    expect(analytics.status).toBe(200);
    expect(analytics.body.data.appointments.totalAppointments).toBeGreaterThanOrEqual(1);
    expect(analytics.body.data.appointments.checkedIn).toBeGreaterThanOrEqual(1);
    expect((await request(app).get('/api/doctors/me/analytics?range=invalid').set(headers)).status).toBe(400);
  });

  test('marks appointments past their scheduled time completed with a completion timestamp', async () => {
    const appointment = db.data.appointments.find((item) => item.status === 'CONFIRMED') || {
      appointmentId: 'APTTESTPAST', patientId: 'PAT001', doctorId: 'DOC001', slotId: 'TESTPAST',
      date: '2000-01-01', time24: '10:00', status: 'CONFIRMED',
    };
    db.data.appointments = [appointment];
    appointment.date = '2000-01-01';
    appointment.time24 = '10:00';
    appointment.status = 'IN_CONSULTATION';
    appointment.consultation = { status: 'IN_CONSULTATION', startedAt: '2000-01-01T09:00:00.000Z', completedAt: null };
    const count = await db.completePastAppointments();
    expect(count).toBe(1);
    expect(appointment.status).toBe('COMPLETED');
    expect(appointment.consultation.status).toBe('COMPLETED');
    expect(appointment.consultation.completedAt).toBeTruthy();
  });

  test('marks unmodified confirmed appointments past their scheduled time as system no-shows', async () => {
    const appointment = {
      appointmentId: 'APTTESTNOSHOW', patientId: 'PAT001', doctorId: 'DOC001', slotId: 'TESTNOSHOW',
      date: '2000-01-01', time24: '10:00', status: 'CONFIRMED',
    };
    db.data.appointments = [appointment];
    const count = await db.completePastAppointments();
    expect(count).toBe(1);
    expect(appointment.status).toBe('NO_SHOW');
    expect(appointment.noShowAt).toBeTruthy();
    expect(appointment.noShowBy).toBeNull();
    expect(appointment.noShowSource).toBe('SYSTEM');
    expect(appointment.consultation).toBeUndefined();
  });
});

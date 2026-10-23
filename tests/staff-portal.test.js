process.env.NODE_ENV='test';
process.env.PERSIST_DB='false';
process.env.JWT_SECRET='staff-test-secret-that-is-long-enough';
process.env.STAFF_PROVISIONING_KEY='bootstrap-test-key';
process.env.DOCTOR_REGISTRATION_KEY='test-doctor-key';
process.env.HOSPITAL_TIMEZONE='Asia/Kolkata';
const request=require('supertest');
const app=require('../src/app');
const db=require('../src/data/db');
const { book: completeBooking }=require('./helpers/booking');
const today=require('../src/utils/helpers').todayInIndia();

beforeEach(()=>db.reset());
async function bootstrap(){
  const response=await request(app).post('/api/staff/auth/bootstrap-admin').set('x-staff-provisioning-key',process.env.STAFF_PROVISIONING_KEY).send({name:'Admin Person',email:'admin@example.test',password:'secure-staff-password-123',role:'ADMIN'});
  expect(response.status).toBe(201);return response.body.data.staff;
}
async function createStaff(role,email){
  const admin=await bootstrap();
  const login=await request(app).post('/api/staff/auth/login').send({email:admin.email,password:'secure-staff-password-123'});
  return request(app).post('/api/staff').set('Authorization',`Bearer ${login.body.data.token}`).send({name:'Reception Person',email,password:'secure-staff-password-456',role});
}
test('bootstraps only the first admin, hashes password, authenticates and gates admin routes',async()=>{
  const admin=await bootstrap();
  expect(admin).not.toHaveProperty('passwordHash');
  expect(db.getCollection('staff').findOne).toBeDefined();
  expect(db.data.meta.memoryCollections.staff[0].passwordHash).toMatch(/^\$2/);
  const second=await request(app).post('/api/staff/auth/bootstrap-admin').set('x-staff-provisioning-key',process.env.STAFF_PROVISIONING_KEY).send({name:'Other Admin',email:'other@example.test',password:'secure-staff-password-123',role:'ADMIN'});
  expect(second.status).toBe(409);
  const login=await request(app).post('/api/staff/auth/login').send({email:admin.email,password:'secure-staff-password-123'});
  expect(login.status).toBe(200);
  expect((await request(app).get('/api/admin/dashboard')).status).toBe(401);
  expect((await request(app).get('/api/admin/dashboard').set('Authorization',`Bearer ${login.body.data.token}`)).status).toBe(200);
});
test('reception check-in stores staff identity and leaves original doctor assignment intact',async()=>{
  const staffResponse=await createStaff('RECEPTION','reception@example.test');
  const login=await request(app).post('/api/staff/auth/login').send({email:'reception@example.test',password:'secure-staff-password-456'});
  const slot={slotId:'STAFFTESTSLOT',doctorId:'DOC001',date:today,time24:'23:59',time:'11:59 PM',status:'AVAILABLE'};db.data.slots.push(slot);
  const booking=await completeBooking(request,app,db,{patientId:'PAT001',doctorId:'DOC001',slotId:slot.slotId});
  expect(booking.status).toBe(201);
  const response=await request(app).post(`/api/appointments/${booking.body.appointmentId}/reception-check-in`).set('Authorization',`Bearer ${login.body.data.token}`);
  expect(response.status).toBe(200);
  expect(response.body.data.doctorId).toBe('DOC001');
  expect(response.body.data.patientCheckIn.staffId).toBe(staffResponse.body.data.staff.staffId);
});
test('no-show requires explicit confirmation and waits 30 minutes',async()=>{
  const staffResponse=await createStaff('RECEPTION','reception@example.test');
  const login=await request(app).post('/api/staff/auth/login').send({email:'reception@example.test',password:'secure-staff-password-456'});
  const a={appointmentId:'APT99991',patientId:'PAT001',doctorId:'DOC001',date:today,time24:'00:00',time:'12:00 AM',status:'CONFIRMED',patientCheckIn:{status:'NOT_CHECKED_IN'}};db.data.appointments.push(a);
  a.date=today;a.time24='00:00';
  const headers={Authorization:`Bearer ${login.body.data.token}`};
  expect((await request(app).post(`/api/appointments/${a.appointmentId}/no-show`).set(headers).send({confirmed:false})).status).toBe(400);
  const done=await request(app).post(`/api/appointments/${a.appointmentId}/no-show`).set(headers).send({confirmed:true});
  expect(done.status).toBe(200);expect(done.body.data.status).toBe('NO_SHOW');expect(done.body.data.noShowBy).toBe(staffResponse.body.data.staff.staffId);
});

test('creates idempotent slots for a restored doctor, excludes leave dates, and permits booking while checked in',async()=>{
  const doctor=db.data.doctors.find(d=>d.doctorId==='DOC012');
  doctor.availabilityStatus='AVAILABLE';doctor.status='CHECKED_IN';
  const leaveDateValue=new Date(`${today}T00:00:00Z`);leaveDateValue.setUTCDate(leaveDateValue.getUTCDate()+1);
  while(leaveDateValue.getUTCDay()===0)leaveDateValue.setUTCDate(leaveDateValue.getUTCDate()+1);
  const leaveDate=leaveDateValue.toISOString().slice(0,10);
  await db.getCollection('doctor_leaves').insertOne({doctorId:'DOC012',startDate:leaveDate,endDate:leaveDate,status:'ACTIVE'});
  await require('../src/services/slot.service').ensureDoctorSlots('DOC012');
  const first=await request(app).get('/api/doctors/DOC012/slots');
  expect(first.status).toBe(200);expect(first.body.totalAvailable).toBeGreaterThan(0);
  expect(db.data.slots.filter(s=>s.doctorId==='DOC012').every(s=>!Object.prototype.hasOwnProperty.call(s,'_id'))).toBe(true);
  const countBefore=db.data.slots.filter(s=>s.doctorId==='DOC012').length;
  await request(app).get('/api/doctors/DOC012/slots');
  expect(db.data.slots.filter(s=>s.doctorId==='DOC012')).toHaveLength(countBefore);
  const leaveSlots=await request(app).get('/api/doctors/DOC012/slots').query({date:leaveDate});
  expect(leaveSlots.body.totalAvailable).toBe(0);
  const slot=first.body.availableSlots.find(item=>item.date>today);
  const booked=await completeBooking(request,app,db,{patientId:'PAT001',doctorId:'DOC012',slotId:slot.slotId});
  expect(booked.status).toBe(201);expect(booked.body.doctorId).toBe('DOC012');
});

test('admin can reset all staff and doctor passwords; accounts must rotate temporary passwords',async()=>{
  const admin=await bootstrap();
  const firstLogin=await request(app).post('/api/staff/auth/login').send({email:admin.email,password:'secure-staff-password-123'});
  const adminHeaders={Authorization:`Bearer ${firstLogin.body.data.token}`};
  const staffCreated=await request(app).post('/api/staff').set(adminHeaders).send({name:'Reception User',email:'reset-reception@example.test',password:'secure-reception-password-123',role:'RECEPTION'});
  expect(staffCreated.status).toBe(201);
  const doctorCreated=await request(app).post('/api/doctors/register').set('x-doctor-registration-key',process.env.DOCTOR_REGISTRATION_KEY).send({doctorId:'DOC001',email:'reset-doctor@example.test',password:'secure-doctor-password-123'});
  expect(doctorCreated.status).toBe(201);
  const doctorOldToken=(await request(app).post('/api/doctors/login').send({email:'reset-doctor@example.test',password:'secure-doctor-password-123'})).body.data.token;

  const denied=await request(app).post('/api/admin/credentials/reset-all').set(adminHeaders).send({});
  expect(denied.status).toBe(400);
  const reset=await request(app).post('/api/admin/credentials/reset-all').set(adminHeaders).send({confirmation:'RESET_ALL_STAFF_AND_DOCTORS'});
  expect(reset.status).toBe(200);expect(reset.body.data.resetCount).toBe(3);
  expect((await request(app).get('/api/admin/dashboard').set(adminHeaders)).status).toBe(401);
  const credentialFor=(type,id)=>reset.body.data.credentials.find(c=>c.accountType===type&&c.identifier===id);

  const newAdmin=credentialFor('STAFF',admin.staffId);
  const adminTemp=await request(app).post('/api/staff/auth/login').send({email:newAdmin.email,password:newAdmin.temporaryPassword});
  expect(adminTemp.body.data.mustChangePassword).toBe(true);
  expect((await request(app).get('/api/admin/dashboard').set('Authorization',`Bearer ${adminTemp.body.data.token}`)).body.errorCode).toBe('PASSWORD_CHANGE_REQUIRED');
  const adminChanged=await request(app).post('/api/staff/auth/change-password').set('Authorization',`Bearer ${adminTemp.body.data.token}`).send({currentPassword:newAdmin.temporaryPassword,newPassword:'new-admin-password-123'});
  expect(adminChanged.status).toBe(200);
  expect((await request(app).get('/api/admin/dashboard').set('Authorization',`Bearer ${adminChanged.body.data.token}`)).status).toBe(200);

  const doctorCred=credentialFor('DOCTOR','DOC001');
  const doctorTemp=await request(app).post('/api/doctors/login').send({email:doctorCred.email,password:doctorCred.temporaryPassword});
  expect(doctorTemp.body.data.mustChangePassword).toBe(true);
  const blocked=await request(app).get('/api/doctors/me/appointments').set('Authorization',`Bearer ${doctorTemp.body.data.token}`);
  expect(blocked.body.errorCode).toBe('PASSWORD_CHANGE_REQUIRED');
  const doctorChanged=await request(app).post('/api/doctors/auth/change-password').set('Authorization',`Bearer ${doctorTemp.body.data.token}`).send({currentPassword:doctorCred.temporaryPassword,newPassword:'new-doctor-password-123'});
  expect(doctorChanged.status).toBe(200);
  expect((await request(app).get('/api/doctors/me/appointments').set('Authorization',`Bearer ${doctorChanged.body.data.token}`)).status).toBe(200);
  expect((await request(app).get('/api/doctors/me/appointments').set('Authorization',`Bearer ${doctorOldToken}`)).status).toBe(401);
},20000);

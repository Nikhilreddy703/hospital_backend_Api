const db = require('../data/db');
const config = require('../utils/config');
const { errors } = require('../utils/errors');
const { nowIso, isValidDate } = require('../utils/helpers');
const appointmentService = require('./appointment.service');
const prescriptionService = require('./prescription.service');
const { STATUS } = require('../models/appointment.model');

function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: config.hospitalTimezone }).format(new Date()); }
function timeFor(date, time) {
  const [h, m] = String(time || '').split(':').map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return NaN;
  const scheduled = new Date(`${date}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: config.hospitalTimezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(scheduled);
  const map = Object.fromEntries(parts.map(p => [p.type,p.value]));
  const offset = Date.UTC(+map.year,+map.month-1,+map.day,+map.hour,+map.minute) - scheduled.getTime();
  return new Date(scheduled.getTime() + h*3600000 + m*60000 - offset).getTime();
}
const patientOf = (id) => db.data.patients.find(p => p.patientId === id) || {};

async function listAppointments(query = {}) {
  const page = Math.max(1, Number(query.page) || 1), limit = Math.min(100, Math.max(1, Number(query.limit) || 50));
  const filter = {};
  if (query.date) { if (!isValidDate(query.date)) throw errors.validation([{ field: 'date', message: 'date must use YYYY-MM-DD.' }]); filter.date = query.date; }
  if (query.status) filter.status = String(query.status).toUpperCase();
  if (query.doctorId) filter.doctorId = String(query.doctorId).toUpperCase();
  if (query.appointmentId) filter.appointmentId = { $regex: String(query.appointmentId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  let records = await db.getCollection('appointments').find(filter).sort({ date: 1, time24: 1 }).toArray();
  if (query.patient) {
    const term = String(query.patient).toLowerCase();
    records = records.filter(a => String(a.patientId).toLowerCase().includes(term) || String(patientOf(a.patientId).name || '').toLowerCase().includes(term));
  }
  const total = records.length;
  return { count: total, page, limit, appointments: records.slice((page-1)*limit,page*limit).map(a => ({ ...appointmentService.toView(a), patient: { patientId: a.patientId, name: patientOf(a.patientId).name || null } })) };
}

async function checkIn(id, staff) {
  const a = appointmentService.findAppointment(id);
  if (a.patientCheckIn?.status === 'CHECKED_IN') return appointmentService.toView(a);
  if (a.status !== STATUS.CONFIRMED || a.date !== today()) throw errors.invalidAppointmentState('Only a confirmed appointment scheduled for today can be checked in.');
  const checkedAt = nowIso();
  const data = { status: 'CHECKED_IN', checkInTime: checkedAt, staffId: staff.staffId };
  const result = await db.getCollection('appointments').updateOne({ appointmentId: a.appointmentId, status: STATUS.CONFIRMED, 'patientCheckIn.status': { $ne: 'CHECKED_IN' } }, { $set: { status: STATUS.PATIENT_CHECKED_IN, patientCheckIn: data, updatedAt: checkedAt } });
  if (!result.matchedCount) throw errors.conflict('APPOINTMENT_STATE_CONFLICT', 'Appointment state changed; reload before retrying.');
  Object.assign(a, { status: STATUS.PATIENT_CHECKED_IN, patientCheckIn: data, updatedAt: checkedAt });
  const doctor = db.data.doctors.find(d => d.doctorId === a.doctorId);
  return { ...appointmentService.toView(a), warning: doctor && (doctor.status === 'ON_LEAVE' || doctor.status === 'OFFLINE') ? `Assigned doctor is currently ${doctor.status}; doctor assignment was preserved.` : null };
}

async function noShow(id, staff, confirmed) {
  if (confirmed !== true) throw errors.validation([{ field: 'confirmed', message: 'Explicit confirmation is required.' }]);
  const a = appointmentService.findAppointment(id);
  if (a.status !== STATUS.CONFIRMED || a.patientCheckIn?.status === 'CHECKED_IN') throw errors.invalidAppointmentState('This appointment is not eligible to be marked no-show.');
  if (Date.now() < timeFor(a.date, a.time24) + 30*60000) throw errors.conflict('NO_SHOW_TOO_EARLY', 'No-show is allowed only 30 minutes after the scheduled appointment time.');
  const at = nowIso();
  const update = await db.getCollection('appointments').updateOne({ appointmentId: a.appointmentId, status: STATUS.CONFIRMED, 'patientCheckIn.status': { $ne: 'CHECKED_IN' }, noShowAt: { $exists: false } }, { $set: { status: 'NO_SHOW', noShowAt: at, noShowBy: staff.staffId, noShowSource: 'RECEPTION', updatedAt: at } });
  if (!update.matchedCount) throw errors.conflict('APPOINTMENT_STATE_CONFLICT', 'Appointment state changed or it was already marked no-show.');
  Object.assign(a, { status: 'NO_SHOW', noShowAt: at, noShowBy: staff.staffId, noShowSource: 'RECEPTION', updatedAt: at });
  return appointmentService.toView(a);
}

async function dashboard() {
  const date = today();
  const appts = await db.getCollection('appointments').find({ date }).toArray();
  const count = status => appts.filter(a => a.status === status).length;
  const doctors = db.data.doctors.filter(d => d.isActive !== false);
  const availableSlots = await db.getCollection('slots').countDocuments({ date, status: 'AVAILABLE' });
  const bookedSlots = await db.getCollection('slots').countDocuments({ date, status: 'BOOKED' });
  return { date, appointments: { total: appts.length, pending: count(STATUS.CONFIRMED), confirmed: count(STATUS.CONFIRMED), checkedIn: count(STATUS.PATIENT_CHECKED_IN), waiting: count(STATUS.PATIENT_CHECKED_IN), inConsultation: count(STATUS.IN_CONSULTATION), completed: count(STATUS.COMPLETED), cancelled: count(STATUS.CANCELLED), noShow: count('NO_SHOW') }, doctors: { active: doctors.length, available: doctors.filter(d => (d.status || d.availabilityStatus) === 'AVAILABLE').length, consulting: new Set(appts.filter(a=>a.status===STATUS.IN_CONSULTATION).map(a=>a.doctorId)).size, onLeave: doctors.filter(d=>d.status==='ON_LEAVE').length, offline: doctors.filter(d=>d.status==='OFFLINE').length }, slots: { available: availableSlots, booked: bookedSlots } };
}

async function analytics(query = {}) {
  const start = query.startDate || today(), end = query.endDate || today();
  if (!isValidDate(start) || !isValidDate(end) || end < start) throw errors.validation([{ field: 'dateRange', message: 'Valid startDate and endDate are required.' }]);
  const match = { date: { $gte: start, $lte: end } };
  const appointments = db.getCollection('appointments');
  const [byStatus, byDoctor, bySpecialization, daily, slots] = await Promise.all([
    appointments.aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 } } }]).toArray(),
    appointments.aggregate([{ $match: match }, { $group: { _id: '$doctorId', count: { $sum: 1 } } }]).toArray(),
    appointments.aggregate([{ $match: match }, { $group: { _id: '$doctorId', count: { $sum: 1 } } }]).toArray(),
    appointments.aggregate([{ $match: match }, { $group: { _id: '$date', count: { $sum: 1 } } }, { $sort: { _id: 1 } }]).toArray(),
    db.getCollection('slots').aggregate([{ $match: { date: { $gte: start, $lte: end } } }, { $group: { _id: '$status', count: { $sum: 1 } } }]).toArray(),
  ]);
  const docs = new Map(db.data.doctors.map(d=>[d.doctorId,d]));
  const map = Object.fromEntries(byStatus.map(r=>[r._id,r.count]));
  const weekly={},monthly={};
  for(const item of daily){const d=new Date(`${item._id}T00:00:00Z`);const monday=new Date(d);monday.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));const week=monday.toISOString().slice(0,10);weekly[week]=(weekly[week]||0)+item.count;const month=item._id.slice(0,7);monthly[month]=(monthly[month]||0)+item.count;}
  return { startDate:start,endDate:end,byStatus,byDoctor:byDoctor.map(r=>({doctorId:r._id,doctor:docs.get(r._id)?.name||null,count:r.count})),bySpecialization:bySpecialization.reduce((out,r)=>{const spec=docs.get(r._id)?.specialization||'Unknown';out[spec]=(out[spec]||0)+r.count;return out;},{}),trends:{daily,weekly:Object.entries(weekly).map(([_id,count])=>({_id,count})),monthly:Object.entries(monthly).map(([_id,count])=>({_id,count}))},completed:map.COMPLETED||0,cancelled:map.CANCELLED||0,noShow:map.NO_SHOW||0,utilization:{slots:slots} };
}

async function completedAppointments(query={}) {
  const records = await db.getCollection('appointments').find({ status: STATUS.COMPLETED }).sort({date:-1,time24:-1}).toArray();
  const data=[];
  for(const a of records) {
    if(query.appointmentId&&!a.appointmentId.toLowerCase().includes(String(query.appointmentId).toLowerCase()))continue;
    const p=patientOf(a.patientId), d=db.data.doctors.find(x=>x.doctorId===a.doctorId)||{};
    if(query.patient&&!`${p.name||''} ${a.patientId}`.toLowerCase().includes(String(query.patient).toLowerCase()))continue;
    if(query.doctorId&&a.doctorId!==query.doctorId)continue;
    if(query.startDate&&a.date<query.startDate||query.endDate&&a.date>query.endDate)continue;
    const prescription=await prescriptionService.getForAppointment(a.appointmentId);
    if(query.prescriptionStatus==='ADDED'&&!prescription||query.prescriptionStatus==='MISSING'&&prescription)continue;
    data.push({ ...appointmentService.toView(a), patient:{patientId:a.patientId,name:p.name||null}, doctor:{doctorId:a.doctorId,name:d.name||null,specialization:d.specialization||null}, prescriptionStatus:prescription?'ADDED':'MISSING' });
  }
  return data;
}
async function medicalPrescription(id) { const a=appointmentService.findAppointment(id); if(a.status!==STATUS.COMPLETED)throw errors.invalidAppointmentState('Prescription lookup is available only for completed appointments.'); return prescriptionService.getForAppointment(id); }

module.exports={listAppointments,checkIn,noShow,dashboard,analytics,completedAppointments,medicalPrescription};

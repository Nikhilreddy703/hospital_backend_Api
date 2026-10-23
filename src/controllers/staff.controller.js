const auth = require('../services/staffAuth.service');
const portal = require('../services/staffPortal.service');
const db = require('../data/db');
const { asyncHandler } = require('../middleware/errorHandler');
const { errors } = require('../utils/errors');
const doctorLeave = require('../services/doctorLeave.service');

exports.login = asyncHandler(async (req,res)=>res.json({success:true,message:'Login successful.',data:await auth.login(req.body)}));
exports.changePassword = asyncHandler(async(req,res)=>res.json({success:true,message:'Password changed. Sign in again with the new password.',data:await auth.changePassword(req.staff.staffId,req.body?.currentPassword,req.body?.newPassword)}));
exports.me = (req,res)=>res.json({success:true,data:{staff:req.staff}});
exports.logout = (req,res)=>res.json({success:true,message:'Logged out. Remove the bearer token from the client.'});
exports.bootstrap = asyncHandler(async(req,res)=>res.status(201).json({success:true,message:'Initial administrator created.',data:{staff:await auth.create(req.body,req.get('x-staff-provisioning-key'),null,true)}}));
exports.create = asyncHandler(async(req,res)=>res.status(201).json({success:true,message:'Staff account created.',data:{staff:await auth.create(req.body,null,req.staff)}}));
exports.resetAllCredentials = asyncHandler(async(req,res)=>{
  const data=await require('../services/credentialReset.service').resetAll(req.body?.confirmation);
  res.json({success:data.failedCount===0,message:data.failedCount?'Some accounts could not be reset.':'Temporary credentials were generated; each account must change its password at next sign-in.',data});
});
exports.list = asyncHandler(async(req,res)=>{const staff=await db.getCollection('staff').find({}).sort({createdAt:-1}).toArray();res.json({success:true,count:staff.length,data:staff.map(auth.safe)});});
exports.dashboard = asyncHandler(async(req,res)=>res.json({success:true,data:await portal.dashboard()}));
exports.analytics = asyncHandler(async(req,res)=>res.json({success:true,data:await portal.analytics(req.query)}));
exports.appointments = asyncHandler(async(req,res)=>res.json({success:true,data:await portal.listAppointments(req.query)}));
exports.doctors = (req,res)=>res.json({success:true,count:db.data.doctors.length,data:db.data.doctors.map(d=>({doctorId:d.doctorId,name:d.name,email:d.email||null,phone:d.phone||null,doctorType:d.doctorType||d.specialization,specialization:d.specialization,department:d.department,experienceYears:d.experienceYears??d.experience??0,consultationFee:d.consultationFee??null,currency:d.currency||'INR',location:d.location||null,status:d.status||d.availabilityStatus,isActive:d.isActive!==false}))});
exports.createDoctor = asyncHandler(async(req,res)=>{
  const doctor=await require('../services/doctor.service').createDoctor(req.body);
  if(doctor.availabilityStatus==='AVAILABLE') await require('../services/slot.service').ensureDoctorSlots(doctor.doctorId);
  res.status(201).json({success:true,message:'Doctor profile created successfully.',data:{doctor}});
});
exports.availability = asyncHandler(async(req,res)=>{const date=req.query.date||new Intl.DateTimeFormat('en-CA',{timeZone:require('../utils/config').hospitalTimezone}).format(new Date());const doctors=db.data.doctors.map(d=>({doctorId:d.doctorId,name:d.name,status:d.status||d.availabilityStatus,slots:db.data.slots.filter(s=>s.doctorId===d.doctorId&&s.date===date)}));res.json({success:true,date,data:doctors});});
exports.onLeave = asyncHandler(async(req,res)=>{const docs=await Promise.all(db.data.doctors.map(async d=>({doctorId:d.doctorId,name:d.name,leaves:await doctorLeave.list(d.doctorId)})));res.json({success:true,data:docs.flatMap(d=>d.leaves.filter(l=>l.status==='ACTIVE').map(leave=>({...leave,doctorId:d.doctorId,doctor:d.name})))});});
exports.createLeave = asyncHandler(async(req,res)=>{const {doctorId,startDate,endDate,reason}=req.body||{};if(typeof doctorId!=='string'||!startDate||!endDate||startDate>endDate)throw errors.validation([{field:'leave',message:'doctorId, startDate and endDate are required.'}]);const conflicts=await db.getCollection('appointments').find({doctorId,date:{$gte:startDate,$lte:endDate},status:{$in:['CONFIRMED','PATIENT_CHECKED_IN','IN_CONSULTATION']}}).toArray();if(conflicts.length)return res.status(409).json({success:false,errorCode:'LEAVE_APPOINTMENT_CONFLICT',message:'Leave conflicts with existing appointments; review before approving.',data:{conflictingAppointments:conflicts.map(a=>({appointmentId:a.appointmentId,doctorId:a.doctorId,date:a.date,time:a.time,status:a.status}))}});res.status(201).json({success:true,data:await doctorLeave.create(doctorId,{startDate,endDate,reason:reason||null})});});
exports.checkIn = asyncHandler(async(req,res)=>res.json({success:true,message:'Patient checked in.',data:await portal.checkIn(req.params.id,req.staff)}));
exports.noShow = asyncHandler(async(req,res)=>res.json({success:true,message:'Appointment marked no-show.',data:await portal.noShow(req.params.id,req.staff,req.body?.confirmed)}));
exports.completed = asyncHandler(async(req,res)=>res.json({success:true,data:await portal.completedAppointments(req.query)}));
exports.prescription = asyncHandler(async(req,res)=>{const data=await portal.medicalPrescription(req.params.appointmentId);res.json({success:true,message:data?'Prescription retrieved.':'Prescription not added.',data});});

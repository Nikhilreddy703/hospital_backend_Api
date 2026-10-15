const r=require('express').Router(),c=require('../controllers/staff.controller');
const {authenticateStaff,allowRoles}=require('../middleware/authenticateStaff');
r.use(authenticateStaff,allowRoles('ADMIN'));
r.post('/credentials/reset-all',c.resetAllCredentials);
r.get('/dashboard',c.dashboard);r.get('/analytics',c.analytics);r.get('/appointments',c.appointments);r.get('/doctors',c.doctors);r.get('/doctors/availability',c.availability);r.get('/doctors/on-leave',c.onLeave);r.get('/staff',c.list);r.post('/doctors/:doctorId/leave', (req,res,next)=>{req.body.doctorId=req.params.doctorId;next();},c.createLeave);
module.exports=r;

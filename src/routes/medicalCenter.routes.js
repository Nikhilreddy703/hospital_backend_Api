const r=require('express').Router(),c=require('../controllers/staff.controller');
const {authenticateStaff,allowRoles}=require('../middleware/authenticateStaff');
r.use(authenticateStaff,allowRoles('MEDICAL_CENTER','ADMIN'));
r.get('/completed-appointments',c.completed);r.get('/appointments/:appointmentId/prescription',c.prescription);
module.exports=r;

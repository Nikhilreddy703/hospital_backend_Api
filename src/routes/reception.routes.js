const r=require('express').Router(),c=require('../controllers/staff.controller');
const {authenticateStaff,allowRoles}=require('../middleware/authenticateStaff');
r.use(authenticateStaff,allowRoles('RECEPTION','ADMIN'));
r.get('/appointments',c.appointments);
module.exports=r;

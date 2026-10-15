const r=require('express').Router(),c=require('../controllers/staff.controller');
const {authenticateStaff,allowRoles}=require('../middleware/authenticateStaff');
r.post('/auth/login',c.login);r.post('/auth/bootstrap-admin',c.bootstrap);
r.get('/me',authenticateStaff,c.me);r.post('/auth/logout',authenticateStaff,c.logout);
r.post('/',authenticateStaff,allowRoles('ADMIN'),c.create);
module.exports=r;

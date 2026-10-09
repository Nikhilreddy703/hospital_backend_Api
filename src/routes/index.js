const router = require('express').Router();
const doctorController = require('../controllers/doctor.controller');

router.get('/specializations', doctorController.listSpecializations);
router.get('/departments', doctorController.listDepartments);

router.use('/doctors', require('./doctor.routes'));
router.use('/patients', require('./patient.routes'));
router.use('/appointments', require('./appointment.routes'));
router.use('/hospital', require('./hospital.routes'));

module.exports = router;

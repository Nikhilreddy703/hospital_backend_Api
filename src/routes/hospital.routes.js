const router = require('express').Router();
const c = require('../controllers/hospital.controller');
const doctorController = require('../controllers/doctor.controller');

router.get('/', c.info);
router.get('/departments', c.departments);
router.get('/working-hours', c.workingHours);
router.get('/emergency', c.emergency);
router.get('/contact', c.contact);
router.get('/doctors', doctorController.list); // alias of GET /api/doctors

module.exports = router;

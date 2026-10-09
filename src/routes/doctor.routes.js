const router = require('express').Router();
const c = require('../controllers/doctor.controller');

router.get('/', c.list);
router.get('/:id', c.get);
router.get('/:id/slots', c.slots);
router.get('/:id/available-dates', c.availableDates);

module.exports = router;

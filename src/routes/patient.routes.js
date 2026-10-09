const router = require('express').Router();
const c = require('../controllers/patient.controller');

router.post('/', c.create);
router.get('/', c.list);
router.get('/:id', c.get);
router.put('/:id', c.update);
router.get('/:id/appointments', c.appointments);
router.get('/:id/context', c.context);

module.exports = router;

const router = require('express').Router();
const c = require('../controllers/appointment.controller');
const authenticateDoctor = require('../middleware/authenticateDoctor');
const optionalAuthenticateDoctor = authenticateDoctor.optionalAuthenticateDoctor;

router.post('/', c.book);
router.post('/:id/check-in', c.checkIn);
router.post('/:id/start-consultation', authenticateDoctor, c.startConsultation);
router.post('/:id/complete', authenticateDoctor, c.completeConsultation);
router.post('/:id/prescription', authenticateDoctor, c.addPrescription);
router.get('/:id/prescription', optionalAuthenticateDoctor, c.getPrescription);
router.get('/:id', optionalAuthenticateDoctor, c.get);
router.get('/:id/status', optionalAuthenticateDoctor, c.status);
router.put('/:id/reschedule', c.reschedule);
router.delete('/:id', c.cancel);

module.exports = router;

const router = require('express').Router();
const c = require('../controllers/appointment.controller');
const authenticateDoctor = require('../middleware/authenticateDoctor');
const optionalAuthenticateDoctor = authenticateDoctor.optionalAuthenticateDoctor;
const { authenticateStaff, allowRoles, optionalStaff } = require('../middleware/authenticateStaff');

router.post('/', c.book);
router.post('/:id/check-in', optionalStaff, (req,res,next)=>req.staff && req.staffRole!=='RECEPTION' ? next(require('../utils/errors').errors.forbidden()) : c.checkIn(req,res,next));
router.post('/:id/reception-check-in', authenticateStaff, allowRoles('RECEPTION'), c.staffCheckIn);
router.post('/:id/no-show', authenticateStaff, allowRoles('RECEPTION'), c.noShow);
router.post('/:id/start-consultation', authenticateDoctor, c.startConsultation);
router.post('/:id/complete', authenticateDoctor, c.completeConsultation);
router.post('/:id/prescription', authenticateDoctor, c.addPrescription);
router.get('/:id/prescription', optionalAuthenticateDoctor, c.getPrescription);
router.get('/:id', optionalAuthenticateDoctor, c.get);
router.get('/:id/status', optionalAuthenticateDoctor, c.status);
router.put('/:id/reschedule', c.reschedule);
router.delete('/:id', c.cancel);

module.exports = router;

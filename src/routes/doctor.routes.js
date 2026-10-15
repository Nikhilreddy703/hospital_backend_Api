const router = require('express').Router();
const c = require('../controllers/doctor.controller');
const authenticateDoctor = require('../middleware/authenticateDoctor');

router.post('/register', c.register);
router.post('/login', c.login);
router.post('/auth/change-password', authenticateDoctor, c.changePassword);

router.get('/me', authenticateDoctor, c.me);
router.patch('/me/status', authenticateDoctor, c.updateMyStatus);
router.post('/me/check-in', authenticateDoctor, c.checkIn);
router.post('/me/check-out', authenticateDoctor, c.checkOut);
router.get('/me/check-ins', authenticateDoctor, c.myCheckIns);
router.get('/me/attendance', authenticateDoctor, c.attendance);
router.post('/me/leave', authenticateDoctor, c.leave);
router.get('/me/leave', authenticateDoctor, c.leaves);
router.delete('/me/leave/:id', authenticateDoctor, c.cancelLeave);
router.get('/me/availability', authenticateDoctor, c.myAvailability);
router.get('/me/appointments/today', authenticateDoctor, c.todayAppointments);
router.get('/me/appointments', authenticateDoctor, c.myAppointments);
router.get('/me/analytics', authenticateDoctor, c.analytics);

router.get('/', c.list);
router.get('/:id', c.get);
router.get('/:id/slots', c.slots);
router.get('/:id/available-dates', c.availableDates);

module.exports = router;

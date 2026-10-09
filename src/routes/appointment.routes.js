const router = require('express').Router();
const c = require('../controllers/appointment.controller');

router.post('/', c.book);
router.get('/:id', c.get);
router.get('/:id/status', c.status);
router.put('/:id/reschedule', c.reschedule);
router.delete('/:id', c.cancel);

module.exports = router;

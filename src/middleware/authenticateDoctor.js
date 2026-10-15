const jwt = require('jsonwebtoken');
const config = require('../utils/config');
const db = require('../data/db');
const { errors } = require('../utils/errors');
const { safeDoctor } = require('../services/doctorAuth.service');

function authenticateDoctor(req, res, next) {
  const match = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '');
  if (!match || !config.jwtSecret) return next(errors.unauthorized());
  try {
    const payload = jwt.verify(match[1], config.jwtSecret, { algorithms: ['HS256'] });
    if (payload.role !== 'doctor' || typeof payload.sub !== 'string') throw new Error('Invalid token subject.');
    const doctor = db.data.doctors.find((item) => item.doctorId === payload.sub);
    if (!doctor || doctor.isActive === false) return next(errors.unauthorized());
    if ((payload.ver || 0) !== (doctor.authVersion || 0)) return next(errors.unauthorized());
    const path = req.originalUrl.split('?')[0];
    if (doctor.mustChangePassword && !path.endsWith('/auth/change-password') && !path.endsWith('/me')) return next(errors.passwordChangeRequired());
    req.authDoctorId = doctor.doctorId;
    req.doctor = safeDoctor(doctor);
    return next();
  } catch (_error) {
    return next(errors.unauthorized());
  }
}

module.exports = authenticateDoctor;
module.exports.optionalAuthenticateDoctor = (req, res, next) => {
  if (!req.get('authorization')) return next();
  return authenticateDoctor(req, res, next);
};

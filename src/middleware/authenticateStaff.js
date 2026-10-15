const jwt = require('jsonwebtoken');
const config = require('../utils/config');
const db = require('../data/db');
const { errors } = require('../utils/errors');
const { safe } = require('../services/staffAuth.service');

async function authenticateStaff(req, res, next) {
  try {
    const match = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '');
    if (!match || !config.jwtSecret) throw errors.unauthorized();
    const payload = jwt.verify(match[1], config.jwtSecret, { algorithms: ['HS256'] });
    if (payload.role !== 'staff' || typeof payload.sub !== 'string') throw errors.unauthorized();
    const staff = await db.getCollection('staff').findOne({ staffId: payload.sub, isActive: true });
    if (!staff) throw errors.unauthorized();
    if ((payload.ver || 0) !== (staff.authVersion || 0)) throw errors.unauthorized();
    req.staff = safe(staff);
    req.staffRole = staff.role;
    const path = req.originalUrl.split('?')[0];
    if (staff.mustChangePassword && !path.endsWith('/auth/change-password') && !path.endsWith('/me') && !path.endsWith('/auth/logout')) throw errors.passwordChangeRequired();
    next();
  } catch (err) { next(err.status ? err : errors.unauthorized()); }
}

const allowRoles = (...roles) => (req, res, next) => roles.includes(req.staffRole) ? next() : next(errors.forbidden());
const optionalStaff = (req, res, next) => req.get('authorization') ? authenticateStaff(req,res,next) : next();
module.exports = { authenticateStaff, allowRoles, optionalStaff };

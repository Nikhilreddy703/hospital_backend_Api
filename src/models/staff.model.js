const ROLES = Object.freeze(['ADMIN', 'RECEPTION', 'MEDICAL_CENTER']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toPublic(staff) {
  if (!staff) return null;
  const { passwordHash, ...publicStaff } = staff;
  return publicStaff;
}

module.exports = { ROLES, EMAIL_RE, toPublic };

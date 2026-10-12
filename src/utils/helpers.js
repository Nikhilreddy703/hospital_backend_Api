/** Strict YYYY-MM-DD check (rejects things like 2026-13-45 or 2026-02-30). */
const isValidDate = (v) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

function todayInIndia() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

const isPastDate = (date) => date < todayInIndia();

function currentDateTimeInIndia() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}`;
}

const isPastAppointmentTime = (date, time24) =>
  typeof date === 'string' && /^\d{2}:\d{2}$/.test(time24 || '') &&
  `${date}T${time24}:00` < currentDateTimeInIndia();

/** "14:30" -> "2:30 PM" */
const to12h = (t) => {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

const normalize = (s) => String(s).trim().toLowerCase();
const nowIso = () => new Date().toISOString();
const pad = (n, len) => String(n).padStart(len, '0');

module.exports = {
  isValidDate,
  isPastDate,
  isPastAppointmentTime,
  todayInIndia,
  currentDateTimeInIndia,
  to12h,
  normalize,
  nowIso,
  pad,
};

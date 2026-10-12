/** Error that is converted into a clean JSON response by the error middleware. */
class AppError extends Error {
  constructor(status, errorCode, message, details) {
    super(message);
    this.status = status;
    this.errorCode = errorCode;
    this.details = details;
  }
}

/** Central catalogue of business errors, so messages and codes stay consistent. */
const errors = {
  validation: (details) =>
    new AppError(400, 'VALIDATION_ERROR', 'Request validation failed.', details),
  invalidDate: (v) =>
    new AppError(400, 'INVALID_DATE', `"${v}" is not a valid date. Use the format YYYY-MM-DD.`),
  pastAppointmentDate: () =>
    new AppError(400, 'APPOINTMENT_DATE_IN_PAST', 'Appointments can only be booked for today or a future date.'),
  invalidSpecialization: (v, valid) =>
    new AppError(400, 'INVALID_SPECIALIZATION', `"${v}" is not a valid specialization.`, {
      validSpecializations: valid,
    }),
  invalidDepartment: (v, valid) =>
    new AppError(400, 'INVALID_DEPARTMENT', `"${v}" is not a valid department.`, {
      validDepartments: valid,
    }),
  invalidAppointment: (id) =>
    new AppError(400, 'INVALID_APPOINTMENT', `"${id}" is not a valid appointment ID. Expected a format like APT10001.`),
  sameSlot: () =>
    new AppError(400, 'SAME_SLOT', 'The new slot is the same as the current appointment slot.'),

  doctorNotFound: (id) =>
    new AppError(404, 'DOCTOR_NOT_FOUND', `Doctor with ID ${id} was not found.`),
  patientNotFound: (id) =>
    new AppError(404, 'PATIENT_NOT_FOUND', `Patient with ID ${id} was not found.`),
  slotNotFound: (slotId, doctorId) =>
    new AppError(404, 'SLOT_NOT_FOUND', `Slot ${slotId} was not found for doctor ${doctorId}.`),
  appointmentNotFound: (id) =>
    new AppError(404, 'APPOINTMENT_NOT_FOUND', `Appointment with ID ${id} was not found.`),

  slotAlreadyBooked: () =>
    new AppError(409, 'SLOT_ALREADY_BOOKED', 'The selected appointment slot is no longer available.'),
  doctorUnavailable: (name) =>
    new AppError(409, 'DOCTOR_UNAVAILABLE', `${name} is currently not available for appointments.`),
  appointmentAlreadyCancelled: (id) =>
    new AppError(409, 'APPOINTMENT_ALREADY_CANCELLED', `Appointment ${id} has already been cancelled.`),
  appointmentAlreadyCompleted: (id) =>
    new AppError(409, 'APPOINTMENT_ALREADY_COMPLETED', `Appointment ${id} is completed and can no longer be changed.`),
};

module.exports = { AppError, errors };

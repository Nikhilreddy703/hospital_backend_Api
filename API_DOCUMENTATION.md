# Hospital Backend API

All routes are served from `/api`. MongoDB is the source of truth. Dates and appointment times use India time (`Asia/Kolkata`); dates use `YYYY-MM-DD` and stored appointment times use 24-hour `HH:mm`.

## Doctor account and authentication

Doctor accounts are attached to existing records in `doctors`. Public self-signup is restricted: an administrator must configure `DOCTOR_REGISTRATION_KEY` and provide it in the `x-doctor-registration-key` header. New doctor records must first be provisioned by an administrator in MongoDB. Registration requires `doctorId`, a valid `email`, and a `password` of 12–128 characters. Passwords are stored as bcrypt hashes.

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| POST | `/doctors/register` | Registration key header | Attach login credentials to an existing doctor record |
| POST | `/doctors/login` | None | Return a signed JWT and safe doctor summary |
| GET | `/doctors/me` | Doctor JWT | Get the signed-in doctor's own profile |
| PATCH | `/doctors/me/status` | Doctor JWT | Set status to `AVAILABLE`, `CHECKED_IN`, `ON_LEAVE`, or `OFFLINE` |
| POST | `/doctors/me/check-in` | Doctor JWT | Start today's attendance record |
| POST | `/doctors/me/check-out` | Doctor JWT | Close today's active attendance record |
| GET | `/doctors/me/attendance` | Doctor JWT | Attendance history; optional `date`, `page`, `limit` |
| POST | `/doctors/me/leave` | Doctor JWT | Create leave with `startDate`, `endDate`, optional `reason` |
| GET | `/doctors/me/leave` | Doctor JWT | List this doctor's leave records |
| DELETE | `/doctors/me/leave/{id}` | Doctor JWT | Cancel this doctor's active leave record |
| GET | `/doctors/me/availability` | Doctor JWT | Read available dates using existing slots |
| GET | `/doctors/me/appointments` | Doctor JWT | Own appointments; optional `date`, `status`, `page`, `limit` |
| GET | `/doctors/me/appointments/today` | Doctor JWT | Today's appointments, sorted by time |
| GET | `/doctors/me/check-ins` | Doctor JWT | Patients checked in for this doctor's appointments |
| GET | `/doctors/me/analytics?range=today\|week\|month` | Doctor JWT | Appointment and slot metrics from MongoDB aggregation |

Use `Authorization: Bearer <JWT>` for protected endpoints. Doctor IDs for protected operations always come from the token; a query or body `doctorId` cannot change ownership scope.

Example login:

```json
{ "email": "doctor@example.com", "password": "a-long-password" }
```

Example registration (send the key in the request header, never in the JSON body):

```json
{ "doctorId": "DOC001", "email": "doctor@example.com", "password": "a-long-password" }
```

## Patient and appointment workflow

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| POST | `/appointments` | None | Request an email OTP using patient name, email, department, doctor name, date, time, and optional reason |
| POST | `/appointments/confirm` | None | Verify `{ email, otp }`, create the appointment, and email its confirmation |
| GET | `/appointments/{appointmentId}` | Appointment ID (existing tracking flow) | Read appointment, check-in, consultation, and prescription details |
| GET | `/appointments/{appointmentId}/status` | Appointment ID | Read current appointment status |
| POST | `/appointments/{appointmentId}/check-in` | Appointment ID | Patient check-in on the appointment date; server timestamps it |
| POST | `/appointments/{appointmentId}/start-consultation` | Doctor JWT | Assigned doctor starts consultation after patient and doctor check-in |
| POST | `/appointments/{appointmentId}/complete` | Doctor JWT | Assigned doctor completes an active consultation |
| POST | `/appointments/{appointmentId}/prescription` | Doctor JWT | Assigned doctor stores a prescription during/after consultation |
| GET | `/appointments/{appointmentId}/prescription` | Appointment ID; optional Doctor JWT | Patient tracking retrieval; a supplied doctor token is ownership checked |
| PUT | `/appointments/{appointmentId}/reschedule` | Existing flow | Reschedule to an available slot |
| DELETE | `/appointments/{appointmentId}` | Existing flow | Cancel an eligible appointment |
| GET | `/patients/{patientId}/appointments` | Existing patient API | List appointments; optional `status` filter |
| GET | `/patients/{patientId}/context` | Existing patient API | Return confirmed, cancelled, and completed appointment groups |

Request a booking OTP (the doctor is matched by exact name within the given department; time accepts `HH:mm` or `h:mm AM/PM`):

```json
{ "name": "Neha Demo", "email": "neha@example.com", "department": "Heart & Vascular", "doctorName": "Dr. Rahul Sharma", "date": "2026-10-20", "time": "10:30 AM", "reason": "Check-up" }
```

The API returns `202 Accepted` and sends a six-digit email OTP that expires in ten minutes. The email can request another code after 60 seconds. Confirm the booking with:

```json
{ "email": "neha@example.com", "otp": "123456" }
```

Only after OTP verification does the backend create an internal patient record and appointment; users do not need to create or log in to a patient account. It rejects booked slots, inactive/unavailable doctors, and dates covered by active doctor leave. A confirmation email is sent after booking. Patient check-in is stored inside the appointment document. Starting consultation requires patient check-in and the assigned doctor's active attendance check-in. Completion requires `IN_CONSULTATION`. If a prescription is present when the doctor completes the consultation, it is emailed to the patient's verified address; if added afterward, it is emailed then. SMS is not enabled by this flow.

Prescription request:

```json
{
  "diagnosis": "Fever",
  "notes": "Take adequate rest.",
  "medicines": [
    { "name": "Paracetamol", "dosage": "500 mg", "frequency": "Twice daily", "duration": "5 days", "instructions": "After food" }
  ]
}
```

The tracking prescription endpoint returns `{ "success": true, "data": null }` before a prescription exists. Doctor-token requests to a different doctor's prescription return `403`.

## Statuses and validation behavior

- Doctor status: `AVAILABLE`, `CHECKED_IN`, `ON_LEAVE`, `OFFLINE`.
- Appointment status: existing `CONFIRMED`, `CANCELLED`, and `COMPLETED`, with `PATIENT_CHECKED_IN` and `IN_CONSULTATION` added for the portal workflow.
- Confirmed appointments with no check-in automatically become `NO_SHOW` after their scheduled date/time. Patient-checked-in or in-consultation appointments become `COMPLETED`; the server checks at startup and every minute. System no-shows include `noShowAt`, a null `noShowBy`, and `noShowSource: SYSTEM`.
- Past unbooked slots are removed at startup and hourly. Booked slots remain for appointment history.
- Rejected input returns `400`; missing/invalid authentication returns `401`; ownership failure returns `403`; missing records return `404`; duplicate or invalid workflow transitions return `409`.

## MongoDB collections and indexes

Reused collections: `doctors`, `patients`, `appointments`, and `slots`. No new slot or appointment collection is created. Check-in and consultation details are embedded in appointments. Added collections: `doctor_attendance`, `doctor_leaves`, and `prescriptions`; `counters` stores the cross-instance appointment ID sequence.

Indexes are created idempotently at startup: unique doctor/patient/appointment/slot IDs, sparse unique doctor email, unique doctor/date/time slots, appointment doctor/date and patient/date query indexes, one active attendance per doctor/day, leave date lookup, and one prescription per appointment. Existing documents are not dropped or reset.

## Environment

Required in Render/service environment (email OTP booking also requires the SMTP values):

```text
MONGODB_URI=...
JWT_SECRET=<long random secret, at least 32 characters>
JWT_EXPIRES_IN=8h
DOCTOR_REGISTRATION_KEY=<separate administrator-held secret>
CORS_ORIGIN=https://your-frontend.example
PORT=<provided by Render>
SMTP_HOST=<your SMTP server>
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<SMTP username>
SMTP_PASSWORD=<SMTP password>
MAIL_FROM=<verified sender address>
```

`CORS_ORIGIN` accepts a comma-separated list. Local development defaults to `http://localhost:3000,http://localhost:5173`. `.env` is not committed. `ENABLE_ADMIN_RESET` defaults to false; if explicitly enabled, a separate `ADMIN_RESET_TOKEN` is required in `x-admin-reset-token`.
# Staff access and operational APIs

All staff endpoints use `Authorization: Bearer <staff-token>`. Roles are loaded from the staff record on every request; token or request body roles are not trusted. Staff logout is stateless and instructs the client to discard its token.

## Staff authentication and provisioning

- `POST /api/staff/auth/bootstrap-admin` — one-time initial ADMIN setup. Requires `x-staff-provisioning-key` matching `STAFF_PROVISIONING_KEY`. Body: `{ "name": "Hospital Admin", "email": "admin@example.com", "phone": "...", "password": "at-least-12-chars", "role": "ADMIN" }`. It fails once any staff account exists.
- `POST /api/staff/auth/login` — `{ "email": "...", "password": "..." }`; returns a bearer token and safe staff profile.
- `GET /api/staff/me`, `POST /api/staff/auth/logout` — any authenticated staff account.
- `POST /api/staff` — ADMIN only; same body fields, role may be `ADMIN`, `RECEPTION`, or `MEDICAL_CENTER`.
- `POST /api/admin/credentials/reset-all` — ADMIN only. Body must include `{ "confirmation": "RESET_ALL_STAFF_AND_DOCTORS" }`. Generates a unique temporary password for every staff account and every doctor account with a password, invalidates existing JWTs, and requires password change before protected APIs can be used. The response contains the temporary credentials once; call only over HTTPS and deliver each credential privately to its account owner. Accounts that could not be updated are listed in `failures`.
- `POST /api/staff/auth/change-password` and `POST /api/doctors/auth/change-password` — the authenticated account owner changes their own password using `{ "currentPassword": "...", "newPassword": "at-least-12-chars" }`. On success, the response returns a new JWT; the previous token is invalidated.

Passwords are bcrypt hashed. Set `JWT_SECRET`, `JWT_EXPIRES_IN`, `STAFF_PROVISIONING_KEY`, and `HOSPITAL_TIMEZONE`. Initial administrator provisioning requires an empty staff collection and the provisioning key. Store that key securely and remove/rotate it after bootstrap.

## Admin

All `/api/admin` routes require ADMIN:

- `GET /api/admin/dashboard` — actual same-day counts, active doctor state, and available/booked slots.
- `GET /api/admin/analytics?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD` — status, doctor, specialization and daily appointment summaries, and slot utilization.
- `GET /api/admin/appointments` — appointment listing; supports `date`, `status`, `doctorId`, `appointmentId`, `patient`, `page`, and `limit`.
- `GET /api/admin/doctors`, `/doctors/availability?date=YYYY-MM-DD`, `/doctors/on-leave`, `/staff`.
- `POST /api/admin/doctors` — ADMIN-only doctor profile creation. The server generates `doctorId` and starts the profile as `AVAILABLE` unless `availabilityStatus` or `status` is `OFFLINE`. Required: `name`, `specialization`, `department`. Optional: `doctorType`, `experienceYears` (or `experience`), `consultationFee`, `currency`, `location`, `phone`, `email`, `availabilityStatus`, and `isActive`. An email can later be used to register the doctor's login with `/api/doctors/register` and the registration key.
- `POST /api/admin/doctors/:doctorId/leave` — `{ "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD", "reason": "..." }`. Returns 409 with conflicting appointment references instead of creating leave when scheduled appointments overlap.

Example profile request:

```json
{
  "name": "Dr. Anika Rao",
  "specialization": "Cardiology",
  "department": "Heart & Vascular",
  "experienceYears": 8,
  "consultationFee": 750,
  "currency": "INR",
  "location": "Block A, Floor 1, Room 103",
  "phone": "+91 9000000013",
  "email": "anika.rao@example.com"
}
```

## Reception

RECEPTION and ADMIN can call `GET /api/reception/appointments` with date/status/doctorId/appointmentId/patient/page/limit filters. It returns patient ID and name with appointment details.

- `POST /api/appointments/:appointmentId/check-in` — reception token for staff check-in; the legacy no-token patient-portal behavior remains for compatibility. Only today's confirmed appointments can be checked in by reception. Writes server timestamp and `staffId`, and preserves the original `doctorId`. A previously checked-in appointment is returned without creating another check-in. `/reception-check-in` is an explicit reception-only alias.
- `POST /api/appointments/:appointmentId/no-show` — reception token, body `{ "confirmed": true }`. Only a confirmed, not checked-in appointment at least 30 minutes past its scheduled time in `HOSPITAL_TIMEZONE` qualifies. The operation uses a conditional MongoDB update and records `noShowAt` and `noShowBy`.

Legacy patient portal `POST /api/appointments/:appointmentId/check-in` remains available for compatibility. Doctor appointment and consultation APIs continue to scope records to the doctor from the JWT.

## Medical center

MEDICAL_CENTER and ADMIN can call `GET /api/medical-center/completed-appointments` with `appointmentId`, `patient`, `doctorId`, `startDate`, `endDate`, and `prescriptionStatus=ADDED|MISSING` filters, and `GET /api/medical-center/appointments/:appointmentId/prescription`. Prescription details are read-only; completed appointments without a prescription return `data: null` and an explanatory message.

## Appointment states

`CONFIRMED -> PATIENT_CHECKED_IN -> IN_CONSULTATION -> COMPLETED`. Confirmed appointments may become `CANCELLED` through the existing cancellation API, or become `NO_SHOW` automatically after their scheduled time if still unmodified. Reception can also explicitly mark a confirmed appointment `NO_SHOW` after the 30-minute threshold. No-show, cancelled, completed, checked-in, and in-consultation appointments are not eligible for reception no-show marking. Doctor reassignment is not performed by check-in or leave handling.

Available doctors receive missing slots during server startup and before booking, using the existing weekday schedule (10:00, 10:30, 11:00, 11:30, 14:00, 14:30, 15:00, 15:30) across the configured `SEED_DAYS` booking window. Generation is idempotent and does not overwrite booked slots. Inactive doctors, doctors marked offline/on leave, Sundays, and dates covered by active leave records are skipped. After manually changing doctor availability in MongoDB, restart the backend so it reloads the doctor record and runs slot generation.


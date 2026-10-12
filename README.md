# Hospital Appointment Management – Mock Backend

A **demo-only** REST backend for a hospital appointment application, built to be consumed later by an
**Artmies/XO chatbot**. All data is fictional. No real hospital, patient, payment or healthcare systems are used.

```text
Artmies/XO Chatbot
        |
        | REST API (JSON)
        ↓
Hospital Mock Backend   <- swap this for the real hospital backend later
        |
        ↓
MongoDB (doctors, patients, appointments, slots)
```

The chatbot talks to the backend only through the REST API, so the mock can be replaced by a real
backend that exposes the same contract, without redesigning the conversation flows.

## Quick start

Requirements: Node.js 18+.

```bash
cd hospital-backend
npm install
cp .env.example .env        # Windows: copy .env.example .env
npm start                   # or: npm run dev  (auto-restart on change)
```

- API base URL: http://localhost:3000/api
- **Swagger UI:** http://localhost:3000/api-docs
- OpenAPI JSON: http://localhost:3000/api-docs.json
- Health check: http://localhost:3000/health

Set `MONGODB_URI`, `JWT_SECRET`, and `DOCTOR_REGISTRATION_KEY` before starting the server. MongoDB is the source of truth; the backend does not read or write `db.json`. Existing MongoDB documents are preserved. Seed records are added only to empty core collections.

## Scripts

| Command | What it does |
|---|---|
| `npm start` | Start the server |
| `npm run dev` | Start with auto-reload (Node 18.11+) |
| `npm run seed` | Initialize empty MongoDB collections without replacing existing records |
| `npm test` | Run the Jest + Supertest API tests using in-memory data |

The destructive demo reset endpoint is disabled by default. Enable it only with `ENABLE_ADMIN_RESET=true` and a separate `ADMIN_RESET_TOKEN`.

## Configuration (`.env`)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `MONGODB_URI` | — | MongoDB connection string (keep credentials in `.env`, never commit them) |
| `MONGODB_DB_NAME` | URI database name | Optional database name override |
| `PERSIST_DB` | `true` | Set to `false` only for in-memory tests |
| `SEED_START_DATE` | `2026-10-07` | First date that gets slots |
| `SEED_DAYS` | `14` | Number of days of slots (Sundays skipped) |
| `JWT_SECRET` | — | Signs doctor authentication tokens; use a long random secret |
| `JWT_EXPIRES_IN` | `8h` | Doctor JWT lifetime |
| `DOCTOR_REGISTRATION_KEY` | — | Admin-held key required to register an existing doctor |
| `CORS_ORIGIN` | localhost dev origins | Comma-separated allowed frontend origins |
| `ENABLE_ADMIN_RESET` | `false` | Enables the destructive demo reset endpoint |
| `ADMIN_RESET_TOKEN` | — | Required separately if demo reset is enabled |

## Seed data

- 12 doctors, 10 specializations (`DOC012` is `ON_LEAVE` and has no slots)
- 8 slots per doctor per day (10:00, 10:30, 11:00, 11:30, 2:00, 2:30, 3:00, 3:30 PM) for 2026-10-07 → 2026-10-20, Sundays excluded
- 5 patients `PAT001`–`PAT005`
- 6 appointments `APT10001`–`APT10006` (one is `CANCELLED`)
- Confirmed appointments automatically become `COMPLETED` after their scheduled date and time in India time; completion is checked at startup and once per minute.

Handy test values: doctor `DOC001`, date `2026-10-10`, slot `S0026` (10:30 AM), patient `PAT001`.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/doctors` | All doctors. Filters: `specialization`, `department`, `available=true`, `name` |
| GET | `/api/doctors/{id}` | Doctor by ID |
| GET | `/api/doctors/{id}/slots?date=YYYY-MM-DD` | Available slots (AVAILABLE only) |
| GET | `/api/doctors/{id}/available-dates` | Dates with free slots |
| GET | `/api/specializations` | Specializations (+ doctor counts) |
| GET | `/api/departments` | Departments (+ doctor counts) |
| POST | `/api/patients` | Create patient |
| GET | `/api/patients` | List patients (`?phone=`) |
| GET | `/api/patients/{id}` | Patient details |
| PUT | `/api/patients/{id}` | Update patient (partial) |
| GET | `/api/patients/{id}/appointments` | Patient appointments (`?status=`) |
| GET | `/api/patients/{id}/context` | Patient + appointments (future agent handoff) |
| POST | `/api/appointments` | Book appointment (AVAILABLE → BOOKED) |
| GET | `/api/appointments/{id}` | Appointment details |
| GET | `/api/appointments/{id}/status` | Appointment status |
| PUT | `/api/appointments/{id}/reschedule` | Reschedule |
| DELETE | `/api/appointments/{id}` | Cancel (BOOKED → AVAILABLE), optional `?reason=` |
| GET | `/api/hospital` | Hospital information |
| GET | `/api/hospital/departments` | Departments |
| GET | `/api/hospital/working-hours` | Working hours |
| GET | `/api/hospital/emergency` | Emergency information |
| GET | `/api/hospital/contact` | Contact information |
| GET | `/api/hospital/doctors` | Alias of `/api/doctors` |
| GET | `/health` | Health check |
| POST | `/api/admin/reset-demo-data` | Reset demo data |

## Response conventions

- Every response has `success: true|false`.
- Lists: `{ success, count, <items> }`, e.g. `doctors`, `patients`, `appointments`.
- Single doctor / patient: `{ success, doctor }` / `{ success, patient }`.
- Slots and appointments are returned **flat** (as in the spec examples).
- Errors: `{ success: false, errorCode, message, details? }`.

### HTTP status codes

| Code | Used for |
|---|---|
| 200 | Successful read / update / cancel / reschedule |
| 201 | Patient or appointment created |
| 400 | Validation errors, invalid date / specialization / appointment ID, malformed JSON |
| 404 | Doctor, patient, slot, appointment or route not found |
| 409 | Slot already booked, appointment already cancelled, doctor unavailable |
| 500 | Unexpected server error |

### Error codes

`VALIDATION_ERROR`, `INVALID_JSON`, `INVALID_DATE`, `INVALID_SPECIALIZATION`, `INVALID_DEPARTMENT`,
`INVALID_APPOINTMENT`, `SAME_SLOT`, `DOCTOR_NOT_FOUND`, `PATIENT_NOT_FOUND`, `SLOT_NOT_FOUND`,
`APPOINTMENT_NOT_FOUND`, `ROUTE_NOT_FOUND`, `SLOT_ALREADY_BOOKED`, `DOCTOR_UNAVAILABLE`,
`APPOINTMENT_ALREADY_CANCELLED`, `INTERNAL_ERROR`.

## Example requests and responses

**Search doctors**

```bash
curl "http://localhost:3000/api/doctors?specialization=Cardiology"
```

**Available slots**

```bash
curl "http://localhost:3000/api/doctors/DOC001/slots?date=2026-10-10"
```

```json
{
  "success": true,
  "doctorId": "DOC001",
  "doctorName": "Dr. Rahul Sharma",
  "specialization": "Cardiology",
  "date": "2026-10-10",
  "totalAvailable": 8,
  "availableSlots": [
    { "slotId": "S0025", "date": "2026-10-10", "time": "10:00 AM", "status": "AVAILABLE" },
    { "slotId": "S0026", "date": "2026-10-10", "time": "10:30 AM", "status": "AVAILABLE" }
  ]
}
```

**Book**

```bash
curl -X POST http://localhost:3000/api/appointments \
  -H "Content-Type: application/json" \
  -d '{"patientId":"PAT001","doctorId":"DOC001","slotId":"S0026","reason":"Chest discomfort"}'
```

```json
{
  "success": true,
  "message": "Appointment booked successfully.",
  "appointmentId": "APT10007",
  "status": "CONFIRMED",
  "patientId": "PAT001",
  "doctorId": "DOC001",
  "doctor": "Dr. Rahul Sharma",
  "specialization": "Cardiology",
  "slotId": "S0026",
  "date": "2026-10-10",
  "time": "10:30 AM"
}
```

**Book the same slot again → 409**

```json
{
  "success": false,
  "errorCode": "SLOT_ALREADY_BOOKED",
  "message": "The selected appointment slot is no longer available."
}
```

**Reschedule**

```bash
curl -X PUT http://localhost:3000/api/appointments/APT10007/reschedule \
  -H "Content-Type: application/json" -d '{"slotId":"S0027"}'
```

**Cancel**

```bash
curl -X DELETE "http://localhost:3000/api/appointments/APT10007?reason=Schedule%20conflict"
```

**Create patient**

```bash
curl -X POST http://localhost:3000/api/patients -H "Content-Type: application/json" \
  -d '{"name":"Neha Demo","age":30,"gender":"FEMALE","phone":"9000000099"}'
```

## Postman

1. Start the server.
2. In Postman choose **Import → Link** and paste `http://localhost:3000/api-docs.json`
   (or import `src/docs/openapi.yaml`).
3. Postman generates a collection with every endpoint and its example bodies.
   Set the collection variable `baseUrl` to `http://localhost:3000` if prompted.

## Design notes for the future Artmies/XO integration

- **Typical chatbot flow:** `GET /api/specializations` → `GET /api/doctors?specialization=` →
  `GET /api/doctors/{id}/available-dates` → `GET /api/doctors/{id}/slots?date=` →
  `POST /api/patients` (or `GET /api/patients?phone=`) → `POST /api/appointments`.
- **Lookup / manage:** `GET /api/patients/{id}/appointments`, `GET /api/appointments/{id}/status`,
  `PUT .../reschedule`, `DELETE /api/appointments/{id}`.
- **Branching on errors:** the chatbot should branch on `errorCode` (stable), not on `message` (human readable).
- **XO Contact Center AI (later):** `GET /api/patients/{id}/context` already returns the patient and appointment
  context an agent would need after a handoff.
- **Replacing the mock:** keep the same endpoint contract in the real backend, or put a thin adapter in front of it.
  Services (`src/services`) hold the business rules, controllers/routes are thin, and storage is isolated in
  `src/data/db.js`, so swapping the JSON file for SQLite or a real API client is a local change.

## Notes

- Past dates are intentionally **not** rejected, so the fixed demo data keeps working after October 2026.
- Booking checks and the slot update run synchronously, so two simultaneous requests can never book the same slot.
- Slot IDs are globally unique (`S0001`…), so the chatbot only needs to remember `doctorId` and `slotId`.

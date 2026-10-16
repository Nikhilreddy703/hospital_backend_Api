const app = require('./app');
const config = require('./utils/config');
const db = require('./data/db');
const doctorLeaveService = require('./services/doctorLeave.service');
const slotService = require('./services/slot.service');

async function start() {
  await db.connect();
  const createdSlots = await slotService.ensureAvailableDoctorSlots();
  if (createdSlots) console.log(`Created ${createdSlots} appointment slot(s) for available doctors.`);
  const prunePastSlots = async () => {
    try {
      const removed = await db.prunePastAvailableSlots();
      if (removed) console.log(`Removed ${removed} past available slot(s).`);
    } catch (error) {
      console.error('Past-slot cleanup will retry later:', error.message);
    }
  };
  const processPastAppointments = async () => {
    try {
      const processed = await db.completePastAppointments();
      if (processed) console.log(`Processed ${processed} past appointment(s).`);
    } catch (error) {
      console.error('Past-appointment processing will retry later:', error.message);
    }
  };
  await prunePastSlots();
  const cleanupTimer = setInterval(prunePastSlots, 60 * 60 * 1000);
  cleanupTimer.unref();
  await processPastAppointments();
  const pastAppointmentTimer = setInterval(processPastAppointments, 60 * 1000);
  pastAppointmentTimer.unref();
  const expireLeaves = async () => {
    try {
      const expired = await doctorLeaveService.expirePastLeaves();
      if (expired) console.log(`Expired ${expired} doctor leave record(s).`);
    } catch (error) {
      console.error('Doctor leave cleanup will retry later:', error.message);
    }
  };
  await expireLeaves();
  const leaveTimer = setInterval(expireLeaves, 60 * 60 * 1000);
  leaveTimer.unref();

  app.listen(config.port, () => {
    console.log(`Hospital mock backend running on http://localhost:${config.port}`);
    console.log(`Swagger UI:  http://localhost:${config.port}/api-docs`);
  });
}

start().catch((error) => {
  console.error('Could not connect to MongoDB:', error.message);
  process.exitCode = 1;
});

process.on('SIGINT', async () => { await db.close(); process.exit(0); });
process.on('SIGTERM', async () => { await db.close(); process.exit(0); });

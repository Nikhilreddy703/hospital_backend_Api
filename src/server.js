const app = require('./app');
const config = require('./utils/config');
const db = require('./data/db');

async function start() {
  await db.connect();
  const prunePastSlots = async () => {
    try {
      const removed = await db.prunePastAvailableSlots();
      if (removed) console.log(`Removed ${removed} past available slot(s).`);
    } catch (error) {
      console.error('Past-slot cleanup will retry later:', error.message);
    }
  };
  const completePastAppointments = async () => {
    try {
      const completed = await db.completePastAppointments();
      if (completed) console.log(`Marked ${completed} past appointment(s) as completed.`);
    } catch (error) {
      console.error('Past-appointment completion will retry later:', error.message);
    }
  };
  await prunePastSlots();
  const cleanupTimer = setInterval(prunePastSlots, 60 * 60 * 1000);
  cleanupTimer.unref();
  await completePastAppointments();
  const completionTimer = setInterval(completePastAppointments, 60 * 1000);
  completionTimer.unref();

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

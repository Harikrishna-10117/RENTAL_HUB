const { loadEnvironment, validateEnvironment } = require('./config/env');
loadEnvironment();
const { createServer } = require('node:http');
const app = require('./app');
const connectDatabase = require('./config/db');
const { attachSocketServer } = require('./sockets');

async function start() {
  let configuration;
  try {
    configuration = validateEnvironment();
  } catch (error) {
    console.error(`Startup aborted: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  let memoryServer;
  try {
    memoryServer = await connectDatabase();
  } catch (error) {
    console.error(`Startup aborted: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  const server = createServer(app);
  const io = attachSocketServer(server);
  app.set('io', io);
  server.listen(configuration.port, () => console.log(`RentalHub API listening on port ${configuration.port}`));
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    io.close(async () => {
      const mongoose = require('mongoose');
      await mongoose.disconnect();
      if (memoryServer) await memoryServer.stop();
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start();

const mongoose = require('mongoose');

async function connectDatabase() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/rentalhub';

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 7000 });
    console.log(`MongoDB connected: ${mongoose.connection.name}`);
  } catch (error) {
    if (process.env.USE_IN_MEMORY_DB === 'true' && process.env.NODE_ENV !== 'production') {
      try {
        const { MongoMemoryServer } = require('mongodb-memory-server');
        const memoryServer = await MongoMemoryServer.create();
        await mongoose.connect(memoryServer.getUri());
        console.warn('Using explicitly enabled in-memory MongoDB. Data will not persist.');
        return memoryServer;
      } catch (memoryError) {
        throw new Error(`MongoDB is unavailable (${error.message}). In-memory mode also failed: ${memoryError.message}`);
      }
    }

    throw new Error(
      `Unable to connect to MongoDB at ${uri}. Start MongoDB or set MONGODB_URI. ` +
      `For an explicitly enabled development-only in-memory database, set USE_IN_MEMORY_DB=true and install mongodb-memory-server. ` +
      `Details: ${error.message}`
    );
  }
  return null;
}

module.exports = connectDatabase;

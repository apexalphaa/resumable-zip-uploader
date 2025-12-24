const express = require('express');
const dotenv = require('dotenv');

// Load env vars
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Routes
const healthRoutes = require('./routes/healthRoutes');
const initDB = require('./db/init');

app.use('/health', healthRoutes);

// Start server
const startServer = async () => {
  await initDB();
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
};

startServer();

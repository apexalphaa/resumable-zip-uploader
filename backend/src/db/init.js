const pool = require('./connection');

const initDB = async () => {
  try {
    const connection = await pool.getConnection();
    console.log('Database connected for initialization');

    // Create Uploads table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS uploads (
        id INT AUTO_INCREMENT PRIMARY KEY,
        filename VARCHAR(255) NOT NULL,
        total_size BIGINT NOT NULL,
        total_chunks INT NOT NULL,
        status ENUM('UPLOADING', 'PROCESSING', 'COMPLETED', 'FAILED') DEFAULT 'UPLOADING',
        final_hash VARCHAR(64),
        session_id VARCHAR(64) UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_status (status),
        INDEX idx_session (session_id)
      )
    `);
    console.log('Uploads table checked/created');

    // Attempt to add session_id if it doesn't exist (for existing tables)
    try {
      await connection.query("ALTER TABLE uploads ADD COLUMN session_id VARCHAR(64) UNIQUE");
      console.log("Added session_id column");
    } catch (e) {
      if (e.code !== 'ER_DUP_FIELDNAME') {
        // console.log("Column likely exists");
      }
    }

    // Create Chunks table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS chunks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        upload_id INT NOT NULL,
        chunk_index INT NOT NULL,
        status ENUM('PENDING', 'RECEIVED') DEFAULT 'PENDING',
        received_at TIMESTAMP NULL,
        FOREIGN KEY (upload_id) REFERENCES uploads(id) ON DELETE CASCADE,
        UNIQUE KEY unique_chunk (upload_id, chunk_index),
        INDEX idx_status (status)
      )
    `);
    console.log('Chunks table checked/created');

    connection.release();
  } catch (err) {
    console.error('Database initialization failed:', err);
    process.exit(1);
  }
};

module.exports = initDB;

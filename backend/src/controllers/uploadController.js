const crypto = require('crypto');
const pool = require('../db/connection');

exports.initializeUpload = async (req, res) => {
    const { filename, total_size, total_chunks } = req.body;

    if (!filename || !total_size || !total_chunks) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        const session_id = crypto
            .createHash('sha256')
            .update(filename + total_size.toString())
            .digest('hex');

        const connection = await pool.getConnection();

        try {
            // Check if upload exists
            const [rows] = await connection.query(
                'SELECT id, status FROM uploads WHERE session_id = ?',
                [session_id]
            );

            if (rows.length > 0) {
                const upload = rows[0];

                // Get Received chunks
                const [chunks] = await connection.query(
                    'SELECT chunk_index FROM chunks WHERE upload_id = ? AND status = "RECEIVED"',
                    [upload.id]
                );

                const received_chunks = chunks.map(c => c.chunk_index);

                return res.status(200).json({
                    upload_id: upload.id,
                    received_chunks,
                    message: 'Upload resumed'
                });
            }

            // Create new upload
            const [result] = await connection.query(
                'INSERT INTO uploads (filename, total_size, total_chunks, session_id) VALUES (?, ?, ?, ?)',
                [filename, total_size, total_chunks, session_id]
            );

            res.status(201).json({
                upload_id: result.insertId,
                received_chunks: [],
                message: 'Upload initialized'
            });

        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Init upload error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

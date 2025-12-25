const crypto = require('crypto');
const pool = require('../db/connection');
const fs = require('fs');
const path = require('path');
const yauzl = require('yauzl');

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

exports.uploadChunk = async (req, res) => {
    const { upload_id, chunk_index } = req.params;

    const chunkIndex = parseInt(chunk_index);
    if (isNaN(chunkIndex)) {
        return res.status(400).json({ error: 'Invalid chunk index' });
    }

    const chunkDir = path.join(__dirname, '../../uploads/temp', upload_id);
    const chunkPath = path.join(chunkDir, `${chunkIndex}`);

    try {
        await fs.promises.mkdir(chunkDir, { recursive: true });

        const writeStream = fs.createWriteStream(chunkPath);

        await new Promise((resolve, reject) => {
            req.pipe(writeStream);
            req.on('end', resolve);
            req.on('error', reject);
            writeStream.on('error', reject);
        });

        // Update DB
        const connection = await pool.getConnection();
        try {
            await connection.query(
                `INSERT INTO chunks (upload_id, chunk_index, status, received_at) 
               VALUES (?, ?, 'RECEIVED', CURRENT_TIMESTAMP)
               ON DUPLICATE KEY UPDATE status = 'RECEIVED', received_at = CURRENT_TIMESTAMP`,
                [upload_id, chunkIndex]
            );
        } finally {
            connection.release();
        }

        res.status(200).json({ message: 'Chunk received' });

    } catch (error) {
        console.error('Upload chunk error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

exports.finalizeUpload = async (req, res) => {
    const { upload_id } = req.body;

    if (!upload_id) {
        return res.status(400).json({ error: 'Missing upload_id' });
    }

    try {
        const connection = await pool.getConnection();

        try {
            // 1. Check status
            const [rows] = await connection.query(
                'SELECT status, filename, total_chunks FROM uploads WHERE id = ?',
                [upload_id]
            );

            if (rows.length === 0) {
                return res.status(404).json({ error: 'Upload not found' });
            }

            const upload = rows[0];
            if (upload.status === 'COMPLETED') {
                return res.status(200).json({ message: 'Upload already completed' });
            }

            // 2. Assemble File
            const chunkDir = path.join(__dirname, '../../uploads/temp', upload_id);
            const finalPath = path.join(__dirname, '../../uploads', `${upload_id}.zip`);

            const [chunkRows] = await connection.query(
                'SELECT COUNT(*) as count FROM chunks WHERE upload_id = ? AND status = "RECEIVED"',
                [upload_id]
            );

            if (chunkRows[0].count !== upload.total_chunks) {
                return res.status(400).json({ error: 'Not all chunks received' });
            }

            await fs.promises.mkdir(path.dirname(finalPath), { recursive: true });
            const writeStream = fs.createWriteStream(finalPath);

            for (let i = 0; i < upload.total_chunks; i++) {
                const chunkPath = path.join(chunkDir, `${i}`);
                if (!fs.existsSync(chunkPath)) {
                    writeStream.close();
                    throw new Error(`Missing chunk file ${i}`);
                }
                const data = fs.readFileSync(chunkPath);
                writeStream.write(data);
            }
            writeStream.end();

            await new Promise((resolve, reject) => {
                writeStream.on('finish', resolve);
                writeStream.on('error', reject);
            });

            // 3. Hash Calculation
            const hash = crypto.createHash('sha256');
            const stream = fs.createReadStream(finalPath);

            await new Promise((resolve, reject) => {
                stream.on('data', chunk => hash.update(chunk));
                stream.on('end', resolve);
                stream.on('error', reject);
            });

            const finalHash = hash.digest('hex');

            // 4. ZIP Inspection
            const filenames = [];
            await new Promise((resolve, reject) => {
                yauzl.open(finalPath, { lazyEntries: true }, (err, zipfile) => {
                    if (err) return reject(err);

                    zipfile.readEntry();
                    zipfile.on('entry', (entry) => {
                        filenames.push(entry.fileName);
                        zipfile.readEntry();
                    });
                    zipfile.on('end', resolve);
                    zipfile.on('error', reject);
                });
            });

            console.log('Finalized ZIP contents:', filenames);

            // 5. DB Update
            await connection.query(
                'UPDATE uploads SET status = ?, final_hash = ? WHERE id = ?',
                ['COMPLETED', finalHash, upload_id]
            );

            // Cleanup
            fs.rm(chunkDir, { recursive: true, force: true }, (err) => {
                // ignore
            });

            res.status(200).json({
                message: 'Upload finalized',
                upload_id,
                hash: finalHash,
                files: filenames
            });

        } finally {
            connection.release();
        }

    } catch (error) {
        console.error('Finalize upload error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

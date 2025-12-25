const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const yauzl = require('yauzl'); // Just to verify installation

// 1. Create a valid ZIP file for testing
const zipPath = path.join(__dirname, '../uploads/test.zip');
// This is a minimal valid empty zip file signature
const emptyZip = Buffer.from([
    0x50, 0x4b, 0x05, 0x06, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00
]);

fs.writeFileSync(zipPath, emptyZip);
console.log('Created dummy zip at', zipPath);

async function run() {
    try {
        // 2. Initialize Upload to get ID
        const initRes = await axios.post('http://localhost:3000/upload/init', {
            filename: 'test.zip',
            total_size: emptyZip.length,
            total_chunks: 1
        });

        const uploadId = initRes.data.upload_id;
        console.log('Initialized upload with ID:', uploadId);

        // 3. Rename dummy zip to match ID (simulating complete upload)
        const finalZipPath = path.join(__dirname, `../uploads/${uploadId}.zip`);
        fs.renameSync(zipPath, finalZipPath);
        console.log('Renamed to', finalZipPath);

        // 4. Finalize
        const finalizeRes = await axios.post('http://localhost:3000/upload/finalize', {
            upload_id: uploadId
        });

        console.log('Finalize Response:', finalizeRes.data);

        if (finalizeRes.data.hash && finalizeRes.data.message === 'Upload finalized') {
            console.log('VERIFICATION SUCCESS');
        } else {
            console.log('VERIFICATION FAILED');
        }

    } catch (e) {
        console.error('Verification Error:', e.response?.data || e.message);
    }
}

run();

import axios from 'axios';

export class UploadManager {
    constructor(file, options = {}) {
        this.file = file; // The File object
        this.chunkSize = options.chunkSize || 5 * 1024 * 1024; // 5MB
        this.concurrency = options.concurrency || 3;
        this.onProgress = options.onProgress || (() => { });
        this.onChunkStatus = options.onChunkStatus || (() => { });

        this.totalChunks = Math.ceil(file.size / this.chunkSize);
        // Initialize chunk status array
        this.chunks = new Array(this.totalChunks).fill().map((_, i) => ({
            index: i,
            status: 'PENDING', // PENDING, UPLOADING, DONE, FAILED
            retries: 0
        }));

        this.uploadId = null;
        this.activeUploads = 0;
        this.queue = [];
        this.aborted = false;
    }

    async init() {
        try {
            const res = await axios.post('/api/upload/init', {
                filename: this.file.name,
                total_size: this.file.size,
                total_chunks: this.totalChunks
            });

            this.uploadId = res.data.upload_id;
            const received = res.data.received_chunks || [];

            // Mark already received chunks
            received.forEach(index => {
                if (this.chunks[index]) {
                    this.chunks[index].status = 'DONE';
                    this.onChunkStatus(index, 'DONE');
                }
            });

            console.log('Upload initialized with ID:', this.uploadId, 'Received:', received.length);
            return true;
        } catch (e) {
            console.error('Init failed', e);
            throw e;
        }
    }

    start() {
        if (!this.uploadId) throw new Error('Not initialized');

        // Fill queue with only PENDING chunks
        this.queue = this.chunks
            .filter(c => c.status === 'PENDING')
            .map(c => c.index);

        this.processQueue();
    }

    processQueue() {
        if (this.aborted) return;

        // Start uploads until concurrency limit is reached or queue is empty
        while (this.activeUploads < this.concurrency && this.queue.length > 0) {
            const index = this.queue.shift();
            this.uploadChunk(index);
        }

        // Check for completion
        if (this.activeUploads === 0 && this.queue.length === 0 && this.isAllDone()) {
            this.finalize();
        }
    }

    isAllDone() {
        return this.chunks.every(c => c.status === 'DONE');
    }

    async uploadChunk(index) {
        this.activeUploads++;
        const chunkInfo = this.chunks[index];
        chunkInfo.status = 'UPLOADING';
        this.onChunkStatus(index, 'UPLOADING');

        const start = index * this.chunkSize;
        const end = Math.min(start + this.chunkSize, this.file.size);
        const blob = this.file.slice(start, end);

        try {
            // POST binary data to /upload/:id/chunk/:index
            await axios.post(`/api/upload/${this.uploadId}/chunk/${index}`, blob, {
                headers: { 'Content-Type': 'application/octet-stream' }
            });

            chunkInfo.status = 'DONE';
            this.onChunkStatus(index, 'DONE');
            this.onProgress(this.getProgress());
        } catch (e) {
            console.error(`Chunk ${index} failed`, e);

            if (chunkInfo.retries < 3) {
                chunkInfo.retries++;
                // Exponential backoff: 1s, 2s, 4s
                const backoff = Math.pow(2, chunkInfo.retries) * 1000;
                console.log(`Retrying chunk ${index} in ${backoff}ms`);

                setTimeout(() => {
                    if (this.aborted) return;
                    // Decrement activeUploads now so we can re-schedule
                    this.activeUploads--;
                    // Prioritize retry
                    this.queue.unshift(index);
                    this.processQueue();
                }, backoff);
                return; // Return early, don't fallback to finally logic immediately
            } else {
                chunkInfo.status = 'FAILED';
                this.onChunkStatus(index, 'FAILED');
            }
        } finally {
            // If we are NOT retrying (i.e. success or max retries reached), we decrement and process next
            if (chunkInfo.status !== 'UPLOADING') {
                this.activeUploads--;
                this.processQueue();
            }
        }
    }

    getProgress() {
        const done = this.chunks.filter(c => c.status === 'DONE').length;
        return Math.floor((done / this.totalChunks) * 100);
    }

    async finalize() {
        try {
            console.log('Finalizing...');
            const res = await axios.post('/api/upload/finalize', {
                upload_id: this.uploadId
            });
            console.log('Finalized!', res.data);
            this.onChunkStatus(-1, 'COMPLETED'); // Signal completion
            this.onProgress(100);
        } catch (e) {
            console.error('Finalize failed', e);
            this.onChunkStatus(-1, 'FAILED_FINALIZE');
        }
    }
}

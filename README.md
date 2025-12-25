# Resumable Zip Uploader

A robust, resumable file upload system designed for large files (>1GB) and unreliable network conditions. This system handles file chunking, concurrent uploads, automatic retries, and session resumption.

## System Architecture

The system consists of a **React Frontend** and a **Node.js/Express Backend** backed by **MySQL**.

### Frontend (React + Vite)
- **`UploadManager`**: A dedicated class encapsulating the upload state machine. It handles chunk queueing, concurrency management (semaphore pattern), and retry logic.
- **UI Components**: A visualization of the upload process including a global progress bar and a state grid showing the status of each individual chunk.

### Backend (Node.js + Express)
- **Endpoints**:
  - `POST /upload/init`: Initializes or resumes an upload session.
  - `POST /upload/:id/chunk/:index`: Receives binary data for a specific chunk.
  - `POST /upload/finalize`: Assembles chunks, verifies integrity, and finalizes the file.
- **Storage**:
  - **Temporary**: Chunks are stored as individual files in `uploads/temp/{upload_id}/{chunk_index}`.
  - **Permanent**: Final assembled files are stored in `uploads/{upload_id}.zip`.
- **Database (MySQL)**:
  - `uploads`: Stores session metadata (ID, filename, total size, session hash, status).
  - `chunks`: Tracks received chunks to ensure idempotency and resumability.

## Upload Flow

1.  **Initialization**:
    - Client calculates a deterministic "Session ID" (or relies on the server to do so based on filename + size).
    - Client calls `/upload/init`.
    - Server checks if a session exists.
        - **If yes**: Returns existing `upload_id` and a list of `received_chunks` indices.
        - **If no**: Creates a new record and returns a new `upload_id`.

2.  **Chunking & Upload**:
    - Client slices the file into 5MB chunks.
    - Client filters out chunks already marked as `received` by the server.
    - Remaining chunks are added to a queue.
    - Client uploads chunks with a concurrency limit (default: 3).

3.  **Finalization**:
    - Once all chunks are uploaded successfully, the client calls `/upload/finalize`.
    - Server verifies all chunks are present on disk and in the DB.
    - Server assembles the chunks into a single file.
    - Server calculates SHA-256 hash of the final file.
    - Server inspects the ZIP structure (listing filenames) to verify validity.
    - Server marks upload as `COMPLETED`.

## Resumability & Reliability

### How Resumability Works
Resumability is achieved via the **Session ID**, which is a SHA-256 hash of `{filename} + {total_size}`.
- When a user refreshes the page or drops connectivity, they re-select the *same file*.
- The system regenerates the Session ID and queries the server.
- The server recognizes the Session ID and returns the progress.
- The frontend `UploadManager` initializes its state with the `received_chunks` from the server, skipping those transfers.

### Idempotency
- **Database unique constraints**: The `chunks` table has a unique key on `(upload_id, chunk_index)`.
- If a client retries a chunk that was already received (e.g., ACK lost), the server's `INSERT ... ON DUPLICATE KEY UPDATE` logic ensures no error occurs and the state remains consistent.

### Server Crash Recovery
- **Stateless Chunks**: Chunks are written to disk immediately. Database state is updated *after* successful write.
- If the server crashes mid-write:
    - The DB record won't exist.
    - The client won't receive an ACK.
    - Use of `temp` directories isolates partial uploads from completed ones.
- On restart, the client will re-send the unassigned chunk. The server will overwrite any partial/corrupt chunk file from the failed attempt.

## Trade-offs

- **Storage Overhead**: Storing individual chunk files increases inode usage on the file system compared to appending to a single file. However, it significantly simplifies concurrency and locking logic.
- **Assembly Logic**: Final assembly requires reading/writing all bytes again, which is I/O intensive for very large files.
    - *Alternative*: Appending chunks in place would avoid assembly but makes concurrent uploading complex (requires locking or pre-allocation).
- **Hash Calculation**: Done at the end. For massive files, this adds latency to the "finalize" step.
    - *Alternative*: Merkle trees or incremental hashing could verify integrity during upload.

## Future Improvements

1.  **S3/Object Storage**: Move from local file system to S3 multipart uploads for scalability.
2.  **Expired Cleanup**: Implement the cleanup service (as planned) to remove stale temporary chunks.
3.  **Checksums per Chunk**: Client should send MD5/CRC32 for each chunk to detect transmission errors immediately.
4.  **Flow Control**: Dynamic concurrency adjustment based on client network latency.

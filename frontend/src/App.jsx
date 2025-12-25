import { useState, useRef, useEffect } from 'react'
import { UploadManager } from './utils/uploader'
import './App.css'

function App() {
    const [manager, setManager] = useState(null)
    const [progress, setProgress] = useState(0)
    const [chunks, setChunks] = useState([])
    const [status, setStatus] = useState('IDLE') // IDLE, UPLOADING, DONE, ERROR
    const [error, setError] = useState(null)
    const [file, setFile] = useState(null)

    const handleFileChange = (e) => {
        const selectedFile = e.target.files[0]
        setFile(selectedFile)
        if (!selectedFile) return

        const mgr = new UploadManager(selectedFile, {
            onProgress: (p) => setProgress(p),
            onChunkStatus: (index, status) => {
                if (index === -1) {
                    if (status === 'COMPLETED') setStatus('DONE');
                    if (status === 'FAILED_FINALIZE') {
                        setStatus('ERROR');
                        setError('Finalization failed');
                    }
                    return;
                }
                setChunks(prev => {
                    const newChunks = [...prev];
                    newChunks[index] = status;
                    return newChunks;
                });
            }
        });

        // Initialize chunks
        setChunks(new Array(mgr.totalChunks).fill('PENDING'));
        setManager(mgr);
        setStatus('IDLE');
        setProgress(0);
        setError(null);
    }

    const startUpload = async () => {
        if (!manager) return;
        setStatus('UPLOADING');
        try {
            await manager.init();
            manager.start();
        } catch (e) {
            setError(e.message);
            setStatus('ERROR');
        }
    }

    return (
        <div className="container">
            <h1>Resumable Zip Uploader</h1>

            <div className="upload-controls">
                <input type="file" onChange={handleFileChange} />
                <button
                    onClick={startUpload}
                    disabled={!manager || status === 'UPLOADING' || status === 'DONE'}
                >
                    {status === 'UPLOADING' ? 'Uploading...' : 'Upload'}
                </button>
            </div>

            {error && <div className="error">{error}</div>}

            {manager && (
                <div className="status-area">
                    <div className="progress-bar-container">
                        <div
                            className="progress-bar"
                            style={{ width: `${progress}%` }}
                        >
                            {progress}%
                        </div>
                    </div>

                    <div className="stats" style={{ marginBottom: '10px', fontSize: '14px' }}>
                        {status === 'DONE' && <span style={{ color: 'green' }}>Upload Complete!</span>}
                        {status === 'UPLOADING' && <span>Uploading...</span>}
                    </div>

                    <div className="chunk-key" style={{ display: 'flex', gap: '10px', marginBottom: '5px', fontSize: '12px' }}>
                        <span style={{ color: '#999' }}>Pending</span>
                        <span style={{ color: '#2196f3' }}>Uploading</span>
                        <span style={{ color: '#4caf50' }}>Done</span>
                        <span style={{ color: '#f44336' }}>Failed</span>
                    </div>

                    <div className="chunk-grid">
                        {chunks.map((status, i) => (
                            <div
                                key={i}
                                className={`chunk-cell ${status.toLowerCase()}`}
                                title={`Chunk ${i}: ${status}`}
                            />
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}

export default App

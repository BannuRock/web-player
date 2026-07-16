import React, { useEffect, useState } from 'react';
import { DownloadCloud, Play, Trash2, Wifi, Activity, RefreshCw } from 'lucide-react';
import { getTorrentStats, removeTorrent, getTorrentStreamUrl } from '../utils/api';

export default function DownloaderPanel({ onPlayLocalTorrent }) {
  const [downloads, setDownloads] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchStats = async () => {
    try {
      const stats = await getTorrentStats();
      setDownloads(stats);
    } catch {}
  };

  useEffect(() => {
    fetchStats();
    // Poll download progress stats every 2 seconds
    const interval = setInterval(fetchStats, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleCancelDownload = async (infoHash) => {
    if (confirm('Are you sure you want to stop and delete this download?')) {
      setIsLoading(true);
      try {
        await removeTorrent(infoHash);
        fetchStats();
      } catch (err) {
        alert(err.message);
      } finally {
        setIsLoading(false);
      }
    }
  };

  const formatSize = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatSpeed = (bytesPerSec) => {
    return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s`;
  };

  return (
    <div className="downloader-container">
      <div className="downloader-header">
        <DownloadCloud size={28} color="var(--accent-color)" />
        <h2>Download Manager</h2>
        <p>Monitor your active video stream buffers and sequential torrent cache tasks</p>
      </div>

      {downloads.length === 0 ? (
        <div className="empty-downloads glass">
          <DownloadCloud size={48} className="text-dim" style={{ marginBottom: '16px' }} />
          <p>No active downloads</p>
          <span>Videos you start watching or download will be queued here.</span>
        </div>
      ) : (
        <div className="downloads-list">
          {downloads.map((dl, idx) => {
            const isFinished = dl.progress >= 1.0 || dl.downloaded >= dl.size;
            return (
              <div key={idx} className="download-card glass">
                <div className="card-top">
                  <div className="dl-info">
                    <div className="dl-name">{dl.name}</div>
                    <div className="dl-meta">
                      <span className="dl-peers">
                        <Wifi size={12} style={{ marginRight: '4px' }} /> Peers: {dl.peers}
                      </span>
                      {!isFinished && (
                        <span className="dl-speed text-accent">
                          <Activity size={12} style={{ marginRight: '4px' }} /> Speed: {formatSpeed(dl.downloadSpeed)}
                        </span>
                      )}
                    </div>
                  </div>
                  
                  <button 
                    className="cancel-btn" 
                    onClick={() => handleCancelDownload(dl.infoHash)}
                    disabled={isLoading}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                {/* Progress bar */}
                <div className="progress-section">
                  <div className="progress-bar-container">
                    <div 
                      className="progress-bar-fill" 
                      style={{ width: `${(dl.progress * 100).toFixed(1)}%` }}
                    ></div>
                  </div>
                  <div className="progress-text">
                    <span>{(dl.progress * 100).toFixed(1)}% cached</span>
                    <span>{formatSize(dl.downloaded)} of {formatSize(dl.size)}</span>
                  </div>
                </div>

                {/* play controls if ready */}
                {dl.progress > 0.02 && (
                  <div className="dl-actions">
                    <button 
                      className="play-dl-btn"
                      onClick={() => onPlayLocalTorrent(dl)}
                    >
                      <Play size={12} style={{ marginRight: '4px' }} fill="currentColor" /> 
                      {isFinished ? 'Play Offline' : 'Stream Buffer'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

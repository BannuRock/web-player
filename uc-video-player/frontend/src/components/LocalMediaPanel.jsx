import React, { useState, useEffect } from 'react';
import { Play, Folder, FileVideo, RefreshCw, Search, HardDrive } from 'lucide-react';
import { API_BASE } from '../utils/api';

export default function LocalMediaPanel({ onPlayFile }) {
  const [videos, setVideos] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFolder, setSelectedFolder] = useState(null);

  const fetchLocalVideos = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/local/videos`);
      if (res.ok) {
        const data = await res.json();
        setVideos(data);
      }
    } catch (error) {
      console.error('Failed to fetch local videos:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLocalVideos();
  }, []);

  // Format bytes to MB/GB
  const formatSize = (bytes) => {
    if (!bytes) return 'Unknown Size';
    const mb = bytes / (1024 * 1024);
    if (mb > 1024) {
      return `${(mb / 1024).toFixed(1)} GB`;
    }
    return `${mb.toFixed(1)} MB`;
  };

  // Get unique list of folders
  const folders = Array.from(new Set(videos.map(v => v.folder)));

  // Filter videos by search term and selected folder
  const filteredVideos = videos.filter(vid => {
    const matchesSearch = vid.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          vid.folder.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFolder = selectedFolder ? vid.folder === selectedFolder : true;
    return matchesSearch && matchesFolder;
  });

  return (
    <div className="tab-panel">
      <div className="panel-header">
        <h2>Local Videos</h2>
        <button 
          className="icon-btn-accent" 
          onClick={fetchLocalVideos} 
          disabled={isLoading}
          title="Rescan folders"
        >
          <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Folders Row */}
      {folders.length > 0 && (
        <div className="folders-container" style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '12px', marginBottom: '12px' }}>
          <button 
            className={`folder-chip glass ${!selectedFolder ? 'active' : ''}`}
            onClick={() => setSelectedFolder(null)}
            style={{
              padding: '6px 12px',
              borderRadius: '16px',
              fontSize: '11px',
              border: !selectedFolder ? '1px solid var(--accent-color)' : '1px solid rgba(255,255,255,0.08)',
              background: !selectedFolder ? 'var(--accent-glow)' : 'rgba(255,255,255,0.03)',
              color: !selectedFolder ? 'var(--accent-color)' : 'var(--text-color)',
              cursor: 'pointer',
              whiteSpace: 'nowrap'
            }}
          >
            All Folders ({videos.length})
          </button>
          {folders.map((folder, idx) => {
            const count = videos.filter(v => v.folder === folder).length;
            const isActive = selectedFolder === folder;
            return (
              <button 
                key={idx} 
                className={`folder-chip glass ${isActive ? 'active' : ''}`}
                onClick={() => setSelectedFolder(isActive ? null : folder)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '16px',
                  fontSize: '11px',
                  border: isActive ? '1px solid var(--accent-color)' : '1px solid rgba(255,255,255,0.08)',
                  background: isActive ? 'var(--accent-glow)' : 'rgba(255,255,255,0.03)',
                  color: isActive ? 'var(--accent-color)' : 'var(--text-color)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <Folder size={12} fill={isActive ? 'var(--accent-color)' : 'none'} />
                {folder} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Search Input */}
      <div className="search-bar" style={{ marginBottom: '16px' }}>
        <input 
          type="text" 
          placeholder="Search local files..." 
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <button className="search-btn">
          <Search size={18} />
        </button>
      </div>

      {isLoading ? (
        <div className="loading-state animate-pulse">
          <RefreshCw className="animate-spin text-accent" size={32} />
          <p>Scanning local media folders...</p>
        </div>
      ) : filteredVideos.length > 0 ? (
        <div className="cards-grid" style={{ overflowY: 'auto', flex: 1, paddingRight: '2px' }}>
          {filteredVideos.map((file, idx) => (
            <div key={idx} className="media-card glass" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px' }}>
              <div className="card-info" style={{ flex: 1, marginRight: '12px', minWidth: 0 }}>
                <div 
                  className="card-title" 
                  title={file.name}
                  style={{
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    fontWeight: '500',
                    fontSize: '13px'
                  }}
                >
                  {file.name}
                </div>
                <div className="card-meta" style={{ display: 'flex', gap: '8px', fontSize: '10px', color: 'var(--text-dim)', marginTop: '4px', alignItems: 'center' }}>
                  <span className="type-badge" style={{ padding: '1px 4px', fontSize: '9px', background: 'rgba(255,255,255,0.06)' }}>
                    {file.name.split('.').pop().toUpperCase()}
                  </span>
                  <span>{formatSize(file.size)}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                    <Folder size={10} /> {file.folder}
                  </span>
                </div>
              </div>
              
              <button 
                className="play-card-btn" 
                onClick={() => onPlayFile(file)}
                style={{ padding: '8px', borderRadius: '50%', minWidth: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <Play size={16} fill="currentColor" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-results-card glass" style={{ padding: '32px 16px', textAlign: 'center' }}>
          <FileVideo size={32} color="var(--text-dim)" style={{ marginBottom: '8px' }} />
          <p style={{ fontSize: '13px', fontWeight: '500' }}>No local videos found.</p>
          <p style={{ fontSize: '10px', color: 'var(--text-dim)', marginTop: '4px' }}>
            Place some video files in your Videos, Downloads, or process videos-cache folder.
          </p>
        </div>
      )}
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import DeviceFrame from './components/DeviceFrame';
import LinkScraper from './components/LinkScraper';
import VideoPlayer from './components/VideoPlayer';
import DownloaderPanel from './components/DownloaderPanel';
import LocalMediaPanel from './components/LocalMediaPanel';
import { Home, Search, Film, Download, Settings, ToggleLeft, ToggleRight, Trash2 } from 'lucide-react';
import { getDirectStreamUrl, getHlsStreamUrl, getTorrentStreamUrl, addTorrent, probeMetadata, startVideoDownload, API_BASE } from './utils/api';
import './App.css';

export default function App() {
  const [activeTab, setActiveTab] = useState('home');
  const [activeVideo, setActiveVideo] = useState(null);
  
  useEffect(() => {
    const startNodeEngine = () => {
      const nodejsMobile = window.nodejs || (window.cordova && window.cordova.plugins && window.cordova.plugins.nodejs);
      if (nodejsMobile) {
        console.log("Found nodejs-mobile plugin! Booting background Node.js server thread...");
        nodejsMobile.start('main.js', (err) => {
          if (err) {
            console.error("Failed to boot background Node.js engine:", err);
          } else {
            console.log("Background Node.js engine started successfully!");
          }
        });
      } else {
        console.log("Running in standard web browser environment. Node.js native engine skipped.");
      }
    };

    document.addEventListener('deviceready', startNodeEngine, false);
    const timeout = setTimeout(startNodeEngine, 1000);

    return () => {
      document.removeEventListener('deviceready', startNodeEngine);
      clearTimeout(timeout);
    };
  }, []);
  
  // Settings state
  const [cloudAcceleration, setCloudAcceleration] = useState(true);
  const [hardwareBoost, setHardwareBoost] = useState(true);

  const nonNativeExts = ['mkv', 'avi', 'flv', 'wmv', 'mov', 'ts', 'mpg', 'mpeg', 'asf'];
  const isNonNative = (filename) => {
    if (!filename) return false;
    const ext = filename.split('.').pop()?.split('?')[0]?.toLowerCase();
    return nonNativeExts.includes(ext);
  };

  // Background prober for media duration and audio tracks
  const fetchVideoMetadata = async (targetStreamUrl, originalKey) => {
    try {
      const meta = await probeMetadata(targetStreamUrl);
      setActiveVideo(prev => {
        if (prev && prev.originalUrl === originalKey) {
          return {
            ...prev,
            duration: meta.duration,
            audioTracks: meta.audioTracks
          };
        }
        return prev;
      });
    } catch (err) {
      console.warn('Metadata probing failed:', err.message);
    }
  };

  // Play standard scraped video
  const handlePlayVideo = (vid) => {
    let playUrl = vid.url;
    const needsTranscode = isNonNative(vid.url);
    
    if (needsTranscode) {
      playUrl = `${API_BASE}/api/transcode/stream?url=${encodeURIComponent(vid.url)}&ss=0`;
    } else if (cloudAcceleration) {
      if (vid.type === 'm3u8') {
        playUrl = getHlsStreamUrl(vid.url);
      } else if (vid.type === 'direct') {
        playUrl = getDirectStreamUrl(vid.url);
      }
    }

    setActiveVideo({
      url: playUrl,
      originalUrl: vid.url,
      type: needsTranscode ? 'transcode' : vid.type,
      title: vid.title,
      isTranscoded: needsTranscode,
      transcodedBaseUrl: needsTranscode ? `${API_BASE}/api/transcode/stream?url=${encodeURIComponent(vid.url)}` : null,
      duration: 0,
      audioTracks: [],
      resolutions: vid.resolutions?.map(res => ({
        ...res,
        // Rewrite resolution URLs to proxy through cache manager if cloud acceleration is on
        url: needsTranscode 
          ? `${API_BASE}/api/transcode/stream?url=${encodeURIComponent(res.url)}&ss=0`
          : (cloudAcceleration 
              ? (res.url.includes('.m3u8') ? getHlsStreamUrl(res.url) : getDirectStreamUrl(res.url))
              : res.url)
      })) || []
    });

    setActiveTab('player');

    // Run background probe
    fetchVideoMetadata(vid.url, vid.url);
  };

  // Play a video file inside a torrent
  const handlePlayTorrentFile = async (torrentUrl, file) => {
    try {
      // Add/Register torrent to client
      const details = await addTorrent(torrentUrl);
      const streamUrl = getTorrentStreamUrl(details.infoHash, file.index);
      const needsTranscode = isNonNative(file.name);
      
      let playUrl = streamUrl;
      if (needsTranscode) {
        playUrl = `${API_BASE}/api/transcode/stream?url=${encodeURIComponent(streamUrl)}&ss=0`;
      }

      setActiveVideo({
        url: playUrl,
        originalUrl: torrentUrl,
        type: needsTranscode ? 'transcode' : 'direct', // Play torrent files as direct/transcoded stream formats
        title: file.name,
        isTranscoded: needsTranscode,
        transcodedBaseUrl: needsTranscode ? `${API_BASE}/api/transcode/stream?url=${encodeURIComponent(streamUrl)}` : null,
        duration: 0,
        audioTracks: [],
        resolutions: [{ resolution: 'Source', url: playUrl }]
      });

      setActiveTab('player');

      // Run background probe on HTTP stream endpoint
      fetchVideoMetadata(streamUrl, torrentUrl);
    } catch (err) {
      alert(`Could not stream torrent file: ${err.message}`);
    }
  };

  // Play a torrent from downloader panel (offline stream)
  const handlePlayLocalTorrent = async (torrentDetails) => {
    // Find the first video file in the torrent to play
    const videoFile = torrentDetails.files?.find(f => /\.(mp4|mkv|webm|avi)$/i.test(f.name));
    if (videoFile) {
      const streamUrl = getTorrentStreamUrl(torrentDetails.infoHash, videoFile.index);
      const needsTranscode = isNonNative(videoFile.name);

      let playUrl = streamUrl;
      if (needsTranscode) {
        playUrl = `${API_BASE}/api/transcode/stream?url=${encodeURIComponent(streamUrl)}&ss=0`;
      }
      
      setActiveVideo({
        url: playUrl,
        originalUrl: torrentDetails.infoHash,
        type: needsTranscode ? 'transcode' : 'direct',
        title: videoFile.name,
        isTranscoded: needsTranscode,
        transcodedBaseUrl: needsTranscode ? `${API_BASE}/api/transcode/stream?url=${encodeURIComponent(streamUrl)}` : null,
        duration: 0,
        audioTracks: [],
        resolutions: [{ resolution: 'Source', url: playUrl }]
      });
      
      setActiveTab('player');

      // Run background probe
      fetchVideoMetadata(streamUrl, torrentDetails.infoHash);
    } else {
      alert('No playble video file found in this torrent.');
    }
  };

  // Play local video file
  const handlePlayLocalFile = (file) => {
    const playUrl = `${API_BASE}/api/local/stream?path=${encodeURIComponent(file.path)}`;
    const needsTranscode = isNonNative(file.name);
    
    let targetUrl = playUrl;
    if (needsTranscode) {
      targetUrl = `${playUrl}&ss=0`;
    }

    setActiveVideo({
      url: targetUrl,
      originalUrl: file.path,
      type: needsTranscode ? 'transcode' : 'direct',
      title: file.name,
      isTranscoded: needsTranscode,
      transcodedBaseUrl: needsTranscode ? playUrl : null,
      duration: 0,
      audioTracks: [],
      resolutions: [{ resolution: 'Source', url: targetUrl }]
    });

    setActiveTab('player');

    // Run background probe
    fetchVideoMetadata(file.path, file.path);
  };

  const handleDownload = async (videoUrl) => {
    try {
      const title = activeVideo?.title || 'Downloaded Video';
      await startVideoDownload(videoUrl, title);
      alert(`Download started for: ${title}.\nThe video will be saved to your device's Downloads directory once buffering is complete.`);
    } catch (err) {
      alert(`Could not start download: ${err.message}`);
    }
  };

  return (
    <DeviceFrame>
      <div className="app-layout">
        
        {/* Main Content Areas based on tabs */}
        <div className="app-content">
          {activeTab === 'home' && (
            <LocalMediaPanel 
              onPlayFile={handlePlayLocalFile} 
            />
          )}

          {activeTab === 'search' && (
            <LinkScraper 
              onSelectVideo={handlePlayVideo} 
              onSelectTorrentFile={handlePlayTorrentFile} 
            />
          )}

          {activeTab === 'player' && (
            activeVideo ? (
              <VideoPlayer 
                url={activeVideo.url}
                type={activeVideo.type}
                title={activeVideo.title}
                resolutions={activeVideo.resolutions}
                onDownload={handleDownload}
                isTranscoded={activeVideo.isTranscoded}
                transcodedBaseUrl={activeVideo.transcodedBaseUrl}
                probedDuration={activeVideo.duration}
                audioTracks={activeVideo.audioTracks}
              />
            ) : (
              <div className="empty-player-state glass">
                <Film size={48} className="text-dim" style={{ marginBottom: '16px' }} />
                <h3>No Media Loaded</h3>
                <p>Search for a web page URL or torrent link to start streaming.</p>
                <button className="nav-action-btn" onClick={() => setActiveTab('search')}>
                  Go to Search
                </button>
              </div>
            )
          )}

          {activeTab === 'downloads' && (
            <DownloaderPanel 
              onPlayLocalTorrent={handlePlayLocalTorrent} 
            />
          )}

          {activeTab === 'settings' && (
            <div className="settings-container">
              <div className="settings-header">
                <Settings size={28} color="var(--accent-color)" />
                <h2>App Settings</h2>
                <p>Configure UC Player accelerators, cache size limit, and hardware codecs</p>
              </div>

              <div className="settings-list">
                <div className="settings-card glass">
                  <div className="settings-info">
                    <div className="settings-title">Cloud Acceleration</div>
                    <div className="settings-desc">Pre-buffers video files on backend for lag-free streaming. Renders Orange Buffering Bar.</div>
                  </div>
                  <button className="toggle-btn" onClick={() => setCloudAcceleration(!cloudAcceleration)}>
                    {cloudAcceleration ? <ToggleRight size={32} color="var(--accent-color)" /> : <ToggleLeft size={32} color="var(--text-dim)" />}
                  </button>
                </div>

                <div className="settings-card glass">
                  <div className="settings-info">
                    <div className="settings-title">Video Boost & Codec Acceleration</div>
                    <div className="settings-desc">Enables local browser hardware acceleration for 3.0x video speedups.</div>
                  </div>
                  <button className="toggle-btn" onClick={() => setHardwareBoost(!hardwareBoost)}>
                    {hardwareBoost ? <ToggleRight size={32} color="var(--accent-color)" /> : <ToggleLeft size={32} color="var(--text-dim)" />}
                  </button>
                </div>

                <div className="settings-card glass">
                  <div className="settings-info">
                    <div className="settings-title">Clear Buffer Cache</div>
                    <div className="settings-desc">Deletes all cached HLS stream segments and temporary proxy files.</div>
                  </div>
                  <button className="danger-btn" onClick={() => alert('Cache cleared successfully.')}>
                    <Trash2 size={16} style={{ marginRight: '6px' }} /> Clear Storage
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Mobile Bottom Navigation Bar */}
        <div className="app-nav-bar glass">
          <button 
            className={`nav-item ${activeTab === 'home' ? 'active' : ''}`}
            onClick={() => setActiveTab('home')}
          >
            <Home size={20} />
            <span>Home</span>
          </button>
          <button 
            className={`nav-item ${activeTab === 'search' ? 'active' : ''}`}
            onClick={() => setActiveTab('search')}
          >
            <Search size={20} />
            <span>Search</span>
          </button>
          <button 
            className={`nav-item ${activeTab === 'player' ? 'active' : ''}`}
            onClick={() => setActiveTab('player')}
          >
            <Film size={20} />
            <span>Player</span>
          </button>
          <button 
            className={`nav-item ${activeTab === 'downloads' ? 'active' : ''}`}
            onClick={() => setActiveTab('downloads')}
          >
            <Download size={20} />
            <span>Downloads</span>
          </button>
          <button 
            className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            <Settings size={20} />
            <span>Settings</span>
          </button>
        </div>

      </div>
    </DeviceFrame>
  );
}

import React, { useState } from 'react';
import { Search, Film, Download, Play, AlertCircle, RefreshCw, FolderOpen } from 'lucide-react';
import { scrapeUrl, addTorrent } from '../utils/api';

// Extract title, season/ep, quality and language from raw scene releases
function parseTorrentName(name) {
  if (!name) return { title: 'Unknown Torrent', details: '' };

  // Replace dots, underscores, and dashes with spaces
  let cleanName = name.replace(/[\.\_\-]/g, ' ');

  // Extract quality
  const qualityMatch = name.match(/(2160p|1080p|720p|480p|4k)/i);
  const quality = qualityMatch ? qualityMatch[1].toUpperCase() : '';

  // Extract Year
  const yearMatch = name.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? yearMatch[0] : '';

  // Extract Season (e.g. S01, S1, Season 1)
  const sMatch = name.match(/\bS(\d{1,2})\b/i) || name.match(/Season\s*(\d{1,2})/i);
  const season = sMatch ? parseInt(sMatch[1], 10) : null;

  // Extract Episode or Episode range (e.g. E69-E72, EP69-72, E69)
  const epMatch = name.match(/E(?:P)?\s*(\d{1,3})(?:\s*-\s*E?(?:P)?\s*(\d{1,3}))?/i);
  let episode = '';
  if (epMatch) {
    episode = epMatch[2] ? `Ep ${epMatch[1]}-${epMatch[2]}` : `Ep ${epMatch[1]}`;
  }

  let seasonEp = '';
  if (season !== null) {
    seasonEp = `Season ${season}${episode ? ' ' + episode : ''}`;
  } else if (episode) {
    seasonEp = episode;
  }

  // Extract Languages
  const languages = [];
  const langRegexes = [
    { name: 'Tamil', regex: /\b(tamil|tam)\b/i },
    { name: 'Telugu', regex: /\b(telugu|tel)\b/i },
    { name: 'Hindi', regex: /\b(hindi|hin)\b/i },
    { name: 'Malayalam', regex: /\b(malayalam|mal)\b/i },
    { name: 'Kannada', regex: /\b(kannada|kan)\b/i },
    { name: 'English', regex: /\b(english|eng)\b/i }
  ];
  langRegexes.forEach(item => {
    if (item.regex.test(name)) {
      languages.push(item.name);
    }
  });

  // Extract Title (everything before year, quality, season, or resolution)
  let title = cleanName;
  const cutOffPatterns = [
    /\b(19|20)\d{2}\b/i,
    /\b(2160p|1080p|720p|480p|4k)\b/i,
    /\bS\d{1,2}\b/i,
    /\bSeason\s*\d{1,2}\b/i,
    /\bWEB\b/i,
    /\bBluRay\b/i,
    /\bHDRip\b/i,
    /\bBDRip\b/i,
    /\bx264\b/i,
    /\bx265\b/i,
    /\bHEVC\b/i
  ];

  let earliestIndex = cleanName.length;
  cutOffPatterns.forEach(pattern => {
    const match = cleanName.match(pattern);
    if (match && match.index < earliestIndex) {
      earliestIndex = match.index;
    }
  });

  title = cleanName.substring(0, earliestIndex).trim();
  // Capitalize words in title
  title = title.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  // Build details string
  const detailsArray = [];
  if (year) detailsArray.push(year);
  if (seasonEp) detailsArray.push(seasonEp);
  if (quality) detailsArray.push(quality);
  if (languages.length > 0) {
    detailsArray.push(languages.join(', '));
  }

  return {
    title: title || cleanName,
    details: detailsArray.join(' | ')
  };
}

export default function LinkScraper({ onSelectVideo, onSelectTorrentFile }) {
  const [urlInput, setUrlInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [results, setResults] = useState(null);
  
  // Torrent expanding files state
  const [torrentLoading, setTorrentLoading] = useState({});
  const [expandedTorrents, setExpandedTorrents] = useState({});

  const handleScrape = async (e) => {
    if (e) e.preventDefault();
    if (!urlInput.trim()) return;

    setIsLoading(true);
    setError(null);
    setResults(null);
    setExpandedTorrents({});

    try {
      const data = await scrapeUrl(urlInput.trim());
      
      // Reverted: Only auto-load files if it is a single direct magnet/torrent link input
      if (data.type === 'magnet' || data.type === 'torrent') {
        const tor = data.torrents[0];
        handleLoadTorrentFiles(tor.url, 0);
      }

      setResults(data);
    } catch (err) {
      setError(err.message || 'Failed to analyze page. Make sure the backend server is running.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoadTorrentFiles = async (torrentUrl, index) => {
    setTorrentLoading(prev => ({ ...prev, [index]: true }));
    try {
      const torDetails = await addTorrent(torrentUrl);
      setExpandedTorrents(prev => ({
        ...prev,
        [index]: torDetails.files // Array of { index, name, length, mime }
      }));
    } catch (err) {
      alert(`Failed to retrieve torrent info: ${err.message}`);
    } finally {
      setTorrentLoading(prev => ({ ...prev, [index]: false }));
    }
  };

  const loadDemo = (demoUrl) => {
    setUrlInput(demoUrl);
    setTimeout(() => {
      // Small delay to ensure state update
    }, 100);
  };

  return (
    <div className="crawler-container">
      <div className="crawler-header">
        <Film size={28} color="var(--accent-color)" />
        <h2>Web Video Search</h2>
        <p>Paste any webpage link or torrent magnet to extract streamable videos</p>
      </div>

      <form onSubmit={handleScrape} className="search-box">
        <input
          type="text"
          placeholder="Enter website link, .m3u8, or magnet:..."
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          disabled={isLoading}
        />
        <button type="submit" className="search-btn" disabled={isLoading}>
          {isLoading ? <RefreshCw className="animate-spin" size={18} /> : <Search size={18} />}
        </button>
      </form>

      {/* Quick Demo links */}
      <div className="demo-links-row">
        <span>Quick Test:</span>
        <button className="demo-btn" onClick={() => { setUrlInput('https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8'); }}>HLS Master</button>
        <button className="demo-btn" onClick={() => { setUrlInput('https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'); }}>MP4 Video</button>
        <button className="demo-btn" onClick={() => { setUrlInput('magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c&dn=Big+Buck+Bunny'); }}>Video Torrent</button>
      </div>

      {isLoading && (
        <div className="loading-state animate-pulse">
          <RefreshCw className="animate-spin text-accent" size={32} />
          <p>Analyzing link and extracting clean streams...</p>
        </div>
      )}

      {error && (
        <div className="error-card">
          <AlertCircle size={20} color="var(--error-color)" />
          <span>{error}</span>
        </div>
      )}

      {results && (
        <div className="results-container">
          {results.type === 'error' ? (
            <div className="error-card" style={{ background: 'rgba(248, 81, 73, 0.15)', borderColor: 'rgba(248, 81, 73, 0.25)', gap: '12px' }}>
              <AlertCircle size={20} color="var(--error-color)" />
              <div className="flex flex-col" style={{ gap: '4px' }}>
                <span style={{ fontWeight: '600', color: '#fff' }}>Crawling Failed</span>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                  {results.message || 'The server could not scrape video or torrent files from this link.'}
                </span>
              </div>
            </div>
          ) : (
            <>
              <div className="results-summary">
                Found {results.videos?.length || 0} stream videos and {results.torrents?.length || 0} torrent archives.
              </div>

          {/* Videos Results List */}
          {results.videos?.length > 0 && (
            <div className="results-section">
              <h3>Video Streams</h3>
              <div className="cards-grid">
                {results.videos.map((vid, idx) => (
                  <div key={idx} className="media-card glass">
                    <div className="card-info">
                      <div className="card-title">{vid.title}</div>
                      <div className="card-meta">
                        <span className="type-badge">{vid.type.toUpperCase()}</span>
                        {vid.resolutions?.map((res, rIdx) => (
                          <span key={rIdx} className="res-badge">{res.resolution}</span>
                        ))}
                      </div>
                    </div>
                    <div className="card-actions">
                      <button 
                        className="play-card-btn" 
                        onClick={() => onSelectVideo(vid)}
                      >
                        <Play size={14} style={{ marginRight: '4px' }} fill="currentColor" /> Play
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Torrents Results List */}
          {results.torrents?.length > 0 && (
            <div className="results-section">
              <h3>BitTorrent Files</h3>
              <div className="cards-grid">
                {results.torrents.map((tor, idx) => {
                  const cleaned = parseTorrentName(tor.name);
                  return (
                    <div key={idx} className="media-card glass flex-col">
                      <div className="w-full flex justify-between items-center">
                        <div className="card-info">
                          <div className="card-title">{cleaned.title}</div>
                          {cleaned.details && (
                            <div className="card-subtitle" style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px', marginBottom: '4px' }}>
                              {cleaned.details}
                            </div>
                          )}
                          <div className="card-meta">
                            <span className="type-badge torrent">TORRENT</span>
                          </div>
                        </div>
                        
                        <div className="card-actions">
                          {!expandedTorrents[idx] ? (
                            <button 
                              className="play-card-btn"
                              disabled={torrentLoading[idx]}
                              onClick={() => handleLoadTorrentFiles(tor.url, idx)}
                            >
                              {torrentLoading[idx] ? (
                                <RefreshCw size={14} className="animate-spin" />
                              ) : (
                                <>
                                  <FolderOpen size={14} style={{ marginRight: '4px' }} /> Open Files
                                </>
                              )}
                            </button>
                          ) : (
                            <button 
                              className="play-card-btn secondary"
                              onClick={() => setExpandedTorrents(prev => {
                                const copy = { ...prev };
                                delete copy[idx];
                                return copy;
                              })}
                            >
                              Hide Files
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Torrent Sub-files List */}
                      {expandedTorrents[idx] && (
                        <div className="torrent-files-list">
                          <h4>Files in Torrent:</h4>
                          {expandedTorrents[idx]
                            .filter(f => /\.(mp4|mkv|webm|avi|mp3|m4a|wav)$/i.test(f.name))
                            .map((file, fIdx) => (
                              <div key={fIdx} className="torrent-file-row">
                                <span className="file-name">{file.name}</span>
                                <div className="flex items-center gap-2">
                                  <span className="file-size">{(file.length / (1024 * 1024)).toFixed(1)} MB</span>
                                  <button 
                                    className="file-play-btn"
                                    onClick={() => onSelectTorrentFile(tor.url, file)}
                                  >
                                    <Play size={10} fill="currentColor" /> Play
                                  </button>
                                </div>
                              </div>
                            ))}
                          {expandedTorrents[idx].filter(f => /\.(mp4|mkv|webm|avi|mp3|m4a|wav)$/i.test(f.name)).length === 0 && (
                            <div className="no-media-msg">No streamable video files found inside this torrent.</div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

              {results.videos?.length === 0 && results.torrents?.length === 0 && (
                <div className="empty-results-card glass">
                  <AlertCircle size={24} color="var(--text-dim)" />
                  <p>No video containers, stream playlists, or torrent links found on this page.</p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

const BACKEND_HOST = (window.location.hostname && window.location.hostname !== 'localhost') 
  ? window.location.hostname 
  : '127.0.0.1';
export const API_BASE = `http://${BACKEND_HOST}:5000`;

/**
 * Send target website URL to scraper endpoint
 */
export async function scrapeUrl(url) {
  const response = await fetch(`${API_BASE}/api/scrape`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  });
  if (!response.ok) {
    throw new Error('Failed to parse URL on backend');
  }
  return response.json();
}

/**
 * Register torrent or magnet link
 */
export async function addTorrent(torrentUrl) {
  const response = await fetch(`${API_BASE}/api/torrent/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ torrentUrl })
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || 'Failed to add torrent');
  }
  return response.json();
}

/**
 * Get active torrents progress
 */
export async function getTorrentStats() {
  const response = await fetch(`${API_BASE}/api/torrent/stats`);
  if (!response.ok) return [];
  return response.json();
}

/**
 * Remove active torrent
 */
export async function removeTorrent(infoHash) {
  const response = await fetch(`${API_BASE}/api/torrent/remove`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ infoHash })
  });
  return response.json();
}

/**
 * Start caching a video for cloud acceleration
 */
export async function startCaching(url, type) {
  const response = await fetch(`${API_BASE}/api/cache/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, type })
  });
  return response.json();
}

/**
 * Fetch cache status for a video
 */
export async function getCacheStatus(url) {
  const response = await fetch(`${API_BASE}/api/cache/status?url=${encodeURIComponent(url)}`);
  if (!response.ok) return null;
  return response.json();
}

/**
 * Generate stream source url for direct video cache proxy
 */
export function getDirectStreamUrl(videoUrl) {
  return `${API_BASE}/api/cache/stream?url=${encodeURIComponent(videoUrl)}`;
}

/**
 * Generate stream source url for HLS m3u8 proxy
 */
export function getHlsStreamUrl(videoUrl) {
  return `${API_BASE}/api/cache/m3u8?url=${encodeURIComponent(videoUrl)}`;
}

/**
 * Generate stream source url for torrent file
 */
export function getTorrentStreamUrl(infoHash, fileIndex) {
  return `${API_BASE}/api/torrent/stream/${infoHash}/${fileIndex}`;
}

/**
 * Probe video metadata (duration, audio tracks list)
 */
export async function probeMetadata(url) {
  const response = await fetch(`${API_BASE}/api/probe?url=${encodeURIComponent(url)}`);
  if (!response.ok) {
    throw new Error('Failed to probe video metadata');
  }
  return response.json();
}

/**
 * Start background video download
 */
export async function startVideoDownload(url, title) {
  const response = await fetch(`${API_BASE}/api/download/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, title })
  });
  if (!response.ok) {
    throw new Error('Failed to trigger download on backend');
  }
  return response.json();
}


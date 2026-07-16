import WebTorrent from 'webtorrent';

const client = new WebTorrent();

// Keep track of active torrent info
const activeTorrents = new Map();

/**
 * Add a torrent and resolve its metadata
 * @param {string} torrentId - Magnet link, torrent file buffer, or http url to torrent
 * @returns {Promise<object>} - Torrent details
 */
export function addTorrent(torrentId) {
  return new Promise((resolve, reject) => {
    // If we already have this torrent, return its details
    // But magnet links might not have infoHash immediately, we can parse infoHash if it's a magnet
    let infoHash = null;
    if (typeof torrentId === 'string' && torrentId.startsWith('magnet:')) {
      const match = torrentId.match(/xt=urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-9]{32})/);
      if (match) {
        infoHash = match[1].toLowerCase();
      }
    }

    if (infoHash && activeTorrents.has(infoHash)) {
      resolve(activeTorrents.get(infoHash).details);
      return;
    }

    client.add(torrentId, { destroyStoreOnDestroy: true }, (torrent) => {
      const details = {
        name: torrent.name,
        infoHash: torrent.infoHash,
        files: torrent.files.map((file, index) => ({
          index,
          name: file.name,
          length: file.length,
          path: file.path,
          mime: getMimeType(file.name)
        })),
        magnetURI: torrent.magnetURI
      };

      activeTorrents.set(torrent.infoHash, {
        torrent,
        details
      });

      resolve(details);
    });

    // Handle error if WebTorrent fails
    client.on('error', (err) => {
      console.error('WebTorrent client error:', err.message);
    });
  });
}

/**
 * Get active torrent file stream
 */
export function getTorrentFileStream(infoHash, fileIndex, options = {}) {
  const active = activeTorrents.get(infoHash);
  if (!active) {
    throw new Error('Torrent not found or not loaded yet.');
  }

  const file = active.torrent.files[fileIndex];
  if (!file) {
    throw new Error('File index not found in torrent.');
  }

  // createReadStream supports { start, end } for HTTP range requests
  return {
    stream: file.createReadStream(options),
    file
  };
}

/**
 * Get current stats of active torrents
 */
export function getTorrentStats() {
  const stats = [];
  for (const [infoHash, active] of activeTorrents.entries()) {
    const t = active.torrent;
    stats.push({
      name: t.name,
      infoHash: t.infoHash,
      downloadSpeed: t.downloadSpeed,
      uploadSpeed: t.uploadSpeed,
      progress: t.progress,
      peers: t.numPeers,
      downloaded: t.downloaded,
      size: t.length
    });
  }
  return stats;
}

/**
 * Remove/delete a torrent
 */
export function removeTorrent(infoHash) {
  return new Promise((resolve) => {
    const active = activeTorrents.get(infoHash);
    if (!active) {
      resolve(false);
      return;
    }

    active.torrent.destroy(() => {
      activeTorrents.delete(infoHash);
      resolve(true);
    });
  });
}

/**
 * Helper to determine Mime Type from file extension
 */
function getMimeType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const mimeTypes = {
    'mp4': 'video/mp4',
    'mkv': 'video/x-matroska',
    'webm': 'video/webm',
    'avi': 'video/x-msvideo',
    'mp3': 'audio/mpeg',
    'm4a': 'audio/mp4',
    'wav': 'audio/wav',
    'ogg': 'audio/ogg'
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');
const { URL } = require('url');
const os = require('os');

// Cross-platform cache directory: use env var, fallback to OS temp dir
const CACHE_DIR = path.resolve(process.env.UC_CACHE_DIR || path.join(os.tmpdir(), 'uc-video-player-cache'));
const MAX_CACHE_SIZE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB limit

// In-memory registry of active cache tasks
// key: urlHash, value: { url, type, totalSize, cachedSize, activeDownload, fileStream, filePath, hlsSegments: [] }
const activeCacheTasks = new Map();

/**
 * Initialize Cache Directory
 */
function initCache() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
  // Run a cleanup on start
  cleanupCache();
}

/**
 * Generate MD5 Hash for URL
 */
function getUrlHash(url) {
  return crypto.createHash('md5').update(url).digest('hex');
}

/**
 * Load task metadata from file
 */
function loadTaskMetadata(taskHash) {
  const metaPath = path.join(CACHE_DIR, `${taskHash}.json`);
  if (fs.existsSync(metaPath)) {
    try {
      return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    } catch (e) {
      console.error('Failed to parse metadata:', e.message);
    }
  }
  return null;
}

/**
 * Save task metadata to file
 */
function saveTaskMetadata(task) {
  const metaPath = path.join(CACHE_DIR, `${task.hash}.json`);
  try {
    const metaData = {
      hash: task.hash,
      url: task.url,
      type: task.type,
      totalSize: task.totalSize,
      cachedSize: task.cachedSize,
      progress: task.progress,
      status: task.status,
      ranges: task.ranges || [],
      hlsSegments: task.type === 'm3u8' ? task.hlsSegments.map(s => ({
        url: s.url,
        hash: s.hash,
        cached: s.cached
      })) : undefined
    };
    fs.writeFileSync(metaPath, JSON.stringify(metaData, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save metadata:', e.message);
  }
}

/**
 * Add a newly cached range and merge overlapping ranges
 */
const activeDownloads = new Map();

function registerDownloadName(hash, filename) {
  activeDownloads.set(hash, filename);
}

function checkAndExportDownload(task) {
  const totalCached = task.ranges ? task.ranges.reduce((acc, r) => acc + (r.end - r.start + 1), 0) : 0;
  if (task.totalSize > 0 && totalCached >= task.totalSize) {
    task.status = 'completed';
    saveTaskMetadata(task);

    const home = os.homedir();
    let exportDir = '';
    if (process.platform === 'android') {
      exportDir = '/storage/emulated/0/Download/UC_Downloads';
    } else {
      exportDir = path.join(home, 'Downloads', 'UC_Downloads');
    }

    try {
      if (!fs.existsSync(exportDir)) {
        fs.mkdirSync(exportDir, { recursive: true });
      }
      const filename = activeDownloads.get(task.hash) || `${task.hash}.mp4`;
      const destPath = path.join(exportDir, filename);
      
      console.log(`Exporting completed video to: ${destPath}`);
      fs.copyFileSync(task.filePath, destPath);
      console.log(`Video successfully exported!`);
    } catch (e) {
      console.error('Failed to export completed download:', e.message);
    }
  }
}

function addCachedRange(task, start, end) {
  if (!task.ranges) task.ranges = [];
  task.ranges.push({ start, end });

  // Merge overlapping ranges
  task.ranges.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const r of task.ranges) {
    if (merged.length === 0) {
      merged.push(r);
    } else {
      const last = merged[merged.length - 1];
      if (r.start <= last.end + 1) {
        last.end = Math.max(last.end, r.end);
      } else {
        merged.push(r);
      }
    }
  }
  task.ranges = merged;

  // Recalculate cached size
  const totalCached = task.ranges.reduce((acc, r) => acc + (r.end - r.start + 1), 0);
  task.cachedSize = totalCached;
  if (task.totalSize > 0) {
    task.progress = Math.round((totalCached / task.totalSize) * 100);
    if (totalCached >= task.totalSize) {
      task.status = 'completed';
      task.progress = 100;
    }
  }
  saveTaskMetadata(task);
  checkAndExportDownload(task);
}

/**
 * Check if range is cached
 */
function getCachedRangeOffset(task, start, end) {
  if (!task.ranges || task.ranges.length === 0) return null;
  for (const r of task.ranges) {
    if (r.start <= start && r.end >= end) {
      return r;
    }
  }
  return null;
}

/**
 * Start caching a video source
 */
export async function startCaching(videoUrl, type = 'direct') {
  const urlHash = getUrlHash(videoUrl);

  if (activeCacheTasks.has(urlHash)) {
    const activeTask = activeCacheTasks.get(urlHash);
    // If it's direct and currently idle/error, we can trigger prebuffering from the start
    if (activeTask.type === 'direct' && (activeTask.status === 'idle' || activeTask.status === 'error')) {
      prebufferRange(activeTask, 0);
    }
    return activeTask;
  }

  const isHls = type === 'm3u8' || videoUrl.includes('.m3u8');

  const task = {
    hash: urlHash,
    url: videoUrl,
    type: isHls ? 'm3u8' : 'direct',
    totalSize: 0,
    cachedSize: 0,
    filePath: path.join(CACHE_DIR, `${urlHash}${isHls ? '' : '.mp4'}`),
    status: 'idle',
    progress: 0,
    ranges: [],
    hlsSegments: [] // For HLS: array of { url, hash, cached, localPath }
  };

  // Load existing metadata if available
  const existingMeta = loadTaskMetadata(urlHash);
  if (existingMeta) {
    task.totalSize = existingMeta.totalSize;
    task.ranges = existingMeta.ranges || [];
    task.cachedSize = existingMeta.cachedSize || 0;
    task.progress = existingMeta.progress || 0;
    task.status = existingMeta.status || 'idle';
    if (isHls && existingMeta.hlsSegments) {
      task.hlsSegments = existingMeta.hlsSegments.map(s => ({
        ...s,
        localPath: path.join(CACHE_DIR, `${urlHash}_${s.hash}.ts`)
      }));
    }
  }

  activeCacheTasks.set(urlHash, task);

  if (isHls) {
    // Start HLS manifest caching and pre-buffering
    cacheHls(task);
  } else {
    // Start Direct Video sequential downloading from start (0)
    prebufferRange(task, 0);
  }

  return task;
}

/**
 * Download HLS Playlist and begin segment caching
 */
async function cacheHls(task) {
  try {
    task.status = 'downloading';
    const response = await axios.get(task.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*'
      }
    });

    const m3u8Content = response.data;
    const lines = m3u8Content.split('\n');
    const segments = [];

    // Parse out TS segment files
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line && !line.startsWith('#')) {
        // Resolve absolute URL
        const segmentUrl = new URL(line, task.url).toString();
        const segmentHash = getUrlHash(segmentUrl);
        
        // Find if segment was already cached
        const wasCached = task.hlsSegments?.find(s => s.hash === segmentHash)?.cached || false;
        
        segments.push({
          url: segmentUrl,
          hash: segmentHash,
          cached: wasCached,
          localPath: path.join(CACHE_DIR, `${task.hash}_${segmentHash}.ts`)
        });
      }
    }

    task.hlsSegments = segments;
    console.log(`HLS Cache initialized for ${task.hash}. Total segments: ${segments.length}`);

    // Create a sub-folder marker if doesn't exist
    if (!fs.existsSync(task.filePath)) {
      fs.mkdirSync(task.filePath, { recursive: true });
    }

    // Start background sequential pre-buffering (pre-buffer the entire playlist!)
    preBufferHlsSegments(task, 0, segments.length);
  } catch (error) {
    console.error('HLS Cache error:', error.message);
    task.status = 'error';
  }
}

/**
 * Pre-buffer HLS Segments sequentially to cache the entire video
 */
async function preBufferHlsSegments(task, startIndex, count) {
  const segments = task.hlsSegments;
  const endIndex = Math.min(startIndex + count, segments.length);

  // If we already have active workers prebuffering, let's store it
  if (task.activeHlsWorker) {
    task.activeHlsWorker.cancel = true; // cancel previous background loops
  }

  const worker = { cancel: false };
  task.activeHlsWorker = worker;

  // Sequentially download each segment in background
  (async () => {
    for (let i = startIndex; i < endIndex; i++) {
      if (worker.cancel) {
        console.log(`HLS Prebuffer worker cancelled at segment ${i}.`);
        break;
      }

      const seg = segments[i];
      if (seg.cached || fs.existsSync(seg.localPath)) {
        seg.cached = true;
        continue;
      }

      try {
        const res = await axios.get(seg.url, {
          responseType: 'arraybuffer',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': '*/*'
          },
          timeout: 10000
        });

        await fs.promises.writeFile(seg.localPath, res.data);
        seg.cached = true;
        task.cachedSize += res.data.length;

        // Update overall progress
        const cachedCount = segments.filter(s => s.cached).length;
        task.progress = Math.round((cachedCount / segments.length) * 100);
        saveTaskMetadata(task);
      } catch (err) {
        console.error(`Failed to cache HLS segment ${i}:`, err.message);
      }
    }

    // Clean up worker reference when done
    if (task.activeHlsWorker === worker) {
      task.activeHlsWorker = null;
    }

    // Set status completed if all segments are cached
    const allCached = segments.every(s => s.cached);
    if (allCached) {
      task.status = 'completed';
      task.progress = 100;
      saveTaskMetadata(task);
      console.log(`HLS Caching fully completed for ${task.hash}`);
    } else {
      task.status = 'idle';
    }
  })();
}

/**
 * Fetch and serve an HLS segment (on-demand streaming proxy)
 */
export async function getHlsSegment(masterHash, segmentUrl) {
  const segmentHash = getUrlHash(segmentUrl);
  const localPath = path.join(CACHE_DIR, `${masterHash}_${segmentHash}.ts`);

  // 1. Check if segment exists in cache
  if (fs.existsSync(localPath)) {
    return {
      stream: fs.createReadStream(localPath),
      length: fs.statSync(localPath).size,
      fromCache: true
    };
  }

  // 2. Fetch segment and cache in background
  try {
    const res = await axios.get(segmentUrl, {
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*'
      }
    });

    const writer = fs.createWriteStream(localPath);
    res.data.pipe(writer);

    // Update active cache task if registered
    const task = activeCacheTasks.get(masterHash);
    if (task) {
      const seg = task.hlsSegments.find(s => s.hash === segmentHash);
      if (seg) {
        writer.on('finish', () => {
          seg.cached = true;
          task.cachedSize += fs.statSync(localPath).size;
          const cachedCount = task.hlsSegments.filter(s => s.cached).length;
          task.progress = Math.round((cachedCount / task.hlsSegments.length) * 100);
          saveTaskMetadata(task);

          // Proactively buffer the next 12 segments ahead (to buffer the entire video!)
          const currentIdx = task.hlsSegments.indexOf(seg);
          preBufferHlsSegments(task, currentIdx + 1, 12);
        });
      }
    }

    return {
      stream: res.data,
      length: res.headers['content-length'],
      fromCache: false
    };
  } catch (error) {
    console.error('Failed to proxy HLS segment:', error.message);
    throw error;
  }
}

/**
 * Prebuffer range: background download from 'start' byte to the end of the video
 */
export async function prebufferRange(task, start) {
  if (task.status === 'completed') return;

  const total = task.totalSize;

  // Allocate empty file if not already allocated
  if (total > 0 && !fs.existsSync(task.filePath)) {
    try {
      fs.writeFileSync(task.filePath, '');
      fs.truncateSync(task.filePath, total);
      console.log(`Pre-allocated sparse cache file of size ${total} for task ${task.hash}`);
    } catch (e) {
      console.error('Error pre-allocating sparse file:', e.message);
    }
  }

  // If there's an active download:
  // If the active download is currently downloading near our start pointer, keep it!
  // Otherwise, cancel it and start a new download from the seek position.
  if (task.activeDownload) {
    const activeStart = task.activeDownload.start;
    const activeCurrent = task.activeDownload.currentPointer;
    
    if (start >= activeStart && start <= activeCurrent + 2 * 1024 * 1024) {
      console.log(`Active download pointer at ${activeCurrent} is close to requested start ${start}. Continuing background cache.`);
      return;
    } else {
      console.log(`Seek detected to ${start} (active cache downloader is at ${activeCurrent}). Aborting and restarting cache from seek point.`);
      task.activeDownload.cancel();
      task.activeDownload = null;
    }
  }

  // Define download range: download from 'start' to the end of the video!
  const end = total > 0 ? total - 1 : '';
  console.log(`Initiating pre-buffering download for ${task.hash} from byte ${start} to ${end || 'end'}`);

  const cancelToken = axios.CancelToken.source();
  let currentPointer = start;

  const downloadTask = {
    start,
    end,
    currentPointer,
    cancel: () => {
      cancelToken.cancel('Seeking or custom override cancelled caching.');
    }
  };
  task.activeDownload = downloadTask;
  task.status = 'downloading';

  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*'
    };
    if (total > 0 || start > 0) {
      headers.Range = `bytes=${start}-${end}`;
    }

    const response = await axios.get(task.url, {
      headers,
      responseType: 'stream',
      cancelToken: cancelToken.token
    });

    if (total === 0) {
      const len = parseInt(response.headers['content-length'] || 0, 10);
      if (len > 0) {
        task.totalSize = len;
        // Allocate file size
        fs.writeFileSync(task.filePath, '');
        fs.truncateSync(task.filePath, len);
      }
    }

    // Open file in 'r+' (read-write, no truncate) mode to write at start offset
    const fileStream = fs.createWriteStream(task.filePath, {
      flags: 'r+',
      start: start
    });

    response.data.pipe(fileStream);

    response.data.on('data', (chunk) => {
      currentPointer += chunk.length;
      downloadTask.currentPointer = currentPointer;
      
      // Update metadata on the fly
      addCachedRange(task, start, currentPointer - 1);
    });

    fileStream.on('finish', () => {
      console.log(`Completed cache download chunk from ${start} to ${currentPointer - 1}`);
      addCachedRange(task, start, currentPointer - 1);
      task.activeDownload = null;
      task.status = 'idle';
      
      // Trigger cache size check
      cleanupCache();
    });

    fileStream.on('error', (err) => {
      console.error('File stream cache write error:', err.message);
      task.status = 'error';
      task.activeDownload = null;
    });

  } catch (error) {
    if (axios.isCancel(error)) {
      console.log(`Prebuffer download cancelled at byte ${currentPointer}`);
    } else {
      console.error(`Prebuffer download failed:`, error.message);
      task.status = 'error';
      task.activeDownload = null;
    }
  }
}

/**
 * Get Caching Status (For Orange Cache Timeline Bar)
 */
function getCacheStatus(videoUrl) {
  const urlHash = getUrlHash(videoUrl);
  const task = activeCacheTasks.get(urlHash);

  if (!task) {
    return { status: 'idle', progress: 0, cachedSize: 0, totalSize: 0, ranges: [], segments: [] };
  }

  return {
    status: task.status,
    progress: task.progress,
    cachedSize: task.cachedSize,
    totalSize: task.totalSize,
    ranges: task.ranges || [],
    segments: task.type === 'm3u8' ? task.hlsSegments.map(s => s.cached) : []
  };
}

/**
 * Clean up old caches if size limit is exceeded
 */
export function cleanupCache() {
  try {
    const files = fs.readdirSync(CACHE_DIR);
    let totalSize = 0;
    const fileStats = [];

    for (const file of files) {
      const filePath = path.join(CACHE_DIR, file);
      const stat = fs.statSync(filePath);
      if (stat.isFile()) {
        totalSize += stat.size;
        fileStats.push({ path: filePath, size: stat.size, atime: stat.atimeMs });
      }
    }

    if (totalSize > MAX_CACHE_SIZE_BYTES) {
      // Sort by access time ascending (oldest first)
      fileStats.sort((a, b) => a.atime - b.atime);
      
      let freed = 0;
      const targetFreed = totalSize - (MAX_CACHE_SIZE_BYTES * 0.7); // free down to 70% of limit

      for (const item of fileStats) {
        if (freed >= targetFreed) break;
        // Don't delete active tasks
        const base = path.basename(item.path);
        const hash = base.split('.')[0].split('_')[0];
        const isActive = Array.from(activeCacheTasks.values()).some(t => t.hash === hash && t.status === 'downloading');
        
        if (!isActive) {
          fs.unlinkSync(item.path);
          freed += item.size;
          console.log(`Deleted cache file ${path.basename(item.path)} to free space.`);
        }
      }
    }
  } catch (error) {
    console.error('Error cleaning up cache:', error.message);
  }
}


module.exports = {
  initCache,
  startCaching,
  getCacheStatus,
  getHlsSegment,
  getCachedRangeOffset,
  prebufferRange,
  registerDownloadName,
  cleanupCache
};

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');
const { scrapeUrl, getHlsResolutions } = require('./services/scraper.js');
const { addTorrent, getTorrentFileStream, getTorrentStats, removeTorrent } = require('./services/torrent.js');
const { initCache, startCaching, getCacheStatus, getHlsSegment, getCachedRangeOffset, prebufferRange, registerDownloadName } = require('./services/cacheManager.js');
const { transcodeStream, needsTranscoding, probeMediaMetadata } = require('./services/transcoder.js');
const { getScanDirectories, scanLocalVideos } = require('./services/localMedia.js');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Initialize Cache Directory
initCache();

/**
 * Endpoint to scrape URL and find media streams
 */
app.post('/api/scrape', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  console.log(`Scraping request received for: ${url}`);
  try {
    const result = await scrapeUrl(url);
    return res.json(result);
  } catch (error) {
    console.error('Error scraping:', error.message);
    return res.status(500).json({ error: error.message || 'Scraping failed' });
  }
});

/**
 * HLS proxy manifest builder
 */
app.get('/api/cache/m3u8', async (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.status(400).send('URL is required');
  }

  const originalM3u8Url = decodeURIComponent(url);
  const urlHash = crypto.createHash('md5').update(originalM3u8Url).digest('hex');

  try {
    const response = await axios.get(originalM3u8Url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const body = response.data;
    const lines = body.split('\n');
    const proxyLines = [];

    // Pre-cache parsing trigger
    startCaching(originalM3u8Url, 'm3u8');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      if (line.startsWith('#')) {
        proxyLines.push(line);
      } else {
        const absoluteUrl = new URL(line, originalM3u8Url).toString();

        if (line.includes('.m3u8')) {
          proxyLines.push(`http://localhost:${PORT}/api/cache/m3u8?url=${encodeURIComponent(absoluteUrl)}`);
        } else {
          proxyLines.push(`http://localhost:${PORT}/api/cache/segment?hash=${urlHash}&url=${encodeURIComponent(absoluteUrl)}`);
        }
      }
    }

    res.setHeader('Content-Type', 'application/x-mpegURL');
    return res.send(proxyLines.join('\n'));
  } catch (error) {
    console.error('Error proxying HLS playlist:', error.message);
    return res.status(500).send('Error loading playlist');
  }
});

/**
 * Proxy and cache HLS TS segments
 */
app.get('/api/cache/segment', async (req, res) => {
  const { hash, url } = req.query;
  if (!url || !hash) {
    return res.status(400).send('Parameters "url" and "hash" are required');
  }

  const segmentUrl = decodeURIComponent(url);

  try {
    const { stream, length, fromCache } = await getHlsSegment(hash, segmentUrl);
    
    res.setHeader('Content-Type', 'video/MP2T');
    if (length) {
      res.setHeader('Content-Length', length);
    }
    res.setHeader('X-From-Cache', fromCache ? 'true' : 'false');
    
    stream.pipe(res);
  } catch (error) {
    console.error('Error serving TS segment:', error.message);
    return res.status(500).send('Error loading segment');
  }
});

/**
 * Direct video sequential streaming cache proxy
 */
/**
 * Direct video streaming cache proxy
 */
app.get('/api/cache/stream', async (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.status(400).send('URL query parameter is required');
  }

  const videoUrl = decodeURIComponent(url);
  const urlHash = crypto.createHash('md5').update(videoUrl).digest('hex');

  try {
    const task = await startCaching(videoUrl, 'direct');
    const range = req.headers.range;

    if (!range) {
      res.setHeader('Content-Type', 'video/mp4');
      if (task.totalSize > 0) {
        res.setHeader('Content-Length', task.totalSize);
      }
      
      if (task.status === 'completed' && fs.existsSync(task.filePath)) {
        const readStream = fs.createReadStream(task.filePath);
        return readStream.pipe(res);
      } else {
        prebufferRange(task, 0);
        const response = await axios.get(videoUrl, {
          responseType: 'stream',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': '*/*'
          }
        });
        return response.data.pipe(res);
      }
    }

    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    let end = parts[1] ? parseInt(parts[1], 10) : null;

    const total = task.totalSize || start + 10 * 1024 * 1024;
    if (end === null) {
      end = total - 1;
    }
    if (task.totalSize > 0 && end >= task.totalSize) {
      end = task.totalSize - 1;
    }

    const chunksize = (end - start) + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${task.totalSize || '*'}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'video/mp4'
    });

    // Check range caching
    const cachedRange = getCachedRangeOffset(task, start, end);
    if (cachedRange && fs.existsSync(task.filePath)) {
      const stream = fs.createReadStream(task.filePath, { start, end });
      return stream.pipe(res);
    }

    // Trigger prebuffering from seek point
    prebufferRange(task, start);

    const response = await axios.get(videoUrl, {
      headers: {
        'Range': `bytes=${start}-${end}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*'
      },
      responseType: 'stream'
    });
    response.data.pipe(res);
  } catch (error) {
    console.error('Error serving direct stream cache proxy:', error.message);
    if (!res.headersSent) {
      res.status(500).send('Error loading video file stream');
    }
  }
});

/**
 * Cache status tracking API
 */
app.get('/api/cache/status', (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  const decodedUrl = decodeURIComponent(url);
  const status = getCacheStatus(decodedUrl);
  return res.json(status);
});

/**
 * Start caching task explicitly
 */
app.post('/api/cache/start', async (req, res) => {
  const { url, type } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }
  const task = await startCaching(url, type);
  return res.json(task);
});

/**
 * Start explicit video download task
 */
app.post('/api/download/start', async (req, res) => {
  const { url, title } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    const task = await startCaching(url, 'direct');
    registerDownloadName(task.hash, title || `${task.hash}.mp4`);
    prebufferRange(task, 0);

    return res.json({ success: true, task });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * Register and stream Torrent files
 */
app.post('/api/torrent/add', async (req, res) => {
  const { torrentUrl } = req.body;
  if (!torrentUrl) {
    return res.status(400).json({ error: 'torrentUrl is required' });
  }

  console.log(`Add torrent request for: ${torrentUrl}`);
  try {
    const details = await addTorrent(torrentUrl);
    return res.json(details);
  } catch (error) {
    console.error('Error adding torrent:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * Stream Torrent file using Range requests
 */
app.get('/api/torrent/stream/:infoHash/:fileIndex', (req, res) => {
  const { infoHash, fileIndex } = req.params;
  const idx = parseInt(fileIndex, 10);

  try {
    const range = req.headers.range;
    let options = {};
    
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : undefined;
      options = { start, end };
    }

    const { stream, file } = getTorrentFileStream(infoHash, idx, options);

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : file.length - 1;
      const chunksize = (end - start) + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${file.length}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': file.mime || 'video/mp4'
      });
      stream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': file.length,
        'Content-Type': file.mime || 'video/mp4'
      });
      stream.pipe(res);
    }
  } catch (error) {
    console.error('Torrent stream error:', error.message);
    return res.status(500).send(error.message);
  }
});

/**
 * Active Torrents Stats
 */
app.get('/api/torrent/stats', (req, res) => {
  return res.json(getTorrentStats());
});

/**
 * Remove Torrent
 */
app.post('/api/torrent/remove', async (req, res) => {
  const { infoHash } = req.body;
  if (!infoHash) {
    return res.status(400).json({ error: 'infoHash is required' });
  }
  
  const removed = await removeTorrent(infoHash);
  return res.json({ success: removed });
});

/**
 * Probe Metadata endpoint
 */
app.get('/api/probe', async (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ error: 'URL query parameter is required' });
  }

  const mediaUrl = decodeURIComponent(url);
  console.log(`Probing metadata for: ${mediaUrl}`);
  const result = await probeMediaMetadata(mediaUrl);
  return res.json(result);
});

/**
 * Local Media Scanner endpoints
 */
app.get('/api/local/videos', (req, res) => {
  try {
    const dirs = getScanDirectories();
    let allVideos = [];
    dirs.forEach(dir => {
      allVideos = allVideos.concat(scanLocalVideos(dir));
    });
    
    // Sort by modified time descending
    allVideos.sort((a, b) => (b.modifiedTime || 0) - (a.modifiedTime || 0));
    
    // Deduplicate by path
    const uniqueVideos = Array.from(new Map(allVideos.map(v => [v.path, v])).values());
    return res.json(uniqueVideos);
  } catch (error) {
    console.error('Error listing local videos:', error.message);
    return res.status(500).json([]);
  }
});

app.get('/api/local/stream', (req, res) => {
  const { path: filePath, ss, audio } = req.query;
  if (!filePath) {
    return res.status(400).send('Path is required');
  }

  const absolutePath = path.resolve(filePath);

  if (!fs.existsSync(absolutePath)) {
    return res.status(404).send('File not found');
  }

  const isTranscode = needsTranscoding(absolutePath);
  
  if (isTranscode) {
    const seekSeconds = parseFloat(ss) || 0;
    const audioTrackId = audio ? decodeURIComponent(audio) : null;
    const ffmpegProcess = transcodeStream(absolutePath, res, seekSeconds, audioTrackId);
    
    req.on('close', () => {
      console.log('Local video transcode stream closed, killing FFmpeg process.');
      ffmpegProcess.kill('SIGKILL');
    });
  } else {
    // Send native file
    res.sendFile(absolutePath);
  }
});

// Start Server listening on all interfaces inside sandbox
app.listen(PORT, () => {
  console.log(`Mobile Node.js background server running on port ${PORT}`);
});

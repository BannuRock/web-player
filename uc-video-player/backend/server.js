import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import crypto from 'crypto';
import { scrapeUrl, getHlsResolutions } from './services/scraper.js';
import { addTorrent, getTorrentFileStream, getTorrentStats, removeTorrent } from './services/torrent.js';
import { initCache, startCaching, getCacheStatus, getHlsSegment, getCachedRangeOffset, prebufferRange, registerDownloadName } from './services/cacheManager.js';
import { transcodeStream, needsTranscoding, probeMediaMetadata } from './services/transcoder.js';
import { getScanDirectories, scanLocalVideos } from './services/localMedia.js';

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Initialize backend caches
initCache();

// Prevent server crashes from premature socket/stream closes
process.on('uncaughtException', (err) => {
  console.error('Unhandled Exception Caught:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection Caught at:', promise, 'reason:', reason);
});

/**
 * Generate MD5 Hash
 */
function getUrlHash(url) {
  return crypto.createHash('md5').update(url).digest('hex');
}

/**
 * Scrape Endpoint: Resolves a website link into streamable videos and torrents
 */
app.post('/api/scrape', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  console.log(`Scraping request received for: ${url}`);
  const result = await scrapeUrl(url);
  return res.json(result);
});

/**
 * Transcode Stream endpoint: converts non-native video formats (MKV/AVI/etc.) in real-time
 */
app.get('/api/transcode/stream', (req, res) => {
  const { url, ss, audio } = req.query;
  if (!url) {
    return res.status(400).send('URL query parameter is required');
  }

  const mediaUrl = decodeURIComponent(url);
  const seekSeconds = parseFloat(ss) || 0;
  const audioTrackId = audio ? decodeURIComponent(audio) : null;

  // Spawns FFmpeg and pipes video output to client
  const ffmpegProcess = transcodeStream(mediaUrl, res, seekSeconds, audioTrackId);

  // Monitor client close events to kill the process and release CPU resources
  req.on('close', () => {
    console.log('Transcode stream closed, killing FFmpeg process.');
    ffmpegProcess.kill('SIGKILL');
  });
});

/**
 * Probe Metadata endpoint: inspects stream for durations and audio tracks list
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
 * HLS proxy manifest builder
 * Fetches original M3U8, rewrites sub-playlists or TS segments to proxy through backend
 */
app.get('/api/cache/m3u8', async (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.status(400).send('URL query parameter is required');
  }

  const originalM3u8Url = decodeURIComponent(url);
  const urlHash = getUrlHash(originalM3u8Url);

  try {
    const response = await axios.get(originalM3u8Url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const body = response.data;
    const lines = body.split('\n');
    const proxyLines = [];

    // Trigger cache worker in background
    startCaching(originalM3u8Url, 'm3u8');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) {
        proxyLines.push('');
        continue;
      }

      if (line.startsWith('#')) {
        proxyLines.push(line);
      } else {
        // Resolve absolute URL
        const absoluteUrl = new URL(line, originalM3u8Url).toString();

        if (line.includes('.m3u8')) {
          // This is a Master Playlist entry, proxy sub-playlists
          proxyLines.push(`http://localhost:${PORT}/api/cache/m3u8?url=${encodeURIComponent(absoluteUrl)}`);
        } else {
          // This is a TS segment, proxy segments
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
    
    // Serve stream
    stream.on('error', (err) => {
      console.error('HLS segment read error:', err.message);
    });
    stream.pipe(res);
  } catch (error) {
    console.error('Error serving TS segment:', error.message);
    if (!res.headersSent) {
      res.status(500).send('Error serving segment');
    }
  }
});

/**
 * Proxy and cache Direct Video streams (MP4/MKV)
 * Handles range requests and feeds from disk cache if range is already downloaded
 */
app.get('/api/cache/stream', async (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.status(400).send('URL query parameter is required');
  }

  const videoUrl = decodeURIComponent(url);
  const urlHash = getUrlHash(videoUrl);

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
      // Trigger full background cache
      prebufferRange(task, 0);
      try {
        const response = await axios.get(videoUrl, {
          responseType: 'stream',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': '*/*'
          }
        });
        return response.data.pipe(res);
      } catch (err) {
        if (!res.headersSent) {
          return res.status(500).send(err.message);
        }
      }
    }
  }

  // Parse byte range
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

  // Check if range is cached
  const cachedRange = getCachedRangeOffset(task, start, end);
  if (cachedRange && fs.existsSync(task.filePath)) {
    const stream = fs.createReadStream(task.filePath, { start, end });
    return stream.pipe(res);
  }

  // Range not fully cached. Trigger prebuffering from this seek position to the end!
  prebufferRange(task, start);

  try {
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
    console.error('Error proxying range chunk:', error.message);
    if (!res.headersSent) {
      res.status(500).send('Error loading chunk');
    }
  }
});

/**
 * Get Caching Status (For Orange Cache Timeline Bar)
 */
app.get('/api/cache/status', (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  const videoUrl = decodeURIComponent(url);
  const status = getCacheStatus(videoUrl);
  return res.json(status);
});

/**
 * Start cache task explicitly
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
 * Add Torrent Endpoint
 */
app.post('/api/torrent/add', async (req, res) => {
  const { torrentUrl } = req.body;
  if (!torrentUrl) {
    return res.status(400).json({ error: 'Torrent URL/Magnet is required' });
  }

  try {
    const details = await addTorrent(torrentUrl);
    return res.json(details);
  } catch (error) {
    console.error('Torrent add error:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * Torrent Streaming Route: Serves torrent files over HTTP range request
 */
app.get('/api/torrent/stream/:infoHash/:fileIndex', (req, res) => {
  const { infoHash, fileIndex } = req.params;
  const idx = parseInt(fileIndex, 10);

  const range = req.headers.range;
  const options = {};

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    options.start = parseInt(parts[0], 10);
    options.end = parts[1] ? parseInt(parts[1], 10) : undefined;
  }

  try {
    const { stream, file } = getTorrentFileStream(infoHash, idx, options);

    if (range) {
      const start = options.start;
      const end = options.end !== undefined ? options.end : file.length - 1;
      const chunksize = (end - start) + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${file.length}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': getMimeType(file.name)
      });
    } else {
      res.writeHead(200, {
        'Content-Length': file.length,
        'Content-Type': getMimeType(file.name)
      });
    }

    stream.on('error', (err) => {
      console.error('Torrent read stream error:', err.message);
    });
    stream.pipe(res);
  } catch (error) {
    console.error('Torrent stream error:', error.message);
    if (!res.headersSent) {
      res.status(500).send(error.message);
    }
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

// Helper to determine Mime Type from file extension
function getMimeType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const mimeTypes = {
    'mp4': 'video/mp4',
    'mkv': 'video/x-matroska',
    'webm': 'video/webm',
    'avi': 'video/x-msvideo'
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

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
    
    // Sort by modified time descending to show newest first
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
    // Send native file (Express res.sendFile handles byte range seeks automatically!)
    res.sendFile(absolutePath);
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});

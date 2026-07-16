import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';

/**
 * Checks if a filename or URL needs transcoding for browser playback.
 * Browsers natively support MP4 (H.264/AAC), WebM, and M3U8.
 * MKV, AVI, WMV, FLV, H.265 (HEVC), and AC3 audio usually need transcoding.
 */
export function needsTranscoding(filename) {
  if (!filename) return false;
  const ext = filename.split('.').pop()?.split('?')[0]?.toLowerCase();
  const nonNativeExts = ['mkv', 'avi', 'flv', 'wmv', 'mov', 'ts', 'mpg', 'mpeg', 'asf'];
  return nonNativeExts.includes(ext);
}

/**
 * Transcodes any video stream to fragmented MP4 (H.264/AAC) in real-time
 * and pipes it to the HTTP response.
 * 
 * @param {string} inputUrl - Source URL or local path
 * @param {object} res - Express response object
 * @param {number} seekSeconds - Start offset for playback seeking (in seconds)
 * @returns {object} - Spawned FFmpeg process instance
 */
export function transcodeStream(inputUrl, res, seekSeconds = 0, audioTrackId = null) {
  const args = [];

  // Seek position (MUST be before -i for fast input seeking)
  if (seekSeconds > 0) {
    args.push('-ss', seekSeconds.toString());
  }

  // Input source
  args.push('-i', inputUrl);

  // Map streams: force first video track and selected audio track
  if (audioTrackId) {
    args.push('-map', '0:v:0', '-map', audioTrackId);
  } else {
    // Map first video track and first audio track (if it exists, ? makes it optional)
    args.push('-map', '0:v:0', '-map', '0:a?');
  }

  // Video settings: Force H.264, veryfast preset, higher bitrate for crisp 1080p
  args.push(
    '-vcodec', 'libx264',
    '-preset', 'veryfast',
    '-tune', 'zerolatency',
    '-crf', '21',
    '-maxrate', '6000k',
    '-bufsize', '12000k',
    '-pix_fmt', 'yuv420p'
  );

  // Audio settings: Force AAC
  args.push(
    '-acodec', 'aac',
    '-b:a', '128k',
    '-ac', '2'
  );

  // Format settings: Fragmented MP4 streamable over HTTP
  args.push(
    '-f', 'mp4',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof+faststart',
    '-metadata', 'title=UC Cloud Accelerated'
  );

  // Pipe to stdout
  args.push('pipe:1');

  console.log(`Spawning FFmpeg transcode from: ${inputUrl} at ${seekSeconds}s (Audio: ${audioTrackId || 'default'})`);
  
  const ffmpegProcess = spawn(ffmpegPath, args);

  // Set response headers for video streaming
  res.writeHead(200, {
    'Content-Type': 'video/mp4',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  // Pipe stdout to HTTP response
  ffmpegProcess.stdout.pipe(res);

  // Error handling
  ffmpegProcess.stderr.on('data', (data) => {
    // FFmpeg output is sent to stderr by design.
    // Uncomment for debugging if needed:
    // console.log(`FFmpeg: ${data.toString()}`);
  });

  ffmpegProcess.on('error', (err) => {
    console.error('FFmpeg process error:', err.message);
    if (!res.headersSent) {
      res.status(500).send('Transcoding failed');
    }
  });

  ffmpegProcess.on('exit', (code) => {
    console.log(`FFmpeg transcoder exited with code ${code}`);
  });

  return ffmpegProcess;
}

export function probeMediaMetadata(inputUrl) {
  return new Promise((resolve) => {
    const args = ['-hide_banner', '-i', inputUrl];
    const ffmpegProcess = spawn(ffmpegPath, args);

    let output = '';
    
    // FFmpeg output is sent to stderr
    ffmpegProcess.stderr.on('data', (data) => {
      output += data.toString();
    });

    ffmpegProcess.on('exit', () => {
      const result = {
        duration: 0,
        audioTracks: []
      };

      // 1. Parse Duration (e.g. Duration: 02:30:15.12)
      const durationMatch = output.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2})/i);
      if (durationMatch) {
        const hrs = parseInt(durationMatch[1], 10);
        const mins = parseInt(durationMatch[2], 10);
        const secs = parseInt(durationMatch[3], 10);
        result.duration = (hrs * 3600) + (mins * 60) + secs;
      }

      // 2. Parse Audio Streams (e.g. Stream #0:1(tam): Audio: ac3)
      const lines = output.split('\n');
      lines.forEach(line => {
        if (line.includes('Stream #0:') && line.includes('Audio:')) {
          const streamIdMatch = line.match(/Stream #0:(\d+)/);
          if (streamIdMatch) {
            const streamIndex = streamIdMatch[1];
            const fullStreamId = `0:${streamIndex}`;
            
            const langMatch = line.match(/Stream #0:\d+\((.*?)\)/);
            const language = langMatch ? langMatch[1] : 'und';

            const codecMatch = line.match(/Audio:\s*(\w+)/);
            const codec = codecMatch ? codecMatch[1] : 'unknown';

            let label = `Audio Track ${result.audioTracks.length + 1}`;
            if (language !== 'und') {
              const langNames = {
                'tam': 'Tamil',
                'tel': 'Telugu',
                'hin': 'Hindi',
                'mal': 'Malayalam',
                'kan': 'Kannada',
                'eng': 'English',
                'fre': 'French',
                'spa': 'Spanish',
                'ger': 'German',
                'rus': 'Russian'
              };
              label = langNames[language.toLowerCase()] || `Language: ${language.toUpperCase()}`;
            }

            result.audioTracks.push({
              id: fullStreamId,
              index: streamIndex,
              language,
              codec,
              label: `${label} (${codec.toUpperCase()})`
            });
          }
        }
      });

      resolve(result);
    });
  });
}

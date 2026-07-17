const fs = require('fs');
const path = require('path');
const os = require('os');

const SUPPORTED_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.webm', '.flv', '.wmv', '.mov', '.ts', '.m3u8'];

/**
 * Returns standard directories to scan for local media files (supports PC & Android paths)
 */
function getScanDirectories() {
  const home = os.homedir();
  const dirs = [];
  
  // Android standard public folders
  const androidDownload = '/storage/emulated/0/Download';
  const androidMovies = '/storage/emulated/0/Movies';
  const androidSdcardDownload = '/sdcard/Download';
  
  if (fs.existsSync(androidDownload)) dirs.push(androidDownload);
  if (fs.existsSync(androidMovies)) dirs.push(androidMovies);
  if (fs.existsSync(androidSdcardDownload)) dirs.push(androidSdcardDownload);

  // Windows Videos folder
  const winVideos = path.join(home, 'Videos');
  if (fs.existsSync(winVideos)) dirs.push(winVideos);

  // Downloads folder (common place for downloaded movies/videos)
  const winDownloads = path.join(home, 'Downloads');
  if (fs.existsSync(winDownloads)) dirs.push(winDownloads);

  // Default project cache folder (fallback)
  const projectCache = path.join(process.cwd(), 'videos-cache');
  if (!fs.existsSync(projectCache)) {
    try {
      fs.mkdirSync(projectCache, { recursive: true });
    } catch {}
  }
  dirs.push(projectCache);

  return [...new Set(dirs)];
}

/**
 * Recursively scan directories for video files
 */
function scanLocalVideos(dirPath, depth = 0, maxDepth = 2) {
  let results = [];
  if (depth > maxDepth) return results;

  try {
    if (!fs.existsSync(dirPath)) return results;
    const stats = fs.statSync(dirPath);
    if (!stats.isDirectory()) return results;

    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      // Skip hidden folders and files
      if (file.startsWith('.')) continue;

      const fullPath = path.join(dirPath, file);
      try {
        const fileStats = fs.statSync(fullPath);
        if (fileStats.isDirectory()) {
          // Recurse directories
          results = results.concat(scanLocalVideos(fullPath, depth + 1, maxDepth));
        } else {
          // Check video extension
          const ext = path.extname(file).toLowerCase();
          if (SUPPORTED_EXTENSIONS.includes(ext)) {
            results.push({
              name: file,
              path: fullPath,
              size: fileStats.size,
              folder: path.basename(dirPath),
              modifiedTime: fileStats.mtimeMs
            });
          }
        }
      } catch {}
    }
  } catch (error) {
    console.error(`Error scanning directory ${dirPath}:`, error.message);
  }

  return results;
}

module.exports = {
  getScanDirectories,
  scanLocalVideos
};

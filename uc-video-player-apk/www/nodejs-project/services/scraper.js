const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');
const https = require('https');

const sslAgent = new https.Agent({
  rejectUnauthorized: false
});

// A helper list of common ad domains or keyword filters to bypass ads
const AD_KEYWORDS = [
  'adsystem', 'adserver', 'popads', 'onclickads', 'exoclick', 'doubleclick',
  'googleads', 'analytics', 'telemetry', 'pixel', 'advertis', 'banner',
  'tracking', 'sponsor', 'affiliate'
];

/**
 * Checks if a string contains ad keywords
 */
function isAdUrl(url) {
  if (!url) return true;
  const lowerUrl = url.toLowerCase();
  return AD_KEYWORDS.some(keyword => lowerUrl.includes(keyword));
}

/**
 * Parse an HLS master playlist (.m3u8) to extract resolutions
 */
async function getHlsResolutions(m3u8Url) {
  try {
    const response = await axios.get(m3u8Url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 5000
    });
    
    const content = response.data;
    if (!content.includes('#EXT-X-STREAM-INF')) {
      return [{ resolution: 'Source', url: m3u8Url }];
    }

    const lines = content.split('\n');
    const resolutions = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        let resolutionName = 'Auto';
        const resMatch = line.match(/RESOLUTION=(\d+)x(\d+)/i);
        if (resMatch) {
          const height = resMatch[2];
          resolutionName = `${height}p`;
        }

        const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/i);
        const bandwidth = bandwidthMatch ? parseInt(bandwidthMatch[1], 10) : 0;

        let urlLine = '';
        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = lines[j].trim();
          if (nextLine && !nextLine.startsWith('#')) {
            urlLine = nextLine;
            i = j;
            break;
          }
        }

        if (urlLine) {
          const absoluteUrl = new URL(urlLine, m3u8Url).toString();
          resolutions.push({
            resolution: resolutionName,
            bandwidth: bandwidth,
            url: absoluteUrl
          });
        }
      }
    }

    resolutions.sort((a, b) => b.bandwidth - a.bandwidth);
    return resolutions.length > 0 ? resolutions : [{ resolution: 'Source', url: m3u8Url }];
  } catch (error) {
    console.error('Error fetching HLS resolutions:', error.message);
    return [{ resolution: 'Source', url: m3u8Url }];
  }
}

/**
 * Clean and resolve relative URL against base URL
 */
function resolveUrl(baseUrl, targetUrl) {
  try {
    return new URL(targetUrl, baseUrl).toString();
  } catch {
    return targetUrl;
  }
}

function getMagnetName(magnetUrl) {
  try {
    const match = magnetUrl.match(/[&?]dn=([^&]+)/i);
    if (match) {
      return decodeURIComponent(match[1].replace(/\+/g, ' '));
    }
  } catch {}
  return 'Magnet Resource';
}

/**
 * Primary web scraping routine with rotating User-Agents and automatic retries
 */
async function scrapeUrl(targetUrl) {
  try {
    const cleanTargetUrl = targetUrl.trim();
    
    // 1. Check if the target URL itself is a direct media file or magnet
    if (cleanTargetUrl.startsWith('magnet:')) {
      const name = getMagnetName(cleanTargetUrl);
      return {
        type: 'magnet',
        title: name,
        torrents: [{ url: cleanTargetUrl, name, magnet: true }],
        videos: []
      };
    }

    if (cleanTargetUrl.endsWith('.torrent')) {
      return {
        type: 'torrent',
        title: 'Torrent File',
        torrents: [{ url: cleanTargetUrl, name: cleanTargetUrl.split('/').pop() || 'Torrent Resource', magnet: false }],
        videos: []
      };
    }

    // Direct Video File Check
    if (/\.(mp4|mkv|webm|avi|m3u8)(\?.*)?$/i.test(cleanTargetUrl)) {
      const isHls = cleanTargetUrl.includes('.m3u8');
      const filenameParts = cleanTargetUrl.split('/');
      const lastFilenamePart = filenameParts[filenameParts.length - 1];
      const filename = (lastFilenamePart ? lastFilenamePart.split('?')[0] : '') || 'Direct Stream';
      let resolutions = [{ resolution: 'Source', url: cleanTargetUrl }];
      
      if (isHls) {
        try {
          resolutions = await getHlsResolutions(cleanTargetUrl);
        } catch {}
      }

      return {
        type: 'direct',
        title: filename,
        videos: [{
          url: cleanTargetUrl,
          title: filename,
          type: isHls ? 'm3u8' : 'direct',
          resolutions
        }],
        torrents: []
      };
    }

    // User agent rotation pool
    const USER_AGENTS = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0'
    ];

    let lastError = null;

    // Retry loop (Up to 3 times)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
        console.log(`Scraping attempt ${attempt + 1} for URL: ${cleanTargetUrl} using Agent: ${userAgent}`);

        const response = await axios.get(cleanTargetUrl, {
          headers: {
            'User-Agent': userAgent,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Cache-Control': 'max-age=0',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': '"Windows"',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1'
          },
          timeout: 8000
        });

        const html = response.data;
        const $ = cheerio.load(html);

        // Check if page contains Cloudflare anti-bot verification challenge
        const pageText = $('body').text().toLowerCase();
        if (pageText.includes('cloudflare') && (pageText.includes('checking your browser') || pageText.includes('verify you are human') || pageText.includes('enable javascript'))) {
          console.warn(`Cloudflare Challenge detected on attempt ${attempt + 1}. Retrying with another Agent.`);
          lastError = new Error('Cloudflare human verification page returned');
          continue;
        }

        const title = $('title').text().trim() || 'Scraped Media Page';
        
        const videosMap = new Map();
        const torrentsMap = new Map();

        // Helper to add clean video url
        const addVideo = (videoUrl, videoTitle, videoType) => {
          const resolved = resolveUrl(cleanTargetUrl, videoUrl);
          if (isAdUrl(resolved)) return;
          if (videosMap.has(resolved)) return;

          videosMap.set(resolved, {
            url: resolved,
            title: videoTitle || `Video ${videosMap.size + 1}`,
            type: videoType,
            resolutions: [{ resolution: 'Source', url: resolved }]
          });
        };

        // Helper to add torrent url
        const addTorrent = (torrentUrl, name, isMagnet = false) => {
          const resolved = isMagnet ? torrentUrl : resolveUrl(cleanTargetUrl, torrentUrl);
          if (torrentsMap.has(resolved)) return;
          
          let displayName = name;
          if (isMagnet) {
            const parsedName = getMagnetName(resolved);
            if (parsedName && parsedName !== 'Magnet Resource' && (!displayName || displayName.toLowerCase().includes('magnet') || displayName.trim().length < 3)) {
              displayName = parsedName;
            }
          }

          torrentsMap.set(resolved, {
            url: resolved,
            name: displayName || `Torrent ${torrentsMap.size + 1}`,
            magnet: isMagnet
          });
        };

        // Parse HTML5 Video Elements
        $('video').each((_, elem) => {
          const src = $(elem).attr('src');
          if (src) {
            const type = src.includes('.m3u8') ? 'm3u8' : 'direct';
            addVideo(src, 'HTML5 Video', type);
          }
        });

        $('video source').each((_, elem) => {
          const src = $(elem).attr('src');
          if (src) {
            const type = src.includes('.m3u8') ? 'm3u8' : 'direct';
            addVideo(src, 'HTML5 Source', type);
          }
        });

        // Parse Anchor Links (to direct video files and torrents)
        $('a').each((_, elem) => {
          const href = $(elem).attr('href');
          const text = $(elem).text().trim();
          
          if (!href) return;

          if (href.startsWith('magnet:')) {
            addTorrent(href, text || 'Magnet Link', true);
          } else if (/\.torrent$/i.test(href)) {
            addTorrent(href, text || href.split('/').pop(), false);
          } else if (/\.(mp4|mkv|webm|avi|m3u8)(\?.*)?$/i.test(href)) {
            const type = href.includes('.m3u8') ? 'm3u8' : 'direct';
            const hrefParts = href.split('/');
            const lastHrefPart = hrefParts[hrefParts.length - 1];
            const fallbackName = lastHrefPart ? lastHrefPart.split('?')[0] : '';
            addVideo(href, text || fallbackName, type);
          }
        });

        // Parse Embedded Iframes (YouTube / Vimeo / e.t.c)
        $('iframe').each((_, elem) => {
          const src = $(elem).attr('src');
          if (!src) return;
          
          const resolved = resolveUrl(cleanTargetUrl, src);
          if (resolved.includes('youtube.com/embed/') || resolved.includes('youtu.be/')) {
            addVideo(resolved, 'YouTube Embed', 'youtube');
          } else if (resolved.includes('player.vimeo.com/video/')) {
            addVideo(resolved, 'Vimeo Embed', 'vimeo');
          }
        });

        // Search scripts and raw html for stream links (.m3u8, .mp4, magnet) using regex
        const m3u8Regex = /https?:\/\/[^\s"']+\.m3u8[^\s"']*/gi;
        const mp4Regex = /https?:\/\/[^\s"']+\.(mp4|mkv|webm)[^\s"']*/gi;
        const magnetRegex = /magnet:\?[^\s"']+/gi;

        $('script').each((_, elem) => {
          const scriptContent = $(elem).html();
          if (!scriptContent) return;

          let match;
          
          // Look for M3U8
          while ((match = m3u8Regex.exec(scriptContent)) !== null) {
            addVideo(match[0], 'HLS Dynamic Playlist', 'm3u8');
          }

          // Look for MP4
          while ((match = mp4Regex.exec(scriptContent)) !== null) {
            addVideo(match[0], 'Direct Dynamic Stream', 'direct');
          }

          // Look for Magnets in script text
          while ((match = magnetRegex.exec(scriptContent)) !== null) {
            addTorrent(match[0], 'Magnet Link (Script)', true);
          }
        });

        const videos = Array.from(videosMap.values());
        const torrents = Array.from(torrentsMap.values());

        // If we found some media, return the results immediately
        if (videos.length > 0 || torrents.length > 0) {
          return {
            type: 'html',
            title,
            videos,
            torrents
          };
        }

        console.warn(`Attempt ${attempt + 1} scraped page successfully but extracted 0 media streams.`);
        lastError = new Error('No video containers, stream playlists, or torrent links found on this page.');
      } catch (err) {
        console.error(`Scrape attempt ${attempt + 1} failed:`, err.message);
        lastError = err;
      }
    }

    // All attempts failed
    return {
      type: 'error',
      title: 'Scraping Failed',
      message: lastError ? lastError.message : 'Scraping failed after rotating agents',
      videos: [],
      torrents: []
    };
  } catch (error) {
    console.error('Error scraping website:', error.message);
    return {
      type: 'error',
      title: 'Scraping Failed',
      message: error.message,
      videos: [],
      torrents: []
    };
  }
}

module.exports = {
  scrapeUrl,
  getHlsResolutions
};

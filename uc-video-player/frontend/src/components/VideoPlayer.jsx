import React, { useRef, useState, useEffect } from 'react';
import Hls from 'hls.js';
import { 
  Play, Pause, RotateCcw, Volume2, VolumeX, Maximize, 
  Minimize, Settings, FastForward, Activity, Download, 
  Tv, SkipForward, Lock, Unlock, Crop
} from 'lucide-react';
import { getCacheStatus, API_BASE } from '../utils/api';

export default function VideoPlayer({ url, type, title, resolutions = [], onDownload, isTranscoded = false, transcodedBaseUrl = null, probedDuration = 0, audioTracks = [] }) {
  const videoRef = useRef(null);
  const playerContainerRef = useRef(null);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [selectedQuality, setSelectedQuality] = useState(resolutions[0]?.url || url);
  const [transcodeSeekOffset, setTranscodeSeekOffset] = useState(0);
  const [selectedAudioTrack, setSelectedAudioTrack] = useState(null);
  const [showAudioMenu, setShowAudioMenu] = useState(false);
  const [forceTranscode, setForceTranscode] = useState(false);

  const activeIsTranscoded = isTranscoded || forceTranscode;
  const displayDuration = probedDuration > 0 ? probedDuration : (((activeIsTranscoded && (duration === Infinity || duration === 0)) ? 7200 : duration));
  const displayCurrentTime = activeIsTranscoded ? Math.min(currentTime + transcodeSeekOffset, displayDuration) : currentTime;
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);

  // Cloud acceleration cache tracking
  const [cacheProgress, setCacheProgress] = useState(0);
  const [cachedRanges, setCachedRanges] = useState([]);
  const [hlsSegments, setHlsSegments] = useState([]);
  const [totalSize, setTotalSize] = useState(0);

  // Premium XPlayer features
  const [isLocked, setIsLocked] = useState(false);
  const [aspectRatio, setAspectRatio] = useState('fit'); // 'fit' | 'stretch' | 'zoom' | '16:9' | '4:3'
  const [zoomScale, setZoomScale] = useState(1.0);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);

  // Gestures state
  const [brightness, setBrightness] = useState(1.0); // Simulated screen brightness (0.1 to 1.0)
  const [gestureType, setGestureType] = useState(null); // 'volume' | 'brightness' | 'seek' | 'pinch' | null
  const [gestureValue, setGestureValue] = useState(0); // value display during swipe
  
  const touchStartRef = useRef({ x: 0, y: 0, val: 0 });
  const initialPinchDistRef = useRef(0);
  const initialZoomScaleRef = useRef(1.0);
  const initialPanRef = useRef({ x: 0, y: 0 });
  const controlsTimeoutRef = useRef(null);

  // Audio Booster (Web Audio API)
  const audioCtxRef = useRef(null);
  const gainNodeRef = useRef(null);
  const sourceNodeRef = useRef(null);

  // HLS reference
  const hlsRef = useRef(null);

  // Buffering state
  const [isBuffering, setIsBuffering] = useState(true);

  // Reset states when the base video URL changes
  useEffect(() => {
    setSelectedQuality(resolutions[0]?.url || url);
    setSelectedAudioTrack(null);
    setTranscodeSeekOffset(0);
    setForceTranscode(false);
    setZoomScale(1.0);
    setPanX(0);
    setPanY(0);
  }, [url, resolutions]);

  // Load and bind Video URL (handles standard & HLS stream formats)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.playbackRate = playbackRate;

    // Destroy existing HLS wrapper
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const isM3u8 = selectedQuality.includes('.m3u8') || type === 'm3u8';

    // Parse seek offset if url contains &ss= seek parameter
    if (isTranscoded && selectedQuality.includes('&ss=')) {
      const match = selectedQuality.match(/&ss=(\d+(\.\d+)?)/);
      if (match) {
        setTranscodeSeekOffset(parseFloat(match[1]));
      }
    } else if (!selectedQuality.includes('&ss=')) {
      setTranscodeSeekOffset(0);
    }

    // Parse audio track query param
    if (isTranscoded && selectedQuality.includes('&audio=')) {
      const audioMatch = selectedQuality.match(/&audio=([^&]+)/);
      if (audioMatch) {
        setSelectedAudioTrack(decodeURIComponent(audioMatch[1]));
      }
    }

    if (isM3u8 && !isTranscoded) {
      if (Hls.isSupported()) {
        const hls = new Hls({
          maxMaxBufferLength: 120, // Buffer entire video ahead as fast as possible
          enableWorker: true
        });
        hlsRef.current = hls;
        hls.loadSource(selectedQuality);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (isPlaying) video.play().catch(() => {});
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = selectedQuality;
      }
    } else {
      video.src = selectedQuality;
    }

    if (isPlaying) {
      video.play().catch(() => setIsPlaying(false));
    }
  }, [selectedQuality, type, isTranscoded]);

  // Track cache status from server for the Orange Cache Bar and Blue Range Buffer Lines
  useEffect(() => {
    let interval = null;
    if (url) {
      const updateCache = async () => {
        try {
          const data = await getCacheStatus(url);
          if (data) {
            if (data.progress !== undefined) {
              setCacheProgress(data.progress);
            }
            if (data.ranges !== undefined) {
              setCachedRanges(data.ranges);
            }
            if (data.segments !== undefined) {
              setHlsSegments(data.segments);
            }
            if (data.totalSize !== undefined) {
              setTotalSize(data.totalSize);
            }
          }
        } catch {}
      };
      
      updateCache();
      interval = setInterval(updateCache, 2000); // query status every 2 seconds
    }
    return () => clearInterval(interval);
  }, [url]);

  // Cleanup Web Audio nodes on unmount
  useEffect(() => {
    return () => {
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
      }
    };
  }, []);

  // Manage show/hide controls overlay auto-hiding
  const triggerShowControls = () => {
    if (isLocked) return; // ignore control triggers when screen is locked
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    
    if (isPlaying) {
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
        setShowQualityMenu(false);
        setShowSpeedMenu(false);
      }, 4000);
    }
  };

  const handlePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
    } else {
      video.play().catch(() => {});
      setIsPlaying(true);
    }
    triggerShowControls();
  };

  const handleSeek = (e) => {
    const video = videoRef.current;
    if (!video) return;
    const seekTime = parseFloat(e.target.value);
    if (activeIsTranscoded) {
      setTranscodeSeekOffset(seekTime);
      const targetBase = transcodedBaseUrl || `${API_BASE}/api/transcode/stream?url=${encodeURIComponent(url)}`;
      let nextUrl = `${targetBase}&ss=${Math.floor(seekTime)}`;
      if (selectedAudioTrack) {
        nextUrl += `&audio=${encodeURIComponent(selectedAudioTrack)}`;
      }
      setSelectedQuality(nextUrl);
      setCurrentTime(0);
    } else {
      video.currentTime = seekTime;
      setCurrentTime(seekTime);
    }
    triggerShowControls();
  };

  // Initialize Web Audio API node chain
  const initAudioBoost = () => {
    if (audioCtxRef.current) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioContext();
      const video = videoRef.current;
      if (video) {
        // Must configure crossOrigin for Web Audio captures
        video.crossOrigin = "anonymous";
        const source = ctx.createMediaElementSource(video);
        const gainNode = ctx.createGain();
        source.connect(gainNode);
        gainNode.connect(ctx.destination);
        
        audioCtxRef.current = ctx;
        gainNodeRef.current = gainNode;
        sourceNodeRef.current = source;
        console.log("Audio booster context successfully initialized!");
      }
    } catch (e) {
      console.warn("Failed to initialize audio booster:", e.message);
    }
  };

  const handleVolumeChange = (e) => {
    const vol = parseFloat(e.target.value);
    setVolume(vol);
    applyVolume(vol);
    triggerShowControls();
  };

  const applyVolume = (vol) => {
    const video = videoRef.current;
    if (!video) return;

    if (vol > 1.0) {
      // Audio boost required!
      initAudioBoost();
      if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume();
      }
      if (gainNodeRef.current) {
        gainNodeRef.current.gain.value = vol; // boost node gain
      }
      video.volume = 1.0; // limit video element volume to 1.0 to avoid clipping
    } else {
      // Normal volume
      if (gainNodeRef.current) {
        gainNodeRef.current.gain.value = 1.0;
      }
      video.volume = vol;
    }
    setIsMuted(vol === 0);
  };

  const toggleMute = () => {
    const nextMute = !isMuted;
    setIsMuted(nextMute);
    if (videoRef.current) {
      videoRef.current.muted = nextMute;
    }
  };

  const handleSpeedChange = (rate) => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = rate;
    setPlaybackRate(rate);
    setShowSpeedMenu(false);
    triggerShowControls();
  };

  const toggleFullscreen = () => {
    const container = playerContainerRef.current;
    if (!container) return;

    if (!document.fullscreenElement) {
      container.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  const handlePiP = async () => {
    try {
      if (videoRef.current && document.pictureInPictureEnabled) {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
        } else {
          await videoRef.current.requestPictureInPicture();
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Touch Gesture Handlers (Single finger swipe + Double finger pinch-to-zoom)
  const handleTouchStart = (e) => {
    // If locked, we ignore all gesture touches except the lock button itself
    if (isLocked) {
      if (e.target.closest('.lock-btn-floating')) {
        return;
      }
      e.stopPropagation();
      return;
    }

    if (showControls && (e.target.closest('.controls-bar') || e.target.closest('.top-bar') || e.target.closest('.dropdown-menu') || e.target.closest('.lock-btn-floating'))) {
      return; // ignore gesture if clicking overlay components
    }

    // Touch event branches
    if (e.touches.length === 2) {
      // Multi-touch pinch zoom
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const dist = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY);
      
      initialPinchDistRef.current = dist;
      initialZoomScaleRef.current = zoomScale;
      initialPanRef.current = { x: panX, y: panY };
      
      setGestureType('pinch');
    } else if (e.touches.length === 1) {
      // Single touch swipes
      const touch = e.touches[0];
      const rect = playerContainerRef.current.getBoundingClientRect();
      
      touchStartRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        time: activeIsTranscoded ? (currentTime + transcodeSeekOffset) : (videoRef.current?.currentTime || 0),
        vol: volume,
        bright: brightness,
        rectWidth: rect.width,
        rectHeight: rect.height
      };
      
      setGestureType(null);
    }
  };

  const handleTouchMove = (e) => {
    if (isLocked) {
      e.stopPropagation();
      return;
    }

    if (gestureType === 'pinch' && e.touches.length === 2) {
      // Multi touch scale zoom calculation
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const dist = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY);
      
      if (initialPinchDistRef.current > 0) {
        const factor = dist / initialPinchDistRef.current;
        const newScale = Math.max(1.0, Math.min(4.0, initialZoomScaleRef.current * factor));
        setZoomScale(newScale);
      }
      return;
    }

    if (e.touches.length !== 1 || !touchStartRef.current.rectWidth) return;
    
    const touch = e.touches[0];
    const start = touchStartRef.current;
    
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    
    // Determine threshold direction
    if (!gestureType) {
      if (Math.abs(dx) > 15 && Math.abs(dx) > Math.abs(dy)) {
        setGestureType('seek');
      } else if (Math.abs(dy) > 15) {
        // Vertical swipe: Left half = Brightness, Right half = Volume
        const relativeX = start.x - playerContainerRef.current.getBoundingClientRect().left;
        if (relativeX < start.rectWidth / 2) {
          setGestureType('brightness');
        } else {
          setGestureType('volume');
        }
      }
      return;
    }

    // Process single finger gesture actions
    if (gestureType === 'seek') {
      const seekDelta = (dx / start.rectWidth) * 180; // Full screen swipe = 3 minutes seek
      const targetTime = Math.max(0, Math.min(displayDuration, start.time + seekDelta));
      setGestureValue(targetTime);
    } else if (gestureType === 'volume') {
      const volDelta = -(dy / start.rectHeight) * 2.0; // swipe changes volume up to 2.0 (boosted)
      const targetVol = Math.max(0, Math.min(2.0, start.vol + volDelta));
      applyVolume(targetVol);
      setGestureValue(targetVol);
    } else if (gestureType === 'brightness') {
      const brightDelta = -(dy / start.rectHeight);
      const targetBright = Math.max(0.1, Math.min(1.0, start.bright + brightDelta));
      setBrightness(targetBright);
      setGestureValue(targetBright);
    }
    
    triggerShowControls();
  };

  const handleTouchEnd = () => {
    if (isLocked) return;

    if (gestureType === 'seek' && videoRef.current) {
      if (activeIsTranscoded) {
        setTranscodeSeekOffset(gestureValue);
        const targetBase = transcodedBaseUrl || `${API_BASE}/api/transcode/stream?url=${encodeURIComponent(url)}`;
        let nextUrl = `${targetBase}&ss=${Math.floor(gestureValue)}`;
        if (selectedAudioTrack) {
          nextUrl += `&audio=${encodeURIComponent(selectedAudioTrack)}`;
        }
        setSelectedQuality(nextUrl);
        setCurrentTime(0);
      } else {
        videoRef.current.currentTime = gestureValue;
        setCurrentTime(gestureValue);
      }
    }
    setGestureType(null);
  };

  // Aspect ratio cyclic switcher helper
  const cycleAspectRatio = () => {
    const ratios = ['fit', 'stretch', 'zoom', '16:9', '4:3'];
    const nextIdx = (ratios.indexOf(aspectRatio) + 1) % ratios.length;
    setAspectRatio(ratios[nextIdx]);
    triggerShowControls();
  };

  const formatTime = (timeInSecs) => {
    if (isNaN(timeInSecs)) return '0:00';
    const mins = Math.floor(timeInSecs / 60);
    const secs = Math.floor(timeInSecs % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const getVideoStyles = () => {
    let baseStyles = {
      transform: `scale(${zoomScale}) translate(${panX}px, ${panY}px)`,
      transition: gestureType === 'pinch' ? 'none' : 'transform 0.1s ease',
    };

    if (aspectRatio === 'fit') {
      return { ...baseStyles, objectFit: 'contain', width: '100%', height: '100%' };
    } else if (aspectRatio === 'stretch') {
      return { ...baseStyles, objectFit: 'fill', width: '100%', height: '100%' };
    } else if (aspectRatio === 'zoom') {
      return { ...baseStyles, objectFit: 'cover', width: '100%', height: '100%' };
    } else if (aspectRatio === '16:9') {
      return { ...baseStyles, aspectRatio: '16/9', objectFit: 'contain', width: '100%', height: 'auto', maxHeight: '100%' };
    } else if (aspectRatio === '4:3') {
      return { ...baseStyles, aspectRatio: '4/3', objectFit: 'contain', width: '100%', height: 'auto', maxHeight: '100%' };
    }
    return baseStyles;
  };

  const getGestureHUD = () => {
    if (!gestureType) return null;
    let label = "";
    let valPercent = 0;

    if (gestureType === 'volume') {
      label = volume > 1.0 ? `Volume Boosted: ${Math.round(volume * 100)}%` : `Volume: ${Math.round(volume * 100)}%`;
      valPercent = (volume / 2.0) * 100;
    } else if (gestureType === 'brightness') {
      label = `Brightness: ${Math.round(brightness * 100)}%`;
      valPercent = brightness * 100;
    } else if (gestureType === 'seek') {
      label = `Seek: ${formatTime(gestureValue)} / ${formatTime(displayDuration)}`;
      valPercent = displayDuration > 0 ? (gestureValue / displayDuration) * 100 : 0;
    } else if (gestureType === 'pinch') {
      label = `Zoom: ${zoomScale.toFixed(1)}x`;
      valPercent = ((zoomScale - 1.0) / 3.0) * 100;
    }

    return (
      <div className="gesture-indicator-overlay glass">
        <div className="hud-circle-progress" style={{ '--progress-pct': `${valPercent}%` }}>
          <div className="hud-content">
            <span className="hud-text-value">{label}</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div 
      className={`video-player-container ${isFullscreen ? 'fullscreen' : ''} ${isLocked ? 'screen-locked' : ''}`}
      ref={playerContainerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onClick={triggerShowControls}
    >
      {/* Screen Brightness Overlay Layer */}
      <div 
        className="brightness-overlay" 
        style={{ opacity: 1 - brightness }}
      ></div>

      <video
        ref={videoRef}
        className="main-video-element"
        style={getVideoStyles()}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => setIsBuffering(false)}
        onCanPlay={() => setIsBuffering(false)}
        onTimeUpdate={() => {
          setCurrentTime(videoRef.current?.currentTime || 0);
          setIsBuffering(false);
        }}
        onDurationChange={() => setDuration(videoRef.current?.duration || 0)}
        onClick={(e) => {
          e.stopPropagation();
          if (isLocked) return;
          handlePlayPause();
        }}
        playsInline
        crossOrigin="anonymous"
      />

      {/* Buffering Loading Spinner Overlay */}
      {isBuffering && (
        <div className="buffering-overlay">
          <div className="spinner-loader animate-spin"></div>
          <div className="buffering-text">Buffering Stream...</div>
        </div>
      )}

      {/* Visual Gestures HUD Overlay (Circular progress design) */}
      {getGestureHUD()}

      {/* Floating Lock Button on side of screen */}
      <button 
        className={`lock-btn-floating glass ${isLocked ? 'locked-state' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          setIsLocked(!isLocked);
          if (isLocked) {
            // Unlocked: trigger controls overlay display
            setShowControls(true);
          } else {
            // Locked: immediately hide control layouts
            setShowControls(false);
          }
        }}
      >
        {isLocked ? <Lock size={18} color="#ff6a00" /> : <Unlock size={18} />}
      </button>

      {/* Custom UC-styled Controls UI Overlays */}
      {showControls && !isLocked && (
        <>
          {/* Top Bar controls */}
          <div className="top-bar glass">
            <div className="video-title">{title || 'Streaming Video'}</div>
            <div className="top-bar-actions">
              {onDownload && (
                <button className="icon-btn" onClick={() => onDownload(selectedQuality)}>
                  <Download size={18} />
                </button>
              )}
              <button className="icon-btn" onClick={handlePiP}>
                <Tv size={18} />
              </button>
            </div>
          </div>

          {/* Bottom Bar controls */}
          <div className="controls-bar glass">
            {/* Speed & Quality selection badges */}
            <div className="settings-badges">
              {resolutions.length > 0 && (
                <div className="dropdown-container">
                  <button className="badge-btn" onClick={() => { setShowQualityMenu(!showQualityMenu); setShowSpeedMenu(false); }}>
                    <Settings size={12} style={{ marginRight: '4px' }} /> 
                    {resolutions.find(r => r.url === selectedQuality)?.resolution || 'Source'}
                  </button>
                  {showQualityMenu && (
                    <div className="dropdown-menu glass">
                      {resolutions.map((res, i) => (
                        <button 
                          key={i} 
                          className={`menu-item ${selectedQuality === res.url ? 'active' : ''}`}
                          onClick={() => {
                            setSelectedQuality(res.url);
                            setShowQualityMenu(false);
                          }}
                        >
                          {res.resolution}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="dropdown-container">
                <button className="badge-btn" onClick={() => { setShowSpeedMenu(!showSpeedMenu); setShowQualityMenu(false); }}>
                  <FastForward size={12} style={{ marginRight: '4px' }} /> {playbackRate}x
                </button>
                {showSpeedMenu && (
                  <div className="dropdown-menu glass">
                    {[0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 3.0, 4.0].map((rate, i) => (
                      <button 
                        key={i} 
                        className={`menu-item ${playbackRate === rate ? 'active' : ''}`}
                        onClick={() => handleSpeedChange(rate)}
                      >
                        {rate}x Speed
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Aspect Ratio Badge */}
              <button className="badge-btn" onClick={cycleAspectRatio}>
                <Crop size={12} style={{ marginRight: '4px' }} /> Aspect: {aspectRatio.toUpperCase()}
              </button>

              {/* Audio Track Selector Dropdown */}
              {audioTracks && audioTracks.length > 0 && (
                <div className="dropdown-container">
                  <button className="badge-btn" onClick={() => { setShowAudioMenu(!showAudioMenu); setShowQualityMenu(false); setShowSpeedMenu(false); }}>
                    <Volume2 size={12} style={{ marginRight: '4px' }} /> 
                    {audioTracks.find(t => t.id === selectedAudioTrack)?.label || 'Default Audio'}
                  </button>
                  {showAudioMenu && (
                    <div className="dropdown-menu glass" style={{ bottom: '30px', left: 0 }}>
                      <button 
                        className={`menu-item ${!selectedAudioTrack ? 'active' : ''}`}
                        onClick={() => {
                          setSelectedAudioTrack(null);
                          setShowAudioMenu(false);
                          const currentTimeOffset = Math.floor(displayCurrentTime);
                          if (!isTranscoded) {
                            setForceTranscode(false);
                            setSelectedQuality(url);
                            setTimeout(() => {
                              if (videoRef.current) videoRef.current.currentTime = currentTimeOffset;
                            }, 300);
                          } else {
                            setSelectedQuality(`${transcodedBaseUrl}&ss=${currentTimeOffset}`);
                          }
                        }}
                      >
                        Default Audio
                      </button>
                      {audioTracks.map((track, i) => (
                        <button 
                          key={i} 
                          className={`menu-item ${selectedAudioTrack === track.id ? 'active' : ''}`}
                          onClick={() => {
                            setSelectedAudioTrack(track.id);
                            setShowAudioMenu(false);
                            setForceTranscode(true);
                            const currentTimeOffset = Math.floor(displayCurrentTime);
                            const base = transcodedBaseUrl || `${API_BASE}/api/transcode/stream?url=${encodeURIComponent(url)}`;
                            setSelectedQuality(`${base}&ss=${currentTimeOffset}&audio=${encodeURIComponent(track.id)}`);
                          }}
                        >
                          {track.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Cloud Acceleration Badge */}
              <div className="accelerate-badge">
                <Activity size={12} color="var(--accent-color)" style={{ marginRight: '4px' }} />
                <span>Cloud Accelerated</span>
              </div>
            </div>

            {/* Timelines and Seekbar */}
            <div className="seekbar-container">
              <span className="time-text">{formatTime(displayCurrentTime)}</span>
              
              <div className="slider-wrapper">
                {/* Multi-layered custom visual tracks */}
                <div className="slider-track-bg"></div>
                {/* Orange Cloud Acceleration progress track */}
                <div 
                  className="slider-track-orange" 
                  style={{ width: `${cacheProgress}%` }}
                ></div>
                {/* Blue specific cached pre-buffered ranges */}
                {type === 'm3u8' && hlsSegments && hlsSegments.length > 0 && (() => {
                  const ranges = [];
                  let start = -1;
                  for (let i = 0; i < hlsSegments.length; i++) {
                    if (hlsSegments[i]) {
                      if (start === -1) start = i;
                    } else {
                      if (start !== -1) {
                        ranges.push({ startIdx: start, endIdx: i - 1 });
                        start = -1;
                      }
                    }
                  }
                  if (start !== -1) {
                    ranges.push({ startIdx: start, endIdx: hlsSegments.length - 1 });
                  }
                  return ranges.map((r, idx) => {
                    const left = (r.startIdx / hlsSegments.length) * 100;
                    const width = ((r.endIdx - r.startIdx + 1) / hlsSegments.length) * 100;
                    return (
                      <div 
                        key={`hls-blue-${idx}`}
                        className="slider-track-blue" 
                        style={{ left: `${left}%`, width: `${width}%` }}
                      ></div>
                    );
                  });
                })()}
                {type !== 'm3u8' && cachedRanges && cachedRanges.length > 0 && totalSize > 0 && cachedRanges.map((r, idx) => {
                  const left = (r.start / totalSize) * 100;
                  const width = ((r.end - r.start + 1) / totalSize) * 100;
                  return (
                    <div 
                      key={`direct-blue-${idx}`}
                      className="slider-track-blue" 
                      style={{ left: `${left}%`, width: `${width}%` }}
                    ></div>
                  );
                })}
                {/* Custom Slider Input */}
                <input
                  type="range"
                  min={0}
                  max={displayDuration || 100}
                  value={displayCurrentTime}
                  onChange={handleSeek}
                  className="real-slider"
                />
              </div>

              <span className="time-text">{formatTime(displayDuration)}</span>
            </div>

            {/* Playback Control Actions */}
            <div className="actions-row">
              <div className="left-actions">
                <button className="icon-btn-big" onClick={handlePlayPause}>
                  {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
                </button>
                <button className="icon-btn" onClick={() => {
                  if (videoRef.current) videoRef.current.currentTime -= 10;
                }}>
                  <RotateCcw size={18} />
                </button>
              </div>

              <div className="right-actions">
                {/* Volume slider (supports up to 200% / 2.0x boost) */}
                <div className="volume-slider-wrapper">
                  <button className="icon-btn" onClick={toggleMute}>
                    {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={2.0}
                    step={0.05}
                    value={isMuted ? 0 : volume}
                    onChange={handleVolumeChange}
                    className="volume-slider"
                  />
                  {volume > 1.0 && <span className="volume-boost-tag">BOOST</span>}
                </div>

                <button className="icon-btn" onClick={toggleFullscreen}>
                  {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

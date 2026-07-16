# UC Player - Premium Android Video Player

A hybrid standalone Android video player app designed for modern mobile devices (optimized for Android 16). It blends state-of-the-art **XPlayer gestures and hardware interface features** with **UC Player core engines** (web scrapers, torrent stream handlers, and a cloud-accelerated full background pre-buffering timeline).

---

## 🌟 Key Features

### 1. Cloud-Accelerated Pre-buffering (UC Player Core)
- **Sequential Background Caching**: Auto-allocates sparse cache files and caches the **entire video sequentially** starting from your current playhead to the end of the file.
- **Translucent Blue Range Bar**: Displays exact windows of cached ranges on the seekbar, adjusting dynamically as blocks are written.
- **Smart Seek Re-scheduling**: Automatically aborts previous range download streams upon seeking and schedules new cache workers starting from the new playback cursor position.

### 2. Gesture Controls & HUD Overlay (XPlayer Core)
- **Swipe Actions**:
  - Left Side: Slide vertically to adjust simulated screen brightness.
  - Right Side: Slide vertically to adjust volume (supports boosting up to 200%).
  - Horizontal: Swipe to seek backward/forward dynamically.
- **Circular Gestures HUD**: A clean central indicator displaying animated stats for volume, brightness, seek, and pinch scales.

### 3. Audio Volume Booster (up to 200%)
- Implements a custom Web Audio API node chain (`AudioContext` -> `GainNode`).
- Drag the volume slider past 100% (up to 200% / 2.0x gain) to amplify low-gain audio natively, displaying a custom **BOOST** tag overlay.

### 4. Floating Screen Lock
- Secure screen lock controls hide all control layouts and disable swipe/click gestures, preventing accidental input.

### 5. Multi-Touch Pinch-to-Zoom
- Pinch-to-zoom gestures allow scaling the video player canvas from `1.0x` to `4.0x` and dragging to pan.

### 6. Aspect Ratio Switcher
- Cycles the video viewport options:
  - **Fit** (keeps original aspect ratio)
  - **Stretch** (fills viewport)
  - **Zoom / Crop** (crops black bars)
  - **16:9** / **4:3** (forces standard ratios)

### 7. Core Media Scrapers & Torrent Streamers
- **Link Scraper**: Extract direct media files (`.mp4`, `.mkv`) and HLS streams (`.m3u8`) from web pages.
- **Torrent Playback**: Stream magnet and `.torrent` links directly with range support.
- **Background Downloads**: Dedicated downloader exports completed cached videos directly to the public Android `Download/UC_Downloads` directory.

---

## 📁 Repository Layout

```
web-player/
├── package.json          # Root Monorepo configuration
├── sync-and-build.js     # Automates building React app & translating Node.js to CommonJS
├── uc-video-player/      # Developer project code
│   ├── frontend/         # React (Vite) client dashboard & VideoPlayer component
│   └── backend/          # Express.js server, Scraper, Torrent and Cache Manager services
└── uc-video-player-apk/  # Cordova wrapper configuration for Android packaging
    ├── config.xml        # Android SDK permissions & WebView preferences
    └── www/              # Built target files synced from dev workspace
```

---

## 🚀 Getting Started (Development Mode)

To run the project locally on your laptop:

### Prerequisites
- Node.js (v18+)
- Android Studio / Android SDK (for compiling APKs)

### 1. Run Local Servers
Navigate to the `uc-video-player` project:
```bash
cd uc-video-player
npm install
npm run dev
```
- **Vite Web UI**: `http://localhost:5173/`
- **Node Backend Server**: `http://localhost:5000`

---

## 📱 Building the Standalone Cordova Android APK

The app runs standalone on Android (with the Node.js backend hosted locally inside a background thread of the app, requiring no computer).

### 1. Build and Sync Assets
Run the build script in the repository root to compile the frontend and copy files to the Cordova project:
```bash
npm run sync-build
```

### 2. Compile Debug APK
Configure your Java SDK environment (JDK 21) and compile the package:
```bash
cd uc-video-player-apk/platforms/android
$env:JAVA_HOME="C:\Program Files\Android\Android Studio\jbr" # Windows PowerShell
./gradlew assembleDebug
```
The compiled release binary is generated at:
`uc-video-player-apk/platforms/android/app/build/outputs/apk/debug/app-debug.apk`

---

## 📄 License
This project is for development and educational use.

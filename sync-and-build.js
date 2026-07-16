const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const FRONTEND_DIR = path.resolve(__dirname, 'uc-video-player/frontend');
const BACKEND_SERVICES_DIR = path.resolve(__dirname, 'uc-video-player/backend/services');
const APK_WWW_DIR = path.resolve(__dirname, 'uc-video-player-apk/www');
const APK_NODEJS_DIR = path.resolve(__dirname, 'uc-video-player-apk/www/nodejs-project');

function runCommand(command, cwd) {
  console.log(`Running command: ${command} in ${cwd}`);
  execSync(command, { cwd, stdio: 'inherit' });
}

function cleanWww() {
  console.log('Cleaning www assets directory...');
  const files = fs.readdirSync(APK_WWW_DIR);
  for (const file of files) {
    if (file === 'nodejs-project') continue;
    const fullPath = path.join(APK_WWW_DIR, file);
    fs.rmSync(fullPath, { recursive: true, force: true });
  }
}

function copyDirectory(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function syncCacheManager() {
  console.log('Syncing and converting cacheManager.js to CommonJS...');
  const srcPath = path.join(BACKEND_SERVICES_DIR, 'cacheManager.js');
  const destPath = path.join(APK_NODEJS_DIR, 'services/cacheManager.js');

  let code = fs.readFileSync(srcPath, 'utf8');

  // Convert ES module imports to CommonJS requires
  code = code.replace(/import fs from 'fs';/g, "const fs = require('fs');");
  code = code.replace(/import path from 'path';/g, "const path = require('path');");
  code = code.replace(/import axios from 'axios';/g, "const axios = require('axios');");
  code = code.replace(/import crypto from 'crypto';/g, "const crypto = require('crypto');");
  code = code.replace(/import { URL } from 'url';/g, "const { URL } = require('url');");
  code = code.replace(/import os from 'os';/g, "const os = require('os');");

  // Remove ES module export keywords on functions
  code = code.replace(/export function initCache\(/g, "function initCache(");
  code = code.replace(/export function startCaching\(/g, "function startCaching(");
  code = code.replace(/export function getCacheStatus\(/g, "function getCacheStatus(");
  code = code.replace(/export function getHlsSegment\(/g, "function getHlsSegment(");
  code = code.replace(/export function getCachedRangeOffset\(/g, "function getCachedRangeOffset(");
  code = code.replace(/export function prebufferRange\(/g, "function prebufferRange(");
  code = code.replace(/export function registerDownloadName\(/g, "function registerDownloadName(");

  // Append module.exports
  code += `\n\nmodule.exports = {
  initCache,
  startCaching,
  getCacheStatus,
  getHlsSegment,
  getCachedRangeOffset,
  prebufferRange,
  registerDownloadName,
  cleanupCache
};\n`;

  fs.writeFileSync(destPath, code, 'utf8');
  console.log('Converted and wrote services/cacheManager.js successfully!');
}

async function main() {
  try {
    // 1. Build Frontend
    console.log('Step 1: Building React Vite frontend...');
    runCommand('npm run build', FRONTEND_DIR);

    // 2. Clean APK WWW
    console.log('Step 2: Cleaning target APK www assets...');
    cleanWww();

    // 3. Copy Built Assets to APK WWW
    console.log('Step 3: Copying built React bundle to APK www...');
    copyDirectory(path.join(FRONTEND_DIR, 'dist'), APK_WWW_DIR);

    // 4. Sync Cache Manager service
    console.log('Step 4: Syncing background backend services...');
    syncCacheManager();

    console.log('Sync process completed successfully! Ready for Cordova build.');
  } catch (error) {
    console.error('Build sync failed:', error.message);
    process.exit(1);
  }
}

main();

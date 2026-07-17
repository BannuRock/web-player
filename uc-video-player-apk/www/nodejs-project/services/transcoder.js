/**
 * Transcoder Service for Mobile APK
 * Transcoding is disabled on mobile devices to save CPU and battery life.
 * Standard H.264/AAC MP4 and MKV videos stream directly and are decoded natively by Android.
 */

function needsTranscoding(filename) {
  return false;
}

function transcodeStream(filePath, res, seekSeconds, audioTrackId) {
  console.warn("Transcoding requested but is disabled on mobile APK.");
  res.status(501).send("Transcoding is disabled on mobile.");
  return { kill: () => {} };
}

function probeMediaMetadata(inputUrl) {
  // Returns fallback values on mobile. The browser HTML5 player will
  // resolve duration metadata natively for direct streams.
  return Promise.resolve({
    duration: 0,
    audioTracks: []
  });
}

module.exports = {
  needsTranscoding,
  transcodeStream,
  probeMediaMetadata
};

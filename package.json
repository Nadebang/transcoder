// server.js

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
const { execFile } = require("child_process");

// node-fetch ESM shim
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const execFileAsync = promisify(execFile);

const app = express();

// Allow browser requests
app.use(cors());
app.use(express.json());

// Where we store transcoded videos on disk
const OUTPUT_DIR = path.join(__dirname, "videos");
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR);
}

// Helper: download a remote file to disk
async function downloadFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }

  return new Promise((resolve, reject) => {
    const fileStream = fs.createWriteStream(destPath);
    res.body.pipe(fileStream);
    res.body.on("error", reject);
    fileStream.on("finish", resolve);
  });
}

// POST /process  ->  { video_url, prediction_id }
app.post("/process", async (req, res) => {
  try {
    const { video_url, prediction_id } = req.body || {};

    if (!video_url) {
      return res.status(400).json({
        success: false,
        error: "Missing video_url",
      });
    }

    const id = prediction_id || Date.now().toString();

    const inputPath = path.join(OUTPUT_DIR, `${id}-input.mp4`);
    const outputPath = path.join(OUTPUT_DIR, `${id}-portrait.mp4`);

    console.log("[/process] Downloading source video:", video_url);
    await downloadFile(video_url, inputPath);

    // FFmpeg: convert to 9:16 portrait, pad/letterbox, normalize SAR
    const ffmpegArgs = [
      "-y",
      "-i",
      inputPath,
      "-vf",
      "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1:1",
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "23",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      outputPath,
    ];

    console.log("[/process] Running ffmpeg:", ffmpegArgs.join(" "));
    await execFileAsync("ffmpeg", ffmpegArgs);

    // Optional: delete original input to save space
    fs.unlink(inputPath, (err) => {
      if (err) console.log("Error deleting temp input:", err.message);
    });

    // Build a public URL to the transcoded file
    const baseUrl =
      process.env.RENDER_EXTERNAL_URL ||
      `http://localhost:${process.env.PORT || 10000}`;
    const fileName = path.basename(outputPath);
    const fixedUrl = `${baseUrl}/video/${encodeURIComponent(fileName)}`;

    console.log("[/process] Done. fixed_url =", fixedUrl);

    return res.json({
      success: true,
      fixed_url: fixedUrl,
      prediction_id: id,
      source_url: video_url,
    });
  } catch (err) {
    console.error("Error in /process:", err);
    return res.status(500).json({
      success: false,
      error: err.message || String(err),
    });
  }
});

// Serve transcoded videos
app.use("/video", express.static(OUTPUT_DIR));

// IMPORTANT: use Render's PORT env var
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Transcoder listening on port ${PORT}`);
});

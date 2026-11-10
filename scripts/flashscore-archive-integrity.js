"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");

const DATA = path.resolve(process.argv[2] || path.join(__dirname, "..", "data"));
const MANIFEST = path.join(DATA, "flashscore-archive-integrity.json");
const INDEX = path.join(DATA, "flashscore-timeline-index.json");
const ARCHIVE = path.join(DATA, "flashscore-match-archive.json");

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function inspectTimeline(file) {
  const raw = fs.readFileSync(file);
  const decoded = zlib.gunzipSync(raw).toString("utf8");
  const lines = decoded.split(/\r?\n/).filter(Boolean);
  for (const line of lines) JSON.parse(line);
  return { bytes: raw.length, sha256: sha256(raw), snapshots: lines.length };
}
function buildManifest() {
  if (!fs.existsSync(ARCHIVE) || !fs.existsSync(INDEX)) {
    throw new Error("Chýba match archive alebo timeline index; manifest sa nevytvorí.");
  }
  const archive = readJson(ARCHIVE);
  const index = readJson(INDEX);
  if (!archive.matches || typeof archive.matches !== "object" || !Array.isArray(index.weeks)) {
    throw new Error("Neplatná štruktúra Flashscore archívu alebo timeline indexu.");
  }

  const files = {};
  const archiveBytes = fs.readFileSync(ARCHIVE);
  const indexBytes = fs.readFileSync(INDEX);
  files[path.basename(ARCHIVE)] = {
    bytes: archiveBytes.length,
    sha256: sha256(archiveBytes),
    matches: Object.keys(archive.matches).length
  };
  files[path.basename(INDEX)] = {
    bytes: indexBytes.length,
    sha256: sha256(indexBytes),
    indexed_weeks: index.weeks.length
  };

  let timelineSnapshots = 0;
  let timelineFiles = 0;
  for (const entry of index.weeks) {
    if (!entry || typeof entry.file !== "string" || !/^flashscore-match-timeline-\d{4}-W\d{2}\.jsonl\.gz$/.test(entry.file)) {
      throw new Error("Neplatná položka v timeline indexe: " + JSON.stringify(entry));
    }
    const fullPath = path.join(DATA, entry.file);
    if (!fs.existsSync(fullPath)) throw new Error("Chýba indexovaný timeline súbor: " + entry.file);
    const stats = inspectTimeline(fullPath);
    files[entry.file] = stats;
    timelineSnapshots += stats.snapshots;
    timelineFiles += 1;
  }

  return {
    schema_version: 1,
    source: "Flashscore",
    retention_policy: "permanent",
    generated_at: new Date().toISOString(),
    match_count: Object.keys(archive.matches).length,
    timeline_file_count: timelineFiles,
    timeline_snapshot_count: timelineSnapshots,
    files
  };
}

function main() {
  const next = buildManifest();
  if (process.argv.includes("--verify")) {
    if (!fs.existsSync(MANIFEST)) throw new Error("Chýba integrity manifest.");
    const previous = readJson(MANIFEST);
    const changed = [];
    for (const [name, info] of Object.entries(previous.files || {})) {
      if (!next.files[name] || next.files[name].sha256 !== info.sha256) changed.push(name);
    }
    if (changed.length) throw new Error("Kontrola integrity zlyhala; zmenené alebo chýbajúce súbory: " + changed.join(", "));
    console.log("Flashscore archive integrity OK:", JSON.stringify({
      matches: next.match_count,
      timeline_files: next.timeline_file_count,
      timeline_snapshots: next.timeline_snapshot_count,
      checked_files: Object.keys(previous.files || {}).length
    }));
    return;
  }
  fs.writeFileSync(MANIFEST, JSON.stringify(next, null, 2) + "\n");
  console.log("Flashscore archive integrity manifest created:", JSON.stringify({
    matches: next.match_count,
    timeline_files: next.timeline_file_count,
    timeline_snapshots: next.timeline_snapshot_count,
    checked_files: Object.keys(next.files).length
  }));
}

try {
  main();
} catch (error) {
  console.error("FLASHSCORE ARCHIVE INTEGRITY FAILED:", error.message);
  process.exit(1);
}

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { spawnSync } = require("node:child_process");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "flashscore-integrity-"));
const data = path.join(root, "data");
const script = path.join(__dirname, "flashscore-archive-integrity.js");

function run(...args) {
  const result = spawnSync(process.execPath, [script, data, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stdout + result.stderr);
  return result.stdout;
}

try {
  fs.mkdirSync(data, { recursive: true });
  const weekFile = "flashscore-match-timeline-2019-W01.jsonl.gz";
  fs.writeFileSync(path.join(data, "flashscore-match-archive.json"), JSON.stringify({
    source: "Flashscore", matches: { "old-match": { id: "old-match" } }
  }));
  fs.writeFileSync(path.join(data, "flashscore-timeline-index.json"), JSON.stringify({
    weeks: [{ week: "2019-W01", file: weekFile }]
  }));
  fs.writeFileSync(path.join(data, weekFile), zlib.gzipSync(Buffer.from('{"match_id":"old-match","snapshot":{"minute":10}}\n')));
  run();
  const manifest = JSON.parse(fs.readFileSync(path.join(data, "flashscore-archive-integrity.json"), "utf8"));
  assert.equal(manifest.retention_policy, "permanent");
  assert.equal(manifest.match_count, 1);
  assert.equal(manifest.timeline_snapshot_count, 1);
  assert.ok(manifest.files[weekFile].sha256);
  assert.match(run("--verify"), /integrity OK/);

  fs.writeFileSync(path.join(data, weekFile), zlib.gzipSync(Buffer.from('{"match_id":"old-match","snapshot":{"minute":11}}\n')));
  const changed = spawnSync(process.execPath, [script, data, "--verify"], { encoding: "utf8" });
  assert.notEqual(changed.status, 0, "verification must detect modified historical timeline files");
  assert.match(changed.stderr, /integrity zlyhala/);
  process.stdout.write("Flashscore archive integrity tests passed: manifest, gzip validation, permanent historical file checksums and tamper detection.\n");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

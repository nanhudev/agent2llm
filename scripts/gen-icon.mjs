#!/usr/bin/env node
/**
 * Draws the agent2llm icon programmatically and writes it as a TypeScript
 * module of base64 assets.
 *
 * Why generated rather than a vendored .png: the icon is geometric (a rounded
 * square, a circle, a rounded rectangle), so it can be drawn in ~100 lines of
 * distance functions with no font, no image library and no binary asset to
 * keep in sync. The encoder below is a deliberate from-scratch PNG writer —
 * small enough to audit, and it means this script has zero dependencies.
 *
 * Output: apps/cli/src/icon.assets.gen.ts (ICON_PNG_BASE64, ICON_ICO_BASE64).
 * The .ico wraps the same 256x256 PNG, which is a legal ICO entry and what
 * every Windows shell since Vista renders.
 *
 * Run: node scripts/gen-icon.mjs   (checked in; only rerun to change the art)
 */
import { deflateSync } from "node:zlib";
import { writeFile } from "node:fs/promises";
import path from "node:path";

const SIZE = 256;

// ---- Drawing: signed-distance shapes over an RGBA buffer -------------------

/** Signed distance to a rounded rectangle centred at (cx, cy). */
function sdRoundRect(px, py, cx, cy, halfW, halfH, radius) {
  const dx = Math.abs(px - cx) - (halfW - radius);
  const dy = Math.abs(py - cy) - (halfH - radius);
  const outsideX = Math.max(dx, 0);
  const outsideY = Math.max(dy, 0);
  return Math.hypot(outsideX, outsideY) + Math.min(Math.max(dx, dy), 0) - radius;
}

const sdCircle = (px, py, cx, cy, radius) => Math.hypot(px - cx, py - cy) - radius;

/** Coverage from a signed distance: 1 inside, 0 outside, 1px soft edge. */
function coverage(distance) {
  if (distance <= -0.5) return 1;
  if (distance >= 0.5) return 0;
  return 0.5 - distance;
}

/** sRGB hex -> [r, g, b]. */
const rgb = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

const BG = rgb("#1B2A4A"); // deep indigo canvas
const BRAIN = rgb("#F0B429"); // amber circle — the thinking model
const HARNESS = rgb("#38BDF8"); // sky rounded square — the hands
const EDGE = rgb("#0F1830"); // the canvas' darker border ring

/** 4x4 supersampled coverage, per shape: cheap, smooth-enough edges. */
function samplePixel(x, y) {
  let brain = 0;
  let harness = 0;
  for (let sy = 0; sy < 4; sy++) {
    for (let sx = 0; sx < 4; sx++) {
      const px = x + (sx + 0.5) / 4;
      const py = y + (sy + 0.5) / 4;
      brain += sdCircle(px, py, 100, 102, 50) <= 0 ? 1 : 0;
      harness += sdRoundRect(px, py, 166, 162, 46, 46, 22) <= 0 ? 1 : 0;
    }
  }
  return { brain: brain / 16, harness: harness / 16 };
}

function drawIcon() {
  const raw = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      // Canvas: rounded square, with a darker rim across the outermost band.
      const outer = sdRoundRect(px, py, 128, 128, 124, 124, 56);
      const shapes = outer <= 0.5 ? samplePixel(x, y) : { brain: 0, harness: 0 };
      // The harness square wins the overlap: the hands sit in front.
      const fg = shapes.harness > 0 ? HARNESS : shapes.brain > 0 ? BRAIN : BG;
      const rim = outer > -6 ? Math.min(1, (outer + 6) / 6) * 0.45 : 0;
      const offset = (y * SIZE + x) * 4;
      raw[offset] = Math.round(fg[0] * (1 - rim) + EDGE[0] * rim);
      raw[offset + 1] = Math.round(fg[1] * (1 - rim) + EDGE[1] * rim);
      raw[offset + 2] = Math.round(fg[2] * (1 - rim) + EDGE[2] * rim);
      raw[offset + 3] =
        shapes.harness > 0 || shapes.brain > 0
          ? 255
          : outer <= 0
            ? 255
            : Math.max(0, Math.round((1 - coverage(outer)) * 255));
    }
  }
  return raw;
}

// ---- Minimal PNG encoder ----------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(raw, size) {
  // Filter 0 on every scanline: no filtering, larger but always valid.
  const filtered = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    filtered[y * (size * 4 + 1)] = 0;
    raw.copy(filtered, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(filtered, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- ICO wrapper ------------------------------------------------------------

function wrapIco(png) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // one image
  const entry = Buffer.alloc(16);
  entry[0] = 0; // width 256 is written as 0
  entry[1] = 0; // height ditto
  entry[2] = 0; // palette
  entry[3] = 0; // reserved
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12); // data offset: 6 + 16
  return Buffer.concat([header, entry, png]);
}

// ---- Write the generated module ---------------------------------------------

const png = encodePng(drawIcon(), SIZE);
const ico = wrapIco(png);
const out = path.join(process.cwd(), "apps", "cli", "src", "icon.assets.gen.ts");
await writeFile(
  out,
  `/**
 * Generated by scripts/gen-icon.mjs — do not edit by hand.
 *
 * The icon is drawn programmatically (rounded canvas, amber circle for the
 * Brain, sky rounded square for the Harness), so the package and the SEA
 * binary carry it with no vendored image file. The .ico wraps the same PNG,
 * which is a legal ICO entry.
 */
export const ICON_PNG_BASE64 =
  "${png.toString("base64")}";
export const ICON_ICO_BASE64 =
  "${ico.toString("base64")}";
`
);
console.log(`icon.assets.gen.ts written (png ${png.length} B, ico ${ico.length} B)`);

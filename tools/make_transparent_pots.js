'use strict';
const fs = require('fs');
const path = require('path');
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');

const potsDir = path.join(__dirname, '..', 'assets', 'pots');
const files = fs.readdirSync(potsDir).filter(f => f.endsWith('.jpg'));

console.log('Processing pots:', files);

files.forEach(file => {
  const filePath = path.join(potsDir, file);
  const rawJpg = fs.readFileSync(filePath);
  const decoded = jpeg.decode(rawJpg, { useTArray: true });
  const { width, height, data } = decoded;

  const png = new PNG({ width, height });

  // Flood fill background from 4 corners to find all connected background pixels
  const visited = new Uint8Array(width * height);
  const isBg = new Uint8Array(width * height);
  const queue = [
    0, 0,
    width - 1, 0,
    0, height - 1,
    width - 1, height - 1
  ];

  for (let i = 0; i < queue.length; i += 2) {
    const qx = queue[i];
    const qy = queue[i + 1];
    visited[qy * width + qx] = 1;
  }

  let head = 0;
  while (head < queue.length) {
    const x = queue[head++];
    const y = queue[head++];
    const idx = (y * width + x) * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];

    // Background threshold (white to off-white gradient)
    const isWhite = (r > 220 && g > 220 && b > 220) || (r > 200 && g > 200 && b > 200 && Math.abs(r - g) < 15 && Math.abs(g - b) < 15);

    if (isWhite) {
      isBg[y * width + x] = 1;

      // Check 4 neighbors
      const neighbors = [
        [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]
      ];
      for (const [nx, ny] of neighbors) {
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const nidx = ny * width + nx;
          if (!visited[nidx]) {
            visited[nidx] = 1;
            queue.push(nx, ny);
          }
        }
      }
    }
  }

  // Populate PNG with transparent background and feathered edges
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pIdx = y * width + x;
      const sIdx = pIdx * 4;

      const r = data[sIdx];
      const g = data[sIdx + 1];
      const b = data[sIdx + 2];

      if (isBg[pIdx]) {
        // Compute feathering if near pot boundary
        let minPotDist = 99;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              if (!isBg[ny * width + nx]) {
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < minPotDist) minPotDist = dist;
              }
            }
          }
        }

        if (minPotDist <= 2.0) {
          const alpha = Math.round((2.0 - minPotDist) / 2.0 * 180);
          png.data[sIdx] = r;
          png.data[sIdx + 1] = g;
          png.data[sIdx + 2] = b;
          png.data[sIdx + 3] = Math.max(0, Math.min(255, alpha));
        } else {
          png.data[sIdx] = 0;
          png.data[sIdx + 1] = 0;
          png.data[sIdx + 2] = 0;
          png.data[sIdx + 3] = 0;
        }
      } else {
        // Solid inside pot
        png.data[sIdx] = r;
        png.data[sIdx + 1] = g;
        png.data[sIdx + 2] = b;
        png.data[sIdx + 3] = 255;
      }
    }
  }

  const outName = file.replace('.jpg', '.png');
  const outPath = path.join(potsDir, outName);
  fs.writeFileSync(outPath, PNG.sync.write(png));
  console.log('Created transparent PNG:', outName);
});

console.log('All pots processed into transparent PNGs successfully!');

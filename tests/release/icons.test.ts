import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const iconSizes = [16, 32, 48, 128] as const;

type PngInfo = {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlace: number;
  nonTransparentPixels: number;
  uniqueColors: number;
};

function parsePng(buffer: Buffer): PngInfo {
  expect(buffer.subarray(0, PNG_SIGNATURE.length)).toEqual(PNG_SIGNATURE);

  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const imageData: Buffer[] = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const data = buffer.subarray(dataStart, dataEnd);

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      imageData.push(data);
    }

    offset = dataEnd + 4;
  }

  expect(imageData.length).toBeGreaterThan(0);
  expect(colorType).toBe(6);
  expect(bitDepth).toBe(8);
  expect(interlace).toBe(0);

  const decoded = inflateSync(Buffer.concat(imageData));
  const rowBytes = width * 4;
  const pixels = Buffer.alloc(width * height * 4);
  const colors = new Set<string>();
  let nonTransparentPixels = 0;

  function paeth(a: number, b: number, c: number): number {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  }

  for (let y = 0; y < height; y += 1) {
    const filter = decoded[y * (rowBytes + 1)];
    const rowStart = y * (rowBytes + 1) + 1;
    const outputStart = y * rowBytes;
    const previousStart = (y - 1) * rowBytes;

    for (let x = 0; x < rowBytes; x += 1) {
      const raw = decoded[rowStart + x];
      const left = x >= 4 ? pixels[outputStart + x - 4] : 0;
      const above = y > 0 ? pixels[previousStart + x] : 0;
      const upperLeft = y > 0 && x >= 4 ? pixels[previousStart + x - 4] : 0;
      let value = raw;

      if (filter === 1) value = (raw + left) & 0xff;
      if (filter === 2) value = (raw + above) & 0xff;
      if (filter === 3) value = (raw + Math.floor((left + above) / 2)) & 0xff;
      if (filter === 4) value = (raw + paeth(left, above, upperLeft)) & 0xff;

      pixels[outputStart + x] = value;
    }
  }

  for (let index = 0; index < pixels.length; index += 4) {
    const rgba = pixels.subarray(index, index + 4);
    colors.add(rgba.toString("hex"));
    if (rgba[3] > 0) nonTransparentPixels += 1;
  }

  return {
    width,
    height,
    bitDepth,
    colorType,
    interlace,
    nonTransparentPixels,
    uniqueColors: colors.size
  };
}

describe("release icon assets", () => {
  it("provides transparent RGBA PNGs at every manifest size", () => {
    for (const size of iconSizes) {
      const path = resolve(process.cwd(), `public/icons/icon${size}.png`);
      expect(existsSync(path)).toBe(true);
      if (!existsSync(path)) continue;

      const info = parsePng(readFileSync(path));
      expect(info.width).toBe(size);
      expect(info.height).toBe(size);
      expect(info.colorType).toBe(6);
      expect(info.bitDepth).toBe(8);
      expect(info.interlace).toBe(0);
    }
  });

  it("keeps the 128px icon as a detailed, non-empty raster", () => {
    const path = resolve(process.cwd(), "public/icons/icon128.png");
    expect(existsSync(path)).toBe(true);
    if (!existsSync(path)) return;

    const info = parsePng(readFileSync(path));
    expect(info.nonTransparentPixels).toBeGreaterThan(128 * 128 * 0.1);
    expect(info.uniqueColors).toBeGreaterThan(32);
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { convertModel, convertDirectory, modelManifest, parseGraph, transposeDeconvolution } from '../scripts/convert-framegen-model.mjs';

const floats = (values) => {
  const bytes = Buffer.alloc(values.length * 4);
  values.forEach((value, i) => bytes.writeFloatLE(value, i * 4));
  return bytes;
};
const values = (bytes) => Array.from({ length: bytes.length / 4 }, (_, i) => bytes.readFloatLE(i * 4));

// Synthetic weights and inspected graph fixtures: no Downloads path or pretrained
// model dependency is needed to run regression tests on another machine.
function fixture() {
  const files = {};
  let counter = 0;
  const tensor = (count) => floats(Array.from({ length: count }, () => (++counter % 127 - 63) / 128));
  for (const part of ['trunk', 'mid']) {
    files[`${part}.param`] = readFileSync(new URL(`./fixtures/tfact2-ours/${part}.param`, import.meta.url));
    const parts = [];
    for (const { type, params: p } of parseGraph(files[`${part}.param`], `${part}.param`)) {
      if (['Convolution', 'Deconvolution'].includes(type)) parts.push(Buffer.alloc(4), tensor(p[6]), tensor(p[0]));
      else if (type === 'PReLU') parts.push(tensor(p[0]));
      else if (type === 'Scale') parts.push(floats([2, 2, 2, -1, -1, -1]));
    }
    files[`${part}.bin`] = Buffer.concat(parts);
  }
  files['film_mlp.bin'] = tensor(64 + 64 + 192 * 64 + 192);
  return files;
}

describe('tfact2 NCNN to Web model conversion', () => {
  it('builds the 47-tensor schema with contiguous element offsets', () => {
    const files = fixture(), { bin, manifest, report } = convertModel(files);
    expect(bin.length).toBe(2945824);
    expect(report.parameterCount).toBe(736456);
    expect(report.tensorCount).toBe(47);
    let offset = 0;
    for (const tensor of Object.values(manifest)) {
      expect(tensor.offset).toBe(offset);
      offset += tensor.shape.reduce((a, b) => a * b, 1);
    }
    expect(offset * 4).toBe(bin.length);
    expect(report.status).toContain('not-inference-validated');
    // Both independently parsed convolution weights and headerless FiLM survive bit-for-bit.
    expect(bin.subarray(0, 2592 * 4).equals(files['trunk.bin'].subarray(4, 4 + 2592 * 4))).toBe(true);
    const start = manifest['film.0.weight'].offset * 4;
    expect(bin.subarray(start, start + files['film_mlp.bin'].length).equals(files['film_mlp.bin'])).toBe(true);
    expect(convertModel(files).bin.equals(bin)).toBe(true);
  });

  it('transposes deconvolution channels without flipping spatial kernels', () => {
    const source = floats(Array.from({ length: 2 * 3 * 4 }, (_, i) => i));
    const converted = values(transposeDeconvolution(source, 3, 2, 2));
    expect(converted).toEqual([0, 1, 2, 3, 12, 13, 14, 15, 4, 5, 6, 7, 16, 17, 18, 19, 8, 9, 10, 11, 20, 21, 22, 23]);
  });

  it('preserves deconvolution output: NCNN scatter versus Web runtime gather', () => {
    const ci = 3, co = 2, iw = 3, ih = 2, ow = iw * 2, oh = ih * 2;
    const src = Array.from({ length: ci * iw * ih }, (_, i) => (i % 7 - 3) / 8);
    const ncnn = floats(Array.from({ length: ci * co * 16 }, (_, i) => (i % 17 - 8) / 16));
    const web = transposeDeconvolution(ncnn, ci, co, 4);
    const bias = [0.125, -0.25];
    const scatter = new Float64Array(co * ow * oh), gather = new Float64Array(scatter.length);
    for (let oc = 0; oc < co; oc++) {
      scatter.fill(bias[oc], oc * ow * oh, (oc + 1) * ow * oh);
      for (let iy = 0; iy < ih; iy++) for (let ix = 0; ix < iw; ix++) {
        for (let ic = 0; ic < ci; ic++) for (let ky = 0; ky < 4; ky++) for (let kx = 0; kx < 4; kx++) {
          const x = ix * 2 + kx - 1, y = iy * 2 + ky - 1;
          if (x >= 0 && x < ow && y >= 0 && y < oh) scatter[(oc * oh + y) * ow + x] +=
            src[(ic * ih + iy) * iw + ix] * ncnn.readFloatLE(((oc * ci + ic) * 16 + ky * 4 + kx) * 4);
        }
      }
      for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
        let sum = bias[oc];
        for (let ky = (y + 1) & 1; ky < 4; ky += 2) for (let kx = (x + 1) & 1; kx < 4; kx += 2) {
          const iy = (y + 1 - ky) / 2, ix = (x + 1 - kx) / 2;
          if (iy < 0 || iy >= ih || ix < 0 || ix >= iw) continue;
          for (let ic = 0; ic < ci; ic++) sum += src[(ic * ih + iy) * iw + ix] * web.readFloatLE(((ic * co + oc) * 16 + ky * 4 + kx) * 4);
        }
        gather[(oc * oh + y) * ow + x] = sum;
      }
    }
    expect(Array.from(gather)).toEqual(Array.from(scatter));
  });

  it.each(['trunk.bin', 'mid.bin', 'film_mlp.bin'])('rejects truncated and surplus bytes in %s', (name) => {
    const files = fixture(), original = files[name];
    files[name] = original.subarray(0, original.length - 4);
    expect(() => convertModel(files)).toThrow(/truncated/);
    files[name] = Buffer.concat([original, Buffer.alloc(4)]);
    expect(() => convertModel(files)).toThrow(/unconsumed/);
  });

  it('rejects quantized flags, non-finite weights, modified graphs and wrong residual constants', () => {
    let files = fixture(); files['trunk.bin'].writeUInt32LE(0x01306b47, 0);
    expect(() => convertModel(files)).toThrow(/FP32/);
    files = fixture(); files['mid.bin'].writeFloatLE(NaN, 4);
    expect(() => convertModel(files)).toThrow(/non-finite/);
    files = fixture(); files['mid.param'] = Buffer.from(files['mid.param'].toString().replace('TfactCompose', 'OtherCompose'));
    expect(() => convertModel(files)).toThrow(/Unsupported/);
    files = fixture(); files['mid.bin'].writeFloatLE(3, files['mid.bin'].length - 24);
    expect(() => convertModel(files)).toThrow(/residual scale/);
  });

  it('does not overwrite output directories or modify original inputs', () => {
    const temporary = mkdtempSync(join(tmpdir(), 'xmax-model-test-'));
    try {
      const files = fixture();
      for (const [name, bytes] of Object.entries(files)) writeFileSync(join(temporary, name), bytes);
      const output = join(temporary, 'converted');
      const { report } = convertDirectory(temporary, output);
      expect(existsSync(join(output, 'tfact2_ours.bin'))).toBe(true);
      expect(JSON.parse(readFileSync(join(output, 'tfact2_ours.json'), 'utf8'))).toEqual(modelManifest());
      expect(JSON.parse(readFileSync(join(output, 'conversion-report.json'), 'utf8'))).toEqual(report);
      expect(() => convertDirectory(temporary, output)).toThrow(/EEXIST/);
      for (const [name, bytes] of Object.entries(files)) expect(readFileSync(join(temporary, name)).equals(bytes)).toBe(true);
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  });
});

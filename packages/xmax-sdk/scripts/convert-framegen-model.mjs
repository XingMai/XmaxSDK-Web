import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Deliberately scoped to the inspected tfact2_ours FP32 export, not a generic
// NCNN graph compiler. Unknown graphs/encodings fail rather than silently loading.
const graphHashes = {
  'trunk.param': 'd1b68c44dfb33c1522327ed1ec42b309797b528be0bd477e39588a8094ab478c',
  'mid.param': '7084a10e0b10f37a7bfcd5f30e82cc95a25c0e8cc365c939f8d148d512d8567b',
};
const sourceFiles = ['trunk.param', 'trunk.bin', 'mid.param', 'mid.bin', 'film_mlp.bin'];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const elements = (shape) => shape.reduce((n, dim) => n * dim, 1);

export function parseGraph(bytes, filename) {
  const normalized = bytes.toString('utf8').trim().split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/).join(' ')).join('\n');
  assert.equal(sha256(normalized), graphHashes[filename], `Unsupported ${filename} graph; inspect topology before adding support`);
  return normalized.split('\n').slice(2).map((line) => {
    const [type, name, inputs, outputs, ...rest] = line.split(' ');
    return { type, name, params: Object.fromEntries(rest.slice(Number(inputs) + Number(outputs))
      .map((item) => item.split('=').map(Number))) };
  });
}

// Matches framegen 1.4.0 rt.js tensor names and FP32-element (not byte) offsets.
// This schema contains shapes only; no upstream pretrained weights are read.
export function modelManifest() {
  const manifest = {};
  let offset = 0;
  const add = (name, shape) => { manifest[name] = { shape, offset }; offset += elements(shape); };
  const conv = (name, co, ci, kernel, activation) => {
    add(`${name}.weight`, [co, ci, kernel, kernel]);
    add(`${name}.bias`, [co]);
    if (activation) add(`${activation}.weight`, [co]);
  };
  conv('block0.conv0.0.0', 48, 6, 3, 'block0.conv0.0.1');
  conv('block0.conv0.1.0', 96, 48, 3, 'block0.conv0.1.1');
  for (let i = 0; i < 8; i++) conv(`block0.convblock.${i}.0`, 96, 96, 3, `block0.convblock.${i}.1`);
  add('block0.lastconv.weight', [96, 5, 4, 4]);
  add('block0.lastconv.bias', [5]);
  add('film.0.weight', [64, 1]); add('film.0.bias', [64]);
  add('film.2.weight', [192, 64]); add('film.2.bias', [192]);
  for (let i = 0; i < 3; i++) conv(`refine.c${i}`, 16, i === 0 ? 11 : 16, 3, `refine.a${i}`);
  conv('refine.c3', 3, 16, 3);
  return manifest;
}

function reader(bytes, label) {
  let offset = 0;
  return {
    take(count, tagged = false) {
      if (tagged) {
        assert(offset + 4 <= bytes.length, `${label}: truncated storage flag`);
        assert.equal(bytes.readUInt32LE(offset), 0, `${label}: only NCNN FP32 flag 0 is supported`);
        offset += 4;
      }
      assert(Number.isInteger(count) && count > 0 && offset + count * 4 <= bytes.length, `${label}: truncated/invalid tensor`);
      const tensor = bytes.subarray(offset, offset + count * 4);
      for (let i = 0; i < count; i++) assert(Number.isFinite(tensor.readFloatLE(i * 4)), `${label}: non-finite weight`);
      offset += tensor.length;
      return tensor;
    },
    end() { assert.equal(offset, bytes.length, `${label}: unconsumed bytes`); },
  };
}

// NCNN static Deconvolution stores [out,in,kh,kw]; rt.js reads [in,out,kh,kw].
// Swap channels only: both implementations use the same kernel orientation.
// See Tencent/ncnn src/layer/deconvolution.cpp and pass_ncnn/nn_ConvTranspose2d.cpp.
export function transposeDeconvolution(bytes, ci, co, kernel) {
  assert.equal(bytes.length, ci * co * kernel * kernel * 4);
  const result = Buffer.alloc(bytes.length);
  const planeBytes = kernel * kernel * 4;
  for (let input = 0; input < ci; input++) {
    for (let output = 0; output < co; output++) {
      const from = (output * ci + input) * planeBytes;
      bytes.copy(result, (input * co + output) * planeBytes, from, from + planeBytes);
    }
  }
  return result;
}

function layerNames() {
  const names = {
    'conv0a.c0': 'block0.conv0.0.0', 'conv0a.p0': 'block0.conv0.0.1',
    'conv0b.c1': 'block0.conv0.1.0', 'conv0b.p1': 'block0.conv0.1.1',
    lastconv: 'block0.lastconv', rout: 'refine.c3',
  };
  for (let i = 0; i < 8; i++) {
    names[`cb${i}.c${i < 6 ? 0 : i}`] = `block0.convblock.${i}.0`;
    names[`cb${i}.p${i < 6 ? 0 : i}`] = `block0.convblock.${i}.1`;
  }
  for (let i = 0; i < 3; i++) { names[`rc${i}.c${i}`] = `refine.c${i}`; names[`rc${i}.p${i}`] = `refine.a${i}`; }
  return names;
}

export function convertModel(files) {
  for (const name of sourceFiles) assert(Buffer.isBuffer(files[name]), `Missing ${name}`);
  const manifest = modelManifest(), tensors = new Map(), names = layerNames();
  const add = (name, bytes) => {
    assert(manifest[name] && !tensors.has(name), `Unexpected/duplicate tensor ${name}`);
    assert.equal(bytes.length, elements(manifest[name].shape) * 4, `Shape mismatch: ${name}`);
    tensors.set(name, bytes);
  };
  for (const part of ['trunk', 'mid']) {
    const data = reader(files[`${part}.bin`], `${part}.bin`);
    for (const { type, name, params: p } of parseGraph(files[`${part}.param`], `${part}.param`)) {
      const target = names[name];
      if (type === 'Convolution' || type === 'Deconvolution') {
        let weight = data.take(p[6], true);
        if (type === 'Deconvolution') weight = transposeDeconvolution(weight, 96, 5, 4);
        add(`${target}.weight`, weight);
        assert.equal(p[5], 1, `Expected bias: ${name}`);
        add(`${target}.bias`, data.take(p[0]));
      } else if (type === 'PReLU') {
        add(`${target}.weight`, data.take(p[0]));
      } else if (type === 'Scale') {
        // rt.js implements sigmoid(x)*2-1 directly; these constants are not trained tensors.
        const scale = data.take(3), bias = data.take(3);
        for (let i = 0; i < 3; i++) {
          assert.equal(scale.readFloatLE(i * 4), 2, 'Expected residual scale 2');
          assert.equal(bias.readFloatLE(i * 4), -1, 'Expected residual bias -1');
        }
      }
    }
    data.end();
  }
  // Headerless file: layout inferred from byte count and expected architecture.
  // Confirm this order against the exporter/native implementation before promotion.
  const film = reader(files['film_mlp.bin'], 'film_mlp.bin');
  for (const name of ['film.0.weight', 'film.0.bias', 'film.2.weight', 'film.2.bias']) add(name, film.take(elements(manifest[name].shape)));
  film.end();
  assert.equal(tensors.size, Object.keys(manifest).length);
  const bin = Buffer.concat(Object.keys(manifest).map((name) => tensors.get(name)));
  const report = {
    schema: 1, model: 'tfact2_ours', status: 'converted-candidate-not-inference-validated',
    targetRuntime: 'framegen@1.4.0', encoding: 'little-endian-float32', offsetUnit: 'float32-elements',
    tensorCount: tensors.size, parameterCount: bin.length / 4, bytes: bin.length,
    weightsSha256: sha256(bin),
    sources: Object.fromEntries(sourceFiles.map((name) => [name, { bytes: files[name].length, sha256: sha256(files[name]) }])),
    transformations: ['Remove FP32 NCNN storage flags', 'Transpose lastconv [5,96,4,4] to [96,5,4,4] without flipping kernels', 'Validate and omit constant Scale [2,2,2], bias [-1,-1,-1]', 'Concatenate 47 tensors in runtime manifest order'],
    pendingValidation: [
      'Confirm headerless film_mlp.bin order: film.0.weight, film.0.bias, film.2.weight, film.2.bias',
      'Confirm custom TfactFilm, TfactRPrep, TfactCompose and host preprocessing against rt.js',
      'Compare native reference and WebGPU output for identical input frames (including timestep 0.5)',
      'Measure real-video quality and GPU performance before replacing SDK defaults',
    ],
  };
  return { bin, manifest, report };
}

export function convertDirectory(inputDirectory, outputDirectory) {
  const input = resolve(inputDirectory), output = resolve(outputDirectory);
  const files = Object.fromEntries(sourceFiles.map((name) => [name, readFileSync(join(input, name))]));
  const result = convertModel(files); // Validate everything before touching the output directory.
  mkdirSync(output); // Must be NEW; never overwrite input files or an existing conversion.
  writeFileSync(join(output, 'tfact2_ours.bin'), result.bin, { flag: 'wx' });
  writeFileSync(join(output, 'tfact2_ours.json'), JSON.stringify(result.manifest, null, 2) + '\n', { flag: 'wx' });
  writeFileSync(join(output, 'conversion-report.json'), JSON.stringify(result.report, null, 2) + '\n', { flag: 'wx' });
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    assert(args.length === 2, 'Usage: node scripts/convert-framegen-model.mjs <input-directory> <NEW-output-directory>');
    const { report } = convertDirectory(...args);
    console.log(JSON.stringify(report, null, 2));
    console.log(`Candidate written to ${resolve(args[1])}; SDK defaults unchanged.`);
  } catch (error) { console.error(`Conversion stopped: ${error.message}`); process.exitCode = 1; }
}

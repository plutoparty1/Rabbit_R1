import test from 'node:test';
import assert from 'node:assert/strict';
import { installLocalAsrWorker } from '../dist/local-asr-worker.mjs';

function fixture(overrides = {}) {
  const sent = [];
  const calls = [];
  let imports = 0;
  class Tensor {
    constructor(type, data, dims) { Object.assign(this, { type, data, dims }); }
    dispose() { this.disposed = true; }
  }
  const logits = new Tensor('float32', new Float32Array([200, -3, 0.2, 2.8]), [1, 1, 4]);
  const features = new Tensor('float32', new Float32Array([0]), [1, 1]);
  const encoder = new Tensor('float32', new Float32Array([0.25]), [1, 1, 1]);
  const generated = new Tensor('int64', new BigInt64Array([1n, 2n]), [1, 2]);
  const pipeline = Object.assign(async (audio, options) => {
    calls.push({ longAudio: audio.slice(), options });
    if (overrides.inference) return overrides.inference(audio, options);
    return { text: '  아이유 밤편지  ' };
  }, {
    processor: async audio => { calls.push({ processedSamples: audio.length }); return { input_features: features }; },
    tokenizer: { batch_decode: tokens => { assert.equal(tokens, generated); return ['  아이유 밤편지  ']; } },
    model: Object.assign(async input => {
      calls.push({ detectionInput: input });
      return { logits };
    }, {
      forward_params: ['input_features', 'decoder_input_ids'],
      async _prepare_encoder_decoder_kwargs_for_generation({ model_inputs }) {
        calls.push({ encodedFeatures: model_inputs.input_features });
        return { ...model_inputs, encoder_outputs: encoder };
      },
      async generate(options) {
        calls.push({ options });
        if (overrides.inference) return overrides.inference(null, options);
        return generated;
      },
      generation_config: {
        decoder_start_token_id: 42,
        lang_to_id: { '<|en|>': 2, '<|ko|>': 3, '<|bad|>': 500 },
      },
    }),
  });
  const env = { backends: { onnx: { wasm: {} } } };
  const library = {
    Tensor, env,
    async pipeline(task, model, options) {
      calls.push({ task, model, options });
      if (overrides.load) await overrides.load();
      options.progress_callback({ status: 'progress', file: 'secret-provider-error', loaded: 1, total: 10, progress: 10 });
      options.progress_callback({ status: 'arbitrary-provider-error', message: 'private' });
      return pipeline;
    },
  };
  const handler = installLocalAsrWorker({
    addEventListener(type) { assert.equal(type, 'message'); },
    postMessage(message) { sent.push(message); },
  }, async () => { imports++; return library; });
  return { sent, calls, handler: message => handler({ data: message }), env, logits, features, encoder, generated, pipeline, imports: () => imports };
}

test('load is lazy, pins the WASM model/runtime and exposes only safe progress', async () => {
  const f = fixture();
  assert.equal(f.imports(), 0);
  await f.handler({ id: 1, type: 'load' });
  assert.equal(f.imports(), 1);
  assert.equal(f.calls[0].task, 'automatic-speech-recognition');
  assert.equal(f.calls[0].model, 'Xenova/whisper-tiny');
  assert.equal(f.calls[0].options.revision, '5332fcc35e32a33b86612b9a57a89be7906102b1');
  assert.equal(f.calls[0].options.device, 'wasm');
  assert.equal(f.calls[0].options.dtype, 'q8');
  assert.deepEqual(f.env.backends.onnx.wasm, {
    numThreads: 1, proxy: false,
    wasmPaths: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/',
  });
  assert.equal(f.env.allowLocalModels, false);
  assert.deepEqual(f.sent, [
    { id: 1, type: 'progress', progress: { status: 'progress', loaded: 1, total: 10, progress: 10 } },
    { id: 1, type: 'ready' },
  ]);
  await f.handler({ id: 2, type: 'load' });
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.sent.at(-1), { id: 2, type: 'ready' });
});

test('rejects invalid or excessive audio before model download', async () => {
  const f = fixture();
  for (const audio of [[], new Float32Array(), new Float32Array(960001), new Float32Array([NaN]), new Float32Array([1.1])]) {
    await f.handler({ id: 1, type: 'transcribe', audio, language: '' });
    assert.deepEqual(f.sent.at(-1), { id: 1, type: 'error', code: 'invalid_audio' });
  }
  assert.equal(f.imports(), 0);
});

test('auto detection and transcription reuse one encoder pass while masking non-language tokens', async () => {
  const f = fixture();
  const audio = new Float32Array([0.1, -0.1]);
  await f.handler({ id: 'auto', type: 'transcribe', audio, language: '' });
  const detection = f.calls.find(call => call.detectionInput).detectionInput;
  const options = f.calls.at(-1).options;
  assert.equal(detection.decoder_input_ids.data[0], 42n);
  assert.equal(detection.encoder_outputs, f.encoder);
  assert.equal(options.encoder_outputs, f.encoder);
  assert.equal(options.input_features, f.features);
  assert.equal(f.calls.filter(call => call.encodedFeatures).length, 1);
  assert.equal(f.calls.filter(call => call.processedSamples).length, 1);
  assert.ok(f.pipeline.model.forward_params.includes('encoder_outputs'));
  assert.equal(options.language, 'ko');
  assert.equal(options.task, 'transcribe');
  assert.equal(options.max_new_tokens, 128);
  assert.equal(options.do_sample, false);
  assert.deepEqual(f.sent.at(-1), { id: 'auto', type: 'result', text: '아이유 밤편지', language: 'ko' });
  assert.ok(f.logits.disposed && f.features.disposed && f.encoder.disposed && f.generated.disposed);
  assert.deepEqual([...audio], [0, 0]);
});

test('manual language skips detection and does not run a translation task', async () => {
  const f = fixture();
  await f.handler({ id: 3, type: 'transcribe', audio: new Float32Array([0.1]), language: 'ja' });
  assert.equal(f.calls.length, 3);
  assert.equal(f.calls.at(-1).options.language, 'ja');
  assert.equal(f.calls.at(-1).options.task, 'transcribe');
  assert.equal(f.calls.filter(call => call.detectionInput).length, 0);
});

test('language is detected again on every utterance instead of caching the first language', async () => {
  const f = fixture();
  await f.handler({ id: 1, type: 'transcribe', audio: new Float32Array([0.1]), language: '' });
  f.logits.data[2] = 7;
  await f.handler({ id: 2, type: 'transcribe', audio: new Float32Array([0.1]), language: '' });
  assert.equal(f.sent.at(-1).language, 'en');
  assert.equal(f.calls.filter(call => call.detectionInput).length, 2);
});

test('a full 60-second recording uses overlapping supported chunks without truncating the audio', async () => {
  const f = fixture();
  const audio = new Float32Array(960000);
  audio[0] = 0.2;
  audio[audio.length - 1] = 0.4;
  await f.handler({ id: 1, type: 'transcribe', audio, language: '' });
  const call = f.calls.find(call => call.longAudio);
  assert.equal(call.longAudio.length, 960000);
  assert.ok(call.longAudio.at(-1) > 0.39);
  assert.equal(call.options.chunk_length_s, 25);
  assert.equal(call.options.stride_length_s, 3);
  assert.equal(call.options.language, 'ko');
  assert.equal(f.calls.find(call => call.processedSamples).processedSamples, 25 * 16000);
  assert.equal(f.sent.at(-1).type, 'result');
  assert.ok(audio.every(sample => sample === 0));
});

test('30 seconds still uses one generation call without overlapping chunk overhead', async () => {
  const f = fixture();
  await f.handler({ id: 1, type: 'transcribe', audio: new Float32Array(480000), language: '' });
  assert.equal(f.calls.filter(call => call.longAudio).length, 0);
  assert.equal(f.calls.filter(call => call.encodedFeatures).length, 1);
  assert.equal(f.sent.at(-1).type, 'result');
});

test('overlapping work is rejected and provider errors never leak', async () => {
  let rejectLoad;
  const f = fixture({ load: () => new Promise((resolve, reject) => { rejectLoad = reject; }) });
  const loading = f.handler({ id: 1, type: 'load' });
  await Promise.resolve();
  await f.handler({ id: 2, type: 'load' });
  assert.deepEqual(f.sent.at(-1), { id: 2, type: 'error', code: 'busy' });
  rejectLoad(new Error('https://example.com/private-token'));
  await loading;
  assert.deepEqual(f.sent.at(-1), { id: 1, type: 'error', code: 'model_load_failed' });
  assert.equal(JSON.stringify(f.sent).includes('private-token'), false);
});

test('failed inference clears transferred audio and reports a bounded error code', async () => {
  const f = fixture({ inference: () => { throw new Error('private recording'); } });
  const audio = new Float32Array([0.3]);
  await f.handler({ id: 9, type: 'transcribe', audio, language: 'ko' });
  assert.deepEqual(f.sent.at(-1), { id: 9, type: 'error', code: 'transcription_failed' });
  assert.equal(audio[0], 0);
});

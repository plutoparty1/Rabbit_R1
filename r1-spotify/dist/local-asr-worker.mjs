// All inference runs inside this worker. Only public model/runtime files are fetched.
// Audio and transcripts are never sent to an inference service.
const LIBRARY_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';
const WASM_PATH = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/';
const MODEL_ID = 'Xenova/whisper-tiny';
const MODEL_REVISION = '5332fcc35e32a33b86612b9a57a89be7906102b1';
const SAMPLE_RATE = 16000;
const MAX_SAMPLES = 60 * SAMPLE_RATE;
const SINGLE_WINDOW_SAMPLES = 30 * SAMPLE_RATE;
const PROGRESS_STATUSES = new Set(['initiate', 'download', 'progress', 'done', 'ready']);
const INPUT_LANGUAGES = new Set(['', 'ko', 'en', 'ja']);

function validId(id) {
  return (typeof id === 'string' && id.length > 0 && id.length <= 120)
    || (typeof id === 'number' && Number.isSafeInteger(id));
}

function safeProgress(value) {
  if (!value || !PROGRESS_STATUSES.has(value.status)) return null;
  const result = { status: value.status };
  for (const key of ['loaded', 'total']) {
    if (Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= 1e9) {
      result[key] = Math.round(value[key]);
    }
  }
  if (Number.isFinite(value.progress)) result.progress = Math.max(0, Math.min(100, value.progress));
  return result;
}

function validAudio(audio) {
  if (!(audio instanceof Float32Array) || audio.length === 0 || audio.length > MAX_SAMPLES) return false;
  for (const sample of audio) if (!Number.isFinite(sample) || Math.abs(sample) > 1) return false;
  return true;
}

function disposeTensors(values, Tensor) {
  const seen = new Set();
  for (const value of Object.values(values ?? {})) {
    if (value instanceof Tensor && !seen.has(value)) {
      seen.add(value);
      try { value.dispose(); } catch { /* Cleanup must not replace the operation result. */ }
    }
  }
}

async function detectLanguage(transcriber, library, inputs) {
  // Transformers.js 3.8.1 defaults to English if language is omitted. Implement
  // Whisper's documented first-token language classification explicitly instead:
  // https://github.com/openai/whisper/blob/main/whisper/decoding.py#L19
  const config = transcriber.model.generation_config;
  const startToken = config?.decoder_start_token_id;
  const languages = config?.lang_to_id;
  if (!Number.isSafeInteger(startToken) || !languages) throw new Error('language_detection_unavailable');
  let output;
  let decoderInput;
  try {
    decoderInput = new library.Tensor('int64', new BigInt64Array([BigInt(startToken)]), [1, 1]);
    output = await transcriber.model({ ...inputs, decoder_input_ids: decoderInput });
    const logits = output?.logits;
    const vocabularySize = logits?.dims?.[logits.dims.length - 1];
    if (!Number.isSafeInteger(vocabularySize) || logits.data.length < vocabularySize) {
      throw new Error('language_detection_unavailable');
    }
    const offset = logits.data.length - vocabularySize;
    let bestLanguage = '';
    let bestScore = -Infinity;
    for (const [token, tokenId] of Object.entries(languages)) {
      const match = /^<\|([a-z]{2,3})\|>$/.exec(token);
      if (!match || !Number.isSafeInteger(tokenId) || tokenId < 0 || tokenId >= vocabularySize) continue;
      const score = logits.data[offset + tokenId];
      if (Number.isFinite(score) && score > bestScore) {
        bestScore = score;
        bestLanguage = match[1];
      }
    }
    if (!bestLanguage) throw new Error('language_detection_unavailable');
    return bestLanguage;
  } finally {
    disposeTensors(output, library.Tensor);
    disposeTensors({ decoderInput }, library.Tensor);
  }
}

async function encodeAudio(transcriber, inputs) {
  // Pinned Transformers.js exposes the encoder preparation method used by
  // generate(). Reuse its result for language detection and transcription.
  return transcriber.model._prepare_encoder_decoder_kwargs_for_generation({
    inputs_tensor: inputs.input_features,
    model_inputs: inputs,
    model_input_name: 'input_features',
    generation_config: { guidance_scale: null },
  });
}

async function recognize(transcriber, library, audio, requestedLanguage) {
  let inputs;
  let generated;
  try {
    const longAudio = audio.length > SINGLE_WINDOW_SAMPLES;
    inputs = await transcriber.processor(longAudio ? audio.subarray(0, 25 * SAMPLE_RATE) : audio);
    let language = requestedLanguage;
    if (!language) {
      inputs = await encodeAudio(transcriber, inputs);
      language = await detectLanguage(transcriber, library, inputs);
    }
    const options = {
      language,
      task: 'transcribe',
      return_timestamps: false,
      max_new_tokens: 128,
      do_sample: false,
      num_beams: 1,
    };
    if (longAudio) {
      // Preserve the complete recording. The supported pipeline merges overlap
      // tokens instead of truncating at Whisper's fixed 30-second input window.
      disposeTensors(inputs, library.Tensor);
      inputs = null;
      const output = await transcriber(audio, { ...options, chunk_length_s: 25, stride_length_s: 3 });
      return { text: output?.text, language };
    }
    generated = await transcriber.model.generate({ ...inputs, ...options });
    const text = transcriber.tokenizer.batch_decode(generated, { skip_special_tokens: true })[0];
    return { text, language };
  } finally {
    disposeTensors(inputs, library.Tensor);
    disposeTensors({ generated }, library.Tensor);
  }
}

// Dependency injection lets tests exercise the worker protocol without fetching
// a model or using a microphone. Production always uses the pinned public URL.
export function installLocalAsrWorker(scope, loadLibrary = () => import(LIBRARY_URL)) {
  let library;
  let transcriber;
  let busy = false;

  const send = (id, type, detail = {}) => scope.postMessage({ id, type, ...detail });
  const error = (id, code) => send(id, 'error', { code });

  async function load(id) {
    if (transcriber) return;
    library ??= await loadLibrary();
    library.env.allowLocalModels = false;
    library.env.backends.onnx.wasm.numThreads = 1;
    library.env.backends.onnx.wasm.proxy = false;
    library.env.backends.onnx.wasm.wasmPaths = WASM_PATH;
    transcriber = await library.pipeline('automatic-speech-recognition', MODEL_ID, {
      revision: MODEL_REVISION,
      device: 'wasm',
      dtype: 'q8',
      progress_callback(value) {
        const progress = safeProgress(value);
        if (progress) send(id, 'progress', { progress });
      },
    });
    // 3.8.1 supports encoder_outputs in generation but omits it from Whisper's
    // input allowlist. Keep it so generate() does not encode the same audio twice.
    transcriber.model.forward_params = [...new Set([...transcriber.model.forward_params, 'encoder_outputs'])];
  }

  async function onMessage(event) {
    const message = event?.data;
    if (!message || !validId(message.id) || !['load', 'transcribe'].includes(message.type)) return;
    const { id, type } = message;
    if (busy) return error(id, 'busy');
    if (type === 'transcribe' && (!validAudio(message.audio) || !INPUT_LANGUAGES.has(message.language ?? ''))) {
      return error(id, 'invalid_audio');
    }
    busy = true;
    try {
      try {
        await load(id);
      } catch {
        // A failed WebAssembly runtime may need a fresh worker. The parent owns
        // termination/retry; do not return URLs, provider errors or credentials.
        return error(id, 'model_load_failed');
      }
      if (type === 'load') return send(id, 'ready');
      try {
        const output = await recognize(transcriber, library, message.audio, message.language || '');
        const text = typeof output?.text === 'string' ? output.text.trim().slice(0, 2000) : '';
        send(id, 'result', { text, language: output.language });
      } catch {
        error(id, 'transcription_failed');
      }
    } finally {
      // The parent transfers this buffer; erase our copy after recognition or a
      // model-loading failure. Cancellation destroys this entire worker instead.
      if (type === 'transcribe') message.audio.fill(0);
      busy = false;
    }
  }
  scope.addEventListener('message', onMessage);
  return onMessage;
}

if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) {
  installLocalAsrWorker(globalThis);
}

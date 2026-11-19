// Records every narration line with each voice of src/audio/voices.ts through
// Speko's text-to-speech (https://docs.speko.dev/api-reference/synthesize),
// as small MP3 clips in public/narration/<voice>/<key>.mp3, and lists them in
// src/audio/clips.json.
//
//   SPEKO_API_KEY=sk_... npm run narrate            # record what is missing
//   npm run narrate -- --dry                        # list what would be recorded
//   npm run narrate -- --voice charon --force       # re-record one voice
//   npm run narrate -- --plan DIR                   # list missing clips per voice in DIR/<voice>.json
//   npm run narrate -- --import DIR                 # use DIR/<voice>/<key>.<wav,mp3,...> instead of calling the API
//
// --plan and --import let the clips be made some other way, for example with
// Speko's MCP tool audio.synthesize, which needs no API key on this machine.
//
// The key can also live in explorer/.env.local (git-ignored). Clips already
// on disk are kept, so only new or edited lines cost anything. Needs ffmpeg.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { runnerImport } from 'vite';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'public/narration');
const MANIFEST = join(ROOT, 'src/audio/clips.json');
const API = 'https://api.speko.dev/v1/synthesize';
const PARALLEL = 4;

const { values: opts } = parseArgs({
  options: {
    dry: { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
    voice: { type: 'string', multiple: true },
    plan: { type: 'string' },
    import: { type: 'string' },
  },
});

const load = async (path) => (await runnerImport(join(ROOT, path))).module;
const { allLines } = await load('src/narration.ts');
const { speakable } = await load('src/audio/speech.ts');
const { VOICES, clipKey } = await load('src/audio/voices.ts');

const texts = new Map();
for (const html of allLines()) {
  const text = speakable(html);
  if (text) texts.set(clipKey(text), text);
}
const chars = [...texts.values()].reduce((n, t) => n + t.length, 0);
console.log(`${texts.size} lines, ${chars.toLocaleString('en')} characters per voice`);

function apiKey() {
  if (process.env.SPEKO_API_KEY) return process.env.SPEKO_API_KEY;
  const env = join(ROOT, '.env.local');
  const m = existsSync(env) && readFileSync(env, 'utf8').match(/^SPEKO_API_KEY=(.+)$/m);
  if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  throw new Error('Set SPEKO_API_KEY (or put it in explorer/.env.local).');
}

async function synthesize(voice, text, key) {
  const body = {
    text,
    intent: { language: 'en' },
    voice: voice.speko.voice,
    workload: 'narration',
    constraints: { allowedProviders: { tts: [voice.speko.provider] } },
  };
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) return { audio: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') ?? '' };
    const err = await res.text();
    if (attempt >= 3 || (res.status < 500 && res.status !== 429)) throw new Error(`${voice.id} ${res.status}: ${err}`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
}

/** Any format Speko returns, to a loudness-normalised mono MP3 without silence at the ends. */
function toMp3({ audio, type }, out) {
  const tmp = join(tmpdir(), `narrate-${process.pid}-${Math.random().toString(36).slice(2)}`);
  writeFileSync(tmp, audio);
  const pcm = type.match(/pcm.*rate=(\d+)/i) || (/pcm|l16/i.test(type) && [null, '24000']);
  const input = pcm ? ['-f', 's16le', '-ar', pcm[1], '-ac', '1', '-i', tmp] : ['-i', tmp];
  const trim = 'silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse';
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-y', ...input, '-af', `${trim},loudnorm=I=-18:TP=-1.5:LRA=11`, '-ac', '1', '-ar', '24000', '-b:a', '40k', out]);
  } finally {
    rmSync(tmp, { force: true });
  }
}

const voices = opts.voice ? VOICES.filter((v) => opts.voice.includes(v.id)) : VOICES;
const jobs = [];
for (const voice of voices) {
  mkdirSync(join(OUT, voice.id), { recursive: true });
  for (const [k, text] of texts) {
    const file = join(OUT, voice.id, `${k}.mp3`);
    if (opts.force || !existsSync(file)) jobs.push({ voice, key: k, text, file });
  }
}
console.log(`${jobs.length} clips to record`);
if (opts.dry) {
  for (const j of jobs) console.log(`  ${j.voice.id}  ${j.text.slice(0, 90)}`);
  process.exit(0);
}

if (opts.plan) {
  mkdirSync(opts.plan, { recursive: true });
  for (const voice of voices) {
    const list = jobs.filter((j) => j.voice === voice).map(({ key, text }) => ({ key, text }));
    writeFileSync(join(opts.plan, `${voice.id}.json`), `${JSON.stringify({ speko: voice.speko, clips: list }, null, 2)}\n`);
  }
  console.log(`Plans written to ${opts.plan}`);
  process.exit(0);
}

let failed = 0;
if (opts.import) {
  for (const j of jobs) {
    const dir = join(opts.import, j.voice.id);
    const name = existsSync(dir) && readdirSync(dir).find((f) => f.startsWith(`${j.key}.`));
    if (!name) continue;
    try {
      toMp3({ audio: readFileSync(join(dir, name)), type: '' }, j.file);
    } catch (e) {
      failed++;
      console.error(`  FAILED ${j.voice.id}  ${j.key}\n    ${e.message}`);
    }
  }
} else if (jobs.length) {
  const key = apiKey();
  let done = 0;
  const work = async () => {
    for (let j = jobs.shift(); j; j = jobs.shift()) {
      try {
        toMp3(await synthesize(j.voice, j.text, key), j.file);
        console.log(`  [${++done}] ${j.voice.id}  ${j.text.slice(0, 70)}`);
      } catch (e) {
        failed++;
        console.error(`  FAILED ${j.voice.id}  ${j.text.slice(0, 70)}\n    ${e.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, work));
}

// Forget clips of lines that changed or went away, and list those every voice has.
for (const voice of VOICES) {
  const dir = join(OUT, voice.id);
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) if (!texts.has(f.replace(/\.mp3$/, ''))) rmSync(join(dir, f));
}
const keys = [...texts.keys()].filter((k) => VOICES.every((v) => existsSync(join(OUT, v.id, `${k}.mp3`)))).sort();
writeFileSync(MANIFEST, `${JSON.stringify({ format: 'mp3', keys }, null, 2)}\n`);
console.log(`${keys.length} of ${texts.size} lines recorded in every voice${failed ? `, ${failed} failed` : ''}.`);
process.exit(failed ? 1 : 0);

// All sounds are synthesized with WebAudio, so there are no audio files to
// load. The context can only start after a user gesture (see unlockAudio).
const MUTE_KEY = "ejderha-muted";

let ctx = null,
  master,
  sfxBus,
  musicBus,
  windGain,
  windFilter,
  noiseBuffer,
  musicTimer = 0,
  nextNoteTime = 0,
  noteIndex = 0,
  muted = readMuted();

function readMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function isMuted() {
  return muted;
}

export function setMuted(value) {
  muted = value;
  try {
    localStorage.setItem(MUTE_KEY, value ? "1" : "0");
  } catch {}
  if (master) master.gain.setTargetAtTime(muted ? 0 : 0.8, ctx.currentTime, 0.05);
}

export function unlockAudio() {
  if (!ctx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    ctx = new AudioCtx();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.8;
    master.connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.7;
    sfxBus.connect(master);
    musicBus = ctx.createGain();
    musicBus.gain.value = 0.22;
    musicBus.connect(master);
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    startWind();
  }
  if (ctx.state === "suspended") ctx.resume();
}

function noise(duration) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = duration > 2;
  return src;
}

function envelope(gainNode, t, attack, peak, release) {
  gainNode.gain.setValueAtTime(0.0001, t);
  gainNode.gain.exponentialRampToValueAtTime(peak, t + attack);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
}

function tone(freq, type, start, attack, peak, release, bus = sfxBus) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  envelope(gain, start, attack, peak, release);
  osc.connect(gain).connect(bus);
  osc.start(start);
  osc.stop(start + attack + release + 0.05);
  return osc;
}

function noiseBurst(start, duration, filterType, freq, peak, sweepTo) {
  const src = noise(duration);
  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.setValueAtTime(freq, start);
  if (sweepTo)
    filter.frequency.exponentialRampToValueAtTime(sweepTo, start + duration);
  const gain = ctx.createGain();
  envelope(gain, start, 0.01, peak, duration);
  src.connect(filter).connect(gain).connect(sfxBus);
  src.start(start);
  src.stop(start + duration + 0.1);
}

function startWind() {
  const src = noise(10);
  windFilter = ctx.createBiquadFilter();
  windFilter.type = "bandpass";
  windFilter.frequency.value = 500;
  windFilter.Q.value = 0.7;
  windGain = ctx.createGain();
  windGain.gain.value = 0;
  src.connect(windFilter).connect(windGain).connect(master);
  src.start();
}

// level: 0 (silent) .. 1 (full boost)
export function setWind(level) {
  if (!ctx) return;
  const t = ctx.currentTime;
  windGain.gain.setTargetAtTime(0.04 + level * 0.12, t, 0.2);
  windFilter.frequency.setTargetAtTime(380 + level * 900, t, 0.2);
}

export function silenceWind() {
  if (ctx) windGain.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
}

const sfx = {
  coin(t) {
    tone(988, "square", t, 0.005, 0.12, 0.08);
    tone(1319, "square", t + 0.07, 0.005, 0.12, 0.18);
  },
  ring(t) {
    [784, 988, 1175, 1568].forEach((f, i) =>
      tone(f, "triangle", t + i * 0.05, 0.005, 0.18, 0.2),
    );
  },
  nearMiss(t) {
    noiseBurst(t, 0.35, "bandpass", 2400, 0.35, 500);
  },
  fire(t) {
    noiseBurst(t, 0.7, "lowpass", 3000, 0.5, 300);
    const osc = tone(110, "sawtooth", t, 0.02, 0.15, 0.5);
    osc.frequency.exponentialRampToValueAtTime(55, t + 0.5);
  },
  explosion(t) {
    noiseBurst(t, 0.9, "lowpass", 1800, 0.9, 80);
    const osc = tone(90, "sine", t, 0.005, 0.8, 0.6);
    osc.frequency.exponentialRampToValueAtTime(30, t + 0.6);
  },
  crash(t) {
    sfx.explosion(t);
    const osc = tone(300, "sawtooth", t, 0.01, 0.25, 0.9);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.9);
  },
  boost(t) {
    const osc = tone(220, "sawtooth", t, 0.02, 0.2, 0.6);
    osc.frequency.exponentialRampToValueAtTime(880, t + 0.5);
    noiseBurst(t, 0.6, "highpass", 1200, 0.25, 4000);
  },
  shield(t) {
    tone(523, "sine", t, 0.005, 0.3, 0.4);
    tone(262, "sine", t, 0.005, 0.3, 0.5);
  },
  powerup(t) {
    [523, 659, 784].forEach((f, i) =>
      tone(f, "square", t + i * 0.06, 0.005, 0.1, 0.15),
    );
  },
  buy(t) {
    tone(659, "triangle", t, 0.005, 0.2, 0.1);
    tone(988, "triangle", t + 0.08, 0.005, 0.2, 0.25);
  },
  denied(t) {
    tone(160, "square", t, 0.005, 0.12, 0.2);
  },
  checkpoint(t) {
    [523, 784, 1047, 1568].forEach((f, i) =>
      tone(f, "triangle", t + i * 0.08, 0.005, 0.2, 0.3),
    );
  },
};

export function play(name) {
  if (!ctx || muted || !sfx[name]) return;
  sfx[name](ctx.currentTime + 0.005);
}

// A small A-minor pentatonic arpeggio over a bass line, scheduled ahead so
// timing stays steady even if a frame hitches.
const STEP = 60 / 112 / 2;
const ARP = [0, 3, 7, 10, 12, 10, 7, 3];
const BASS = [45, 45, 41, 43];
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

function scheduleMusic() {
  while (nextNoteTime < ctx.currentTime + 0.2) {
    const bar = Math.floor(noteIndex / 8) % BASS.length;
    const root = BASS[bar];
    tone(midi(root + 24 + ARP[noteIndex % 8]), "triangle", nextNoteTime, 0.01, 0.35, STEP * 0.9, musicBus);
    if (noteIndex % 4 === 0)
      tone(midi(root), "sawtooth", nextNoteTime, 0.02, 0.4, STEP * 3.5, musicBus);
    noteIndex += 1;
    nextNoteTime += STEP;
  }
}

export function startMusic() {
  if (!ctx || musicTimer) return;
  nextNoteTime = ctx.currentTime + 0.1;
  noteIndex = 0;
  musicTimer = window.setInterval(scheduleMusic, 50);
}

export function stopMusic() {
  window.clearInterval(musicTimer);
  musicTimer = 0;
}

// Short vibration on phones; silently ignored elsewhere.
export function buzz(pattern) {
  if (muted) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {}
}

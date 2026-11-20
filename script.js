'use strict';

/* ======================================================
   Instruments & kits
   ====================================================== */

const PADS = [
    { code: 'KeyA', label: 'A', name: 'boom' },
    { code: 'KeyS', label: 'S', name: 'clap' },
    { code: 'KeyD', label: 'D', name: 'hihat' },
    { code: 'KeyF', label: 'F', name: 'kick' },
    { code: 'KeyG', label: 'G', name: 'openhat' },
    { code: 'KeyH', label: 'H', name: 'ride' },
    { code: 'KeyJ', label: 'J', name: 'snare' },
    { code: 'KeyK', label: 'K', name: 'tink' },
    { code: 'KeyL', label: 'L', name: 'tom' },
    { code: 'KeyE', label: 'E', name: 'crash' },
    { code: 'KeyR', label: 'R', name: 'tom2' },
    { code: 'KeyU', label: 'U', name: 'cowbell' },
    { code: 'KeyI', label: 'I', name: 'splash' },
];

// The percussion kit reuses the same pieces with different instruments
const PERC_LABELS = {
    boom: 'conga', clap: 'bongo', hihat: 'shaker', kick: 'cowbell', openhat: 'woodblock',
    ride: 'clave', snare: 'tambourine', tink: 'triangle', tom: 'timbale',
    crash: 'gong', tom2: 'djembe', cowbell: 'agogo', splash: 'chimes',
};

// kind: where the sounds come from. fx: effect chain. rate: sample pitch.
const KITS = {
    acoustic:   { title: 'Acoustic',   kind: 'sample', fx: 'dry',   rate: 1 },
    rock:       { title: 'Rock Arena', kind: 'sample', fx: 'arena', rate: 0.92 },
    lofi:       { title: 'Lo-Fi',      kind: 'sample', fx: 'lofi',  rate: 0.86 },
    electronic: { title: 'Electronic', kind: 'synth',  fx: 'dry' },
    percussion: { title: 'Percussion', kind: 'perc',   fx: 'room' },
};

// Recorded samples we have; tom2 reuses the tom, tuned up
const SAMPLE_MAP = {
    boom: ['boom', 1], clap: ['clap', 1], hihat: ['hihat', 1], kick: ['kick', 1],
    openhat: ['openhat', 1], ride: ['ride', 1], snare: ['snare', 1], tink: ['tink', 1],
    tom: ['tom', 1], tom2: ['tom', 1.3],
};
const SAMPLE_FILES = [...new Set(Object.values(SAMPLE_MAP).map(([f]) => f))];

const TRACK_COLORS = ['#ffb547', '#2ee6ff', '#ff5d8f', '#7cff6b', '#b18cff', '#ffd36b', '#ff7a3d', '#5df2c6'];
const MAX_TRACKS = 8;
const LOOKAHEAD = 0.12;   // seconds of audio scheduled ahead

const $ = (sel) => document.querySelector(sel);
const stageEl = $('#stage');
const kitEl = $('#kit');
const volumeEl = $('#volume');
const bpmEl = $('#bpm');
const metroBtn = $('#metro-toggle');
const recBtn = $('#rec');
const playBtn = $('#play');
const barsEl = $('#bars');
const quantizeEl = $('#quantize');
const countInEl = $('#countin');
const tracksBtn = $('#tracks-toggle');
const trackCountEl = $('#track-count');
const tracksPanel = $('#tracks');
const trackListEl = $('#track-list');
const exportBtn = $('#export');
const clearBtn = $('#clear');
const statusEl = $('#status');
const beatDots = [...document.querySelectorAll('#beats i')];
const barPosEl = $('#barpos');

/* ======================================================
   Settings (remembered per browser)
   ====================================================== */

function load(key, fallback) {
    try {
        const v = localStorage.getItem(key);
        return v === null ? fallback : v;
    } catch {
        return fallback;
    }
}

function save(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch {
        /* storage unavailable: ignore */
    }
}

// Kit menu is built from KITS so the two never drift apart
kitEl.innerHTML = Object.entries(KITS).map(([id, k]) => `<option value="${id}">${k.title}</option>`).join('');
kitEl.value = load('drum.kit', 'acoustic');
if (!kitEl.value) kitEl.value = 'acoustic';
volumeEl.value = load('drum.volume', '0.8');
bpmEl.value = load('drum.bpm', '100');
barsEl.value = load('drum.bars', '2');
if (!barsEl.value) barsEl.value = '2';
quantizeEl.value = load('drum.quantize', '4');
if (!quantizeEl.value) quantizeEl.value = '4';
countInEl.checked = load('drum.countin', '1') === '1';

/* ======================================================
   The kit on screen (kit.js)
   ====================================================== */

DrumKit.build(stageEl, PADS, (name, vel) => hit(name, vel));

function labelFor(name, kit) {
    return kit === 'percussion' ? PERC_LABELS[name] : name;
}

const THEME_BG = { acoustic: '#0b0708', rock: '#07060c', lofi: '#0e1413', electronic: '#05060d', percussion: '#0d0805' };

function updateLabels() {
    document.body.dataset.kit = kitEl.value;   // switches the colour theme
    document.querySelector('meta[name="theme-color"]').content = THEME_BG[kitEl.value];
    PADS.forEach(({ name }) => DrumKit.setLabel(name, labelFor(name, kitEl.value)));
}
updateLabels();

/* ======================================================
   Audio engine (Web Audio API)
   These globals are swapped for an OfflineAudioContext when exporting.
   ====================================================== */

let ac = null;          // AudioContext
let out = null;         // master gain
let noiseBuf = null;
let buses = {};         // kit name -> input node of that kit's effect chain
let route = null;       // where the sound being built connects to

const samples = {};
let samplesLoading = null;
let useFallback = false; // true when samples can't be fetched (e.g. opened via file://)

function getCtx() {
    if (!ac) {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        out = ac.createGain();
        out.gain.value = Number(volumeEl.value);
        out.connect(ac.destination);
        route = out;
        noiseBuf = makeNoise();
        loadSamples();
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
}

function loadSamples() {
    if (samplesLoading) return samplesLoading;
    samplesLoading = Promise.all(SAMPLE_FILES.map(async (file) => {
        const res = await fetch(`Sounds/${file}.wav`);
        if (!res.ok) throw new Error(res.statusText);
        samples[file] = await ac.decodeAudioData(await res.arrayBuffer());
    })).catch(() => {
        useFallback = true;
    });
    return samplesLoading;
}

/* ---------- Unlocking audio on phones ----------
   - Browsers only allow audio after a real user gesture. On touch screens
     `pointerdown` doesn't count, but `touchend` / `pointerup` / `click` do,
     so we resume the AudioContext from those.
   - On iPhone, the silent switch mutes Web Audio. Telling Safari this is a
     "playback" app (or playing a silent <audio> once) makes sound play anyway. */

let unlocked = false;

function silentWavUrl() {
    const rate = 8000, len = 800;
    const buf = new ArrayBuffer(44 + len);
    const v = new DataView(buf);
    const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF'); v.setUint32(4, 36 + len, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
    str(36, 'data'); v.setUint32(40, len, true);
    for (let i = 0; i < len; i++) v.setUint8(44 + i, 128);
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

function unlockAudio() {
    getCtx();
    if (ac.state === 'running' && unlocked) return;
    try {
        if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch { /* not supported */ }
    if (!unlocked) {
        const a = new Audio(silentWavUrl());
        a.setAttribute('playsinline', '');
        a.play().catch(() => {});
        const src = ac.createBufferSource();
        src.buffer = ac.createBuffer(1, 1, 22050);
        src.connect(ac.destination);
        src.start(0);
    }
    ac.resume().then(() => {
        if (ac.state === 'running') unlocked = true;
    });
}

/* ---------- Keep the screen still on phones ---------- */

const isControl = (el) => el instanceof Element && el.closest('input, select, label, .controls, .dock');

document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1 || !isControl(e.target)) e.preventDefault();
}, { passive: false });

['gesturestart', 'gesturechange', 'dblclick'].forEach((type) =>
    document.addEventListener(type, (e) => e.preventDefault(), { passive: false }));

window.addEventListener('contextmenu', (e) => {
    if (!isControl(e.target)) e.preventDefault();
});

['touchend', 'pointerup', 'click', 'keydown'].forEach((type) =>
    window.addEventListener(type, unlockAudio, { capture: true, passive: true }));

/* ---------- Effect chains per kit ---------- */

function makeNoise() {
    const len = ac.sampleRate;
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
}

function makeReverb(seconds, decay) {
    const len = Math.floor(ac.sampleRate * seconds);
    const buf = ac.createBuffer(2, len, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    const conv = ac.createConvolver();
    conv.buffer = buf;
    return conv;
}

function kitBus(kit) {
    if (buses[kit]) return buses[kit];
    const input = ac.createGain();
    const fx = KITS[kit].fx;

    if (fx === 'arena') {
        // punchy and huge: compressed dry signal + a long stadium reverb
        const comp = ac.createDynamicsCompressor();
        comp.threshold.value = -20;
        comp.ratio.value = 4;
        comp.attack.value = 0.005;
        comp.release.value = 0.2;
        const boost = ac.createGain();
        boost.gain.value = 1.15;
        input.connect(comp).connect(boost).connect(out);
        const wet = ac.createGain();
        wet.gain.value = 0.32;
        input.connect(makeReverb(2.6, 2.4)).connect(wet).connect(out);
    } else if (fx === 'lofi') {
        // warm and dusty: soft saturation, rolled-off highs and lows
        const shaper = ac.createWaveShaper();
        const curve = new Float32Array(1024);
        for (let i = 0; i < 1024; i++) {
            const x = (i / 1023) * 2 - 1;
            curve[i] = Math.tanh(x * 2.2) / Math.tanh(2.2);
        }
        shaper.curve = curve;
        const lp = ac.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 2600;
        const hp = ac.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 90;
        const g = ac.createGain();
        g.gain.value = 0.9;
        input.connect(shaper).connect(lp).connect(hp).connect(g).connect(out);
    } else if (fx === 'room') {
        input.connect(out);
        const wet = ac.createGain();
        wet.gain.value = 0.18;
        input.connect(makeReverb(0.9, 3)).connect(wet).connect(out);
    } else {
        input.connect(out);
    }

    buses[kit] = input;
    return input;
}

/* ---------- Synth building blocks ---------- */

function envelope(peak, attack, decay, t) {
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(route);
    return g;
}

function tone(type, f0, f1, dur, peak, t) {
    const osc = ac.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    osc.connect(envelope(peak, 0.002, dur, t));
    osc.start(t);
    osc.stop(t + dur + 0.05);
}

function noise(filterType, freq, dur, peak, t, attack = 0.001) {
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    const filter = ac.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    src.connect(filter).connect(envelope(peak, attack, dur, t));
    src.start(t, Math.random() * 0.5);
    src.stop(t + attack + dur + 0.05);
}

function metal(dur, peak, t, base = 40) {
    // 808-style metallic cymbal: stacked square waves through a high-pass
    const outNode = envelope(peak, 0.001, dur, t);
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    hp.connect(outNode);
    [2, 3, 4.16, 5.43, 6.79, 8.21].forEach((ratio) => {
        const osc = ac.createOscillator();
        osc.type = 'square';
        osc.frequency.value = base * ratio;
        osc.connect(hp);
        osc.start(t);
        osc.stop(t + dur + 0.05);
    });
}

function cowbell808(t, peak = 0.6, f = [540, 800]) {
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f[1];
    bp.Q.value = 3;
    bp.connect(envelope(peak, 0.001, 0.35, t));
    f.forEach((freq) => {
        const osc = ac.createOscillator();
        osc.type = 'square';
        osc.frequency.value = freq;
        osc.connect(bp);
        osc.start(t);
        osc.stop(t + 0.4);
    });
}

/* ---------- Synthesised instruments ---------- */

// Used by the sample kits for pieces we have no recording of
const ACOUSTIC_EXTRA = {
    crash:   (t) => { noise('highpass', 3500, 1.9, 0.38, t); metal(1.2, 0.1, t, 52); },
    splash:  (t) => { noise('highpass', 6000, 0.55, 0.35, t); metal(0.35, 0.1, t, 60); },
    cowbell: (t) => cowbell808(t, 0.5, [587, 845]),
    tom2:    (t) => tone('sine', 260, 170, 0.4, 0.9, t),
};

const SYNTH = {
    boom:    (t) => tone('sine', 70, 32, 1.2, 1, t),
    kick:    (t) => tone('sine', 160, 45, 0.45, 1, t),
    snare:   (t) => { noise('highpass', 1200, 0.2, 0.7, t); tone('triangle', 200, 120, 0.1, 0.5, t); },
    clap:    (t) => [0, 0.012, 0.024].forEach((d, i) => noise('bandpass', 1500, i === 2 ? 0.18 : 0.02, 0.8, t + d)),
    hihat:   (t) => metal(0.06, 0.35, t),
    openhat: (t) => metal(0.4, 0.3, t),
    ride:    (t) => { metal(0.9, 0.18, t); tone('sine', 3200, 3200, 0.6, 0.05, t); },
    tink:    (t) => tone('sine', 2400, 2300, 0.12, 0.4, t),
    tom:     (t) => tone('sine', 220, 110, 0.45, 0.9, t),
    crash:   (t) => { metal(1.4, 0.22, t, 46); noise('highpass', 8000, 1.2, 0.14, t); },
    splash:  (t) => metal(0.35, 0.26, t, 58),
    tom2:    (t) => tone('sine', 300, 150, 0.35, 0.9, t),
    cowbell: (t) => cowbell808(t),
};

function shaker(t, peak = 0.35) {
    noise('highpass', 5000, 0.08, peak, t, 0.025);
}

const PERC = {
    boom:    (t) => { tone('sine', 330, 290, 0.3, 0.9, t); noise('bandpass', 2000, 0.01, 0.3, t); },      // conga
    clap:    (t) => { tone('sine', 540, 480, 0.15, 0.8, t); noise('bandpass', 3000, 0.008, 0.2, t); },     // bongo
    hihat:   (t) => shaker(t),                                                                              // shaker
    kick:    (t) => cowbell808(t),                                                                          // cowbell
    openhat: (t) => { tone('triangle', 1250, 1150, 0.07, 0.7, t); tone('sine', 820, 800, 0.05, 0.4, t); }, // woodblock
    ride:    (t) => tone('triangle', 2500, 2450, 0.06, 0.6, t),                                             // clave
    snare:   (t) => [0, 0.03, 0.06].forEach((d, i) => { metal(i === 2 ? 0.3 : 0.05, 0.2, t + d); shaker(t + d, 0.15); }), // tambourine
    tink:    (t) => { tone('sine', 4500, 4500, 1.4, 0.15, t); tone('sine', 6750, 6750, 0.9, 0.06, t); },   // triangle
    tom:     (t) => { tone('triangle', 400, 370, 0.4, 0.7, t); noise('highpass', 3000, 0.12, 0.3, t); },   // timbale
    crash:   (t) => [[90, 3.5, 0.55], [147, 3, 0.22], [211, 2.4, 0.14], [283, 1.8, 0.08]]                  // gong
                 .forEach(([f, d, p]) => tone('sine', f * 1.02, f, d, p, t)),
    tom2:    (t) => { tone('sine', 190, 120, 0.35, 0.9, t); noise('bandpass', 1800, 0.04, 0.5, t); },      // djembe
    cowbell: (t) => { tone('triangle', 880, 870, 0.35, 0.5, t); tone('sine', 1760, 1760, 0.2, 0.15, t); }, // agogo
    splash:  (t) => [2093, 2349, 2637, 2960, 3136, 3520]                                                    // chimes
                 .forEach((f, i) => tone('sine', f, f, 1.2, 0.08, t + i * 0.045)),
};

/* ---------- Samples ---------- */

const fallbackAudio = {};
function playFallback(file, vel) {
    if (!fallbackAudio[file]) fallbackAudio[file] = new Audio(`Sounds/${file}.wav`);
    const a = fallbackAudio[file].cloneNode();
    a.volume = Math.min(1, Number(volumeEl.value) * vel);
    a.play().catch(() => {});
}

function playSample(name, t, kit, dest, vel) {
    const [file, rate] = SAMPLE_MAP[name];
    const buf = samples[file];
    if (buf) {
        const src = ac.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = rate * KITS[kit].rate;
        src.connect(dest);
        src.start(t);
        return;
    }
    // No decoded sample (yet): plain <audio>, timed with setTimeout
    const later = () => setTimeout(() => playFallback(file, vel), Math.max(0, t - ac.currentTime) * 1000);
    if (useFallback) later();
    else loadSamples().then(() => (samples[file] ? playSample(name, t, kit, dest, vel) : later()));
}

/* ---------- Play one hit ---------- */

function playSound(name, when, kit, vel = 1) {
    const t = when || ac.currentTime;
    const v = ac.createGain();
    v.gain.value = vel;
    v.connect(kitBus(kit));
    route = v;

    const k = KITS[kit];
    if (k.kind === 'synth') SYNTH[name](t);
    else if (k.kind === 'perc') PERC[name](t);
    else if (SAMPLE_MAP[name]) playSample(name, t, kit, v, vel);
    else ACOUSTIC_EXTRA[name](t);

    route = out;
}

/* ======================================================
   Playing live
   ====================================================== */

function hit(name, vel = 1) {
    getCtx();
    playSound(name, 0, kitEl.value, vel);
    DrumKit.animate(name, vel);
    if (recording) recordHit(name, vel);
}

const byCode = Object.fromEntries(PADS.map((p) => [p.code, p.name]));

window.addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t instanceof Element && t.matches('input, select, textarea')) return;

    if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
        return;
    }
    if (e.code === 'Enter' && !(t instanceof Element && t.matches('button'))) {
        e.preventDefault();
        toggleRecord();
        return;
    }
    const name = byCode[e.code];
    // Shift = soft "ghost note"
    if (name) hit(name, e.shiftKey ? 0.45 : 1);
});

/* ======================================================
   Controls
   ====================================================== */

volumeEl.addEventListener('input', () => {
    if (out) out.gain.setTargetAtTime(Number(volumeEl.value), ac.currentTime, 0.01);
    save('drum.volume', volumeEl.value);
});

kitEl.addEventListener('change', () => {
    save('drum.kit', kitEl.value);
    updateLabels();
    if (recTrack) {
        recTrack.kit = kitEl.value;
        renderTracks();
    }
    kitEl.blur();   // so the next key press goes to the drums
});

function setStatus(text) {
    statusEl.textContent = text;
}

function getBpm() {
    const v = Math.round(Number(bpmEl.value));
    return Math.min(240, Math.max(40, Number.isFinite(v) ? v : 100));
}

let spb = 60 / getBpm();   // seconds per beat

bpmEl.addEventListener('change', () => {
    bpmEl.value = getBpm();
    save('drum.bpm', bpmEl.value);
    const next = 60 / getBpm();
    if (transport.running) {
        // keep the current position in the loop when the tempo changes
        const beat = (ac.currentTime - transport.start) / spb;
        transport.start = ac.currentTime - beat * next;
    }
    spb = next;
});

barsEl.addEventListener('change', () => {
    save('drum.bars', barsEl.value);
    renderTracks();
    barsEl.blur();
});

quantizeEl.addEventListener('change', () => {
    save('drum.quantize', quantizeEl.value);
    quantizeEl.blur();
});

countInEl.addEventListener('change', () => save('drum.countin', countInEl.checked ? '1' : '0'));

const loopBeats = () => Number(barsEl.value) * 4;

/* ======================================================
   Transport: one scheduler for the metronome and all tracks
   ====================================================== */

let metroOn = false;
const transport = { running: false, start: 0, until: 0 };   // until = beats already scheduled
const freeMetro = { next: 0, count: 0 };                     // metronome when nothing is playing
let schedTimer = null;
const flashTimers = new Set();

function click(t, accent) {
    route = out;
    tone('square', accent ? 1500 : 1000, accent ? 1500 : 1000, 0.03, accent ? 0.35 : 0.2, t);
}

const atBeat = (b) => transport.start + b * spb;

function audibleTracks() {
    const solo = tracks.some((tr) => tr.solo);
    return tracks.filter((tr) => (solo ? tr.solo : !tr.muted));
}

function scheduleRange(from, to) {
    // clicks: the count-in (negative beats) always, the metronome if it's on
    for (let b = Math.ceil(from); b < to; b++) {
        if (b < 0) click(atBeat(b), b === -4);
        else if (metroOn) click(atBeat(b), b % 4 === 0);
    }
    if (to <= 0) return;

    const L = loopBeats();
    const f = Math.max(0, from);
    const playing = audibleTracks();
    for (let iter = Math.floor(f / L); iter * L < to; iter++) {
        const base = iter * L;
        playing.forEach((tr) => tr.events.forEach((e) => {
            const abs = base + e.t;
            if (abs < f || abs >= to || e.skip === iter || e.t >= L) return;
            const when = atBeat(abs);
            playSound(e.name, when, tr.kit, e.vel * tr.volume);
            const id = setTimeout(() => {
                flashTimers.delete(id);
                DrumKit.animate(e.name, e.vel);
            }, Math.max(0, when - ac.currentTime) * 1000);
            flashTimers.add(id);
        }));
    }
}

function tick() {
    if (transport.running) {
        const horizon = (ac.currentTime + LOOKAHEAD - transport.start) / spb;
        if (horizon > transport.until) {
            scheduleRange(transport.until, horizon);
            transport.until = horizon;
        }
    } else if (metroOn) {
        while (freeMetro.next < ac.currentTime + LOOKAHEAD) {
            click(freeMetro.next, freeMetro.count % 4 === 0);
            freeMetro.next += spb;
            freeMetro.count++;
        }
    }
}

function ensureScheduler() {
    const needed = transport.running || metroOn;
    if (needed && !schedTimer) schedTimer = setInterval(tick, 25);
    if (!needed && schedTimer) {
        clearInterval(schedTimer);
        schedTimer = null;
    }
}

function startTransport(withCountIn) {
    getCtx();
    tracks.forEach((tr) => tr.events.forEach((e) => delete e.skip));
    const ci = withCountIn ? 4 : 0;
    transport.start = ac.currentTime + 0.08 + ci * spb;
    transport.until = -ci;
    transport.running = true;
    ensureScheduler();
    tick();
    requestAnimationFrame(drawPosition);
    updateUI();
}

function stopTransport() {
    if (recording) stopRecording();
    transport.running = false;
    flashTimers.forEach(clearTimeout);
    flashTimers.clear();
    ensureScheduler();
    beatDots.forEach((d) => d.classList.remove('on', 'accent'));
    barPosEl.textContent = '';
    document.querySelectorAll('.playhead').forEach((p) => (p.style.left = '0%'));
    setStatus('');
    updateUI();
}

function togglePlay() {
    if (transport.running) stopTransport();
    else if (tracks.length) startTransport(false);
    playBtn.blur();
}

metroBtn.addEventListener('click', () => {
    metroOn = !metroOn;
    metroBtn.setAttribute('aria-pressed', String(metroOn));
    if (metroOn && !transport.running) {
        getCtx();
        freeMetro.next = ac.currentTime + 0.05;
        freeMetro.count = 0;
    }
    ensureScheduler();
    metroBtn.blur();
});

playBtn.addEventListener('click', togglePlay);

/* ---------- Beat lights, bar counter and playheads ---------- */

function drawPosition() {
    if (!transport.running) return;
    const b = (ac.currentTime - transport.start) / spb;

    if (b < 0) {
        const n = Math.ceil(-b);
        setStatus(`Count-in… ${n}`);
        beatDots.forEach((d, i) => d.classList.toggle('on', i === 4 - n));
    } else {
        const L = loopBeats();
        const pos = b % L;
        const beatInBar = Math.floor(pos) % 4;
        beatDots.forEach((d, i) => {
            d.classList.toggle('on', i === beatInBar);
            d.classList.toggle('accent', i === 0 && beatInBar === 0);
        });
        barPosEl.textContent = `${Math.floor(pos / 4) + 1}/${L / 4}`;
        const pct = `${(pos / L) * 100}%`;
        document.querySelectorAll('.playhead').forEach((p) => (p.style.left = pct));
        if (recording) setStatus(`● Recording ${recTrack.name}… press ● again to keep it`);
        else setStatus('');
    }
    requestAnimationFrame(drawPosition);
}

/* ======================================================
   Multi-track recording (a looper: every track loops together)
   ====================================================== */

let tracks = [];
let recording = false;
let recTrack = null;
let nextTrackNo = 1;

function loadTracks() {
    try {
        const saved = JSON.parse(load('drum.tracks', '[]'));
        if (Array.isArray(saved)) {
            tracks = saved.filter((tr) => tr && Array.isArray(tr.events) && KITS[tr.kit]);
            nextTrackNo = tracks.reduce((n, tr) => Math.max(n, tr.no || 0), 0) + 1;
        }
    } catch {
        tracks = [];
    }
}

function saveTracks() {
    const clean = tracks.map((tr) => ({ ...tr, events: tr.events.map(({ t, name, vel }) => ({ t, name, vel })) }));
    save('drum.tracks', JSON.stringify(clean));
}

function newTrack() {
    const used = new Set(tracks.map((tr) => tr.color));
    const color = TRACK_COLORS.find((c) => !used.has(c)) || TRACK_COLORS[tracks.length % TRACK_COLORS.length];
    const no = nextTrackNo++;
    return { no, name: `Track ${no}`, kit: kitEl.value, color, events: [], muted: false, solo: false, volume: 1 };
}

function startRecording() {
    if (tracks.length >= MAX_TRACKS) {
        setStatus(`You can have up to ${MAX_TRACKS} tracks. Delete one to record another.`);
        return;
    }
    getCtx();
    recTrack = newTrack();
    tracks.push(recTrack);
    recording = true;
    // On big screens show the tracks; on phones keep the drums big while you play
    if (window.matchMedia('(min-width: 751px) and (min-height: 501px)').matches) openTracks(true);
    if (!transport.running) startTransport(countInEl.checked);
    renderTracks();
    updateUI();
}

function stopRecording() {
    recording = false;
    if (recTrack && recTrack.events.length === 0) {
        tracks = tracks.filter((tr) => tr !== recTrack);
        setStatus('Nothing was recorded.');
    }
    recTrack = null;
    saveTracks();
    renderTracks();
    updateUI();
}

function toggleRecord() {
    if (recording) stopRecording();
    else startRecording();
    recBtn.blur();
}

recBtn.addEventListener('click', toggleRecord);

function recordHit(name, vel) {
    let b = (ac.currentTime - transport.start) / spb;
    if (b < 0) {
        if (b < -0.25) return;   // too early in the count-in
        b = 0;                   // just before the "one": count it as on the beat
    }
    const L = loopBeats();
    let iter = Math.floor(b / L);
    let t = b - iter * L;

    const q = Number(quantizeEl.value);   // steps per beat (0 = off)
    if (q) {
        t = Math.round(t * q) / q;
        if (t >= L) {
            t -= L;
            iter += 1;
        }
    }
    // skip: you already heard this hit live, so don't replay it in this pass
    recTrack.events.push({ t, name, vel, skip: iter });
    renderTrackTimeline(recTrack);
}

/* ---------- Tracks panel ---------- */

function openTracks(open) {
    tracksPanel.hidden = !open;
    tracksBtn.setAttribute('aria-expanded', String(open));
}

tracksBtn.addEventListener('click', () => {
    openTracks(tracksPanel.hidden);
    tracksBtn.blur();
});

const ROW_OF = Object.fromEntries(PADS.map((p, i) => [p.name, i]));

function timelineHTML(tr) {
    const L = loopBeats();
    const bars = L / 4;
    let html = '';
    for (let i = 1; i < bars; i++) html += `<span class="barline" style="left:${(i / bars) * 100}%"></span>`;
    tr.events.forEach((e) => {
        if (e.t >= L) return;
        const top = 8 + (ROW_OF[e.name] / (PADS.length - 1)) * 76;
        html += `<span class="note" style="left:${(e.t / L) * 100}%;top:${top}%;opacity:${0.35 + e.vel * 0.65}"></span>`;
    });
    return html + '<span class="playhead"></span>';
}

function renderTrackTimeline(tr) {
    const row = trackListEl.querySelector(`[data-no="${tr.no}"] .timeline`);
    if (row) row.innerHTML = timelineHTML(tr);
}

function escapeHTML(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderTracks() {
    trackCountEl.textContent = tracks.length;
    if (!tracks.length) {
        trackListEl.innerHTML = `<p class="empty">Press <b>● Rec</b> to record your first loop.
            Then record more tracks on top: they all play together, and each one keeps its own kit.</p>`;
        return;
    }
    const kitOptions = (sel) => Object.entries(KITS)
        .map(([id, k]) => `<option value="${id}"${id === sel ? ' selected' : ''}>${k.title}</option>`).join('');

    trackListEl.innerHTML = tracks.map((tr) => `
        <div class="track${tr === recTrack ? ' recording' : ''}${tr.muted ? ' muted' : ''}" data-no="${tr.no}" style="--c:${tr.color}">
            <div class="track-info">
                <span class="track-name">${escapeHTML(tr.name)}</span>
                <select class="track-kit" aria-label="Kit for ${escapeHTML(tr.name)}">${kitOptions(tr.kit)}</select>
            </div>
            <div class="timeline">${timelineHTML(tr)}</div>
            <div class="track-actions">
                <button type="button" class="chip" data-act="mute" aria-pressed="${tr.muted}" title="Mute">M</button>
                <button type="button" class="chip" data-act="solo" aria-pressed="${tr.solo}" title="Solo">S</button>
                <input type="range" class="track-vol" min="0" max="1.5" step="0.05" value="${tr.volume}" aria-label="Volume">
                <button type="button" class="chip del" data-act="delete" title="Delete track" aria-label="Delete ${escapeHTML(tr.name)}">✕</button>
            </div>
        </div>`).join('');
}

function trackFrom(el) {
    const row = el.closest('.track');
    return row && tracks.find((tr) => tr.no === Number(row.dataset.no));
}

trackListEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const tr = trackFrom(btn);
    if (!tr) return;
    const act = btn.dataset.act;
    if (act === 'mute') tr.muted = !tr.muted;
    if (act === 'solo') tr.solo = !tr.solo;
    if (act === 'delete') {
        if (tr === recTrack) stopRecording();
        tracks = tracks.filter((x) => x !== tr);
        if (!tracks.length && transport.running) stopTransport();
    }
    saveTracks();
    renderTracks();
    updateUI();
});

trackListEl.addEventListener('change', (e) => {
    const tr = trackFrom(e.target);
    if (!tr) return;
    if (e.target.matches('.track-kit')) tr.kit = e.target.value;
    saveTracks();
    e.target.blur();
});

trackListEl.addEventListener('input', (e) => {
    const tr = trackFrom(e.target);
    if (tr && e.target.matches('.track-vol')) tr.volume = Number(e.target.value);
});

trackListEl.addEventListener('change', (e) => {
    if (e.target.matches('.track-vol')) saveTracks();
});

clearBtn.addEventListener('click', () => {
    if (!tracks.length) return;
    if (!window.confirm('Delete all tracks?')) return;
    if (transport.running) stopTransport();
    tracks = [];
    nextTrackNo = 1;
    saveTracks();
    renderTracks();
    updateUI();
});

/* ---------- Export as WAV ---------- */

async function exportWav() {
    if (!tracks.length) return;
    getCtx();
    await loadSamples();
    const usesSamples = tracks.some((tr) => KITS[tr.kit].kind === 'sample');
    if (useFallback && usesSamples) {
        setStatus('Export needs the site to be opened over http(s), not as a local file.');
        return;
    }
    setStatus('Rendering your beat…');

    const L = loopBeats();
    const loops = 2;
    const seconds = L * spb * loops + 2.5;   // two loops + room for cymbals to ring out
    const rate = ac.sampleRate;
    const offline = new OfflineAudioContext(2, Math.ceil(seconds * rate), rate);

    // Point the engine at the offline context, schedule everything, then switch back
    const saved = { ac, out, noiseBuf, buses, route };
    ac = offline;
    out = offline.createGain();
    out.gain.value = Number(volumeEl.value);
    out.connect(offline.destination);
    noiseBuf = makeNoise();
    buses = {};
    route = out;
    try {
        const playing = audibleTracks();
        for (let iter = 0; iter < loops; iter++) {
            playing.forEach((tr) => tr.events.forEach((e) => {
                if (e.t < L) playSound(e.name, 0.05 + (iter * L + e.t) * spb, tr.kit, e.vel * tr.volume);
            }));
        }
    } finally {
        ({ ac, out, noiseBuf, buses, route } = saved);
    }

    const rendered = await offline.startRendering();
    const url = URL.createObjectURL(toWav(rendered));
    const a = document.createElement('a');
    a.href = url;
    a.download = `drum-beat-${getBpm()}bpm.wav`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    setStatus('Saved your beat as a WAV file.');
}

function toWav(buffer) {
    const chs = buffer.numberOfChannels;
    const len = buffer.length;
    const data = new DataView(new ArrayBuffer(44 + len * chs * 2));
    const str = (o, s) => [...s].forEach((c, i) => data.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF'); data.setUint32(4, 36 + len * chs * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, chs, true);
    data.setUint32(24, buffer.sampleRate, true); data.setUint32(28, buffer.sampleRate * chs * 2, true);
    data.setUint16(32, chs * 2, true); data.setUint16(34, 16, true);
    str(36, 'data'); data.setUint32(40, len * chs * 2, true);
    const channels = [...Array(chs)].map((_, c) => buffer.getChannelData(c));
    let o = 44;
    for (let i = 0; i < len; i++) {
        for (let c = 0; c < chs; c++) {
            const s = Math.max(-1, Math.min(1, channels[c][i]));
            data.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
            o += 2;
        }
    }
    return new Blob([data], { type: 'audio/wav' });
}

exportBtn.addEventListener('click', () => {
    exportWav().catch(() => setStatus('Sorry, the export failed in this browser.'));
    exportBtn.blur();
});

/* ---------- Buttons state ---------- */

function updateUI() {
    recBtn.setAttribute('aria-pressed', String(recording));
    recBtn.textContent = recording ? '■ Keep' : '● Rec';
    playBtn.setAttribute('aria-pressed', String(transport.running));
    playBtn.textContent = transport.running ? '■ Stop' : '▶ Play';
    playBtn.disabled = !transport.running && tracks.length === 0;
    exportBtn.disabled = tracks.length === 0;
    clearBtn.disabled = tracks.length === 0;
    trackCountEl.textContent = tracks.length;
    document.querySelectorAll('.track').forEach((row) => {
        row.classList.toggle('recording', recTrack && Number(row.dataset.no) === recTrack.no);
    });
}

loadTracks();
renderTracks();
updateUI();

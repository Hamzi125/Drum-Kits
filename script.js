'use strict';

/* ======================================================
   Pads
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
];

// The percussion kit reuses the same pads but with different instruments
const PERC_LABELS = {
    boom: 'conga',
    clap: 'bongo',
    hihat: 'shaker',
    kick: 'cowbell',
    openhat: 'woodblock',
    ride: 'clave',
    snare: 'tambourine',
    tink: 'triangle',
    tom: 'timbale',
};

const $ = (sel) => document.querySelector(sel);
const keysEl = $('#keys');
const kitEl = $('#kit');
const volumeEl = $('#volume');
const bpmEl = $('#bpm');
const metroBtn = $('#metro-toggle');
const recBtn = $('#rec');
const playBtn = $('#play');
const clearBtn = $('#clear');
const statusEl = $('#status');
const loopEl = $('#loop');

const padEls = {};

PADS.forEach((pad) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'key';
    btn.dataset.name = pad.name;
    btn.innerHTML = `<kbd>${pad.label}</kbd><span class="sound"></span>`;
    // pointerdown instead of click: plays instantly on touch and mouse
    btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        hit(pad.name);
    });
    keysEl.appendChild(btn);
    padEls[pad.name] = btn;
});

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

kitEl.value = load('drum.kit', 'acoustic');
if (!kitEl.value) kitEl.value = 'acoustic';   // saved kit no longer exists
updateLabels();

function updateLabels() {
    PADS.forEach((pad) => {
        const label = kitEl.value === 'percussion' ? PERC_LABELS[pad.name] : pad.name;
        const btn = padEls[pad.name];
        btn.querySelector('.sound').textContent = label;
        btn.setAttribute('aria-label', `${label} (key ${pad.label})`);
    });
}
volumeEl.value = load('drum.volume', '0.8');
bpmEl.value = load('drum.bpm', '100');

/* ======================================================
   Audio engine (Web Audio API)
   ====================================================== */

let ctx = null;
let master = null;
let noiseBuffer = null;
const samples = {};          // decoded acoustic samples
let samplesLoading = null;
let useFallback = false;     // true when samples can't be fetched (e.g. opened via file://)
let route = null;            // where new sounds are connected (master, or the playback bus)
let playbackBus = null;      // disconnected on "Stop" to silence already-scheduled sounds

function getCtx() {
    if (!ctx) {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createGain();
        master.gain.value = Number(volumeEl.value);
        master.connect(ctx.destination);
        route = master;
        noiseBuffer = makeNoise();
        loadSamples();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
}

function loadSamples() {
    if (samplesLoading) return samplesLoading;
    samplesLoading = Promise.all(PADS.map(async ({ name }) => {
        const res = await fetch(`Sounds/${name}.wav`);
        if (!res.ok) throw new Error(res.statusText);
        samples[name] = await ctx.decodeAudioData(await res.arrayBuffer());
    })).catch(() => {
        useFallback = true;
    });
    return samplesLoading;
}

// Fallback for file:// where fetch() is blocked: plain <audio> elements
const fallbackAudio = {};
function playFallback(name) {
    if (!fallbackAudio[name]) fallbackAudio[name] = new Audio(`Sounds/${name}.wav`);
    const a = fallbackAudio[name].cloneNode();
    a.volume = Number(volumeEl.value);
    a.play().catch(() => {});
}

function playSample(name, when) {
    const buf = samples[name];
    if (buf) {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(route);
        src.start(when);
        return;
    }
    // No decoded sample (yet): fall back to <audio>, timed with setTimeout
    const delay = Math.max(0, when - ctx.currentTime) * 1000;
    const later = () => {
        const id = setTimeout(() => playFallback(name), delay);
        if (route === playbackBus) playTimers.push(id);
    };
    if (useFallback) later();
    else loadSamples().then(() => (samples[name] ? playSample(name, when) : later()));
}

/* ---------- Electronic kit (synthesised, no files needed) ---------- */

function makeNoise() {
    const len = ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
}

function envelope(peak, attack, decay, t) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(route);
    return g;
}

function tone(type, f0, f1, dur, peak, t) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    osc.connect(envelope(peak, 0.002, dur, t));
    osc.start(t);
    osc.stop(t + dur + 0.05);
}

function noise(filterType, freq, dur, peak, t) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    src.connect(filter).connect(envelope(peak, 0.001, dur, t));
    src.start(t);
    src.stop(t + dur + 0.05);
}

function metal(dur, peak, t) {
    // Classic 808-style metallic cymbal: stacked square waves through a high-pass
    const out = envelope(peak, 0.001, dur, t);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    hp.connect(out);
    [2, 3, 4.16, 5.43, 6.79, 8.21].forEach((ratio) => {
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = 40 * ratio;
        osc.connect(hp);
        osc.start(t);
        osc.stop(t + dur + 0.05);
    });
}

const SYNTH = {
    boom:    (t) => tone('sine', 70, 32, 1.2, 1, t),
    kick:    (t) => tone('sine', 160, 45, 0.45, 1, t),
    snare:   (t) => { noise('highpass', 1200, 0.2, 0.7, t); tone('triangle', 200, 120, 0.1, 0.5, t); },
    clap:    (t) => [0, 0.012, 0.024].forEach((d, i) =>
                 noise('bandpass', 1500, i === 2 ? 0.18 : 0.02, 0.8, t + d)),
    hihat:   (t) => metal(0.06, 0.35, t),
    openhat: (t) => metal(0.4, 0.3, t),
    ride:    (t) => { metal(0.9, 0.18, t); tone('sine', 3200, 3200, 0.6, 0.05, t); },
    tink:    (t) => tone('sine', 2400, 2300, 0.12, 0.4, t),
    tom:     (t) => tone('sine', 220, 110, 0.45, 0.9, t),
};

/* ---------- Percussion kit (synthesised) ---------- */

function cowbell(t) {
    // Two detuned square waves through a band-pass: the classic cowbell recipe
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 800;
    bp.Q.value = 3;
    bp.connect(envelope(0.6, 0.001, 0.35, t));
    [540, 800].forEach((f) => {
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = f;
        osc.connect(bp);
        osc.start(t);
        osc.stop(t + 0.4);
    });
}

function shaker(t, peak = 0.35) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 5000;
    src.connect(hp).connect(envelope(peak, 0.025, 0.08, t));
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.15);
}

const PERC = {
    boom:    (t) => { tone('sine', 330, 290, 0.3, 0.9, t); noise('bandpass', 2000, 0.01, 0.3, t); },  // conga
    clap:    (t) => { tone('sine', 540, 480, 0.15, 0.8, t); noise('bandpass', 3000, 0.008, 0.2, t); }, // bongo
    hihat:   (t) => shaker(t),                                                                         // shaker
    kick:    (t) => cowbell(t),                                                                        // cowbell
    openhat: (t) => { tone('triangle', 1250, 1150, 0.07, 0.7, t); tone('sine', 820, 800, 0.05, 0.4, t); }, // woodblock
    ride:    (t) => tone('triangle', 2500, 2450, 0.06, 0.6, t),                                        // clave
    snare:   (t) => [0, 0.03, 0.06].forEach((d, i) =>                                                  // tambourine
                 { metal(i === 2 ? 0.3 : 0.05, 0.2, t + d); shaker(t + d, 0.15); }),
    tink:    (t) => { tone('sine', 4500, 4500, 1.4, 0.15, t); tone('sine', 6750, 6750, 0.9, 0.06, t); }, // triangle
    tom:     (t) => { tone('triangle', 400, 370, 0.4, 0.7, t); noise('highpass', 3000, 0.12, 0.3, t); },  // timbale
};

function playSound(name, when = 0, dest = null) {
    getCtx();
    const t = when || ctx.currentTime;
    route = dest || master;
    if (kitEl.value === 'electronic') SYNTH[name](t);
    else if (kitEl.value === 'percussion') PERC[name](t);
    else playSample(name, t);
    route = master;
}

/* ======================================================
   Hitting pads
   ====================================================== */

function flash(name) {
    const el = padEls[name];
    el.classList.remove('playing');
    void el.offsetWidth;            // restart the animation if hit quickly again
    el.classList.add('playing');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('playing'), 100);
}

function hit(name) {
    playSound(name);
    flash(name);
    if (recording) recordEvent(name);
}

const byCode = Object.fromEntries(PADS.map((p) => [p.code, p.name]));

window.addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof Element && e.target.matches('input, select, textarea')) return;
    const name = byCode[e.code];
    if (name) hit(name);
});

/* ======================================================
   Controls
   ====================================================== */

volumeEl.addEventListener('input', () => {
    if (master) master.gain.setTargetAtTime(Number(volumeEl.value), ctx.currentTime, 0.01);
    save('drum.volume', volumeEl.value);
});

kitEl.addEventListener('change', () => {
    save('drum.kit', kitEl.value);
    updateLabels();
    kitEl.blur();   // so the next key press goes to the pads
});

function setStatus(text) {
    statusEl.textContent = text;
}

/* ---------- Metronome (look-ahead scheduler for tight timing) ---------- */

let metroOn = false;
let metroTimer = null;
let nextBeat = 0;
let beatCount = 0;

function getBpm() {
    const v = Math.round(Number(bpmEl.value));
    return Math.min(240, Math.max(40, Number.isFinite(v) ? v : 100));
}

function click(t, accent) {
    tone('square', accent ? 1500 : 1000, accent ? 1500 : 1000, 0.03, accent ? 0.35 : 0.2, t);
}

function scheduler() {
    while (nextBeat < ctx.currentTime + 0.1) {
        click(nextBeat, beatCount % 4 === 0);
        nextBeat += 60 / getBpm();
        beatCount++;
    }
}

function setMetronome(on) {
    metroOn = on;
    metroBtn.setAttribute('aria-pressed', String(on));
    if (on) {
        getCtx();
        nextBeat = ctx.currentTime + 0.05;
        beatCount = 0;
        scheduler();
        metroTimer = setInterval(scheduler, 25);
    } else {
        clearInterval(metroTimer);
    }
}

metroBtn.addEventListener('click', () => setMetronome(!metroOn));

bpmEl.addEventListener('change', () => {
    bpmEl.value = getBpm();
    save('drum.bpm', bpmEl.value);
});

/* ---------- Record & playback ---------- */

let recording = false;
let recStart = 0;
let recLength = 0;       // seconds from Record to Stop
let track = [];          // [{ time: seconds, name }]
let playing = false;
let playTimers = [];
let playEndTimer = null;

function recordEvent(name) {
    track.push({ time: (performance.now() - recStart) / 1000, name });
}

function updateButtons() {
    recBtn.setAttribute('aria-pressed', String(recording));
    recBtn.textContent = recording ? '■ Stop' : '● Record';
    playBtn.textContent = playing ? '■ Stop' : '▶ Play';
    playBtn.disabled = recording || track.length === 0;
    clearBtn.disabled = recording || playing || track.length === 0;
}

function stopPlayback() {
    playTimers.forEach(clearTimeout);
    playTimers = [];
    clearTimeout(playEndTimer);
    if (playbackBus) playbackBus.disconnect();
    playbackBus = null;
    playing = false;
}

recBtn.addEventListener('click', () => {
    if (recording) {
        recording = false;
        recLength = (performance.now() - recStart) / 1000;
        setStatus(track.length ? `Recorded ${track.length} hits. Press Play to hear it.` : 'Nothing recorded.');
    } else {
        stopPlayback();
        getCtx();
        track = [];
        recording = true;
        recStart = performance.now();
        setStatus('Recording… play some pads.');
    }
    recBtn.blur();
    updateButtons();
});

// Schedules one pass of the recording starting at audio time `start`.
// With Loop on, the next pass is queued just before this one ends.
function playPass(start) {
    const offset = track[0].time;   // skip the silence before the first hit
    playTimers = [];
    track.forEach(({ time, name }) => {
        const t = start + time - offset;
        playSound(name, t, playbackBus);
        playTimers.push(setTimeout(() => flash(name), (t - ctx.currentTime) * 1000));
    });

    // Loop length runs from the first hit to the moment you pressed Stop,
    // so the pause at the end of your beat is kept.
    const loopLen = Math.max(0.25, recLength - offset);
    const end = start + loopLen;
    setStatus(loopEl.checked ? 'Looping… press Stop to end.' : 'Playing back…');

    playEndTimer = setTimeout(() => {
        if (!playing) return;
        if (loopEl.checked) {
            playPass(end);
        } else {
            playEndTimer = setTimeout(() => {
                playing = false;
                setStatus('');
                updateButtons();
            }, 600);
        }
    }, Math.max(0, (end - ctx.currentTime - 0.1) * 1000));
}

playBtn.addEventListener('click', () => {
    if (playing) {
        stopPlayback();
        setStatus('');
    } else if (track.length) {
        getCtx();
        playing = true;
        playbackBus = ctx.createGain();
        playbackBus.connect(master);
        playPass(ctx.currentTime + 0.05);
    }
    playBtn.blur();
    updateButtons();
});

clearBtn.addEventListener('click', () => {
    track = [];
    setStatus('Recording cleared.');
    updateButtons();
});

updateButtons();

'use strict';

/* ======================================================
   Drum kit visual: an SVG kit drawn in code that reacts to hits.
   script.js uses: DrumKit.build(), DrumKit.setLabel(), DrumKit.animate()
   ====================================================== */

const DrumKit = (() => {
    const NS = 'http://www.w3.org/2000/svg';
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Each piece: type, size, and a position for wide and tall screens.
    // Tall (phone) positions are [x, y, scale], laid out in tidy rows:
    // cymbals / hi-hat + toms / pads either side of the kick / snare + floor tom
    const PIECES = {
        crash:   { type: 'cymbal', r: 98,  wide: [170, 162],  tall: [95, 95, 0.87] },
        splash:  { type: 'cymbal', r: 58,  wide: [720, 150],  tall: [280, 70, 0.9] },
        ride:    { type: 'cymbal', r: 108, wide: [930, 292],  tall: [465, 100, 0.83] },
        hihat:   { type: 'cymbal', r: 88,  wide: [112, 392],  tall: [85, 292, 0.85], hats: true },
        openhat: { type: 'cymbal', r: 0 },  // drawn by the hi-hat (outer ring)
        cowbell: { type: 'bell',   r: 44,  wide: [838, 112],  tall: [280, 186, 0.9] },
        tom2:    { type: 'drum',   r: 62,  wide: [382, 232],  tall: [292, 304, 0.9], lugs: 6 },
        tom:     { type: 'drum',   r: 68,  wide: [542, 196],  tall: [432, 300, 0.88], lugs: 6 },
        clap:    { type: 'pad',    r: 54,  wide: [102, 572],  tall: [70, 492, 0.89] },
        tink:    { type: 'pad',    r: 54,  wide: [1000, 560], tall: [495, 492, 0.89] },
        kick:    { type: 'kick',   r: 130, wide: [552, 442],  tall: [282, 505, 0.96], lugs: 10 },
        snare:   { type: 'drum',   r: 80,  wide: [292, 502],  tall: [135, 720, 1.06], lugs: 8, snare: true },
        boom:    { type: 'drum',   r: 96,  wide: [802, 490],  tall: [430, 715, 1], lugs: 8 },
    };

    // back-to-front draw order
    const ORDER = ['crash', 'splash', 'ride', 'cowbell', 'hihat', 'tom2', 'tom', 'clap', 'tink', 'kick', 'boom', 'snare'];

    const VIEW = { wide: '10 50 1070 580', tall: '0 0 565 825' };

    let svg, kitGroup, ambientEl;
    let layout = null;
    let openLetter = '';
    const parts = {};   // name -> { root, body, glow, ripples, nameText, edgeText, piece }

    /* ---------- tiny SVG helpers ---------- */

    function el(tag, attrs = {}, parent) {
        const n = document.createElementNS(NS, tag);
        for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
        if (parent) parent.appendChild(n);
        return n;
    }

    function stops(grad, list) {
        list.forEach(([offset, color, opacity = 1]) =>
            el('stop', { offset, style: `stop-color:${color};stop-opacity:${opacity}` }, grad));
        return grad;
    }

    function defs() {
        const d = el('defs', {}, svg);

        stops(el('linearGradient', { id: 'g-shell', x1: 0, y1: 0, x2: 1, y2: 1 }, d), [
            ['0', 'var(--shell-a)'], ['0.55', 'var(--shell-b)'], ['1', 'var(--shell-c)'],
        ]);
        stops(el('linearGradient', { id: 'g-chrome', x1: 0, y1: 0, x2: 1, y2: 1 }, d), [
            ['0', '#ffffff'], ['0.25', '#9aa3ad'], ['0.5', '#f4f7fa'], ['0.75', '#6b737c'], ['1', '#d8dde2'],
        ]);
        stops(el('radialGradient', { id: 'g-head', cx: '0.42', cy: '0.38', r: '0.75' }, d), [
            ['0', 'var(--head-a)'], ['0.7', 'var(--head-b)'], ['1', 'var(--head-c)'],
        ]);
        stops(el('radialGradient', { id: 'g-cym', cx: '0.5', cy: '0.5', r: '0.5' }, d), [
            ['0', 'var(--cym-a)'], ['0.35', 'var(--cym-b)'], ['0.8', 'var(--cym-c)'], ['1', 'var(--cym-d)'],
        ]);
        stops(el('radialGradient', { id: 'g-bell', cx: '0.4', cy: '0.35', r: '0.7' }, d), [
            ['0', '#fff8e0'], ['0.5', 'var(--cym-a)'], ['1', 'var(--cym-c)'],
        ]);
        stops(el('linearGradient', { id: 'g-steel', x1: 0, y1: 0, x2: 1, y2: 0 }, d), [
            ['0', '#4a4f57'], ['0.3', '#c9ced6'], ['0.55', '#f5f7fa'], ['0.8', '#8a9099'], ['1', '#3b3f46'],
        ]);
        stops(el('radialGradient', { id: 'g-glow' }, d), [
            ['0', 'var(--accent)', 0.85], ['0.45', 'var(--accent)', 0.35], ['1', 'var(--accent)', 0],
        ]);
        stops(el('radialGradient', { id: 'g-shadow' }, d), [
            ['0', '#000', 0.7], ['0.6', '#000', 0.35], ['1', '#000', 0],
        ]);
        stops(el('linearGradient', { id: 'g-pad', x1: 0, y1: 0, x2: 0, y2: 1 }, d), [
            ['0', '#3a3f4a'], ['1', '#111318'],
        ]);
        // soft gloss on drum heads and a thin rim light, both lit from the top-left
        stops(el('radialGradient', { id: 'g-gloss', cx: '0.5', cy: '0.5', r: '0.5' }, d), [
            ['0', '#fff', 0.45], ['0.6', '#fff', 0.12], ['1', '#fff', 0],
        ]);
        stops(el('linearGradient', { id: 'g-rim', x1: 0, y1: 0, x2: 1, y2: 1 }, d), [
            ['0', '#fff', 0.75], ['0.35', '#fff', 0.15], ['0.6', '#fff', 0], ['1', '#fff', 0],
        ]);
        stops(el('radialGradient', { id: 'g-rug', cx: '0.5', cy: '0.5', r: '0.5' }, d), [
            ['0', 'var(--rug)', 0.9], ['0.7', 'var(--rug)', 0.5], ['1', 'var(--rug)', 0],
        ]);
    }

    /* ---------- piece builders (all drawn around 0,0) ---------- */

    // Decoration that must NOT catch clicks (class "deco" has pointer-events: none)
    function shadowAndGlow(g, r, square) {
        el('ellipse', {
            class: 'deco', cx: r * 0.06, cy: r * 0.16,
            rx: r * (square ? 1.25 : 1.12), ry: r * (square ? 1.2 : 1.05), fill: 'url(#g-shadow)',
        }, g);
        return el('circle', { r: r * 1.6, fill: 'url(#g-glow)', class: 'glow deco', opacity: 0 }, g);
    }

    function lugs(g, r, n) {
        for (let i = 0; i < n; i++) {
            const a = (360 / n) * i + 360 / n / 2;
            el('rect', {
                x: -r * 0.07, y: -r - r * 0.05, width: r * 0.14, height: r * 0.16, rx: r * 0.04,
                fill: 'url(#g-chrome)', transform: `rotate(${a})`,
            }, g);
        }
    }

    function gloss(g, r) {
        // a soft highlight where the overhead light catches the head
        el('ellipse', {
            cx: -r * 0.28, cy: -r * 0.4, rx: r * 0.5, ry: r * 0.2,
            fill: 'url(#g-gloss)', transform: 'rotate(-28)', class: 'gloss',
        }, g);
    }

    function labels(g, r, letter, onHead, y = 0) {
        const cls = onHead ? 'lbl on-head' : 'lbl';
        const label = el('text', { class: `${cls} letter`, y: y + r * 0.06, 'font-size': Math.max(28, r * 0.38) }, g);
        label.textContent = letter;
        return el('text', { class: `${cls} name`, y: y + r * 0.34, 'font-size': Math.max(15, r * 0.15) }, g);
    }

    function drum(g, p, letter) {
        const { r } = p;
        lugs(g, r, p.lugs);
        el('circle', { r, fill: 'url(#g-shell)' }, g);
        el('circle', { r: r * 0.985, fill: 'none', stroke: 'url(#g-rim)', 'stroke-width': 2 }, g);
        el('circle', { r: r * 0.9, fill: 'none', stroke: 'url(#g-chrome)', 'stroke-width': r * 0.07 }, g);
        el('circle', { r: r * 0.86, fill: 'url(#g-head)', class: 'head' }, g);
        el('circle', { r: r * 0.7, fill: 'none', stroke: 'var(--head-line)', 'stroke-width': 1 }, g);
        gloss(g, r * 0.86);
        if (p.snare) {
            // snare wires seen through the head
            for (let i = -3; i <= 3; i++) {
                el('line', { x1: -r * 0.55, x2: r * 0.55, y1: i * r * 0.07, y2: i * r * 0.07, stroke: 'var(--head-line)', 'stroke-width': 1 }, g);
            }
        }
        return labels(g, r, letter, true);
    }

    function kick(g, p, letter) {
        const { r } = p;
        lugs(g, r, p.lugs);
        el('circle', { r, fill: 'url(#g-shell)' }, g);
        el('circle', { r: r * 0.99, fill: 'none', stroke: 'url(#g-rim)', 'stroke-width': 2 }, g);
        el('circle', { r: r * 0.92, fill: 'none', stroke: 'url(#g-chrome)', 'stroke-width': r * 0.05 }, g);
        el('circle', { r: r * 0.88, fill: 'url(#g-head)', class: 'head' }, g);
        gloss(g, r * 0.88);
        // logo ring on the front head
        el('circle', { r: r * 0.62, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2, opacity: 0.55 }, g);
        el('circle', { r: r * 0.66, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 0.8, opacity: 0.35 }, g);
        const logo = el('text', { class: 'lbl logo', y: -r * 0.32, 'font-size': r * 0.13 }, g);
        logo.textContent = 'DRUM KIT';
        return labels(g, r, letter, true);
    }

    function cymbal(g, p, letter) {
        const { r } = p;
        if (p.hats) {
            // bottom hat peeking out under the top one
            el('circle', { r: r * 1.02, cx: 4, cy: 6, fill: 'url(#g-cym)', opacity: 0.6 }, g);
        }
        el('circle', { r, fill: 'url(#g-cym)' }, g);
        // lathe grooves
        const grooves = Math.round(r / 9);
        for (let i = 1; i <= grooves; i++) {
            const rr = r * (0.24 + (i * 0.74) / grooves);
            el('circle', {
                r: rr, fill: 'none',
                stroke: i % 2 ? 'rgba(0,0,0,.16)' : 'rgba(255,255,255,.12)', 'stroke-width': 1,
            }, g);
        }
        // the bright "bow-tie" reflection every real cymbal has
        const shine = el('g', { class: 'shine' }, g);
        const wedge = (a0, a1) => {
            const rad = (a) => (a * Math.PI) / 180;
            const x0 = Math.cos(rad(a0)) * r, y0 = Math.sin(rad(a0)) * r;
            const x1 = Math.cos(rad(a1)) * r, y1 = Math.sin(rad(a1)) * r;
            return `M0 0 L${x0} ${y0} A${r} ${r} 0 0 1 ${x1} ${y1} Z`;
        };
        el('path', { d: wedge(-58, -32), fill: '#fff', opacity: 0.22 }, shine);
        el('path', { d: wedge(122, 148), fill: '#fff', opacity: 0.22 }, shine);
        el('path', { d: wedge(-50, -40), fill: '#fff', opacity: 0.25 }, shine);
        el('path', { d: wedge(130, 140), fill: '#fff', opacity: 0.25 }, shine);
        el('circle', { r, fill: 'none', stroke: 'rgba(0,0,0,.35)', 'stroke-width': 1.5 }, g);
        el('circle', { r: r - 1.5, fill: 'none', stroke: 'url(#g-rim)', 'stroke-width': 1.5 }, g);
        el('circle', { r: r * 0.24, fill: 'url(#g-bell)' }, g);
        el('circle', { r: r * 0.24, fill: 'none', stroke: 'rgba(0,0,0,.25)', 'stroke-width': 1 }, g);
        el('circle', { r: r * 0.06, fill: '#2b2b2b', stroke: 'url(#g-chrome)', 'stroke-width': 2 }, g);
        // letters sit below the bell so they don't cover the centre nut
        return labels(g, Math.max(r * 0.85, 60), letter, false, r * 0.4);
    }

    function bell(g, p, letter) {
        // cowbell seen from above: a flared steel trapezoid with a dark mouth
        const r = p.r;
        el('path', {
            d: `M${-r * 0.5} ${-r} L${r * 0.5} ${-r} Q${r * 0.62} ${-r} ${r * 0.68} ${-r * 0.85}
                L${r * 1.02} ${r * 0.82} Q${r * 1.05} ${r} ${r * 0.85} ${r}
                L${-r * 0.85} ${r} Q${-r * 1.05} ${r} ${-r * 1.02} ${r * 0.82}
                L${-r * 0.68} ${-r * 0.85} Q${-r * 0.62} ${-r} ${-r * 0.5} ${-r} Z`,
            fill: 'url(#g-steel)', stroke: 'rgba(0,0,0,.45)', 'stroke-width': 1.5,
        }, g);
        el('path', {
            d: `M${-r * 0.82} ${r * 0.72} L${r * 0.82} ${r * 0.72} L${r * 0.86} ${r * 0.92} L${-r * 0.86} ${r * 0.92} Z`,
            fill: 'rgba(0,0,0,.55)',
        }, g);
        el('rect', { x: -r * 0.18, y: -r * 1.22, width: r * 0.36, height: r * 0.3, rx: 3, fill: 'url(#g-chrome)' }, g);
        const l = el('text', { class: 'lbl letter', y: -r * 0.3, 'font-size': 28 }, g);
        l.textContent = letter;
        return el('text', { class: 'lbl name', y: r * 0.42, 'font-size': 14 }, g);
    }

    function pad(g, p, letter) {
        const s = p.r;
        el('rect', { x: -s, y: -s, width: s * 2, height: s * 2, rx: s * 0.28, fill: 'url(#g-pad)' }, g);
        el('rect', { x: -s, y: -s, width: s * 2, height: s * 2, rx: s * 0.28, fill: 'none', stroke: 'rgba(255,255,255,.12)', 'stroke-width': 1.5 }, g);
        el('rect', {
            x: -s * 0.78, y: -s * 0.78, width: s * 1.56, height: s * 1.56, rx: s * 0.18,
            fill: '#0c0d11', stroke: 'var(--accent)', 'stroke-width': 2, class: 'pad-face', 'stroke-opacity': 0.55,
        }, g);
        for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            el('circle', { cx: x * s * 0.88, cy: y * s * 0.88, r: s * 0.04, fill: 'url(#g-chrome)' }, g);
        }
        return labels(g, s * 1.25, letter, false);
    }

    /* ---------- build ---------- */

    function build(container, pads, onHit) {
        svg = el('svg', { class: 'kit-svg', role: 'group', 'aria-label': 'Drum kit' });
        defs();

        el('ellipse', { class: 'rug deco', fill: 'url(#g-rug)' }, svg);
        kitGroup = el('g', { class: 'kit' }, svg);

        const letters = Object.fromEntries(pads.map((p) => [p.name, p.label]));
        const builders = { drum, kick, cymbal, pad, bell };

        ORDER.forEach((name) => {
            const p = PIECES[name];
            const root = el('g', { class: `piece ${p.type}`, 'data-name': name, role: 'button' }, kitGroup);
            const glow = shadowAndGlow(root, p.r, p.type === 'pad' || p.type === 'bell');
            const ripples = el('g', { class: 'ripples deco' }, root);
            const body = el('g', { class: 'body' }, root);

            const nameText = builders[p.type](body, p, letters[name]);
            let edgeText = null;
            if (p.hats) {
                // the outer ring of the hi-hat plays the open hat
                el('circle', { r: p.r * 0.62, fill: 'none', stroke: 'rgba(0,0,0,.35)', 'stroke-width': 1.5, 'stroke-dasharray': '4 5' }, body);
                edgeText = el('text', { class: 'lbl edge', y: -p.r * 0.74, 'font-size': 14 }, body);
            }

            root.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                const pt = toLocal(root, e);
                const d = Math.hypot(pt.x, pt.y) / p.r;   // 0 = centre, 1 = edge
                if (p.hats) {
                    onHit(d > 0.62 ? 'openhat' : 'hihat', 1);
                } else if (p.type === 'drum' || p.type === 'kick') {
                    // like a real drum: the centre is fuller and louder than the edge
                    onHit(name, Math.max(0.55, Math.min(1, 1.08 - d * 0.5)));
                } else {
                    onHit(name, 1);
                }
            });

            parts[name] = { root, body, glow, ripples, nameText, edgeText, piece: p };
        });
        parts.openhat = parts.hihat;
        openLetter = letters.openhat;

        ambientEl = document.createElement('div');
        ambientEl.className = 'ambient';
        document.body.prepend(ambientEl);
        startLights();

        container.appendChild(svg);
        new ResizeObserver(() => applyLayout(container)).observe(container);
        applyLayout(container);
    }

    /* ---------- Stage lights ----------
       Four moving-head spotlights sweep slowly over the kit, each throwing a
       pool of light on the floor. Haze specks only show inside the beams.
       Hits feed energy in: the kick makes every beam swell, cymbals flash white. */

    const lights = { pulse() {} };

    function startLights() {
        const canvas = document.querySelector('.stage-lights');
        if (!canvas) return;
        const c = canvas.getContext('2d');
        let w = 0, h = 0;
        let energy = 0, flare = 0, last = 0;
        let colors = ['#ffdcae', '#ffb547'];
        let colorsAt = 0;

        // x: across the ceiling, base/amp: aim and swing in degrees, speed: how fast it sweeps
        const fixtures = [
            { x: 0.12, base: 26,  amp: 14, speed: 0.31, phase: 0.0, col: 0 },
            { x: 0.37, base: 9,   amp: 18, speed: 0.23, phase: 2.1, col: 1 },
            { x: 0.63, base: -9,  amp: 18, speed: 0.27, phase: 4.0, col: 1 },
            { x: 0.88, base: -26, amp: 14, speed: 0.35, phase: 1.2, col: 0 },
        ];
        const beams = fixtures.map(() => ({ sx: 0, sy: 0, dx: 0, dy: 1 }));
        const SPREAD = 0.12;   // half-width of a beam per unit of length

        const specks = [];
        function spawn(anyY) {
            return {
                x: Math.random() * w,
                y: anyY ? Math.random() * h : h + 5,
                r: 0.5 + Math.random() * 1.4,
                vx: (Math.random() - 0.5) * 0.12,
                vy: -(0.04 + Math.random() * 0.14),
                a: 0.35 + Math.random() * 0.5,
                phase: Math.random() * Math.PI * 2,
            };
        }

        function resize() {
            const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
            w = canvas.clientWidth;
            h = canvas.clientHeight;
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(h * dpr);
            c.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        function rgba(color, a) {
            const m = color.match(/[\d.]+/g);
            if (color.startsWith('#')) {
                const n = parseInt(color.slice(1), 16);
                return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
            }
            return m ? `rgba(${m[0]},${m[1]},${m[2]},${a})` : `rgba(255,255,255,${a})`;
        }

        function readColors(now) {
            // theme colours fade over ~0.8 s, so re-read them a few times a second
            if (now - colorsAt < 120) return;
            colorsAt = now;
            const cs = getComputedStyle(document.body);
            colors = [cs.getPropertyValue('--beam').trim() || '#fff', cs.getPropertyValue('--accent').trim() || '#fff'];
        }

        function cone(sx, sy, ex, ey, half, color, alpha) {
            const len = Math.hypot(ex - sx, ey - sy);
            const px = (ey - sy) / len, py = -(ex - sx) / len;   // perpendicular
            const g = c.createLinearGradient(sx, sy, ex, ey);
            g.addColorStop(0, rgba(color, alpha));
            g.addColorStop(0.55, rgba(color, alpha * 0.55));
            g.addColorStop(1, rgba(color, 0));
            c.fillStyle = g;
            c.beginPath();
            c.moveTo(sx + px * 5, sy + py * 5);
            c.lineTo(ex + px * half, ey + py * half);
            c.lineTo(ex - px * half, ey - py * half);
            c.lineTo(sx - px * 5, sy - py * 5);
            c.closePath();
            c.fill();
        }

        function glowAt(x, y, r, color, alpha, squash = 1) {
            c.save();
            c.translate(x, y);
            c.scale(1, squash);
            const g = c.createRadialGradient(0, 0, 0, 0, 0, r);
            g.addColorStop(0, rgba(color, alpha));
            g.addColorStop(0.5, rgba(color, alpha * 0.35));
            g.addColorStop(1, rgba(color, 0));
            c.fillStyle = g;
            c.beginPath();
            c.arc(0, 0, r, 0, Math.PI * 2);
            c.fill();
            c.restore();
        }

        function draw(now, animate) {
            const dt = last ? Math.min(0.1, (now - last) / 1000) : 0.016;
            last = now;
            energy *= Math.exp(-dt * 3.2);
            flare *= Math.exp(-dt * 4);
            readColors(now);

            const t = now / 1000;
            const floorY = h * 0.88;
            c.clearRect(0, 0, w, h);
            c.globalCompositeOperation = 'lighter';

            fixtures.forEach((f, i) => {
                const deg = f.base + (animate ? f.amp * Math.sin(t * f.speed + f.phase) : 0);
                const a = (deg * Math.PI) / 180;
                const sx = f.x * w, sy = -h * 0.03;
                const dx = Math.sin(a), dy = Math.cos(a);
                const dist = (floorY - sy) / dy;
                const ex = sx + dx * dist, ey = floorY;
                const half = dist * SPREAD;
                const color = colors[f.col];
                const k = 0.65 + energy * 1.1;

                // layered cones fake a soft, hazy edge without expensive blur filters
                [[1.9, 0.045], [1.4, 0.06], [1, 0.075], [0.55, 0.08]].forEach(([wf, al]) =>
                    cone(sx, sy, ex, ey, half * wf, color, al * k));
                if (flare > 0.02) cone(sx, sy, ex, ey, half * 0.8, '#ffffff', 0.1 * flare);

                glowAt(ex, ey, half * 1.6, color, 0.2 * k, 0.28);   // pool on the floor
                glowAt(sx, sy + 8, 46, color, 0.4 * k);               // the lamp itself

                const b = beams[i];
                b.sx = sx; b.sy = sy; b.dx = dx; b.dy = dy;
            });

            if (animate) {
                specks.forEach((s, i) => {
                    s.x += s.vx + Math.sin(t * 0.35 + s.phase) * 0.06;
                    s.y += s.vy;
                    if (s.y < -5 || s.x < -5 || s.x > w + 5) specks[i] = spawn(false);

                    // how deep inside a beam is this speck? (haze is only visible in light)
                    let lit = 0;
                    beams.forEach((b) => {
                        const px = s.x - b.sx, py = s.y - b.sy;
                        const along = px * b.dx + py * b.dy;
                        if (along <= 0) return;
                        const off = Math.abs(px * b.dy - py * b.dx);
                        lit = Math.max(lit, 1 - off / (along * SPREAD * 1.4));
                    });
                    const alpha = s.a * (0.06 + 0.94 * Math.max(0, lit)) * (0.6 + 0.4 * Math.sin(t * 1.3 + s.phase)) * (0.8 + energy * 0.4);
                    if (alpha < 0.02) return;
                    c.fillStyle = rgba(colors[0], Math.min(1, alpha));
                    c.beginPath();
                    c.arc(s.x, s.y, s.r, 0, Math.PI * 2);
                    c.fill();
                });
            }
            c.globalCompositeOperation = 'source-over';
        }

        resize();
        for (let i = 0; i < 70; i++) specks.push(spawn(true));

        if (reduceMotion) {
            // still lit, but nothing moves
            const still = () => { resize(); last = 0; draw(performance.now(), false); };
            window.addEventListener('resize', still);
            still();
            return;
        }

        window.addEventListener('resize', resize);
        lights.pulse = (strength, kind) => {
            energy = Math.min(1.3, Math.max(energy, strength));
            if (kind === 'cymbal') flare = Math.min(1, Math.max(flare, strength));
        };
        const loop = (now) => {
            draw(now, true);
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    function toLocal(node, e) {
        const pt = svg.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        return pt.matrixTransform(node.getScreenCTM().inverse());
    }

    function applyLayout(container) {
        const { width, height } = container.getBoundingClientRect();
        if (!width || !height) return;
        const next = width / height < 0.95 ? 'tall' : 'wide';
        if (next === layout) return;
        layout = next;

        svg.setAttribute('viewBox', VIEW[layout]);
        const [vx, vy, vw, vh] = VIEW[layout].split(' ').map(Number);
        const rug = svg.querySelector('.rug');
        rug.setAttribute('cx', vx + vw / 2);
        rug.setAttribute('cy', vy + vh * 0.58);
        rug.setAttribute('rx', vw * 0.5);
        rug.setAttribute('ry', vh * 0.46);

        Object.entries(PIECES).forEach(([name, p]) => {
            if (!p[layout]) return;
            const [x, y, s = 1] = p[layout];
            parts[name].root.setAttribute('transform', `translate(${x} ${y}) scale(${s})`);
        });
    }

    function setLabel(name, text) {
        const part = parts[name];
        if (!part) return;
        if (name === 'openhat') {                           // shares the hi-hat's outer ring
            part.edgeText.textContent = `${openLetter} · ${text === 'openhat' ? 'open' : text}`;
            return;
        }
        const pretty = { hihat: 'hi-hat', tom2: 'hi-tom' };
        part.nameText.textContent = pretty[text] || text;
        part.root.setAttribute('aria-label', pretty[text] || text);
    }

    /* ---------- hit animations ---------- */

    function ripple(part, strength) {
        const r = part.piece.r;
        const c = el('circle', {
            r: r * 0.9, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 3, opacity: 0,
        }, part.ripples);
        c.animate([
            { transform: 'scale(.85)', opacity: 0.9 * strength },
            { transform: `scale(${1.35 + strength * 0.25})`, opacity: 0 },
        ], { duration: 650, easing: 'cubic-bezier(.2,.7,.3,1)' }).onfinish = () => c.remove();
    }

    function glow(part, peak, duration) {
        part.glow.animate([{ opacity: peak }, { opacity: 0 }], { duration, easing: 'ease-out' });
    }

    function pulseAmbient(strength) {
        ambientEl.animate([{ opacity: 0.3 + strength * 0.5 }, { opacity: 0.25 }], { duration: 500, easing: 'ease-out' });
    }

    function animate(name, vel = 1) {
        const part = parts[name];
        if (!part) return;
        const type = part.piece.type;
        const strong = name === 'kick' || name === 'boom';
        const longRing = name === 'openhat' || name === 'ride' || name === 'crash';

        glow(part, (type === 'cymbal' ? 0.75 : 1) * vel, longRing ? 900 : 450);
        pulseAmbient((strong ? 1 : 0.5) * vel);
        lights.pulse((strong ? 1 : type === 'cymbal' ? 0.6 : 0.35) * vel, type);
        if (reduceMotion) return;

        if (type === 'cymbal') {
            const big = ({ openhat: 1.6, crash: 1.8, ride: 1.1, splash: 1.4 }[name] || 0.7) * vel;
            part.body.animate([
                { transform: 'rotate(0deg) scale(1)' },
                { transform: `rotate(${7 * big}deg) scale(${1 - 0.05 * big}, ${1 - 0.09 * big})` },
                { transform: `rotate(${-4 * big}deg) scale(1, ${1 - 0.04 * big})` },
                { transform: `rotate(${2 * big}deg) scale(1)` },
                { transform: 'rotate(0deg) scale(1)' },
            ], { duration: 500 + 350 * big, easing: 'ease-out' });
            part.body.querySelector('.shine').animate(
                [{ transform: 'rotate(0deg)' }, { transform: `rotate(${30 * big}deg)` }, { transform: 'rotate(0deg)' }],
                { duration: 600 + 300 * big, easing: 'ease-out' });
            if (name === 'openhat' || name === 'crash') ripple(part, 0.6 * vel);
        } else if (type === 'pad') {
            part.body.animate([{ transform: 'scale(1)' }, { transform: 'scale(.93)' }, { transform: 'scale(1)' }],
                { duration: 160, easing: 'ease-out' });
            part.body.querySelector('.pad-face').animate(
                [{ fill: 'var(--accent)', fillOpacity: 0.55, strokeOpacity: 1 }, { fill: '#0c0d11', fillOpacity: 1, strokeOpacity: 0.55 }],
                { duration: 380, easing: 'ease-out' });
        } else if (type === 'bell') {
            part.body.animate([
                { transform: 'rotate(0deg)' }, { transform: 'rotate(-9deg)' },
                { transform: 'rotate(5deg)' }, { transform: 'rotate(0deg)' },
            ], { duration: 300, easing: 'ease-out' });
            ripple(part, 0.5 * vel);
        } else {
            const squash = 1 - 0.045 * vel;
            part.body.animate([{ transform: 'scale(1)' }, { transform: `scale(${squash})` }, { transform: 'scale(1)' }],
                { duration: 170, easing: 'ease-out' });
            ripple(part, (strong ? 1 : 0.8) * vel);
            if (strong) setTimeout(() => ripple(part, 0.5 * vel), 90);
        }

        if (name === 'kick') {
            const s = 5 * vel;
            kitGroup.animate([
                { transform: 'translate(0, 0)' }, { transform: `translate(0, ${s}px)` },
                { transform: `translate(0, ${-s / 2.5}px)` }, { transform: 'translate(0, 0)' },
            ], { duration: 200, easing: 'ease-out' });
        }
    }

    return { build, setLabel, animate };
})();

# Drum Kit

A web drum kit built with HTML, CSS and plain JavaScript. Play it with your keyboard, or tap the pads on a phone or tablet.

![Drum Kit screenshot](docs/screenshot.jpg)

## Live Demo

[hamzi125.github.io/Drum-Kits](https://hamzi125.github.io/Drum-Kits/)

## Features

- **Keyboard and touch:** play with the keys or by clicking or tapping the pads
- **Three kits:**
  - *Acoustic* uses recorded samples
  - *Electronic* is synthesised live with the Web Audio API (no extra files)
  - *Percussion* is synthesised too: conga, bongo, shaker, cowbell, woodblock, clave, tambourine, triangle and timbale
- **Record and play back:** record a beat and play it back, once or on a **loop** (you can switch kits while it loops)
- **Metronome:** adjustable from 40 to 240 BPM, with an accent on beat 1
- **Volume control:** your kit, volume and tempo are remembered in the browser
- **Low latency:** sounds play through the Web Audio API, so fast repeated hits don't cut each other off
- **Responsive:** works on phones, tablets and desktop

## Controls

| Key | Acoustic / Electronic | Percussion |
|-----|-----------------------|------------|
| A   | Boom                  | Conga      |
| S   | Clap                  | Bongo      |
| D   | Hi-hat                | Shaker     |
| F   | Kick                  | Cowbell    |
| G   | Open hat              | Woodblock  |
| H   | Ride                  | Clave      |
| J   | Snare                 | Tambourine |
| K   | Tink                  | Triangle   |
| L   | Tom                   | Timbale    |

## Run locally

The acoustic samples are loaded with `fetch()`, so serve the folder over HTTP rather than opening the file directly:

```bash
python -m http.server
# then open http://localhost:8000
```

If you do open `index.html` directly, it still works: it switches to plain `<audio>` playback.

## Project structure

```
index.html   page layout and controls
style.css    styling and responsive layout
script.js    audio engine, kits, metronome, recording
Sounds/      acoustic drum samples (.wav)
bg.webp/jpg  background image
```

## Show your support

Give a ⭐️ if you like this project!

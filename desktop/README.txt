NEON PEACH - digital bass FX workstation
=========================================

HOW TO RUN
1. Open Neon Peach like any other app.
2. Press the power button. When the computer asks to use the microphone,
   say yes. That is how your bass gets in.
3. Open Settings > Audio (top right). Pick your audio interface as Input
   and Output. Then pick the jack your bass is in: Input 1 or Input 2.
4. Set your interface to its smallest buffer size (64 or 128) and 48 kHz.
   That cuts the delay.
5. New here? Open the Wizard. Pick a style and it builds the whole rig.

No bass handy? Press "Hear it" on the Wizard page, or open Settings > Audio
and press "Play the demo riff".

NEW IN 2.3: THE NEON 900 HEAD
- A Darkglass-style bass amp in one block. Find it under Amp in the
  block picker. Four presets are in bank 6. The Wizard has two new styles:
  Microtubes 900 and Alpha-Omega Wall.
- Circuit: Microtubes or Alpha-Omega.
  Microtubes: the Era knob goes from B3K (0, tight and clanky) to
  Vintage (100, warm and round).
  Alpha-Omega: the Mod knob goes from Alpha (0, tight and punchy) to
  Omega (100, raw and fuzzy).
- Drive, Blend, Level and Tone work like the pedals.
- Grunt (Thin / Raw / Fat) sets how much low end hits the drive.
  Attack (Cut / Flat / Boost) sets how much top end hits the drive.
  Bite pushes 2.8 kHz into the drive. Growl pushes the low mids in.
- Gain is the clean preamp gain, before the drive.
- The EQ is the 900 tone stack: Bass at 70 Hz, Lo Mids at 250, 500 or
  1k, Hi Mids at 750, 1.5k or 3k, Treble at 5 kHz.
- Sag is the power amp giving a little under a hard note. Master is the
  power amp level. Cab adds one of the eight cabs, or Off to use a Cab
  block or a real amp.
- The drive runs 4 times oversampled with anti-aliasing, so it is clean
  at high gain. It adds 0.4 ms, the same as any drive block.
- It plays the same in the low-delay engine and in the browser engine.

MELTED RASPBERRY (also new in 2.3)
- The 900's bigger sibling. Same knobs, plus:
- The lows stay clean. Everything under Split goes around the drive.
  Low Squeeze is a compressor just for the lows. Lows sets their level.
  The lows come back in time with the highs, so nothing thins out.
- Two drive stages. Warmth is a soft first stage. It adds a little
  squash and even harmonics before the drive. That is the melted part.
- A third circuit, Raspberry. Mod goes from Melt (creamy and round) to
  Jam (crunchy and mid-forward). Microtubes and Alpha-Omega are there too.
- Presence after the drive. A 6-band EQ at 70, 180, 400, 1k, 2.5k and
  6k. Air adds sparkle up top.
- It adds 0.8 ms (two drive stages). Two presets are in bank 6, and the
  Wizard has a Melted Raspberry style.

NEW IN 2.2: THE BEDROOM KIT
- Songs (Practice > Songs): load any song. Drag across the waveform to
  loop a hard part. Slow it down without changing the pitch. Change its
  key. "Turn it down" cuts the song's bass so you play the line. "Bass
  only" lets you hear the line clearly. Speed Trainer starts slow and
  speeds up a bit each time the loop comes around. It also guesses the
  song's tempo, so delays and Beats can match it.
- Record (Practice > Record, or Shift+R): every take keeps your clean bass
  too. Re-amp puts that same playing through a different preset. Tweak
  loops your clean take through the chain while you turn knobs. Save the
  mix or the clean DI as a WAV.
- Library (Clone > Library): add a whole folder of .nam models and .wav
  cab IRs at once. Search them. Star your favorites. In a Cabinet or
  Clone block, press Browse to pick one.
- Dual Cab block: two cabinets at once. Blend them or spread them wide.
- No gap when you change presets. Delay and reverb tails keep ringing.
  A loop you recorded comes with you to the next preset.
- Looper: "Lock to tempo" snaps loops to whole bars. With Beats playing,
  recording starts on bar 1.
- Even levels: on the Chain page, press Match level and play for 6
  seconds. Do it on each preset and they come out the same loudness.
- Copy a block (Copy button or Ctrl+C) and paste it into any preset.
- Presets > Share gives a short code. A friend pastes it to get the preset.

NEW IN 2.1: THE LOW-DELAY ENGINE
- Neon Peach now has its own audio engine, written in C++. It talks to
  your audio interface directly: through ASIO on Windows, and Core Audio
  on Mac. The browser's audio system is out of the way.
- It plays the exact same sound. Every effect was checked against the old
  engine, sample by sample.
- Open Settings > Audio. The "Low-delay engine" panel picks the driver,
  the interface, the input jacks, the buffer size and the sample rate.
  Smaller buffer = less delay. If you hear clicks, go one size up.
- Windows: pick "ASIO" as the driver for the lowest delay. If your
  interface has no ASIO choice, install the ASIO driver from the company
  that made it (Focusrite, Audient, Behringer, PreSonus and others give it
  away free on their websites).
- No microphone prompt any more. The interface's jacks come straight in.
- If the engine can't open your interface, Neon Peach falls back to the
  old engine and tells you why. "Use the browser engine instead" on the
  same panel switches back by hand.

- Much less delay. The old compressors, limiter and drives hid 20 to 28 ms
  of delay inside the chain. The new ones add almost none:
  0 ms for compressors and limiters, 0.4 ms per drive or amp.
  The drives are also cleaner: far less harsh grit at high gain.
- The clock in the top bar shows the delay from string to speaker.
  Tap it for details. Settings > Audio has a ping test that measures the
  real number through your interface.
- Windows (browser engine only): Audio > Exclusive Windows Audio. Neon Peach takes over the
  output so the Windows mixer can't add its own buffer. Other apps go
  quiet while it runs. The app restarts to switch. If you get no sound,
  turn it off in the same menu.
- Tone Wizard: 15 styles (Pop-Punk Punch, Modern Clank, Motown Thump,
  Funk Slap, Synthwave, Doom Fuzz Wall and more). Five sliders: Dirt,
  Bright, Low end, Squash, Space.
- Beats: a drum machine that follows your tempo. 12 styles, fills,
  count-in, swing, and a grid to make your own beat. Press B.
- Stage mode: huge preset name, huge footswitches, a tuner and the beat
  light, readable from across the room. Press F. Esc to leave.
- Undo and redo: Ctrl+Z and Ctrl+Y (Cmd+Z and Cmd+Shift+Z on Mac).
- 13 new blocks: Split Grind (clean lows, dirty highs), Peach Muff,
  Octave Fuzz, Three Band Squeeze, Auto Swell, Reverse Delay, Freeze,
  Talk Box, Stutter, Doubler, Tilt EQ, FX Loop and Aux Send.
- FX Loop: put a real pedal in the middle of the chain through spare
  jacks on your interface.
- Outputs: Main and Aux pairs, mono for a PA, and Aux can carry a dry DI
  or a pre-cab feed for a stage amp.
- Parallel paths are lined up in time, so blending them doesn't thin out.
- The block picker has a search box and a short note for each block.
  New blocks go right after the block you picked.
- A live scope glows behind the chain while you play.
- 20 new presets in banks 3 to 5.
Works offline. Nothing is sent over the internet.

THE DESKTOP APP
- Your files go in Documents > Neon Peach. It has these folders:
  Presets, Clones, Recordings, Test Tones and Backups.
  Every export lands there. No save box pops up.
- Backups happen on their own every 5 minutes when something changed.
  They hold every preset and clone. The last 14 days are kept.
  File > Back Up Now makes one right away.
  To bring one back: File > Import Presets, then pick the backup file.
- Double-click a .nam file to load it into Clone.
- If you quit while a clone is still learning, Neon Peach asks first.
- The computer will not go to sleep while a clone is learning.
- Sound keeps playing when the window is behind other windows.

MENU SHORTCUTS (Ctrl on Windows, Cmd on Mac)
Ctrl+Enter = power on        Ctrl+1 to 9 = pages      Ctrl+I = audio settings
Ctrl+O = load a clone file   Ctrl+E = export all       Ctrl+S = back up now
Ctrl+T = tuner               Ctrl+R = record output    Ctrl+Shift+M = mute all
Ctrl+N = Tone Wizard         Ctrl+B = beat on/off      Ctrl+Shift+L = stage mode
Ctrl+Z = undo                Ctrl+Y = redo
Ctrl+Shift+F = open the Neon Peach folder

THE LOOK
- The body is brushed steel. The screen is black glass.
  Knobs are chrome. Footswitches are polished caps with LED rings.
- Light means signal. Blocks that are on glow in their own color.
  Bypassed blocks look like unlit glass.
- Each footswitch has a small label screen that shows what it does.
- Each knob has a small window that shows its value.
- Path A is the peach tube. Path B is the cyan tube.
  The tubes get brighter when you play.
- Global (top right) has a glow color picker if you want a different hue.

WHERE THINGS ARE
- Left rail: Chain, Presets, Wizard, Switches (Scenes and Stomp), Tuner,
  Looper, Beats, Clone (Clone and Tone Match).
- Top right: Stage, Settings (Audio, Outputs, MIDI, Global), Help.
- Bottom: 6 knobs for the selected block, 3 footswitches, mode, tap tempo,
  expression pedal and level meters.

WHAT IT DOES
- 2 signal paths. Parallel, crossover, series, or A only.
- Up to 24 blocks. 57 block types.
- Drives: B3K, Vintage, Alpha, Omega, Ignissor fuzz, overdrive, tube pre, wavefolder.
- The Neon 900 and Melted Raspberry heads (Darkglass-style), 8 classic amp heads, 8 cabs, 4 mic types, load your own .wav IRs.
- Clone: copy any pedal or plugin. Load .nam files and .wav IRs. (See CLONE below.)
- Tone Match: match a record you love with a 10-band EQ.
- Compressor, gate, limiter. Parametric, graphic, 6-band EQ, cuts.
- Sub octave, pitch shift, harmonizer, Peach Synth (follows your notes).
- Envelope filter, wah, multi filter.
- Chorus, flanger, phaser, tremolo, vibrato, rotary, ring mod, bit crusher.
- Delay (digital, tape, analog, ping pong, multi-tap) with tempo sync and trails.
- Reverb (room, hall, plate, spring, cathedral, shimmer) with trails.
- 3-minute stereo looper: dub, undo, reverse, half speed.
- Tuner, tap tempo, room EQ, master limiter, meters.
- 128 preset slots (16 banks x 8). 8 scenes per preset. Stomp macros.
- 3 modes: Preset, Scene, Stomp. Hold C for the tuner. Hold B to record a loop.
- Expression pedal: tap EXP next to any setting to link it.
- MIDI: link knobs and pedals, Program Change in and out, MIDI clock sync.
- Record your output to WAV. Load a backing track.
- Export and import presets as JSON. Everything saves on this computer.
  "Export all" on the Presets page also saves your clones.

CLONE (copy a pedal or a plugin)
Open Clone in the left rail. Pick one of three ways.

Copy a pedal
1. Plug the interface output into the pedal input.
   Plug the pedal output into the interface input.
   A re-amp box makes fuzz pedals copy truer.
   Your chain is muted now, so the loop can't squeal.
2. Turn your speakers down. Press Test and set the Send level.
   Aim for a good return level with no clipping.
3. Optional: press Measure with a plain cable from output to input.
   This makes the copy react to your bass like the pedal does.
4. Name it and press "Clone it". The tone plays for about a minute.
   Then Neon Peach learns the sound. Quick takes 1 minute, Good 2.5, Best 5.
   If the computer hiccups during the take, Neon Peach notices and asks
   you to try again. Closing other apps and tabs helps.
5. When you are done, unplug the pedal loop and plug your bass back in.
   Then press "Use it in the chain", or press "Chain muted" at the top.
   That turns the chain back on.

Copy a plugin
1. Press "Download test tone". It is a WAV file.
2. In your music app, put it on a track with only your plugin on it.
   Export the track at 48 kHz as a WAV or FLAC file,
   from the very start of the tone to the very end.
3. Press "Upload result".

Load a file
- Load .nam files (Neural Amp Modeler) and .wav impulse responses.
- WaveNet, LSTM, ConvNet, A2 and slim models all play.

What you get
- Sounds that are only tone (EQ, cab, reverb) become an IR right away.
- Everything else becomes a neural model in the NAM format.
- "How close" shows how near the copy is to the real sound.
  Press "Hear the real one" and "Hear the copy" to compare.
- Add the Clone block to the chain like any other block.
  It has Input, Level, Mix (blend with your clean bass), Low Cut and High Cut.
  "Even out level" makes loud and quiet model files play at a similar volume.
  It starts on for loaded files and off for your own copies.
- A pedal copy reacts to your bass like the real pedal does.
  The Gain and pad on the I/O page change its volume, not how hard it is hit.
- Export saves a .nam file (or a .wav for IRs).
  "NAM standard" models use the same shapes the NAM trainer makes.
  Quick and Good make a "feather" model. Best makes a full "standard"
  model, the size most NAM players expect.
  "Fast LSTM" models learn faster and play in the NAM plugin.
  LSTM can also follow slow changes, so try it for compressors.
- Clones are saved in the app and in every backup. Export the ones you love.
- Moving sounds (chorus, phaser, tremolo) change over time.
  They do not copy well. Drives, fuzz, boosts, compressors, EQs and preamps do.

KEYBOARD
1 / 2 / 3 = footswitches     Space = tap tempo     T = tuner
R = loop record              S = loop stop         M = next mode
B = beat on/off              F = stage mode        Esc = leave stage mode

TIPS
- Backups are automatic. Copy the Backups folder somewhere safe now and then.
- Hold Shift while dragging a knob for fine control.
- Tap a knob to reset it. The mouse wheel also turns knobs.

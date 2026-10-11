# Rapfi Mix9 engine (Divine Move / 神之一手)

## Algorithm Club integration

Algorithm Club uses this package for 铭星V10Ultra (10.1), preserving the
upstream engine, WASM and Mix9 weight bytes. The Worker bridge is adapted
to accept preloaded assets when a page is opened with `file://`.
`file-package.js` is a generated JavaScript envelope for the same assets,
not another network or engine. Rebuild it with
`node tools/build-gomoku-v10ultra-file-package.mjs`. HTTP(S) pages continue
to load the original separate files. The provenance and license notices
below are retained from the MeTool package.

This directory contains a **standalone** WebAssembly build of
[Rapfi](https://github.com/dhbloo/rapfi) with a **freestyle-only Mix9**
weight package, used only by the Gomoku **神之一手** (Divine Move) difficulty
via a dedicated classic Worker (`worker.js`).

It is a separate program from the heuristic Rapfi build in
`/games/gomoku/rapfi/` (Heaven / Origin). The two WASM binaries are not
interchangeable: this JS file’s `files[]` / `remote_package_size` must stay
paired with this directory’s `rapfi.data`.

## License

Rapfi is free software under the **GNU General Public License v3** (see
`COPYING.txt`). Authors: see `AUTHORS.txt`.

The Mix9 network `mix9svqfreestyle_bsmix.bin.lz4` is from
[rapfi-networks](https://github.com/dhbloo/rapfi-networks) and is dedicated to
the public domain (**CC0**).

MeTool loads this worker as a **separate program** and talks to it with the
Piskvork text protocol (board → move). The rest of the MeTool website is **not**
relicensed under GPL solely because this worker is present.

## What is packaged

`rapfi.data` is a slimmed gomocalc remote package (~10 MB), **not** the full
38 MB multi-rule dump:

- `config.toml` — Mix9 evaluator, **freestyle weight only**
- `mix9svqfreestyle_bsmix.bin.lz4` — freestyle Mix9 (~10 MB)
- `model210901.bin` — tiny classical fallback referenced by `[model]`

**Renju / standard Mix9 nets are intentionally omitted.** This difficulty is
freestyle Gomoku only, and the Mix9 `bsmix` weight’s board-size mask is
**13–22** (so 9×9 is not offered). Heaven / Origin still offer 9×9 and Renju
via the other Rapfi worker.

## Corresponding source

- Upstream engine: https://github.com/dhbloo/rapfi
- Networks: https://github.com/dhbloo/rapfi-networks
- Web app that publishes similar WASM builds: https://github.com/dhbloo/gomoku-calculator

The binaries (`rapfi-single.js`, `rapfi-single.wasm`) are the Mix9-capable
single-thread build mirrored from `https://www.gomocalc.com/build/` (retrieved
2026-08-20). `rapfi.data` was rebuilt from that dump by dropping unused weight
files and rewriting `config.toml`.

To regenerate an equivalent WASM build from source, follow Rapfi’s
“Build for WebAssembly” section in its README (Emscripten + CMake), then place
the outputs next to this `NOTICE.md`. Rebuild `rapfi.data` so `files[]` and
`remote_package_size` in `rapfi-single.js` match the concatenated blobs.

`worker.js` in this folder is a thin MeTool protocol bridge for that engine; if
you distribute modified copies of this directory, keep GPL notices and provide
source for any Rapfi changes you make.

# V10 freestyle engine experiments

These engines were selected as V10Mesa (SlowRenju, internal 10.2) and V9Mesa
(GomokuZero, internal 9.3). Neither replaces existing model files or consumes
the opening-prior archive. The production page awards 14 / 9 points and only
V10Mesa uploads all outcomes. The separate experiments page still performs no
Supabase or leaderboard writes.

## SlowRenju

- Upstream: https://github.com/wind23/SlowRenju
- Pinned source: `41007cf70762b62df77223da25c9605d0a853602`, engine version 5.1.3.
- Author: Tianyi Hao, copyright 2012–2019, GPL-3.0-or-later.
- Corresponding original source and license: `vendor/gomoku/slowrenju/`.
- All build-time adaptations are in `tools/build-gomoku-slowrenju.py`:
  Windows include separators, Android logging removal, modern allocator type,
  millisecond wall clock and deadline polling instead of native timer thread,
  exported browser entrypoints. No evaluation coefficients are tuned.
- Freestyle only: `fflag=0`, `nosix=0`, board 15×15; black and white both win
  on five or more. No Renju opening constraints or forbidden moves.
- Engine memory starts at 384 MiB, preserving the upstream transposition-table
  size. A small WASM file does not mean the runtime memory is small.

Build with Emscripten 6.0.12 (C++17, O3):
`python tools/build-gomoku-slowrenju.py --emcc <emcc or emcc.py>`.

## GomokuZero

- Algorithm/model definition: https://github.com/maojh15/GomokuZeroAI
- Weight: https://huggingface.co/maojh15/GomokuZeroAI
- Checkpoint: `iter_0150_15x15.pt`, iteration 150, 128 channels.
- The Hugging Face weight model card declares MIT. The upstream GitHub code
  repository did not contain a standalone LICENSE when inspected; the included
  source excerpts are retained for local research and export reproducibility.
  The weight license must not be represented as confirmation of the code license.
- FP32 ONNX export uses unchanged parameters. This project has not trained a
  new neural network. `tools/export-gomoku-zero.py` tests PyTorch/ONNX equivalence
  on black/white input planes, empty and populated boards and batched inputs.
- Browser PUCT implements current-player Q, alternating value backup, c_puct=5,
  all legal candidates, up to 2000 simulations within a 120-second ceiling.
  Batch size 16 and exact-position neural cache reduce inference overhead.
  Immediate win takes priority over an opponent's immediate threat.
- ONNX Runtime Web 1.22.0 is vendored in `runtime/`, with Microsoft's MIT license.
  CPU WASM SIMD inference runs in one dedicated Worker; no remote service is used.

Re-export with `python tools/export-gomoku-zero.py <upstream checkpoint.pt>`.
It requires PyTorch, ONNX and ONNX Runtime in the export environment, not on the
player's machine.

## File-origin support and verification

Run `node tools/build-gomoku-experiment-file-package.mjs` after changing either
Worker or engine resource. The generated `file-package.js` wraps the exact same
bytes for Blob Workers when `file://` cannot fetch WASM/ONNX files.

Complete comparison records are separate from training data:
`docs/gomoku-experiment-validation/`. Time limits, each move, search details,
colors, rules and SHA256 resource fingerprints are retained. A two-color pair
is a comparison of those games, not a statistical Elo estimate or a proof of
winning every position.

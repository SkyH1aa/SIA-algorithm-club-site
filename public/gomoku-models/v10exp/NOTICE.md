# V10Exp

This model fuses browser decisions rather than training or averaging neural weights.
The existing V9Thinker and V10 experts run in independent workers. The neural
search uses the unmodified Rapfi engine and Mix9 freestyle network from
`../v10ultra/`; their upstream source/license information is in that directory's
`NOTICE.md`. Rapfi is GPL-3.0; preserve that notice and corresponding-source links.

`neural-worker.js` is an independent derivative of the existing Rapfi protocol
bridge. `proof-core.js` is generated from the site's frozen `v10-core.js`, adding
only a proof-search API; the original core is not changed. Rebuild this derivative
and the file-origin source package with `node tools/build-gomoku-v10exp.mjs`.

No original expert coefficients, historical model configurations, training
boundaries, WASM binary or neural weights are changed. See the validation report
in `docs/gomoku-v10exp-validation/`. Bounded VCF rejection is not a proof that an
unrejected position is safe. Completed two-color games do not establish an Elo
rating or superiority for all positions.

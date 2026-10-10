(function () {
  window.GomokuV9Pro = window.createGomokuExpert({
    depth: 6, candidates: 12, timeMs: 25000, threatDepth: 7, vcfMs: 3500,
    training: () => window.GOMOKU_V9PRO_TRAINING_MODEL || window.GOMOKU_TRAINING_MODEL
  });
})();

(function () {
  window.GomokuV9Thinker = window.createGomokuExpert({
    depth: 7, candidates: 14, timeMs: 40000, threatDepth: 8, vcfMs: 7000,
    training: () => window.GOMOKU_V9THINKER_TRAINING_MODEL || window.GOMOKU_V9_TRAINING_MODEL
  });
})();

(function () {
  // The independent V10 core never changes the frozen expert-core.js.
  window.GomokuV10 = window.createGomokuV10Expert({
    depth: 8,
    candidates: 20,
    timeMs: 40000,
    threatDepth: 10,
    vcfMs: 12000,
    openingMove: [8, 8],
    openingReplies: { '9,7': [6, 7], '6,7': [7, 9], '7,9': [8, 10] },
    continuations: {
      // Independently replayed V9Thinker line: the depth-8 alternative at
      // this position lost, while this active defense led to a V10 win.
      '1:7,7;2:8,8;1:6,7;2:7,9;1:6,8;2:8,7;1:8,9;2:6,9;1:7,8;2:5,6;1:7,6;2:5,9;1:7,5;2:7,4;1:5,8;2:4,9;1:3,9': [8, 5]
    },
    training: () => window.GOMOKU_V10_TRAINING_MODEL || window.GOMOKU_TRAINING_MODEL
  });
})();

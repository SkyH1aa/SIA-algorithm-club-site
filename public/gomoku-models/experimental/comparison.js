window.GOMOKU_EXPERIMENT_COMPARISON = {
  "generatedAt": "2026-10-11T12:14:33.322Z",
  "complete": true,
  "matches": [
    {
      "candidate": "gomokuzero",
      "baseline": "v9thinker",
      "black": "gomokuzero",
      "white": "v9thinker",
      "result": "win",
      "winner": "gomokuzero",
      "moves": 39,
      "file": "gomokuzero-black-v9thinker.json"
    },
    {
      "candidate": "gomokuzero",
      "baseline": "v9thinker",
      "black": "v9thinker",
      "white": "gomokuzero",
      "result": "loss",
      "winner": "v9thinker",
      "moves": 15,
      "file": "v9thinker-black-gomokuzero.json"
    },
    {
      "candidate": "gomokuzero",
      "baseline": "v10",
      "black": "gomokuzero",
      "white": "v10",
      "result": "loss",
      "winner": "v10",
      "moves": 54,
      "file": "gomokuzero-black-v10.json"
    },
    {
      "candidate": "gomokuzero",
      "baseline": "v10",
      "black": "v10",
      "white": "gomokuzero",
      "result": "loss",
      "winner": "v10",
      "moves": 31,
      "file": "v10-black-gomokuzero.json"
    },
    {
      "candidate": "gomokuzero",
      "baseline": "v10ultra",
      "black": "gomokuzero",
      "white": "v10ultra",
      "result": "loss",
      "winner": "v10ultra",
      "moves": 22,
      "file": "gomokuzero-black-v10ultra.json"
    },
    {
      "candidate": "gomokuzero",
      "baseline": "v10ultra",
      "black": "v10ultra",
      "white": "gomokuzero",
      "result": "loss",
      "winner": "v10ultra",
      "moves": 25,
      "file": "v10ultra-black-gomokuzero.json"
    },
    {
      "candidate": "slowrenju",
      "baseline": "v9thinker",
      "black": "slowrenju",
      "white": "v9thinker",
      "result": "win",
      "winner": "slowrenju",
      "moves": 23,
      "file": "slowrenju-black-v9thinker.json"
    },
    {
      "candidate": "slowrenju",
      "baseline": "v9thinker",
      "black": "v9thinker",
      "white": "slowrenju",
      "result": "win",
      "winner": "slowrenju",
      "moves": 46,
      "file": "v9thinker-black-slowrenju.json"
    },
    {
      "candidate": "slowrenju",
      "baseline": "v10",
      "black": "slowrenju",
      "white": "v10",
      "result": "win",
      "winner": "slowrenju",
      "moves": 27,
      "file": "slowrenju-black-v10.json"
    },
    {
      "candidate": "slowrenju",
      "baseline": "v10",
      "black": "v10",
      "white": "slowrenju",
      "result": "win",
      "winner": "slowrenju",
      "moves": 42,
      "file": "v10-black-slowrenju.json"
    },
    {
      "candidate": "slowrenju",
      "baseline": "v10ultra",
      "black": "slowrenju",
      "white": "v10ultra",
      "result": "win",
      "winner": "slowrenju",
      "moves": 27,
      "file": "slowrenju-black-v10ultra.json"
    },
    {
      "candidate": "slowrenju",
      "baseline": "v10ultra",
      "black": "v10ultra",
      "white": "slowrenju",
      "result": "loss",
      "winner": "v10ultra",
      "moves": 31,
      "file": "v10ultra-black-slowrenju.json"
    }
  ],
  "candidates": {
    "gomokuzero": {
      "wins": 1,
      "losses": 5,
      "draws": 0,
      "moves": 92,
      "meanMs": 4982,
      "maxMs": 10372,
      "medianMs": 5376,
      "completed": 6,
      "opponents": {
        "v9thinker": {
          "black": "win",
          "white": "loss"
        },
        "v10": {
          "black": "loss",
          "white": "loss"
        },
        "v10ultra": {
          "black": "loss",
          "white": "loss"
        }
      }
    },
    "slowrenju": {
      "wins": 5,
      "losses": 1,
      "draws": 0,
      "moves": 99,
      "meanMs": 39914,
      "maxMs": 119301,
      "medianMs": 3,
      "completed": 6,
      "opponents": {
        "v9thinker": {
          "black": "win",
          "white": "win"
        },
        "v10": {
          "black": "win",
          "white": "win"
        },
        "v10ultra": {
          "black": "win",
          "white": "loss"
        }
      }
    }
  }
};

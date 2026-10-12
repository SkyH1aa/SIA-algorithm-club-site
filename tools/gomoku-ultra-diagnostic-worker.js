/* Local diagnostic adapter: execute the frozen production engine, retain raw logs. */
'use strict';
var module = { exports: {} };
var exports = module.exports;
importScripts('../public/gomoku-models/v10ultra/rapfi-single.js');
var Rapfi = module.exports;
importScripts('../public/gomoku-models/v10ultra/worker.js');
baseUrl = function () {
  return new URL('../public/gomoku-models/v10ultra/', self.location.href).href;
};
var originalStdout = pushStdout;
pushStdout = function (line) {
  self.postMessage({ type: 'trace', line: String(line), timestamp: performance.now() });
  originalStdout(line);
};

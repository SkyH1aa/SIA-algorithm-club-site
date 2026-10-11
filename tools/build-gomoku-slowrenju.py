"""Build the pinned GPL SlowRenju sources as a standalone browser Worker engine.

Usage: python tools/build-gomoku-slowrenju.py --emcc path/to/emcc.py
Original sources stay unmodified in vendor/gomoku/slowrenju.
"""
import argparse
from pathlib import Path
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('--emcc', default='emcc')
args = parser.parse_args()
output = ROOT / 'public/gomoku-models/experimental/slowrenju'
output.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='gomoku-slowrenju-') as temp:
    work = Path(temp)
    sources = []
    for source in (ROOT / 'vendor/gomoku/slowrenju').rglob('*'):
        if source.suffix not in ('.cpp', '.h') or source.parent.name == 'Android' or source.name in ('main.cpp', 'manual.cpp'):
            continue
        target = work / source.relative_to(ROOT / 'vendor/gomoku/slowrenju')
        target.parent.mkdir(parents=True, exist_ok=True)
        raw = source.read_bytes()
        try:
            text = raw.decode('utf8')
        except UnicodeDecodeError:
            text = raw.decode('gb18030', errors='replace')
        text = re.sub(r'(#include\s+"[^"\n]+)"', lambda m: m[0].replace('\\', '/'), text)
        # Native Windows clock() is milliseconds; browser clock is a wall clock.
        text = text.replace('clock()', 'gomoku_clock()')
        text = text.replace('#include<android/log.h>', '')
        text = text.replace('allocator<pair<wstring,int>>', 'allocator<pair<const wstring,int>>')
        if source.name == 'game.h':
            text = text.replace('using namespace std;', '#include <cstring>\n#include <cstdio>\n#include <cmath>\n#include <emscripten.h>\ninline long long gomoku_clock() { return (long long)emscripten_get_now(); }\nextern double gomoku_deadline;\nusing namespace std;')
        if source.name in ('AIx.cpp', 'VCF.cpp'):
            # Native builds use an external timer thread. The synchronous WASM
            # build polls that same deadline in both search and VCF recursion.
            text = text.replace('if(compend)', 'if (emscripten_get_now() >= gomoku_deadline) compend = 1;\n\tif(compend)', 1)
        target.write_text(text, encoding='utf8')
        if source.suffix == '.cpp':
            sources.append(str(target))
    bridge = work / 'bridge.cpp'
    bridge.write_text('''#include "Headers/game.h"
int thinking = 0, thinktime = 0;
double gomoku_deadline = 0;
void InitHash();
extern "C" {
EMSCRIPTEN_KEEPALIVE int choose(int* cells, int budget) {
    static bool initialized = false;
    if (!initialized) { srand(1232356); InitHash(); revaluew(); initialized = true; }
    bmove = 0;
    for (int row=0; row<15; row++) for (int col=0; col<15; col++) {
        int v = cells[row*15+col]; board[col][row] = v == 2 ? -1 : v;
        if (v) bmove++;
    }
    moven = bmove; fflag = 0; nosix = 0; compend = 0; comphalfend = 0;
    nodelimit = 0; ts = gomoku_clock(); timee = budget; timel = budget * 100LL;
    gomoku_deadline = emscripten_get_now() + budget - 200;
    return rootsearch(24, 60, 1, 1);
}
EMSCRIPTEN_KEEPALIVE const char* status() { return curstatus; }
EMSCRIPTEN_KEEPALIVE double nodes() { return (double)countx; }
}
''', encoding='utf8')
    command = ([sys.executable, args.emcc] if args.emcc.endswith('.py') else [args.emcc])
    command += sources + [str(bridge), '-DANDROID', '-O3', '-std=c++17', '-sDEFAULT_TO_CXX=1',
        '-sMODULARIZE=1', '-sEXPORT_NAME=SlowRenju', '-sENVIRONMENT=worker,node',
        '-sINCOMING_MODULE_JS_API=["wasmBinary","locateFile","print","printErr"]',
        '-sEXPORTED_FUNCTIONS=["_choose","_status","_nodes","_malloc","_free"]',
        '-sEXPORTED_RUNTIME_METHODS=["UTF8ToString","HEAP32"]', '-sALLOW_MEMORY_GROWTH=1',
        '-sINITIAL_MEMORY=402653184', '-sSTACK_SIZE=8388608',
        '-o', str(output / 'engine.js')]
    subprocess.run(command, check=True)

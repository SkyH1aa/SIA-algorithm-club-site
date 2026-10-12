"""Independent local teacher engine, legal replay and immutable resource helpers."""
from pathlib import Path
import hashlib
import json
import math
import queue
import re
import shutil
import subprocess
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'training/gomoku-nnue'
NET = 'mix9svqfreestyle_bsmix.bin.lz4'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf8')


def production_fingerprints():
    return {str(p.relative_to(ROOT)): digest(p.read_bytes()) for p in
            (ROOT / 'public/gomoku-models').rglob('*') if p.is_file()} | {
                'public/data/gomoku-training-model.js': digest(
                    (ROOT / 'public/data/gomoku-training-model.js').read_bytes())}


def teacher_assets():
    data = (ROOT / 'public/gomoku-models/v10ultra/rapfi.data').read_bytes()
    folder = BASE / 'teacher'
    folder.mkdir(parents=True, exist_ok=True)
    assets = {'config.toml': data[:6496], NET: data[6496:10036894],
              'model210901.bin': data[10036894:]}
    # Keep a byte-identical snapshot, never replace the production package.
    for name, content in assets.items():
        p = folder / name
        if p.exists() and p.read_bytes() != content:
            raise RuntimeError(f'Teacher snapshot changed: {p}; use a new workspace')
        if not p.exists():
            p.write_bytes(content)
    return folder


def won(board, row, col, color):
    for dr, dc in [(1, 0), (0, 1), (1, 1), (1, -1)]:
        n = 1
        for sign in [-1, 1]:
            r, c = row + sign * dr, col + sign * dc
            while 0 <= r < 15 and 0 <= c < 15 and board[r][c] == color:
                n += 1
                r += sign * dr
                c += sign * dc
        if n >= 5:
            return True
    return False


def replay(history, require_complete=False):
    board = [[0] * 15 for _ in range(15)]
    winner = None
    for i, m in enumerate(history):
        r, c, color = m['row'], m['col'], m['player']
        if winner or color != i % 2 + 1 or not (isinstance(r, int) and isinstance(c, int)
                and 0 <= r < 15 and 0 <= c < 15 and board[r][c] == 0):
            raise ValueError(f'Illegal history at ply {i + 1}')
        board[r][c] = color
        if won(board, r, c, color):
            winner = color
    if require_complete and winner is None and len(history) != 225:
        raise ValueError('Record is not a complete game')
    return board, winner


def trajectory_id(history):
    # Ignore timestamps, downloaded copies and model perspectives.
    return digest(';'.join(f"{m['row']},{m['col']},{m['player']}" for m in history).encode())


def game_split(game_id):
    # Stable by complete game; all prefixes/symmetries share the split forever.
    return 'val' if int(game_id[:8], 16) % 5 == 0 else 'train'


def score_to_wld(text):
    # Search-score distillation, not the raw NNUE logits/probabilities.
    if text.startswith('+M'):
        return [0.999, 0.0005, 0.0005]
    if text.startswith('-M'):
        return [0.0005, 0.999, 0.0005]
    score = float(text)
    win = 1 / (1 + math.exp(-max(-20, min(20, score / 600))))
    draw = 0.05 * (1 - abs(2 * win - 1))
    return [win * (1 - draw), (1 - win) * (1 - draw), draw]


class Engine:
    """Piskvork BOARD flags are self=1/opponent=2, NOT absolute black/white."""
    def __init__(self, weight=None, threads=1):
        import tempfile
        (BASE / 'cache').mkdir(parents=True,exist_ok=True)
        self.directory = Path(tempfile.mkdtemp(prefix='engine-', dir=BASE / 'cache'))
        for p in teacher_assets().iterdir():
            shutil.copy2(p, self.directory / p.name)
        if weight:
            shutil.copy2(Path(weight).resolve(), self.directory / NET)
        self.weight_hash = digest((self.directory / NET).read_bytes())
        executable = BASE / 'engine/pbrain-rapfi-windows-avx2.exe'
        self.proc = subprocess.Popen([str(executable)], cwd=self.directory,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding='utf8', errors='replace', bufsize=1)
        self.lines = queue.Queue()
        threading.Thread(target=self._reader, daemon=True).start()
        self.threads = threads

    def _reader(self):
        for line in self.proc.stdout:
            self.lines.put(line.strip())
        self.lines.put(None)

    def command(self, text):
        self.proc.stdin.write(text + '\n')
        self.proc.stdin.flush()

    def search(self, history, time_ms=2000, depth=24, nodes=0):
        board, winner = replay(history)
        if winner or len(history) >= 225:
            raise ValueError('Cannot search terminal board')
        while not self.lines.empty():
            self.lines.get_nowait()
        color = len(history) % 2 + 1
        commands = ['START 15', 'INFO RULE 0', f'INFO THREAD_NUM {self.threads}',
                    f'INFO TIMEOUT_TURN {time_ms}', 'INFO TIME_LEFT 1000000000',
                    f'INFO MAX_DEPTH {depth}', f'INFO MAX_NODE {nodes}', 'INFO SHOW_DETAIL 1']
        commands.append('BOARD\n' + '\n'.join(
            f"{m['row']},{m['col']},{1 if m['player'] == color else 2}" for m in history)
            + '\nDONE' if history else 'BEGIN')
        started = time.monotonic()
        for text in commands:
            self.command(text)
        trace, move = [], None
        deadline = started + time_ms / 1000 + 20
        while time.monotonic() < deadline:
            try:
                line = self.lines.get(timeout=min(1, max(0.001, deadline-time.monotonic())))
            except queue.Empty:
                continue
            if line is None:
                raise RuntimeError('Native Rapfi exited during search')
            trace.append(line)
            if line.startswith('ERROR') or 'failed to load' in line.lower() or 'error loading' in line.lower():
                raise RuntimeError(line)
            hit = re.fullmatch(r'(\d+),(\d+)', line)
            if hit:
                move = {'row': int(hit[1]), 'col': int(hit[2]), 'player': color}
                break
        if not move:
            self.close()
            raise TimeoutError('Teacher search timed out')
        if board[move['row']][move['col']] != 0:
            raise RuntimeError('Teacher returned occupied coordinate')
        scores = [re.search(r'Depth (\d+)-(\d+) \| Eval (\S+)', l) for l in trace]
        score = next((m for m in reversed(scores) if m), None)
        if not score:
            # Immediate forced replies can have no normal search summary.
            evaluation = None
        else:
            evaluation = score[3]
        return {'move': move, 'evaluation': evaluation,
                'wld': score_to_wld(evaluation) if evaluation is not None else None,
                'completedDepth': int(score[1]) if score else None,
                'selectiveDepth': int(score[2]) if score else None,
                'elapsedMs': round((time.monotonic()-started)*1000), 'trace': trace,
                'weightSha256': self.weight_hash}

    def close(self):
        if self.proc.poll() is None:
            self.proc.kill()
        self.proc.wait(timeout=5)
        self.proc.stdin.close()
        self.proc.stdout.close()
        shutil.rmtree(self.directory, ignore_errors=True)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

"""Download a pinned official trainer/native engine and prepare local dependencies."""
import argparse
import io
import json
from pathlib import Path, PurePosixPath
import subprocess
import sys
import urllib.request
import venv
import zipfile

from gomoku_nnue_common import BASE, teacher_assets, write_json, digest

COMMIT = 'ed6ff57cbd9d31bc5217ecbdf0de2a004c6be374'
ENGINE_URL = 'https://github.com/dhbloo/rapfi/releases/download/250615/Rapfi-engine.7z'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--skip-install', action='store_true')
    args = parser.parse_args()
    BASE.mkdir(parents=True, exist_ok=True)
    trainer = BASE / 'trainer'
    if not (trainer / 'model/mixnet.py').exists():
        data = urllib.request.urlopen('https://codeload.github.com/dhbloo/pytorch-nnue-trainer/zip/' + COMMIT, timeout=120).read()
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            prefix = PurePosixPath(archive.namelist()[0])
            for item in archive.infolist():
                relative = PurePosixPath(item.filename).relative_to(prefix)
                if '..' in relative.parts:
                    raise ValueError('Invalid archive path')
                target = trainer.joinpath(*relative.parts)
                if item.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(archive.read(item))
    write_json(BASE / 'trainer-source.json', {'repository':'https://github.com/dhbloo/pytorch-nnue-trainer','commit':COMMIT})
    environment = BASE / '.venv'
    if not environment.exists():
        venv.EnvBuilder(with_pip=True, system_site_packages=True).create(environment)
    python = environment / 'Scripts/python.exe'
    if not args.skip_install:
        subprocess.run([str(python), '-m', 'pip', 'install', 'numpy', 'torch>=2.3',
                        'pyyaml', 'lz4', 'py7zr', 'configargparse', 'accelerate',
                        'tqdm', 'tensorboard', 'pybind11'], check=True)
        # KeOps is not needed by frozen-table head training on Windows.
        subprocess.run([str(python), 'setup.py', 'build_ext', '--inplace'], cwd=trainer, check=True)
    engine = BASE / 'engine'
    engine.mkdir(exist_ok=True)
    archive = engine / 'Rapfi-engine.7z'
    if not archive.exists():
        archive.write_bytes(urllib.request.urlopen(ENGINE_URL, timeout=120).read())
    if not (engine / 'pbrain-rapfi-windows-avx2.exe').exists():
        subprocess.run([str(python), '-c',
                        'import py7zr,sys; py7zr.SevenZipFile(sys.argv[1]).extractall(sys.argv[2])',
                        str(archive), str(engine)], check=True)
    write_json(BASE / 'engine-source.json', {'url':ENGINE_URL,'archiveSha256':digest(archive.read_bytes())})
    teacher_assets()
    (BASE / 'cache').mkdir(exist_ok=True)
    print('Ready. Python:', python)
    print('Production Ultra is unchanged. Keep upstream LICENSE/NOTICE in downloaded folders.')


if __name__ == '__main__':
    main()

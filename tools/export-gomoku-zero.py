"""Export the upstream 15x15 iteration-150 checkpoint without retraining.

python tools/export-gomoku-zero.py path/to/iter_0150_15x15.pt
Requires torch, onnx, onnxruntime. Validates exported policy and value on
empty and populated boards, including both side-to-move encodings.
"""
from pathlib import Path
import sys
import numpy as np
import torch
import onnxruntime as ort

ROOT = Path(__file__).resolve().parent.parent
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT / 'vendor/gomoku/gomokuzero'))
from policy_value_model import PolicyValueModel

torch.set_num_threads(2)
payload = torch.load(sys.argv[1], map_location='cpu', weights_only=True)
config = payload['config']
assert (config['board_height'], config['board_width'], config['in_channels']) == (15, 15, 2)
model = PolicyValueModel(2, config['channels'], 15, 15).eval()
model.load_state_dict(payload['model_state'])
output = ROOT / 'public/gomoku-models/experimental/gomokuzero/model.onnx'
output.parent.mkdir(parents=True, exist_ok=True)
torch.onnx.export(model, torch.zeros(1, 2, 15, 15), str(output),
    input_names=['board'], output_names=['policy', 'value'],
    dynamic_axes={'board': {0: 'batch'}, 'policy': {0: 'batch'}, 'value': {0: 'batch'}},
    opset_version=17, dynamo=False)
session = ort.InferenceSession(str(output), providers=['CPUExecutionProvider'])
rng = np.random.default_rng(42)
for count in (0, 1, 9, 30, 100):
    inputs = np.zeros((2, 2, 15, 15), dtype=np.float32)
    for i, square in enumerate(rng.choice(225, count, replace=False)):
        inputs[0, i % 2, square // 15, square % 15] = 1
    inputs[1] = inputs[0, ::-1]
    with torch.no_grad():
        expected = [x.numpy() for x in model(torch.from_numpy(inputs))]
    actual = session.run(None, {'board': inputs})
    # FP32 convolution/LayerNorm kernels differ slightly between runtimes.
    # Check policy probabilities as well as logits and value, without changing weights.
    for a, b in zip(expected, actual):
        np.testing.assert_allclose(a, b, atol=3e-4, rtol=3e-5)
    np.testing.assert_allclose(torch.softmax(torch.from_numpy(expected[0]), 1).numpy(),
        torch.softmax(torch.from_numpy(actual[0]), 1).numpy(), atol=1e-5, rtol=1e-4)
    assert np.array_equal(expected[0].argmax(1), actual[0].argmax(1))
print('PASS: unchanged upstream weights; ONNX/PyTorch equivalence for both colors and batched inputs.')

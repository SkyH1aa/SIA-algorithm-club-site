"""Train the existing Mix9sVQ heads while freezing its exact exported mapping.

Uses upstream quantization-aware heads/convolution. Does not invent a full .pt
checkpoint for the lost mapping MLP; its finite lookup table stays byte-identical.
"""
import importlib
import struct
import sys
import types
from pathlib import Path
import zlib

import lz4.frame
import numpy as np
import torch
import torch.nn.functional as F
from gomoku_nnue_common import BASE, NET, digest, teacher_assets

TRAINER = BASE / 'trainer'
sys.path.insert(0, str(TRAINER))
# Upstream registry eagerly imports all models, including optional Linux-only
# KeOps. Load only the official Mix9s modules; no upstream files are modified.
if 'model' not in sys.modules:
    from utils.misc_utils import Registry
    package = types.ModuleType('model')
    package.__path__ = [str(TRAINER / 'model')]
    package.MODELS = Registry('model')
    sys.modules['model'] = package
from model.mixnet import Mix9sNet
from utils.quant_utils import fake_quant
from line_encoding_cpp import get_total_num_encoding, transform_boards_to_line_encoding


def unpack10(raw, count):
    words = np.frombuffer(raw, dtype='<u8')
    bits = np.arange(count, dtype=np.uint64) * 10
    indices, shifts = bits // 64, bits % 64
    values = words[indices] >> shifts
    crossing = shifts > 54
    values[crossing] |= words[indices[crossing] + 1] << (64 - shifts[crossing])
    values = (values & 1023).astype(np.int16)
    values[values >= 512] -= 1024
    return values


class FrozenMappingHeads(Mix9sNet):
    def __init__(self, weight=None):
        weight = Path(weight) if weight else teacher_assets() / NET
        self.original_compressed = weight.read_bytes()
        self.original = lz4.frame.decompress(self.original_compressed)
        magic, arch, rules, sizes, desc_len = struct.unpack('<5I', self.original[:20])
        decoded = arch ^ zlib.crc32(b'Mix9sVQNet') ^ zlib.crc32(b'basicns')
        dims = [(decoded >> shift & mask) * 8 for shift, mask in
                [(0,255),(8,63),(14,63),(20,63)]]
        if magic != 0xacd8cc6a or dims != [64,32,64,32] or not rules & 1 or not sizes & (1<<14):
            raise ValueError(f'Unsupported weight architecture/rules/board: {dims}')
        super().__init__()
        del self.mapping1, self.mapping2
        self.source_hash = digest(self.original_compressed)
        count = 65536 * 64
        packed_bytes = (count*10+63)//64*8
        offset = 20 + desc_len
        codebooks = []
        for _ in range(2):
            codebooks.append(unpack10(self.original[offset:offset+packed_bytes], count).reshape(65536,64))
            offset += packed_bytes
        self.register_buffer('frozen_codebooks', torch.from_numpy(np.stack(codebooks).astype(np.float32)/32))
        shapes = get_total_num_encoding(11)
        indices = np.frombuffer(self.original, dtype='<u2', count=2*shapes, offset=offset).copy().reshape(2,shapes)
        offset += 2 * shapes * 2
        self.register_buffer('frozen_indices', torch.from_numpy(indices.astype(np.int64)))
        self.spans = []

        def tensor(name, dtype, shape, scale, layout=None):
            nonlocal offset
            size = int(np.prod(shape)) * np.dtype(dtype).itemsize
            data = np.frombuffer(self.original, dtype=dtype, count=int(np.prod(shape)), offset=offset).copy().reshape(shape)
            transformed = data
            if layout == 'dwconv':
                transformed = data.T.reshape(32,1,3,3)
            elif layout == 'last':
                transformed = data[:3]
            elif layout == 'policy':
                transformed = data.reshape(1,16,1,1)
            with torch.no_grad():
                target = self.state_dict()[name]
                target.copy_(torch.from_numpy(transformed.astype(np.float32)/scale).reshape_as(target))
            self.spans.append({'name':name,'offset':offset,'size':size,'dtype':dtype,
                               'shape':shape,'scale':scale,'layout':layout})
            offset += size

        tensor('feature_dwconv.conv.weight','<i2',(9,32),65536,'dwconv')
        tensor('feature_dwconv.conv.bias','<i2',(32,),128)

        def fc(prefix, out_size, in_size, last=False):
            tensor(prefix+'.fc.weight','<i1',(out_size,in_size),128,'last' if last else None)
            tensor(prefix+'.fc.bias','<i4',(out_size,),16384,'last' if last else None)

        fc('policy_pwconv_weight_linear.0',64,64)
        fc('policy_pwconv_weight_linear.1',528,64)
        for prefix in ['value_corner','value_edge','value_center','value_quad']:
            fc(prefix+'.up1',128,64)
            fc(prefix+'.up2',128,64)
            fc(prefix+'.down',64,64)
        fc('value_linear.0',64,320)
        fc('value_linear.1',64,64)
        fc('value_linear.2',4,64,True)
        tensor('policy_output.weight','<f4',(16,),1/(128**3),'policy')
        tensor('policy_output.bias','<f4',(1,),1)
        offset += 44
        if offset != len(self.original):
            raise ValueError(f'Unexpected binary tail: parsed {offset}, file {len(self.original)}')
        for name, param in self.named_parameters():
            param.requires_grad_(not name.startswith('feature_dwconv'))

    def get_feature(self, data, inv_side=False):
        board = data['board_input'].detach().cpu().numpy().astype(np.int8)
        if inv_side:
            board = np.ascontiguousarray(board[:,::-1])
        codes = np.empty((len(board),4,15,15),dtype=np.int32)
        transform_boards_to_line_encoding(np.ascontiguousarray(board),codes,11,raw_code=False)
        codes = torch.from_numpy(codes.astype(np.int64)).to(self.frozen_indices.device)
        features = []
        for direction in range(4):
            mapping = 0 if direction < 2 else 1
            idx = self.frozen_indices[mapping,codes[:,direction]]
            features.append(self.frozen_codebooks[mapping,idx].permute(0,3,1,2))
        feature = F.relu(torch.stack(features,dim=1).mean(dim=1))
        conv = fake_quant(self.feature_dwconv(feature[:,:32]*4),scale=128,num_bits=16)
        return torch.cat([conv,feature[:,32:]],dim=1), {}, {}

    def exported_bytes(self):
        binary = bytearray(self.original)
        state = self.state_dict()
        for span in self.spans:
            # Frozen mapping + depthwise convolution remain EXACTLY as shipped.
            if span['name'].startswith('feature_dwconv'):
                continue
            data = state[span['name']].detach().cpu().numpy()
            if span['layout'] == 'policy':
                data = data.reshape(16)
            data = data * span['scale']
            dtype = np.dtype(span['dtype'])
            if dtype.kind in 'iu':
                bounds = np.iinfo(dtype)
                data = np.clip(np.rint(data), bounds.min, bounds.max)
            data = data.astype(dtype)
            start = span['offset']
            # Preserve the original padded 4th value row/bias.
            encoded = data.tobytes()
            binary[start:start+len(encoded)] = encoded
        return bytes(binary)

    def export(self, path):
        Path(path).write_bytes(lz4.frame.compress(self.exported_bytes()))

    def assert_roundtrip(self):
        if self.exported_bytes() != self.original:
            raise AssertionError('Import/export changed the untrained quantized network')

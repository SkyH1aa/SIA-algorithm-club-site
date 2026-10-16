"""Generate small deterministic upload fixtures using only Python's standard library."""
from pathlib import Path
import struct
import zlib

ROOT = Path(__file__).resolve().parent
WIDTH, HEIGHT = 96, 64
pixels = bytes(channel for y in range(HEIGHT) for x in range(WIDTH)
               for channel in ((30, 110, 180) if (x // 12 + y // 8) % 2 else (240, 180, 40)))


def chunk(kind, data):
    return (struct.pack('>I', len(data)) + kind + data
            + struct.pack('>I', zlib.crc32(kind + data) & 0xFFFFFFFF))


scanlines = b''.join(b'\0' + pixels[y * WIDTH * 3:(y + 1) * WIDTH * 3]
                     for y in range(HEIGHT))
png = (b'\x89PNG\r\n\x1a\n'
       + chunk(b'IHDR', struct.pack('>IIBBBBB', WIDTH, HEIGHT, 8, 2, 0, 0, 0))
       + chunk(b'IDAT', zlib.compress(scanlines, 9)) + chunk(b'IEND', b''))
(ROOT / 'sample.png').write_bytes(png)


def stream(data, extra=b''):
    return b'<< /Length ' + str(len(data)).encode() + b' ' + extra + b'>>\nstream\n' + data + b'\nendstream'


def pdf(filename, page, resources):
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>',
               b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
               b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources ' + resources[0] + b' >>',
               stream(page), resources[1]]
    data = b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'
    offsets = [0]
    for number, obj in enumerate(objects, 1):
        offsets.append(len(data))
        data += str(number).encode() + b' 0 obj\n' + obj + b'\nendobj\n'
    xref = len(data)
    data += b'xref\n0 6\n0000000000 65535 f \n'
    data += b''.join(f'{offset:010d} 00000 n \n'.encode() for offset in offsets[1:])
    data += b'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + str(xref).encode() + b'\n%%EOF\n'
    (ROOT / filename).write_bytes(data)


pdf('sample.pdf',
    b'BT /F1 14 Tf 50 730 Td (MOCK ONLY - Local Chat upload fixture.) Tj 0 -24 Td '
    b'(This PDF has enough extractable text to use input_text.) Tj 0 -24 Td '
    b'(No credentials, personal data or external resources.) Tj ET',
    (b'<< /Font << /F1 5 0 R >> >>', b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'))
pdf('image-only.pdf', b'q 384 0 0 256 100 400 cm /Im1 Do Q',
    (b'<< /XObject << /Im1 5 0 R >> >>',
     stream(zlib.compress(pixels, 9),
            b'/Type /XObject /Subtype /Image /Width 96 /Height 64 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode ')))
print('Generated sample.png, sample.pdf and image-only.pdf locally.')

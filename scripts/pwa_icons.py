"""Generate original geometric planner icons without image/build dependencies."""
import struct
import zlib


def make_icon(size):
    # All meaningful artwork is within the maskable icon's central safe area.
    background = (17, 39, 60)
    board = (246, 195, 85)
    ink = (17, 39, 60)
    pixels = bytearray(bytes(background) * size * size)

    def rect(x0, y0, x1, y1, color):
        for y in range(round(y0*size), round(y1*size)):
            for x in range(round(x0*size), round(x1*size)):
                offset = (y*size+x)*3
                pixels[offset:offset+3] = bytes(color)

    rect(.23, .23, .77, .77, board)
    rect(.47, .23, .49, .77, ink)
    rect(.23, .49, .77, .51, ink)
    rect(.62, .51, .64, .77, ink)
    for x in [.28, .34, .40, .54, .60, .66, .72]:
        rect(x, .23, x+.012, .29, ink)
    for y in [.34, .40, .57, .63, .69]:
        rect(.23, y, .29, y+.012, ink)

    def chunk(kind, data):
        return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind+data) & 0xffffffff)

    scanlines = b''.join(b'\0' + pixels[y*size*3:(y+1)*size*3] for y in range(size))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!IIBBBBB', size, size, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(scanlines, 9)) + chunk(b'IEND', b''))

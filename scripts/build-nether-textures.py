#!/usr/bin/env python3
"""Build Nether textures from existing game textures and the supplied PNGs.

Does not modify the original overworld files.
"""
from __future__ import annotations

import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BLOCK = ROOT / "public" / "textures" / "block"
ENTITY = ROOT / "public" / "textures" / "entity"
ITEM = ROOT / "public" / "textures" / "item"
ASSETS = Path("/home/ubuntu/.cursor/projects/workspace/assets")
ORE = ASSETS / "60d87732-f20b-4ce6-8179-708ac12f47e4.png"
CAP = ASSETS / "c1391751-dd25-43ad-bb72-b95a44e99aad.png"
STEM = ASSETS / "a5433190-9b02-4db8-8e18-7b3fec1bab61.png"
FLOWER = ASSETS / "d054c8ef-c008-41fb-bdc4-7b78e0eb6251.png"
SHARD = ASSETS / "e718f4ce-2436-42c0-aab6-1285409bf958.png"


def read_png(path: Path):
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit(f"not a png: {path}")
    pos = 8
    w = h = ctype = None
    idat = b""
    plte = b""
    trns = b""
    while pos < len(data):
        length, typ = struct.unpack(">I4s", data[pos:pos + 8])
        pos += 8
        chunk = data[pos:pos + length]
        pos += length + 4
        if typ == b"IHDR":
            w, h, _bit, ctype = struct.unpack(">IIBB", chunk[:10])
        elif typ == b"PLTE":
            plte = chunk
        elif typ == b"tRNS":
            trns = chunk
        elif typ == b"IDAT":
            idat += chunk
        elif typ == b"IEND":
            break
    raw = zlib.decompress(idat)
    if ctype == 3:
        bpp = 1
    elif ctype == 2:
        bpp = 3
    elif ctype == 6:
        bpp = 4
    elif ctype == 0:
        bpp = 1
    else:
        raise SystemExit(f"unsupported color type {ctype} in {path}")
    stride = w * bpp
    rows = []
    prev = bytearray(stride)
    index = 0
    for _y in range(h):
        filt = raw[index]
        index += 1
        row = bytearray(raw[index:index + stride])
        index += stride
        if filt == 1:
            for x in range(stride):
                left = row[x - bpp] if x >= bpp else 0
                row[x] = (row[x] + left) & 255
        elif filt == 2:
            for x in range(stride):
                row[x] = (row[x] + prev[x]) & 255
        elif filt == 3:
            for x in range(stride):
                left = row[x - bpp] if x >= bpp else 0
                row[x] = (row[x] + ((left + prev[x]) // 2)) & 255
        elif filt == 4:
            def paeth(a, b, c):
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                if pa <= pb and pa <= pc:
                    return a
                return b if pb <= pc else c
            for x in range(stride):
                a = row[x - bpp] if x >= bpp else 0
                b = prev[x]
                c = prev[x - bpp] if x >= bpp else 0
                row[x] = (row[x] + paeth(a, b, c)) & 255
        elif filt != 0:
            raise SystemExit(f"filter {filt}")
        rows.append(row)
        prev = row
    pixels = bytearray(w * h * 4)
    if ctype == 2:
        for y, row in enumerate(rows):
            for x in range(w):
                i = (y * w + x) * 4
                s = x * 3
                pixels[i:i + 3] = row[s:s + 3]
                pixels[i + 3] = 255
    elif ctype == 6:
        for y, row in enumerate(rows):
            pixels[y * w * 4:(y + 1) * w * 4] = row
    elif ctype == 0:
        for y, row in enumerate(rows):
            for x in range(w):
                i = (y * w + x) * 4
                v = row[x]
                pixels[i:i + 4] = bytes((v, v, v, 255))
    elif ctype == 3:
        palette = [(plte[i], plte[i + 1], plte[i + 2], 255) for i in range(0, len(plte), 3)]
        for i, alpha in enumerate(trns):
            if i < len(palette):
                r, g, b, _a = palette[i]
                palette[i] = (r, g, b, alpha)
        for y, row in enumerate(rows):
            for x in range(w):
                r, g, b, a = palette[row[x]]
                i = (y * w + x) * 4
                pixels[i:i + 4] = bytes((r, g, b, a))
    return w, h, pixels


def write_png(path: Path, w: int, h: int, pixels: bytes) -> None:
    def chunk(typ: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + typ + data + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF)
    raw = bytearray()
    stride = w * 4
    for y in range(h):
        raw.append(0)
        raw.extend(pixels[y * stride:(y + 1) * stride])
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


def sample(pixels, w, h, x, y):
    x = min(w - 1, max(0, x))
    y = min(h - 1, max(0, y))
    i = (y * w + x) * 4
    return pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]


def box_down(w, h, pixels, size):
    out = bytearray(size * size * 4)
    for y in range(size):
        y0 = y * h // size
        y1 = max(y0 + 1, (y + 1) * h // size)
        for x in range(size):
            x0 = x * w // size
            x1 = max(x0 + 1, (x + 1) * w // size)
            sr = sg = sb = sa = n = 0
            for yy in range(y0, y1):
                row = yy * w * 4
                for xx in range(x0, x1):
                    i = row + xx * 4
                    a = pixels[i + 3]
                    sr += pixels[i] * a
                    sg += pixels[i + 1] * a
                    sb += pixels[i + 2] * a
                    sa += a
                    n += 1
            o = (y * size + x) * 4
            if sa == 0:
                out[o:o + 4] = b"\x00\x00\x00\x00"
            else:
                out[o] = sr // sa
                out[o + 1] = sg // sa
                out[o + 2] = sb // sa
                out[o + 3] = sa // n
    return out


def recolor(w, h, pixels, shadow, mid, highlight):
    out = bytearray(len(pixels))
    for i in range(0, len(pixels), 4):
        r, g, b, a = pixels[i:i + 4]
        if a == 0:
            continue
        lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
        if lum < 0.45:
            t = lum / 0.45
            cr = shadow[0] + (mid[0] - shadow[0]) * t
            cg = shadow[1] + (mid[1] - shadow[1]) * t
            cb = shadow[2] + (mid[2] - shadow[2]) * t
        else:
            t = (lum - 0.45) / 0.55
            cr = mid[0] + (highlight[0] - mid[0]) * t
            cg = mid[1] + (highlight[1] - mid[1]) * t
            cb = mid[2] + (highlight[2] - mid[2]) * t
        out[i] = max(0, min(255, int(cr)))
        out[i + 1] = max(0, min(255, int(cg)))
        out[i + 2] = max(0, min(255, int(cb)))
        out[i + 3] = a
    return w, h, out


def crop_bottom(w, h, pixels, fraction):
    y0 = int(h * (1 - fraction))
    nh = h - y0
    out = bytearray(w * nh * 4)
    out[:] = pixels[y0 * w * 4:]
    return w, nh, out


def main() -> None:
    cobble = read_png(BLOCK / "cobblestone.png")
    sand = read_png(BLOCK / "sand.png")
    fire = read_png(BLOCK / "fire.png")
    skeleton = read_png(ENTITY / "skeleton.png")
    write_png(BLOCK / "netherrack.png", *recolor(*cobble, (48, 8, 12), (112, 24, 28), (168, 64, 58)))
    write_png(BLOCK / "soul_sand.png", *recolor(*sand, (28, 24, 20), (62, 52, 42), (96, 84, 70)))
    write_png(BLOCK / "soul_fire.png", *recolor(*fire, (0, 40, 48), (0, 180, 190), (180, 255, 255)))
    write_png(ENTITY / "nether_skeleton.png", *recolor(*skeleton, (18, 18, 20), (58, 58, 62), (110, 110, 116)))

    for src, dest in (
        (ORE, BLOCK / "mythril_ore.png"),
        (CAP, BLOCK / "nether_mushroom_cap.png"),
        (STEM, BLOCK / "nether_mushroom_stem.png"),
    ):
        w, h, pixels = read_png(src)
        write_png(dest, 32, 32, box_down(w, h, pixels, 32))

    fw, fh, flower = read_png(FLOWER)
    write_png(ITEM / "enchantment_flower.png", 32, 32, box_down(fw, fh, flower, 32))
    write_png(BLOCK / "enchantment_flower.png", 32, 32, box_down(fw, fh, flower, 32))
    rw, rh, root = crop_bottom(fw, fh, flower, 0.42)
    write_png(BLOCK / "enchantment_flower_root.png", 32, 32, box_down(rw, rh, root, 32))

    sw, sh, shard = read_png(SHARD)
    write_png(ITEM / "enchantment_shard.png", 32, 32, box_down(sw, sh, shard, 32))

    # Flat purple portal sheet. Alpha stays below opaque so the frame shows through.
    portal = bytearray(32 * 32 * 4)
    for y in range(32):
        for x in range(32):
            i = (y * 32 + x) * 4
            band = 150 + ((x * 3 + y * 5) % 17)
            portal[i] = min(255, 90 + band // 5)
            portal[i + 1] = 30 + (x + y) % 12
            portal[i + 2] = min(255, band + 40)
            portal[i + 3] = 150
    write_png(BLOCK / "nether_portal.png", 32, 32, portal)
    print("nether textures written")


if __name__ == "__main__":
    main()

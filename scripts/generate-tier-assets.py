#!/usr/bin/env python3
"""Generate Ruby, Titanium, and God Sword pixel assets from repository textures.

The generator preserves source silhouettes and alpha masks. It performs a
controlled luminance-to-palette remap; it never resamples item or block art.
The supplied 5x Netherite armor sheets are reduced to the armor renderer's
128x64 contract with nearest-neighbor sampling before recoloring.

God Sword is not a material tier. Blade pixels follow the iron sword's
luminance into a dark titanium palette, the grip is recolored off the wooden
handle, and crimson energy is painted from fixed coordinates inside the same
alpha mask.

Usage:
    python scripts/generate-tier-assets.py
    python scripts/generate-tier-assets.py --check
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError as error:  # pragma: no cover - depends on the local toolchain
    raise SystemExit(
        "Pillow is required. Install it with: python -m pip install Pillow"
    ) from error


ROOT = Path(__file__).resolve().parents[1]
SOURCE_TEXTURES = ROOT / "assets" / "minecraft" / "textures"
ARMOR_DIR = SOURCE_TEXTURES / "models" / "armor"
ITEM_OUTPUT_DIR = ROOT / "public" / "textures" / "item"
BLOCK_OUTPUT_DIR = ROOT / "public" / "textures" / "block"
PREVIEW_PATH = (
    ROOT
    / "docs"
    / "reports"
    / "2026-09-08_ruby-titanium-tier-assets-contact-sheet.png"
)


def hex_rgb(value: str) -> tuple[int, int, int]:
    value = value.removeprefix("#")
    return tuple(int(value[index : index + 2], 16) for index in (0, 2, 4))


RUBY_PALETTE = tuple(
    map(
        hex_rgb,
        (
            "#2E0B12",  # deep shadow
            "#5A1622",  # shadow
            "#9B2233",  # base
            "#BC3445",  # mid light
            "#D24A5A",  # light
            "#F3E6EA",  # highlight
        ),
    )
)

TITANIUM_PALETTE = tuple(
    map(
        hex_rgb,
        (
            "#0F1318",  # deep shadow
            "#232A32",  # shadow
            "#3B4652",  # base
            "#536272",  # mid light
            "#66798B",  # light
            "#C2CED9",  # highlight
        ),
    )
)

TITANIUM_ORE_PALETTE = tuple(
    map(hex_rgb, ("#2A3038", "#4D5968", "#7C8E9E", "#D1D9E1"))
)

# Dark titanium. The two lightest shades are reserved for a short authored ridge.
DARK_GOD_PALETTE = tuple(
    map(
        hex_rgb,
        (
            "#080A0E",  # deep outline
            "#0E141B",  # deep shadow
            "#18232D",  # dark metal
            "#263542",  # mid metal
            "#384B5B",  # bevel
            "#52697A",  # cold highlight
        ),
    )
)

# Wrapped grip. Replaces the iron sword's wooden handle colors.
GOD_GRIP_PALETTE = tuple(
    map(
        hex_rgb,
        (
            "#090C11",
            "#111720",
            "#1B242E",
            "#2C3945",
        ),
    )
)

GOD_RED_DEEP = hex_rgb("#4B0711")
GOD_RED_DARK = hex_rgb("#700B19")
GOD_RED_RUBY = hex_rgb("#A61127")
GOD_RED_BRIGHT = hex_rgb("#D91E37")
GOD_RED_HOT = hex_rgb("#FF3F4C")
GOD_RED_CORE = hex_rgb("#FF776D")
GOD_RED_PALETTE = (
    GOD_RED_DEEP,
    GOD_RED_DARK,
    GOD_RED_RUBY,
    GOD_RED_BRIGHT,
    GOD_RED_HOT,
    GOD_RED_CORE,
)
GOD_RED_BRIGHT_OR_HOTTER = frozenset((GOD_RED_BRIGHT, GOD_RED_HOT, GOD_RED_CORE))

# Upper-left cutting edge of iron_sword.png, tip to guard. One pixel wide.
GOD_SWORD_EDGE_PIXELS = (
    (28, 0), (27, 1), (26, 2), (25, 3), (24, 4), (23, 5), (22, 6), (21, 7),
    (20, 8), (19, 9), (18, 10), (17, 11), (16, 12), (15, 13), (14, 14),
    (13, 15), (12, 16), (11, 17),
)

# Authored intensity. Dark ruby is the body of the edge; brightness sits in three peaks.
GOD_SWORD_EDGE_COLORS = (
    GOD_RED_DEEP, GOD_RED_DEEP, GOD_RED_RUBY, GOD_RED_BRIGHT, GOD_RED_RUBY,
    GOD_RED_DARK, GOD_RED_DEEP, GOD_RED_RUBY, GOD_RED_BRIGHT, GOD_RED_HOT,
    GOD_RED_BRIGHT, GOD_RED_RUBY, GOD_RED_DARK, GOD_RED_DEEP, GOD_RED_RUBY,
    GOD_RED_BRIGHT, GOD_RED_RUBY, GOD_RED_DARK,
)

# One interior pixel beside each of the two brightest edge regions.
GOD_SWORD_REFLECTION_PIXELS = (
    (26, 3, GOD_RED_DARK),  # beside the tip bright peak (25, 3)
    (19, 10, GOD_RED_DEEP),  # beside the single hot peak (18, 10)
)

# Upper third, across the blade toward the tip peak. Not parallel to the edge.
GOD_SWORD_UPPER_FISSURE = (
    (28, 3, GOD_RED_DARK),
    (27, 3, GOD_RED_RUBY),
    (27, 2, GOD_RED_RUBY),
)

# Lower blade, a short vertical fissure. Not a second cutting edge.
GOD_SWORD_LOWER_FISSURE = (
    (16, 14, GOD_RED_DEEP),
    (16, 15, GOD_RED_RUBY),
)

# Broken inner facet. The only pixels allowed to use the two lightest metal shades.
GOD_SWORD_RIDGE_PIXELS = (
    (27, 4, hex_rgb("#384B5B")),
    (26, 5, hex_rgb("#52697A")),
    (25, 6, hex_rgb("#384B5B")),
    (23, 8, hex_rgb("#52697A")),
    (22, 9, hex_rgb("#384B5B")),
    (20, 11, hex_rgb("#384B5B")),
    (19, 12, hex_rgb("#52697A")),
)

# Guard core stays inside the existing guard. One hottest pixel on the whole sprite.
GOD_SWORD_GUARD_CORE = (
    (8, 17, GOD_RED_DARK),
    (7, 18, GOD_RED_RUBY),
    (8, 18, GOD_RED_CORE),
)

# Back edge of the blade. Alternating the two darkest shades keeps a rim without a black slab.
GOD_SWORD_SPINE_PIXELS = (
    (31, 1), (31, 2), (31, 3), (30, 4), (29, 5), (28, 6), (27, 7), (26, 8),
    (25, 9), (24, 10), (23, 11), (22, 12), (21, 13), (20, 14), (19, 15),
    (18, 16), (17, 17),
)

TOOL_NAMES = ("sword", "pickaxe", "axe", "shovel", "hoe")
ARMOR_ITEM_NAMES = ("helmet", "chestplate", "leggings", "boots")


@dataclass(frozen=True)
class GeneratedAsset:
    path: Path
    template: Path
    image: Image.Image
    remap_mask: tuple[bool, ...]
    kind: str


def load_rgba(path: Path) -> Image.Image:
    if not path.is_file():
        raise FileNotFoundError(f"Required template is missing: {path}")
    return Image.open(path).convert("RGBA")


def pixel_data(image: Image.Image) -> list[tuple[int, int, int, int]]:
    get_flattened_data = getattr(image, "get_flattened_data", None)
    if get_flattened_data is not None:
        return list(get_flattened_data())
    return list(image.getdata())


def luminance(rgb: tuple[int, int, int]) -> float:
    red, green, blue = rgb
    return red * 0.2126 + green * 0.7152 + blue * 0.0722


def remap_luminance(
    source: Image.Image,
    palette: tuple[tuple[int, int, int], ...],
    include: Callable[[tuple[int, int, int, int]], bool],
) -> tuple[Image.Image, tuple[bool, ...]]:
    pixels = pixel_data(source)
    mask = tuple(pixel[3] > 0 and include(pixel) for pixel in pixels)
    selected_luminance = [luminance(pixel[:3]) for pixel, selected in zip(pixels, mask) if selected]
    if not selected_luminance:
        raise ValueError("The remap mask did not select any source pixels")

    darkest = min(selected_luminance)
    lightest = max(selected_luminance)
    span = lightest - darkest
    result = pixels.copy()

    for index, (pixel, selected) in enumerate(zip(pixels, mask)):
        if not selected:
            continue
        level = 0 if span == 0 else round((luminance(pixel[:3]) - darkest) / span * (len(palette) - 1))
        result[index] = (*palette[level], pixel[3])

    output = Image.new("RGBA", source.size)
    output.putdata(result)
    return output, mask


def opaque(_: tuple[int, int, int, int]) -> bool:
    return True


def ore_inclusion(pixel: tuple[int, int, int, int]) -> bool:
    red, green, blue, _ = pixel
    # The Emerald Ore template has a strictly grayscale stone matrix. Every
    # inclusion pixel is colored by at least this amount, including dark edges.
    return max(red, green, blue) - min(red, green, blue) >= 12


def normalized_netherite(layer: int) -> Image.Image:
    source = load_rgba(ARMOR_DIR / f"netherite_layer_{layer}.png")
    expected_size = load_rgba(ARMOR_DIR / f"diamond_layer_{layer}.png").size
    if source.size == expected_size:
        return source
    if source.width % expected_size[0] or source.height % expected_size[1]:
        raise ValueError(
            f"Netherite layer {layer} has incompatible size {source.size}; "
            f"expected an integer scale of {expected_size}"
        )
    return source.resize(expected_size, Image.Resampling.NEAREST)


def generate_armor() -> list[GeneratedAsset]:
    generated: list[GeneratedAsset] = []
    for material, palette in (("ruby", RUBY_PALETTE), ("titanium", TITANIUM_PALETTE)):
        for layer in (1, 2):
            template = ARMOR_DIR / f"{'diamond' if material == 'ruby' else 'netherite'}_layer_{layer}.png"
            source = load_rgba(template) if material == "ruby" else normalized_netherite(layer)
            image, mask = remap_luminance(source, palette, opaque)
            generated.append(
                GeneratedAsset(
                    ARMOR_DIR / f"{material}_layer_{layer}.png",
                    template,
                    image,
                    mask,
                    "armor",
                )
            )
    return generated


def handle_colors() -> frozenset[tuple[int, int, int]]:
    stick = load_rgba(SOURCE_TEXTURES / "items" / "stick.png")
    return frozenset(pixel[:3] for pixel in pixel_data(stick) if pixel[3] > 0)


def generate_tools() -> list[GeneratedAsset]:
    generated: list[GeneratedAsset] = []
    wooden_palette = handle_colors()
    for material, palette in (("ruby", RUBY_PALETTE), ("titanium", TITANIUM_PALETTE)):
        for tool in TOOL_NAMES:
            template = SOURCE_TEXTURES / "items" / f"iron_{tool}.png"
            source = load_rgba(template)
            image, mask = remap_luminance(
                source,
                palette,
                lambda pixel, handles=wooden_palette: pixel[:3] not in handles,
            )
            generated.append(
                GeneratedAsset(
                    ITEM_OUTPUT_DIR / f"{material}_{tool}.png",
                    template,
                    image,
                    mask,
                    "tool",
                )
            )
    return generated


def generate_armor_icons() -> list[GeneratedAsset]:
    generated: list[GeneratedAsset] = []
    for material, palette in (("ruby", RUBY_PALETTE), ("titanium", TITANIUM_PALETTE)):
        for piece in ARMOR_ITEM_NAMES:
            template = SOURCE_TEXTURES / "items" / f"diamond_{piece}.png"
            source = load_rgba(template)
            image, mask = remap_luminance(source, palette, opaque)
            generated.append(
                GeneratedAsset(
                    ITEM_OUTPUT_DIR / f"{material}_{piece}.png",
                    template,
                    image,
                    mask,
                    "armor_icon",
                )
            )
    return generated


def generate_ingots() -> list[GeneratedAsset]:
    template = SOURCE_TEXTURES / "items" / "iron_ingot.png"
    source = load_rgba(template)
    generated: list[GeneratedAsset] = []
    for material, palette in (("ruby", RUBY_PALETTE), ("titanium", TITANIUM_PALETTE)):
        image, mask = remap_luminance(source, palette, opaque)
        generated.append(
            GeneratedAsset(
                ITEM_OUTPUT_DIR / f"{material}_ingot.png",
                template,
                image,
                mask,
                "ingot",
            )
        )
    return generated


def god_sword_red_colors() -> dict[tuple[int, int], tuple[int, int, int]]:
    if len(GOD_SWORD_EDGE_PIXELS) != len(GOD_SWORD_EDGE_COLORS):
        raise ValueError("God Sword edge colors must match the edge path")
    accents: dict[tuple[int, int], tuple[int, int, int]] = {}
    for (x, y), color in zip(GOD_SWORD_EDGE_PIXELS, GOD_SWORD_EDGE_COLORS):
        accents[(x, y)] = color
    for group in (
        GOD_SWORD_REFLECTION_PIXELS,
        GOD_SWORD_UPPER_FISSURE,
        GOD_SWORD_LOWER_FISSURE,
        GOD_SWORD_GUARD_CORE,
    ):
        for x, y, color in group:
            if (x, y) in accents:
                raise ValueError(f"God Sword red groups overlap at {(x, y)}")
            accents[(x, y)] = color
    return accents


def god_sword_ridge_colors() -> dict[tuple[int, int], tuple[int, int, int]]:
    ridge = {(x, y): color for x, y, color in GOD_SWORD_RIDGE_PIXELS}
    if len(ridge) != len(GOD_SWORD_RIDGE_PIXELS):
        raise ValueError("God Sword ridge coordinates must be unique")
    return ridge


def god_grip_ranks() -> dict[tuple[int, int, int], int]:
    ranked = sorted(handle_colors(), key=luminance)
    if len(ranked) != len(GOD_GRIP_PALETTE):
        raise ValueError(
            f"God Sword grip palette has {len(GOD_GRIP_PALETTE)} steps "
            f"for {len(ranked)} wooden handle colors"
        )
    return {color: index for index, color in enumerate(ranked)}


def god_blade_metal_color(
    x: int,
    y: int,
    rgb: tuple[int, int, int],
    ridge: dict[tuple[int, int], tuple[int, int, int]],
) -> tuple[int, int, int]:
    painted = ridge.get((x, y))
    if painted is not None:
        return painted
    deep, shadow, dark, mid, _bevel, _highlight = DARK_GOD_PALETTE
    try:
        spine_index = GOD_SWORD_SPINE_PIXELS.index((x, y))
    except ValueError:
        spine_index = -1
    if spine_index >= 0:
        if spine_index % 4 == 0:
            return deep
        if spine_index % 4 == 1:
            return shadow
        return dark
    # Source gray 24 and 68 stay dark metal. Brighter source facets become mid metal.
    # The two lightest palette colors are applied only by the authored ridge.
    if rgb[0] <= 68 and rgb[0] == rgb[1] == rgb[2]:
        return dark
    return mid


def generate_god_sword() -> GeneratedAsset:
    template = SOURCE_TEXTURES / "items" / "iron_sword.png"
    source = load_rgba(template)
    handles = handle_colors()
    grip_ranks = god_grip_ranks()
    reds = god_sword_red_colors()
    ridge = god_sword_ridge_colors()
    if set(reds) & set(ridge):
        raise ValueError("God Sword ridge overlaps a red accent")
    source_pixels = pixel_data(source)
    result: list[tuple[int, int, int, int]] = []
    mask: list[bool] = []
    for index, pixel in enumerate(source_pixels):
        x = index % source.width
        y = index // source.width
        if pixel[3] == 0:
            result.append(pixel)
            mask.append(False)
            continue
        mask.append(True)
        red = reds.get((x, y))
        if red is not None:
            if pixel[:3] in handles:
                raise ValueError(f"God Sword red accent {(x, y)} landed on the grip")
            result.append((*red, pixel[3]))
            continue
        if pixel[:3] in handles:
            result.append((*GOD_GRIP_PALETTE[grip_ranks[pixel[:3]]], pixel[3]))
            continue
        result.append((*god_blade_metal_color(x, y, pixel[:3], ridge), pixel[3]))
    image = Image.new("RGBA", source.size)
    image.putdata(result)
    return GeneratedAsset(
        ITEM_OUTPUT_DIR / "god_sword.png",
        template,
        image,
        tuple(mask),
        "god_sword",
    )


def generate_ore() -> list[GeneratedAsset]:
    template = SOURCE_TEXTURES / "blocks" / "emerald_ore.png"
    source = load_rgba(template)
    image, mask = remap_luminance(source, TITANIUM_ORE_PALETTE, ore_inclusion)
    return [
        GeneratedAsset(
            BLOCK_OUTPUT_DIR / "titanium_ore.png",
            template,
            image,
            mask,
            "ore",
        )
    ]


def generate_all() -> list[GeneratedAsset]:
    return generate_armor() + generate_armor_icons() + generate_ingots() + generate_tools() + generate_ore() + [generate_god_sword()]


def expected_source(asset: GeneratedAsset) -> Image.Image:
    if asset.kind == "armor" and asset.path.name.startswith("titanium_"):
        layer = 1 if "layer_1" in asset.path.name else 2
        return normalized_netherite(layer)
    return load_rgba(asset.template)


def palette_for(asset: GeneratedAsset) -> tuple[tuple[int, int, int], ...]:
    if asset.kind == "ore":
        return TITANIUM_ORE_PALETTE
    return RUBY_PALETTE if asset.path.name.startswith("ruby_") else TITANIUM_PALETTE


def validate_god_sword(asset: GeneratedAsset, output: Image.Image, source: Image.Image) -> None:
    output_pixels = pixel_data(output)
    source_pixels = pixel_data(source)
    if [pixel[3] for pixel in output_pixels] != [pixel[3] for pixel in source_pixels]:
        raise ValueError(f"{asset.path}: alpha mask differs from the iron sword")
    accents = god_sword_red_colors()
    ridge = god_sword_ridge_colors()
    handles = handle_colors()
    grip = frozenset(GOD_GRIP_PALETTE)
    dark = frozenset(DARK_GOD_PALETTE)
    red = frozenset(GOD_RED_PALETTE)
    light_metal = frozenset(DARK_GOD_PALETTE[-2:])
    metal_colors: set[tuple[int, int, int]] = set()
    bright = 0
    hottest = 0
    light_count = 0
    god_luminance = 0.0
    god_count = 0
    titanium_luminance = 0.0
    titanium = pixel_data(load_rgba(ITEM_OUTPUT_DIR / "titanium_sword.png"))
    for index, source_pixel in enumerate(source_pixels):
        x = index % source.width
        y = index // source.width
        output_pixel = output_pixels[index]
        if source_pixel[3] == 0:
            if output_pixel[3] != 0:
                raise ValueError(f"{asset.path}: new opaque pixel at {(x, y)}")
            continue
        expected = accents.get((x, y))
        if expected is not None:
            if output_pixel[:3] != expected or output_pixel[:3] not in red:
                raise ValueError(f"{asset.path}: unexpected accent at {(x, y)}")
            if output_pixel[:3] in GOD_RED_BRIGHT_OR_HOTTER:
                bright += 1
            if output_pixel[:3] == GOD_RED_CORE:
                hottest += 1
            continue
        if source_pixel[:3] in handles:
            if output_pixel[:3] not in grip or output_pixel[:3] in handles:
                raise ValueError(f"{asset.path}: grip pixel left the dark wrap at {(x, y)}")
            continue
        if output_pixel[:3] not in dark:
            raise ValueError(f"{asset.path}: metal pixel left the dark palette at {(x, y)}")
        metal_colors.add(output_pixel[:3])
        if output_pixel[:3] in light_metal:
            light_count += 1
        god_luminance += luminance(output_pixel[:3])
        titanium_luminance += luminance(titanium[index][:3])
        god_count += 1
    if len(accents) < 24 or len(accents) > 29:
        raise ValueError(f"{asset.path}: red accent count {len(accents)} is outside 24-29")
    if bright > 7:
        raise ValueError(f"{asset.path}: {bright} bright red pixels")
    if hottest > 2:
        raise ValueError(f"{asset.path}: {hottest} hottest core pixels")
    if light_count < 6 or light_count > 9:
        raise ValueError(f"{asset.path}: ridge highlight count {light_count}")
    if len(metal_colors) < 5:
        raise ValueError(f"{asset.path}: only {len(metal_colors)} metal colors")
    if god_count == 0:
        raise ValueError(f"{asset.path}: no blade metal pixels")
    god_mean = god_luminance / god_count
    titanium_mean = titanium_luminance / god_count
    if not titanium_mean * 0.50 < god_mean < titanium_mean * 0.70:
        raise ValueError(
            f"{asset.path}: metal luminance {god_mean:.2f} is outside "
            f"50-70% of titanium {titanium_mean:.2f}"
        )
    if any(color not in metal_colors for color in ridge.values()):
        raise ValueError(f"{asset.path}: ridge color missing from the blade")


def validate_asset(asset: GeneratedAsset, actual: Image.Image | None = None) -> None:
    output = asset.image if actual is None else actual.convert("RGBA")
    source = expected_source(asset)
    if output.size != source.size:
        raise ValueError(f"{asset.path}: size {output.size} != template size {source.size}")

    output_pixels = pixel_data(output)
    source_pixels = pixel_data(source)
    output_alpha = [pixel[3] for pixel in output_pixels]
    source_alpha = [pixel[3] for pixel in source_pixels]
    if output_alpha != source_alpha:
        raise ValueError(f"{asset.path}: alpha mask differs from its normalized template")

    if asset.kind == "god_sword":
        validate_god_sword(asset, output, source)
        return

    allowed = frozenset(palette_for(asset))
    for index, selected in enumerate(asset.remap_mask):
        output_pixel = output_pixels[index]
        source_pixel = source_pixels[index]
        if selected:
            if output_pixel[:3] not in allowed:
                raise ValueError(f"{asset.path}: non-palette remapped pixel at index {index}")
        elif output_pixel != source_pixel:
            detail = "wooden handle" if asset.kind == "tool" else "stone background"
            raise ValueError(f"{asset.path}: changed preserved {detail} pixel at index {index}")

    if asset.kind in {"armor", "armor_icon", "tool", "ingot"} and 0 not in output_alpha:
        raise ValueError(f"{asset.path}: expected a transparent background")
    if asset.kind == "ore" and min(output_alpha) != 255:
        raise ValueError(f"{asset.path}: ore texture must remain fully opaque")


def save_assets(assets: Iterable[GeneratedAsset]) -> int:
    written = 0
    for asset in assets:
        validate_asset(asset)
        asset.path.parent.mkdir(parents=True, exist_ok=True)
        if asset.path.is_file() and pixel_data(load_rgba(asset.path)) == pixel_data(asset.image):
            continue
        asset.image.save(asset.path, format="PNG", compress_level=9)
        written += 1
    return written


def checkerboard(size: tuple[int, int], cell: int = 8) -> Image.Image:
    image = Image.new("RGBA", size, (35, 39, 46, 255))
    draw = ImageDraw.Draw(image)
    for y in range(0, size[1], cell):
        for x in range(0, size[0], cell):
            if (x // cell + y // cell) % 2:
                draw.rectangle((x, y, x + cell - 1, y + cell - 1), fill=(50, 55, 64, 255))
    return image


def paste_pixel_art(
    sheet: Image.Image,
    sprite: Image.Image,
    box: tuple[int, int, int, int],
) -> None:
    left, top, width, height = box
    scale = max(1, min(width // sprite.width, height // sprite.height))
    scaled = sprite.resize((sprite.width * scale, sprite.height * scale), Image.Resampling.NEAREST)
    background = checkerboard((width, height))
    background.alpha_composite(scaled, ((width - scaled.width) // 2, (height - scaled.height) // 2))
    sheet.alpha_composite(background, (left, top))


def create_contact_sheet(assets: list[GeneratedAsset]) -> Image.Image:
    by_name = {asset.path.name: asset.image for asset in assets}
    width, height = 960, 1100
    sheet = Image.new("RGBA", (width, height), (20, 23, 29, 255))
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    draw.text((24, 18), "FRONTIER CUBES - RUBY / TITANIUM GENERATED ASSETS", fill=(232, 236, 241), font=font)

    columns = (("RUBY", "ruby", 24), ("TITANIUM", "titanium", 492))
    for title, prefix, left in columns:
        draw.text((left, 48), title, fill=(232, 236, 241), font=font)
        for layer, top in ((1, 72), (2, 246)):
            draw.text((left, top), f"ARMOR LAYER {layer} - 128x64", fill=(174, 184, 196), font=font)
            paste_pixel_art(sheet, by_name[f"{prefix}_layer_{layer}.png"], (left, top + 18, 444, 144))

        item_names = ARMOR_ITEM_NAMES + ("ingot",) + TOOL_NAMES
        for index, name in enumerate(item_names):
            col, row = index % 3, index // 3
            x = left + col * 148
            y = 438 + row * 146
            draw.text((x, y), f"{name.upper()} - 32x32", fill=(174, 184, 196), font=font)
            paste_pixel_art(sheet, by_name[f"{prefix}_{name}.png"], (x, y + 18, 136, 116))

    draw.text((492, 1034), "TITANIUM ORE - 32x32", fill=(174, 184, 196), font=font)
    paste_pixel_art(sheet, by_name["titanium_ore.png"], (668, 1018, 116, 72))
    return sheet.convert("RGB")


def verify_written(assets: list[GeneratedAsset], check_preview: bool) -> None:
    for asset in assets:
        if not asset.path.is_file():
            raise FileNotFoundError(f"Generated asset is missing: {asset.path}")
        actual = load_rgba(asset.path)
        validate_asset(asset, actual)
        if pixel_data(actual) != pixel_data(asset.image):
            raise ValueError(f"Generated asset is stale: {asset.path}")
    if check_preview and not PREVIEW_PATH.is_file():
        raise FileNotFoundError(f"Contact sheet is missing: {PREVIEW_PATH}")


def relative(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="validate existing outputs against freshly generated pixels without writing",
    )
    parser.add_argument(
        "--no-preview",
        action="store_true",
        help="do not write or require the contact sheet",
    )
    args = parser.parse_args()

    assets = generate_all()
    if args.check:
        verify_written(assets, check_preview=not args.no_preview)
        action = "Verified"
    else:
        written = save_assets(assets)
        if not args.no_preview:
            PREVIEW_PATH.parent.mkdir(parents=True, exist_ok=True)
            create_contact_sheet(assets).save(PREVIEW_PATH, format="PNG", compress_level=9)
        verify_written(assets, check_preview=not args.no_preview)
        action = f"Generated {written} changed/new and verified"

    print(f"{action} {len(assets)} gameplay assets:")
    for asset in assets:
        print(f"  {relative(asset.path):68} {asset.image.width}x{asset.image.height} <- {relative(asset.template)}")
    if not args.no_preview:
        print(f"  preview: {relative(PREVIEW_PATH)}")


if __name__ == "__main__":
    main()

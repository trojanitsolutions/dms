"""Build dms/item_images/item_images.zip from a raw photo zip.

Run locally, NOT on the server. Needs Pillow and pillow-heif (not app dependencies):

    python -m venv /tmp/imgenv && /tmp/imgenv/bin/pip install pillow pillow-heif
    /tmp/imgenv/bin/python scripts/build_item_images_zip.py "raw photos.zip"

Every image is resized to at most MAX_SIDE px, converted to JPEG (HEIC/PNG included) and
renamed to "{code}-img{n}.jpg". When two files map to the same code and number (often the
same photo as .png and .jpg), the one with more pixels is kept. A manifest CSV records what
happened to each source file.
"""

import argparse
import csv
import io
import sys
import zipfile
from pathlib import Path

from PIL import Image, ImageOps
from pillow_heif import register_heif_opener

APP_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(APP_ROOT / "dms" / "setup"))
from item_image_names import clean_name, is_image_entry, parse_image_name  # noqa: E402

register_heif_opener()

MAX_SIDE = 1200
QUALITY = 82
MAX_ZIP_BYTES = 95 * 1024 * 1024  # GitHub rejects files over 100 MB
DEFAULT_OUT = APP_ROOT / "dms" / "item_images" / "item_images.zip"


def main():
	args = _parse_args()
	chosen, rows = {}, []
	with zipfile.ZipFile(args.source) as src:
		for info in src.infolist():
			if not is_image_entry(info.filename):
				continue
			code, n = parse_image_name(info.filename)
			key = (code.upper(), n)
			try:
				jpeg, pixels = _to_jpeg(src.read(info))
			except Exception as e:
				rows.append(_row(info.filename, code, n, "", f"error: {e}"))
				continue
			previous = chosen.get(key)
			if previous and previous["pixels"] >= pixels:
				rows.append(_row(info.filename, code, n, "", f"duplicate of {previous['source']}"))
				continue
			if previous:
				rows.append(_row(previous["source"], code, n, "", f"duplicate of {info.filename}"))
			chosen[key] = {"source": info.filename, "code": code, "n": n, "jpeg": jpeg, "pixels": pixels}

	args.out.parent.mkdir(parents=True, exist_ok=True)
	with zipfile.ZipFile(args.out, "w", zipfile.ZIP_STORED) as out:
		for entry in sorted(chosen.values(), key=lambda e: (e["code"].upper(), e["n"])):
			name = clean_name(entry["code"], entry["n"])
			out.writestr(name, entry["jpeg"])
			rows.append(_row(entry["source"], entry["code"], entry["n"], name, "ok"))

	_write_manifest(args.manifest, rows)
	size = args.out.stat().st_size
	print(f"{len(chosen)} images -> {args.out} ({size / 1024 / 1024:.1f} MB); manifest: {args.manifest}")
	print(f"skipped/errors: {sum(1 for r in rows if r['status'] != 'ok')}")
	if size > MAX_ZIP_BYTES:
		sys.exit(f"Zip is over {MAX_ZIP_BYTES // 1024 // 1024} MB; lower MAX_SIDE or QUALITY.")


def _to_jpeg(data):
	"""(jpeg bytes, source pixel count). Keeps the original bytes if it is already a small upright JPEG."""
	img = Image.open(io.BytesIO(data))
	pixels = img.width * img.height
	is_plain_jpeg = img.format == "JPEG" and img.getexif().get(0x0112, 1) == 1 and img.mode == "RGB"
	img = ImageOps.exif_transpose(img)
	img.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
	if img.mode in ("RGBA", "LA", "P"):
		img = img.convert("RGBA")
		background = Image.new("RGB", img.size, "white")
		background.paste(img, mask=img.split()[-1])
		img = background
	elif img.mode != "RGB":
		img = img.convert("RGB")
	buf = io.BytesIO()
	img.save(buf, "JPEG", quality=QUALITY, optimize=True, progressive=True)
	encoded = buf.getvalue()
	if is_plain_jpeg and max(Image.open(io.BytesIO(data)).size) <= MAX_SIDE and len(data) < len(encoded):
		return data, pixels
	return encoded, pixels


def _row(source, code, n, output, status):
	return {"source": source, "code": code, "n": n, "output": output, "status": status}


def _write_manifest(path, rows):
	with open(path, "w", newline="") as f:
		writer = csv.DictWriter(f, fieldnames=["source", "code", "n", "output", "status"])
		writer.writeheader()
		writer.writerows(sorted(rows, key=lambda r: (r["code"].upper(), r["n"], r["status"] != "ok")))


def _parse_args():
	parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
	parser.add_argument("source", type=Path, help="raw photo zip")
	parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
	parser.add_argument("--manifest", type=Path, default=Path("item_images_manifest.csv"))
	return parser.parse_args()


if __name__ == "__main__":
	main()

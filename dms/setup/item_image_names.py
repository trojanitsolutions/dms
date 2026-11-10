"""Parse item image file names like "LXS-034-IMG1.jpg" into (item code, image number).

Pure Python with no Frappe import, so the local zip prep script can use the same rules.
"""

import posixpath
import re

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif"}

# "CODE-img1", "CODE - IMG 2", "CODE-IMG-1", "CODE-img" (n = 1), plus junk that people typed
# after the number before the real extension: "IMG1.", "img1jpg", "img1.pg".
_IMG_RE = re.compile(
	r"^(?P<code>.+?)\s*[-.=_]\s*img\s*-?\s*(?P<n>\d*)(?:[.\s]*(?:jpe?g|png|pg|heic))*[.\s]*$",
	re.IGNORECASE,
)


def is_image_entry(path):
	"""True for a real image in a zip; False for folders and macOS junk (__MACOSX, ._x, .DS_Store)."""
	if path.endswith("/") or path.startswith("__MACOSX/"):
		return False
	base = posixpath.basename(path)
	if not base or base.startswith("."):
		return False
	return posixpath.splitext(base)[1].lower() in IMAGE_EXTS


def parse_image_name(path):
	"""(code, n) for a zip entry path. A name with no "-img" part is the bare item code, n = 1."""
	stem = posixpath.splitext(posixpath.basename(path))[0].strip()
	match = _IMG_RE.match(stem)
	if match:
		return match.group("code").strip(), int(match.group("n") or 1)
	return stem.strip(" ."), 1


def clean_name(code, n):
	"""File name the prep script writes into the bundled zip; parse_image_name reads it back."""
	return f"{code}-img{n}.jpg"

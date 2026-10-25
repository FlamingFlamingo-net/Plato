"""Inspect PDFs made by tools/docs_check.mjs. Needs PyMuPDF (pip install pymupdf).

  python tools/pdf_info.py FILE.pdf [--png OUT_PREFIX]

Prints JSON: page count, each page's size in pt, the text of each page, and the number of
raster images on each page. With --png, renders every page to OUT_PREFIX-<n>.png (110 dpi).
"""
import json
import sys

import pymupdf

path = sys.argv[1]
png = sys.argv[sys.argv.index("--png") + 1] if "--png" in sys.argv else None
doc = pymupdf.open(path)
pages = []
for i in range(doc.page_count):
    page = doc[i]
    r = page.rect
    pages.append({
        "w": round(r.width, 2), "h": round(r.height, 2),
        "text": page.get_text(),
        "images": len(page.get_image_info()),
    })
    if png:
        page.get_pixmap(dpi=110).save(f"{png}-{i + 1}.png")
print(json.dumps({"pages": len(pages), "sizes": [[p["w"], p["h"]] for p in pages],
                  "images": [p["images"] for p in pages], "text": [p["text"] for p in pages]}, ensure_ascii=False))

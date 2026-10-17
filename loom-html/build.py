import base64, html, pathlib, sys

here = pathlib.Path(__file__).parent
ws = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else r"C:\dev\repo\ticktack\.loom\dashboard-refinement")
out = here / "loom-view.html"

embeds = []
for p in sorted(ws.rglob("*.md")):
    src = p.read_text(encoding="utf-8")
    assert "</script" not in src.lower()
    embeds.append(f'<script type="text/plain" data-file="{html.escape(p.relative_to(ws).as_posix())}">{src}</script>')
shots = "".join(
    f'<img data-shot="{p.stem}" alt="{p.stem}" src="data:image/png;base64,{base64.b64encode(p.read_bytes()).decode()}">'
    for p in sorted((ws / "smoke-screenshots").glob("*.png")))

page = (here / "template.html").read_text(encoding="utf-8").replace("{{FILES}}", "\n".join(embeds) + f'\n<template id="shots">{shots}</template>')
out.write_text("<!doctype html>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n" + page, encoding="utf-8")
print(out, out.stat().st_size)

#!/bin/sh
# Stamps every local script/stylesheet URL in index.html with a fresh ?v= so browsers
# (and GitHub Pages' 10-minute cache) never mix old and new modules after an update.
# Run from the repo root before committing a release:  sh tools/bump-version.sh
set -e
V=$(date +%Y%m%d%H%M)
python3 - "$V" <<'PY'
import re, sys, os, json
v = sys.argv[1]
html = open('index.html').read()
mods = sorted(f for f in os.listdir('src') if f.endswith('.js'))
imports = {
  "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
  "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/",
}
for m in mods: imports[f"./src/{m}"] = f"./src/{m}?v={v}"
block = '<script type="importmap">\n' + json.dumps({"imports": imports}, indent=2) + '\n</script>'
html = re.sub(r'<script type="importmap">.*?</script>', lambda _: block, html, flags=re.S)
html = re.sub(r'href="style\.css(\?v=\w+)?"', f'href="style.css?v={v}"', html)
html = re.sub(r'src="src/main\.js(\?v=\w+)?"', f'src="src/main.js?v={v}"', html)
open('index.html', 'w').write(html)
print('stamped version', v)
PY

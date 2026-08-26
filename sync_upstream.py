"""Fetch or refresh the vendored assets of this plugin.

Default behaviour: check what already exists in this folder and download
only the missing pieces from the upstream GitHub repository. Files that are
already present are left untouched unless --force is given.

Usage:
    python sync_upstream.py              # download missing pieces from GitHub
    python sync_upstream.py --force      # re-download everything
    python sync_upstream.py --local <upstream_dir>
                                         # vendor from a local project copy
"""

import shutil
import sys
import urllib.request
from pathlib import Path

PLUGIN_DIR = Path(__file__).resolve().parent
PAGE_FILE = PLUGIN_DIR / "Danbooru-Tag-Selector.html"
DATASET_FILE = PLUGIN_DIR / "tags_with_groups.csv"
BRIDGE_FILE = PLUGIN_DIR / "web" / "bridge_inject.js"

REPO = "Fre2C/Danbooru-Tag-Selector"
BRANCH = "main"
RAW_BASE = f"https://raw.githubusercontent.com/{REPO}/{BRANCH}"


def fetch(url, dest):
    print(f"[fetch] {url}")
    with urllib.request.urlopen(url, timeout=120) as resp:
        data = resp.read()
    if not data:
        raise RuntimeError("empty response")
    dest.write_bytes(data)
    print(f"[ok]    saved {dest.name} ({len(data) // 1024} KB)")


def inject_bridge(html_text):
    """Append the bridge as its own <script> block before </body>."""
    bridge = BRIDGE_FILE.read_text(encoding="utf-8")
    block = "<script>\n" + bridge + "\n</script>\n"
    idx = html_text.rfind("</body>")
    if idx == -1:
        return html_text + "\n" + block
    return html_text[:idx] + block + html_text[idx:]


def main():
    args = sys.argv[1:]
    force = "--force" in args
    local_dir = None
    if "--local" in args:
        i = args.index("--local")
        if i + 1 >= len(args):
            print("ERROR: --local requires a path argument")
            sys.exit(1)
        local_dir = Path(args[i + 1])
        if not (local_dir / "Danbooru-Tag-Selector.html").is_file():
            print(f"ERROR: no Danbooru-Tag-Selector.html inside {local_dir}")
            sys.exit(1)

    # ---------- page ----------
    if not force and PAGE_FILE.is_file():
        print(f"[skip] {PAGE_FILE.name} already exists (--force to re-download)")
    elif local_dir:
        html = (local_dir / PAGE_FILE.name).read_text(encoding="utf-8")
        PAGE_FILE.write_text(inject_bridge(html), encoding="utf-8")
        print(f"[ok]    vendored page from local upstream: {local_dir}")
    else:
        fetch(f"{RAW_BASE}/{PAGE_FILE.name}", PAGE_FILE)
        # the raw download is the pristine upstream page: add our bridge
        PAGE_FILE.write_text(
            inject_bridge(PAGE_FILE.read_text(encoding="utf-8")),
            encoding="utf-8",
        )
        print("[ok]    bridge appended")

    # ---------- dataset ----------
    if not force and DATASET_FILE.is_file():
        print(f"[skip] {DATASET_FILE.name} already exists (--force to re-download)")
    elif local_dir:
        csv_src = local_dir / DATASET_FILE.name
        if csv_src.is_file():
            shutil.copyfile(csv_src, DATASET_FILE)
            print("[ok]    copied dataset from local upstream")
        else:
            print(f"[miss]  {csv_src} not found; place the dataset manually")
    else:
        try:
            fetch(f"{RAW_BASE}/{DATASET_FILE.name}", DATASET_FILE)
        except Exception as err:
            if DATASET_FILE.exists():
                DATASET_FILE.unlink()
            print(f"[miss]  dataset is not in the upstream repository ({err}).")
            print("        Copy tags_with_groups.csv into this folder manually,")
            print("        or push it to the Danbooru-Tag-Selector repository once.")

    print("[done]  Restart ComfyUI (or reopen the page) to pick everything up.")


if __name__ == "__main__":
    main()

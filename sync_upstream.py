"""Fetch or refresh the vendored assets of this plugin.

Manual use:
    python sync_upstream.py              # download missing pieces from GitHub
    python sync_upstream.py --force      # re-download everything
    python sync_upstream.py --local <upstream_dir>
                                         # vendor from a local project copy

The plugin also calls ensure_assets() automatically when ComfyUI starts:
it downloads only what is missing (the page), never overwrites existing
files, and never raises.
"""

import shutil
import sys
import urllib.request
from pathlib import Path

PLUGIN_DIR = Path(__file__).resolve().parent
PAGE_FILE = PLUGIN_DIR / "Danbooru-Tag-Selector.html"
BRIDGE_FILE = PLUGIN_DIR / "web" / "bridge_inject.js"

REPO = "Fre2C/Danbooru-Tag-Selector"
BRANCH = "main"
RAW_BASE = f"https://raw.githubusercontent.com/{REPO}/{BRANCH}"

DATASET_NAMES = ("tags_with_groups.csv", "tags_enhanced.csv")

DATASET_DOC_URL = "https://github.com/Fre2C/Danbooru-Tag-Selector#数据集"

DATASET_HINT = (
    "[ComfyUI-Tag-Selector] 数据集未找到。请将 tags_with_groups.csv\n"
    "（或 tags_enhanced.csv）放入插件目录：\n"
    f"  {PLUGIN_DIR}\n"
    "获取方式见上游项目 README 的「数据集」章节：\n"
    f"  {DATASET_DOC_URL}"
)


def fetch(url, dest, timeout=30):
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        data = resp.read()
    if not data:
        raise RuntimeError("empty response")
    dest.write_bytes(data)
    return len(data)


def inject_bridge(html_text):
    """Append the bridge as its own <script> block before </body>."""
    bridge = BRIDGE_FILE.read_text(encoding="utf-8")
    block = "<script>\n" + bridge + "\n</script>\n"
    idx = html_text.rfind("</body>")
    if idx == -1:
        return html_text + "\n" + block
    return html_text[:idx] + block + html_text[idx:]


def _dataset_present():
    return any((PLUGIN_DIR / name).is_file() for name in DATASET_NAMES)


def ensure_assets():
    """Startup hook: heal the plugin folder quietly. Never raises; never
    touches files that already exist. The dataset is not fetched here on
    purpose — it is not in the upstream repository, so a network probe would
    be wasted seconds on every launch; the missing-file hints cover it."""
    if not PAGE_FILE.is_file():
        print("[ComfyUI-Tag-Selector] 页面缺失，正在从上游仓库自动下载 ...")
        try:
            size = fetch(f"{RAW_BASE}/{PAGE_FILE.name}", PAGE_FILE)
            PAGE_FILE.write_text(
                inject_bridge(PAGE_FILE.read_text(encoding="utf-8")),
                encoding="utf-8",
            )
            print(
                f"[ComfyUI-Tag-Selector] 页面已就绪（{size // 1024} KB，桥接已注入），"
                "刷新 ComfyUI 即可使用。"
            )
        except Exception as err:
            if PAGE_FILE.exists():
                PAGE_FILE.unlink()
            print(f"[ComfyUI-Tag-Selector] 自动下载失败：{err}")
            print(
                "[ComfyUI-Tag-Selector] 请在插件目录运行 python sync_upstream.py，"
                "或手动放入 Danbooru-Tag-Selector.html。"
            )
    if not _dataset_present():
        print(DATASET_HINT)
    return PAGE_FILE.is_file()


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
    if _dataset_present() and not force:
        found = next(n for n in DATASET_NAMES if (PLUGIN_DIR / n).is_file())
        print(f"[skip] dataset already present: {found}")
    elif local_dir:
        copied = False
        for name in DATASET_NAMES:
            src = local_dir / name
            if src.is_file():
                shutil.copyfile(src, PLUGIN_DIR / name)
                print(f"[ok]    copied dataset: {name}")
                copied = True
                break
        if not copied:
            print(DATASET_HINT)
    else:
        got = False
        for name in DATASET_NAMES:
            try:
                fetch(f"{RAW_BASE}/{name}", PLUGIN_DIR / name)
                got = True
                break
            except Exception:
                leftover = PLUGIN_DIR / name
                if leftover.exists():
                    leftover.unlink()
        if not got:
            print(DATASET_HINT)

    print("[done]  Restart ComfyUI (or reopen the floaty) to pick everything up.")


if __name__ == "__main__":
    main()

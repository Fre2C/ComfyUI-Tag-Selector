"""Shared logic for ComfyUI-Tag-Selector.

The plugin is self-contained: the vendored page (Danbooru-Tag-Selector.html,
the upstream page with the bridge already appended), the dataset CSV and the
ledger all live inside this folder. Nothing outside the plugin directory is
ever touched at runtime.

When the upstream project releases a new version, run:

    python sync_upstream.py

which refreshes the vendored page in place. On ComfyUI startup the plugin
also calls sync_upstream.ensure_assets() to fetch anything that is missing.
"""

import json
import os
from pathlib import Path

_PLUGIN_DIR = Path(__file__).resolve().parent

PAGE_FILE = _PLUGIN_DIR / "Danbooru-Tag-Selector.html"
LEDGER_PATH = _PLUGIN_DIR / "data" / "dts_data.json"

# accepted dataset filenames, first match wins
DATASET_CANDIDATES = ("tags_with_groups.csv", "tags_enhanced.csv")

DATASET_DOC_URL = "https://github.com/Fre2C/Danbooru-Tag-Selector#数据集"


def find_dataset_path():
    """Return the first dataset file present in the plugin folder, or None."""
    for name in DATASET_CANDIDATES:
        path = _PLUGIN_DIR / name
        if path.is_file():
            return path
    return None


def read_page_html():
    """Return the vendored page (upstream snapshot + bridge), or None."""
    try:
        return PAGE_FILE.read_text(encoding="utf-8")
    except OSError:
        return None


_dataset_cache = None


def read_dataset_text():
    """Read the built-in dataset once, keep it in memory afterwards.

    A failed lookup stays uncached on purpose: dropping the file in while
    ComfyUI is running works without a restart.
    """
    global _dataset_cache
    if _dataset_cache is None:
        path = find_dataset_path()
        if path is None:
            return None
        try:
            _dataset_cache = path.read_text(encoding="utf-8")
        except OSError:
            return None
    return _dataset_cache


def load_ledger():
    """Read the shared ledger; a corrupt file falls back to an empty one."""
    try:
        text = LEDGER_PATH.read_text(encoding="utf-8")
        data = json.loads(text)
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def save_ledger(data):
    """Atomic write: temp file first, then replace, so the ledger can never
    end up half-written."""
    LEDGER_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = LEDGER_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, LEDGER_PATH)

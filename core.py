"""Shared logic for ComfyUI-Tag-Selector.

The plugin is self-contained: the vendored page (Danbooru-Tag-Selector.html,
the upstream page with the bridge already appended), the dataset CSV and the
ledger all live inside this folder. Nothing outside the plugin directory is
ever touched at runtime.

When the upstream project releases a new version, run:

    python sync_upstream.py [upstream_dir]

which refreshes the vendored page in place.
"""

import json
import os
from pathlib import Path

_PLUGIN_DIR = Path(__file__).resolve().parent

PAGE_FILE = _PLUGIN_DIR / "Danbooru-Tag-Selector.html"
DATASET_FILE = _PLUGIN_DIR / "tags_with_groups.csv"
LEDGER_PATH = _PLUGIN_DIR / "data" / "dts_data.json"


def read_page_html():
    """Return the vendored page (upstream snapshot + bridge), or None."""
    try:
        return PAGE_FILE.read_text(encoding="utf-8")
    except OSError:
        return None


_dataset_cache = None


def read_dataset_text():
    """Read the built-in dataset once, keep it in memory afterwards."""
    global _dataset_cache
    if _dataset_cache is None:
        try:
            _dataset_cache = DATASET_FILE.read_text(encoding="utf-8")
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

"""ComfyUI-Tag-Selector: iframe-bridge plugin.

Thin host: mounts the shared logic in core.py onto ComfyUI's server. The
vendored page (Danbooru-Tag-Selector.html, already carrying the bridge), the
dataset and the ledger are all self-contained inside this folder.
"""

import os
import sys

from aiohttp import web
from server import PromptServer

# make sibling modules importable regardless of how ComfyUI loads this folder
sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
import core  # noqa: E402


@PromptServer.instance.routes.get("/tag_selector/page")
async def tag_selector_page(request):
    """Serve the vendored page (upstream snapshot + bridge)."""
    html = core.read_page_html()
    if html is None:
        return web.Response(
            status=404,
            text="Danbooru-Tag-Selector.html not found — run sync_upstream.py to vendor it",
        )
    return web.Response(
        content_type="text/html",
        charset="utf-8",
        text=html,
        headers={"Cache-Control": "no-cache"},
    )


@PromptServer.instance.routes.get("/tag_selector/dataset")
async def tag_selector_dataset(request):
    """Serve the built-in tags_with_groups.csv."""
    text = core.read_dataset_text()
    if text is None:
        return web.Response(status=404, text="dataset not found")
    return web.Response(
        content_type="text/csv",
        charset="utf-8",
        text=text,
        headers={"Cache-Control": "no-cache"},
    )


@PromptServer.instance.routes.get("/tag_selector/data")
async def ledger_get(request):
    """Read the shared ledger file."""
    return web.json_response(core.load_ledger())


@PromptServer.instance.routes.post("/tag_selector/data")
async def ledger_post(request):
    """Write the shared ledger file (last write wins)."""
    try:
        body = await request.json()
    except Exception:
        return web.Response(status=400, text="invalid json")
    if not isinstance(body, dict):
        return web.Response(status=400, text="expected a JSON object")
    core.save_ledger(body)
    return web.json_response({"ok": True})


class TagSelectorPrototype:
    """Pass-through node. The UI lives in the floating iframe; the bridge
    extension keeps the node's ``text`` widget in sync with the tool."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": ("STRING", {"default": "", "multiline": True}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("tags",)
    FUNCTION = "run"
    CATEGORY = "Danbooru Tag Selector"

    def run(self, text):
        return (text,)


NODE_CLASS_MAPPINGS = {"TagSelectorPrototype": TagSelectorPrototype}
NODE_DISPLAY_NAME_MAPPINGS = {"TagSelectorPrototype": "Danbooru Tag Selector"}
WEB_DIRECTORY = "./web"

__all__ = [
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
    "WEB_DIRECTORY",
]

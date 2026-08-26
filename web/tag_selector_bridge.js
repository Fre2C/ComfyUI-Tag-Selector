// Host-side bridge for the embedded Danbooru-Tag-Selector page.
//
// Responsibilities:
//   - add a button on TagSelectorPrototype nodes (+ double-click to open)
//   - open a draggable / freely resizable floating window hosting the
//     /tag_selector/page route in an iframe
//   - relay text between the iframe (postMessage) and the node's "text" widget
//
// Window behaviour (modeled after WeiLin's editor):
//   - no fullscreen backdrop: clicking the canvas never closes it
//   - drag by the title bar, resize from 8 custom edge/corner handles
//   - closes via the close button or Escape only

import { app } from "../../scripts/app.js";

const PAGE_URL = "/tag_selector/page";
const MIN_W = 480;
const MIN_H = 300;
const RECT_KEY = "dts_floaty_rect";

// window chrome tint, kept in step with the page theme reported by the bridge
// colours mirror the page's own CSS variables (--bg / --border / --text)
const FLOATY_THEMES = {
    dark: { bg: "#0b0b12", barBorder: "#3a1a2e", text: "#eaeaea", textSoft: "#b8b8c8" },
    light: { bg: "#f5fafd", barBorder: "#b8d4e3", text: "#1a3a4a", textSoft: "#4a6b7c" },
};

function applyFloatyTheme(theme) {
    if (!panelEl) return;
    const t = FLOATY_THEMES[theme] || FLOATY_THEMES.dark;
    const bar = panelEl.querySelector(".dts-title-bar");
    const btn = bar && bar.querySelector("button");
    // tint the whole panel too: otherwise a dark strip shows below short
    // pages in light mode
    panelEl.style.background = t.bg;
    panelEl.style.borderColor = t.barBorder;
    if (bar) {
        bar.style.background = t.bg;
        bar.style.borderBottomColor = t.barBorder;
        bar.style.color = t.text;
    }
    if (btn) {
        btn.style.borderColor = t.barBorder;
        btn.style.color = t.text;
    }
}

let panelEl = null;
let floatyIframe = null;
let activeNode = null;

function getNodeTextWidget(node) {
    return (node.widgets || []).find((w) => w.name === "text");
}

function setNodeText(node, text) {
    const w = node && getNodeTextWidget(node);
    if (!w || typeof text !== "string" || w.value === text) return;
    w.value = text;
    // multiline widgets render through a DOM element; keep it in sync too,
    // otherwise the textarea on the node keeps showing the old value
    const el = w.element;
    if (el && el.value !== text) {
        el.value = text;
        el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (w.callback) w.callback(text);
    app.graph.setDirtyCanvas(true, false);
}

function hideFloaty() {
    if (panelEl) panelEl.style.display = "none";
}

function showErrorBanner(message) {
    if (!panelEl) return;
    let banner = panelEl.querySelector(".dts-error-banner");
    if (!banner) {
        banner = document.createElement("div");
        banner.className = "dts-error-banner";
        Object.assign(banner.style, {
            position: "absolute",
            top: "44px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: "4",
            background: "#8B2C1F",
            color: "#fff",
            fontFamily: "monospace",
            fontSize: "12px",
            padding: "8px 16px",
            borderRadius: "8px",
            maxWidth: "80%",
            whiteSpace: "pre-wrap",
        });
        panelEl.append(banner);
    }
    banner.textContent = message;
}

function suspendIframeEvents() {
    if (floatyIframe) floatyIframe.style.pointerEvents = "none";
}

function resumeIframeEvents() {
    if (floatyIframe) floatyIframe.style.pointerEvents = "";
}

function saveRect() {
    if (!panelEl || panelEl.style.display === "none") return;
    const r = panelEl.getBoundingClientRect();
    try {
        localStorage.setItem(RECT_KEY, JSON.stringify({ l: r.left, t: r.top, w: r.width, h: r.height }));
    } catch (err) {}
}

function trackDrag(onMove) {
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", function onUp() {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        resumeIframeEvents();
        saveRect();
    });
}

function startResize(e, dir) {
    e.preventDefault();
    e.stopPropagation();
    const rect = panelEl.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    suspendIframeEvents();
    trackDrag((ev) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        let left = rect.left;
        let top = rect.top;
        let w = rect.width;
        let h = rect.height;
        if (dir.includes("e")) w = Math.max(MIN_W, rect.width + dx);
        if (dir.includes("s")) h = Math.max(MIN_H, rect.height + dy);
        if (dir.includes("w")) {
            w = Math.max(MIN_W, rect.width - dx);
            left = rect.left + (rect.width - w);
        }
        if (dir.includes("n")) {
            h = Math.max(MIN_H, rect.height - dy);
            top = rect.top + (rect.height - h);
        }
        panelEl.style.left = left + "px";
        panelEl.style.top = top + "px";
        panelEl.style.width = w + "px";
        panelEl.style.height = h + "px";
    });
}

function makeResizeHandles() {
    const handles = [];
    for (const dir of ["n", "s", "e", "w", "ne", "nw", "se", "sw"]) {
        const h = document.createElement("div");
        Object.assign(h.style, { position: "absolute", zIndex: "3" });
        // handles sit just inside the frame so overflow:hidden keeps them
        const corner = { width: "18px", height: "18px" };
        const edgeT = "7px";
        switch (dir) {
            case "n":  Object.assign(h.style, { top: "0", left: "12px", right: "12px", height: edgeT, cursor: "ns-resize" }); break;
            case "s":  Object.assign(h.style, { bottom: "0", left: "12px", right: "12px", height: edgeT, cursor: "ns-resize" }); break;
            case "e":  Object.assign(h.style, { right: "0", top: "12px", bottom: "12px", width: edgeT, cursor: "ew-resize" }); break;
            case "w":  Object.assign(h.style, { left: "0", top: "12px", bottom: "12px", width: edgeT, cursor: "ew-resize" }); break;
            case "ne": Object.assign(h.style, { right: "0", top: "0", cursor: "nesw-resize", ...corner }); break;
            case "nw": Object.assign(h.style, { left: "0", top: "0", cursor: "nwse-resize", ...corner }); break;
            case "se": Object.assign(h.style, { right: "0", bottom: "0", cursor: "nwse-resize", ...corner }); break;
            case "sw": Object.assign(h.style, { left: "0", bottom: "0", cursor: "nesw-resize", ...corner }); break;
        }
        h.addEventListener("mousedown", (e) => startResize(e, dir));
        handles.push(h);
    }
    return handles;
}

function makeTitleBar() {
    const bar = document.createElement("div");
    Object.assign(bar.style, {
        flex: "0 0 36px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 10px 0 14px",
        background: "#161622",
        borderBottom: "1px solid #3a1a2e",
        fontFamily: "monospace",
        fontSize: "12px",
        color: "#b8b8c8",
        userSelect: "none",
        cursor: "move",
        transition: "background-color .3s ease, border-color .3s ease, color .3s ease",
    });

    const title = document.createElement("span");
    title.textContent = "Danbooru Tag Selector";

    const status = document.createElement("span");
    status.id = "dts-ledger-status";
    status.style.marginLeft = "auto";
    status.style.marginRight = "14px";
    status.style.fontSize = "11px";
    status.style.color = "#6a6a7e";
    status.textContent = "○ 连接中…";

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "✕";
    closeBtn.title = "close (Esc)";
    Object.assign(closeBtn.style, {
        border: "1px solid #3a1a2e",
        borderRadius: "6px",
        background: "transparent",
        color: "#b8b8c8",
        fontSize: "13px",
        lineHeight: "1",
        padding: "5px 9px",
        cursor: "pointer",
        transition: "background-color .3s ease, border-color .3s ease, color .3s ease",
    });
    closeBtn.addEventListener("click", hideFloaty);

    bar.className = "dts-title-bar";
    bar.append(title, status, closeBtn);

    // drag-to-move; pointer events on the iframe are suspended while
    // dragging so mouse events keep flowing to the window handlers
    bar.addEventListener("mousedown", (e) => {
        if (e.target === closeBtn) return;
        e.preventDefault();
        const rect = panelEl.getBoundingClientRect();
        const startX = e.clientX;
        const startY = e.clientY;
        suspendIframeEvents();
        trackDrag((ev) => {
            panelEl.style.left =
                Math.min(window.innerWidth - 80, Math.max(80 - rect.width, rect.left + ev.clientX - startX)) + "px";
            panelEl.style.top =
                Math.min(window.innerHeight - 40, Math.max(0, rect.top + ev.clientY - startY)) + "px";
        });
    });

    return bar;
}

function ensurePanel() {
    if (panelEl) return;

    panelEl = document.createElement("div");
    Object.assign(panelEl.style, {
        position: "fixed",
        zIndex: "99999",
        width: "min(1700px, 92vw)",
        height: "min(1200px, 90vh)",
        minWidth: MIN_W + "px",
        minHeight: MIN_H + "px",
        maxWidth: "97vw",
        maxHeight: "97vh",
        background: "#0b0b12",
        border: "1px solid #3a1a2e",
        borderRadius: "14px",
        boxShadow: "0 16px 56px rgba(0,0,0,.55)",
        overflow: "hidden",
        display: "none",
        flexDirection: "column",
        transition: "background-color .3s ease, border-color .3s ease",
    });

    floatyIframe = document.createElement("iframe");
    Object.assign(floatyIframe.style, { flex: "1", width: "100%", border: "0" });
    floatyIframe.src = PAGE_URL;

    panelEl.append(makeTitleBar(), floatyIframe, ...makeResizeHandles());
    document.body.append(panelEl);

    // messages coming from the tool page
    window.addEventListener("message", (event) => {
        if (event.origin !== window.location.origin) return;      // same-origin only
        if (!floatyIframe || event.source !== floatyIframe.contentWindow) return;
        const msg = event.data;
        if (!msg || typeof msg.type !== "string") return;
        if (msg.type === "dts_ready") {
            // tool is up; push the node's current text into it,
            // then let it pull the built-in dataset served by the plugin
            const current = activeNode ? getNodeTextWidget(activeNode)?.value ?? "" : "";
            floatyIframe.contentWindow.postMessage(
                { type: "dts_set_text", text: current },
                event.origin
            );
            floatyIframe.contentWindow.postMessage(
                { type: "dts_load_dataset", url: "/tag_selector/dataset" },
                event.origin
            );
        } else if (msg.type === "dts_text_changed" || msg.type === "dts_text") {
            setNodeText(activeNode, msg.text);
        } else if (msg.type === "dts_ledger_status") {
            const el = panelEl && panelEl.querySelector("#dts-ledger-status");
            if (el) {
                if (msg.connected) {
                    el.textContent = msg.mode === "fs" ? "● 数据已连接" : "● 数据同步中";
                    el.style.color = "#4A6B4A";
                } else {
                    el.textContent = "⚠ 同步失败: " + String(msg.error || "unknown").slice(0, 60);
                    el.style.color = "#e8a032";
                    el.title = String(msg.error || "");
                }
            }
        } else if (msg.type === "dts_theme") {
            applyFloatyTheme(msg.theme);
        }
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && panelEl && panelEl.style.display !== "none") hideFloaty();
    });
}

async function openFloaty(node) {
    activeNode = node;
    ensurePanel();
    panelEl.style.display = "flex";
    if (!panelEl.dataset.positioned) {
        // restore the remembered geometry, fall back to centring
        let saved = null;
        try { saved = JSON.parse(localStorage.getItem(RECT_KEY) || "null"); } catch (err) {}
        if (saved && saved.w >= MIN_W && saved.h >= MIN_H) {
            panelEl.style.left = Math.max(0, Math.min(saved.l, window.innerWidth - 80)) + "px";
            panelEl.style.top = Math.max(0, Math.min(saved.t, window.innerHeight - 40)) + "px";
            panelEl.style.width = saved.w + "px";
            panelEl.style.height = saved.h + "px";
        } else {
            const w = panelEl.offsetWidth || MIN_W;
            const h = panelEl.offsetHeight || MIN_H;
            panelEl.style.left = Math.max(8, (window.innerWidth - w) / 2) + "px";
            panelEl.style.top = Math.max(8, (window.innerHeight - h) / 2) + "px";
        }
        panelEl.dataset.positioned = "1";
    }

    // probe the route first so backend problems show up as a readable
    // message instead of a silent broken frame
    try {
        const resp = await fetch(PAGE_URL);
        if (!resp.ok) {
            showErrorBanner(
                `/tag_selector/page 返回 ${resp.status} — 插件后端可能未加载，请检查 ComfyUI 控制台`
            );
        }
    } catch (err) {
        showErrorBanner("无法请求 /tag_selector/page：" + err.message);
    }
}

app.registerExtension({
    name: "Fre2C.TagSelector.Bridge",
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "TagSelectorPrototype") return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
            this.addWidget("button", "🎨 open tag selector", null, () => openFloaty(this));
            return result;
        };

        // double-click the node body opens the tool too (WeiLin-style)
        const onDblClick = nodeType.prototype.onDblClick;
        nodeType.prototype.onDblClick = function () {
            const result = onDblClick ? onDblClick.apply(this, arguments) : undefined;
            openFloaty(this);
            return result;
        };
    },
});

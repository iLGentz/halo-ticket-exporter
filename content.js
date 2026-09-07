(() => {
  "use strict";

  const BUTTON_ID = "halo-ticket-export-button";
  const TOAST_ID = "halo-ticket-export-toast";
  const HISTORY_ITEM_SELECTOR = "#tickethistoryscroll .action-history-item";
  const HISTORY_SCROLL_SELECTOR = "#tickethistoryscroll .infinite-scroll-component";

  let exporting = false;
  let ensureButtonTimer = null;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function normalizeSpace(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function getTicketId() {
    const candidates = document.querySelectorAll("h1.profile-full-name");
    for (const element of candidates) {
      const match = normalizeSpace(element.textContent).match(/\[ID:(\d+)\]/i);
      if (match) return match[1];
    }
    return null;
  }

  function getTicketTitleHost() {
    const candidates = document.querySelectorAll("h1.profile-full-name");
    for (const element of candidates) {
      if (/\[ID:\d+\]/i.test(normalizeSpace(element.textContent))) return element;
    }
    return null;
  }

  function showToast(message, type = "info", timeout = 3200) {
    let toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = document.createElement("div");
      toast.id = TOAST_ID;
      document.documentElement.appendChild(toast);
    }

    toast.dataset.type = type;
    toast.textContent = message;

    window.clearTimeout(showToast._timer);
    showToast._timer = window.setTimeout(() => {
      toast?.remove();
    }, timeout);
  }

  function ensureExportButton() {
    const ticketId = getTicketId();
    const host = getTicketTitleHost();
    const existing = document.getElementById(BUTTON_ID);

    document.querySelectorAll(".halo-ticket-export-title").forEach((element) => {
      if (element !== host) element.classList.remove("halo-ticket-export-title");
    });

    if (!ticketId || !host) {
      existing?.remove();
      return;
    }

    host.classList.add("halo-ticket-export-title");

    if (existing) {
      existing.dataset.ticketId = ticketId;
      existing.title = `Esporta la chat del ticket ${ticketId} in HTML`;
      if (existing.parentElement !== host) host.appendChild(existing);
      return;
    }

    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.dataset.ticketId = ticketId;
    button.textContent = "Esporta ticket";
    button.title = `Esporta la chat del ticket ${ticketId} in HTML`;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      exportCurrentTicket(button);
    });
    host.appendChild(button);
  }

  function scheduleEnsureButton() {
    window.clearTimeout(ensureButtonTimer);
    ensureButtonTimer = window.setTimeout(ensureExportButton, 120);
  }

  function dispatchScroll(scroller) {
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
  }

  async function sweepScroller(scroller, target, maxRounds = 24) {
    let stableRounds = 0;
    let lastCount = -1;
    let lastHeight = -1;

    for (let round = 0; round < maxRounds && stableRounds < 4; round += 1) {
      scroller.scrollTop = target === "bottom" ? scroller.scrollHeight : 0;
      dispatchScroll(scroller);
      await sleep(350);

      const count = document.querySelectorAll(HISTORY_ITEM_SELECTOR).length;
      const height = scroller.scrollHeight;

      if (count === lastCount && height === lastHeight) {
        stableRounds += 1;
      } else {
        stableRounds = 0;
      }

      lastCount = count;
      lastHeight = height;
    }
  }

  async function loadFullHistory() {
    const scroller = document.querySelector(HISTORY_SCROLL_SELECTOR);
    if (!scroller) return;

    const originalTop = scroller.scrollTop;

    // HALO mostra normalmente le azioni piu recenti in alto. Facciamo comunque
    // entrambe le direzioni per tollerare cambiamenti di ordinamento/configurazione.
    await sweepScroller(scroller, "bottom");
    await sweepScroller(scroller, "top", 10);
    await sweepScroller(scroller, "bottom", 10);

    scroller.scrollTop = Math.min(originalTop, Math.max(0, scroller.scrollHeight - scroller.clientHeight));
    dispatchScroll(scroller);
    await sleep(150);
  }

  function getOrderedHistoryItems() {
    const items = Array.from(document.querySelectorAll(HISTORY_ITEM_SELECTOR));
    if (!items.length) return [];

    const allHaveNumericIds = items.every((item) => /^\d+$/.test(item.dataset.id || item.id || ""));

    if (allHaveNumericIds) {
      return items.sort((a, b) => {
        const aId = Number(a.dataset.id || a.id);
        const bId = Number(b.dataset.id || b.id);
        return aId - bId;
      });
    }

    // Nel DOM HALO osservato: piu recente -> piu vecchio.
    return items.reverse();
  }

  function hasMeaningfulContent(root) {
    if (!root) return false;
    const text = normalizeSpace(root.textContent);
    return Boolean(text || root.querySelector("img, table, hr, svg"));
  }

  async function waitForIframeBody(iframe, timeoutMs = 1800) {
    const started = Date.now();
    let lastBody = null;

    while (Date.now() - started < timeoutMs) {
      try {
        const doc = iframe.contentDocument;
        if (doc?.body) {
          lastBody = doc.body;
          if (hasMeaningfulContent(doc.body)) return doc.body;
        }
      } catch (_error) {
        return null;
      }
      await sleep(120);
    }

    return lastBody;
  }

  function sanitizeMessageTree(root) {
    root.querySelectorAll(
      "script, style, iframe, object, embed, form, input, button, textarea, select, link, meta, base, video, audio"
    ).forEach((element) => element.remove());

    root.querySelectorAll("*").forEach((element) => {
      for (const attribute of Array.from(element.attributes)) {
        const name = attribute.name.toLowerCase();
        const value = attribute.value.trim().toLowerCase();

        if (name.startsWith("on")) {
          element.removeAttribute(attribute.name);
          continue;
        }

        if ((name === "href" || name === "src") && value.startsWith("javascript:")) {
          element.removeAttribute(attribute.name);
        }
      }

      if (element.tagName === "A") {
        element.setAttribute("target", "_blank");
        element.setAttribute("rel", "noopener noreferrer");
      }
    });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error || new Error("Impossibile leggere l'immagine"));
      reader.readAsDataURL(blob);
    });
  }

  async function mapWithConcurrency(items, concurrency, worker) {
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        await worker(items[index], index);
      }
    });
    await Promise.all(workers);
  }

  async function inlineImages(root) {
    const images = Array.from(root.querySelectorAll("img"));
    let embedded = 0;
    let failed = 0;

    await mapWithConcurrency(images, 4, async (img) => {
      img.removeAttribute("srcset");
      img.removeAttribute("loading");

      let source = img.getAttribute("src") || "";
      source = source.trim();
      if (!source) return;

      if (source.startsWith("data:")) {
        embedded += 1;
        return;
      }

      let absoluteUrl;
      try {
        absoluteUrl = new URL(source, root.ownerDocument?.baseURI || location.href).href;
      } catch (_error) {
        failed += 1;
        return;
      }

      try {
        const response = await fetch(absoluteUrl, {
          credentials: "include",
          cache: "no-store"
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const blob = await response.blob();
        const dataUrl = await blobToDataUrl(blob);
        img.setAttribute("src", dataUrl);
        embedded += 1;
      } catch (error) {
        console.warn("[HALO Ticket Exporter] Immagine non incorporata:", absoluteUrl, error);
        // Manteniamo l'URL originale come fallback: l'immagine potra ancora
        // essere visibile finche il token/sessione HALO resta valido.
        img.setAttribute("src", absoluteUrl);
        failed += 1;
      }
    });

    return { embedded, failed };
  }

  async function extractAction(item) {
    const when = normalizeSpace(item.querySelector(".history-header .when")?.textContent);
    const who = normalizeSpace(item.querySelector(".history-header .who")?.textContent);
    const outcome = normalizeSpace(item.querySelector(".history-header .outcome")?.textContent);
    const isPrivate = item.classList.contains("action-history-private");
    const actionContent = item.querySelector(".history-details .actioncontent");

    if (!actionContent) return null;

    const iframe = actionContent.querySelector("iframe.halo-html-renderer");
    let contentRoot = null;

    if (iframe) {
      const body = await waitForIframeBody(iframe);
      if (!body || !hasMeaningfulContent(body)) return null;
      contentRoot = body.cloneNode(true);
    } else {
      const clone = actionContent.cloneNode(true);
      if (!hasMeaningfulContent(clone)) return null;
      contentRoot = clone;
    }

    sanitizeMessageTree(contentRoot);
    const imageStats = await inlineImages(contentRoot);

    if (!hasMeaningfulContent(contentRoot)) return null;

    return {
      id: item.dataset.id || item.id || "",
      when,
      who,
      outcome,
      isPrivate,
      html: contentRoot.innerHTML,
      imageStats
    };
  }

  function buildExportHtml(ticketId, actions) {
    const actionHtml = actions.map((action) => {
      const privateBadge = action.isPrivate
        ? '<span class="badge badge-private">Nota interna</span>'
        : "";

      return `
        <article class="message ${action.isPrivate ? "message-private" : ""}">
          <header class="message-header">
            <div class="message-main-meta">
              <strong>${escapeHtml(action.who || "Messaggio")}</strong>
              ${privateBadge}
            </div>
            <div class="message-sub-meta">
              ${action.when ? `<span>${escapeHtml(action.when)}</span>` : ""}
              ${action.outcome ? `<span>${escapeHtml(action.outcome)}</span>` : ""}
            </div>
          </header>
          <div class="message-body">${action.html}</div>
        </article>`;
    }).join("\n");

    return `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Ticket ${escapeHtml(ticketId)}</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Arial, Helvetica, sans-serif;
      background: #f4f6f8;
      color: #1e252b;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #f4f6f8;
      color: #1e252b;
    }
    .page {
      width: min(980px, calc(100% - 32px));
      margin: 32px auto 64px;
    }
    .ticket-header {
      margin-bottom: 22px;
      padding: 22px 24px;
      border: 1px solid #d9e0e5;
      border-radius: 10px;
      background: #fff;
      box-shadow: 0 2px 8px rgba(0,0,0,.05);
    }
    .ticket-header h1 {
      margin: 0;
      font-size: 24px;
      line-height: 1.2;
    }
    .ticket-header p {
      margin: 8px 0 0;
      color: #64717c;
      font-size: 13px;
    }
    .message {
      overflow: hidden;
      margin: 0 0 16px;
      border: 1px solid #d9e0e5;
      border-radius: 10px;
      background: #fff;
      box-shadow: 0 2px 8px rgba(0,0,0,.04);
    }
    .message-private {
      border-left: 5px solid #8b78da;
    }
    .message-header {
      padding: 13px 16px;
      border-bottom: 1px solid #e6eaed;
      background: #fafbfc;
    }
    .message-main-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      font-size: 14px;
    }
    .message-sub-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 14px;
      margin-top: 4px;
      color: #687681;
      font-size: 12px;
    }
    .badge {
      display: inline-block;
      border-radius: 999px;
      padding: 3px 7px;
      font-size: 11px;
      font-weight: 700;
    }
    .badge-private {
      background: #eeeafd;
      color: #55428f;
    }
    .message-body {
      overflow-wrap: anywhere;
      padding: 18px 18px 20px;
      font-size: 14px;
      line-height: 1.5;
    }
    .message-body img {
      display: block;
      max-width: 100% !important;
      height: auto !important;
      margin: 10px 0;
      object-fit: contain;
    }
    .message-body table {
      max-width: 100% !important;
      border-collapse: collapse;
    }
    .message-body pre {
      overflow-x: auto;
      white-space: pre-wrap;
    }
    .message-body a {
      color: #176fa3;
    }
    @media print {
      body { background: #fff; }
      .page { width: 100%; margin: 0; }
      .ticket-header, .message { box-shadow: none; }
      .message { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <main class="page">
    <section class="ticket-header">
      <h1>Ticket ${escapeHtml(ticketId)}</h1>
      <p>${actions.length} messaggi/note esportati</p>
    </section>
    ${actionHtml}
  </main>
</body>
</html>`;
  }

  function downloadHtml(filename, html) {
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    document.documentElement.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  async function exportCurrentTicket(button) {
    if (exporting) return;

    exporting = true;
    const originalLabel = button.textContent;
    button.disabled = true;

    try {
      const ticketId = getTicketId();
      if (!ticketId) throw new Error("Numero ticket non trovato nella pagina.");

      button.textContent = "Carico cronologia...";
      showToast(`Preparazione ticket ${ticketId}...`, "info", 8000);
      await loadFullHistory();

      const items = getOrderedHistoryItems();
      if (!items.length) throw new Error("Nessuna azione trovata nella cronologia del ticket.");

      const actions = [];
      let failedImages = 0;

      for (let index = 0; index < items.length; index += 1) {
        button.textContent = `Esporto ${index + 1}/${items.length}...`;
        const action = await extractAction(items[index]);
        if (!action) continue;
        failedImages += action.imageStats.failed;
        actions.push(action);
      }

      if (!actions.length) {
        throw new Error("Non ho trovato messaggi, note o immagini esportabili negli iframe HALO.");
      }

      const html = buildExportHtml(ticketId, actions);
      downloadHtml(`${ticketId}.html`, html);

      if (failedImages > 0) {
        showToast(
          `Ticket ${ticketId} esportato. ${failedImages} immagine/i non sono state incorporate e usano ancora il link HALO.`,
          "error",
          8000
        );
      } else {
        showToast(`Ticket ${ticketId} esportato: ${actions.length} messaggi/note.`, "info", 4500);
      }
    } catch (error) {
      console.error("[HALO Ticket Exporter]", error);
      showToast(`Errore esportazione: ${error.message || error}`, "error", 8000);
    } finally {
      exporting = false;
      button.disabled = false;
      button.textContent = originalLabel;
      scheduleEnsureButton();
    }
  }

  const observer = new MutationObserver(scheduleEnsureButton);
  observer.observe(document.documentElement, {
    childList: true,
    characterData: true,
    subtree: true
  });

  ensureExportButton();
})();

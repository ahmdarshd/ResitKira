// ---------- State ----------
let activeCategories = DEFAULT_LHDN_CATEGORIES;
let pendingReview = null; // { imageBlob, merchant, date, amount, matches, sourceText }

// ---------- Init ----------
(async function init() {
  await loadSettingsIntoForm();
  await loadCategoryCache();
  updateNetBadge();
  renderLedger();
  renderDonationList();
  wireEvents();
  registerServiceWorker();
})();

function wireEvents() {
  window.addEventListener("online", updateNetBadge);
  window.addEventListener("offline", updateNetBadge);

  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });
  document.getElementById("settingsBtn").addEventListener("click", () => switchView("settings"));

  document.getElementById("fileInput").addEventListener("change", onFileSelected);

  document.getElementById("reviewCancel").addEventListener("click", closeReviewModal);
  document.getElementById("reviewSave").addEventListener("click", saveReviewedReceipt);

  document.getElementById("geminiKey").addEventListener("change", e => Db.saveSetting("geminiKey", e.target.value));
  document.getElementById("geminiModel").addEventListener("change", e => Db.saveSetting("geminiModel", e.target.value));
  document.getElementById("refreshUrl").addEventListener("change", e => Db.saveSetting("refreshUrl", e.target.value));
  document.getElementById("refreshNowBtn").addEventListener("click", refreshLhdnList);

  document.getElementById("yearFilter").addEventListener("change", renderLedger);
  document.getElementById("exportCsvBtn").addEventListener("click", exportLedgerCsv);
  document.getElementById("exportZipBtn").addEventListener("click", (e) => exportReceiptsZip(false, e.target));
  document.getElementById("backupAllBtn").addEventListener("click", (e) => exportReceiptsZip(true, e.target));
  document.getElementById("restoreZipInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (file) importReceiptsZip(file);
  });

  // Donation
  document.getElementById("donationFileInput").addEventListener("change", onDonationFileSelected);
  document.getElementById("donationReviewCancel").addEventListener("click", closeDonationReviewModal);
  document.getElementById("donationReviewSave").addEventListener("click", saveReviewedDonation);
  document.getElementById("donationYearFilter").addEventListener("change", renderDonationList);
  document.getElementById("donationViewerClose").addEventListener("click", closeDonationImageViewer);

  // Tax calculation
  const taxInputs = ["taxSalaryInput", "taxZakatInput", "taxOtherReliefsInput", "taxPersonalReliefToggle"];
  taxInputs.forEach(id => {
    document.getElementById(id).addEventListener("input", () => { saveTaxCalcInputs(); renderTaxCalc(); });
    document.getElementById(id).addEventListener("change", () => { saveTaxCalcInputs(); renderTaxCalc(); });
  });
  document.getElementById("taxCalcYearFilter").addEventListener("change", async () => {
    await loadTaxCalcInputsForYear();
    renderTaxCalc();
  });
  document.getElementById("viewerClose").addEventListener("click", closeImageViewer);
}

function switchView(name) {
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.view === name));
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === `view-${name}`));
  if (name === "ledger") renderLedger();
  if (name === "donation") renderDonationList();
  if (name === "taxcalc") renderTaxCalc();
}

// ---------- Connectivity ----------
function updateNetBadge() {
  const el = document.getElementById("netStatus");
  const online = navigator.onLine;
  el.textContent = online ? "online — Gemini" : "offline — local matching";
  el.className = "net-badge " + (online ? "online" : "offline");
}

// ---------- Settings ----------
async function loadSettingsIntoForm() {
  const key = await Db.getSetting("geminiKey");
  const model = await Db.getSetting("geminiModel");
  const refreshUrl = await Db.getSetting("refreshUrl");
  if (key) document.getElementById("geminiKey").value = key;
  document.getElementById("geminiModel").value = model || "gemini-2.5-flash";
  if (!model) await Db.saveSetting("geminiModel", "gemini-2.5-flash");
  if (refreshUrl) document.getElementById("refreshUrl").value = refreshUrl;
  document.getElementById("bundledVersion").textContent = LHDN_DATA_VERSION;

  const lastRefreshed = await Db.getSetting("lhdnLastRefreshed");
  if (lastRefreshed) {
    document.getElementById("refreshedInfo").textContent = `Last refreshed online: ${new Date(lastRefreshed).toLocaleString()}`;
  }
}

async function loadCategoryCache() {
  const cached = await Db.getSetting("lhdnCategories");
  activeCategories = cached && cached.length ? cached : DEFAULT_LHDN_CATEGORIES;
}

async function refreshLhdnList() {
  const btn = document.getElementById("refreshNowBtn");
  const url = document.getElementById("refreshUrl").value.trim();
  if (!url) {
    alert("Enter a refresh URL first — a JSON file you host with an updated 'categories' array.");
    return;
  }
  btn.disabled = true;
  btn.textContent = "Refreshing…";
  try {
    const data = await refreshLhdnData(url);
    activeCategories = data.categories;
    await Db.saveSetting("lhdnCategories", activeCategories);
    await Db.saveSetting("lhdnLastRefreshed", new Date().toISOString());
    document.getElementById("refreshedInfo").textContent = `Last refreshed online: ${new Date().toLocaleString()}`;
    alert(`Relief list refreshed: ${activeCategories.length} categories loaded.`);
  } catch (e) {
    alert("Couldn't refresh: " + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Refresh now";
  }
}

// ---------- Capture flow ----------
async function onFileSelected(e) {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;

  const statusEl = document.getElementById("captureStatus");
  statusEl.hidden = false;
  statusEl.className = "capture-status";

  try {
    if (navigator.onLine) {
      const geminiKey = await Db.getSetting("geminiKey");
      const model = (await Db.getSetting("geminiModel")) || "gemini-2.5-flash";
      if (geminiKey) {
        statusEl.textContent = "Reading receipt with Gemini…";
        const result = await analyzeReceiptWithGemini({ apiKey: geminiKey, model, imageBlob: file, categories: activeCategories });
        openReviewModal({
          imageBlob: file,
          merchant: result.merchant,
          date: result.date,
          amount: result.amount,
          matches: (result.matches || []).map(m => {
            const cat = activeCategories.find(c => c.id === m.categoryId);
            return { categoryId: m.categoryId, label: cat ? cat.label : m.categoryId, confidence: m.confidence, matchedKeywords: [m.matchedItemText].filter(Boolean) };
          }),
          sourceText: (result.items || []).join(", "),
          viaGemini: true
        });
        statusEl.hidden = true;
        return;
      }
      statusEl.textContent = "Online, but no Gemini key set — using local matching instead.";
    } else {
      statusEl.textContent = "Offline — reading receipt locally…";
    }

    const text = await ocrImage(file);
    const matches = matchCategoriesOffline(text, activeCategories);
    openReviewModal({
      imageBlob: file,
      merchant: "",
      date: new Date().toISOString().slice(0, 10),
      amount: guessAmount(text),
      matches,
      sourceText: text.slice(0, 500),
      viaGemini: false
    });
    statusEl.hidden = true;
  } catch (err) {
    statusEl.textContent = "Couldn't process this receipt: " + err.message;
    statusEl.className = "capture-status error";
  }
}

function openReviewModal({ imageBlob, merchant, date, amount, matches, sourceText, viaGemini }) {
  pendingReview = { imageBlob, matches };
  document.getElementById("reviewImg").src = URL.createObjectURL(imageBlob);
  document.getElementById("reviewMerchant").value = merchant || "";
  document.getElementById("reviewDate").value = date || new Date().toISOString().slice(0, 10);
  document.getElementById("reviewAmount").value = amount ?? "";

  const wrap = document.getElementById("reviewCategories");
  wrap.innerHTML = "";
  if (!matches.length) {
    wrap.innerHTML = `<p class="empty-note">No LHDN category matched automatically. You can still save it as uncategorized, or check the receipt manually.</p>`;
  }
  const splitDefault = (amount && matches.length) ? (amount / matches.length).toFixed(2) : "";
  matches.forEach((m, i) => {
    const row = document.createElement("label");
    row.className = "cat-option";
    row.innerHTML = `
      <input type="checkbox" data-idx="${i}" checked />
      <span class="cat-option-label">
        <span>${m.label}</span>
        <span class="conf">${Math.round((m.confidence || 0) * 100)}% match${m.matchedKeywords && m.matchedKeywords.length ? " — " + escapeHtml(m.matchedKeywords[0]) : ""}</span>
      </span>
      <input type="number" step="0.01" class="cat-amount" data-idx="${i}" value="${splitDefault}" placeholder="RM" />
    `;
    wrap.appendChild(row);
  });
  if (matches.length > 1) {
    const hint = document.createElement("p");
    hint.className = "source-note";
    hint.textContent = "Multiple categories matched — the amount is split evenly as a starting point. Edit each field to reflect what was actually spent per category.";
    wrap.appendChild(hint);
  }

  document.getElementById("reviewSourceNote").textContent = viaGemini
    ? "Read via Gemini."
    : `Read via on-device OCR — unconfirmed. ${sourceText ? "Detected text: " + sourceText.slice(0, 150) + "…" : ""}`;

  document.getElementById("reviewModal").hidden = false;
}

function closeReviewModal() {
  document.getElementById("reviewModal").hidden = true;
  pendingReview = null;
}

async function saveReviewedReceipt() {
  if (!pendingReview) return;
  const merchant = document.getElementById("reviewMerchant").value.trim();
  const date = document.getElementById("reviewDate").value;
  const amountRaw = document.getElementById("reviewAmount").value;
  const totalAmount = amountRaw ? parseFloat(amountRaw) : null;

  const checkedRows = [...document.querySelectorAll("#reviewCategories input[type=checkbox]:checked")];
  const checked = checkedRows.map(cb => {
    const idx = parseInt(cb.dataset.idx, 10);
    const amountInput = document.querySelector(`#reviewCategories input.cat-amount[data-idx="${idx}"]`);
    const catAmount = amountInput && amountInput.value ? parseFloat(amountInput.value) : totalAmount;
    return { ...pendingReview.matches[idx], amount: catAmount };
  });

  const year = date ? new Date(date).getFullYear() : new Date().getFullYear();

  await Db.saveReceiptGroup({
    imageBlob: pendingReview.imageBlob,
    merchant,
    date,
    amount: totalAmount,
    year,
    categories: checked,
    confirmed: true
  });

  closeReviewModal();
  switchView("ledger");
}

// ---------- Ledger ----------
async function renderLedger() {
  const all = await Db.getAllReceipts();
  const years = [...new Set(all.map(r => r.year))].sort((a, b) => b - a);
  const yearSelect = document.getElementById("yearFilter");
  const currentYear = new Date().getFullYear();
  const yearOptions = years.length ? years : [currentYear];
  const prevSelection = yearSelect.value;
  yearSelect.innerHTML = yearOptions.map(y => `<option value="${y}">${y}</option>`).join("");
  yearSelect.value = yearOptions.includes(parseInt(prevSelection, 10)) ? prevSelection : String(yearOptions[0]);

  const selectedYear = parseInt(yearSelect.value, 10);
  const filtered = all.filter(r => r.year === selectedYear);

  const byCategory = new Map();
  for (const cat of activeCategories) byCategory.set(cat.id, { cat, receipts: [] });
  for (const r of filtered) {
    if (!byCategory.has(r.categoryId)) {
      byCategory.set(r.categoryId, { cat: { id: r.categoryId, label: r.categoryLabel || r.categoryId, cap: null, capNote: "" }, receipts: [] });
    }
    byCategory.get(r.categoryId).receipts.push(r);
  }

  const list = document.getElementById("ledgerList");
  list.innerHTML = "";
  const nonEmpty = [...byCategory.values()].filter(g => g.receipts.length > 0);

  if (!nonEmpty.length) {
    list.innerHTML = `<p class="empty-note">No receipts filed for ${selectedYear} yet. Capture one from the Capture tab.</p>`;
    return;
  }

  for (const group of nonEmpty) {
    const total = group.receipts.reduce((s, r) => s + (r.amount || 0), 0);
    const cap = group.cat.cap;
    const pct = cap ? Math.min((total / cap) * 100, 100) : 0;
    const overCap = cap && total > cap;

    const card = document.createElement("div");
    card.className = "ledger-cat" + (overCap ? " over-cap" : "");
    card.innerHTML = `
      <div class="ledger-cat-head">
        <div>
          <h3>${group.cat.label}</h3>
          <div style="font-size:0.75rem;color:var(--ink-soft)">${group.cat.capNote || ""}</div>
        </div>
        <div class="amounts">
          <div>RM ${total.toFixed(2)}${cap ? " / RM " + cap.toFixed(2) : ""}</div>
          <div>${group.receipts.length} receipt${group.receipts.length > 1 ? "s" : ""}</div>
        </div>
      </div>
      ${cap ? `<div class="cap-bar"><div class="cap-bar-fill" style="width:${pct}%"></div></div>` : ""}
      <div class="ledger-receipts" hidden></div>
    `;
    const head = card.querySelector(".ledger-cat-head");
    const receiptsWrap = card.querySelector(".ledger-receipts");
    head.addEventListener("click", () => { receiptsWrap.hidden = !receiptsWrap.hidden; });

    for (const r of group.receipts.sort((a, b) => (b.date || "").localeCompare(a.date || ""))) {
      const row = document.createElement("div");
      row.className = "ledger-receipt-row";
      row.innerHTML = `
        <img class="thumb" alt="Receipt photo" />
        <div class="info">
          <strong>${escapeHtml(r.merchant || "Unknown merchant")}</strong>
          <span>${r.date || ""} · RM ${(r.amount || 0).toFixed(2)}</span>
          ${!r.confirmed ? '<span class="unconfirmed">unconfirmed — from offline OCR</span>' : ""}
        </div>
        <button class="remove-btn" data-id="${r.id}">Remove</button>
      `;
      const imgEl = row.querySelector("img.thumb");
      Db.getImage(r.groupId).then(blob => {
        if (blob) imgEl.src = URL.createObjectURL(blob);
      });
      imgEl.addEventListener("click", () => {
        if (imgEl.src) openImageViewer(imgEl.src, r);
      });
      row.querySelector(".remove-btn").addEventListener("click", async (ev) => {
        ev.stopPropagation();
        await Db.deleteReceiptRecord(r.id);
        renderLedger();
      });
      receiptsWrap.appendChild(row);
    }

    list.appendChild(card);
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- Image viewer ----------
function openImageViewer(src, receipt) {
  document.getElementById("viewerImg").src = src;
  document.getElementById("viewerCaption").textContent =
    `${receipt.merchant || "Unknown merchant"} · ${receipt.date || ""} · RM ${(receipt.amount || 0).toFixed(2)} · ${receipt.categoryLabel || ""}`;
  document.getElementById("viewerDownload").onclick = () => {
    const a = document.createElement("a");
    a.href = src;
    const safeName = (receipt.merchant || "receipt").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    a.download = `${safeName || "receipt"}-${receipt.date || "undated"}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  document.getElementById("imageViewerModal").hidden = false;
}

function closeImageViewer() {
  document.getElementById("imageViewerModal").hidden = true;
}

// ---------- CSV export ----------
function buildCsvContent(rows) {
  const header = ["Category", "Merchant", "Date", "Amount (RM)", "Confirmed", "Notes"];
  const csvRows = rows
    .sort((a, b) => (a.categoryLabel || "").localeCompare(b.categoryLabel || "") || (a.date || "").localeCompare(b.date || ""))
    .map(r => [
      r.categoryLabel || r.categoryId,
      r.merchant || "Unknown merchant",
      r.date || "",
      (r.amount || 0).toFixed(2),
      r.confirmed ? "Yes" : "Unconfirmed (offline OCR)",
      (r.matchedKeywords || []).join("; ")
    ]);
  return [header, ...csvRows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\r\n");
}

function sanitizeFileName(str) {
  return String(str).replace(/[^a-z0-9]+/gi, "-").toLowerCase().replace(/^-+|-+$/g, "") || "unnamed";
}

async function exportLedgerCsv() {
  const all = await Db.getAllReceipts();
  const yearSelect = document.getElementById("yearFilter");
  const selectedYear = parseInt(yearSelect.value, 10);
  const rows = all.filter(r => r.year === selectedYear);

  if (!rows.length) {
    alert(`No receipts to export for ${selectedYear}.`);
    return;
  }

  const csvContent = buildCsvContent(rows);
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `resitkira-relief-ledger-${selectedYear}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------- ZIP export (all receipt images, one folder per category) ----------
async function exportReceiptsZip(allYears = false, triggerBtn = null) {
  const btn = triggerBtn || document.getElementById("exportZipBtn");
  const yearSelect = document.getElementById("yearFilter");
  const selectedYear = parseInt(yearSelect.value, 10);

  const all = await Db.getAllReceipts();
  const rows = allYears ? all : all.filter(r => r.year === selectedYear);
  const allDonationsCheck = await Db.getAllDonations();
  const donationRowsCheck = allYears ? allDonationsCheck : allDonationsCheck.filter(d => d.year === selectedYear);

  if (!rows.length && !donationRowsCheck.length) {
    alert(allYears ? "No receipts or donations saved yet — nothing to back up." : `Nothing to zip for ${selectedYear}.`);
    return;
  }
  if (typeof JSZip === "undefined") {
    alert("The zip library hasn't loaded yet — check your connection and try again in a moment (it only needs to load once, then it's cached for offline use).");
    return;
  }

  btn.disabled = true;
  const originalLabel = btn.textContent;

  try {
    const zip = new JSZip();
    const manifest = [];
    // Track how many times a filename has been used within a folder so duplicates don't overwrite each other.
    const nameCounts = new Map();

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      btn.textContent = `Zipping ${i + 1}/${rows.length}…`;

      const blob = await Db.getImage(r.groupId);
      if (!blob) continue;

      const catFolder = sanitizeFileName(r.categoryLabel || r.categoryId || "uncategorized");
      const folderName = allYears ? `${r.year}/${catFolder}` : catFolder;
      const ext = (blob.type && blob.type.includes("png")) ? "png" : "jpg";
      let baseName = `${sanitizeFileName(r.merchant)}-${r.date || "undated"}`;
      const countKey = `${folderName}/${baseName}`;
      const count = nameCounts.get(countKey) || 0;
      nameCounts.set(countKey, count + 1);
      const fileName = count === 0 ? `${baseName}.${ext}` : `${baseName}-${count + 1}.${ext}`;
      const zipPath = `${folderName}/${fileName}`;

      zip.folder(folderName).file(fileName, blob);
      manifest.push({
        type: "relief",
        zipPath,
        groupId: r.groupId,
        categoryId: r.categoryId,
        categoryLabel: r.categoryLabel,
        merchant: r.merchant,
        date: r.date,
        amount: r.amount,
        year: r.year,
        confirmed: r.confirmed,
        matchedKeywords: r.matchedKeywords || [],
        sourceText: r.sourceText || ""
      });
    }

    // Donations are backed up alongside relief receipts so a single zip is a complete restore point.
    const allDonations = await Db.getAllDonations();
    const donationRows = allYears ? allDonations : allDonations.filter(d => d.year === selectedYear);
    const donationNameCounts = new Map();

    for (let i = 0; i < donationRows.length; i++) {
      const d = donationRows[i];
      btn.textContent = `Zipping donations ${i + 1}/${donationRows.length}…`;

      const blob = await Db.getImage(d.groupId);
      if (!blob) continue;

      const folderName = allYears ? `${d.year}/donations` : "donations";
      const ext = (blob.type && blob.type.includes("png")) ? "png" : "jpg";
      const baseName = `${sanitizeFileName(d.organization)}-${d.date || "undated"}`;
      const countKey = `${folderName}/${baseName}`;
      const count = donationNameCounts.get(countKey) || 0;
      donationNameCounts.set(countKey, count + 1);
      const fileName = count === 0 ? `${baseName}.${ext}` : `${baseName}-${count + 1}.${ext}`;
      const zipPath = `${folderName}/${fileName}`;

      zip.folder(folderName).file(fileName, blob);
      manifest.push({
        type: "donation",
        zipPath,
        groupId: d.groupId,
        organization: d.organization,
        date: d.date,
        amount: d.amount,
        year: d.year,
        unlimited: d.unlimited,
        verified: d.verified,
        confirmed: d.confirmed,
        sourceText: d.sourceText || ""
      });
    }

    const label = allYears ? "all-years" : String(selectedYear);
    zip.file(`summary-${label}.csv`, buildCsvContent(rows));
    zip.file("manifest.json", JSON.stringify(manifest, null, 2));

    btn.textContent = "Compressing…";
    const zipBlob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = allYears
      ? `resitkira-full-backup-${new Date().toISOString().slice(0, 10)}.zip`
      : `resitkira-receipts-${selectedYear}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert("Couldn't build the zip: " + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

// ---------- ZIP import (restore a previous backup) ----------
async function importReceiptsZip(file) {
  const btn = document.getElementById("restoreZipBtn");
  if (typeof JSZip === "undefined") {
    alert("The zip library hasn't loaded yet — check your connection and try again in a moment.");
    return;
  }
  btn.disabled = true;
  const originalLabel = btn.textContent;
  btn.textContent = "Restoring…";

  try {
    const zip = await JSZip.loadAsync(file);
    const manifestFile = zip.file("manifest.json");
    if (!manifestFile) {
      alert("This zip doesn't have a manifest.json, so it wasn't exported by this app (or is from a version before backup/restore existed) — it can't be restored automatically.");
      return;
    }
    const manifest = JSON.parse(await manifestFile.async("string"));

    const existingReceipts = await Db.getAllReceipts();
    const existingDonations = await Db.getAllDonations();
    const existingReceiptKeys = new Set(existingReceipts.map(r => `${r.groupId}|${r.categoryId}`));
    const existingDonationKeys = new Set(existingDonations.map(d => d.groupId));

    let restored = 0, skipped = 0, missing = 0;
    for (const entry of manifest) {
      const isDonation = entry.type === "donation";
      const key = isDonation ? entry.groupId : `${entry.groupId}|${entry.categoryId}`;
      const keySet = isDonation ? existingDonationKeys : existingReceiptKeys;

      if (keySet.has(key)) { skipped++; continue; }

      const imgFile = zip.file(entry.zipPath);
      let blob = null;
      if (imgFile) {
        const arrBuf = await imgFile.async("arraybuffer");
        const mime = entry.zipPath.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
        blob = new Blob([arrBuf], { type: mime });
      } else {
        missing++;
      }

      if (isDonation) {
        await Db.restoreDonationRecord(entry, blob);
      } else {
        await Db.restoreReceiptRecord(entry, blob);
      }
      keySet.add(key);
      restored++;
    }

    let msg = `Restored ${restored} record(s).`;
    if (skipped) msg += ` Skipped ${skipped} already present.`;
    if (missing) msg += ` ${missing} record(s) had no matching image in this zip.`;
    alert(msg);
    renderLedger();
    renderDonationList();
  } catch (e) {
    alert("Couldn't restore this backup: " + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

// ---------- Donation capture flow ----------
async function onDonationFileSelected(e) {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;

  const statusEl = document.getElementById("donationCaptureStatus");
  statusEl.hidden = false;
  statusEl.className = "capture-status";

  try {
    if (navigator.onLine) {
      const geminiKey = await Db.getSetting("geminiKey");
      const model = (await Db.getSetting("geminiModel")) || "gemini-2.5-flash";
      if (geminiKey) {
        statusEl.textContent = "Reading donation receipt with Gemini…";
        const result = await analyzeDonationWithGemini({ apiKey: geminiKey, model, imageBlob: file });
        openDonationReviewModal({
          imageBlob: file,
          organization: result.organization,
          date: result.date,
          amount: result.amount,
          likelyUnlimited: !!result.likelyUnlimited,
          note: result.note || "",
          viaGemini: true
        });
        statusEl.hidden = true;
        return;
      }
      statusEl.textContent = "Online, but no Gemini key set — enter details manually below.";
    } else {
      statusEl.textContent = "Offline — reading receipt locally (organization name still needs manual entry)…";
    }

    const text = await ocrImage(file);
    openDonationReviewModal({
      imageBlob: file,
      organization: "",
      date: new Date().toISOString().slice(0, 10),
      amount: guessAmount(text),
      likelyUnlimited: false,
      note: text ? "OCR text detected — check amount/date, organization name needs manual entry." : "",
      viaGemini: false
    });
    statusEl.hidden = true;
  } catch (err) {
    statusEl.textContent = "Couldn't process this receipt: " + err.message;
    statusEl.className = "capture-status error";
  }
}

let pendingDonationReview = null;

function openDonationReviewModal({ imageBlob, organization, date, amount, likelyUnlimited, note, viaGemini }) {
  pendingDonationReview = { imageBlob };
  document.getElementById("donationReviewImg").src = URL.createObjectURL(imageBlob);
  document.getElementById("donationReviewOrg").value = organization || "";
  document.getElementById("donationReviewDate").value = date || new Date().toISOString().slice(0, 10);
  document.getElementById("donationReviewAmount").value = amount ?? "";
  document.getElementById("donationReviewUnlimited").checked = !!likelyUnlimited;
  document.getElementById("donationReviewVerified").checked = false;

  const noteEl = document.getElementById("donationReviewSourceNote");
  noteEl.textContent = viaGemini
    ? `Read via Gemini (unverified against LHDN's approval list). ${note}`
    : `Read via on-device OCR. ${note}`;

  document.getElementById("donationReviewModal").hidden = false;
}

function closeDonationReviewModal() {
  document.getElementById("donationReviewModal").hidden = true;
  pendingDonationReview = null;
}

async function saveReviewedDonation() {
  if (!pendingDonationReview) return;
  const organization = document.getElementById("donationReviewOrg").value.trim();
  const date = document.getElementById("donationReviewDate").value;
  const amountRaw = document.getElementById("donationReviewAmount").value;
  const amount = amountRaw ? parseFloat(amountRaw) : null;
  const unlimited = document.getElementById("donationReviewUnlimited").checked;
  const verified = document.getElementById("donationReviewVerified").checked;
  const year = date ? new Date(date).getFullYear() : new Date().getFullYear();

  await Db.saveDonation({
    imageBlob: pendingDonationReview.imageBlob,
    organization,
    date,
    amount,
    year,
    unlimited,
    verified,
    confirmed: true
  });

  closeDonationReviewModal();
  renderDonationList();
}

// ---------- Donation ledger ----------
async function populateYearSelect(selectEl) {
  const receipts = await Db.getAllReceipts();
  const donations = await Db.getAllDonations();
  const years = [...new Set([...receipts.map(r => r.year), ...donations.map(d => d.year)])].sort((a, b) => b - a);
  const currentYear = new Date().getFullYear();
  const yearOptions = years.length ? years : [currentYear];
  const prevSelection = selectEl.value;
  selectEl.innerHTML = yearOptions.map(y => `<option value="${y}">${y}</option>`).join("");
  selectEl.value = yearOptions.includes(parseInt(prevSelection, 10)) ? prevSelection : String(yearOptions[0]);
  return parseInt(selectEl.value, 10);
}

async function renderDonationList() {
  const selectEl = document.getElementById("donationYearFilter");
  const selectedYear = await populateYearSelect(selectEl);

  const all = await Db.getAllDonations();
  const filtered = all.filter(d => d.year === selectedYear).sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  const list = document.getElementById("donationList");
  list.innerHTML = "";

  if (!filtered.length) {
    list.innerHTML = `<p class="empty-note">No donations logged for ${selectedYear} yet.</p>`;
    return;
  }

  const total = filtered.reduce((s, d) => s + (d.amount || 0), 0);
  const summary = document.createElement("div");
  summary.className = "ledger-cat";
  summary.innerHTML = `
    <div class="ledger-cat-head" style="cursor:default;">
      <div><h3>Total donations, ${selectedYear}</h3></div>
      <div class="amounts"><div>RM ${total.toFixed(2)}</div><div>${filtered.length} receipt${filtered.length > 1 ? "s" : ""}</div></div>
    </div>
  `;
  list.appendChild(summary);

  for (const d of filtered) {
    const row = document.createElement("div");
    row.className = "ledger-receipt-row";
    row.innerHTML = `
      <img class="thumb" alt="Donation receipt" />
      <div class="info">
        <strong>${escapeHtml(d.organization || "Unknown organization")}</strong>
        <span>${d.date || ""} · RM ${(d.amount || 0).toFixed(2)}</span>
        ${d.unlimited ? '<span class="badge-unlimited">uncapped</span>' : ""}
        ${!d.verified ? '<span class="badge-unverified">unverified vs LHDN list</span>' : ""}
      </div>
      <button class="remove-btn" data-id="${d.id}">Remove</button>
    `;
    const imgEl = row.querySelector("img.thumb");
    Db.getImage(d.groupId).then(blob => { if (blob) imgEl.src = URL.createObjectURL(blob); });
    imgEl.addEventListener("click", () => { if (imgEl.src) openDonationImageViewer(imgEl.src, d); });
    row.querySelector(".remove-btn").addEventListener("click", async (ev) => {
      ev.stopPropagation();
      await Db.deleteDonationRecord(d.id);
      renderDonationList();
    });
    list.appendChild(row);
  }
}

function openDonationImageViewer(src, donation) {
  document.getElementById("donationViewerImg").src = src;
  document.getElementById("donationViewerCaption").textContent =
    `${donation.organization || "Unknown organization"} · ${donation.date || ""} · RM ${(donation.amount || 0).toFixed(2)}${donation.unlimited ? " · uncapped" : ""}`;
  document.getElementById("donationViewerDownload").onclick = () => {
    const a = document.createElement("a");
    a.href = src;
    const safeName = (donation.organization || "donation").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    a.download = `${safeName || "donation"}-${donation.date || "undated"}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  document.getElementById("donationImageViewerModal").hidden = false;
}

function closeDonationImageViewer() {
  document.getElementById("donationImageViewerModal").hidden = true;
}

// ---------- Tax calculation ----------
async function computeEffectiveReliefTotal(year) {
  const all = await Db.getAllReceipts();
  const filtered = all.filter(r => r.year === year);
  const byCategory = new Map();
  for (const cat of activeCategories) byCategory.set(cat.id, { cap: cat.cap, total: 0 });
  for (const r of filtered) {
    if (!byCategory.has(r.categoryId)) byCategory.set(r.categoryId, { cap: null, total: 0 });
    byCategory.get(r.categoryId).total += (r.amount || 0);
  }
  let sum = 0;
  for (const { cap, total } of byCategory.values()) {
    sum += cap ? Math.min(total, cap) : total;
  }
  return sum;
}

async function getDonationTotals(year) {
  const all = await Db.getAllDonations();
  const filtered = all.filter(d => d.year === year);
  const unlimited = filtered.filter(d => d.unlimited).reduce((s, d) => s + (d.amount || 0), 0);
  const capped = filtered.filter(d => !d.unlimited).reduce((s, d) => s + (d.amount || 0), 0);
  return { unlimited, capped, total: unlimited + capped, count: filtered.length };
}

function taxInputsKeyForYear(year) {
  return `taxCalcInputs-${year}`;
}

async function loadTaxCalcInputsForYear() {
  const year = parseInt(document.getElementById("taxCalcYearFilter").value, 10);
  const saved = await Db.getSetting(taxInputsKeyForYear(year));
  document.getElementById("taxSalaryInput").value = saved?.salary ?? "";
  document.getElementById("taxZakatInput").value = saved?.zakat ?? "";
  document.getElementById("taxOtherReliefsInput").value = saved?.otherReliefs ?? "";
  document.getElementById("taxPersonalReliefToggle").checked = saved?.personalRelief !== false;
}

async function saveTaxCalcInputs() {
  const year = parseInt(document.getElementById("taxCalcYearFilter").value, 10);
  await Db.saveSetting(taxInputsKeyForYear(year), {
    salary: parseFloat(document.getElementById("taxSalaryInput").value) || 0,
    zakat: parseFloat(document.getElementById("taxZakatInput").value) || 0,
    otherReliefs: parseFloat(document.getElementById("taxOtherReliefsInput").value) || 0,
    personalRelief: document.getElementById("taxPersonalReliefToggle").checked
  });
}

async function renderTaxCalc() {
  const yearSelect = document.getElementById("taxCalcYearFilter");
  if (!yearSelect.options.length) {
    await populateYearSelect(yearSelect);
    await loadTaxCalcInputsForYear();
  }
  const year = parseInt(yearSelect.value, 10);

  const reliefTotal = await computeEffectiveReliefTotal(year);
  const donationTotals = await getDonationTotals(year);

  const annualSalary = parseFloat(document.getElementById("taxSalaryInput").value) || 0;
  const zakat = parseFloat(document.getElementById("taxZakatInput").value) || 0;
  const otherReliefs = parseFloat(document.getElementById("taxOtherReliefsInput").value) || 0;
  const personalReliefApplied = document.getElementById("taxPersonalReliefToggle").checked;

  const r = computeFullTax({
    annualSalary,
    donationTotal: donationTotals.total,
    unlimitedDonationAmount: donationTotals.unlimited,
    reliefTotal,
    personalReliefApplied,
    otherReliefs,
    zakat
  });

  const fmt = (n) => `RM ${n.toFixed(2)}`;
  const rows = [
    ["Aggregate income (salary)", fmt(r.aggregateIncome)],
    ["Donation deduction", `− ${fmt(r.totalDonationDeduction)}${r.cappedDonationRaw > r.donationCap ? ` (capped at 10%: ${fmt(r.donationCap)})` : ""}`],
    ["Total income", fmt(r.totalIncome)],
    [`Tax relief ledger (${year})`, `− ${fmt(reliefTotal)}`],
    ["Automatic individual relief", `− ${fmt(r.personalRelief)}`],
    ["Other manual reliefs", `− ${fmt(otherReliefs)}`],
    ["Chargeable income", fmt(r.chargeableIncome)],
    ["Tax on chargeable income", fmt(r.taxBeforeRebate)],
    ["Individual rebate (RM400)", `− ${fmt(r.individualRebate)}`],
    ["Zakat rebate", `− ${fmt(r.zakatRebate)}`],
  ];

  const el = document.getElementById("taxBreakdown");
  el.innerHTML = rows.map(([label, value]) => `
    <div class="tax-row"><span class="label">${label}</span><span class="value">${value}</span></div>
  `).join("") + `
    <div class="tax-row total"><span class="label">Final tax payable</span><span class="value">${fmt(r.finalTax)}</span></div>
    <div class="tax-row"><span class="label">Effective rate</span><span class="value">${r.effectiveRate.toFixed(2)}%</span></div>
  `;
}

// ---------- Service worker ----------
function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {
      // Non-fatal — app still works online, just won't be installable/offline-cached.
    });
  }
}

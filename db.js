/**
 * Thin IndexedDB wrapper. Two stores:
 *  - "receipts": one record per (receipt, category) pair — a receipt that
 *    matches 3 categories produces 3 records sharing the same groupId, so
 *    the receipt image itself is only stored once via imageBlobId pointing
 *    into the "images" store.
 *  - "images": raw image blobs, deduped by groupId.
 *  - "settings": key/value app settings (Gemini key, refresh URL, category cache).
 */
const DB_NAME = "tax-relief-checker";
const DB_VERSION = 2;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("receipts")) {
        const store = db.createObjectStore("receipts", { keyPath: "id", autoIncrement: true });
        store.createIndex("categoryId", "categoryId", { unique: false });
        store.createIndex("groupId", "groupId", { unique: false });
        store.createIndex("year", "year", { unique: false });
      }
      if (!db.objectStoreNames.contains("images")) {
        db.createObjectStore("images", { keyPath: "groupId" });
      }
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("donations")) {
        const donStore = db.createObjectStore("donations", { keyPath: "id", autoIncrement: true });
        donStore.createIndex("groupId", "groupId", { unique: false });
        donStore.createIndex("year", "year", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, storeNames, mode) {
  return db.transaction(storeNames, mode);
}

const Db = {
  async saveSetting(key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const t = tx(db, "settings", "readwrite");
      t.objectStore("settings").put({ key, value });
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  },

  async getSetting(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = tx(db, "settings", "readonly").objectStore("settings").get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : undefined);
      req.onerror = () => reject(req.error);
    });
  },

  /**
   * Saves one image blob plus one or more receipt records (one per matched
   * category). Returns the groupId used.
   */
  async saveReceiptGroup({ imageBlob, merchant, date, amount, year, categories, sourceText, confirmed }) {
    const db = await openDb();
    const groupId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise((resolve, reject) => {
      const t = tx(db, ["receipts", "images"], "readwrite");
      if (imageBlob) {
        t.objectStore("images").put({ groupId, blob: imageBlob });
      }
      const receiptStore = t.objectStore("receipts");
      const catList = categories.length ? categories : [{ categoryId: "uncategorized", label: "Uncategorized", confidence: 0 }];
      for (const cat of catList) {
        receiptStore.add({
          groupId,
          merchant: merchant || "Unknown merchant",
          date: date || new Date().toISOString().slice(0, 10),
          amount: (cat.amount ?? amount) ?? null,
          year: year || new Date().getFullYear(),
          categoryId: cat.categoryId,
          categoryLabel: cat.label,
          confidence: cat.confidence ?? null,
          matchedKeywords: cat.matchedKeywords || [],
          sourceText: sourceText || "",
          confirmed: !!confirmed,
          createdAt: new Date().toISOString()
        });
      }
      t.oncomplete = () => resolve(groupId);
      t.onerror = () => reject(t.error);
    });
  },

  async getAllReceipts() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = tx(db, "receipts", "readonly").objectStore("receipts").getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async getImage(groupId) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = tx(db, "images", "readonly").objectStore("images").get(groupId);
      req.onsuccess = () => resolve(req.result ? req.result.blob : null);
      req.onerror = () => reject(req.error);
    });
  },

  async deleteReceiptRecord(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const t = tx(db, "receipts", "readwrite");
      t.objectStore("receipts").delete(id);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  },

  async deleteGroup(groupId) {
    const db = await openDb();
    const all = await this.getAllReceipts();
    const ids = all.filter(r => r.groupId === groupId).map(r => r.id);
    return new Promise((resolve, reject) => {
      const t = tx(db, ["receipts", "images"], "readwrite");
      const rs = t.objectStore("receipts");
      ids.forEach(id => rs.delete(id));
      t.objectStore("images").delete(groupId);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  },

  async updateReceiptRecord(id, patch) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const t = tx(db, "receipts", "readwrite");
      const store = t.objectStore("receipts");
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const rec = getReq.result;
        if (!rec) return reject(new Error("Record not found"));
        store.put({ ...rec, ...patch });
      };
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  },

  /**
   * Re-inserts a receipt record from a backup manifest entry, preserving its
   * original groupId so it stays linked to any sibling records that share
   * the same image (a receipt filed under multiple categories). The image
   * blob is put() rather than added() so restoring the same groupId's image
   * twice (once per sibling category) doesn't error or duplicate storage.
   */
  async restoreReceiptRecord(entry, blob) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const t = tx(db, ["receipts", "images"], "readwrite");
      if (blob) {
        t.objectStore("images").put({ groupId: entry.groupId, blob });
      }
      t.objectStore("receipts").add({
        groupId: entry.groupId,
        merchant: entry.merchant || "Unknown merchant",
        date: entry.date || "",
        amount: entry.amount ?? null,
        year: entry.year || (entry.date ? new Date(entry.date).getFullYear() : new Date().getFullYear()),
        categoryId: entry.categoryId || "uncategorized",
        categoryLabel: entry.categoryLabel || entry.categoryId || "Uncategorized",
        confidence: null,
        matchedKeywords: entry.matchedKeywords || [],
        sourceText: entry.sourceText || "",
        confirmed: !!entry.confirmed,
        createdAt: new Date().toISOString()
      });
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  },

  // ---------- Donations (tax deduction, kept separate from relief receipts) ----------

  async saveDonation({ imageBlob, organization, date, amount, year, unlimited, verified, sourceText, confirmed }) {
    const db = await openDb();
    const groupId = `don-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise((resolve, reject) => {
      const t = tx(db, ["donations", "images"], "readwrite");
      if (imageBlob) {
        t.objectStore("images").put({ groupId, blob: imageBlob });
      }
      t.objectStore("donations").add({
        groupId,
        organization: organization || "Unknown organization",
        date: date || new Date().toISOString().slice(0, 10),
        amount: amount ?? null,
        year: year || new Date().getFullYear(),
        unlimited: !!unlimited,
        verified: !!verified,
        sourceText: sourceText || "",
        confirmed: !!confirmed,
        createdAt: new Date().toISOString()
      });
      t.oncomplete = () => resolve(groupId);
      t.onerror = () => reject(t.error);
    });
  },

  async getAllDonations() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = tx(db, "donations", "readonly").objectStore("donations").getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async deleteDonationRecord(id) {
    const db = await openDb();
    const all = await this.getAllDonations();
    const rec = all.find(d => d.id === id);
    return new Promise((resolve, reject) => {
      const t = tx(db, ["donations", "images"], "readwrite");
      t.objectStore("donations").delete(id);
      if (rec) t.objectStore("images").delete(rec.groupId);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  },

  async updateDonationRecord(id, patch) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const t = tx(db, "donations", "readwrite");
      const store = t.objectStore("donations");
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const rec = getReq.result;
        if (!rec) return reject(new Error("Record not found"));
        store.put({ ...rec, ...patch });
      };
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  },

  /** Mirrors restoreReceiptRecord, for donation entries in a backup manifest. */
  async restoreDonationRecord(entry, blob) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const t = tx(db, ["donations", "images"], "readwrite");
      if (blob) {
        t.objectStore("images").put({ groupId: entry.groupId, blob });
      }
      t.objectStore("donations").add({
        groupId: entry.groupId,
        organization: entry.organization || "Unknown organization",
        date: entry.date || "",
        amount: entry.amount ?? null,
        year: entry.year || (entry.date ? new Date(entry.date).getFullYear() : new Date().getFullYear()),
        unlimited: !!entry.unlimited,
        verified: !!entry.verified,
        sourceText: entry.sourceText || "",
        confirmed: !!entry.confirmed,
        createdAt: new Date().toISOString()
      });
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }
};

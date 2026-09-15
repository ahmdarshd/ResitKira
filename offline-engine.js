/**
 * Offline path: Tesseract.js (runs fully on-device, no network) extracts
 * text from the receipt photo, then we keyword-match that text against the
 * current LHDN category list. Cruder than Gemini, so results are always
 * flagged "unconfirmed" and the amount/merchant fields are left for the
 * user to fill in — OCR layout parsing offline is unreliable enough that
 * guessing wrong numbers would be worse than asking.
 */

let tesseractWorkerPromise = null;

function getTesseractWorker() {
  if (!tesseractWorkerPromise) {
    tesseractWorkerPromise = Tesseract.createWorker("eng");
  }
  return tesseractWorkerPromise;
}

async function ocrImage(imageBlob, onProgress) {
  const worker = await getTesseractWorker();
  const { data } = await worker.recognize(imageBlob, {}, {});
  if (onProgress) onProgress(1);
  return data.text || "";
}

function matchCategoriesOffline(text, categories) {
  const lower = text.toLowerCase();
  const matches = [];
  for (const cat of categories) {
    const hits = cat.keywords.filter(kw => lower.includes(kw.toLowerCase()));
    if (hits.length > 0) {
      matches.push({
        categoryId: cat.id,
        label: cat.label,
        confidence: Math.min(0.3 + hits.length * 0.15, 0.75), // capped — never as confident as a real read
        matchedKeywords: hits
      });
    }
  }
  return matches.sort((a, b) => b.confidence - a.confidence);
}

/** Very rough "RM 12.34" / "12.34" total-line guesser, purely a starting suggestion for the user to correct. */
function guessAmount(text) {
  const matches = [...text.matchAll(/(?:rm|myr)?\s*([0-9]{1,5}\.[0-9]{2})/gi)];
  if (!matches.length) return null;
  const nums = matches.map(m => parseFloat(m[1])).filter(n => !isNaN(n));
  if (!nums.length) return null;
  return Math.max(...nums); // assume the largest number on the receipt is the total
}

/**
 * Calls Gemini directly from the device using the user's own API key.
 * There is no backend proxy — this app is for personal/single-user use, so
 * the key lives only in this device's IndexedDB and is sent straight to
 * Google. Do not ship this app to other users with your key baked in.
 *
 * Google renames/retires Gemini model ids fairly often, so the model id is
 * a setting (see index.html "Model" field) rather than hardcoded — check
 * Google AI Studio (aistudio.google.com) if requests start failing with a
 * 404, it usually means the configured model id was retired.
 */

function fileToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function buildPrompt(categories) {
  const catLines = categories
    .map(c => `- id="${c.id}" (cap RM${c.cap}): ${c.label}. ${c.capNote}`)
    .join("\n");

  return `You are helping a Malaysian individual taxpayer sort a receipt photo for LHDN (Inland Revenue Board of Malaysia) personal income tax relief claims.

Read the receipt image and:
1. Identify the merchant name, the transaction date (YYYY-MM-DD), and the total amount paid (RM, numeric).
2. List the individual line items you can read.
3. Decide which of the following relief categories this receipt's items qualify for. IMPORTANT: a single receipt very often qualifies for MORE THAN ONE category at once whenever it has mixed items — you must check every line item against every category and include ONE ENTRY IN "matches" PER QUALIFYING CATEGORY, not just the single best match. Do not stop after finding the first category that fits. Only pick categories that plausibly apply under Malaysian LHDN rules — do not force a match for items that don't fit any category.

Categories:
${catLines}

Respond with ONLY a JSON object, no markdown fences, no commentary, in exactly this shape. Note this example shows TWO matched categories from one receipt — that is normal and expected whenever a receipt has mixed items, so include as many "matches" entries as genuinely apply, not just one:
{
  "merchant": string,
  "date": "YYYY-MM-DD" or null,
  "amount": number or null,
  "items": string[],
  "matches": [
    { "categoryId": "lifestyle", "confidence": 0.9, "reason": "a novel was purchased", "matchedItemText": "Novel - RM35.00" },
    { "categoryId": "sports", "confidence": 0.8, "reason": "a yoga mat was purchased", "matchedItemText": "Yoga mat - RM51.17" }
  ]
}
If nothing qualifies, return "matches": [].`;
}

async function analyzeReceiptWithGemini({ apiKey, model, imageBlob, categories }) {
  if (!apiKey) throw new Error("No Gemini API key configured");
  const base64 = await fileToBase64(imageBlob);
  const mimeType = imageBlob.type || "image/jpeg";

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: buildPrompt(categories) },
          { inline_data: { mime_type: mimeType, data: base64 } }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 2048,
      responseMimeType: "application/json"
    }
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini request failed (HTTP ${res.status}). ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
  const cleaned = text.replace(/```json|```/g, "").trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error("Gemini returned a response that wasn't valid JSON: " + cleaned.slice(0, 200));
  }
  return parsed;
}

/**
 * Donation receipts don't need multi-category matching like relief receipts
 * do — LHDN treats an approved-institution donation as one deduction line,
 * not several relief categories. This just extracts the organization name,
 * date, and amount, and gives a best-effort (NOT authoritative) guess at
 * whether the organization is likely to be LHDN-approved based on the
 * model's general knowledge. It cannot browse hasil.gov.my's live approval
 * list in this setup, so the app always labels this guess as unverified and
 * points the person at the official checker.
 */
function buildDonationPrompt() {
  return `You are helping a Malaysian individual taxpayer log a donation receipt for their annual tax return.

Read the receipt/donation image and extract:
1. The organization/institution/fund name that received the donation.
2. The date of the donation (YYYY-MM-DD).
3. The amount donated (RM, numeric).
4. Your best-effort, NON-AUTHORITATIVE guess at whether this looks like a donation to the government, a state government, or a local authority (which get an uncapped tax deduction) versus a donation to a separate approved institution/fund (which is capped at 10% of the donor's aggregate income). Only mark "likelyUnlimited": true if the receipt clearly names an actual government body or local authority (e.g. "Kerajaan Negeri", a named city/municipal council, a federal ministry) — not for NGOs, mosques, temples, charities, or foundations, even well-known ones.

You cannot verify the organization's actual LHDN approval status under Subsection 44(6) — do not claim certainty either way about approval.

Respond with ONLY a JSON object, no markdown fences, no commentary:
{
  "organization": string,
  "date": "YYYY-MM-DD" or null,
  "amount": number or null,
  "likelyUnlimited": boolean,
  "note": string (one short sentence, e.g. why you guessed unlimited or not)
}`;
}

async function analyzeDonationWithGemini({ apiKey, model, imageBlob }) {
  if (!apiKey) throw new Error("No Gemini API key configured");
  const base64 = await fileToBase64(imageBlob);
  const mimeType = imageBlob.type || "image/jpeg";

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: buildDonationPrompt() },
          { inline_data: { mime_type: mimeType, data: base64 } }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 1024,
      responseMimeType: "application/json"
    }
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini request failed (HTTP ${res.status}). ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
  const cleaned = text.replace(/```json|```/g, "").trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error("Gemini returned a response that wasn't valid JSON: " + cleaned.slice(0, 200));
  }
  return parsed;
}

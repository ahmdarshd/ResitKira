/**
 * LHDN (Lembaga Hasil Dalam Negeri) individual tax relief reference data.
 * YA2025 figures, receipt-relevant categories only (categories that are
 * automatic, like the RM9,000 personal relief, are left out since there's
 * nothing to scan a receipt for).
 *
 * version / lastUpdated let the app tell a bundled copy apart from one
 * fetched from REFRESH_URL at runtime.
 */
const LHDN_DATA_VERSION = "YA2025-2026-09-13";

const DEFAULT_LHDN_CATEGORIES = [
  {
    id: "lifestyle",
    label: "Lifestyle (books, devices, internet, courses)",
    cap: 2500,
    capNote: "RM2,500 combined cap per taxpayer",
    keywords: [
      "book", "buku", "novel", "magazine", "majalah", "e-book", "ebook",
      "newspaper", "surat khabar", "journal",
      "smartphone", "tablet", "laptop", "computer", "desktop pc", "phone",
      "internet", "broadband", "wifi", "unifi", "streaming subscription",
      "gym", "sport shoe", "sukan",
      "skill course", "professional course", "self development",
      "printer", "webcam", "keyboard", "mouse", "monitor"
    ]
  },
  {
    id: "sports",
    label: "Sports equipment & facilities",
    cap: 1000,
    capNote: "RM1,000 cap (part of the wider sports relief, separate from lifestyle since YA2023)",
    keywords: [
      "badminton", "racquet", "racket", "football", "futsal", "jersey",
      "running shoe", "sport shoe", "treadmill", "dumbbell", "yoga mat",
      "gym membership", "fitness membership", "swimming", "kolam renang",
      "sukan", "bicycle", "basikal", "helmet", "sports equipment",
      "court rental", "futsal court", "badminton court"
    ]
  },
  {
    id: "medical_self_spouse_child",
    label: "Medical expenses (self, spouse, child)",
    cap: 10000,
    capNote: "RM10,000 shared cap; includes serious disease, fertility, vaccination (sub-cap RM1,000), dental (sub-cap RM1,000), full check-up/mental health (sub-cap RM1,000)",
    keywords: [
      "clinic", "klinik", "hospital", "vaccination", "vaksin", "dental",
      "pergigian", "dentist", "check-up", "checkup", "medical check",
      "mental health", "psychiatrist", "psychologist", "fertility", "ivf",
      "pharmacy", "farmasi", "diagnostic", "x-ray", "blood test",
      "physiotherapy", "specialist consultation"
    ]
  },
  {
    id: "medical_parents",
    label: "Medical expenses for parents",
    cap: 8000,
    capNote: "RM8,000 cap, covers medical/special needs/carer expenses for parents & grandparents",
    keywords: [
      "elderly care", "nursing home", "caregiver", "carer", "diaper adult",
      "wheelchair", "walking frame", "hearing aid", "geriatric",
      "home nurse", "medical for parent"
    ]
  },
  {
    id: "education_fees",
    label: "Education fees (self)",
    cap: 7000,
    capNote: "RM7,000 cap for own further education / upskilling courses",
    keywords: [
      "tuition fee", "course fee", "certification", "diploma", "degree",
      "masters", "phd", "professional qualification", "upskilling",
      "training fee", "workshop fee", "seminar fee", "exam fee"
    ]
  },
  {
    id: "childcare",
    label: "Childcare fees (below 6 years)",
    cap: 3000,
    capNote: "RM3,000 cap, registered nursery/kindergarten/childcare centre",
    keywords: [
      "nursery", "tadika", "kindergarten", "taska", "child care", "childcare",
      "preschool", "montessori", "daycare"
    ]
  },
  {
    id: "breastfeeding",
    label: "Breastfeeding equipment",
    cap: 1000,
    capNote: "RM1,000 cap, once every 2 years, child up to 2 years old",
    keywords: [
      "breast pump", "pam susu", "nursing kit", "milk storage bag",
      "breastfeeding", "penyusuan"
    ]
  },
  {
    id: "sspn",
    label: "SSPN net savings",
    cap: 8000,
    capNote: "RM8,000 cap on net annual savings",
    keywords: ["sspn", "sspn-i", "sspn net", "skim simpanan pendidikan"]
  },
  {
    id: "ev_charging",
    label: "EV charging equipment / facilities",
    cap: 2500,
    capNote: "RM2,500 cap, includes home EV charger installation",
    keywords: [
      "ev charger", "electric vehicle charger", "charging station",
      "wallbox", "ev charging"
    ]
  },
  {
    id: "epf_life_insurance",
    label: "EPF & life insurance premiums",
    cap: 7000,
    capNote: "RM7,000 combined cap (EPF up to RM4,000 + life insurance/takaful up to RM3,000)",
    keywords: [
      "epf", "kwsp", "life insurance premium", "takaful premium",
      "insurans hayat"
    ]
  }
];

/**
 * Attempts to fetch a refreshed relief list from a JSON endpoint the user
 * points the app at (their own hosted copy, e.g. a GitHub raw file they
 * update once a year). Falls back to the bundled DEFAULT_LHDN_CATEGORIES
 * if offline or the fetch fails.
 */
async function refreshLhdnData(url) {
  if (!url) throw new Error("No refresh URL configured");
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Refresh failed: HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data.categories)) {
    throw new Error("Refresh JSON must have a 'categories' array");
  }
  return data;
}

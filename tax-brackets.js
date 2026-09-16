/**
 * Malaysian resident-individual progressive tax brackets, YA2023–2025
 * (unchanged across these three years). Source: LHDN official page,
 * https://www.hasil.gov.my/en/individu/kadar-cukai/ — fetched and
 * cross-checked directly against the primary source, not a third-party
 * summary, after an earlier version of this file used a wrong table.
 */
const TAX_BRACKETS_VERSION = "YA2023-2025-verified-hasil.gov.my-2026-09-16";

const TAX_BRACKETS = [
  { upTo: 5000, rate: 0 },
  { upTo: 20000, rate: 0.01 },
  { upTo: 35000, rate: 0.03 },
  { upTo: 50000, rate: 0.06 },
  { upTo: 70000, rate: 0.11 },
  { upTo: 100000, rate: 0.19 },
  { upTo: 400000, rate: 0.25 },
  { upTo: 600000, rate: 0.26 },
  { upTo: 2000000, rate: 0.28 },
  { upTo: Infinity, rate: 0.30 }
];

const PERSONAL_RELIEF_AMOUNT = 9000;
const INDIVIDUAL_REBATE_THRESHOLD = 35000;
const INDIVIDUAL_REBATE_AMOUNT = 400;
const DONATION_DEDUCTION_CAP_PERCENT = 0.10; // of aggregate income, for approved-institution donations

/** Progressive tax on chargeable income, before any rebates. */
function computeProgressiveTax(chargeableIncome) {
  if (chargeableIncome <= 0) return 0;
  let tax = 0;
  let lowerBound = 0;
  for (const bracket of TAX_BRACKETS) {
    if (chargeableIncome <= lowerBound) break;
    const amountInBracket = Math.min(chargeableIncome, bracket.upTo) - lowerBound;
    if (amountInBracket > 0) tax += amountInBracket * bracket.rate;
    lowerBound = bracket.upTo;
  }
  return tax;
}

/**
 * Full calculation matching how LHDN actually sequences it:
 * Aggregate income -> less donation deduction (capped 10% of aggregate
 * income) -> Total income -> less reliefs -> Chargeable income -> tax on
 * brackets -> less rebates (RM400 individual + zakat, ringgit-for-ringgit) ->
 * final tax payable.
 */
function computeFullTax({ annualSalary, donationTotal, unlimitedDonationAmount, reliefTotal, personalReliefApplied, otherReliefs, zakat }) {
  const aggregateIncome = Math.max(0, annualSalary || 0);

  const unlimitedDonation = unlimitedDonationAmount || 0;
  const cappedDonationRaw = Math.max(0, (donationTotal || 0) - unlimitedDonation);
  const donationCap = aggregateIncome * DONATION_DEDUCTION_CAP_PERCENT;
  const cappedDonationAllowed = Math.min(cappedDonationRaw, donationCap);
  const totalDonationDeduction = unlimitedDonation + cappedDonationAllowed;

  const totalIncome = Math.max(0, aggregateIncome - totalDonationDeduction);

  const personalRelief = personalReliefApplied ? PERSONAL_RELIEF_AMOUNT : 0;
  const totalReliefs = (reliefTotal || 0) + personalRelief + (otherReliefs || 0);

  const chargeableIncome = Math.max(0, totalIncome - totalReliefs);

  const taxBeforeRebate = computeProgressiveTax(chargeableIncome);

  const individualRebate = chargeableIncome <= INDIVIDUAL_REBATE_THRESHOLD ? INDIVIDUAL_REBATE_AMOUNT : 0;
  const zakatRebate = Math.max(0, zakat || 0);
  const totalRebates = individualRebate + zakatRebate;

  const finalTax = Math.max(0, taxBeforeRebate - totalRebates);
  const effectiveRate = aggregateIncome > 0 ? (finalTax / aggregateIncome) * 100 : 0;

  return {
    aggregateIncome,
    totalDonationDeduction,
    donationCap,
    cappedDonationRaw,
    unlimitedDonation,
    totalIncome,
    personalRelief,
    totalReliefs,
    chargeableIncome,
    taxBeforeRebate,
    individualRebate,
    zakatRebate,
    totalRebates,
    finalTax,
    effectiveRate
  };
}

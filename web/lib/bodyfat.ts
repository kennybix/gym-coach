/* Estimate body-fat % from tape measurements — the US Navy circumference method. All lengths
   in cm. Men use the abdomen at the navel (belly, falling back to waist) + neck; women use
   waist + hips + neck. Returns null when the needed inputs are missing. It's an estimate. */
export function navyBodyFat(o: {
  sex: string | null;
  height: number | null;
  waist?: number;
  belly?: number;
  neck?: number;
  hips?: number;
}): number | null {
  const { sex, height, neck } = o;
  if (!height || !neck) return null;
  const female = (sex || "").toLowerCase().startsWith("f");
  let bf: number;
  if (female) {
    if (!o.waist || !o.hips) return null;
    const v = o.waist + o.hips - neck;
    if (v <= 0) return null;
    bf = 495 / (1.29579 - 0.35004 * Math.log10(v) + 0.221 * Math.log10(height)) - 450;
  } else {
    const abdomen = o.belly || o.waist; // navel circumference
    if (!abdomen || abdomen <= neck) return null;
    bf = 495 / (1.0324 - 0.19077 * Math.log10(abdomen - neck) + 0.15456 * Math.log10(height)) - 450;
  }
  if (!Number.isFinite(bf)) return null;
  return Math.round(Math.max(2, Math.min(60, bf)) * 10) / 10;
}

/* Waist-to-height ratio — a simple, evidence-aligned health signal (keeping it under ~0.5 is
   the common guideline). Uses the narrowest waist. */
export function waistToHeight(waist: number | undefined, height: number | null): number | null {
  if (!waist || !height) return null;
  return Math.round((waist / height) * 100) / 100;
}

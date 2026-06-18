/* LOCAL calendar date (YYYY-MM-DD). The server + DB run in the machine's local timezone, so
   "today" must be the user's local day — `new Date().toISOString()` is UTC and rolls over hours
   early/late, which made evening logs land on the wrong day in trends/streaks/nutrition. */
export function localDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

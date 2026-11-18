/** Deal timing and price-drop logic. Pure. */

const DAY = 86_400_000;
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => Date.UTC(y, m, d);

/** Thanksgiving is the fourth Thursday of November; Black Friday is the day after, Cyber Monday the Monday after that. */
export function blackFriday(year: number): { thanksgiving: string; blackFriday: string; cyberMonday: string; weekStart: string } {
  const first = new Date(utc(year, 10, 1)).getUTCDay(); // 0 = Sunday
  const thanks = utc(year, 10, 1 + ((4 - first + 7) % 7) + 21);
  return { thanksgiving: ymd(thanks), blackFriday: ymd(thanks + DAY), cyberMonday: ymd(thanks + 4 * DAY), weekStart: ymd(thanks - 3 * DAY) };
}

export interface SaleSeason {
  name: string;
  now: boolean; // sales are on today
  date: string; // when it starts (or today's date when on)
  endsOn: string;
  daysAway: number;
}

const days = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY);

/** The Black Friday and Cyber Monday window: "on now" through Cyber Monday, or "coming" within 45 days. */
export function saleSeason(today: string): SaleSeason | null {
  const y = Number(today.slice(0, 4));
  for (const year of [y, y + 1]) {
    const b = blackFriday(year);
    if (today > b.cyberMonday) continue;
    if (today >= b.weekStart) return { name: 'Black Friday & Cyber Monday', now: true, date: today, endsOn: b.cyberMonday, daysAway: 0 };
    const away = days(today, b.blackFriday);
    return away <= 45 ? { name: 'Black Friday', now: false, date: b.blackFriday, endsOn: b.cyberMonday, daysAway: away } : null;
  }
  return null;
}

export interface Assessment {
  dropPct: number | null; // how far the price fell since the last change, when it fell at least 3%
  atTarget: boolean; // at or under the price you said you would buy at
  lowestSeen: boolean; // the lowest we have recorded, with at least two readings
}

export function assess(i: { current: number | null; previous: number | null; lowest: number | null; readings: number; target: number | null }): Assessment {
  const { current, previous, lowest, readings, target } = i;
  const drop = current != null && previous != null && previous > 0 && current < previous ? (previous - current) / previous : 0;
  return {
    dropPct: drop >= 0.03 ? Math.round(drop * 100) : null,
    atTarget: current != null && target != null && target > 0 && current <= target,
    lowestSeen: current != null && lowest != null && readings >= 2 && current <= lowest && (previous == null || current < previous),
  };
}

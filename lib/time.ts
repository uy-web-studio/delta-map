import type { CampusEvent, Day, Hours } from "./types";

// All campus times are Pacific, whatever the viewer's phone is set to.
const TZ = "America/Los_Angeles";
const DAYS: Day[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function pacificParts(d: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return {
    day: get("weekday").slice(0, 3).toLowerCase() as Day,
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

export function openUntil(hours: Hours | null | undefined, now: Date): string | null {
  if (!hours) return null;
  const { day, time } = pacificParts(now);
  const span = hours[day]?.find(([open, close]) => open <= time && time < close);
  return span ? span[1] : null;
}

export function formatClock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h < 12 ? "a.m." : "p.m.";
  const h12 = h % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2, "0")} ${suffix}` : `${h12} ${suffix}`;
}

const dayLabel = (d: Day) => `${d[0].toUpperCase()}${d.slice(1)}`;

// Consecutive days with the same hours collapse into one line: "Mon–Fri 8 a.m.–5 p.m.".
export function hoursSummary(hours: Hours | null | undefined): string[] {
  if (!hours) return [];
  const spans = (d: Day) => hours[d]?.map(([a, b]) => `${formatClock(a)}–${formatClock(b)}`).join(", ");
  const lines: string[] = [];
  for (let i = 0; i < DAYS.length; i++) {
    const text = spans(DAYS[i]);
    if (!text) continue;
    let j = i;
    while (j + 1 < DAYS.length && spans(DAYS[j + 1]) === text) j++;
    lines.push(`${dayLabel(DAYS[i])}${j > i ? `–${dayLabel(DAYS[j])}` : ""} ${text}`);
    i = j;
  }
  return lines;
}

export const isUpcoming = (e: CampusEvent, now: Date) => new Date(e.end) >= now;

export const isToday = (e: CampusEvent, now: Date) =>
  isUpcoming(e, now) && pacificParts(new Date(e.start)).date <= pacificParts(now).date;

export const isThisWeek = (e: CampusEvent, now: Date) =>
  isUpcoming(e, now) && new Date(e.start).getTime() - now.getTime() < 7 * 864e5;

export function formatEventTime(e: CampusEvent): string {
  const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, ...opts }).format(new Date(iso));
  return `${fmt(e.start, { weekday: "short", month: "short", day: "numeric" })}, ${fmt(e.start, {
    hour: "numeric",
    minute: "2-digit",
  })}–${fmt(e.end, { hour: "numeric", minute: "2-digit" })}`;
}

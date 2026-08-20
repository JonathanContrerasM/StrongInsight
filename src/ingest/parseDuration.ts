/**
 * `Dauer` / `Duration` is a human string: "1h 5min", "54min", "1h".
 * Every row of a workout repeats it identically, so it belongs on the workout.
 * Also tolerates "1h 3m", "45m", "1:05:00", "90s" and a bare number (minutes).
 */
export function parseDuration(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const s = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (s === '') return null;

  // "1:05:00" or "54:00"
  const clock = /^(\d+):([0-5]?\d)(?::([0-5]?\d))?$/.exec(s);
  if (clock) {
    const a = Number(clock[1]);
    const b = Number(clock[2]);
    const c = clock[3] === undefined ? null : Number(clock[3]);
    return c === null ? a * 60 + b : a * 3600 + b * 60 + c;
  }

  let total = 0;
  let matched = false;
  const unitRe = /(\d+(?:[.,]\d+)?)\s*(h|hr|hrs|hour|hours|std|stunden?|min|mins|minute|minuten?|m|s|sec|secs|sek|sekunden?)/g;
  for (let m = unitRe.exec(s); m !== null; m = unitRe.exec(s)) {
    const value = Number((m[1] ?? '0').replace(',', '.'));
    const unit = m[2] ?? '';
    matched = true;
    if (/^(h|hr|hrs|hour|hours|std|stunde|stunden)$/.test(unit)) total += value * 3600;
    else if (/^(s|sec|secs|sek|sekunde|sekunden)$/.test(unit)) total += value;
    else total += value * 60; // min / m
  }
  if (matched) return Math.round(total);

  // Bare number -> minutes, matching Strong's own display convention.
  const bare = /^(\d+(?:[.,]\d+)?)$/.exec(s);
  if (bare) return Math.round(Number((bare[1] ?? '0').replace(',', '.')) * 60);

  return null;
}

// Consistent date/time formatting for the whole admin panel.
// All timestamps arrive as ISO strings (stored as TIMESTAMPTZ / UTC).
// These helpers render them in the viewer's browser-local timezone.

export function formatDate(iso, options = {}) {
  if (!iso) {
    return "—";
  }

  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...options,
  });
}

export function formatTime(iso, options = {}) {
  if (!iso) {
    return "—";
  }

  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    ...options,
  });
}

export function formatDateTime(iso, options = {}) {
  if (!iso) {
    return "—";
  }

  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  const local = date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...options,
  });

  const tz = Intl.DateTimeFormat()
    .resolvedOptions()
    .timeZone?.split("/")
    .pop()
    .replace(/_/g, " ");
  const offset = getTimezoneOffset(date);

  return tz && offset ? `${local} (${offset} ${tz})` : local;
}

// Offsets like "+05:30", "-04:00", "+00:00".
function getTimezoneOffset(date) {
  const offsetMinutes = date.getTimezoneOffset();
  const sign = offsetMinutes <= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const hours = String(Math.floor(abs / 60)).padStart(2, "0");
  const minutes = String(abs % 60).padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}
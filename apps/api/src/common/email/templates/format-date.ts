const israelDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jerusalem',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/** `DD/MM/YYYY` as the date is in Israel (NFR-HEB-1), whatever the server's time zone. */
export function formatIsraelDate(date: Date): string {
  const parts = Object.fromEntries(
    israelDate.formatToParts(date).map(({ type, value }) => [type, value]),
  );
  return `${parts.day}/${parts.month}/${parts.year}`;
}

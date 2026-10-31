// Only the newest request may update the page. Each search takes a ticket;
// a response whose ticket is no longer the latest is dropped, so a slow older
// search can never overwrite a newer one. Pure, for tests.
export function latestOnly() {
  let n = 0;
  return { next: () => ++n, isLatest: (ticket) => ticket === n };
}

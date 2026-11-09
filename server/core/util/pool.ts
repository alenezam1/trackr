/** Run `fn` over `items` with at most `limit` running at once (order of starts is preserved). */
export async function pool<T>(items: T[], limit: number, fn: (t: T, index: number) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  });
  await Promise.all(workers);
}

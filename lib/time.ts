/** A Date `days` from now (kept out of components so renders stay pure). */
export const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000);

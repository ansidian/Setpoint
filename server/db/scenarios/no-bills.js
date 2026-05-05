// Strips all bill emails so the Bills & Payments section has no content.
// In mock mode, liveBills is always [] from the static mock live-data adapter, so this
// tests the loading shimmer state and the fade-out when no bills arrive.

export default function noBills(briefing) {
  const accounts = briefing.emails?.accounts;
  if (!accounts?.length) return;

  for (const account of accounts) {
    account.important = (account.important || []).filter(e => !e.hasBill);
    account.unread = account.important.filter(e => !e.read).length;
  }

  const totalImportant = accounts.reduce((s, a) => s + a.important.length, 0);
  const totalNoise = accounts.reduce((s, a) => s + (a.noise?.length || 0), 0);
  briefing.emails.summary = `${totalImportant + totalNoise} emails across ${accounts.length} accounts. ${totalImportant} need attention, ${totalNoise} noise.`;
}

noBills.description = "Removes all bill emails — tests loading shimmer and empty bills fade-out";
noBills.category = "States";

// Smooth-scrolls to a dashboard section by its data-sect slug. The short timeout
// lets the dashboard tab paint (after a tab switch) before measuring the target.
export function scrollToSection(slug) {
  setTimeout(() => {
    const el = document.querySelector(`[data-sect="${slug}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 50);
}

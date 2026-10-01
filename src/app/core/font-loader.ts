const loaded = new Set<string>();

/** Lazily adds a Google Fonts stylesheet for each font family the first time it is used. */
export function loadFonts(...families: string[]): void {
  for (const family of families) {
    if (!family || loaded.has(family)) continue;
    loaded.add(family);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@400;500;600;700;800&display=swap`;
    document.head.appendChild(link);
  }
}

export function downloadFile(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function readFileAsText(file: File): Promise<string> {
  return file.text();
}

/**
 * Reads an image file and downsizes it so it fits comfortably in localStorage.
 * Returns a data URL.
 */
export function readImageAsDataUrl(file: File, maxSize = 1600, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.onload = () => {
      const src = String(reader.result);
      // SVG and GIF lose their nature when rasterised; keep them as-is.
      if (file.type === 'image/svg+xml' || file.type === 'image/gif') return resolve(src);
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not a supported image.'));
      img.onload = () => {
        const ratio = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * ratio);
        canvas.height = Math.round(img.height * ratio);
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        resolve(canvas.toDataURL(type, quality));
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}

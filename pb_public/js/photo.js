// photo.js — shrink a phone photo before upload (max 1600 px JPEG): fast on mobile data, under the 5 MB limit.
// Used by the meal photo and the progress photo forms.
export async function shrink(file, max = 1600) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  return new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('toBlob'))), 'image/jpeg', 0.82));
}

// Wire a <label> photo picker: shows a preview and returns a getter for the shrunk photo.
export function photoPicker({ input, preview, label }) {
  let blob = null;
  input.addEventListener('change', async () => {
    const file = input.files[0];
    blob = null;
    if (!file) return;
    try { blob = await shrink(file); } catch { blob = file; }
    preview.src = URL.createObjectURL(blob);
    preview.hidden = false;
    label.hidden = true;
    input.setCustomValidity('');
  });
  return () => blob;
}

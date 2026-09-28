/**
 * One encoder for every pipeline script.
 *
 * Emits two files per photograph:
 *   <id>.webp        full print, long edge MAX_EDGE, quality 82
 *   <id>.thumb.webp  ~THUMB_EDGE long edge, shown while the full decodes
 *
 * WebP over JPEG: ~30% smaller at the same visual quality, universally
 * decodable, and Three's TextureLoader takes it directly. AVIF would be
 * smaller still but decodes slowly on the main thread, which shows up as a
 * hitch exactly when a print comes into view.
 */
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

export const MAX_EDGE = 2048;
export const THUMB_EDGE = 400;

export async function encodePhoto(inPath, outDir, id) {
  const image = sharp(inPath).rotate();
  const meta = await image.metadata();

  // rotate() is lazy, so swap dimensions for 90/270 EXIF orientations.
  const turned = meta.orientation && meta.orientation >= 5;
  const w = turned ? meta.height : meta.width;
  const h = turned ? meta.width : meta.height;
  if (!w || !h) throw new Error('no dimensions');

  const full = join(outDir, `${id}.webp`);
  const thumb = join(outDir, `${id}.thumb.webp`);

  await image
    .clone()
    .resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82, effort: 4 })
    .toFile(full);

  await image
    .clone()
    .resize(THUMB_EDGE, THUMB_EDGE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 70, effort: 4 })
    .toFile(thumb);

  // EXIF capture year, when the camera wrote one.
  let year;
  try {
    const exif = meta.exif ? meta.exif.toString('latin1') : '';
    const m = exif.match(/(19|20)\d{2}[:\-](\d{2})[:\-](\d{2})/);
    if (m) year = m[0].slice(0, 4);
  } catch {
    /* no EXIF is fine */
  }

  return {
    width: w,
    height: h,
    aspect: +(w / h).toFixed(3),
    year,
    bytes: (await stat(full)).size,
    thumbBytes: (await stat(thumb)).size,
  };
}

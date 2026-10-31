// Car Details gallery: one main image, chosen from the thumbnail strip. Pure
// (no DOM), so the captions and stepping are tested in Node.

/** "Exterior · Angle 2 of 4" or "Interior · Image 1 of 2" for image index i. */
export function galleryCaption(exteriorCount, interiorCount, i) {
  if (i < exteriorCount) return `Exterior · Angle ${i + 1} of ${exteriorCount}`;
  const j = i - exteriorCount;
  return j < interiorCount ? `Interior · Image ${j + 1} of ${interiorCount}` : "";
}

/** "View all exterior angles": the next exterior angle after i, wrapping; 0 from an interior image. */
export const nextExterior = (exteriorCount, i) => (exteriorCount ? (i >= 0 && i < exteriorCount - 1 ? i + 1 : 0) : -1);

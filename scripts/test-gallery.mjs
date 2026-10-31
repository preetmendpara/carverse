#!/usr/bin/env node
// Car Details gallery: each image appears once (thumbnail strip), plus ONE
// main image whose "Angle n of m" caption follows the selection.
//   node scripts/test-gallery.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { galleryCaption, nextExterior } from "../public/app/js/core/gallery.js";

let passed = 0;
const check = (name, fn) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

console.log("Captions and stepping");
check("exterior images are 'Angle n of m'", () => {
  assert.equal(galleryCaption(4, 2, 0), "Exterior · Angle 1 of 4");
  assert.equal(galleryCaption(4, 2, 3), "Exterior · Angle 4 of 4");
});
check("interior images are numbered within the interior group", () => {
  assert.equal(galleryCaption(4, 2, 4), "Interior · Image 1 of 2");
  assert.equal(galleryCaption(4, 2, 5), "Interior · Image 2 of 2");
  assert.equal(galleryCaption(0, 1, 0), "Interior · Image 1 of 1");
});
check("out of range gives no caption", () => assert.equal(galleryCaption(2, 0, 5), ""));
check("'View all exterior angles' steps through the angles and wraps", () => {
  assert.equal(nextExterior(4, 0), 1);
  assert.equal(nextExterior(4, 3), 0);
  assert.equal(nextExterior(4, 5), 0, "from an interior image it starts at angle 1");
  assert.equal(nextExterior(0, 0), -1);
});

console.log("Rendering");
const page = await readFile(new URL("../public/app/js/pages/car-details.js", import.meta.url), "utf8");
const css = await readFile(new URL("../public/app/css/style.css", import.meta.url), "utf8");
check("the duplicate large-image grid is gone", () => {
  assert.ok(!/ext-grid|<figure>|figcaption/.test(page));
  assert.ok(!/\.ext-grid/.test(css));
});
check("each image is rendered once as a thumbnail and there is one main image", () => {
  const thumbGroup = page.slice(page.indexOf("const thumbGroup"), page.indexOf("// Two kinds of row"));
  assert.equal((thumbGroup.match(/<img /g) || []).length, 1, "one <img> per image in the strip");
  assert.equal((page.match(/id="main-img"/g) || []).length, 1);
});
check("thumbnail strip comes before the main image, with a caption under it", () => {
  const i = page.indexOf('<div id="thumbs">');
  const j = page.indexOf('<div class="gallery-main"><img id="main-img"');
  const k = page.indexOf('id="main-caption"');
  assert.ok(i > 0 && i < j && j < k);
});
check("clicking a thumbnail updates the main image, its alt text, caption and active state", () => {
  const sel = page.slice(page.indexOf("const select = (i) =>"), page.indexOf("thumbs?.addEventListener"));
  for (const bit of ["main.src = t.src", "main.alt = t.alt", 'getElementById("main-caption").textContent = galleryCaption(', 'classList.toggle("active"']) assert.ok(sel.includes(bit), bit);
  assert.ok(/thumbs\?\.addEventListener\("click"[\s\S]*?select\(Number\(t\.dataset\.i\)\)/.test(page));
});
check("'View all exterior angles' is kept and only moves the main image", () => {
  assert.ok(page.includes('id="all-ext">View all exterior angles<'));
  assert.ok(/getElementById\("all-ext"\)\?\.addEventListener\("click", \(\) => select\(nextExterior\(exteriorShots\.length, current\)\)\)/.test(page));
});

console.log(`\n${passed} checks passed.`);

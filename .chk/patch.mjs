import sharp from 'sharp';
const f = process.argv[2];
const { data, info } = await sharp(f).raw().toBuffer({ resolveWithObject: true });
const lum = (x, y) => { const i = (y * info.width + x) * info.channels; return 0.2126*data[i] + 0.7152*data[i+1] + 0.0722*data[i+2]; };
const avg = (x0, y0, x1, y1) => { let s = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += lum(x, y); n++; } return (s / n).toFixed(1); };
// centre arrow region in the foyer shot vs just left/right of it, same rows
console.log('inside patch   ', avg(640, 604, 700, 616));
console.log('left of patch  ', avg(560, 604, 620, 616));
console.log('right of patch ', avg(820, 604, 880, 616));
console.log('below patch    ', avg(640, 640, 700, 660));

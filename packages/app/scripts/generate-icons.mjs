import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = resolve(__dirname, '..', 'src-tauri', 'icons');
const svgPath = resolve(iconsDir, 'source-icon.svg');

// Generate 1024x1024 source PNG for tauri icon generator
const sourcePng = resolve(iconsDir, 'source-icon.png');

async function generate() {
  console.log('Generating 1024x1024 source PNG from SVG...');
  await sharp(svgPath)
    .resize(1024, 1024)
    .png()
    .toFile(sourcePng);
  console.log('Source PNG created:', sourcePng);
}

generate().catch((err) => {
  console.error('Error generating icon:', err);
  process.exit(1);
});

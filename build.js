const fs = require('fs');
const path = require('path');

const FILES = [
    'src/01-head.html',
    'src/02-styles-full.html',
    'src/03-head-scripts.html',
    'src/04-body-structure.html',
    'src/00-auth-logic.html',
    'src/05-script-header.html',
    'src/legis-2024.js',
    'data/insee-cache.js',
    'data/geo-cache.js',
    'data/communes.js',
    'src/06-main-logic.js',
    'src/06-overlay-logic.js',
    'src/07-html-misc.html',
    'src/08-sidebar-scroll.html',
    'src/09-arr-overlay.html',
    'src/10-epci-overlay.html',
    'src/11-circo-overlay.html',
    'src/14-bv-geojson.html',
    'src/15-bv-polygones.html',
    'src/16-final-scripts.html',
    'src/17-analyse-tab.js',
    'src/18-aac-data.html',
    'src/19-aac-tab.js',
    'src/20-overlay-tab.html',
    'src/21-flyer-tab.js',
    'src/17-closing.html'
];

let finalHtml = '';
FILES.forEach(file => {
    const filePath = path.join(__dirname, file);
    if (fs.existsSync(filePath)) {
        let content = fs.readFileSync(filePath, 'utf8');
        if (file.endsWith('.js')) {
            finalHtml += `<script>\n${content}\n</script>\n`;
        } else {
            finalHtml += content + '\n';
        }
    } else {
        console.warn(`File not found: ${file}`);
    }
});

fs.writeFileSync('atlas.hugo.dreyer.html', finalHtml);
if (!fs.existsSync('dist')) {
    fs.mkdirSync('dist');
}
fs.writeFileSync('dist/index.html', finalHtml);
console.log('Build complete: atlas.hugo.dreyer.html and dist/index.html');

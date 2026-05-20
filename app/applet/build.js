const fs = require('fs');
const path = require('path');

const BASE_DIR = __dirname;
const OUT = path.join(BASE_DIR, 'atlas.hugo.dreyer.html');

const FILES = [
    'src/01-head.html',
    'src/02-styles-full.html',
    'src/03-head-scripts.html',
    'src/04-body-structure.html',
    'src/05-script-header.html',
    'src/06-overlay-logic.js',
    'src/legis-2024.js',
    'data/communes.js',
    'src/06-main-logic.js',
    'src/07-html-misc.html',
    'src/08-sidebar-scroll.html',
    'src/09-arr-overlay.html',
    'src/10-epci-overlay.html',
    'src/14-bv-geojson.html',
    'src/15-bv-polygones.html',
    'src/18-aac-data.html',
    'src/19-aac-tab.js',
    'src/17-analyse-tab.js',
    'src/21-flyer-tab.js',
    'src/20-overlay-tab.html',
    'src/16-final-scripts.html',
    'src/17-closing.html',
];

function build() {
    let result = [];
    let missing = [];
    
    for (const rel_path of FILES) {
        const full_path = path.join(BASE_DIR, rel_path);
        if (!fs.existsSync(full_path)) {
            missing.push(rel_path);
            continue;
        }
        let content = fs.readFileSync(full_path, 'utf8');
        if (rel_path.endsWith('.js')) {
            content = '<script>\n' + content + '\n</script>';
        }
        result.push(content);
    }
            
    if (missing.length > 0) {
        console.error("ERREUR — fichiers manquants :\n  - " + missing.join("\n  - "));
        process.exit(1);
    }
        
    fs.writeFileSync(OUT, result.join('\n'), 'utf8');
        
    const size_kb = fs.statSync(OUT).size / 1024;
    console.log(`✓ Build réussi : atlas.hugo.dreyer.html (${Math.round(size_kb)} Ko)`);
}

build();

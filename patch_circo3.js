const fs = require('fs');

const circoMap = JSON.parse(fs.readFileSync('circo-map.json', 'utf8'));

let content = fs.readFileSync('data/communes.js', 'utf8');
const fallbackMatch = content.match(/const\s+FALLBACK_COMMUNES\s*=\s*(\[.*\]);\s*(const\s+COG_LOOKUP.*)/s);

if (!fallbackMatch) {
    console.error("Could not find FALLBACK_COMMUNES");
    process.exit(1);
}

let arr = JSON.parse(fallbackMatch[1]);
let cogStr = fallbackMatch[2];

arr.forEach(c => {
  let code = circoMap[c.code];
  if (code) {
    c.codeCirconscription = code;
    let numStr = code.substring(code.length - 1);
    let num = parseInt(numStr);
    c.nomCirconscription = num + (num === 1 ? 'ère' : 'ème') + ' circonscription';
  }
});

let out = 'const FALLBACK_COMMUNES=' + JSON.stringify(arr) + ';\n\n' + cogStr + '\n';
fs.writeFileSync('data/communes.js', out);
console.log('patched communes.js');

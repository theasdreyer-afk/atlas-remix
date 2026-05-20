const fs = require('fs');

const circoMap = JSON.parse(fs.readFileSync('circo-map.json', 'utf8'));

let content = fs.readFileSync('data/communes.js', 'utf8');
let idx = content.indexOf('[');
// If ends with ;\n, remove the ;
let jsonStr = content.substring(idx).trim();
if (jsonStr.endsWith(';')) jsonStr = jsonStr.slice(0, -1);

let arr = JSON.parse(jsonStr);

arr.forEach(c => {
  let code = circoMap[c.code];
  if (code) {
    c.codeCirconscription = code;
    let numStr = code.substring(code.length - 1);
    let num = parseInt(numStr);
    c.nomCirconscription = num + (num === 1 ? 'ère' : 'ème') + ' circonscription';
  }
});

let out = 'const ALL_COMMUNES_DATA = ' + JSON.stringify(arr, null, 2) + ';\n';
fs.writeFileSync('data/communes.js', out);
console.log('patched communes.js');

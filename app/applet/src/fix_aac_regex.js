const fs = require('fs');
let code = fs.readFileSync('src/19-aac-tab.js', 'utf8');

const blockStart = "let aacPop = 0;";
const targetEnd = "const subPerHabitant = aacPop > 0 ? (totalSub / aacPop) : 0;";

const startIdx = code.indexOf(blockStart);
const endIdx = code.indexOf(targetEnd) + targetEnd.length;

if (startIdx !== -1 && endIdx !== -1) {
  const replacement = `let aacPop = 0;
  if (typeof allCommunes !== 'undefined') {
    if(aacCurrentCanton && aacCurrentCanton !== 'Tous les cantons') {
      const normStr = s => (s||'').toUpperCase().replace(/[-\\s]/g, '');
      let candCantons = allCommunes.filter(c => normStr(c.nomCanton) === normStr(aacCurrentCanton) || c.codeCanton === aacCurrentCanton);
      aacPop = candCantons.reduce((s,c) => {
        let p = (typeof enrichedData !== 'undefined' && enrichedData[c.code] && enrichedData[c.code].age && enrichedData[c.code].age._total) ? enrichedData[c.code].age._total : (c.population || 0);
        return s + p;
      }, 0);
    } else {
      aacPop = allCommunes.reduce((s,c) => {
        let p = (typeof enrichedData !== 'undefined' && enrichedData[c.code] && enrichedData[c.code].age && enrichedData[c.code].age._total) ? enrichedData[c.code].age._total : (c.population || 0);
        return s + p;
      }, 0);
    }
  }
  const subPerHabitant = aacPop > 0 ? (totalSub / aacPop) : 0;`;
  
  code = code.substring(0, startIdx) + replacement + code.substring(endIdx);
  fs.writeFileSync('src/19-aac-tab.js', code);
  console.log("Block completely replaced.");
} else {
  console.log("Block not found.");
}

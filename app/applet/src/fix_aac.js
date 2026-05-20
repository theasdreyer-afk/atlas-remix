const fs = require('fs');
let code = fs.readFileSync('src/19-aac-tab.js', 'utf8');

const target1 = 'const execRate = totalSub > 0 ? (totalMand / totalSub * 100) : 0;';
const replace1 = `const execRate = totalSub > 0 ? (totalMand / totalSub * 100) : 0;
  let aacPop = 0;
  if (typeof allCommunes !== 'undefined') {
    if(aacCurrentCanton && aacCurrentCanton !== "Tous les cantons") {
      let candCantons = allCommunes.filter(c => c.nomCanton && c.nomCanton.toUpperCase() === aacCurrentCanton.toUpperCase() || c.codeCanton === aacCurrentCanton);
      aacPop = candCantons.reduce((s,c) => s + (c.population || 0), 0);
    } else {
      aacPop = allCommunes.reduce((s,c) => s + (c.population || 0), 0);
    }
  }
  const subPerHabitant = aacPop > 0 ? (totalSub / aacPop) : 0;`;

code = code.replace(target1, replace1);

const target2 = `        <div class="card" style="padding: 20px; text-align: center;">
          <div style="color: var(--txt-muted); font-size: 0.9em; margin-bottom: 5px;">Taux d'exécution</div>
          <div style="font-size: 1.5em; font-weight: bold; color: #3498db;">${'$'}{execRate.toFixed(1)}%</div>
        </div>`;

const replace2 = target2 + `
        <div class="card" style="padding: 20px; text-align: center;">
          <div style="color: var(--txt-muted); font-size: 0.9em; margin-bottom: 5px;">Subventions / hab.</div>
          <div style="font-size: 1.5em; font-weight: bold; color: var(--gold);">${'$'}{fmt(subPerHabitant)}</div>
        </div>`;

code = code.replace(target2, replace2);

fs.writeFileSync('src/19-aac-tab.js', code);
console.log('done');

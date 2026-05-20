const fs = require('fs');

let c = fs.readFileSync('src/17-analyse-tab.js', 'utf8');

let newButtons = `<div class="analyse-buttons-grid">
            <button class="analyse-btn" style="color: var(--gold); border: 1px solid rgba(212,168,67,0.3); background: rgba(212,168,67,0.05);" onclick="showDisputedModal()">⚔️ Disputés</button>
            <button class="analyse-btn" onclick="randomAnalyseCommune()">🎲 Aléatoire</button>
          \${analyseItems.length > 0 ? \`
            <button class="analyse-btn primary" onclick="activateSearchSlot()">+ Comparer</button>
            <button class="analyse-btn danger" onclick="resetAnalyse()">✕ Réinit.</button>
          \` : ''}
        </div>`;

c = c.replace(/<div style="display:flex; flex-direction:column; gap:8px; align-items: stretch; justify-content: center; min-width: 250px;">[\s\S]*?<\/div>\s*<\/div>\s*`/s, newButtons + '\n      </div>\n    `');


// 2. Fix pass permis
let oldPass = `<div style="display:flex; flex:1; justify-content: flex-end; gap:20px; overflow-x: auto; white-space: nowrap;">`;
let newPass = `<div class="analyse-pass-container">`;
c = c.replace(oldPass, newPass);


// 3. Add CSS
let cssAdd = `
  .analyse-buttons-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    min-width: 250px;
    align-items: center;
  }
  .analyse-buttons-grid .analyse-btn {
    border-radius: 8px !important;
    margin: 0 !important;
    justify-content: center;
    border: 1px solid rgba(255,255,255,0.1);
  }
  .analyse-pass-container {
    display: flex;
    flex: 1;
    justify-content: flex-end;
    gap: 20px;
  }
  @media (max-width: 768px) {
    .analyse-header { flex-direction: column !important; align-items: stretch !important; }
    .analyse-header > div { min-width: 0 !important; width: 100% !important; margin: 0 !important; }
    .analyse-search-container { max-width: none !important; }
    
    .analyse-buttons-grid {
      grid-template-columns: 1fr 1fr;
      width: 100%;
      min-width: 0;
    }
    
    .analyse-pass-container {
      flex-direction: column;
      align-items: flex-start;
      gap: 15px;
      margin-top: 15px;
      border-top: 1px solid rgba(255,255,255,0.05);
      padding-top: 15px;
    }
    .analyse-pass-container > div {
      border-left: none !important;
      padding-left: 0 !important;
    }
  }
</style>`;

c = c.replace('</style>', cssAdd);

fs.writeFileSync('src/17-analyse-tab.js', c);

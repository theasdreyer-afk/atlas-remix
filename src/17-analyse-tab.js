
  var analyseItems = [];
  window.analyseShowLegis = window.analyseShowLegis ?? true;
  window.analyseShowPassPermis = window.analyseShowPassPermis ?? true;
  window.analyseShowPassAvenir = window.analyseShowPassAvenir ?? true;
  window.analyseEvolCol1 = window.analyseEvolCol1 || {};
  window.analyseEvolCol2 = window.analyseEvolCol2 || {};
  window.analyseDetailsState = window.analyseDetailsState || { demo: false, csp: false, log: false, elec: true, evol: true, inds: true };
  
  window.toggleAnalyseDetails = function(section) {
      window.analyseDetailsState[section] = !window.analyseDetailsState[section];
      renderAnalyseHome();
  };

  window.setAnalyseEvolCol = function(slot, colId, v) { 
      if (colId === 1) window.analyseEvolCol1[slot] = v;
      else window.analyseEvolCol2[slot] = v;
      renderAnalyseHome(); 
  }; 
  window.setAllAnalyseEvolCol = function(colId, v) {
      analyseItems.forEach((_, i) => {
          if (colId === 1) window.analyseEvolCol1[i+1] = v;
          else window.analyseEvolCol2[i+1] = v;
      });
      renderAnalyseHome();
  };
  // items look like: { type: 'commune', code: '60057' } or { type: 'canton', nom: 'Beauvais-1' } or { type: 'search' }

  function renderAnalyseHome() {
    const parent = document.getElementById('analyseContent');
    if (!parent) return;

    let searchElements = '';
    if (analyseItems.length === 0) {
      searchElements = `
        <div class="analyse-search-container" style="flex:1; min-width: 250px; max-width: 500px;">
          <input type="text" class="analyse-search-input" placeholder="Rechercher une commune (ex: Beauvais) ou un canton (ex: C: Beauvais-1)..." oninput="handleAnalyseSearch(this, 0)">
          <div id="analyseResults0" class="analyse-results"></div>
        </div>
      `;
    } else {
      analyseItems.forEach((item, idx) => {
        let val = '';
        if (item.type !== 'search') {
          let nom = item.type === 'canton' ? `Canton de ${item.nom}` : (allCommunes.find(c=>c.code===item.code)?.nom || item.code);
          val = nom.replace(/"/g, '&quot;');
        }
        searchElements += `
          <div style="display:flex; align-items:center; gap: 8px; flex: 1; min-width: 180px; max-width: 300px; padding: 6px 0;">
            <div class="analyse-search-container" style="flex: 1;">
              <input type="text" class="analyse-search-input" id="searchInp${idx}" placeholder="Rechercher..." value="${val}" oninput="handleAnalyseSearch(this, ${idx})">
              <div id="analyseResults${idx}" class="analyse-results"></div>
            </div>
            <button class="analyse-btn danger" style="padding:4px; border-radius:50%; width:24px; height:24px; display:flex; justify-content:center; align-items:center; border:none;" onclick="clearAnalyseSlot(${idx})" title="Retirer">✕</button>
          </div>
        `;
      });
    }

    const headerHtml = `
      <div class="analyse-header">
        <div style="display:flex; flex-wrap:wrap; gap:12px; flex: 1; align-items:center; min-width: 300px;">
          ${searchElements}
        </div>
        <div class="analyse-buttons-grid">
            <button class="analyse-btn" style="color: var(--gold); border: 1px solid rgba(212,168,67,0.3) !important; background: rgba(212,168,67,0.05);" onclick="showDisputedModal()">⚔️ Disputés</button>
            <button class="analyse-btn" onclick="randomAnalyseCommune()">🎲 Aléatoire</button>
          ${analyseItems.length > 0 ? `
            <button class="analyse-btn primary" onclick="activateSearchSlot()">+ Comparer</button>
            <button class="analyse-btn danger" onclick="resetAnalyse()">✕ Réinit.</button>
          ` : ''}
        </div>
      </div>
    `;

    if (analyseItems.length === 0) {
      parent.innerHTML = `
        ${headerHtml}
        <div style="text-align:center; padding: 100px 20px; opacity: 0.5;">
          <div style="font-size: 32px; margin-bottom: 20px;">📊</div>
          <h2 style="margin-bottom: 10px;">Atlas Électoral & Synthèse INSEE</h2>
          <p>Recherchez une commune ou un canton pour afficher son profil détaillé, et ajoutez d'autres entités pour les comparer facilement.</p>
        </div>
      `;
      return;
    }

    // comparison summary hidden per user request
    let summaryHtml = '';
    // if (analyseItems.length >= 2 && analyseItems[0].type !== 'search' && analyseItems[1].type !== 'search') {
    //   summaryHtml = renderComparisonSummary(analyseItems[0], analyseItems[1]);
    // }

    let cardsHtml = `<div class="analyse-grid-container"><div class="analyse-grid ${analyseItems.length > 1 ? 'comparison' : ''}">`;
    analyseItems.forEach((item, idx) => {
      cardsHtml += renderCommuneCard(item, idx + 1);
    });
    cardsHtml += `</div></div>`;

    parent.innerHTML = headerHtml + summaryHtml + cardsHtml;
  }

  function handleAnalyseSearch(input, slot) {
    const val = input.value.trim().toLowerCase();
    const resultsDiv = document.getElementById(`analyseResults${slot}`);
    if (val.length < 2) {
      if (resultsDiv) resultsDiv.style.display = 'none';
      return;
    }

    // Match communes
    let matchesCommunes = allCommunes.filter(c => 
      c.nom.toLowerCase().includes(val) || c.code.includes(val)
    ).slice(0, 10).map(c => ({...c, isCanton: false}));

    // Match cantons
    const uniqueCantons = [...new Set(allCommunes.map(c => c.nomCanton).filter(Boolean))];
    let matchesCantons = [];
    if (val.startsWith('c ') || val.startsWith('c:')) {
      let subval = val.substring(2).trim();
      matchesCantons = uniqueCantons.filter(c => c.toLowerCase().includes(subval)).slice(0,5).map(c => ({nom: c, isCanton: true}));
    } else {
      matchesCantons = uniqueCantons.filter(c => c.toLowerCase().includes(val)).slice(0,3).map(c => ({nom: c, isCanton: true}));
    }

    let matches = [...matchesCantons, ...matchesCommunes];

    if (matches.length === 0) {
      if(resultsDiv) resultsDiv.innerHTML = '<div style="padding:10px; opacity:0.6;">Désolé, aucune correspondance trouvée.</div>';
    } else {
      if(resultsDiv) resultsDiv.innerHTML = matches.map(c => `
        <div class="analyse-result-item" onclick="selectAnalyseItem(${c.isCanton}, '${c.isCanton ? c.nom.replace(/'/g, '\\\'') : c.code}', ${slot})">
          <span>${c.isCanton ? `🏷️ Canton de ${c.nom}` : c.nom}</span>
          <span style="opacity:0.5; font-size:11px;">${c.isCanton ? 'Canton' : c.code}</span>
        </div>
      `).join('');
    }
    if (resultsDiv) resultsDiv.style.display = 'block';
  }

  function selectAnalyseItem(isCanton, idOrName, slot) {
    const newItem = isCanton ? { type: 'canton', nom: idOrName } : { type: 'commune', code: idOrName };
    if (slot >= 0 && slot < analyseItems.length) {
      analyseItems[slot] = newItem;
    } else {
      analyseItems.push(newItem);
    }
    renderAnalyseHome();
  }

  function clearAnalyseSlot(slot) {
    if (slot >= 0 && slot < analyseItems.length) {
      analyseItems.splice(slot, 1);
    }
    renderAnalyseHome();
  }

  function resetAnalyse() {
    analyseItems = [];
    renderAnalyseHome();
  }

  function activateSearchSlot() {
    analyseItems.push({ type: 'search' });
    renderAnalyseHome();
    setTimeout(() => {
        const idx = analyseItems.length - 1;
        const inp = document.getElementById(`searchInp${idx}`);
        if(inp) { inp.focus(); inp.value = ''; }
    }, 50);
  }

  function randomAnalyseCommune() {
    const idx = Math.floor(Math.random() * allCommunes.length);
    if (analyseItems.length === 0 || analyseItems[0].type === 'search') {
      analyseItems[0] = { type: 'commune', code: allCommunes[idx].code };
    } else {
      analyseItems.push({ type: 'commune', code: allCommunes[idx].code });
    }
    renderAnalyseHome();
  }

  // --- Aggregate Helper for Cantons ---
  function _aggregateElec(arr) {
     let valid = (arr || []).filter(x => x && (x.vot !== undefined));
     if (!valid.length) return null;
     let vot = 0, ins = 0, exp = 0;
     let candMap = {};
     valid.forEach(d => {
         vot += d.vot || 0;
         ins += d.ins || 0;
         exp += d.exp || 0;
         (d.cands || []).forEach(cand => {
             let key = (cand.nu||'') + '|' + (cand.bi||'');
             if (!candMap[key]) candMap[key] = { ...cand, v: 0 };
             candMap[key].v += cand.v || (cand.p ? cand.p/100*d.exp : 0);
         });
     });
     let cands = Object.values(candMap).map(c => {
         c.p = exp > 0 ? (c.v / exp * 100) : 0;
         return c;
     }).sort((a,b) => b.v - a.v);
     
     return { 
         v: vot, i: ins, exp, cands, 
         pctPart: ins > 0 ? (vot / ins * 100) : 0, 
         pctAbs: ins > 0 ? ((ins - vot) / ins * 100) : 0, 
         n: cands[0]?.nu, bl: cands[0]?.bl, b: cands[0]?.bi,
         vot, ins
     };
  }

  function getCantonData(nomCanton) {
     const communes = allCommunes.filter(c => c.nomCanton === nomCanton);
     if (!communes.length) return null;
     
     let pop = 0, area = 0;
     let inseeAgg = {
       age: { _total:0 },
       emploi: { _total:0 },
       logement: { 'Logements total':0, 'Rés. principales':0, 'Propriétaires':0, 'Rés. secondaires':0, 'Logts vacants':0 },
       passPermis: { total:0, acceptes:0, payes:0 },
       passAvenir: { enregistrements:0, acceptes:0 }
     };
     
     communes.forEach(c => {
       pop += c.population || 0;
       area += c.surfaceKm2 || 0;
       let insee = enrichedData[c.code] || {};
       if (insee.passPermis) {
          inseeAgg.passPermis.total += insee.passPermis.total || 0;
          inseeAgg.passPermis.acceptes += insee.passPermis.acceptes || 0;
          inseeAgg.passPermis.payes += insee.passPermis.payes || 0;
       }
       if (insee.passAvenir) {
          inseeAgg.passAvenir.enregistrements += insee.passAvenir.enregistrements || 0;
          inseeAgg.passAvenir.acceptes += insee.passAvenir.acceptes || 0;
       }
       if (insee.age) {
          ['0–14 ans', '15–29 ans', '30–44 ans', '45–59 ans', '60–74 ans', '75 ans +'].forEach(k => {
             if (insee.age[k]) {
                inseeAgg.age[k] = (inseeAgg.age[k]||0) + insee.age[k];
                inseeAgg.age._total += insee.age[k];
             }
          });
       }
       if (insee.emploi) {
          ['Ouvriers', 'Employés', 'Prof. interm.', 'Retraités', 'Cadres', 'Artisans/Comm.', 'Agriculteurs'].forEach(k => {
             if (insee.emploi[k]) inseeAgg.emploi[k] = (inseeAgg.emploi[k]||0) + insee.emploi[k];
          });
       }
       if (insee.logement) {
          ['Logements total', 'Rés. principales', 'Propriétaires', 'Rés. secondaires', 'Logts vacants'].forEach(k => {
             if (insee.logement[k]) inseeAgg.logement[k] = (inseeAgg.logement[k]||0) + insee.logement[k];
          });
       }
     });

     let e21T1 = _aggregateElec(communes.map(c => window.elecDataT1 ? window.elecDataT1[c.code] : null));
     let e21T2 = _aggregateElec(communes.map(c => window.elecDataT2 ? window.elecDataT2[c.code] : null));
     let e15T1 = _aggregateElec(communes.map(c => window.elec15DataT1 ? window.elec15DataT1[c.code] : null));
     let e15T2 = _aggregateElec(communes.map(c => window.elec15DataT2 ? window.elec15DataT2[c.code] : null));
     let legis24T1 = _aggregateElec(communes.map(c => window.LEGIS2024T1?.[c.code]));
     let legis24T2 = _aggregateElec(communes.map(c => window.LEGIS2024T2?.[c.code]));

     return {
       isCanton: true,
       nom: nomCanton,
       population: pop,
       area: area,
       density: area > 0 ? (pop / area) : 0,
       insee: inseeAgg,
       e21T1, e21T2, e15T1, e15T2, legis24T1, legis24T2
     };
  }

  function renderComparisonSummary(item1, item2) {
    let c1, c2, e21T1c1, e21T1c2;

    if (item1.type === 'canton') {
       c1 = getCantonData(item1.nom);
       if(!c1) return '';
       e21T1c1 = c1.e21T1 || {};
    } else {
       c1 = allCommunes.find(x=>x.code===item1.code);
       if(!c1) return '';
       e21T1c1 = window.elecDataT1 ? window.elecDataT1[item1.code] || (typeof elecDataT1 !== 'undefined' ? elecDataT1[item1.code] : {}) : {};
    }

    if (item2.type === 'canton') {
       c2 = getCantonData(item2.nom);
       if(!c2) return '';
       e21T1c2 = c2.e21T1 || {};
    } else {
       c2 = allCommunes.find(x=>x.code===item2.code);
       if(!c2) return '';
       e21T1c2 = window.elecDataT1 ? window.elecDataT1[item2.code] || (typeof elecDataT1 !== 'undefined' ? elecDataT1[item2.code] : {}) : {};
    }

    const popDiff = (c1.population||0) - (c2.population||0);
    
    const fmtC = val => new Intl.NumberFormat('fr-FR', {style:'currency', currency:'EUR', maximumFractionDigits:0}).format(val);
    const normStr = s => (s||'').toUpperCase().replace(/[-\s]/g, '');
    let sub1Txt = 'N/A', sub2Txt = 'N/A';
    if (window.AAC_DATA_LOADED && window.AAC_DATA) {
        let f1 = [], f2 = [];
        let hab1 = c1.population || 0, hab2 = c2.population || 0;
        
        if (item1.type === 'canton') {
            f1 = window.AAC_DATA.filter(d => normStr(d.canton) === normStr(item1.nom));
            let cants1 = allCommunes.filter(c => normStr(c.nomCanton) === normStr(item1.nom) || c.codeCanton === item1.nom);
            hab1 = cants1.reduce((s,c) => s + ((typeof enrichedData !== 'undefined' && enrichedData[c.code]?.age?._total) ? enrichedData[c.code].age._total : (c.population || 0)), 0);
        } else {
            const nom1 = allCommunes.find(x=>x.code===item1.code)?.nom || '';
            f1 = window.AAC_DATA.filter(d => normStr(d.beneficiaire).includes(normStr(nom1)));
            hab1 = (typeof enrichedData !== 'undefined' && enrichedData[item1.code]?.age?._total) ? enrichedData[item1.code].age._total : (c1.population || 0);
        }
        
        if (item2.type === 'canton') {
            f2 = window.AAC_DATA.filter(d => normStr(d.canton) === normStr(item2.nom));
            let cants2 = allCommunes.filter(c => normStr(c.nomCanton) === normStr(item2.nom) || c.codeCanton === item2.nom);
            hab2 = cants2.reduce((s,c) => s + ((typeof enrichedData !== 'undefined' && enrichedData[c.code]?.age?._total) ? enrichedData[c.code].age._total : (c.population || 0)), 0);
        } else {
            const nom2 = allCommunes.find(x=>x.code===item2.code)?.nom || '';
            f2 = window.AAC_DATA.filter(d => normStr(d.beneficiaire).includes(normStr(nom2)));
            hab2 = (typeof enrichedData !== 'undefined' && enrichedData[item2.code]?.age?._total) ? enrichedData[item2.code].age._total : (c2.population || 0);
        }
        
        const sub1 = f1.reduce((acc, d) => acc + (d.montant_vote || 0), 0);
        const sub2 = f2.reduce((acc, d) => acc + (d.montant_vote || 0), 0);
        
        sub1Txt = hab1 > 0 ? fmtC(sub1 / hab1) : '0 €';
        sub2Txt = hab2 > 0 ? fmtC(sub2 / hab2) : '0 €';
    }
    
    const t1 = e21T1c1?.bl || (typeof NUANCE_BLOC !== 'undefined' ? NUANCE_BLOC[e21T1c1?.n||e21T1c1?.n1] : null) || 'Divers';
    const t2 = e21T1c2?.bl || (typeof NUANCE_BLOC !== 'undefined' ? NUANCE_BLOC[e21T1c2?.n||e21T1c2?.n1] : null) || 'Divers';

    return `
      <div class="summary-bandeau">
        <div class="summary-item">
          <span>Diff. de Population</span>
          ${popDiff > 0 ? '+' : ''}${Math.abs(popDiff).toLocaleString('fr-FR')} Hab.
        </div>
        <div class="summary-item">
          <span>Tendances T1 2021</span>
          ${t1} vs ${t2}
        </div>
        <div class=summary-item>
          <span>Abstention</span>
          ${((e21T1c1?.pctAbs || 0).toFixed(1))}% vs ${((e21T1c2?.pctAbs || 0).toFixed(1))}%
        </div>
        <div class=summary-item>
          <span>Subventions / Hab</span>
          ${sub1Txt} vs ${sub2Txt}
        </div>
        <div style="flex:1;"></div>
      </div>
    `;
  }

  function renderCommuneCard(item, slot) {
    if (!item || item.type === 'search') {
      return `
        <div class="analyse-card" style="justify-content:center; align-items:center; opacity:0.7; border: 2px dashed var(--border);">
           <div style="font-size:20px; margin-bottom:10px;">🔍</div>
           <p>Recherchez pour afficher une fiche.</p>
        </div>
      `;
    }

    let c, insee, e21T1, e21T2, e15T1, e15T2, legis24T1, legis24T2;
    let titlePrefix, badgeHtml;

    if (item.type === 'canton') {
      c = getCantonData(item.nom);
      if (!c) return '';
      insee = c.insee;
      e21T1 = c.e21T1; e21T2 = c.e21T2; e15T1 = c.e15T1; e15T2 = c.e15T2;
      legis24T1 = c.legis24T1; legis24T2 = c.legis24T2;
      titlePrefix = "Canton de";
      badgeHtml = `<div class="analyse-badge">Canton</div>`;
    } else {
      c = allCommunes.find(x => x.code === item.code);
      if (!c) return '';
      insee = enrichedData[item.code] || {};
      e21T1 = window.elecDataT1 ? window.elecDataT1[item.code] || (typeof elecDataT1 !== 'undefined' ? elecDataT1[item.code] : null) : null;
      e21T2 = window.elecDataT2 ? window.elecDataT2[item.code] || (typeof elecDataT2 !== 'undefined' ? elecDataT2[item.code] : null) : null;
      e15T1 = window.elec15DataT1 ? window.elec15DataT1[item.code] || (typeof elec15DataT1 !== 'undefined' ? elec15DataT1[item.code] : null) : null;
      e15T2 = window.elec15DataT2 ? window.elec15DataT2[item.code] || (typeof elec15DataT2 !== 'undefined' ? elec15DataT2[item.code] : null) : null;
      legis24T1 = window.LEGIS2024T1 ? window.LEGIS2024T1[item.code] : null;
      legis24T2 = window.LEGIS2024T2 ? window.LEGIS2024T2[item.code] : null;
      titlePrefix = "Commune de";
      badgeHtml = `
        <div class="analyse-badge">Canton ${c.nomCanton || c.codeCanton}</div>
      `;
    }

    let h = `<div class="analyse-card c${slot}">`;

    // BLOC 0: Header
    h += `
      <div style="display:flex; flex-direction:column; gap:10px;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
          <div>
            <div style="text-transform:uppercase; font-size:10px; font-weight:900; letter-spacing:0.1em; color:var(--txt-muted);">${titlePrefix}</div>
            <h2 style="margin:0; font-size: 20px; line-height:1.1; font-weight:900; color:var(--txt);">${c.nom}</h2>
          </div>
          <div style="display:flex; flex-wrap:wrap; gap:5px; justify-content:flex-end;">
            ${badgeHtml}
          </div>
        </div>
        <div style="display:flex; align-items:center; justify-content:space-between; gap:20px; border-top:1px solid rgba(255,255,255,0.1); padding-top:15px; margin-top:0px;">
          <div style="flex-shrink:0;">
            <div style="font-size: 24px; font-weight:900; color:var(--gold); line-height:1;">${(c.population||0).toLocaleString('fr-FR')}</div>
            <div style="font-size:10px; opacity:0.6; text-transform:uppercase;">Habitants</div>
          </div>
          
          <div class="analyse-pass-container">
            ${insee && insee.passPermis ? `
              <div style="border-left:1px solid rgba(255,255,255,0.1); padding-left:20px;">
                <div style="font-size:12px; color:#4caf50; font-weight:bold; margin-bottom:4px; text-transform:uppercase;">🚗 Bilan Pass<br>Permis</div>
                <div style="display:flex; gap:15px;">
                  <div><div style="font-size:15px; font-weight:bold; line-height:1;">${insee.passPermis.acceptes || 0}</div><div style="font-size:9px; opacity:0.6; text-transform:uppercase;">Acceptés</div></div>
                  <div><div style="font-size:15px; font-weight:bold; line-height:1;">${insee.passPermis.payes || 0}</div><div style="font-size:9px; opacity:0.6; text-transform:uppercase;">Payés</div></div>
                </div>
              </div>
            ` : ''}
            ${insee && insee.passAvenir ? `
              <div style="border-left:1px solid rgba(255,255,255,0.1); padding-left:20px;">
                <div style="font-size:12px; color:#29b6f6; font-weight:bold; margin-bottom:4px; text-transform:uppercase;">🎓 Bilan Pass<br>Avenir</div>
                <div style="display:flex; gap:15px;">
                  <div><div style="font-size:15px; font-weight:bold; line-height:1;">${insee.passAvenir.enregistrements || 0}</div><div style="font-size:9px; opacity:0.6; text-transform:uppercase;">Enregistrés</div></div>
                  <div><div style="font-size:15px; font-weight:bold; line-height:1;">${insee.passAvenir.acceptes || 0}</div><div style="font-size:9px; opacity:0.6; text-transform:uppercase;">Acceptés</div></div>
                </div>
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    `;

    // BLOC 1: Démographie
    const ageData = insee ? insee.age : null;
    const isDemoOpen = window.analyseDetailsState.demo;
    h += `<div>
      <div class="analyse-section-title" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center; gap:10px; user-select:none;" onclick="if(window.toggleAnalyseDetails) window.toggleAnalyseDetails('demo');">
        <span style="line-height:1.2;">👥 Démographie</span>
        <span style="flex-shrink:0;">${isDemoOpen ? '▼' : '▶'}</span>
      </div>`;
    if (isDemoOpen) {
      if (ageData && ageData._total > 0) {
        const keys = ['0–14 ans', '15–29 ans', '30–44 ans', '45–59 ans', '60–74 ans', '75 ans +'];
        const best = keys.reduce((a, b) => ( (ageData[a]||0) > (ageData[b]||0) ? a : b));
        keys.forEach(k => {
          const val = ageData[k] || 0;
          const pct = (val / ageData._total * 100);
          h += `
            <div class="hbar-row">
              <div class="hbar-info">
                <span style="${k === best ? 'font-weight:900; color:var(--gold);' : ''}">${k}</span>
                <span>${pct.toFixed(1)}%</span>
              </div>
              <div class="hbar-bg">
                <div class="hbar-fill" style="width:${pct}%; background:${k === best ? 'var(--gold)' : (slot===1?'#1a56db':'#f59e0b')}; opacity:${k===best?1:0.6};"></div>
              </div>
            </div>
          `;
        });
        h += `<div style="font-size:11px; font-style:italic; opacity:0.6; margin-top:5px; text-align:right;">Tranche prédominante : ${best}</div>`;
      } else {
        h += `<div class="placeholder-msg">Importez les données pour afficher cette section</div>`;
      }
    }
    h += `</div>`;

    // BLOC 2: Sociologie
    const cspData = insee ? insee.emploi : null;
    const isCspOpen = window.analyseDetailsState.csp;
    h += `<div>
      <div class="analyse-section-title" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center; gap:10px; user-select:none;" onclick="if(window.toggleAnalyseDetails) window.toggleAnalyseDetails('csp');">
        <span style="line-height:1.2;">💼 Cat. Socioprofessionnelles</span>
        <span style="flex-shrink:0;">${isCspOpen ? '▼' : '▶'}</span>
      </div>`;
    if (isCspOpen) {
      if (cspData) {
        const csps = ['Ouvriers', 'Employés', 'Prof. interm.', 'Retraités', 'Cadres', 'Artisans/Comm.', 'Agriculteurs'];
        const subTotal = csps.reduce((s, k) => s + (cspData[k] || 0), 0);
        const sortedCsps = [...csps].sort((a, b) => (cspData[b] || 0) - (cspData[a] || 0));
        
        sortedCsps.forEach(k => {
          const val = cspData[k] || 0;
          const pct = subTotal > 0 ? (val / subTotal * 100) : 0;
          if (pct < 1 && val === 0) return;
          h += `
            <div class="hbar-row">
              <div class="hbar-info">
                <span>${k}</span>
                <span>${pct.toFixed(1)}%</span>
              </div>
              <div class="hbar-bg">
                <div class="hbar-fill" style="width:${pct}%; background:${slot===1?'#1a56db':'#f59e0b'}; opacity:0.7;"></div>
              </div>
            </div>
          `;
        });
        const ratio = (cspData['Cadres'] || 0) / (cspData['Ouvriers'] || 1);
        const ratioLabel = ratio > 1.2 ? "Profil de cadres" : (ratio < 0.8 ? "Profil ouvrier" : "Profil mixte");
        h += `<div style="margin-top:10px; padding:8px; background:rgba(255,255,255,0.05); border-radius:6px; font-size:11px; text-align:center;">
          <strong>Type social :</strong> ${ratioLabel}
        </div>`;
      } else {
        h += `<div class="placeholder-msg">Importez les données pour afficher cette section</div>`;
      }
    }
    h += `</div>`;

    // BLOC 3: Logement
    const logData = insee ? insee.logement : null;
    const isLogOpen = window.analyseDetailsState.log;
    h += `<div>
      <div class="analyse-section-title" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center; gap:10px; user-select:none;" onclick="if(window.toggleAnalyseDetails) window.toggleAnalyseDetails('log');">
        <span style="line-height:1.2;">🏠 Logement</span>
        <span style="flex-shrink:0;">${isLogOpen ? '▼' : '▶'}</span>
      </div>`;
    if (isLogOpen) {
      if (logData && logData['Logements total'] > 0) {
        const tot = logData['Logements total'];
        const rp = logData['Rés. principales'] || 0;
        const pctProp = rp ? (logData['Propriétaires'] / rp * 100) : 0;
        const pctSec = (logData['Rés. secondaires'] / tot * 100);
        const pctVac = (logData['Logts vacants'] / tot * 100);

        h += `
          <div style="display:flex; flex-direction:column; gap:15px;">
             <div>
                <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:5px;">
                  <span>Propriétaires vs Locataires</span>
                  <span>${pctProp.toFixed(0)}% Prop.</span>
                </div>
                <div style="height:14px; background:#e74c3c; border-radius:7px; overflow:hidden; display:flex;">
                  <div style="width:${pctProp}%; background:#2ecc71;"></div>
                </div>
             </div>
             <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                <div style="padding:10px; background:rgba(255,255,255,0.05); border-radius:8px; text-align:center;">
                  <div style="font-size: 20px; font-weight:900;">${pctSec.toFixed(1)}%</div>
                  <div style="font-size:9px; opacity:0.6; text-transform:uppercase;">Rés. Secondaires</div>
                </div>
                <div style="padding:10px; background:rgba(255,255,255,0.05); border-radius:8px; text-align:center;">
                  <div style="font-size: 20px; font-weight:900;">${pctVac.toFixed(1)}%</div>
                  <div style="font-size:9px; opacity:0.6; text-transform:uppercase;">Vacants</div>
                </div>
             </div>
          </div>
        `;
      } else {
        h += `<div class="placeholder-msg">Importez les données pour afficher cette section</div>`;
      }
    }
    h += `</div>`;

    // BLOC 4: Élections
    const isElecOpen = window.analyseDetailsState.elec !== false; // Default true or use state if needed, let's default to closed:
    const isElecStateOpen = window.analyseDetailsState.elec;
    h += `<div>
      <div class="analyse-section-title" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center; gap:10px; user-select:none; margin-top:20px;" onclick="if(window.toggleAnalyseDetails) window.toggleAnalyseDetails('elec');">
        <span style="line-height:1.2;">🗳️ Élections</span>
        <span style="flex-shrink:0;">${isElecStateOpen ? '▼' : '▶'}</span>
      </div>`;
    
    if (isElecStateOpen) {
      if (true) {
          h += `<div class="analyse-section-title" style="font-size: 13px; margin-top:10px;">Législatives 2024</div>`;
          if (legis24T1) {
            h += `<div class="elec-grid">`;
            h += renderElecBox(legis24T1, "2024 T1");
            h += renderElecBox(legis24T2, "2024 T2");
            h += `</div>`;
          } else {
            h += `<div class="placeholder-msg">Données électorales (Législatives) non disponibles pour cette commune</div>`;
          }
      }

      h += `<div class="analyse-section-title" style="font-size: 13px; margin-top:15px;">Départementales</div>`;
      if (e21T1) {
        h += `<div class="elec-grid">`;
        h += renderElecBox(e15T1, "2015 T1");
        h += renderElecBox(e15T2, "2015 T2");
        h += renderElecBox(e21T1, "2021 T1");
        h += renderElecBox(e21T2, "2021 T2");
        h += `</div>`;
      } else {
        h += `<div class="placeholder-msg">Données électorales non disponibles pour cette commune</div>`;
      }
    }
    h += `</div>`;

    // BLOC 5: Évolution
    const isEvolOpen = window.analyseDetailsState.evol !== false;
    const isEvolStateOpen = window.analyseDetailsState.evol;
    
    const col1Round = window.analyseEvolCol1[slot] || '15T1';
    const col2Round = window.analyseEvolCol2[slot] || '21T1';
    
    const getBaseData = (colRnd) => {
        if (colRnd === '15T1') return e15T1;
        if (colRnd === '15T2') return e15T2;
        if (colRnd === '21T1') return e21T1;
        if (colRnd === '21T2') return e21T2;
        if (colRnd === 'L24T1') return legis24T1;
        if (colRnd === 'L24T2') return legis24T2;
        return null;
    };
    
    const eBase1 = getBaseData(col1Round);
    const eBase2 = getBaseData(col2Round);
    
    const fmtLbl = r => r.replace('15', '2015 ').replace('21', '2021 ').replace('L24', 'Légis. 2024 ');
    const tLabel1 = fmtLbl(col1Round);
    const tLabel2 = fmtLbl(col2Round);

    h += `<div>
      <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-top:20px; margin-bottom:10px;">
        <div class="analyse-section-title" style="margin-bottom:0; cursor:pointer; display:flex; justify-content:space-between; align-items:center; gap:10px; user-select:none; flex:1;" onclick="if(window.toggleAnalyseDetails) window.toggleAnalyseDetails('evol');">
          <span style="line-height:1.2;">📈 Évolution politique</span>
          <span style="flex-shrink:0;">${isEvolStateOpen ? '▼' : '▶'}</span>
        </div>
      </div>`;
    
    if (isEvolStateOpen) {
      h += `
      <div style="display:flex; justify-content:space-between; gap:10px; margin-bottom:15px;">
        <div style="display:flex; flex-direction:column; gap:4px; flex:1;">
          <label style="font-size:9px; opacity:0.7; text-transform:uppercase;">Colonne 1</label>
          <div style="display:flex; gap:4px;">
            <select onchange="if(window.setAnalyseEvolCol) window.setAnalyseEvolCol(${slot}, 1, this.value);" style="background:rgba(0,0,0,0.2); color:var(--txt); border:1px solid var(--border); border-radius:4px; outline:none; font-family:inherit; font-size:11px; cursor:pointer; padding:4px; flex:1;">
              <option value="15T1" ${col1Round==='15T1'?'selected':''} style="color:#000;">2015 Tour 1</option>
              <option value="15T2" ${col1Round==='15T2'?'selected':''} style="color:#000;">2015 Tour 2</option>
              <option value="21T1" ${col1Round==='21T1'?'selected':''} style="color:#000;">2021 Tour 1</option>
              <option value="21T2" ${col1Round==='21T2'?'selected':''} style="color:#000;">2021 Tour 2</option>
              <option value="L24T1" ${col1Round==='L24T1'?'selected':''} style="color:#000;">Législatives 2024 T1</option>
              <option value="L24T2" ${col1Round==='L24T2'?'selected':''} style="color:#000;">Législatives 2024 T2</option>
            </select>
            <button onclick="if(window.setAllAnalyseEvolCol) window.setAllAnalyseEvolCol(1, this.previousElementSibling.value);" style="background:rgba(255,255,255,0.1); border:none; padding:0 6px; border-radius:4px; font-size:9px; text-transform:uppercase; font-weight:bold; color:var(--txt); cursor:pointer; display:flex; align-items:center; justify-content:center;" title="Appliquer à toutes les colonnes">Tous</button>
          </div>
        </div>
        <div style="display:flex; flex-direction:column; gap:4px; flex:1;">
          <label style="font-size:9px; opacity:0.7; text-transform:uppercase;">Colonne 2</label>
          <div style="display:flex; gap:4px;">
            <select onchange="if(window.setAnalyseEvolCol) window.setAnalyseEvolCol(${slot}, 2, this.value);" style="background:rgba(0,0,0,0.2); color:var(--txt); border:1px solid var(--border); border-radius:4px; outline:none; font-family:inherit; font-size:11px; cursor:pointer; padding:4px; flex:1;">
              <option value="15T1" ${col2Round==='15T1'?'selected':''} style="color:#000;">2015 Tour 1</option>
              <option value="15T2" ${col2Round==='15T2'?'selected':''} style="color:#000;">2015 Tour 2</option>
              <option value="21T1" ${col2Round==='21T1'?'selected':''} style="color:#000;">2021 Tour 1</option>
              <option value="21T2" ${col2Round==='21T2'?'selected':''} style="color:#000;">2021 Tour 2</option>
              <option value="L24T1" ${col2Round==='L24T1'?'selected':''} style="color:#000;">Législatives 2024 T1</option>
              <option value="L24T2" ${col2Round==='L24T2'?'selected':''} style="color:#000;">Législatives 2024 T2</option>
            </select>
            <button onclick="if(window.setAllAnalyseEvolCol) window.setAllAnalyseEvolCol(2, this.previousElementSibling.value);" style="background:rgba(255,255,255,0.1); border:none; padding:0 6px; border-radius:4px; font-size:9px; text-transform:uppercase; font-weight:bold; color:var(--txt); cursor:pointer; display:flex; align-items:center; justify-content:center;" title="Appliquer à toutes les colonnes">Tous</button>
          </div>
        </div>
      </div>
      `;
    if (eBase1 && eBase2) {
      const blocs = ['RN', 'Gauche', 'Droite', 'Centre', 'Divers'];
      const getBlocPct = (d, b) => {
        if (!d || !d.cands || d.cands.length === 0) return 0;
        let sum = 0;
        d.cands.forEach(cand => {
          let cBloc = cand.bl;
          // Fallback missing/unknown blocs to "Divers"
          if (!cBloc && b === 'Divers') {
              sum += cand.p;
          } else if (cBloc === b) {
              sum += cand.p;
          }
        });
        return sum;
      };

      const getExtStats = (d) => {
          if (!d) return {abs:0, bn:0};
          const ins = d.ins || d.i || 0;
          const vot = (d.vot !== undefined) ? d.vot : (typeof d.v==='number' ? d.v : 0);
          const exp = d.exp || 0;
          const abs = d.pctAbs || (ins > 0 ? (ins-vot)/ins*100 : 0);
          const bn = vot > 0 ? (vot-exp)/vot*100 : 0;
          return { abs, bn };
      };

      const stats1 = getExtStats(eBase1);
      const stats2 = getExtStats(eBase2);

      h += `<table class="evolution-table">
        <thead>
          <tr><th>Indicateur</th><th>${tLabel1}</th><th>${tLabel2}</th><th>Évol.</th></tr>
        </thead>
        <tbody>
      `;
      blocs.forEach(b => {
        const p1 = getBlocPct(eBase1, b);
        const p2 = getBlocPct(eBase2, b);
        const diff = p2 - p1;
        const color = diff > 0 ? (b === 'RN' ? '#ff7675' : '#55efc4') : (diff < 0 ? (b === 'RN' ? '#55efc4' : '#ff7675') : 'inherit');
        h += `
          <tr>
            <td style="font-weight:700;">${b}</td>
            <td>${p1.toFixed(1)}%</td>
            <td>${p2.toFixed(1)}%</td>
            <td style="font-weight:900; color:${color};">${diff > 0 ? '▲' : (diff < 0 ? '▼' : '=')} ${diff > 0 ? '+' : ''}${diff.toFixed(1)}</td>
          </tr>
        `;
      });
      
      const diffAbs = stats2.abs - stats1.abs;
      const colorAbs = diffAbs > 0 ? '#ff7675' : (diffAbs < 0 ? '#55efc4' : 'inherit');
      h += `
          <tr style="border-top:1px solid rgba(255,255,255,0.2);">
            <td style="font-weight:700; opacity:0.8; font-size:11px;">Abstention (% ins)</td>
            <td style="opacity:0.8; font-size:11px;">${stats1.abs.toFixed(1)}%</td>
            <td style="opacity:0.8; font-size:11px;">${stats2.abs.toFixed(1)}%</td>
            <td style="font-weight:900; color:${colorAbs}; font-size:11px;">${diffAbs > 0 ? '▲' : (diffAbs < 0 ? '▼' : '=')} ${diffAbs > 0 ? '+' : ''}${diffAbs.toFixed(1)}</td>
          </tr>
      `;

      const diffBn = stats2.bn - stats1.bn;
      const colorBn = diffBn > 0 ? '#ff7675' : (diffBn < 0 ? '#55efc4' : 'inherit');
      h += `
          <tr>
            <td style="font-weight:700; opacity:0.8; font-size:11px;">Blancs/Nuls (% vot)</td>
            <td style="opacity:0.8; font-size:11px;">${stats1.bn.toFixed(1)}%</td>
            <td style="opacity:0.8; font-size:11px;">${stats2.bn.toFixed(1)}%</td>
            <td style="font-weight:900; color:${colorBn}; font-size:11px;">${diffBn > 0 ? '▲' : (diffBn < 0 ? '▼' : '=')} ${diffBn > 0 ? '+' : ''}${diffBn.toFixed(1)}</td>
          </tr>
      `;

      h += `</tbody></table>`;
      
    } else {
      h += `<div class="placeholder-msg">Données insuffisantes pour calculer l'évolution</div>`;
    }
    } // end isEvolStateOpen
    h += `</div>`;

    // BLOC 6: Indicateurs
    const isIndsStateOpen = window.analyseDetailsState.inds;
    h += `<div>
      <div class="analyse-section-title" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center; gap:10px; user-select:none; margin-top:20px;" onclick="if(window.toggleAnalyseDetails) window.toggleAnalyseDetails('inds');">
        <span style="line-height:1.2;">🎯 Indicateurs clés</span>
        <span style="flex-shrink:0;">${isIndsStateOpen ? '▼' : '▶'}</span>
      </div>`;
    if (isIndsStateOpen) {
    if (e15T1 && e21T1) {
      const getBlocPct = (d, b) => {
        if (!d || !d.cands || d.cands.length === 0) return 0;
        let sum = 0; d.cands.forEach(cand => { 
            let cBloc = cand.bl;
            if (!cBloc && b === 'Divers') { sum += cand.p; }
            else if (cBloc === b) { sum += cand.p; }
        }); 
        return sum;
      };
      const blocs = ['RN', 'Gauche', 'Droite', 'Centre', 'Divers'];
      let sumDiff = 0;
      blocs.forEach(b => { sumDiff += Math.abs(getBlocPct(e21T1, b) - getBlocPct(e15T1, b)); });
      const volatility = Math.min(100, Math.round(sumDiff / 2 * 2)); 
      const volColor = volatility < 10 ? '#2ecc71' : (volatility < 25 ? '#f1c40f' : '#e74c3c');
      
      const rates = [e15T1, e15T2, e21T1, e21T2].filter(x=>x).map(x=>x.pctAbs || 0);
      const absAvg = rates.length ? rates.reduce((a,b)=>a+b,0) / rates.length : 0;
      const absColor = absAvg < 40 ? '#2ecc71' : (absAvg < 60 ? '#f1c40f' : '#e74c3c');

      const getWinningBloc = (x) => {
          let n = x.bl || (typeof NUANCE_BLOC !== 'undefined' ? NUANCE_BLOC[x.n||x.n1] : null) || 'Divers';
          return n;
      };
      const winners = [e15T1, e15T2, e21T1, e21T2].filter(x=>x).map(x=>getWinningBloc(x));
      const uniqueW = new Set(winners);
      const bastionType = uniqueW.size === 1 && winners.length >= 3 ? `🏰 Bastion ${Array.from(uniqueW)[0]}` : "⚔️ Territoire disputé";

      h += `
        <div style="display:flex; flex-direction:column; gap:15px;">
           <div>
              <div style="display:flex; justify-content:space-between; font-size:11px;">
                <span>Volatilité électorale</span>
                <strong>${volatility}/100</strong>
              </div>
              <div class="indicator-jauge"><div class="indicator-cursor" style="left:${volatility}%; background:${volColor};"></div></div>
           </div>
           <div>
              <div style="display:flex; justify-content:space-between; font-size:11px;">
                <span>Abstention chronique</span>
                <strong>${Math.round(absAvg)}%</strong>
              </div>
              <div class="indicator-jauge"><div class="indicator-cursor" style="left:${absAvg}%; background:${absColor};"></div></div>
           </div>
           <div style="padding:12px; background:rgba(212,168,67,0.1); border:1px solid var(--gold); border-radius:8px; font-weight:900; text-align:center; font-size:13px; color:var(--gold);">
              ${bastionType}
           </div>
           
           <details style="margin-top:5px; font-size:11px; background:rgba(0,0,0,0.1); border-radius:6px; padding:8px;">
              <summary style="cursor:pointer; color:var(--txt); opacity:0.8; font-weight:600; outline:none; display:flex; align-items:center; gap:5px;">
                  <span style="font-size:14px;">ℹ️</span> Comprendre ces indicateurs
              </summary>
              <ul style="margin:8px 0 0; padding-left:20px; line-height:1.4; opacity:0.8;">
                 <li style="margin-bottom:6px;"><strong>Volatilité électorale :</strong> Indice sur 100 basé sur les transferts de voix entre les grands blocs politiques (RN, Gauche, Droite, Centre, Divers) entre le T1 2015 et le T1 2021. Un chiffre élevé montre des électeurs mobiles.</li>
                 <li style="margin-bottom:6px;"><strong>Abstention chronique :</strong> Taux d'abstention moyen calculé sur les 4 tours des départementales 2015 et 2021.</li>
                 <li><strong>Bastion vs Disputé :</strong> Considéré comme bastion si le même bloc politique a terminé en tête sur au moins 3 des 4 tours étudiés.</li>
              </ul>
           </details>
        </div>
      `;
    } else {
      h += `<div class="placeholder-msg">Données insuffisantes</div>`;
    }
    } // end isIndsStateOpen
    h += `</div>`;

    h += `</div>`;
    return h;
  }

  function renderElecBox(d, label) {
    if (!d || !d.cands || d.cands.length === 0) return `<div class="elec-box" style="opacity:0.3; justify-content:center; align-items:center; font-style:italic; font-size:10px;">Scrutin non tenu</div>`;
    
    const formatB = (val) => {
        if (!val) return '';
        if (typeof val === 'string') return val;
        if (Array.isArray(val)) return val.join(' - ');
        if (typeof val === 'object') {
            if (val.nom) return val.nom;
            return Object.values(val).filter(v => typeof v === 'string').join(' - ');
        }
        return String(val);
    };

    // Sometimes the winner nuance is in n1 instead of n, depending on the format.
    const nuanceGagnante = d.n || d.n1 || d.cands[0]?.nu;
    const binomeGagnant = formatB(d.b || d.b1 || d.cands[0]?.bi);
    const pctGagnant = d.p !== undefined ? d.p : d.pct1 !== undefined ? d.pct1 : (d.cands[0]?.p || 0);

    const bgColor = (typeof NUANCE_COLORS !== 'undefined' && NUANCE_COLORS[nuanceGagnante]) || '#aaa';
    const labelNuance = (typeof NUANCE_LABELS !== 'undefined' && NUANCE_LABELS[nuanceGagnante]) || nuanceGagnante;

    let h = `
      <div class="elec-box">
        <div style="font-size:9px; opacity:0.6; text-transform:uppercase; font-weight:900; letter-spacing:0.05em;">${label}</div>
        <div class="winner-banner" style="background:${bgColor}; color:${isColorLight(bgColor) ? '#000' : '#fff'};">
          ${labelNuance}
        </div>
        <div class="winner-pct">${pctGagnant.toFixed(1)}%</div>
        <div style="font-size:9px; text-align:center; opacity:0.8; font-weight:700; margin-top:-5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${binomeGagnant || ''}">${binomeGagnant || ''}</div>
        
        <div style="margin-top:5px; display:flex; flex-direction:column; gap:4px;">
          <div style="height:4px; display:flex; background:#555; border-radius:2px; overflow:hidden;">
            <div style="width:${d.pctPart || 0}%; background:#2ecc71;"></div>
          </div>
          <div style="display:flex; justify-content:space-between; font-size:8px; opacity:0.7;">
            <span>Partic.</span>
            <span>${(d.pctPart || 0).toFixed(1)}%</span>
          </div>
        </div>

        <div style="margin-top:10px; display:flex; flex-direction:column; gap:4px;">
    `;
    
    if (d.cands && d.cands.length > 0) {
      const topOthers = [...d.cands].sort((a,b)=>b.p - a.p).slice(0, 4);
      topOthers.forEach(cand => {
        const cCol = (typeof NUANCE_COLORS !== 'undefined' && NUANCE_COLORS[cand.nu]) || '#777';
        h += `
          <div style="font-size:9px;">
            <div style="display:flex; justify-content:space-between; margin-bottom:1px;">
              <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:70%;">${formatB(cand.bi) || cand.nu}</span>
              <strong>${cand.p.toFixed(1)}%</strong>
            </div>
            <div style="height:2px; background:rgba(255,255,255,0.1);"><div style="height:100%; width:${cand.p}%; background:${cCol};"></div></div>
          </div>
        `;
      });
    }

    h += `</div></div>`;
    return h;
  }

  function isColorLight(hex) {
    if (!hex || hex[0] !== '#') return false;
    const r = parseInt(hex.substr(1, 2), 16);
    const g = parseInt(hex.substr(3, 2), 16);
    const b = parseInt(hex.substr(5, 2), 16);
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness > 155;
  }

  function copyAnalyseSummary(code) {
    const c = allCommunes.find(x=>x.code===code);
    if (!c) return;
    const insee = enrichedData[code] || {};
    const e21 = window.elecDataT1 ? window.elecDataT1[code] || (typeof elecDataT1 !== 'undefined' ? elecDataT1[code] : {}) : {};
    const e15 = window.elec15DataT1 ? window.elec15DataT1[code] || (typeof elec15DataT1 !== 'undefined' ? elec15DataT1[code] : {}) : {};
    
    const csp = insee.emploi;
    let profil = "inconnu";
    if (csp) {
        const ratio = (csp['Cadres'] || 0) / (csp['Ouvriers'] || 1);
        profil = ratio > 1.2 ? "plutôt cadre" : (ratio < 0.8 ? "plutôt ouvrier" : "mixte");
    }

    const nRaw = e21.bl || (typeof NUANCE_BLOC !== 'undefined' ? NUANCE_BLOC[e21.n || e21.n1] : null) || 'Divers';
    const n = (typeof NUANCE_LABELS !== 'undefined' && NUANCE_LABELS[e21.n || e21.n1]) || (e21.n || e21.n1) || nRaw;
    const p = e21.p !== undefined ? e21.p : e21.pct1 !== undefined ? e21.pct1 : (e21.cands?.[0]?.p || 0);
    const absDiff = (e21.pctAbs || 0) - (e15.pctAbs || 0);

    const txt = `Commune de ${c.nom}, ${(c.population||0).toLocaleString('fr-FR')} habitants, profil ${profil}. Aux départementales 2021 T1, le bloc ${nRaw} (${n}) arrive en tête avec ${p.toFixed(1)}%. L'abstention atteint ${(e21.pctAbs || 0).toFixed(1)}%, en ${absDiff >= 0 ? 'hausse' : 'baisse'} de ${Math.abs(absDiff).toFixed(1)} pts par rapport à 2015.`;
    
    navigator.clipboard.writeText(txt).then(() => {
      alert("Résumé copié dans le presse-papier !");
    }).catch(err => {
      console.error('Erreur lors de la copie :', err);
    });
  }

  // Close search results when clicking outside
  document.addEventListener('mousedown', function(e) {
    document.querySelectorAll('.analyse-results').forEach(r => {
      if (!r.contains(e.target)) r.style.display = 'none';
    });
  });

  window.disputedFilterCanton = '';
  window.disputedFilterDanger = '';

  window.showDisputedModal = function() {
      let modal = document.getElementById('disputedModal');
      if (!modal) {
          modal = document.createElement('div');
          modal.id = 'disputedModal';
          modal.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.8); z-index:9999; display:flex; justify-content:center; align-items:center; backdrop-filter:blur(5px);';
          document.body.appendChild(modal);
      }
      
      const getWinningBloc = (x) => {
          let n = x.bl || (typeof NUANCE_BLOC !== 'undefined' ? NUANCE_BLOC[x.n||x.n1] : null) || 'Divers';
          return n;
      };

      const getBlocPct = (d, b) => {
        if (!d || !d.cands || d.cands.length === 0) return 0;
        let sum = 0; d.cands.forEach(cand => { 
            let cBloc = cand.bl;
            if (!cBloc && b === 'Divers') { sum += cand.p; }
            else if (cBloc === b) { sum += cand.p; }
        }); 
        return sum;
      };

      let disputedList = [];
      const blocs = ['RN', 'Gauche', 'Droite', 'Centre', 'Divers'];
      
      let allCantonsObj = {};
      allCommunes.forEach(c => {
          if (!c.codeCanton) return;
          if (!allCantonsObj[c.codeCanton]) allCantonsObj[c.codeCanton] = c.nomCanton;
          
          let e15T1 = window.elec15DataT1 ? window.elec15DataT1[c.code] || (typeof elec15DataT1 !== 'undefined' ? elec15DataT1[c.code] : null) : null;
          let e15T2 = window.elec15DataT2 ? window.elec15DataT2[c.code] || (typeof elec15DataT2 !== 'undefined' ? elec15DataT2[c.code] : null) : null;
          let e21T1 = window.elecDataT1 ? window.elecDataT1[c.code] || (typeof elecDataT1 !== 'undefined' ? elecDataT1[c.code] : null) : null;
          let e21T2 = window.elecDataT2 ? window.elecDataT2[c.code] || (typeof elecDataT2 !== 'undefined' ? elecDataT2[c.code] : null) : null;
          
          if (!e15T1 || !e21T1) return;
          
          const winners = [e15T1, e15T2, e21T1, e21T2].filter(x=>x).map(x=>getWinningBloc(x));
          const uniqueW = new Set(winners);
          const isBastion = uniqueW.size === 1 && winners.length >= 3;
          
          if (!isBastion) {
              let sumDiff = 0;
              blocs.forEach(b => { sumDiff += Math.abs(getBlocPct(e21T1, b) - getBlocPct(e15T1, b)); });
              const volatility = Math.min(100, Math.round(sumDiff / 2 * 2)); 
              let danger = volatility < 25 ? 'Faible' : (volatility < 50 ? 'Moyenne' : 'Haute');
              let dangerColor = volatility < 25 ? '#2ecc71' : (volatility < 50 ? '#f1c40f' : '#e74c3c');
              
              disputedList.push({
                  code: c.code, nom: c.nom, canton: c.nomCanton, codeCanton: c.codeCanton, pop: c.population,
                  volatility, danger, dangerColor, 
                  winners: Array.from(uniqueW).join(', ')
              });
          }
      });
      
      disputedList.sort((a,b) => b.volatility - a.volatility);
      
      let filtered = disputedList;
      if (window.disputedFilterCanton) {
          filtered = filtered.filter(x => x.codeCanton === window.disputedFilterCanton);
      }
      if (window.disputedFilterDanger) {
          filtered = filtered.filter(x => x.danger === window.disputedFilterDanger);
      }
      
      let cantonsOpts = `<option value="">Tous les cantons</option>`;
      Object.keys(allCantonsObj).sort((a,b)=>allCantonsObj[a].localeCompare(allCantonsObj[b])).forEach(k => {
          cantonsOpts += `<option value="${k}" ${window.disputedFilterCanton===k?'selected':''}>${allCantonsObj[k]}</option>`;
      });
      
      let html = `
      <div style="background:var(--bg); color:var(--txt); width:90vw; max-width:800px; height:80vh; border-radius:12px; display:flex; flex-direction:column; overflow:hidden; border:1px solid var(--border); box-shadow:0 10px 30px rgba(0,0,0,0.5);">
         <div style="padding:15px 20px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; background:rgba(212,168,67,0.1);">
            <h2 style="margin:0; font-size:16px; color:var(--gold);">⚔️ Territoires disputés (${filtered.length})</h2>
            <button onclick="window.closeDisputedModal()" style="background:transparent; border:none; color:var(--txt); font-size:20px; cursor:pointer;" title="Fermer">✕</button>
         </div>
         <div style="padding:15px; display:flex; gap:10px; border-bottom:1px solid var(--border); background:rgba(0,0,0,0.2);">
            <select style="flex:1; background:var(--bg); color:var(--txt); border:1px solid var(--border); border-radius:6px; padding:8px; font-family:inherit;" onchange="window.disputedFilterCanton=this.value; window.showDisputedModal();">
               ${cantonsOpts}
            </select>
            <select style="flex:1; background:var(--bg); color:var(--txt); border:1px solid var(--border); border-radius:6px; padding:8px; font-family:inherit;" onchange="window.disputedFilterDanger=this.value; window.showDisputedModal();">
               <option value="">Tous les niveaux de dangerosité</option>
               <option value="Haute" ${window.disputedFilterDanger==='Haute'?'selected':''}>Haute volatilité (≥50)</option>
               <option value="Moyenne" ${window.disputedFilterDanger==='Moyenne'?'selected':''}>Moyenne (25-49)</option>
               <option value="Faible" ${window.disputedFilterDanger==='Faible'?'selected':''}>Faible (<25)</option>
            </select>
         </div>
         <div style="flex:1; overflow-y:auto; padding:15px;">
            ${filtered.length === 0 ? `<div style="text-align:center; padding:50px; opacity:0.5;">Aucun territoire ne correspond à ces critères.</div>` : ''}
            <div style="display:grid; gap:10px;">
               ${filtered.map(x => `
                  <div style="background:rgba(255,255,255,0.05); padding:10px; border-radius:8px; display:flex; justify-content:space-between; align-items:center; cursor:pointer; border:1px solid transparent; transition:0.2s;" onmouseover="this.style.borderColor='var(--gold)'" onmouseout="this.style.borderColor='transparent'" onclick="analyseItems=[{type:'commune', code:'${x.code}'}]; window.closeDisputedModal(); renderAnalyseHome();">
                     <div>
                        <div style="font-weight:bold; font-size:15px; margin-bottom:4px;">${x.nom}</div>
                        <div style="font-size:11px; opacity:0.7;">Canton: ${x.canton} | Pop: ${(x.pop||0).toLocaleString('fr-FR')}</div>
                        <div style="font-size:11px; color:var(--gold); margin-top:4px;">Alternance blocs: ${x.winners}</div>
                     </div>
                     <div style="text-align:right; font-size:11px;">
                        <span style="opacity:0.7;">Volatilité</span><br>
                        <strong style="color:${x.dangerColor}; font-size:16px;">${x.volatility}/100</strong>
                     </div>
                  </div>
               `).join('')}
            </div>
         </div>
      </div>
      `;
      modal.innerHTML = html;
  };
  
  window.closeDisputedModal = function() {
      let modal = document.getElementById('disputedModal');
      if (modal) modal.remove();
  };

  function renderGlobalCorrelations() { /* Deprecated */ }




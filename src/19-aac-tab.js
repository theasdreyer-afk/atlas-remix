
// ------------------------------------
// ONGLET AIDE AUX COMMUNES
// ------------------------------------

var aacHiddenCategories = new Set();
var aacCurrentCanton = "Tous les cantons";
var aacSearchText = "";
var aacDateStart = new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
var aacDateEnd = new Date().toISOString().split('T')[0];
var aacSortCol = "Commune";
var aacSortDesc = false;

// Map variables
var aacMap = null;
var aacGeoJsonLayer = null;
window.aacSelectedCommune = null; // { norm: "...", display: "..." }
var aacPanelCategory = "Toutes";
var aacPanelYear = "Toutes";
var aacTableFilters = {
  Commune: new Set(),
  Objet: new Set(), // Mapped to categories, not raw text
  Date: new Set(),
  Statut: new Set()
};

window.aacCFB = {
  col: null,
  open: function(col, th) {
    const box = document.getElementById('aacColFilterBox');
    if (this.col === col && box && box.style.display === 'flex') {
      this.close();
      return;
    }
    if (this._clickRef) document.removeEventListener('click', this._clickRef);
    if (this._scrollRef) window.removeEventListener('scroll', this._scrollRef, true);
    
    this.col = col;
    if(!box) return;
    box.style.display = 'flex';
    box.style.position = 'fixed';
    
    const updatePos = () => {
      const rect = th.getBoundingClientRect();
      box.style.top = rect.bottom + 'px';
      box.style.left = rect.left + 'px';
    };
    updatePos();
    
    document.getElementById('aacCfbSearch').value = '';
    this.renderList();
    
    this._clickRef = (e) => {
      if(!e.target.closest('#aacColFilterBox') && !e.target.closest('th')) aacCFB.close();
    };
    this._scrollRef = (e) => {
      if (e.target && e.target.closest && e.target.closest('#aacColFilterBox')) return;
      updatePos();
    };
    
    setTimeout(() => {
      document.addEventListener('click', this._clickRef);
      window.addEventListener('scroll', this._scrollRef, true);
    }, 10);
  },
  close: function() {
    const box = document.getElementById('aacColFilterBox');
    if(box) box.style.display = 'none';
    if (this._clickRef) document.removeEventListener('click', this._clickRef);
    if (this._scrollRef) window.removeEventListener('scroll', this._scrollRef, true);
  },
  sortAsc: function() {
    aacSortCol = this.col; aacSortDesc = false;
    this.close(); renderAacTable();
  },
  sortDesc: function() {
    aacSortCol = this.col; aacSortDesc = true;
    this.close(); renderAacTable();
  },
  toggleAll: function(btn) {
    const isChecks = btn.innerText === 'Tout cocher';
    document.querySelectorAll('#aacCfbList input[type="checkbox"]').forEach(c => c.checked = isChecks);
    btn.innerText = isChecks ? 'Tout décocher' : 'Tout cocher';
  },
  renderList: function() {
    const list = document.getElementById('aacCfbList');
    if (!['Commune', 'Objet', 'Date', 'Statut'].includes(this.col)) {
      list.innerHTML = `<div style="padding:6px;color:var(--txt-muted)">Filtrer via recherche textuelle uniquement.</div>`;
      return;
    }
    const search = document.getElementById('aacCfbSearch').value.toLowerCase();
    
    const dStart = parseDateAac(aacDateStart);
    const dEnd = parseDateAac(aacDateEnd);
    let base = window.AAC_DATA.filter(d => {
       if (aacCurrentCanton !== "Tous les cantons" && d.canton !== aacCurrentCanton) return false;
       if (dStart || dEnd) {
          let docD = parseDateAac(d.date_vote) || new Date(d.annee, 0, 1);
          if (dStart && docD < dStart) return false;
          if (dEnd && docD > dEnd) return false;
       }
       if (this.col !== 'Objet' && window.aacHiddenCategories && window.aacHiddenCategories.has(d.categorie)) return false;
       return true;
    });

    const map = new Map();
    base.forEach(d => {
      let val = null;
      if (this.col === 'Commune') val = (d.beneficiaire||'').trim();
      else if (this.col === 'Objet') val = d.categorie;
      else if (this.col === 'Date') val = (d.date_vote || String(d.annee)).trim();
      else if (this.col === 'Statut') val = (d.statut||'').trim();
      
      if(val) {
        let vStr = String(val);
        if(!search || vStr.toLowerCase().includes(search)) {
          if(!map.has(vStr)) map.set(vStr, 1);
          else map.set(vStr, map.get(vStr)+1);
        }
      }
    });

    let html = '';
    const sorted = [...map.entries()].sort((a,b)=>a[0].localeCompare(b[0], 'fr'));
    const selSet = aacTableFilters[this.col] || new Set();
    const isObjet = (this.col === 'Objet');

    sorted.forEach(([v, count]) => {
      let isChecked = true;
      if (isObjet) {
          isChecked = !(window.aacHiddenCategories && window.aacHiddenCategories.has(v));
      } else {
          isChecked = selSet.size === 0 || selSet.has(v);
      }
      html += `
        <label class="cfb-item">
          <input type="checkbox" value="${v.replace(/"/g,'&quot;')}" ${isChecked ? 'checked' : ''}>
          <span>${v} <span style="color:var(--txt-muted);font-size:0.85em">(${count})</span></span>
        </label>
      `;
    });
    
    list.innerHTML = `<button onclick="aacCFB.toggleAll(this)" style="margin:5px 10px;font-size:0.85em;color:var(--gold);background:none;border:none;cursor:pointer;width:fit-content;padding:0;">Tout décocher</button>` + html;
  },
  apply: function() {
    this.close();
    
    if (this.col === 'Objet') {
      const checks = document.querySelectorAll('#aacCfbList input[type="checkbox"]');
      if(!window.aacHiddenCategories) window.aacHiddenCategories = new Set();
      checks.forEach(cb => {
         if(cb.checked) window.aacHiddenCategories.delete(cb.value);
         else window.aacHiddenCategories.add(cb.value);
      });
      renderAacTab(); if (document.getElementById('oiseSummaryContent') && document.getElementById('oiseSummaryContent').style.display === 'block') { document.getElementById('oiseSummaryContent').style.display = 'none'; toggleOiseSummary(); } if (document.getElementById('cantonSummary') && document.getElementById('cantonSummary').classList.contains('visible') && window.currentCantonCode) { showCantonSummary(window.currentCantonCode); } } else {
      const checks = document.querySelectorAll('#aacCfbList input[type="checkbox"]');
      const selSet = new Set();
      let allChecked = true;
      checks.forEach(cb => {
         if(cb.checked) selSet.add(cb.value);
         else allChecked = false;
      });
      if(allChecked) aacTableFilters[this.col] = new Set();
      else aacTableFilters[this.col] = selSet;
      renderAacTable();
    }
  }
};


function getTypeEntiteAac(libelle) {
  if(!libelle) return "COMMUNE";
  const s = String(libelle).toUpperCase().trim();
  if (/^(COMMUNAUTE DE COMMUNES|COMMUNAUTE D.AGGLOMERATION|METROPOLE|COMMUNAUTE URBAINE|CA |CC )/.test(s)) return "CC";
  if (/SYNDICAT|S\.I\.E\.|S\.I\.V\.O\.S|S\.I\.A\.E\.P|SIVOM|SIVU|SIVOS|SMIAEP|SIRS |SIE DE|S\.I\. |SYNDICAT MIXTE|PETR |PAYS |ASSOCIATION DE COMMUNES/.test(s)) return "SYNDICAT";
  return "COMMUNE";
}

function normaliserCommuneAac(nom) {
  if (!nom) return "";
  return String(nom)
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[-'`’]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getCommunesMentionneesCC(objet, toutesLesCommunes) {
  if(!objet) return [];
  const objUp = normaliserCommuneAac(objet);
  return toutesLesCommunes.filter(c => objUp.includes(c.norm));
}

function getCommunesMembresSyndicat(nomSyndicat, objet, toutesLesCommunes) {
  const nomNorm = normaliserCommuneAac(nomSyndicat)
    .replace(/SYNDICAT|INTERCOMMUNAL|INTERCOMMUN|S\.I\.E\.|S\.I\.V\.O\.S\.|S\.I\.A\.E\.P\.|SIVOM|SIVU|SIVOS|SMIAEP|SIRS|SIE|DES COMMUNES DE|DES EAUX|DE L EAU|D ASSAINISSEMENT|DE VOIRIE|SCOLAIRE|1ER DEGRE|DU REGROUPEMENT|PEDAGOGIQUE|DES ENERGIES|D ENERGIE|ENERGIES|ZONES|EST|OUEST|NORD|SUD|OISE|DEPARTEMENT|DU|DE|D |LES|ET|LA|LE|L |AUX|DES|EN |VOCATION|EAUX|EAU|AU |/g, ' ')
    .replace(/[\/,;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let members = toutesLesCommunes.filter(commune => {
    return commune.norm.length > 3 && nomNorm.includes(commune.norm);
  });
  
  if(members.length === 0 && objet) {
      const objUp = normaliserCommuneAac(objet);
      members = toutesLesCommunes.filter(c => objUp.includes(c.norm));
  }
  return members;
}


function cleanAmountAac(val) {
    if (!val) return 0;
    val = String(val).replace(/[€\ufffd]/gi, '').replace(/\s+/g, '').replace(/\u202F/g, '').replace(/\u00A0/g, '').trim();
    if (val === '-') return 0;
    let n = parseInt(val, 10);
    return isNaN(n) ? 0 : n;
}

function getCategoryAac(obj) {
    obj = (obj || '').toUpperCase();
    if (['VOIRIE', 'TROTTOIR', 'CHAUSSEE', 'RUE', 'CHEMIN', 'PARKING'].some(k => obj.includes(k))) return 'Voirie';
    if (['EAU POTABLE', 'ASSAINISSEMENT', 'RESEAU', 'FORAGE', 'EPURATION', 'PLUVIAL'].some(k => obj.includes(k))) return 'Eau / Assainissement';
    if (['EGLISE', 'RESTAURATION', 'VITRAUX', 'LAVOIR', 'MONUMENT', 'CLOCHER'].some(k => obj.includes(k))) return 'Patrimoine';
    if (['ECOLE', 'MAIRIE', 'SALLE', 'GROUPE SCOLAIRE', 'PERISCOLAIRE', 'BIBLIOTHEQUE', 'CANTINE'].some(k => obj.includes(k))) return 'Équipements publics';
    if (['VIDEOPROTECTION', 'CAMERA', 'INCENDIE', 'DEFENSE'].some(k => obj.includes(k))) return 'Sécurité';
    if (['MOBILITE REDUITE', 'PMR', 'ACCESSIBILITE'].some(k => obj.includes(k))) return 'Accessibilité PMR';
    if (['ELECTRIQUE', 'ISOLATION', 'THERMIQUE', 'SOLAIRE', 'PHOTOVOLTAIQUE'].some(k => obj.includes(k))) return 'Transition écologique';
    return 'Divers';
}

function aacHandleFileUpload(e) {
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = function(evt) {
    const buffer = evt.target.result;
    let text = "";
    try {
        text = new TextDecoder('utf-8', {fatal: true}).decode(buffer);
    } catch(err) {
        text = new TextDecoder('windows-1252').decode(buffer);
    }
    
    try {
      const parsed = d3.dsvFormat(";").parse(text);
      let data = [];
      parsed.forEach(row => {
          const normKey = (k) => k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\ufffd/g, "");
          const keys = Object.keys(row);
          
          let dateKey = keys.find(k => {
              let n = normKey(k);
              return n.includes('date') && n.includes('cision');
          }) || keys.find(k => {
              let n = normKey(k);
              return n.includes('date') && !n.includes('transmission');
          }) || keys.find(k => normKey(k).includes('date')) || '';

          let date_vote = dateKey ? (row[dateKey] || '').trim() : '';

          let anneeKey = keys.find(k => normKey(k).includes('annee') || normKey(k).includes('anne')) || '';
          let annee = parseInt(row[anneeKey] || row['Année'] || '0');
          if(isNaN(annee)) {
             if (date_vote) {
                 const m = date_vote.match(/\b(19|20)\d{2}\b/);
                 annee = m ? parseInt(m[0]) : 0;
             } else {
                 annee = 0;
             }
          }
          
          let benefKey = keys.find(k => { let n = normKey(k); return n === 'libelle - beneficiaire' || n === 'libelle beneficiaire' || n === 'beneficiaire'; }) || keys.find(k => normKey(k).includes('benef') && !normKey(k).includes('canton')) || keys.find(k => normKey(k).includes('benef')) || '';
          let benef = (row[benefKey] || row['Bénéficiaire'] || '').trim();
          // Remove "COMMUNE DE " or "COMMUNE D'" robustly
          benef = benef.replace(/^COMMUNE(S)?\s+(DE\s+|D'|D\s+)/i, '').trim();

          let cantKey = keys.find(k => { let n = normKey(k); return n.includes('canton') && n.includes('localisation'); }) || keys.find(k => { let n = normKey(k); return n === 'libelle - canton du beneficiaire' || n === 'canton du beneficiaire'; }) || keys.find(k => normKey(k).includes('canton') && !normKey(k).includes('benef')) || keys.find(k => normKey(k).includes('canton')) || '';
          let cant = (row[cantKey] || row['Canton - localisation'] || row['Canton'] || '').trim();

          // Careful: "demande" might match "date de la demande" or "reference administrative". We want "objet" or "libelle - demande".
          let objKey = keys.find(k => {
              let n = normKey(k);
              if (n.includes('date') || n.includes('benef') || n.includes('administrative') || n.includes('ref')) return false;
              return n.includes('objet') || n.includes('demande') || n.includes('intitule') || n.includes('projet') || n.includes('operation') || n.includes('libelle');
          }) || '';
          let obj = (row[objKey] || row['Objet'] || '').trim();
          
          let categorieKey = keys.find(k => normKey(k).includes('categorie') || normKey(k).includes('domaine') || normKey(k).includes('theme')) || '';
          let csvCat = categorieKey ? (row[categorieKey] || '').trim() : '';
          let catFinal = csvCat || getCategoryAac(obj) || 'Divers';
          // Ensure it's not empty string if mapping failed
          if (!catFinal || catFinal.trim() === '') catFinal = 'Divers';

          let montantVoteKey = keys.find(k => {
              let n = normKey(k);
              return n.includes('apres') || n.includes('vot') || (n.includes('montant') && !n.includes('mandat') && !n.includes('pay') && !n.includes('total'));
          }) || '';
          let montantPayeKey = keys.find(k => normKey(k).includes('mandat') || normKey(k).includes('pay')) || '';
          let tauxKey = keys.find(k => normKey(k).includes('% pai') || normKey(k).includes('taux')) || '';
          
          let statutKey = keys.find(k => normKey(k).includes('statut')) || '';
          let statut = statutKey ? (row[statutKey] || '').trim() : '';
          // Fix known encoding artifacts if they still snuck through
          if (statut.match(/cl.*tur/i)) statut = 'Clôturée';
          else if (statut.match(/vot.e/i)) statut = 'Votée';
          else if (statut.match(/sold.e/i)) statut = 'Soldée';
          
          if (!statut) statut = 'Inconnu';

          data.push({
              beneficiaire: benef,
              canton: cant,
              objet: obj,
              annee: annee,
              date_vote: date_vote,
              montant_vote: cleanAmountAac(row[montantVoteKey] || 0),
              montant_paye: cleanAmountAac(row[montantPayeKey] || 0),
              taux_paiement: (() => {
    let t = row[tauxKey];
    if (typeof t === 'number') {
      return (t <= 1.5 ? (t * 100).toFixed(1) : t.toFixed(1)) + '%';
    }
    t = String(t || '').trim();
    if (t.match(/^[0-9]+(\.[0-9]+)?$/)) {
      let tn = parseFloat(t);
      return (tn <= 1.5 ? (tn * 100).toFixed(1) : tn.toFixed(1)) + '%';
    }
    return t;
  })(),
              statut: statut,
              categorie: catFinal
          });
      });
      window.AAC_DATA = data;
      window.AAC_DATA_LOADED = true;
      alert(`Données importées avec succès ! (${data.length} dossiers)`);
      renderAacTab();
    } catch(err) {
      alert("Erreur lors de la lecture du fichier CSV. Assurez-vous qu'il s'agit du bon fichier avec des points-virgules.");
      console.error(err);
    }
  };
  reader.readAsArrayBuffer(file);
}

function parseDateAac(dStr) {
  if (!dStr) return null;
  // expects DD/MM/YYYY
  const m = dStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return new Date(m[3], m[2]-1, m[1]);
  // fallback to YYYY
  const m2 = dStr.match(/\b(19|20)\d{2}\b/);
  if (m2) return new Date(m2[0], 0, 1);
  return null;
}

function renderAacTab() {
  const container = document.getElementById('aacContent');
  if(!container) return;
  
  if(!window.AAC_DATA_LOADED || !window.AAC_DATA || window.AAC_DATA.length === 0) {
    container.innerHTML = `
      <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:80vh; text-align:center;">
        <h2 style="font-family:var(--font-head); color:var(--gold); margin-bottom:10px;">Importer les données "Aide aux Communes"</h2>
        <p style="color:var(--txt-muted); margin-bottom:20px; max-width:500px;">
           Veuillez importer le fichier CSV (séparateur point-virgule) pour visualiser les données de subvention.
        </p>
        <div style="border: 2px dashed var(--border); padding: 40px; border-radius: 8px; background: rgba(0,0,0,0.2); width:100%; max-width:600px;">
           <input type="file" id="aacFileInput" accept=".csv" style="display:none" onchange="aacHandleFileUpload(event)">
           <label for="aacFileInput" class="analyse-btn primary" style="cursor:pointer; display:inline-block;">Sélectionner un fichier CSV</label>
        </div>
      </div>
    `;
    return;
  }

  window.aacCurrentMode = window.aacCurrentMode || 'COMMUNE';
  window.setAacMode = function(mode) {
    if(window.aacCurrentMode === mode) return;
    window.aacCurrentMode = mode;
    window.aacSelectedCommune = null;
    renderAacTab();
  };

  if(!window.AAC_ENTITIES_MAPPED) {
    const tSet = new Set();
    window.AAC_DATA.forEach(row => {
      row.aacType = getTypeEntiteAac(row.beneficiaire);
      if (row.aacType === "COMMUNE") {
        let clean = String(row.beneficiaire).toUpperCase().replace(/^COMMUNE\s+(DE\s+|D'\s*|D\s+|DU\s+)?/, '').trim();
        if(clean) tSet.add(clean);
      }
    });
    const toutesLesCommunes = Array.from(tSet).map(c => {
      return {
        original: c,
        norm: normaliserCommuneAac(c)
      };
    });
    
    window.AAC_DATA.forEach(row => {
      row.aacMentionedNorms = [];
      if (row.aacType === "COMMUNE") {
        let clean = String(row.beneficiaire).toUpperCase().replace(/^COMMUNE\s+(DE\s+|D'\s*|D\s+|DU\s+)?/, '').trim();
        let norm = normaliserCommuneAac(clean);
        row.aacMentionedNorms.push(norm);
      } else if (row.aacType === "CC") {
        let m = getCommunesMentionneesCC(row.objet, toutesLesCommunes);
        row.aacMentionedNorms = m.map(c => c.norm);
      } else if (row.aacType === "SYNDICAT") {
        let m = getCommunesMembresSyndicat(row.beneficiaire, row.objet, toutesLesCommunes);
        row.aacMentionedNorms = m.map(c => c.norm);
      }
    });
    window.AAC_ENTITIES_MAPPED = true;
  }
  
  const dStart = parseDateAac(aacDateStart);
  const dEnd = parseDateAac(aacDateEnd);

  window.aacToggleCategory = function(cat) {
    if (aacHiddenCategories.has(cat)) {
      aacHiddenCategories.delete(cat);
    } else {
      aacHiddenCategories.add(cat);
    }
    renderAacTab();
  };

  // Base filter data by canton and date
  const baseFilteredData = window.AAC_DATA.filter(d => {
    let ok = true;
    if (window.aacCurrentMode !== 'ALL' && d.aacType !== window.aacCurrentMode) ok = false;
    if (aacCurrentCanton !== "Tous les cantons" && d.canton !== aacCurrentCanton) ok = false;
    
    if (dStart || dEnd) {
      let docD = parseDateAac(d.date_vote) || new Date(d.annee, 0, 1);
      if (dStart && docD < dStart) ok = false;
      if (dEnd && docD > dEnd) ok = false;
    }
    return ok;
  });

  // Discover dynamic categories from base data so they stay in legend
  const dynCategories = Array.from(new Set(baseFilteredData.map(d => d.categorie))).sort();

  // Apply hidden categories to get final filtered data
  const filteredData = baseFilteredData.filter(d => !aacHiddenCategories.has(d.categorie));

  // Stats
  const totalSub = filteredData.reduce((acc, d) => acc + d.montant_vote, 0);
  const totalMand = filteredData.reduce((acc, d) => acc + d.montant_paye, 0);
  const nbDossiers = filteredData.length;
  const execRate = totalSub > 0 ? (totalMand / totalSub * 100) : 0;
  let aacPop = 0;
  if (typeof allCommunes !== 'undefined') {
    if(aacCurrentCanton && aacCurrentCanton !== 'Tous les cantons') {
      const normStr = s => (s||'').toUpperCase().replace(/[-\s]/g, '');
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
  const subPerHabitant = aacPop > 0 ? (totalSub / aacPop) : 0;


  // CSS Stacked Bar Chart data
  const years = Array.from(new Set(baseFilteredData.map(d => d.annee).filter(a => a >= 2015 && a <= 2026))).sort((a,b)=>a-b);
  if(years.length === 0) { years.push(2020); } // fallback
  
  const baseCatColors = {
    "Voirie": "#555",
    "Eau / Assainissement": "#3498db",
    "Patrimoine": "#e67e22",
    "Équipements publics": "#9b59b6",
    "Sécurité": "#e74c3c",
    "Accessibilité PMR": "#f1c40f",
    "Transition écologique": "#2ecc71",
    "Divers": "#95a5a6"
  };

  const localCatColors = { ...baseCatColors };
  const fallbackColors = d3.schemeSet3 || ["#8dd3c7","#ffffb3","#bebada","#fb8072","#80b1d3","#fdb462","#b3de69","#fccde5","#d9d9d9","#bc80bd","#ccebc5","#ffed6f"];
  let colorIdx = 0;
  dynCategories.forEach(c => {
    if(!localCatColors[c]) {
       localCatColors[c] = fallbackColors[colorIdx % fallbackColors.length];
       colorIdx++;
    }
  });
  window.AAC_CAT_COLORS = localCatColors;

  const dataByYear = {};
  years.forEach(y => {
    dataByYear[y] = { total: 0 };
    dynCategories.forEach(c => dataByYear[y][c] = 0);
  });

  filteredData.forEach(d => {
    if(dataByYear[d.annee]) {
      dataByYear[d.annee][d.categorie] += d.montant_vote;
      dataByYear[d.annee].total += d.montant_vote;
    }
  });

  const maxYearTotal = Math.max(...years.map(y => dataByYear[y].total), 1);

  // Format currency
  const fmt = (val) => new Intl.NumberFormat('fr-FR', {style:'currency', currency:'EUR', maximumFractionDigits:0}).format(val);

  // List of cantons for dropdown
  const allCantons = ["Tous les cantons", ...Array.from(new Set(window.AAC_DATA.map(d => d.canton))).sort()];

  // Build HTML
  let html = `
    <div style="margin-bottom: 30px;">
      <div style="display: flex; gap: 20px; align-items: center; margin-bottom: 20px; flex-wrap: wrap;">
        <style>
          .aac-period-bar {
            display: flex; align-items: center; gap: 10px; background: var(--surface); padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border); flex-wrap: wrap;
          }
          @media (max-width: 768px) {
            
            .aac-period-bar { flex-direction: column; align-items: stretch; width: 100%; box-sizing: border-box; }
            .aac-period-dates { display: flex; align-items: center; justify-content: space-between; width: 100%; gap: 5px; }
            .aac-period-dates input { flex: 1; max-width: 140px; }
            .aac-period-sep { display: none; }
            .aac-period-mandats { display: flex; align-items: center; justify-content: space-around; width: 100%; border-top: 1px solid var(--border); padding-top: 8px; }
          }
        </style>
        <select id="aacCantonFilter" onchange="aacFilterCanton(this.value)" style="padding: 10px; border-radius: 6px; background: var(--surface); color: var(--txt); border: 1px solid var(--border); font-family: var(--font-body); font-weight: 500; min-width: 200px; flex: 1;">
          ${allCantons.map(c => `<option value="${c}" ${c === aacCurrentCanton ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
        
        <div class="aac-period-bar" style="flex: 2;">
           <div class="aac-period-dates">
             <span style="font-size:0.9em; color:var(--txt-muted);">Période :</span>
             <input type="date" id="aacDateStartInp" value="${aacDateStart}" onchange="aacFilterDate()" style="padding:4px 8px; background:var(--bg); border:1px solid var(--border); color:var(--txt); border-radius:4px; font-family:var(--font-mono);">
             <span style="color:var(--txt-muted);">à</span>
             <input type="date" id="aacDateEndInp" value="${aacDateEnd}" onchange="aacFilterDate()" style="padding:4px 8px; background:var(--bg); border:1px solid var(--border); color:var(--txt); border-radius:4px; font-family:var(--font-mono);">
           </div>
           <div class="aac-period-sep" style="border-left:1px solid var(--border); height:24px; margin:0 10px;"></div>
           <div class="aac-period-mandats">
             <div class="aac-toggle-switch" onclick="aacSetMandat(1)" style="transform: scale(0.85); transform-origin: left center;">
               <div class="aac-toggle-label" style="font-size:1em;">Mandat n°1</div>
               <div class="aac-toggle-track ${aacDateStart === '2015-01-01' && aacDateEnd === '2021-06-27' ? 'active' : ''}">
                 <div class="aac-toggle-thumb"></div>
               </div>
             </div>
             
             <div class="aac-toggle-switch" onclick="aacSetMandat(2)" style="transform: scale(0.85); transform-origin: left center;">
               <div class="aac-toggle-label" style="font-size:1em;">Mandat n°2</div>
               <div class="aac-toggle-track ${aacDateStart === '2021-06-28' && aacDateEnd === '2028-03-31' ? 'active' : ''}">
                 <div class="aac-toggle-thumb"></div>
               </div>
             </div>
           </div>
        </div>

        <button class="analyse-btn" onclick="aacExportCSV()" style="margin: 0; margin-left: auto;">+ Exporter CSV</button>
      </div>

      <!-- KPIs -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 30px;">
        <div class="card" style="padding: 20px; text-align: center;">
          <div style="color: var(--txt-muted); font-size: 0.9em; margin-bottom: 5px;">Total subventions</div>
          <div style="font-size: 1.5em; font-weight: bold; color: var(--gold);">${fmt(totalSub)}</div>
        </div>
        <div class="card" style="padding: 20px; text-align: center;">
          <div style="color: var(--txt-muted); font-size: 0.9em; margin-bottom: 5px;">Total mandaté</div>
          <div style="font-size: 1.5em; font-weight: bold; color: #2ecc71;">${fmt(totalMand)}</div>
        </div>
        <div class="card" style="padding: 20px; text-align: center;">
          <div style="color: var(--txt-muted); font-size: 0.9em; margin-bottom: 5px;">Nombre de dossiers</div>
          <div style="font-size: 1.5em; font-weight: bold; color: var(--txt);">${nbDossiers}</div>
        </div>
        <div class="card" style="padding: 20px; text-align: center;">
          <div style="color: var(--txt-muted); font-size: 0.9em; margin-bottom: 5px;">Taux d'exécution</div>
          <div style="font-size: 1.5em; font-weight: bold; color: #3498db;">${execRate.toFixed(1)}%</div>
        </div>
        <div class="card" style="padding: 20px; text-align: center;">
          <div style="color: var(--txt-muted); font-size: 0.9em; margin-bottom: 5px;">Subventions / hab.</div>
          <div style="font-size: 1.5em; font-weight: bold; color: var(--gold);">${fmt(subPerHabitant)}</div>
        </div>
      </div>

      <!-- CSS Bar Chart -->
      <div class="card" style="padding: 20px; margin-bottom: 30px;">
        <h3 style="margin-top:0; font-family: var(--font-head); color: var(--gold); margin-bottom:20px;">Subventions votées par année (stacked)</h3>
        <div style="display:flex; flex-direction:column; gap:10px;">
          ${years.map(y => {
            const tot = dataByYear[y].total;
            const w = tot > 0 ? (tot / maxYearTotal) * 100 : 0;
            let segments = '';
            dynCategories.forEach(c => {
               if(dataByYear[y][c] > 0) {
                 const pct = (dataByYear[y][c] / tot) * 100;
                 segments += `<div title="${c}: ${fmt(dataByYear[y][c])}" style="width:${pct}%; background:${localCatColors[c]}; height:100%;"></div>`;
               }
            });
            return `
              <div style="display:flex; align-items:center;">
                <div style="width: 50px; font-weight:bold; color:var(--txt-muted); font-family:var(--font-mono); font-size:0.9em;">${y}</div>
                <div style="flex:1; height:24px; background:rgba(0,0,0,0.1); border-radius:4px; overflow:hidden; display:flex;">
                  <div style="display:flex; width:${w}%; height:100%;">
                    ${segments}
                  </div>
                </div>
                <div style="width: 100px; text-align:right; font-family:var(--font-mono); font-size:0.85em; color:var(--txt-muted);">${fmt(tot)}</div>
              </div>
            `;
          }).join('')}
        </div>
        <!-- Legend -->
        <div style="display:flex; flex-wrap:wrap; gap:10px; margin-top:20px; justify-content:center; font-size:0.85em;">
          ${dynCategories.map(c => `
            <div onclick="window.aacToggleCategory('${c.replace(/'/g, "\\'")}')" style="display:flex; align-items:center; gap:5px; cursor:pointer; opacity:${aacHiddenCategories.has(c) ? '0.4' : '1'}; transition:opacity 0.2s;">
              <div style="width:12px;height:12px;background:${localCatColors[c]};border-radius:2px;"></div>
              <span style="color:var(--txt-muted);">${c}</span>
            </div>
          `).join('')}
        </div>
        <div style="text-align:center; font-size:0.8em; color:var(--txt-muted); margin-top:10px;">
          Cliquez sur la légende pour afficher ou masquer du diagramme
        </div>
      </div>
      
      <!-- Mode Selector -->
      <div style="display: flex; gap: 20px; margin-bottom: 25px;" id="aacModeSelector">
        <style>
          .aac-toggle-switch { display:flex; align-items:center; gap:10px; cursor:pointer; user-select:none; }
          .aac-toggle-track { width:48px; height:26px; border-radius:13px; background:#444; transition:background 0.3s; position:relative; }
          .aac-toggle-track.active { background:#f5a623; }
          .aac-toggle-thumb { width:22px; height:22px; border-radius:50%; background:white; position:absolute; top:2px; left:2px; transition:left 0.3s; }
          .aac-toggle-track.active .aac-toggle-thumb { left:24px; }
          .aac-toggle-label { font-family:var(--font-head); font-size: 1.05em; color: var(--txt); }
          @media (max-width: 768px) {
            #aacModeSelector { flex-wrap: wrap !important; gap: 15px !important; }
            #aacModeSelector .aac-toggle-switch { width: 100%; justify-content: space-between; }
            #aacMapSection { flex-direction: column !important; height: auto !important; }
            #aacMapContainer { min-height: 300px !important; }
            #aacTableCard > div { flex-direction: column; align-items: stretch !important; }
            #aacTableCard input { width: 100% !important; margin-top: 10px; box-sizing: border-box; }
          }
        </style>
        
        <div class="aac-toggle-switch" onclick="setAacMode('ALL')">
          <div class="aac-toggle-label">🌐 Tout afficher</div>
          <div class="aac-toggle-track ${window.aacCurrentMode === 'ALL' ? 'active' : ''}">
            <div class="aac-toggle-thumb"></div>
          </div>
        </div>

        <div class="aac-toggle-switch" onclick="setAacMode('COMMUNE')">
          <div class="aac-toggle-label">🏘️ Communes</div>
          <div class="aac-toggle-track ${window.aacCurrentMode === 'COMMUNE' ? 'active' : ''}">
            <div class="aac-toggle-thumb"></div>
          </div>
        </div>
        
        <div class="aac-toggle-switch" onclick="setAacMode('CC')">
          <div class="aac-toggle-label">🏛️ CC / CA</div>
          <div class="aac-toggle-track ${window.aacCurrentMode === 'CC' ? 'active' : ''}">
            <div class="aac-toggle-thumb"></div>
          </div>
        </div>
        
        <div class="aac-toggle-switch" onclick="setAacMode('SYNDICAT')">
          <div class="aac-toggle-label">🔗 Syndicats</div>
          <div class="aac-toggle-track ${window.aacCurrentMode === 'SYNDICAT' ? 'active' : ''}">
            <div class="aac-toggle-thumb"></div>
          </div>
        </div>
      </div>

      <!-- Choropleth Map Section -->
      ${window.aacCurrentMode === 'CC' ? `<div style="background: rgba(212, 168, 67, 0.1); border: 1px solid var(--gold); border-radius: 6px; padding: 10px; margin-bottom: 15px; color: var(--txt); font-size: 0.9em;">
        ℹ️ Les subventions CC/CA sont mutualisées. Les communes colorées plus intensément sont explicitement mentionnées dans les projets.
      </div>` : ''}
      <div style="display:flex; gap:20px; margin-bottom:30px; height:500px;" id="aacMapSection">
        <div id="aacMapContainer" class="card" style="flex: 2; border-radius: 8px; overflow:hidden; position:relative; background: var(--bg); z-index: 10;"></div>
        <div id="aacHoverTip" style="display:none;position:fixed;z-index:2000;pointer-events:none;background:rgba(13,35,64,.97);border:1.5px solid #D4A843;border-radius:9px;padding:9px 13px;max-width:260px;font-family:'IBM Plex Sans',sans-serif;font-size:12px;color:#fff;box-shadow:0 4px 18px rgba(0,0,0,.6);line-height:1.5;"></div>
        
        <!-- Side Panel -->
        <div class="card" style="flex: 1; padding: 20px; display:flex; flex-direction:column; overflow-y:auto; border-left: 3px solid var(--gold);">
          <h3 style="margin-top:0; font-family:var(--font-head); color:var(--gold); display:flex; justify-content:space-between; align-items:center;">
            <span id="aacPanelTitle">Sélectionnez une commune</span>
          </h3>
          <div id="aacPanelFilters" style="display:none; flex-direction:column; gap:10px; margin-bottom:20px;">
            <select id="aacPanelCatFilter" onchange="aacPanelFilterChanged()" style="padding:6px; background:var(--bg); color:var(--txt); border:1px solid var(--border); border-radius:4px;">
              <option value="Toutes">Toutes catégories</option>
              ${dynCategories.map(c => `<option value="${c}">${c}</option>`).join('')}
            </select>
            <select id="aacPanelYearFilter" onchange="aacPanelFilterChanged()" style="padding:6px; background:var(--bg); color:var(--txt); border:1px solid var(--border); border-radius:4px;">
               <option value="Toutes">Toutes années</option>
               ${years.map(y => `<option value="${y}">${y}</option>`).join('')}
            </select>
          </div>
          <div id="aacPanelList" style="flex:1; display:flex; flex-direction:column; gap:15px; font-size:0.9em; color:var(--txt-muted);">
            Cliquez sur la carte pour voir le détail des dossiers de la commune.
          </div>
        </div>
      </div>

      <!-- Table Section -->
      <div class="card" id="aacTableCard" style="padding: 20px; position: relative;">
        <div style="display:flex; justify-content:space-between; margin-bottom:15px;">
           <h3 style="margin:0; font-family:var(--font-head); color:var(--gold);">Tableau exhaustif</h3>
           <input type="text" placeholder="Rechercher (Commune, objet...)" value="${aacSearchText}" oninput="aacSearchTbl(this.value)" style="padding:8px; border:1px solid var(--border); border-radius:6px; background:var(--bg); color:var(--txt); width:300px;">
        </div>
        <div id="aacTableWrapper" style="overflow-x:auto;">
          <table style="width:100%; border-collapse:collapse; text-align:left; font-size:0.9em;">
            <thead>
              <tr style="border-bottom: 2px solid var(--border); color:var(--txt);">
                ${["Commune", "Objet", "Date", "Montant voté", "Mandaté", "% payé", "Statut"].map(col => `
                  <th style="padding:10px; cursor:pointer;" onclick="aacCFB.open('${col}', this)">
                    ${col} ${aacSortCol === col ? (aacSortDesc ? '▼' : '▲') : ''}
                  </th>
                `).join('')}
              </tr>
            </thead>
            <tbody id="aacTbody">
            </tbody>
          </table>
        </div>

        <!-- AAC Col Filter Box -->
        <div class="col-filter-box" id="aacColFilterBox" style="display:none;">
          <div class="cfb-sorts">
            <button id="aacCfbSortAsc" onclick="aacCFB.sortAsc()">Tri ↑</button>
            <button id="aacCfbSortDesc" onclick="aacCFB.sortDesc()">Tri ↓</button>
          </div>
          <input type="text" id="aacCfbSearch" placeholder="Rechercher…" oninput="aacCFB.renderList()">
          <div class="cfb-list" id="aacCfbList"></div>
          <div class="cfb-actions">
            <button onclick="aacCFB.close()">Annuler</button>
            <button onclick="aacCFB.apply()" style="font-weight:bold;color:var(--gold)">OK</button>
          </div>
        </div>
      </div>

    </div>
  `;
  // Destroy map securely before replacing HTML
  if(aacMap) {
    aacMap.remove();
    aacMap = null;
  }
  const tip = document.getElementById('aacHoverTip');
  if(tip) tip.style.display = 'none';

  container.innerHTML = html;

  // Init map
  setTimeout(initAacMap, 50);

  // Render table body
  renderAacTable();
}

function aacFilterCanton(val) {
  aacCurrentCanton = val;
  window.aacSelectedCommune = null;
  renderAacTab();
}

function aacFilterDate() {
  aacDateStart = document.getElementById('aacDateStartInp').value;
  aacDateEnd = document.getElementById('aacDateEndInp').value;
  window.aacSelectedCommune = null;
  renderAacTab();
}

function aacSetMandat(num) {
  if (num === 1) {
    if (aacDateStart === '2015-01-01' && aacDateEnd === '2021-06-27') {
      aacDateStart = ''; aacDateEnd = '';
    } else {
      aacDateStart = '2015-01-01'; aacDateEnd = '2021-06-27';
    }
  } else if (num === 2) {
    if (aacDateStart === '2021-06-28' && aacDateEnd === '2028-03-31') {
      aacDateStart = ''; aacDateEnd = '';
    } else {
      aacDateStart = '2021-06-28'; aacDateEnd = '2028-03-31';
    }
  }
  window.aacSelectedCommune = null;
  renderAacTab();
}

function aacSearchTbl(val) {
  aacSearchText = val.toLowerCase();
  renderAacTable();
}

function aacSort(col) {
  if(aacSortCol === col) aacSortDesc = !aacSortDesc;
  else { aacSortCol = col; aacSortDesc = false; }
  renderAacTable();
}

function renderAacTable() {
  const tbody = document.getElementById('aacTbody');
  if(!tbody) return;

  const fmt = (val) => new Intl.NumberFormat('fr-FR', {style:'currency', currency:'EUR', maximumFractionDigits:0}).format(val);

  const dStart = parseDateAac(aacDateStart);
  const dEnd = parseDateAac(aacDateEnd);

  let filtered = window.AAC_DATA.filter(d => {
    let ok = true;
    if (window.aacCurrentMode !== 'ALL' && d.aacType !== window.aacCurrentMode) ok = false;
    if (aacCurrentCanton !== "Tous les cantons" && d.canton !== aacCurrentCanton) ok = false;
    
    if (dStart || dEnd) {
      let docD = parseDateAac(d.date_vote) || new Date(d.annee, 0, 1);
      if (dStart && docD < dStart) ok = false;
      if (dEnd && docD > dEnd) ok = false;
    }
    
    if (window.aacHiddenCategories && window.aacHiddenCategories.has(d.categorie)) ok = false;

    // Apply column filters
    if (aacTableFilters.Commune && aacTableFilters.Commune.size > 0 && !aacTableFilters.Commune.has((d.beneficiaire||'').trim())) ok = false;
    if (aacTableFilters.Date && aacTableFilters.Date.size > 0 && !aacTableFilters.Date.has((d.date_vote||String(d.annee)).trim())) ok = false;
    if (aacTableFilters.Statut && aacTableFilters.Statut.size > 0 && !aacTableFilters.Statut.has((d.statut||'').trim())) ok = false;

    return ok;
  });

  if(aacSearchText) {
    filtered = filtered.filter(d => 
      (d.beneficiaire || '').toLowerCase().includes(aacSearchText) ||
      (d.objet || '').toLowerCase().includes(aacSearchText)
    );
  }

  filtered.sort((a,b) => {
    let va = a.beneficiaire, vb = b.beneficiaire;
    if(aacSortCol === 'Date') {
      let da = parseDateAac(a.date_vote) || new Date(a.annee, 0, 1);
      let db = parseDateAac(b.date_vote) || new Date(b.annee, 0, 1);
      va = da.getTime();
      vb = db.getTime();
    }
    if(aacSortCol === 'Montant voté') { va = a.montant_vote; vb = b.montant_vote; }
    if(aacSortCol === 'Mandaté') { va = a.montant_paye; vb = b.montant_paye; }
    if(aacSortCol === '% payé') { va = parseFloat(a.taux_paiement)||0; vb = parseFloat(b.taux_paiement)||0; }
    if(aacSortCol === 'Statut') { va = a.statut; vb = b.statut; }
    if(aacSortCol === 'Objet') { va = a.objet; vb = b.objet; }

    if(va < vb) return aacSortDesc ? 1 : -1;
    if(va > vb) return aacSortDesc ? -1 : 1;
    return 0;
  });

  const getBadge = (st) => {
    const col = st.toUpperCase().includes('CLOTUR') ? '#2ecc71' : '#e67e22';
    return `<span style="background:${col}20; color:${col}; padding:2px 8px; border-radius:12px; font-size:0.85em; white-space:nowrap;">${st}</span>`;
  };

  tbody.innerHTML = filtered.map(d => {
    let obj = d.objet || '';
    if(obj.length > 60) obj = obj.substring(0,60) + '...';
    return `
      <tr style="border-bottom: 1px solid var(--border); transition: background 0.2s;">
        <td style="padding:10px; color:var(--gold);">${d.beneficiaire}</td>
        <td style="padding:10px;" title="${d.objet.replace(/"/g, '&quot;')}">${obj}</td>
        <td style="padding:10px;">${d.date_vote || d.annee}</td>
        <td style="padding:10px; font-family:var(--font-mono);">${fmt(d.montant_vote)}</td>
        <td style="padding:10px; font-family:var(--font-mono);">${fmt(d.montant_paye)}</td>
        <td style="padding:10px;">${d.taux_paiement}</td>
        <td style="padding:10px;">${getBadge(d.statut)}</td>
      </tr>
    `;
  }).join('');
}

function initAacMap() {
  const mapDiv = document.getElementById('aacMapContainer');
  if(!mapDiv) return;

  const isDark = document.documentElement.dataset.theme === 'dark';
  aacMap = L.map('aacMapContainer', {
    zoomControl: false,
    attributionControl: false,
    preferCanvas: true
  }).setView([49.4, 2.3], 9);

  L.control.zoom({ position: 'bottomright' }).addTo(aacMap);

  // Background map
  const tileUrl = isDark
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
  L.tileLayer(tileUrl).addTo(aacMap);

  const strokeCol = isDark ? '#0d2340' : '#ffffff';

  const dStart = parseDateAac(aacDateStart);
  const dEnd = parseDateAac(aacDateEnd);

  // Total received per commune
  const communeReceived = {};
  window.AAC_DATA.forEach(d => {
    if(window.aacCurrentMode !== 'ALL' && d.aacType !== window.aacCurrentMode) return;
    
    if(aacCurrentCanton !== "Tous les cantons" && d.canton !== aacCurrentCanton) return;
    
    if (dStart || dEnd) {
      let docD = parseDateAac(d.date_vote) || new Date(d.annee, 0, 1);
      if (dStart && docD < dStart) return;
      if (dEnd && docD > dEnd) return;
    }
    
    if (window.aacHiddenCategories && window.aacHiddenCategories.has(d.categorie)) return;

    if (d.aacMentionedNorms && d.aacMentionedNorms.length > 0) {
      d.aacMentionedNorms.forEach(norm => {
        if(!communeReceived[norm]) communeReceived[norm] = 0;
        communeReceived[norm] += d.montant_vote;
      });
    } else if (window.aacCurrentMode !== 'COMMUNE' && window.aacCurrentMode !== 'ALL') {
      // General dossiers (not tied to a specific commune) 
      // do not color the map for a specific commune, so we do nothing here for the map.
    }
  });

  const getColor = (total) => {
    if(!total || total === 0) return isDark ? '#1a1a1a' : '#f5f5f5';
    if(window.aacCurrentMode === 'CC') {
      if(total < 50000) return '#d0c3e1';
      if(total < 200000) return '#a188c1';
      if(total < 500000) return '#7a52aa';
      return '#532b88';
    } else if (window.aacCurrentMode === 'SYNDICAT') {
      if(total < 50000) return '#ffe0b2';
      if(total < 200000) return '#ffb74d';
      if(total < 500000) return '#f57c00';
      return '#e65100';
    } else if (window.aacCurrentMode === 'ALL') {
      if(total < 50000) return '#bbdefb';
      if(total < 200000) return '#64b5f6';
      if(total < 500000) return '#1e88e5';
      return '#0d47a1';
    } else {
      if(total < 50000) return '#c8e6c9';
      if(total < 200000) return '#81c784';
      if(total < 500000) return '#4caf50';
      return '#2e7d32'; // > 500k
    }
  };

  aacGeoJsonLayer = L.featureGroup().addTo(aacMap);
  const tLayer = L.featureGroup();

  if(allCommunes && allCommunes.length > 0) {
    allCommunes.forEach(c => {
        const nomNorm = normaliserCommuneAac(c.nom);
        const sum = communeReceived[nomNorm] || 0;
        
        if (c.contour) {
            const lyr = L.geoJSON({type: 'Feature', geometry: c.contour}, {
                style: {
                    fillColor: getColor(sum),
                    fillOpacity: 0.8,
                    color: strokeCol,
                    weight: 0.6,
                    opacity: 0.5
                }
            });
            lyr.on('click', () => {
                window.aacSelectedCommune = { norm: nomNorm, display: c.nom };
                renderAacPanel();
            });
            
            const sumStr = new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(sum);
            lyr.on('mouseover', function(e) {
                this.setStyle({fillOpacity: 1, weight: 1.8});
                var tip = document.getElementById('aacHoverTip');
                if(tip) {
                    tip.innerHTML = `<strong>${c.nom}</strong><br>${sumStr}`;
                    tip.style.display = 'block';
                    tip.style.left = (e.originalEvent.clientX + 14) + 'px';
                    tip.style.top = (e.originalEvent.clientY - 10) + 'px';
                }
            });
            lyr.on('mousemove', function(e) {
                var tip = document.getElementById('aacHoverTip');
                if(tip && tip.style.display !== 'none') {
                    var x = e.originalEvent.clientX + 14;
                    var y = e.originalEvent.clientY - 10;
                    // Prevent overflow just in case
                    if(x + tip.offsetWidth > window.innerWidth) x = e.originalEvent.clientX - tip.offsetWidth - 10;
                    if(y + tip.offsetHeight > window.innerHeight) y = e.originalEvent.clientY - tip.offsetHeight - 10;
                    tip.style.left = x + 'px';
                    tip.style.top = y + 'px';
                }
            });
            lyr.on('mouseout', function() {
                this.setStyle({fillOpacity: 0.8, weight: 0.6});
                var tip = document.getElementById('aacHoverTip');
                if (tip) tip.style.display = 'none';
            });
            
            lyr.addTo(aacGeoJsonLayer);

            if(aacCurrentCanton !== "Tous les cantons" && communeReceived[nomNorm] !== undefined) {
                lyr.addTo(tLayer);
            }
        }
    });

    if(aacCurrentCanton !== "Tous les cantons") {
       if(tLayer.getBounds().isValid()) aacMap.fitBounds(tLayer.getBounds());
    } else {
       if(aacGeoJsonLayer.getBounds().isValid()) aacMap.fitBounds(aacGeoJsonLayer.getBounds());
    }
  }
}

function renderAacPanel() {
  const panelTitle = document.getElementById('aacPanelTitle');
  const panelList = document.getElementById('aacPanelList');
  const panelFilters = document.getElementById('aacPanelFilters');
  
  if(!window.aacSelectedCommune) {
     panelTitle.textContent = "Sélectionnez une commune";
     panelFilters.style.display = 'none';
     panelList.innerHTML = "Cliquez sur la carte pour voir le détail des dossiers de la commune.";
     return;
  }

  panelTitle.innerHTML = `${window.aacSelectedCommune.display} <span style="font-size:0.8em; color:var(--txt-muted); cursor:pointer;" onclick="window.aacSelectedCommune=null;renderAacPanel()">✕</span>`;
  panelFilters.style.display = 'flex';

  // Restore filter values in UI if they exist elsewhere (or keep them)
  document.getElementById('aacPanelCatFilter').value = aacPanelCategory;
  document.getElementById('aacPanelYearFilter').value = aacPanelYear;

  const records = window.AAC_DATA.filter(d => {
    if(window.aacCurrentMode !== 'ALL' && d.aacType !== window.aacCurrentMode) return false;

    if (window.aacCurrentMode === 'COMMUNE' || window.aacCurrentMode === 'ALL') {
      if(!d.aacMentionedNorms.includes(window.aacSelectedCommune.norm)) return false;
    } else {
      // CC or SYNDICAT
      // we show dossiers that mention this commune, OR general ones that mention NO commune
      const mentionsCommune = d.aacMentionedNorms.includes(window.aacSelectedCommune.norm);
      const isGeneral = d.aacMentionedNorms.length === 0;
      if(!mentionsCommune && !isGeneral) return false;
    }

    if(aacCurrentCanton !== "Tous les cantons" && d.canton !== aacCurrentCanton) return false;
    if(aacPanelCategory !== "Toutes" && d.categorie !== aacPanelCategory) return false;
    if(aacPanelYear !== "Toutes" && d.annee !== parseInt(aacPanelYear)) return false;
    if(window.aacHiddenCategories && window.aacHiddenCategories.has(d.categorie)) return false;

    // also respect date filters in the side panel
    const dStart = parseDateAac(aacDateStart);
    const dEnd = parseDateAac(aacDateEnd);
    if (dStart || dEnd) {
      let docD = parseDateAac(d.date_vote) || new Date(d.annee, 0, 1);
      if (dStart && docD < dStart) return false;
      if (dEnd && docD > dEnd) return false;
    }

    return true;
  });

  const fmt = (val) => new Intl.NumberFormat('fr-FR', {style:'currency', currency:'EUR', maximumFractionDigits:0}).format(val);

  if(records.length === 0) {
     panelList.innerHTML = "Aucun dossier trouvé pour cette commune avec ces filtres.";
     return;
  }

  const statsByStatus = {};
  let totalVote = 0;
  records.forEach(r => {
    const st = r.statut || 'Inconnu';
    if(!statsByStatus[st]) statsByStatus[st] = 0;
    statsByStatus[st] += (r.montant_vote || 0);
    totalVote += (r.montant_vote || 0);
  });

  const getBadgePanel = (st) => {
    const col = st.toUpperCase().includes('CLOTUR') ? '#2ecc71' : '#e67e22';
    return `<span style="background:${col}20; color:${col}; padding:2px 8px; border-radius:12px; font-size:0.85em; white-space:nowrap;">${st}</span>`;
  };

  const statsHtml = Object.keys(statsByStatus).sort().map(s => `
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div>${getBadgePanel(s)}</div>
            <div style="font-family:var(--font-mono); font-weight:bold;">${fmt(statsByStatus[s])}</div>
          </div>
        `).join('');

  let listHtml = `
    <div style="background:var(--surface); border:1px solid var(--border); padding:10px 15px; border-radius:6px; margin-bottom: 20px;">
      <div style="font-size:0.85em; text-transform:uppercase; color:var(--txt-muted); margin-bottom:10px; letter-spacing:0.5px;">Résumé par statut</div>
      <div style="display:flex; flex-direction:column; gap:6px;">
        ${statsHtml}
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--border); padding-top:8px; margin-top:8px;">
        <div style="font-weight:bold; color:var(--txt);">Total montants votés</div>
        <div style="font-family:var(--font-mono); font-weight:bold; color:var(--gold);">${fmt(totalVote)}</div>
      </div>
    </div>
  `;

  if (window.aacCurrentMode === 'COMMUNE') {
    listHtml += records.sort((a,b)=>b.annee - a.annee).map(r => renderAacDossierCard(r, fmt)).join('');
  } else {
    // Group by beneficiaire
    const groups = {};
    records.sort((a,b)=>b.annee - a.annee).forEach(r => {
      const b = r.beneficiaire || 'INCONNU';
      if(!groups[b]) groups[b] = [];
      groups[b].push(r);
    });

    for(let b in groups) {
      listHtml += `<div style="font-weight:bold; color:var(--txt); margin-top:20px; margin-bottom:10px; border-bottom:1px solid var(--border); padding-bottom:5px;">${b}</div>`;
      listHtml += groups[b].map(r => renderAacDossierCard(r, fmt)).join('');
    }
  }

  panelList.innerHTML = listHtml;
}

function renderAacDossierCard(r, fmt) {
  const cColor = (window.AAC_CAT_COLORS && window.AAC_CAT_COLORS[r.categorie]) ? window.AAC_CAT_COLORS[r.categorie] : '#95a5a6';
  return `
    <div style="background:var(--surface); border:1px solid var(--border); padding:10px; border-radius:6px; margin-bottom: 10px;">
      <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
         <span style="font-size:0.8em; background:${cColor}30; color:${cColor}; padding:2px 6px; border-radius:4px; white-space:nowrap;">${r.categorie}</span>
         <span style="font-size:0.8em; font-family:var(--font-mono); color:var(--txt-muted);">${r.date_vote || r.annee}</span>
      </div>
      <div style="color:var(--txt); margin-bottom:8px; line-height:1.3;">${r.objet}</div>
      <div style="display:flex; justify-content:space-between; font-weight:bold;">
         <span style="color:var(--gold);">${fmt(r.montant_vote)}</span>
         <span style="font-size:0.9em; font-weight:normal; color:${r.statut.toUpperCase().includes('CLOTUR') ? '#2ecc71': '#e67e22'};">${r.statut}</span>
      </div>
    </div>
  `;
}

function aacPanelFilterChanged() {
  aacPanelCategory = document.getElementById('aacPanelCatFilter').value;
  aacPanelYear = document.getElementById('aacPanelYearFilter').value;
  renderAacPanel();
}

function aacExportCSV() {
  if(!window.AAC_DATA) return;
  const filtered = window.AAC_DATA.filter(d => 
    aacCurrentCanton === "Tous les cantons" || d.canton === aacCurrentCanton
  );
  
  if(filtered.length === 0) return;
  
  let csv = "Bénéficiaire;Canton;Année;Objet;Catégorie;Montant voté;Mandaté;% payé;Statut\\n";
  filtered.forEach(d => {
    csv += `"${d.beneficiaire}";"${d.canton}";${d.annee};"${d.objet.replace(/"/g, '""')}";"${d.categorie}";${d.montant_vote};${d.montant_paye};"${d.taux_paiement}";"${d.statut}"\\n`;
  });
  
  const blob = new Blob(["\\uFEFF"+csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", "aide_aux_communes.csv");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

window.updateAacMapTile = function() {
  if (!aacMap) return;
  const isDark = document.documentElement.dataset.theme === 'dark';
  aacMap.eachLayer((layer) => {
    if(layer instanceof L.TileLayer){
      layer.setUrl(isDark
        ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
        : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png');
    }
  });
  if (aacGeoJsonLayer) {
    const strokeCol = isDark ? '#0d2340' : '#ffffff';
    aacGeoJsonLayer.setStyle({ color: strokeCol });
  }
};


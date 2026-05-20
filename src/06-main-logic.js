
// ═══════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════
var allCommunes = [];
var filteredCommunes = [];
var enrichedData = {};
var currentPage = 1;
var pageSize = 50;
var selectedCode = null;
var maxPop = 1;
var epciMap = {};
var mapInstance = null;
var mapMarkers = [];
var pcMarkersLayer = null;
var currentTab = 'table';

// ═══════════════════════════════════════════════════
// INIT — offline first
// ═══════════════════════════════════════════════════
function init(){
  try{
    if (typeof FALLBACK_COMMUNES === 'undefined' || typeof COMMUNE_CONTOURS === 'undefined') {
       throw new Error('Données locales manquantes (FALLBACK_COMMUNES/COMMUNE_CONTOURS)');
    }
    allCommunes=FALLBACK_COMMUNES.map(function(c){
      return Object.assign({},c,{contour:COMMUNE_CONTOURS[c.code]||null});
    });
    window.allCommunes = allCommunes;
    maxPop=Math.max.apply(null,allCommunes.map(function(c){return c.population;}).concat([1]));
    
    // Initialisation EPCI
    try {
      var epciNames={};
      if (typeof CACHE_INSEE_EPCIS !== 'undefined') {
          CACHE_INSEE_EPCIS.forEach(function(e){ epciNames[e.code]=e.nom; });
      }
      if (typeof CACHE_INSEE_COMMUNES_EPCI !== 'undefined') {
          CACHE_INSEE_COMMUNES_EPCI.forEach(function(c){
            if(c.codeEpci) epciMap[c.code]={codeEpci:c.codeEpci, nomEpci:epciNames[c.codeEpci]||c.codeEpci};
          });
      }
      allCommunes.forEach(function(c){
        if(epciMap[c.code]){c.codeEpci=epciMap[c.code].codeEpci;c.nomEpci=epciMap[c.code].nomEpci;}
      });
      populateEpciSelect();
    } catch(e) {
      console.warn('EPCI data enrichment failed', e);
    }
    
    // Initialisation INSEE cache
    try {
      if (typeof CACHE_INSEE_COMMUNES_DATA !== 'undefined') {
        var data = CACHE_INSEE_COMMUNES_DATA;
        if(Array.isArray(data) && data.length >= 600) {
          var idx={};data.forEach(function(c){idx[c.code]=c;});
          allCommunes=allCommunes.map(function(c){
            var a=idx[c.code];if(!a)return c;
            var pop=a.population||0,sH=a.surface||0,sK=sH/100;
            return Object.assign({},c,{population:pop,surface:sH,surfaceKm2:sK,
              density:sK>0?Math.round(pop/sK):0,
              codePostal:(a.codesPostaux||[])[0]||c.codePostal,centre:a.centre||c.centre});
          });
          window.allCommunes = allCommunes;
          maxPop=Math.max.apply(null,allCommunes.map(function(c){return c.population;}).concat([1]));
        }
      }
    } catch(e) {
      console.warn('INSEE data enrichment failed', e);
    }

    populateSelects();
    applyFilters();
    updateStats();
    
    if(typeof renderTable === 'function') renderTable(typeof filteredCommunes !== 'undefined' ? filteredCommunes : allCommunes);
    if(typeof generateMobCards === 'function') generateMobCards();
    
    switchTab("table", document.getElementById("tabBtnTable"));
    
    document.getElementById('loadBar').style.width='100%';
    document.getElementById('loadMsg').textContent='Prêt !';
    
    setTimeout(function(){
      var o=document.getElementById('loadOverlay');
      if(o)o.classList.add('hidden');
    },300);
    
    var en=document.getElementById('enrichNotice');
    if(en)en.style.display='flex';
  } catch(e) {
    console.error('init error:', e);
    const msg = document.getElementById('loadMsg');
    if(msg) msg.innerHTML = '<span style="color:red">Erreur critique : ' + e.message + '</span>';
    setTimeout(function(){
      var o=document.getElementById('loadOverlay');
      if(o)o.classList.add('hidden');
    }, 2000);
  }
}


// ═══════════════════════════════════════════════════
// POPULATE SELECTS
// ═══════════════════════════════════════════════════
function populateSelects() {
  const cantonSelect = document.getElementById('filterCanton');
  if (cantonSelect) {
    const cantonMap = new Map();
    allCommunes.filter(c => c.codeCanton).forEach(c => {
      if(!cantonMap.has(c.codeCanton)) cantonMap.set(c.codeCanton, c.nomCanton);
    });
    [...cantonMap.entries()].sort((a,b) => a[1].localeCompare(b[1])).forEach(([code, nom]) => {
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = nom;
      cantonSelect.appendChild(opt);
    });
  }

  const circoSelect = document.getElementById('filterCirco');
  if (circoSelect) {
    const circoMap = new Map();
    allCommunes.filter(c => c.codeCirconscription).forEach(c => {
      if(!circoMap.has(c.codeCirconscription)) circoMap.set(c.codeCirconscription, c.nomCirconscription||c.codeCirconscription);
    });
    [...circoMap.entries()].sort((a,b) => a[1].localeCompare(b[1])).forEach(([code, nom]) => {
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = nom;
      circoSelect.appendChild(opt);
    });
  }
}

function populateEpciSelect() {
  const sel = document.getElementById('filterEpci');
  if (!sel || sel.options.length > 1) return;
  const em = new Map();
  allCommunes.forEach(function(c){ if(c.codeEpci && !em.has(c.codeEpci)) em.set(c.codeEpci, c.nomEpci||c.codeEpci); });
  [...em.entries()].sort((a,b)=>a[1].localeCompare(b[1],'fr')).forEach(function([code,nom]){
    const opt = document.createElement('option');
    opt.value = code; opt.textContent = nom;
    sel.appendChild(opt);
  });
}

// ═══════════════════════════════════════════════════
// FILTERS & SORT
// ═══════════════════════════════════════════════════
const headerFilters = {
  nom: '', code: '', cp: '', canton: new Set(), arr: new Set(), epci: new Set(), density: new Set(), circo: new Set()
};

const CFB = {
  col: null,
  open: function(col, th) {
    const box = document.getElementById('colFilterBox');
    if (this.col === col && box && box.style.display === 'flex') {
      this.close();
      return;
    }
    if (this._clickRef) document.removeEventListener('click', this._clickRef);
    if (this._scrollRef) window.removeEventListener('scroll', this._scrollRef, true);
    
    this.col = col;
    box.style.display = 'flex';
    
    const updatePos = () => {
      const rect = th.getBoundingClientRect();
      box.style.top = rect.bottom + 'px';
      box.style.left = rect.left + 'px';
    };
    updatePos();
    
    document.getElementById('cfbSearch').value = typeof headerFilters[col] === 'string' ? headerFilters[col] : '';
    this.renderList();
    
    this._clickRef = (e) => {
      if(!e.target.closest('#colFilterBox') && !e.target.closest('th')) CFB.close();
    };
    this._scrollRef = (e) => {
      if (e.target && e.target.closest && e.target.closest('#colFilterBox')) return;
      updatePos();
    };
    
    setTimeout(() => {
      document.addEventListener('click', this._clickRef);
      window.addEventListener('scroll', this._scrollRef, true);
    }, 10);
  },
  close: function() {
    document.getElementById('colFilterBox').style.display = 'none';
    if (this._clickRef) document.removeEventListener('click', this._clickRef);
    if (this._scrollRef) window.removeEventListener('scroll', this._scrollRef, true);
  },
  renderList: function() {
    const list = document.getElementById('cfbList');
    if (!['canton', 'arr', 'epci', 'density', 'circo'].includes(this.col)) {
      list.innerHTML = `<div style="padding:6px;color:var(--txt-muted)">Filtrer par texte via la barre de recherche au-dessus.</div>`;
      return;
    }
    const search = document.getElementById('cfbSearch').value.toLowerCase();
    const map = new Map();
    allCommunes.forEach(c => {
      let val = null, lbl = null;
      if (this.col==='canton') { val = c.codeCanton; lbl = c.nomCanton; }
      if (this.col==='arr') { val = c.codeArr; lbl = c.nomArr; }
      if (this.col==='epci') { val = c.codeEpci; lbl = c.nomEpci; }
      if (this.col==='circo') { val = c.codeCirconscription; lbl = c.nomCirconscription; }
      if (this.col==='density') { val = getDensityClass(c.density); lbl = getDensityLabel(c.density); }
      if (val && !map.has(val)) map.set(val, lbl||val);
    });
    
    const items = [...map.entries()].map(([v,l])=>({v,l})).sort((a,b)=>a.l.localeCompare(b.l,'fr'))
      .filter(it => it.l.toLowerCase().includes(search));
      
    list.innerHTML = items.map(it => {
      const checked = headerFilters[this.col].has(it.v) ? 'checked' : '';
      return `<label class="cfb-item"><input type="checkbox" value="${it.v}" ${checked}><span>${it.l}</span></label>`;
    }).join('');
  },
  apply: function() {
    if (['canton', 'arr', 'epci', 'density', 'circo'].includes(this.col)) {
      headerFilters[this.col].clear();
      document.querySelectorAll('#cfbList input:checked').forEach(c => headerFilters[this.col].add(c.value));
    } else {
      headerFilters[this.col] = document.getElementById('cfbSearch').value;
    }
    this.close();
    applyFilters();
  },
  sortAsc: function() {
    document.getElementById('sortField').value = this.col === 'nom' ? 'nom' : (this.col === 'population' ? 'pop-asc' : this.col+'-asc');
    this.close(); applyFilters();
  },
  sortDesc: function() {
    document.getElementById('sortField').value = this.col === 'nom' ? 'nom-desc' : (this.col === 'population' ? 'pop-desc' : this.col+'-desc');
    this.close(); applyFilters();
  }
};
window.openColFilter = function(col, th) { CFB.open(col, th); };

function applyFilters() {
  const search  = document.getElementById('searchInput').value.toLowerCase().trim();
  const fArr    = document.getElementById('filterArr') ? document.getElementById('filterArr').value : '';
  const fCanton = document.getElementById('filterCanton').value;
  const fCirco  = document.getElementById('filterCirco') ? document.getElementById('filterCirco').value : '';
  const fEpci   = document.getElementById('filterEpci') ? document.getElementById('filterEpci').value : '';
  const fDens   = document.getElementById('filterDensity').value;
  const pMin    = parseInt(document.getElementById('popMin').value) || 0;
  const pMax    = parseInt(document.getElementById('popMax').value) || Infinity;
  const sort    = document.getElementById('sortField').value;
  pageSize = parseInt(document.getElementById('pageSize').value);

  filteredCommunes = allCommunes.filter(c => {
    // Left sidebar filters
    if(search && !c.nom.toLowerCase().includes(search) && !c.code.includes(search) && !c.codePostal.includes(search)) return false;
    if(fArr && c.codeArr !== fArr) return false;
    if(fCirco && c.codeCirconscription !== fCirco) return false;
    if(fCanton && c.codeCanton !== fCanton) return false;
    if(fEpci && c.codeEpci !== fEpci) return false;
    if(fDens && getDensityClass(c.density) !== fDens) return false;
    if(c.population < pMin || c.population > pMax) return false;
    
    // Header dropdown filters
    if(headerFilters.nom && !c.nom.toLowerCase().includes(headerFilters.nom.toLowerCase())) return false;
    if(headerFilters.code && !c.code.includes(headerFilters.code)) return false;
    if(headerFilters.cp && (!c.codePostal || !c.codePostal.includes(headerFilters.cp))) return false;
    if(headerFilters.canton.size > 0 && !headerFilters.canton.has(c.codeCanton)) return false;
    if(headerFilters.arr.size > 0 && !headerFilters.arr.has(c.codeArr)) return false;
    if(headerFilters.epci.size > 0 && !headerFilters.epci.has(c.codeEpci)) return false;
    if(headerFilters.density.size > 0 && !headerFilters.density.has(getDensityClass(c.density))) return false;

    return true;
  });

  document.querySelectorAll('th[onclick^="openColFilter"]').forEach(th => {
    const colMatch = th.getAttribute('onclick').match(/openColFilter\('([^']+)'/);
    if(colMatch && colMatch[1]) {
      const col = colMatch[1];
      const hasFilter = (headerFilters[col] instanceof Set) ? (headerFilters[col].size > 0) : !!headerFilters[col];
      th.style.color = hasFilter ? 'var(--gold)' : '';
      th.style.fontWeight = hasFilter ? 'bold' : '';
    }
  });

  filteredCommunes.sort((a, b) => {
    switch(sort) {
      case 'nom':          return a.nom.localeCompare(b.nom, 'fr');
      case 'nom-desc':     return b.nom.localeCompare(a.nom, 'fr');
      case 'pop-desc':     return b.population - a.population;
      case 'pop-asc':      return a.population - b.population;
      case 'surface-desc': return b.surface - a.surface;
      case 'density-desc': return b.density - a.density;
      default:             return a.nom.localeCompare(b.nom, 'fr');
    }
  });

  currentPage = 1;
  renderTable();
  updateStats();

  if(currentTab === 'map' && mapInstance){
    if(typeof _hidePopCard==='function')_hidePopCard();
    updateMapMarkers();
  }
}

function applyPopPreset() {
  const preset = document.getElementById('popPreset').value;
  if(!preset) {
    document.getElementById('popMin').value = '';
    document.getElementById('popMax').value = '';
  } else {
    const [min, max] = preset.split('-').map(Number);
    document.getElementById('popMin').value = min;
    document.getElementById('popMax').value = max;
  }
  applyFilters();
}

function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const btn = document.getElementById('sidebarToggle');
  if(!sb || !btn) return;
  sb.classList.toggle('collapsed');
  if(sb.classList.contains('collapsed')){
    btn.style.left = '0px';
    btn.textContent = '»';
  } else {
    btn.style.left = '240px';
    btn.textContent = '«';
  }
}

function resetFilters() {
  document.getElementById('searchInput').value = '';
  if (document.getElementById('filterArr')) document.getElementById('filterArr').value = '';
  if (document.getElementById('filterCanton')) document.getElementById('filterCanton').value = '';
  if (document.getElementById('filterCirco')) document.getElementById('filterCirco').value = '';
  if (document.getElementById('filterEpci')) document.getElementById('filterEpci').value = '';
  document.getElementById('filterDensity').value = '';
  document.getElementById('popMin').value = '';
  document.getElementById('popMax').value = '';
  document.getElementById('popPreset').value = '';
  document.getElementById('sortField').value = 'nom';
  document.getElementById('pageSize').value = '50';
  pageSize = 50;
  
  headerFilters.nom = '';
  headerFilters.code = '';
  headerFilters.cp = '';
  headerFilters.canton.clear();
  headerFilters.arr.clear();
  headerFilters.epci.clear();
  headerFilters.density.clear();
  
  applyFilters();
}

function sortBy(field) {
  const sel = document.getElementById('sortField');
  const cur = sel.value;
  if(field === 'nom') sel.value = (cur === 'nom') ? 'nom-desc' : 'nom';
  else if(field === 'population') sel.value = (cur === 'pop-desc') ? 'pop-asc' : 'pop-desc';
  else if(field === 'surface') sel.value = 'surface-desc';
  else if(field === 'density') sel.value = 'density-desc';
  applyFilters();
}

// ═══════════════════════════════════════════════════
// TABLE
// ═══════════════════════════════════════════════════
function renderTable() {
  const tbody = document.getElementById('tableBody');
  const total = filteredCommunes.length;
  document.getElementById('resultCount').textContent =
    `${total.toLocaleString('fr-FR')} commune${total > 1 ? 's' : ''} affichée${total > 1 ? 's' : ''}`;
  // Synthèse cantonale si un canton est filtré
  const _fCanton = document.getElementById('filterCanton');
  if(typeof showCantonSummary === 'function') showCantonSummary(_fCanton ? _fCanton.value : '');
  if(typeof _showOiseSummaryBar === 'function') _showOiseSummaryBar(true);

  if(total === 0) {
    tbody.innerHTML = '<tr><td colspan="10"><div class="empty-state">🔍 Aucune commune ne correspond aux filtres.</div></td></tr>';
    document.getElementById('paginationBar').style.display = 'none';
    return;
  }

  const effectivePS = pageSize >= 9999 ? total : pageSize;
  const totalPages  = Math.max(1, Math.ceil(total / effectivePS));
  if(currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * effectivePS;
  const end   = Math.min(start + effectivePS, total);
  const page  = filteredCommunes.slice(start, end);

  if (isMobile()) renderMobileList();
  tbody.innerHTML = page.map(c => {
    const dc  = getDensityClass(c.density);
    const pct = maxPop > 0 ? Math.round((c.population / maxPop) * 100) : 0;
    const sel = c.code === selectedCode ? 'selected' : '';
    return `
    <tr class="${sel}" onclick="openDetail('${c.code}')">
      <td><strong>${c.nom}</strong></td>
      <td><span class="code-badge">${c.code}</span></td>
      <td><span class="cp-tag">${c.codePostal || '—'}</span></td>
      <td><span class="canton-badge">${c.nomCanton}</span></td>
      <td><span class="arr-badge" style="background:rgba(212,175,55,0.15);color:#d4af37;border-color:rgba(212,175,55,0.3)">${c.nomCirconscription || '—'}</span></td>
      <td>${c.nomEpci ? `<span class="epci-badge">${c.nomEpci}</span>` : '<span style="color:var(--txt-muted);font-size:10px">—</span>'}</td>
      <td>
        <div class="pop-bar-wrapper">
          <div class="pop-bar"><div class="pop-bar-fill" style="width:${pct}%"></div></div>
          <span class="pop-num">${formatPop(c.population)}</span>
        </div>
      </td>
      <td><span class="surface-val">${formatSurface(c.surface)}</span></td>
      <td><span class="density-badge density-${dc}">${c.density > 0 ? c.density + ' hab/km²' : '—'}</span></td>
      <td>
        <a class="link-btn" href="https://fr.wikipedia.org/wiki/${encodeURIComponent(c.nom)}" target="_blank" onclick="event.stopPropagation()" title="Wikipedia">W</a>
        <a class="link-btn" href="https://www.google.com/maps/search/${encodeURIComponent(c.nom+', Oise, France')}" target="_blank" onclick="event.stopPropagation()" title="Google Maps">M</a>
        <a class="link-btn" href="https://www.insee.fr/fr/statistiques/2011101?geo=COM-${c.code}" target="_blank" onclick="event.stopPropagation()" title="INSEE">I</a>
      </td>
    </tr>`;
  }).join('');

  renderPagination(totalPages, total, start, end);
}

function renderPagination(totalPages, total, start, end) {
  const bar = document.getElementById('paginationBar');
  if(totalPages <= 1) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  document.getElementById('pageInfo').textContent = `${start+1}–${end} / ${total.toLocaleString('fr-FR')}`;

  const btns = document.getElementById('pageBtns');
  let html = `<button class="page-btn" onclick="goPage(${currentPage-1})" ${currentPage===1?'disabled':''}>‹</button>`;
  const range = 2;
  let lastShown = 0;
  for(let i = 1; i <= totalPages; i++) {
    const show = i === 1 || i === totalPages || (i >= currentPage-range && i <= currentPage+range);
    if(show) {
      if(lastShown && i - lastShown > 1) html += `<span style="color:var(--txt-muted);padding:0 4px">…</span>`;
      html += `<button class="page-btn ${i===currentPage?'active':''}" onclick="goPage(${i})">${i}</button>`;
      lastShown = i;
    }
  }
  html += `<button class="page-btn" onclick="goPage(${currentPage+1})" ${currentPage===totalPages?'disabled':''}>›</button>`;
  btns.innerHTML = html;
}

function goPage(n) {
  const total = filteredCommunes.length;
  const effectivePS = pageSize >= 9999 ? total : pageSize;
  const totalPages = Math.ceil(total / effectivePS);
  if(n < 1 || n > totalPages) return;
  currentPage = n;
  renderTable();
  document.querySelector('.main-content')?.scrollTo({top:0, behavior:'smooth'});
}

// ═══════════════════════════════════════════════════
// STATS BAR
// ═══════════════════════════════════════════════════
function updateStats() {
  const totalPop = allCommunes.reduce((s,c) => s+c.population, 0);
  const maxC     = allCommunes.reduce((a,b) => b.population>a.population?b:a, {nom:'—',population:0});
  const cantons  = new Set(allCommunes.map(c=>c.codeCanton).filter(Boolean));

  document.getElementById('statCommunes').textContent = allCommunes.length.toLocaleString('fr-FR');
  document.getElementById('statCantons').textContent  = Math.min(cantons.size,21);
  document.getElementById('statPop').textContent      = formatPop(totalPop);
  document.getElementById('statPopMoy').textContent   = allCommunes.length ? Math.round(totalPop/allCommunes.length).toLocaleString('fr-FR') : '—';
  document.getElementById('statFiltered').textContent = filteredCommunes.length.toLocaleString('fr-FR');
}

// ═══════════════════════════════════════════════════
// DETAIL PANEL
// ═══════════════════════════════════════════════════
function openDetail(code) {
  const c = allCommunes.find(x => x.code === code);
  if(!c) return;
  selectedCode = code;

  // Auto-sync tab analyse if we are on it
  if (typeof analyseCode1 !== 'undefined') {
      analyseCode1 = code;
      if (typeof renderAnalyseHome === 'function' && typeof currentTab !== 'undefined' && currentTab === 'analyse') {
          renderAnalyseHome();
      }
  }

  document.getElementById('detailName').textContent = c.nom;
  document.getElementById('detailMeta').innerHTML = `<span>${c.code}</span><span>${c.codePostal || '—'}</span><span>Arr. ${c.nomArr}</span><span>${c.nomCanton}</span>` + (c.nomCirconscription ? `<span>${c.nomCirconscription}</span>` : '');
  const enr = enrichedData[code] || {};

  // 1. DONNEES DE BASE
  let html = `<div class="detail-section"><div class="detail-section-title">📊 Données de base</div><div class="detail-grid">
    <div class="detail-kv"><div class="detail-kv-key">Population</div><div class="detail-kv-value">${formatPop(c.population)}</div></div>
    <div class="detail-kv"><div class="detail-kv-key">Surface</div><div class="detail-kv-value">${formatSurface(c.surface)}</div></div>
    <div class="detail-kv"><div class="detail-kv-key">Densité</div><div class="detail-kv-value">${c.density>0?c.density+' hab/km²':'—'}</div></div>
    <div class="detail-kv"><div class="detail-kv-key">Type territorial</div><div class="detail-kv-value" style="font-size:11px">${getDensityLabel(c.density)}</div></div>
    <div class="detail-kv"><div class="detail-kv-key">Canton</div><div class="detail-kv-value" style="font-size:11px">${c.nomCanton}</div></div>
    <div class="detail-kv"><div class="detail-kv-key">Circo.</div><div class="detail-kv-value" style="font-size:11px">${c.nomCirconscription || '—'}</div></div>
    ${c.nomEpci?`<div class="detail-kv"><div class="detail-kv-key">CC / CA</div><div class="detail-kv-value" style="font-size:11px">${c.nomEpci}</div></div>`:''}
    ${(function(){const pd=(typeof politicalData!=='undefined')&&politicalData[code];const ins=pd&&pd.popElec?parseInt(pd.popElec):null;return ins?`<div class="detail-kv"><div class="detail-kv-key">Inscrits (élec.)</div><div class="detail-kv-value">${ins.toLocaleString('fr-FR')}</div></div>`:'';})()}
  </div></div>`;

  // 1.2 AIDE AUX COMMUNES
  if (typeof window !== 'undefined' && window.AAC_DATA_LOADED && window.AAC_DATA && window.AAC_DATA.length > 0) {
    const accNorm = (str) => {
      if (!str) return "";
      return String(str).toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[-'`’]/g, " ").replace(/\s+/g, " ").trim();
    };
    const parseD = (dStr) => {
      if (!dStr) return null;
      const m = dStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      if (m) return new Date(m[3], m[2]-1, m[1]);
      if (dStr.match(/^\d{4}-\d{2}-\d{2}$/)) return new Date(dStr);
      return null;
    };

    const normName = accNorm(c.nom);
    const m1Start = new Date("2015-01-01");
    const m1End = new Date("2021-06-27");
    const m2Start = new Date("2021-06-28");
    const m2End = new Date("2028-03-31");

    let m1Total = 0;
    let m2Total = 0;

    window.AAC_DATA.forEach(d => {
      if (d.aacType === "COMMUNE") {
        let clean = String(d.beneficiaire).toUpperCase().replace(/^COMMUNE\s+(DE\s+|D'\s*|D\s+|DU\s+)?/, '').trim();
        let norm = accNorm(clean);
        if (norm === normName) {
          let docD = parseD(d.date_vote) || new Date(d.annee, 0, 1);
          if (docD >= m1Start && docD <= m1End) m1Total += (d.montant_vote || 0);
          if (docD >= m2Start && docD <= m2End) m2Total += (d.montant_vote || 0);
        }
      }
    });

    const totalAac = m1Total + m2Total;
    const fmtC = (v) => new Intl.NumberFormat('fr-FR', {style:'currency', currency:'EUR', maximumFractionDigits:0}).format(v);

    if (totalAac > 0) {
      html += `<div class="detail-section" style="background: rgba(212,168,67,0.1); border-left:4px solid var(--gold); margin-top: 5px; cursor:pointer;" onclick="if(window.switchTab){ window.switchTab('aac'); window.aacCurrentMode = 'COMMUNE'; window.aacSelectedCommune = { norm: '${normName.replace(/'/g, "\\'")}', display: '${c.nom.replace(/'/g, "\\'")}' }; if(window.renderAacTab) window.renderAacTab(); }">
        <div class="detail-section-title" style="color:var(--gold); display:flex; justify-content:space-between; align-items:center;">
          <span>🏛️ Aide aux communes</span>
          <span style="font-size:10px; opacity:0.8;">Ouvrir ↗</span>
        </div>
        <div class="detail-grid">
          <div class="detail-kv"><div class="detail-kv-key">Mandat n°1<br><span style="font-size:8px;opacity:0.7">2015-2021</span></div><div class="detail-kv-value">${fmtC(m1Total)}</div></div>
          <div class="detail-kv"><div class="detail-kv-key">Mandat n°2<br><span style="font-size:8px;opacity:0.7">2021-2028</span></div><div class="detail-kv-value">${fmtC(m2Total)}</div></div>
          <div class="detail-kv" style="grid-column:span 2"><div class="detail-kv-key" style="color:var(--gold);">Total cumulé</div><div class="detail-kv-value" style="color:var(--gold); font-size:1.1em">${fmtC(totalAac)}</div></div>
        </div>
      </div>`;
    }
  }

  // 1.5 PASS PERMIS & PASS AVENIR
  if (enr.passPermis) {
    let cantTotal = 0;
    let depTotal = 0;
    for (const cd in enrichedData) {
      if (enrichedData[cd] && enrichedData[cd].passPermis) {
         let t = enrichedData[cd].passPermis.total || 0;
         depTotal += t;
         let cdCom = allCommunes.find(x => x.code === cd);
         if (cdCom && cdCom.nomCanton === c.nomCanton) {
             cantTotal += t;
         }
      }
    }
    
    let pctCant = cantTotal > 0 ? ((enr.passPermis.total / cantTotal) * 100).toFixed(1) : 0;
    let pctDep = depTotal > 0 ? ((enr.passPermis.total / depTotal) * 100).toFixed(1) : 0;
    
    html+=`<div class="detail-section" style="background: rgba(46,125,50,0.1); border-left:4px solid #2e7d32; margin-top: 5px;">
    <div class="detail-section-title" style="color:#4caf50;">🚗 Pass Permis</div>
    <div class="detail-grid">
      <div class="detail-kv"><div class="detail-kv-key">Acceptés</div><div class="detail-kv-value">${enr.passPermis.acceptes}</div></div>
      <div class="detail-kv"><div class="detail-kv-key">Payés</div><div class="detail-kv-value">${enr.passPermis.payes}</div></div>
      <div class="detail-kv"><div class="detail-kv-key" style="font-weight:bold; color:var(--text-color);">Total Général</div><div class="detail-kv-value" style="font-weight:bold; color:var(--text-color);">${enr.passPermis.total}</div></div>
    </div>
    <div style="margin-top: 8px; font-size: 12px; color: var(--txt-muted); display:flex; gap:15px;">
      <span title="Total canton: ${cantTotal}">Canton: <strong>${pctCant}%</strong> (${cantTotal} pass)</span>
      <span title="Total département: ${depTotal}">Dépt: <strong>${pctDep}%</strong> (${depTotal} pass)</span>
    </div>
    </div>`;
  }

  if (enr.passAvenir) {
    html+=`<div class="detail-section" style="background: rgba(2,119,189,0.1); border-left:4px solid #0277bd;">
    <div class="detail-section-title" style="color:#29b6f6;">🎓 Pass Avenir Citoyen</div>
    <div class="detail-grid">
      <div class="detail-kv"><div class="detail-kv-key">Enregistrements</div><div class="detail-kv-value">${enr.passAvenir.enregistrements}</div></div>
      <div class="detail-kv"><div class="detail-kv-key">Acceptés</div><div class="detail-kv-value">${enr.passAvenir.acceptes}</div></div>
    </div></div>`;
  }

  // 2. NOUVEAU MAIRE + LISTE
  const _pd = (typeof politicalData!=='undefined') ? politicalData[code] : null;
  if(_pd) {
    const n=_pd.nouveau, a=_pd.ancien;
    const hN=n&&(n.nom||n.prenom);
    const hA=a&&(a.nom||a.prenom);
    if(hN) {
      const fN=typeof isFem==='function'?isFem(n.qualite):false;
      const sb=n.isNew?`<span class="pol-badge new">${fN?'🆕 Nouvelle maire':'🆕 Nouveau maire'}</span>`:`<span class="pol-badge keep">${fN?'🔄 Réélue':'🔄 Réélu'}</span>`;
      const ts=String(n.elu||'');
      const tb=/1|T1|1er/i.test(ts)?`<span class="pol-badge t1">${fN?'✅ Élue':'✅ Élu'} au 1er tour</span>`:/2|T2|2.me/i.test(ts)?`<span class="pol-badge t2">${fN?'🔄 Élue':'🔄 Élu'} au 2ème tour</span>`:'';
      html+=`<div class="detail-section"><div class="detail-section-title">🏛️ Nouveau maire</div>
        <div class="pol-card ${n.isNew?'new-mayor':'incumbent'}">
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">${sb}${tb}</div>
          <div class="pol-name">${typeof fmtName==='function'?fmtName(n.qualite,n.prenom,n.nom):((n.prenom||'')+' '+(n.nom||'')).trim()}</div>
          ${n.fonction?'<div class="pol-sub">'+n.fonction+'</div>':''}
          <div class="pol-contact">
            ${_pd.mobile?`<a href="tel:${_pd.mobile.replace(/\s/g,'')}">📱 ${_pd.mobile}</a>`:''}
            ${_pd.telephone?`<a href="tel:${_pd.telephone.replace(/\s/g,'')}">📞 ${_pd.telephone}</a>`:''}
            ${_pd.email?`<a href="mailto:${_pd.email}">✉️ ${_pd.email}</a>`:''}
          </div></div>`;

      // Listes municipales 2026
      if(enr.municipales2026&&enr.municipales2026.listes&&enr.municipales2026.listes.length){
        const mun=enr.municipales2026;
        const nc={'LCOM':'#6b7280','LDIV':'#a78bfa','LDVC':'#60a5fa','LDVD':'#f87171','LDVG':'#f472b6','LFI':'#c084fc','LLR':'#3b82f6','LSOC':'#f97316','LUDR':'#06b6d4','LUG':'#4ade80'};
        const lpId='listePanel_'+code;
        const lHtml=mun.listes.slice().sort(function(a,b){return b.voix-a.voix;}).map(function(l){
          const col=nc[l.nuance]||'#d4a843';
          const bdg=l.statut==='Élu 1er tour'?'<span style="background:#22c55e;color:#fff;font-size:9px;padding:1px 5px;border-radius:8px;margin-left:4px">✓ Élu T1</span>':l.statut==='Qualifié T2'?'<span style="background:#f59e0b;color:#fff;font-size:9px;padding:1px 5px;border-radius:8px;margin-left:4px">→ T2</span>':'';
          const srt=l.maireSortant==='Oui'?' <span style="font-size:9px;opacity:.7">(sortant)</span>':'';
          var mHtml='';
          if(l.membres&&l.membres.length){
            var mId='mbr_'+code+'_'+l.nom.replace(/\W/g,'_').slice(0,20);
            var rows=l.membres.map(function(m,mi){
              var tag=m.tete
                ?'<span style="font-size:9px;background:rgba(212,168,67,.2);color:var(--gold);border-radius:4px;padding:1px 5px;margin-left:4px">Tête de liste</span>'
                :'<span style="font-size:9px;color:var(--txt-muted);margin-left:4px">#'+(mi+1)+'</span>';
              return '<div style="display:flex;align-items:center;gap:4px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.04)"><span style="font-size:11px;color:var(--txt)">'+(m.prenom||'')+' <strong>'+(m.nom||'').toUpperCase()+'</strong></span>'+tag+'</div>';
            }).join('');
            var nb=l.membres.length;
            mHtml='<div style="margin-top:4px"><button onclick="(function(b,d){d.style.display=d.style.display===\'none\'?\'block\':\'none\';b.textContent=d.style.display===\'none\'?\'▼ Voir membres ('+nb+')\':\'▲ Masquer\';})(this,document.getElementById(\''+mId+'\'))" style="background:none;border:none;color:var(--txt-muted);font-size:10px;cursor:pointer;font-family:inherit;padding:2px 0">▼ Voir membres ('+nb+')</button><div id="'+mId+'" style="display:none;margin-top:4px;padding:4px 8px;background:rgba(255,255,255,.03);border-radius:6px">'+rows+'</div></div>';
          }
          return '<div style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,.09)"><div style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:11px;font-weight:700;color:'+col+'">'+(l.nuance||'—')+'</span><span style="font-size:12px;font-weight:700">'+(typeof l.pct==='number'?l.pct.toFixed(1):(parseFloat(l.pct)||0).toFixed(1))+'%'+bdg+'</span></div><div style="font-size:12px;font-weight:600;color:var(--txt);margin-top:2px">'+l.nom+'</div><div style="font-size:11px;color:var(--txt-muted);margin-top:1px">👤 '+l.tete.trim()+srt+'</div>'+mHtml+'</div>';
        }).join('');
        html+=`<div style="margin-top:10px"><button onclick="var p=document.getElementById('${lpId}');var o=p.style.display!=='none';p.style.display=o?'none':'block';this.querySelector('.btn-chev').textContent=o?'▼':'▲'" style="background:rgba(212,168,67,.15);border:1.5px solid var(--gold);color:var(--gold);border-radius:7px;padding:6px 14px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;width:100%;display:flex;justify-content:space-between;align-items:center"><span>📋 Listes municipales 2026 (${mun.listes.length} liste${mun.listes.length>1?'s':''})</span><span class="btn-chev">▼</span></button><div id="${lpId}" style="display:none;margin-top:8px;padding:10px;background:var(--surface-2,rgba(255,255,255,.04));border-radius:8px;border:1px solid rgba(255,255,255,.08)"><div style="font-size:10px;color:var(--txt-muted);margin-bottom:8px">Participation : ${mun.participation}% &middot; ${mun.inscrits} inscrits</div>${lHtml}</div></div>`;
      }
      html+=`</div>`;
    }
    // 3. ANCIEN MAIRE
    if(hA){
      const fA=typeof isFem==='function'?isFem(a.qualite):false;
      const ob=a.nonReelu?`<span class="pol-badge out">🔴 ${fA?'Non réélue':'Non réélu'}</span>`:`<span class="pol-badge keep">${fA?'🔄 Réélue':'🔄 Réélu'}</span>`;
      html+=`<div class="detail-section"><div class="detail-section-title">📜 Ancien(ne) maire</div><div class="pol-card ${a.nonReelu?'not-reelect':'incumbent'}"><div style="margin-bottom:6px">${ob}</div><div class="pol-name">${typeof fmtName==='function'?fmtName(a.qualite,a.prenom,a.nom):((a.prenom||'')+' '+(a.nom||'')).trim()}</div></div></div>`;
    }
  }

  // 4. ELECTIONS DEPARTEMENTALES 2021
  if(typeof renderElecSection==='function'){const es=renderElecSection(code);if(es)html+=es;}

  // 5. AGE
  if(enr.age&&Object.keys(enr.age).length){
    html+=`<div class="detail-section"><div class="detail-section-title">👤 Structure par âge</div><div class="age-chart">${renderAgeChart(enr.age)}</div></div>`;
  }

  // 6. CSP
  if(enr.emploi&&Object.keys(enr.emploi).length){
    html+=`<div class="detail-section"><div class="detail-section-title">💼 Emploi / CSP</div><div class="csp-chart">${renderBarChart(enr.emploi,'#60a5fa')}</div></div>`;
  }

  // 7. LOGEMENT
  if(enr.logement&&Object.keys(enr.logement).length){
    html+=`<div class="detail-section"><div class="detail-section-title">🏠 Logement</div><div class="csp-chart">${renderBarChart(enr.logement,'#34d399')}</div></div>`;
  }


  // 8. NOTES PERSONNELLES
  html+=`<div class="detail-section"><div class="detail-section-title">📝 Notes personnelles</div>
    <textarea id="persoNotes" class="briefing-area" placeholder="Vos notes sur cette commune…"
      style="width:100%;min-height:90px;background:var(--surface-2,rgba(255,255,255,.05));border:1px solid var(--border);border-radius:6px;color:var(--txt);padding:8px;font-size:12px;resize:vertical;outline:none;box-sizing:border-box"
      oninput="saveNote('${code}',this.value)">${loadNote(code)}</textarea></div>`;

  // 9. LIENS UTILES
  const mQ=encodeURIComponent('Mairie de '+c.nom+', Oise');
  html+=`<div class="detail-section"><div class="detail-section-title">🔗 Liens utiles</div>
    <div class="detail-links">
      <a class="detail-link" href="https://www.google.com/maps/search/${mQ}" target="_blank"><span class="detail-link-icon">🗺</span>Mairie de ${c.nom} — Google Maps</a>
      <a class="detail-link" href="https://fr.wikipedia.org/wiki/${encodeURIComponent(c.nom)}" target="_blank"><span class="detail-link-icon">📖</span>Wikipedia — ${c.nom}</a>
      <a class="detail-link" href="https://www.insee.fr/fr/statistiques/2011101?geo=COM-${c.code}" target="_blank"><span class="detail-link-icon">📊</span>Fiche statistique INSEE</a>
    </div></div>`;

  document.getElementById('detailBody').innerHTML = html;
  document.getElementById('detailPanel').classList.add('open');
  document.querySelectorAll('#tableBody tr').forEach(tr => {
    tr.classList.toggle('selected', tr.querySelector('.code-badge')?.textContent === code);
  });
  loadNoteInPanel(code);
}


function closeDetail() {
  document.getElementById('detailPanel').classList.remove('open');
  selectedCode = null;
  document.querySelectorAll('#tableBody tr').forEach(tr => tr.classList.remove('selected'));
  // Sur mobile, revenir à la page précédente (canton, carte...) au lieu du menu principal
  if (typeof isMobile === 'function' && isMobile() && typeof _mobPrevPg !== 'undefined' && _mobPrevPg) {
    var prev = _mobPrevPg;
    _mobPrevPg = '';
    if (prev === 'canton') {
      switchTab('canton', document.getElementById('tabBtnCanton'));
      if (_mobPrevCanton) {
        var prevCanton = _mobPrevCanton;
        _mobPrevCanton = '';
        setTimeout(function() {
          var hdr = document.querySelector('.mob-canton-hdr[data-canton="' + prevCanton + '"]');
          if (hdr) {
            var body = hdr.nextElementSibling;
            if (body && body.style.display !== 'block') { body.style.display = 'block'; }
            hdr.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }, 80);
      }
    } else {
      // Retour vue liste (prev='liste' ou autre)
      showFRow();
    }
  } else if (typeof isMobile === 'function' && isMobile()) {
    // _mobPrevPg vide : retour vue liste aussi
    showFRow();
  }
}

function regenBriefing(code) {}

function saveNote(code, val) {
  try { localStorage.setItem('note_' + code, val); } catch(e) {}
}
function loadNote(code) {
  try { return (localStorage.getItem('note_' + code) || '').replace(/</g,'&lt;').replace(/>/g,'&gt;'); } catch(e) { return ''; }
}
function loadNoteInPanel(code) {
  var el = document.getElementById('persoNotes');
  if(el) {
    try { el.value = localStorage.getItem('note_' + code) || ''; } catch(e) {}
  }
}

function renderAgeChart(age){
  const entries=Object.entries(age).filter(([k])=>k!=='_total');
  const total=(age._total||entries.reduce((a,[,v])=>a+v,0))||1;
  const colors=['#60a5fa','#34d399','#f59e0b','#f87171','#c084fc','#fb923c'];
  let html=entries.map(([label,val],i)=>{
    const pct=Math.round(val/total*100);
    const count=val.toLocaleString('fr-FR');
    return`<div class="age-row" style="align-items:center"><span class="age-label">${label}</span><div class="age-bar-wrap"><div class="age-bar-fill" style="width:${pct}%;background:${colors[i%colors.length]}"></div></div><span class="age-pct"><span>${pct}%</span><span style="font-size:9px;opacity:.65;font-weight:400">${count}</span></span></div>`;
  }).join('');
  if(age._total)html+=`<div class="age-row" style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px;opacity:.8"><span class="age-label" style="font-style:italic;font-weight:600">Population totale</span><span class="age-pct" style="font-weight:700;white-space:nowrap">${age._total.toLocaleString('fr-FR')} hab.</span></div>`;
  return html;
}

function renderBarChart(data, baseColor) {
  const vals  = Object.values(data).map(Number).filter(n => !isNaN(n));
  const max   = Math.max(...vals, 1);
  const colors = [baseColor||'#60a5fa','#34d399','#f59e0b','#f87171','#c084fc','#fb923c'];
  return Object.entries(data).map(([label, val], i) => {
    const n   = Number(val) || 0;
    const pct = Math.round(n/max*100);
    return `<div class="csp-row">
      <span class="csp-label">${label}</span>
      <div class="csp-bar-wrap"><div class="csp-bar-fill" style="width:${pct}%;background:${colors[i%colors.length]}"></div></div>
      <span class="csp-pct">${n.toLocaleString('fr-FR')}</span>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════
// CANTON VIEW
// ═══════════════════════════════════════════════════
function renderCantonView() {
  const grid = document.getElementById('cantonGrid');
  const groups = {};
  allCommunes.forEach(c => {
    const key = c.codeCanton || '__none__';
    if(!groups[key]) groups[key]={code:key,nom:c.nomCanton,arr:c.nomArr,communes:[]};
    groups[key].communes.push(c);
  });
  const sorted = Object.values(groups).sort((a,b) => a.nom.localeCompare(b.nom,'fr'));
  grid.innerHTML = sorted.map(canton => {
    const totalPop  = canton.communes.reduce((s,c)=>s+c.population,0);
    const totalSurf = canton.communes.reduce((s,c)=>s+c.surface,0);
    const avgDens   = totalSurf>0?Math.round(totalPop/(totalSurf/100)):0;
    const top5      = canton.communes.slice().sort((a,b)=>b.population-a.population).slice(0,5).map(c=>c.nom).join(', ');
    const synId     = 'pcCantonSyn_'+canton.code;
    return `
    <div class="canton-card" style="cursor:default">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        <div style="flex:1;min-width:0">
          <div class="canton-card-name" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${canton.nom}">${canton.nom}</div>
          <div class="canton-card-code">${canton.code}</div>
        </div>
        <button onclick="filterByCanton('${canton.code}')" class="btn-canton-voir">Voir communes</button>
      </div>
      <div class="canton-stats">
        <div class="canton-stat"><div class="canton-stat-val">${canton.communes.length}</div><div class="canton-stat-lbl">Communes</div></div>
        <div class="canton-stat"><div class="canton-stat-val">${formatPop(totalPop)}</div><div class="canton-stat-lbl">Habitants</div></div>
        <div class="canton-stat"><div class="canton-stat-val">${avgDens}</div><div class="canton-stat-lbl">hab/km²</div></div>
      </div>
      <div class="canton-communes-list" style="margin-bottom:8px; height: 35px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; visibility:${canton.communes.length === 1 && canton.communes[0].nom === canton.nom ? 'hidden' : 'visible'}">${top5}${canton.communes.length>5?'…':''}</div>
      <div style="margin-top:8px"><button onclick="_togglePcCantonSyn('${canton.code}')" class="btn-canton-syn">
        <span>📊 Synthèse du canton</span><span id="chev_${synId}">▼</span>
      </button>
      <div id="${synId}" style="display:none;margin-top:6px"></div></div>
    </div>`;
  }).join('');
}

function _togglePcCantonSyn(cantonCode) {
  var el=document.getElementById('pcCantonSyn_'+cantonCode);
  var chev=document.getElementById('chev_pcCantonSyn_'+cantonCode);
  if (!el) return;
  var open=el.style.display!=='none';
  el.style.display=open?'none':'block';
  if (chev) chev.textContent=open?'▼':'▲';
  if (!open&&!el.dataset.loaded) {
    var communes=(typeof _cantonCommunes==='function')?_cantonCommunes(cantonCode):[];
    el.innerHTML=_renderPcCantonSynHtml(communes);
    el.dataset.loaded='1';
  }
}

function _renderPcCantonSynHtml(communes) {
  var ageAgg=(typeof _aggCantonAge==='function')?_aggCantonAge(communes):null;
  var cspAgg=(typeof _aggCantonCSP==='function')?_aggCantonCSP(communes):null;
  var elec1=(typeof _aggCantonElec==='function')?_aggCantonElec(communes,1):null;
  var elec2=(typeof _aggCantonElec==='function')?_aggCantonElec(communes,2):null;
  var elec1_15=(typeof _aggCantonElec==='function')?_aggCantonElec(communes,1,true):null;
  var elec2_15=(typeof _aggCantonElec==='function')?_aggCantonElec(communes,2,true):null;

  let pPT = 0, pAA = 0, pAE = 0;
  communes.forEach(c => {
    const enr = enrichedData[c.code] || {};
    if(enr.passPermis) { pPT += enr.passPermis.total || 0; }
    if(enr.passAvenir) { pAA += enr.passAvenir.acceptes || 0; pAE += enr.passAvenir.enregistrements || 0; }
  });

  var noData='<div style="font-size:10px;color:var(--txt-muted);padding:4px 0;font-style:italic">Importez les données pour afficher.</div>';
  var g='<div style="display:grid;grid-template-columns:1fr;gap:8px;margin-top:4px">';
  g+='<div class="mob-csyn-block"><div class="mob-csyn-block-title">👤 Âge</div>'
    +(ageAgg&&typeof _renderAgeBlock==='function'?_renderAgeBlock(ageAgg,'mob-csyn'):noData)+'</div>';
  g+='<div class="mob-csyn-block"><div class="mob-csyn-block-title">👔 CSP</div>'
    +(cspAgg&&typeof _renderCSPBlock==='function'?_renderCSPBlock(cspAgg,'mob-csyn'):noData)+'</div>';
  
  if (pPT > 0 || pAA > 0) {
     g+=`<div class="mob-csyn-block" style="grid-column: 1 / -1;"><div class="mob-csyn-block-title">✨ Dispositifs Citoyens (Canton)</div>
       <div style="display:flex; flex-direction:column; gap: 8px; padding: 5px;">
         ${pPT > 0 ? `<div style="text-align:center; display:flex; flex-direction:column; justify-content:center"><div style="font-size:11px;color:var(--txt-muted)">🚗 Pass Permis</div><div style="font-weight:bold">${pPT} pass</div></div>` : ''}
         ${(pAE > 0 || pAA > 0) ? `<div style="text-align:center; display:flex; flex-direction:column; justify-content:center; gap:8px">
           ${pAE > 0 ? `<div><div style="font-size:11px;color:var(--txt-muted)">🎓 Pass Avenir (Enregistrés)</div><div style="font-weight:bold">${pAE}</div></div>` : ''}
           ${pAA > 0 ? `<div><div style="font-size:11px;color:var(--txt-muted)">🎓 Pass Avenir (Acceptés)</div><div style="font-weight:bold">${pAA}</div></div>` : ''}
         </div>` : ''}
       </div>
     </div>`;
  }

  if (elec1_15&&typeof _renderElecBlock==='function')
    g+='<div class="mob-csyn-block"><div class="mob-csyn-block-title">🗳️ Dép. 2015 — T1</div>'+_renderElecBlock(elec1_15,1,'mob-csyn')+'</div>';
  if (elec2_15&&typeof _renderElecBlock==='function')
    g+='<div class="mob-csyn-block"><div class="mob-csyn-block-title">🗳️ Dép. 2015 — T2</div>'+_renderElecBlock(elec2_15,2,'mob-csyn')+'</div>';
  if (elec1&&typeof _renderElecBlock==='function')
    g+='<div class="mob-csyn-block"><div class="mob-csyn-block-title">🗳️ Dép. 2021 — T1</div>'+_renderElecBlock(elec1,1,'mob-csyn')+'</div>';
  if (elec2&&typeof _renderElecBlock==='function')
    g+='<div class="mob-csyn-block"><div class="mob-csyn-block-title">🗳️ Dép. 2021 — T2</div>'+_renderElecBlock(elec2,2,'mob-csyn')+'</div>';
  if (!elec1&&!elec2&&!elec1_15&&!elec2_15)
    g+='<div class="mob-csyn-block"><div class="mob-csyn-block-title">🗳️ Élec. départ.</div>'+noData+'</div>';
  g+='</div>';
  return g;
}

function filterByCanton(code) {
  document.getElementById('filterCanton').value = code;
  applyFilters();
  switchTab('table', document.getElementById('tabBtnTable'));
}

// ═══════════════════════════════════════════════════
// MAP
// ═══════════════════════════════════════════════════
function initMap() {
  if(mapInstance){
    if(typeof _hidePopCard==='function')_hidePopCard();
    updateMapMarkers();
    if(!document.getElementById('pcCalquesBtn'))initCalquesControl();
    return;
  }
  const isDark = document.documentElement.dataset.theme === 'dark';
  mapInstance = L.map('mapContainer', {preferCanvas: true}).setView([49.38, 2.50], 9);
  window.mapInstance = mapInstance;
  const tileUrl = isDark
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
  L.tileLayer(tileUrl, {attribution:'© OpenStreetMap contributors © CARTO', subdomains:'abcd', maxZoom:19}).addTo(mapInstance);
  pcMarkersLayer = L.layerGroup().addTo(mapInstance);
  if(typeof _hidePopCard==='function')_hidePopCard();
  updateMapMarkers();
  initCalquesControl();
  mapInstance.getContainer().addEventListener('mouseleave',function(){
    var tip=document.getElementById('pcHoverTip');if(tip)tip.style.display='none';
  });
}


// ═══════════════════════════════════════════════════════════════
// BUREAUX DE VOTE
// ═══════════════════════════════════════════════════════════════
/* ancien système BV marqueurs — remplacé par polygones GeoJSON */
var bvMarkersPC  = [];
var bvMarkersMob = [];
function clearBVMarkers() {}


var _polyOpacity = 0.82;
function setPolygonOpacity(val) {
  _polyOpacity = val;
  if (mapInstance) {
    if (pcMarkersLayer) {
      pcMarkersLayer.eachLayer(function(lyr) {
        if (lyr.setStyle) lyr.setStyle({ fillOpacity: val });
      });
    }
    mapMarkers.forEach(function(lyr) {
      if (lyr.setStyle) lyr.setStyle({ fillOpacity: val });
    });
    // Bureaux de vote PC
    if (window._bvLayers && window._bvLayers.pc) {
      window._bvLayers.pc.eachLayer(function(lyr) {
        if (lyr.setStyle) lyr.setStyle({ fillOpacity: val });
      });
    }
  }
  if (typeof mobMarkersLayer !== 'undefined' && mobMarkersLayer) {
    mobMarkersLayer.eachLayer(function(lyr) {
      if (lyr.setStyle) lyr.setStyle({ fillOpacity: val });
      if (lyr.eachLayer) lyr.eachLayer(function(sub) {
        if (sub.setStyle) sub.setStyle({ fillOpacity: val });
      });
    });
  }
  // Bureaux de vote Mobile
  if (window._bvLayers && window._bvLayers.mob) {
    window._bvLayers.mob.eachLayer(function(lyr) {
      if (lyr.setStyle) lyr.setStyle({ fillOpacity: val });
      if (lyr.eachLayer) lyr.eachLayer(function(sub) {
        if (sub.setStyle) sub.setStyle({ fillOpacity: val });
      });
    });
  }
}
function updateMapMarkers(){
  if(!mapInstance)return;
  // Suppression robuste : clearLayers() sur le groupe dédié garantit
  // que toutes les couches (y compris canvas) sont retirées avant redessinage
  if(pcMarkersLayer){pcMarkersLayer.clearLayers();}else{pcMarkersLayer=L.layerGroup().addTo(mapInstance);}
  mapMarkers=[];
  const isDark = document.documentElement.dataset.theme === 'dark';
  const strokeCol = isDark ? '#0d2340' : '#ffffff';
  const isBV = pcMapMode && (pcMapMode.startsWith('bv-') || pcMapMode.startsWith('bveleclegis-'));
  filteredCommunes.forEach(c=>{
    const s=getMarkerStyle(c,pcMapMode||'pop');
    const opa=isBV?0:(_polyOpacity!==undefined?_polyOpacity:s.op); // Do not render if isBV

    if(isBV) return; // Hide commune completely in BV mode

    if(c.contour){
      const lyr=L.geoJSON({type:'Feature',geometry:c.contour},{
        style:{fillColor:s.fill,fillOpacity:opa,color:strokeCol,weight:0.6,opacity:0.5},
        interactive:!isBV
      });
      if(!isBV){
        lyr.on('click',()=>openDetail(c.code));
        lyr.on('mouseover',function(e){
          this.setStyle({fillOpacity:Math.min(opa*1.25,1),weight:1.8});
          var tip=document.getElementById('pcHoverTip');
          if(tip){tip.innerHTML=buildPopup(c,pcMapMode||'pop');tip.style.display='block';
            tip.style.left=(e.originalEvent.clientX+14)+'px';
            tip.style.top=(e.originalEvent.clientY-10)+'px';}
        });
        lyr.on('mousemove',function(e){
          var tip=document.getElementById('pcHoverTip');
          if(tip&&tip.style.display!=='none'){
            var x=e.originalEvent.clientX+14,y=e.originalEvent.clientY-10;
            if(x+tip.offsetWidth>window.innerWidth-10) x=e.originalEvent.clientX-tip.offsetWidth-10;
            if(y+tip.offsetHeight>window.innerHeight-10) y=e.originalEvent.clientY-tip.offsetHeight-10;
            tip.style.left=x+'px';tip.style.top=y+'px';}
        });
        lyr.on('mouseout',function(){
          this.setStyle({fillOpacity:opa,weight:.6});
          var tip=document.getElementById('pcHoverTip');if(tip)tip.style.display='none';
        });
      }
      lyr.addTo(pcMarkersLayer);mapMarkers.push(lyr);
    } else if(c.centre?.coordinates){
      const[lng,lat]=c.centre.coordinates;
      const mk=L.circleMarker([lat,lng],{radius:s.r,color:s.fill,fillColor:s.fill,fillOpacity:opa,weight:1,interactive:!isBV});
      if(!isBV){
        mk.on('click',()=>openDetail(c.code));
        mk.on('mouseover',function(e){
          this.setStyle({fillOpacity:1,radius:s.r+2});
          var tip=document.getElementById('pcHoverTip');
          if(tip){tip.innerHTML=buildPopup(c,pcMapMode||'pop');tip.style.display='block';
            tip.style.left=(e.originalEvent.clientX+14)+'px';
            tip.style.top=(e.originalEvent.clientY-10)+'px';}
        });
        mk.on('mousemove',function(e){
          var tip=document.getElementById('pcHoverTip');
          if(tip&&tip.style.display!=='none'){
            var x=e.originalEvent.clientX+14,y=e.originalEvent.clientY-10;
            if(x+tip.offsetWidth>window.innerWidth-10) x=e.originalEvent.clientX-tip.offsetWidth-10;
            tip.style.left=x+'px';tip.style.top=y+'px';}
        });
        mk.on('mouseout',function(){
          this.setStyle({fillOpacity:opa,radius:s.r});
          var tip=document.getElementById('pcHoverTip');if(tip)tip.style.display='none';
        });
      }
      mk.addTo(pcMarkersLayer);mapMarkers.push(mk);
    }
  });
  updateMapLegend(pcMapMode||'pop','pcMapLegend');
  if(!isBV){
    if(typeof cantonOverlayActive!=='undefined'&&cantonOverlayActive)setTimeout(drawCantonOverlay,0);
    if(typeof chefLieuActive!=='undefined'&&chefLieuActive)setTimeout(drawChefLieu,0);
    if(window.arrOverlayActive)setTimeout(window.drawArrOverlay,0);
  }
}

// ═══════════════════════════════════════════════════
// TABS
// ═══════════════════════════════════════════════════

/* ══ NAVIGATION MOBILE ══ */
let _mobPg = '';
let _mobPrevPg = '';
let _mobPrevCanton = '';

function showFRow() {
  var fr = document.getElementById('mobFRow');
  if(!fr) return;
  fr.style.removeProperty('display');
  fr.classList.add('mob-frow-visible');
  _fixSpacer();
}
function hideFRow() {
  var fr = document.getElementById('mobFRow');
  if(!fr) return;
  fr.classList.remove('mob-frow-visible');
  fr.style.display = 'none';
}
function _fixSpacer() { if(typeof updateFixedBars === 'function') updateFixedBars(); }

function mobGoHome() {
  switchTab('table', document.getElementById('tabBtnTable'));
}





function renderMobCanton(filter) {
  const cv = document.getElementById('mobCantonList');
  if(!cv || !allCommunes || !allCommunes.length) return;
  const cmap = new Map();
  allCommunes.forEach(function(c) {
    var key = c.codeCanton || c.canton || '—';
    var nom = c.nomCanton || c.canton || '—';
    if(!cmap.has(key)) cmap.set(key, {nom: nom, communes: []});
    cmap.get(key).communes.push(c);
  });
  var q = (filter || '').toLowerCase().trim();
  var sorted = Array.from(cmap.entries()).sort(function(a,b){ return (a[1].nom||'').localeCompare(b[1].nom||'','fr'); });
  if(q) sorted = sorted.filter(function(e){
    var g = e[1];
    return (g.nom||'').toLowerCase().includes(q) || g.communes.some(function(c){ return (c.nom||'').toLowerCase().includes(q); });
  });
  var html = sorted.map(function(e){
    var grp = e[1];
    var total = grp.communes.reduce(function(s,c){ return s+(c.population||0); }, 0);
    var items = grp.communes.slice().sort(function(a,b){ return (b.population||0)-(a.population||0); }).map(function(c){
      return '<div class="mob-canton-item" data-code="'+c.code+'" data-canton="'+e[0]+'" style="display:flex;justify-content:space-between;align-items:center;padding:8px 16px;border-bottom:1px solid rgba(255,255,255,.05);cursor:pointer">'
        +'<span style="font-size:12px">'+c.nom+'</span>'
        +'<span style="font-size:11px;color:var(--txt-muted)">'+(c.population||0).toLocaleString('fr-FR')+'</span>'
        +'</div>';
    }).join('');
    return '<div style="margin-bottom:6px;background:var(--surface);border-radius:8px;overflow:hidden;border:1px solid var(--border)">'
      +'<div class="mob-canton-hdr" data-canton="'+e[0]+'" style="display:flex;justify-content:space-between;align-items:center;padding:11px 14px;cursor:pointer">'
      +'<span style="font-size:13px;font-weight:700;color:var(--gold)">🗂 '+grp.nom+'</span>'
      +'<span style="font-size:10px;color:var(--txt-muted)">'+grp.communes.length+' com. · '+total.toLocaleString('fr-FR')+' hab.</span>'
      +'</div>'
      +'<div class="mob-canton-body" data-canton-code="'+e[0]+'" style="display:none">'
      +'<div class="mob-canton-synt" data-canton-code="'+e[0]+'"></div>'
      +items
      +'</div>'
      +'</div>';
  }).join('');
  // Dossier "Oise" global tout en haut
  var oiseTotPop = allCommunes.reduce(function(s,c){return s+(c.population||0);},0);
  var oiseNbCom  = allCommunes.length;
  var oiseHdr = '<div class="mob-oise-hdr" id="mobOiseHdr">'
    +'<div>'
    +'<div class="mob-oise-hdr-lbl">📁 Oise</div>'
    +'<div class="mob-oise-hdr-sub">'+oiseNbCom+' communes · '+oiseTotPop.toLocaleString('fr-FR')+' hab.</div>'
    +'</div>'
    +'<span style="font-size:18px;color:var(--gold,.#D4A843)" id="mobOiseChevron">▶</span>'
    +'</div>'
    +'<div class="mob-oise-body" id="mobOiseBody">'
    +'<div id="mobOiseSynt" style="padding:0 0 4px 0"></div>'
    +'</div>';
  cv.innerHTML = oiseHdr + html;
  // Clic accordéon → ouvrir/fermer + injecter synthèse cantonale
  cv.querySelectorAll('.mob-canton-hdr').forEach(function(hdr){
    hdr.addEventListener('click', function(){
      var d = hdr.nextElementSibling;
      var isOpen = d.style.display === 'block';
      d.style.display = isOpen ? 'none' : 'block';
      if(!isOpen) {
        // Injecter la synthèse si pas encore fait
        var synSlot = d.querySelector('.mob-canton-synt');
        if(synSlot && !synSlot.dataset.loaded) {
          var cc = d.dataset.cantonCode || hdr.dataset.canton;
          if(typeof _mobCantonSummaryHtml === 'function') synSlot.innerHTML = _mobCantonSummaryHtml(cc);
          synSlot.dataset.loaded = '1';
        }
      }
    });
  });
  // Clic dossier Oise global
  var mobOiseHdr2 = document.getElementById('mobOiseHdr');
  if(mobOiseHdr2) {
    mobOiseHdr2.addEventListener('click', function(){
      var body   = document.getElementById('mobOiseBody');
      var chev   = document.getElementById('mobOiseChevron');
      var synDiv = document.getElementById('mobOiseSynt');
      var isOpen = body && body.style.display === 'block';
      if(body)  body.style.display  = isOpen ? 'none' : 'block';
      if(chev)  chev.textContent    = isOpen ? '▶' : '▼';
      if(!isOpen && synDiv && !synDiv.dataset.loaded) {
        synDiv.innerHTML = '<div class="mob-csyn">' + _renderPcCantonSynHtml(allCommunes) + '</div>';
        synDiv.dataset.loaded = '1';
      }
    });
  }

  // Clic commune
  cv.querySelectorAll('.mob-canton-item').forEach(function(item){
    item.addEventListener('touchstart', function(){ item.style.background='rgba(212,168,67,.08)'; }, {passive:true});
    item.addEventListener('touchend',   function(){ item.style.background=''; }, {passive:true});
    item.addEventListener('click', function(){ _mobPrevPg = _mobPg; _mobPrevCanton = item.dataset.canton || ''; mobGoHome(); openDetail(item.dataset.code); });
  });
  if(q){ var inp=document.getElementById('cantonSearchInput'); if(inp){inp.focus();inp.setSelectionRange(inp.value.length,inp.value.length);} }
}




function switchTab(tab, el) {
  currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  if(el) el.classList.add('active');
  
  document.getElementById('tabTable').style.display  = tab === 'table'  ? '' : 'none';
  if (tab === 'table' && isMobile()) {
     document.getElementById('mobileList').style.display = 'block';
  } else if (isMobile()) {
     document.getElementById('mobileList').style.display = 'none';
  }
  
  if (isMobile()) {
     const _isTable = (tab === 'table');
     const msb = document.getElementById('mobileSearchBar');
     if(msb) msb.style.setProperty('display', _isTable ? 'flex' : 'none', 'important');
     
     
     const mf = document.querySelectorAll('.mob-frow');
     mf.forEach(el => el.style.setProperty('display', _isTable ? 'flex' : 'none', 'important'));
     const ib = document.getElementById('mobImportBand');
     if(ib) ib.style.setProperty('display', _isTable ? '' : 'none', 'important');
  }

  document.getElementById('tabCanton').style.display = tab === 'canton' ? '' : 'none';
  document.getElementById('tabMap').style.display    = tab === 'map'    ? '' : 'none';
  document.getElementById('tabAnalyse').style.display = tab === 'analyse' ? '' : 'none';
  document.getElementById('tabAac').style.display = tab === 'aac' ? '' : 'none';
  if (document.getElementById('tabOverlay')) document.getElementById('tabOverlay').style.display = tab === 'overlay' ? 'flex' : 'none';
  if (document.getElementById('tabFlyer')) document.getElementById('tabFlyer').style.display = tab === 'flyer' ? 'block' : 'none';
  if(tab === 'canton') renderCantonView();
  if (typeof updateFixedBars === 'function') setTimeout(updateFixedBars, 50);
  if(tab === 'map') {
    if(window.mapInstance) setTimeout(()=>window.mapInstance.invalidateSize(), 50);
  }
  if(tab === 'analyse') {
    if(typeof renderAnalyseHome === 'function') setTimeout(renderAnalyseHome, 50);
    if(typeof renderGlobalCorrelations === 'function') setTimeout(renderGlobalCorrelations, 150);
  }
  if(tab === 'aac') {
    if(typeof renderAacTab === 'function') setTimeout(renderAacTab, 50);
  }
  if(tab === 'flyer') {
    if(typeof initFlyerGenerator === 'function') {
      const flyerData = {};
      allCommunes.forEach(c => {
        flyerData[c.code] = Object.assign({
          nom: c.nom,
          canton: c.nomCanton || c.canton,
          population: c.population,
          elec2021t1: window.elecDataT1 ? window.elecDataT1[c.code] : null,
          elec2021t2: window.elecDataT2 ? window.elecDataT2[c.code] : null,
          elec2015t1: window.elec15DataT1 ? window.elec15DataT1[c.code] : null,
          elec2015t2: window.elec15DataT2 ? window.elec15DataT2[c.code] : null,
          elec2024t1: window.LEGIS2024T1 ? window.LEGIS2024T1[c.code] : null,
          elec2024t2: window.LEGIS2024T2 ? window.LEGIS2024T2[c.code] : null,
        }, enrichedData[c.code] || {});
      });
      setTimeout(() => initFlyerGenerator(flyerData), 50);
    }
  }
  if(tab === 'overlay') {
    if(window.OverlayTab && typeof window.OverlayTab.initOverlayTab === 'function') setTimeout(() => {
      window.OverlayTab.initOverlayTab();
      if(window.OverlayMap) window.OverlayMap.invalidateSize();
    }, 50);
  }
  if(tab === 'map'){
    setTimeout(() => {
      initMap();
      mapInstance?.invalidateSize();
      if(pcMapMode==='bv-winner-t1' || pcMapMode==='bv-winner-t2') {
         if(typeof window.bvShowPolygons==='function') window.bvShowPolygons(pcMapMode, 'pc');
      } else {
         if(typeof window.bvHidePolygons==='function') window.bvHidePolygons('pc');
      }
    }, 60);
    // Second passage après chargement async éventuel du GeoJSON BV
    setTimeout(() => {
      if(pcMapMode==='bv-winner-t1' || pcMapMode==='bv-winner-t2') {
         if(typeof window.bvShowPolygons==='function') window.bvShowPolygons(pcMapMode, 'pc');
      } else {
         if(typeof window.bvHidePolygons==='function') window.bvHidePolygons('pc');
      }
    }, 800);
  }
}

// ═══════════════════════════════════════════════════
// IMPORT
// ═══════════════════════════════════════════════════
function openImportModal()  { document.getElementById('importModal').classList.add('open'); }
function closeImportModal() { document.getElementById('importModal').classList.remove('open'); }

document.addEventListener('DOMContentLoaded', () => {
window.addEventListener('resize',()=>{if(window.innerWidth<=768)_fixSpacer();});
  const dz = document.getElementById('dropZone');
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', e => {
    e.preventDefault();
    dz.classList.remove('dragover');
    if(e.dataTransfer.files[0]) autoDetectFile(e.dataTransfer.files[0]);
  });
});

function handleFileImport(event) {
  if(event.target.files[0]) processCSVFile(event.target.files[0]);
}


function processCSVFile(file) {
  const status = document.getElementById('inseeImportStatus');
  if(!status) return;
  const prevHtml = status.dataset.loaded || '';
  status.innerHTML = prevHtml ? prevHtml + '<br>⏳ Lecture…' : '⏳ Lecture…';

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const text    = e.target.result;
      const sep     = text.indexOf('\t') !== -1 ? '\t' : (text.indexOf(';') !== -1 ? ';' : ',');
      // Retirer BOM et CR
      const cleaned = text.replace(/^\uFEFF/,'').replace(/\r/g,'');

      // Extraire headers depuis la première ligne
      const firstNL = cleaned.indexOf('\n');
      const headerLine = firstNL !== -1 ? cleaned.substring(0, firstNL) : cleaned;
      const headers = headerLine.split(sep).map(h => h.trim().replace(/"/g,'').toUpperCase());

      const codeIdx = headers.indexOf('CODGEO') !== -1 ? headers.indexOf('CODGEO') : headers.indexOf('COM');
      if(codeIdx === -1) {
        status.innerHTML = prevHtml ? prevHtml + '<br>❌ Colonne CODGEO ou COM introuvable.' : '❌ Colonne CODGEO ou COM introuvable.';
        return;
      }

      // Détecter fichier IRIS (col IRIS + COM → agréger par commune)
      const isIrisFile = headers.indexOf('IRIS') !== -1 && headers.indexOf('COM') !== -1;

      // Détecter les types de données présents
      const hasAge  = headers.some(h => /POP0014/.test(h));
      const hasCSP  = headers.some(h => /_CS1/.test(h));
      const hasLog  = headers.some(h => /P\d+_LOG/.test(h));
      
      // Traitement par lots asynchrones pour ne pas bloquer le navigateur
      const body = cleaned.substring(firstNL + 1);
      const lines = body.split('\n');
      const irisAcc = {};
      const BATCH = 2000;
      let idx = 0;
      let count = 0;

      function processBatch() {
        const end = Math.min(idx + BATCH, lines.length);
        for(let i = idx; i < end; i++) {
          const line = lines[i];
          if(!line) continue;
          const cols = line.split(sep);
          if(cols.length <= codeIdx) continue;
          const code = cols[codeIdx].trim().replace(/"/g,'');
          if(!code || !code.startsWith('60')) continue;

          if(isIrisFile) {
            if(!irisAcc[code]) { irisAcc[code] = {}; irisAcc[code].__count = 0; }
            irisAcc[code].__count++;
            for(let j = 0; j < headers.length && j < cols.length; j++) {
              const h = headers[j];
              const v = parseFloat(cols[j]);
              if(!isNaN(v)) {
                irisAcc[code][h] = (irisAcc[code][h] || 0) + v;
              } else if(irisAcc[code][h] === undefined) {
                irisAcc[code][h] = cols[j].trim().replace(/"/g,'');
              }
            }
          } else {
            if(!enrichedData[code]) enrichedData[code] = {};
            const row = {};
            headers.forEach((h,j) => { row[h] = cols[j] ? cols[j].trim().replace(/"/g,'') : ''; });
            if(hasAge)  { enrichedData[code].age      = extractAgeData(row); }
            if(hasCSP)  { enrichedData[code].emploi   = extractEmploiData(row); }
            if(hasLog)  { enrichedData[code].logement = extractLogData(row); }
            count++;
          }
        }
        idx = end;

        if(idx < lines.length) {
          // Afficher la progression
          const pct = Math.round(idx / lines.length * 100);
          status.innerHTML = prevHtml ? prevHtml + `<br>⏳ Traitement… ${pct}%` : `⏳ Traitement… ${pct}%`;
          setTimeout(processBatch, 0); // libérer le thread UI
        } else {
          // Finaliser fichier IRIS
          if(isIrisFile) {
            Object.keys(irisAcc).forEach(code => {
              if(!enrichedData[code]) enrichedData[code] = {};
              const row = irisAcc[code];
              const cnt = row.__count || 1;
              // Moyenner les colonnes DISP_ (médiane, quartiles) — ne pas additionner
              const rowAvg = Object.assign({}, row);
              Object.keys(rowAvg).forEach(function(h){
                if(/^DISP_/.test(h) && typeof rowAvg[h] === 'number') rowAvg[h] = rowAvg[h] / cnt;
              });
              if(hasAge) { enrichedData[code].age      = extractAgeData(row); }
              if(hasCSP) { enrichedData[code].emploi   = extractEmploiData(row); }
              if(hasLog) { enrichedData[code].logement = extractLogData(row); }
            });
            count = Object.keys(irisAcc).length;
          console.log('[Atlas] Fichier IRIS chargé. Colonnes:', headers.slice(0,10).join(', '),'...');
          var sampleCode = Object.keys(irisAcc)[0];
          if(sampleCode) console.log('[Atlas] Exemple', sampleCode, ':', JSON.stringify(Object.fromEntries(Object.entries(irisAcc[sampleCode]).filter(function(e){return /DISP_/.test(e[0]);}).slice(0,5))));
          }
          // Rafraîchir
          if(typeof _clearQtCache!=='undefined') _clearQtCache();
          if(typeof updateMapMarkers!=='undefined' && typeof mapInstance!=='undefined' && mapInstance) if(typeof _hidePopCard==='function')_hidePopCard();
      updateMapMarkers();
          if(typeof refreshMobMapMarkers!=='undefined' && typeof mobMapDone!=='undefined' && mobMapDone) if(typeof _hidePopCard==='function')_hidePopCard();
      refreshMobMapMarkers();
          if(typeof selectedCode!=='undefined' && selectedCode && typeof openDetail!=='undefined') openDetail(selectedCode);
          // Statut final
          document.getElementById('enrichStatus').textContent = '● Données enrichies';
          document.getElementById('enrichStatus').className   = 'btn btn-outline btn-sm status-enriched-btn';
          
          let newLoaded = prevHtml;
          if (hasAge && !newLoaded.includes('Structure population')) newLoaded += (newLoaded ? '<br>' : '') + '📊 Structure population';
          if (hasCSP && !newLoaded.includes('CSP')) newLoaded += (newLoaded ? '<br>' : '') + '💼 CSP';
          if (hasLog && !newLoaded.includes('Logement')) newLoaded += (newLoaded ? '<br>' : '') + '🏠 Logement';
          
          if (!hasAge && !hasCSP && !hasLog && !newLoaded.includes('Données statistiques')) {
             newLoaded += (newLoaded ? '<br>' : '') + '✔️ Données statistiques';
          }
          
          status.dataset.loaded = newLoaded;
          status.innerHTML = newLoaded;
        }
      }

      processBatch();

    } catch(err) {
      status.innerHTML = prevHtml ? prevHtml + `<br>❌ Erreur : ${err.message}` : `❌ Erreur : ${err.message}`;
      console.error('processCSVFile error:', err);
    }
  };
  reader.readAsText(file, 'UTF-8');
}


function extractAgeData(row){
  const g=(k1,k2)=>inseeI(cval(row,k1,k2));
  const pop=inseeI(cval(row,'P20_POP','P16_POP'))||0;
  return{'0–14 ans':g('P20_POP0014','P16_POP0014'),'15–29 ans':g('P20_POP1529','P16_POP1529'),
    '30–44 ans':g('P20_POP3044','P16_POP3044'),'45–59 ans':g('P20_POP4559','P16_POP4559'),
    '60–74 ans':g('P20_POP6074','P16_POP6074'),'75 ans +':g('P20_POP75P','P16_POP75P'),'_total':pop};}

function inseeN(v){if(!v||['s','nd','n.d.','nc','-',''].includes(String(v).trim()))return null;return parseFloat(String(v).trim().replace(/\s/g,'').replace(',','.'));}
function inseeI(v){const n=inseeN(v);return n===null?0:Math.round(n);}
function inseeE(v){const n=inseeN(v);return n===null?'—':Math.round(n).toLocaleString('fr-FR')+' €';}
function inseeP(v){const n=inseeN(v);return n===null?'—':n.toFixed(1)+'%';}
function cval(row,...keys){for(const k of keys){const v=row[k]??row[k.toUpperCase()]??row[k.toLowerCase()];if(v!==undefined&&v!==null&&String(v).trim()!=='')return v;}return null;}
function extractEmploiData(row){const cs=i=>cval(row,'C20_ACTOCC1564_CS'+i,'C20_ACT1564_CS'+i,'C14_ACTOCC1564_CS'+i,'C14_ACT1564_CS'+i,'C09_ACTOCC1564_CS'+i,'C09_ACT1564_CS'+i,'P20_ACTOCC_CS'+i,'P20_CS'+i,'C20_POP15P_CS'+i);return{'Agriculteurs':inseeI(cs(1)),'Artisans/Comm.':inseeI(cs(2)),'Cadres':inseeI(cs(3)),'Prof. interm.':inseeI(cs(4)),'Employés':inseeI(cs(5)),'Ouvriers':inseeI(cs(6))};}

function extractLogData(row){
  return{'Logements total':inseeI(cval(row,'P20_LOG','P16_LOG'))||1,
    'Rés. principales':inseeI(cval(row,'P20_RP','P16_RP')),
    'Logts vacants':inseeI(cval(row,'P20_LOGVAC','P16_LOGVAC')),
    'Propriétaires':inseeI(cval(row,'P20_RP_PROP','P16_RP_PROP')),
    'Locataires':inseeI(cval(row,'P20_RP_LOC','P16_RP_LOC')),
    'Maisons':inseeI(cval(row,'P20_MAISON','P16_MAISON')),
    'Appartements':inseeI(cval(row,'P20_APPART','P16_APPART')),
    'Rés. secondaires':inseeI(cval(row,'P20_RSECOCC','P16_RSECOCC'))};}


// ═══════════════════════════════════════════════════
// EXPORT CSV
// ═══════════════════════════════════════════════════
function exportCSV() {
  const headers = 'Commune,Code INSEE,Code postal,Code canton,Canton,Code circo.,Circonscription,Population,Surface (km²),Densité (hab/km²)';
  const rows = filteredCommunes.map(c => [
    `"${c.nom}"`, c.code, c.codePostal, c.codeCanton, `"${c.nomCanton}"`,
    c.codeCirconscription, `"${c.nomCirconscription}"`, c.population, c.surfaceKm2.toFixed(2), c.density
  ].join(','));
  const csv = [headers, ...rows].join('\n');
  const blob = new Blob(['\uFEFF'+csv], {type:'text/csv;charset=utf-8'});
  const a = Object.assign(document.createElement('a'), {href:URL.createObjectURL(blob), download:'communes-oise-60.csv'});
  a.click(); URL.revokeObjectURL(a.href);
}

// ═══════════════════════════════════════════════════
// EXPORT CARTE SVG
// ═══════════════════════════════════════════════════

function exportMapSVG() {
  var tabMap = document.getElementById('tabMap');
  if (!tabMap || tabMap.style.display === 'none') {
    switchTab('map', document.getElementById('tabBtnMap'));
    setTimeout(exportMapSVG, 700);
    return;
  }
  if (!mapInstance) { alert("La carte n'est pas encore chargee."); return; }
  var mapEl = document.getElementById('mapContainer');
  if (!mapEl.offsetWidth || !mapEl.offsetHeight) {
    mapInstance.invalidateSize();
    setTimeout(exportMapSVG, 400);
    return;
  }

  var dark = document.documentElement.dataset.theme === 'dark';
  var mode = pcMapMode || 'pop';

  // ── Mise en page A4 paysage (mm) ──
  var PAGE_W = 297, PAGE_H = 210;
  var MARGIN = 7, HEADER_H = 13;
  var LEG_W = 52, LEG_ITEM_H = 6.5, LEG_PAD = 3.5;

  // ── Bbox des communes ──
  var allPts = [];
  allCommunes.forEach(function(c) {
    if (!c.contour) { return; }
    var rings = c.contour.type === 'Polygon' ? c.contour.coordinates
              : [].concat.apply([], c.contour.coordinates);
    rings.forEach(function(ring) {
      ring.forEach(function(pt) {
        var p = mapInstance.latLngToContainerPoint(L.latLng(pt[1], pt[0]));
        if (isFinite(p.x) && isFinite(p.y)) { allPts.push(p); }
      });
    });
  });
  if (!allPts.length) { alert('Aucune commune visible.'); return; }
  var bx0 = allPts.reduce(function(m,p){ return Math.min(m,p.x); }, Infinity);
  var bx1 = allPts.reduce(function(m,p){ return Math.max(m,p.x); }, -Infinity);
  var by0 = allPts.reduce(function(m,p){ return Math.min(m,p.y); }, Infinity);
  var by1 = allPts.reduce(function(m,p){ return Math.max(m,p.y); }, -Infinity);

  // ── Zone carte (après la zone légende à gauche) ──
  // On réserve 2 légendes potentielles côte à côte à gauche
  var LEG_GAP = 3;
  var LEG_ZONE_W = MARGIN + LEG_W + LEG_GAP + LEG_W + LEG_GAP;
  var mapX0 = LEG_ZONE_W;
  var mapX1 = PAGE_W - MARGIN;
  var mapY0 = MARGIN + HEADER_H;
  var mapY1 = PAGE_H - MARGIN;
  var mapW = mapX1 - mapX0, mapH = mapY1 - mapY0;

  var sc   = Math.min(mapW / (bx1 - bx0), mapH / (by1 - by0)) * 0.97;
  var offX = mapX0 + (mapW - (bx1 - bx0) * sc) / 2 - bx0 * sc;
  var offY = mapY0 + (mapH - (by1 - by0) * sc) / 2 - by0 * sc;

  function projXY(lon, lat) {
    var p = mapInstance.latLngToContainerPoint(L.latLng(lat, lon));
    return { x: (p.x * sc + offX).toFixed(2), y: (p.y * sc + offY).toFixed(2) };
  }
  function projLL(latlng) {
    var p = mapInstance.latLngToContainerPoint(latlng);
    return { x: (p.x * sc + offX).toFixed(2), y: (p.y * sc + offY).toFixed(2) };
  }
  function xmlEsc(s) {
    return String(s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; });
  }
  function parseCssColor(s) {
    var hex = (s||'').match(/#[0-9a-fA-F]{3,6}/);
    if (hex) { return hex[0]; }
    var rgb = (s||'').match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (rgb) {
      return '#' + [rgb[1],rgb[2],rgb[3]].map(function(v){
        return ('0'+parseInt(v).toString(16)).slice(-2);
      }).join('');
    }
    return '#aaaaaa';
  }
  function geomToPath(geom) {
    var rings = [];
    if (geom.type === 'Polygon') { rings = geom.coordinates; }
    else if (geom.type === 'MultiPolygon') {
      geom.coordinates.forEach(function(poly){ poly.forEach(function(r){ rings.push(r); }); });
    }
    var segs = [];
    rings.forEach(function(ring) {
      var pts = [];
      ring.forEach(function(pt, i) {
        var p = projXY(pt[0], pt[1]);
        if (!isFinite(parseFloat(p.x)) || !isFinite(parseFloat(p.y))) { return; }
        pts.push((i === 0 ? 'M' : 'L') + p.x + ',' + p.y);
      });
      if (pts.length > 1) { segs.push(pts.join(' ') + ' Z'); }
    });
    return segs.join(' ');
  }

  // ── Flags overlays ──
  var hasCanton = (typeof cantonOverlayActive !== 'undefined' && cantonOverlayActive
                   && typeof cantonGeoJSONCache !== 'undefined' && cantonGeoJSONCache);
  var hasArr    = (typeof window.arrOverlayActive !== 'undefined' && window.arrOverlayActive
                   && typeof window.arrGeoJSONCache !== 'undefined' && window.arrGeoJSONCache);
  var hasEpci   = (typeof _overlayActive !== 'undefined' && _overlayActive && _overlayActive['epci']
                   && typeof window.epciGeoJSONCache !== 'undefined' && window.epciGeoJSONCache);
  var hasChef   = (typeof chefLieuActive !== 'undefined' && chefLieuActive
                   && typeof chefLieuMarkers !== 'undefined' && chefLieuMarkers.length);
  var hasCirco  = (typeof window.circoOverlayActive !== 'undefined' && window.circoOverlayActive
                   && typeof window.circoGeoJSONCache !== 'undefined' && window.circoGeoJSONCache);
  var hasAnyOverlay = hasCanton || hasArr || hasEpci || hasChef || hasCirco;

  var parts = [];
  parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm" viewBox="0 0 297 210">');
  var bgCol = dark ? '#0d2340' : '#f5f6f8';
  parts.push('<rect width="297" height="210" fill="' + bgCol + '"/>');

  // ── Communes ──
  parts.push('<g id="communes">');
  allCommunes.forEach(function(c) {
    if (!c.contour) { return; }
    try {
      var style = getMarkerStyle(c, mode);
      var fill  = (style.fill && /^#[0-9a-fA-F]{3,6}$/.test(style.fill)) ? style.fill : '#aaa';
      var op    = Number(style.op != null ? style.op : 0.82).toFixed(2);
      var rings = c.contour.type === 'Polygon' ? c.contour.coordinates
                : [].concat.apply([], c.contour.coordinates);
      var segs = [];
      rings.forEach(function(ring) {
        var pts = [];
        ring.forEach(function(pt, i) {
          var p = projXY(pt[0], pt[1]);
          if (!isFinite(parseFloat(p.x)) || !isFinite(parseFloat(p.y))) { return; }
          pts.push((i === 0 ? 'M' : 'L') + p.x + ',' + p.y);
        });
        if (pts.length > 1) { segs.push(pts.join(' ') + ' Z'); }
      });
      if (!segs.length) { return; }
      var strokeCol = dark ? '#0a1e38' : '#ffffff';
      parts.push(`<path d="${segs.join(' ')}" fill="${fill}" fill-opacity="${op}" stroke="${strokeCol}" stroke-width="0.12" stroke-opacity="0.7"/>`);
    } catch(e) {}
  });
  parts.push('</g>');

  // ── Overlay cantons ──
  if (hasCanton) {
    parts.push('<g id="overlay-cantons">');
    cantonGeoJSONCache.features.forEach(function(f) {
      try { var d = geomToPath(f.geometry); if (d) parts.push(`<path d="${d}" fill="none" stroke="${window._calqueColors.canton}" stroke-width="0.55" stroke-opacity="0.85"/>`); } catch(e) {}
    });
    parts.push('</g>');
  }

  // ── Overlay arrondissements ──
  if (hasArr) {
    parts.push('<g id="overlay-arr">');
    window.arrGeoJSONCache.features.forEach(function(f) {
      try { var d = geomToPath(f.geometry); if (d) parts.push(`<path d="${d}" fill="none" stroke="${window._calqueColors.arr}" stroke-width="0.6" stroke-opacity="0.85"/>`); } catch(e) {}
    });
    parts.push('</g>');
  }

  // ── Overlay circonscriptions ──
  if (hasCirco) {
    parts.push('<g id="overlay-circo">');
    window.circoGeoJSONCache.features.forEach(function(f) {
      try { var d = geomToPath(f.geometry); if (d) parts.push(`<path d="${d}" fill="none" stroke="${window._calqueColors.circo}" stroke-width="1.0" stroke-opacity="0.85"/>`); } catch(e) {}
    });
    parts.push('</g>');
  }

  // ── Overlay EPCI (Communautés de communes) ──
  if (hasEpci) {
    parts.push('<g id="overlay-epci">');
    window.epciGeoJSONCache.features.forEach(function(f) {
      try { var d = geomToPath(f.geometry); if (d) parts.push(`<path d="${d}" fill="none" stroke="${window._calqueColors.epci}" stroke-width="0.6" stroke-dasharray="1.4,0.8" stroke-opacity="0.9"/>`); } catch(e) {}
    });
    parts.push('</g>');
  }

  // ── Chefs-lieux (communes principales) ──
  if (hasChef) {
    parts.push('<g id="overlay-chefs">');
    chefLieuMarkers.forEach(function(mk) {
      try {
        var ll = mk.getLatLng();
        var p  = projLL(ll);
        parts.push(`<circle cx="${p.x}" cy="${p.y}" r="1.3" fill="#D4A843" stroke="#000000" stroke-width="0.25" opacity="0.95"/>`);
      } catch(e) {}
    });
    parts.push('</g>');
  }

  // ── LÉGENDE 1 : thématique (bas gauche) ──
  var lf   = dark ? '#0d2340' : '#ffffff';
  var tc   = dark ? '#e2e8f0' : '#2a2a2a';
  var legEl = document.getElementById('pcMapLegend');
  if (legEl && legEl.style.display !== 'none') {
    var items   = legEl.querySelectorAll('.map-legend-item');
    var titleEl = legEl.querySelector('.map-legend-title');
    var nb = items.length;
    if (nb > 0) {
      var leg1H = LEG_PAD * 2 + (titleEl ? LEG_ITEM_H + 1 : 0) + nb * LEG_ITEM_H;
      var lx1   = MARGIN;
      var ly1   = PAGE_H - MARGIN - leg1H;
      parts.push(`<rect x="${lx1}" y="${ly1}" width="${LEG_W}" height="${leg1H}" rx="2" fill="${lf}" fill-opacity="0.95" stroke="#D4A843" stroke-width="0.4"/>`);
      var cy = ly1 + LEG_PAD;
      if (titleEl) {
        parts.push(`<text x="${lx1+LEG_PAD}" y="${cy+3.5}" font-family="Helvetica,sans-serif" font-size="3.3" font-weight="bold" fill="#D4A843">${xmlEsc(titleEl.textContent)}</text>`);
        cy += LEG_ITEM_H + 1;
      }
      items.forEach(function(item) {
        var dot = item.querySelector('.map-legend-dot');
        var lbl = item.querySelector('.map-legend-lbl');
        var dotFill = '#aaaaaa';
        if (dot) {
          dotFill = parseCssColor(window.getComputedStyle(dot).backgroundColor || dot.style.background || '');
          parts.push(`<rect x="${lx1+LEG_PAD}" y="${cy+0.3}" width="4.5" height="4.5" rx="0.8" fill="${dotFill}"/>`);
        }
        if (lbl) {
          parts.push(`<text x="${lx1+LEG_PAD+6}" y="${cy+3.8}" font-family="Helvetica,sans-serif" font-size="2.8" fill="${tc}">${xmlEsc(lbl.textContent)}</text>`);
        }
        cy += LEG_ITEM_H;
      });
    }
  }

  // ── LÉGENDE 2 : contours / overlays (si actifs) — à droite du bloc 1 ──
  if (hasAnyOverlay) {
    var overlayEntries = [];
    if (hasCanton) overlayEntries.push({col:window._calqueColors.canton, dash:false, lbl:'Contours cantons'});
    if (hasCirco)  overlayEntries.push({col:window._calqueColors.circo,  dash:false, lbl:'Circonscriptions'});
    if (hasEpci)   overlayEntries.push({col:window._calqueColors.epci,   dash:true,  lbl:'Comm. de communes'});
    if (hasChef)   overlayEntries.push({col:'#D4A843', dot:true,   lbl:'Communes princ.'});
    if (hasChef)   overlayEntries.push({col:'#D4A843', dot:true,   lbl:'Communes princ.'});

    var leg2H = LEG_PAD * 2 + LEG_ITEM_H + 1 + overlayEntries.length * LEG_ITEM_H;
    var lx2   = MARGIN + LEG_W + LEG_GAP;
    var ly2   = PAGE_H - MARGIN - leg2H;
    parts.push(`<rect x="${lx2}" y="${ly2}" width="${LEG_W}" height="${leg2H}" rx="2" fill="${lf}" fill-opacity="0.95" stroke="#D4A843" stroke-width="0.4"/>`);
    var cy2 = ly2 + LEG_PAD;
    parts.push(`<text x="${lx2+LEG_PAD}" y="${cy2+3.5}" font-family="Helvetica,sans-serif" font-size="3.3" font-weight="bold" fill="#D4A843">Calques</text>`);
    cy2 += LEG_ITEM_H + 1;
    overlayEntries.forEach(function(oe) {
      if (oe.dot) {
        // Cercle plein pour chefs-lieux
        parts.push(`<circle cx="${lx2+LEG_PAD+2.25}" cy="${cy2+2.5}" r="2" fill="${oe.col}" stroke="#000" stroke-width="0.2"/>`);
      } else if (oe.dash) {
        // Ligne tiretée pour EPCI
        parts.push(`<line x1="${lx2+LEG_PAD}" y1="${cy2+2.5}" x2="${lx2+LEG_PAD+7}" y2="${cy2+2.5}" stroke="${oe.col}" stroke-width="0.9" stroke-dasharray="1.4,0.8"/>`);
      } else {
        // Ligne pleine
        parts.push(`<line x1="${lx2+LEG_PAD}" y1="${cy2+2.5}" x2="${lx2+LEG_PAD+7}" y2="${cy2+2.5}" stroke="${oe.col}" stroke-width="1.2"/>`);
      }
      parts.push(`<text x="${lx2+LEG_PAD+9}" y="${cy2+3.8}" font-family="Helvetica,sans-serif" font-size="2.8" fill="${tc}">${xmlEsc(oe.lbl)}</text>`);
      cy2 += LEG_ITEM_H;
    });
  }

  // ── En-tête centré ──
  var hFg   = '#D4A843';
  var subFg = dark ? '#a0b4c8' : '#666666';
  var cx = PAGE_W / 2;
  parts.push(`<text x="${cx}" y="${MARGIN+5.5}" text-anchor="middle" font-family="Helvetica,sans-serif" font-size="6.5" font-weight="bold" fill="${hFg}">Atlas Territorial – Communes de l’Oise (60)</text>`);
  parts.push(`<text x="${cx}" y="${MARGIN+10.5}" text-anchor="middle" font-family="Helvetica,sans-serif" font-size="3" fill="${subFg}">Hugo DREYER • Mode : ${xmlEsc(mode)} • ${new Date().toLocaleDateString('fr-FR')}</text>`);
  parts.push('</svg>');

  var svgStr = parts.join('');
  var blob = new Blob([svgStr], { type: 'image/svg+xml' });
  var url  = URL.createObjectURL(blob);
  var link = document.createElement('a');
  link.download = 'atlas-oise-' + mode + '-A4.svg';
  link.href = url;
  link.click();
  setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
}


// ═══════════════════════════════════════════════════
// THEME TOGGLE
// ═══════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function(){
  document.getElementById('themeToggle').addEventListener('click', () => {
  const html   = document.documentElement;
  const isDark = html.dataset.theme === 'dark';
  html.dataset.theme = isDark ? 'light' : 'dark';
  document.getElementById('themeToggle').textContent = isDark ? '☀️' : '🌙';
  const _mb=document.getElementById('mobThemeBtn');if(_mb)_mb.textContent=document.getElementById('themeToggle').textContent;
  
  updatePcMapTile();
  if (typeof updateAacMapTile === 'function') updateAacMapTile();
  if (typeof window.OverlayTab !== 'undefined' && window.OverlayTab.updateTheme) window.OverlayTab.updateTheme();
});
});

function updatePcMapTile() {
  if (!mapInstance) return;
  const isDark = document.documentElement.dataset.theme === 'dark';
  mapInstance.eachLayer((layer) => {
    if(layer instanceof L.TileLayer && !layer.options.bvLayer){
      layer.setUrl(isDark
        ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
        : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png');
    }
  });
  if (typeof updateMapMarkers === 'function') updateMapMarkers();
  
  if (typeof cantonOverlayActive !== 'undefined' && cantonOverlayActive && typeof drawCantonOverlay === 'function') {
    drawCantonOverlay();
  }
  if (typeof window.arrOverlayActive !== 'undefined' && window.arrOverlayActive && typeof window.drawArrOverlay === 'function') {
    window.drawArrOverlay();
  }
  if (typeof _overlayActive !== 'undefined' && _overlayActive['epci'] && typeof window._drawEpciOverlay === 'function') {
    window._drawEpciOverlay(mapInstance);
  }
}

// ═══════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════
function getDensityClass(d) {
  if(d >= 1000) return 'urban';
  if(d >= 150)  return 'periurban';
  if(d >= 30)   return 'rural';
  return 'very-rural';
}
function getDensityLabel(d) {
  if(d >= 1000) return 'Urbain';
  if(d >= 150)  return 'Péri-urbain';
  if(d >= 30)   return 'Rural';
  if(d > 0)     return 'Rural isolé';
  return '—';
}
function formatPop(n) {
  if(!n) return '0';
  if(n >= 1000000) return (n/1000000).toFixed(1)+' M';
  if(n >= 10000)   return Math.round(n/1000)+' k';
  return n.toLocaleString('fr-FR');
}
function formatSurface(ha) {
  if(!ha) return '—';
  return (ha/100).toFixed(1)+' km²';
}



/* ══ POLITIQUE v11 ══ */
let politicalData = {};
function isFem(q){return /mme/i.test(q||'');}
function fmtName(qualite,prenom,nom){
  const q=(qualite||'').trim().replace(/\.$/,'');
  return [q?q+'.':'', (prenom||'').trim(), (nom||'').trim().toUpperCase()].filter(Boolean).join(' ');
}
function readCellColor(ws,rowIdx,colIdx){
  if(!ws||typeof XLSX==='undefined')return{isRed:false,isColored:false};
  const cell=ws[XLSX.utils.encode_cell({r:rowIdx,c:colIdx})];
  if(!cell?.s)return{isRed:false,isColored:false};
  const fc=cell.s.fgColor||cell.s.bgColor;
  if(!fc)return{isRed:false,isColored:false};
  let rgb='';
  if(fc.rgb){rgb=fc.rgb.toUpperCase().replace(/^FF/,'');if(rgb.length>6)rgb=rgb.slice(-6);}
  else if(fc.theme!==undefined)return{isRed:false,isColored:true};
  else if(fc.indexed!==undefined)return{isRed:[3,9,10,29,30].includes(fc.indexed),isColored:true};
  if(!rgb||rgb==='FFFFFF'||rgb==='000000')return{isRed:false,isColored:false};
  const r=parseInt(rgb.slice(0,2),16),g=parseInt(rgb.slice(2,4),16),b=parseInt(rgb.slice(4,6),16);
  return{isRed:r>160&&g<120&&b<120&&(r-g)>80&&(r-b)>80,isColored:true};
}
function parsePoliticalRows(rows,ws){
  let n=0;
  const si=isNaN(parseInt(String(rows[0]?.[5]).trim()))?1:0;
  rows.slice(si).forEach((c,ri)=>{
    if(!c||c.length<22)return;
    const ai=si+ri, v=i=>String(c[i]??'').trim();
    let ins=v(5)||v(15); if(!ins)return;
    ins=ins.replace(/\D/g,''); if(ins.length<3)return;
    const key=ins.length===5?ins:('60'+ins.padStart(3,'0'));
    if(!key.startsWith('60'))return;
    const aq=v(16),an=v(17),ap=v(18),nq=v(22),nn=v(23),np=v(24);
    let nonReelu,isNew;
    if(ws){const ac=readCellColor(ws,ai,17),nc=readCellColor(ws,ai,23);nonReelu=ac.isRed;isNew=nc.isColored;}
    else{const af=(an+ap).toLowerCase().replace(/\s/g,''),nf=(nn+np).toLowerCase().replace(/\s/g,'');nonReelu=af&&nf&&af!==nf;isNew=nf!==''&&af!==nf;}
    politicalData[key]={territoire:v(1),epci:v(2),canton:v(3),ancienCanton:v(4),nbListes:v(7),popElec:v(9),email:v(11),mobile:v(12),telephone:v(13),
      ancien:{qualite:aq,nom:an,prenom:ap,nonReelu},nouveau:{qualite:nq,nom:nn,prenom:np,elu:v(21),fonction:v(25),isNew}};n++;
  });return n;
}
function handlePolImport(event){
  const file=event.target.files[0];if(!file)return;
  const st=document.getElementById('polImportStatus');if(st)st.textContent='⏳ Lecture…';
  const isX=/\.(xlsx|xls|ods)$/i.test(file.name), r=new FileReader();
  if(isX){r.onload=e=>{try{
    const wb=XLSX.read(new Uint8Array(e.target.result),{type:'array',cellStyles:true});
    const ws=wb.Sheets[wb.SheetNames[0]];
    const n=parsePoliticalRows(XLSX.utils.sheet_to_json(ws,{header:1,defval:'',blankrows:false}),ws);
    if(st)st.textContent=n>0?`✅ ${n} communes chargées (couleurs Excel)`:'⚠️ Aucune commune trouvée';
    const oc=document.querySelector('.detail-panel.open')?.dataset?.code;if(oc)openDetail(oc);
  }catch(err){if(st)st.textContent='⚠️ '+err.message;}event.target.value='';};r.readAsArrayBuffer(file);}
  else{r.onload=e=>{try{
    const lines=e.target.result.split(/\r?\n/).filter(l=>l.trim()),sep=lines[0].includes(';')?';':',';
    const n=parsePoliticalRows(lines.map(l=>l.split(sep).map(v=>v.trim().replace(/^["']|["']$/g,''))),null);
    if(st)st.textContent=n>0?`✅ ${n} communes chargées`:'⚠️ Aucune commune trouvée';
    const oc=document.querySelector('.detail-panel.open')?.dataset?.code;if(oc)openDetail(oc);
  }catch(err){if(st)st.textContent='⚠️ '+err.message;}event.target.value='';};r.readAsText(file,'UTF-8');}
}
function renderPoliticalSection(code){
  const pd=politicalData[code];if(!pd)return'';
  const a=pd.ancien,n=pd.nouveau,hA=a.nom||a.prenom,hN=n.nom||n.prenom;
  if(!hA&&!hN&&!pd.territoire&&!pd.email&&!pd.mobile&&!pd.telephone)return'';
  let h='<div class="pol-section"><div class="pol-section-title">🗳️ Données politiques</div>';
  if(pd.territoire||pd.epci)h+=`<div class="pol-territory"><span style="font-size:18px">🏘️</span><div><strong>Territoire/EPCI</strong><span>${pd.territoire||'—'}${pd.epci&&pd.epci!==pd.territoire?' · '+pd.epci:''}</span></div></div>`;
  if(hN){
    const f=isFem(n.qualite);
    const sb=n.isNew?`<span class="pol-badge new">${f?'🆕 Nouvelle maire':'🆕 Nouveau maire'}</span>`:`<span class="pol-badge keep">${f?'🔄 Réélue':'🔄 Réélu'}</span>`;
    const ts=String(n.elu||'');const tb=/1|T1|1er/i.test(ts)?`<span class="pol-badge t1">${f?'✅ Élue':'✅ Élu'} au 1er tour</span>`:/2|T2|2.me/i.test(ts)?`<span class="pol-badge t2">${f?'🔄 Élue':'🔄 Élu'} au 2ème tour</span>`:'';
    h+=`<div class="pol-card ${n.isNew?'new-mayor':'incumbent'}"><div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">${sb}${tb}</div><div class="pol-name">${fmtName(n.qualite,n.prenom,n.nom)}</div>${n.fonction?'<div class="pol-sub">'+n.fonction+'</div>':''}<div class="pol-contact">${pd.mobile?`<a href="tel:${pd.mobile.replace(/\s/g,'')}">📱 ${pd.mobile}</a>`:''}${pd.telephone?`<a href="tel:${pd.telephone.replace(/\s/g,'')}">📞 ${pd.telephone}</a>`:''}${pd.email?`<a href="mailto:${pd.email}">✉️ ${pd.email}</a>`:''}</div></div>`;
  }
  if(hA){const f=isFem(a.qualite);const ob=a.nonReelu?`<span class="pol-badge out">🔴 ${f?'Non réélue':'Non réélu'}</span>`:`<span class="pol-badge keep">${f?'🔄 Réélue':'🔄 Réélu'}</span>`;h+=`<div class="pol-card ${a.nonReelu?'not-reelect':'incumbent'}"><div style="margin-bottom:6px">${ob}</div><div style="font-size:10px;color:var(--txt-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Ancien(ne) maire</div><div class="pol-name">${fmtName(a.qualite,a.prenom,a.nom)}</div></div>`;}
  if(pd.nbListes||pd.popElec)h+=`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">${pd.nbListes?'<span style="font-size:11px;color:var(--txt-muted)">📋 '+pd.nbListes+' liste(s)</span>':''}${pd.popElec?'<span style="font-size:11px;color:var(--txt-muted)">🗳️ '+parseInt(pd.popElec).toLocaleString('fr-FR')+' électeurs</span>':''}</div>`;
  return h+'</div>';
}

/* ══ COUCHES CARTE CSP v11 ══ */
const CSP_KEYS=['Agriculteurs','Artisans/Comm.','Cadres','Prof. interm.','Employés','Ouvriers'];
const CSP_COLORS={'Agriculteurs':'#27ae60','Artisans/Comm.':'#e67e22','Cadres':'#2980b9','Prof. interm.':'#a968c3','Employés':'#d4a843','Ouvriers':'#d75c4f'};
const CSP_LAYER_MAP={'csp-agri':'Agriculteurs','csp-arti':'Artisans/Comm.','csp-cadre':'Cadres','csp-pi':'Prof. interm.','csp-emp':'Employés','csp-ouv':'Ouvriers'};
let mobMapMode='pop';

function hexToRgb(hex){return[parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16)];}
function lerpColor(c1,c2,t){return c1.map((v,i)=>Math.round(v+(c2[i]-v)*t));}
function rgbToHex(rgb){return'#'+rgb.map(v=>v.toString(16).padStart(2,'0')).join('');}

function getCspData(code){
  const enr=enrichedData[code];if(!enr?.emploi)return null;
  const emp=enr.emploi,total=CSP_KEYS.reduce((s,k)=>s+(emp[k]||0),0);
  if(total===0)return null;
  return{total,pcts:Object.fromEntries(CSP_KEYS.map(k=>[k,((emp[k]||0)/total)*100])),dominant:CSP_KEYS.reduce((a,b)=>(emp[a]||0)>(emp[b]||0)?a:b)};
}
const AGE_KEYS=['0–14 ans','15–29 ans','30–44 ans','45–59 ans','60–74 ans','75 ans +'];
const AGE_COLORS={'0–14 ans':'#3498db','15–29 ans':'#27ae60','30–44 ans':'#f39c12','45–59 ans':'#e74c3c','60–74 ans':'#a76ebf','75 ans +':'#1abc9c'};
function getAgeData(code){
  const enr=enrichedData[code];if(!enr?.age)return null;
  const a=enr.age,total=AGE_KEYS.reduce((s,k)=>s+(a[k]||0),0);
  if(total===0)return null;
  return{total,pcts:Object.fromEntries(AGE_KEYS.map(k=>[k,((a[k]||0)/total)*100])),dominant:AGE_KEYS.reduce((m,b)=>(a[m]||0)>(a[b]||0)?m:b)};
}
const LOG_KEYS=['Propriétaires', 'Locataires'];
const LOG_COLORS={'Propriétaires':'#2980b9', 'Locataires':'#e67e22'};
function getLogData(code){
  const enr=enrichedData[code];if(!enr?.logement)return null;
  const a=enr.logement,total=(a['Propriétaires']||0)+(a['Locataires']||0);
  if(total===0)return null;
  return{total,pcts:{'Propriétaires':((a['Propriétaires']||0)/total)*100,'Locataires':((a['Locataires']||0)/total)*100},dominant:(a['Propriétaires']||0)>(a['Locataires']||0)?'Propriétaires':'Locataires'};
}
window.getMarkerStyle = function getMarkerStyle(c,mode){
  if(mode&&mode.startsWith('bv-')){
    // En mode BV, les communes sont affichées en fond neutre
    return {r:6,color:'#445566',fill:'#2a3f55',op:0.15};
  }
  if(!mode||mode==='pop'){
    const r=Math.max(5,Math.min(12,Math.round(Math.sqrt(c.population/40))));
    const col=getPopDensityColor(c.density);
    return{r,color:col,fill:col,op:.82};
  }
  if(mode==='canton'){const col=cantonColor(c.codeCanton);return{r:7,color:col,fill:col,op:.85};}
  if(mode==='csp-dom'){
    const d=getCspData(c.code);if(!d)return{r:7,color:'#888',fill:'#888',op:.2};
    return{r:7,color:CSP_COLORS[d.dominant],fill:CSP_COLORS[d.dominant],op:.9};
  }
  if(mode==='age-dom'){
    const d=getAgeData(c.code);if(!d)return{r:7,color:'#888',fill:'#888',op:.2};
    return{r:7,color:AGE_COLORS[d.dominant],fill:AGE_COLORS[d.dominant],op:.9};
  }
  if(mode==='log-dom'){
    const d=getLogData(c.code);if(!d)return{r:7,color:'#888',fill:'#888',op:.2};
    return{r:7,color:LOG_COLORS[d.dominant],fill:LOG_COLORS[d.dominant],op:.9};
  }
  if(mode.startsWith('elec-') || mode.startsWith('elec15-') || mode.startsWith('eleclegis-')){
    const col=getElecColor(c.code,mode);
    if(!col)return{r:7,color:'#bbb',fill:'#bbb',op:.15};
    return{r:7,color:col,fill:col,op:.92};
  }
  const col=getQuantileColor(c.code,mode);
  if(!col)return{r:7,color:'#bbb',fill:'#bbb',op:.15};
  return{r:7,color:col,fill:col,op:.92};
}

function buildPopup(c,mode){
  let s=`<strong>${c.nom}</strong><br>${c.population.toLocaleString('fr-FR')} hab.`;
  if(!mode||mode==='pop'){const col=getPopDensityColor(c.density);let smallTxt=`${c.nomCanton} · ${c.nomArr}`; if(c.nomCirconscription) smallTxt+=` · ${c.nomCirconscription}`; return s+`<br><span style="color:${col};font-weight:700">▐ ${c.density} hab/km²</span><br><small>${smallTxt}</small>`;}
  if(mode==='canton'){return s+`<br><span style="color:${cantonColor(c.codeCanton)};font-weight:700">▐ ${c.nomCanton}</span>`;}
  if(mode==='csp-dom'||mode in CSP_LAYER_MAP){
    const d=getCspData(c.code);
    if(d){if(mode==='csp-dom'){s+=`<br><span style="color:${CSP_COLORS[d.dominant]};font-weight:700">★ ${d.dominant}</span>`;CSP_KEYS.forEach(k=>{s+=`<br><small>${k}: ${d.pcts[k].toFixed(1)}%</small>`;});}else{const k=CSP_LAYER_MAP[mode];s+=`<br><strong style="color:${CSP_COLORS[k]}">${k}: ${(d.pcts[k]||0).toFixed(1)}%</strong>`;}}else s+=`<br><small style="color:#aaa">Import INSEE manquant</small>`;
    return s;
  }
  if(mode==='age-dom'){
    const d=getAgeData(c.code);
    if(d){s+=`<br><span style="color:${AGE_COLORS[d.dominant]};font-weight:700">★ ${d.dominant}</span>`;AGE_KEYS.forEach(k=>{s+=`<br><small>${k}: ${d.pcts[k].toFixed(1)}%</small>`;});}else s+=`<br><small style="color:#aaa">Import âge manquant</small>`;
    return s;
  }
  if(mode==='log-dom'){
    const d=getLogData(c.code);
    if(d){s+=`<br><span style="color:${LOG_COLORS[d.dominant]};font-weight:700">★ ${d.dominant}</span>`;LOG_KEYS.forEach(k=>{s+=`<br><small>${k}: ${d.pcts[k].toFixed(1)}%</small>`;});}else s+=`<br><small style="color:#aaa">Import logement manquant</small>`;
    return s;
  }
  if(mode.startsWith('age-')){const def=MAP_LAYER_DEFS[mode],pct=getAgePct(c.code,mode);
    return s+(pct!==null?`<br><strong style="color:${def.col}">${def.lbl}: ${pct.toFixed(1)}%</strong>`:`<br><small style="color:#aaa">Import âge manquant</small>`);}
  if(mode.startsWith('log-')){const def=MAP_LAYER_DEFS[mode],pct=getLogPct(c.code,mode);
    return s+(pct!==null?`<br><strong style="color:${def.col}">${def.lbl}: ${pct.toFixed(1)}%</strong>`:`<br><small style="color:#aaa">Import logement manquant</small>`);}
  if(mode&&(mode.startsWith('bv-') || mode.startsWith('bveleclegis-'))){
    // Popup commune générique en mode BV (les BV ont leur propre popup)
    return `<strong>${c.nom}</strong><br><small style="color:#aaa">${c.population.toLocaleString('fr-FR')} hab. · cliquer pour détails</small>`;
  }
  if(mode&&(mode.startsWith('elec-') || mode.startsWith('elec15-') || mode.startsWith('eleclegis-'))){
    const tour=mode.endsWith('-t2')?2:1;
    const isLegis = mode.includes('legis');
    let d = null;
    if (isLegis) d = tour===1?window.LEGIS2024T1?.[c.code]:window.LEGIS2024T2?.[c.code];
    else d = tour===1?(mode.includes('15')?elec15DataT1[c.code]:elecDataT1[c.code]):(mode.includes('15')?elec15DataT2[c.code]:elecDataT2[c.code]);
    if(d){const col=NUANCE_COLORS[d.n1]||'#aaa';const txtCol=(typeof NUANCE_TEXT_COLORS!=='undefined'&&NUANCE_TEXT_COLORS[d.n1])||col;
      s+=`<br><span style="color:${txtCol};font-weight:700">▐ ${NUANCE_LABELS[d.n1]||d.n1} (${d.pct1}%)</span>`;
      if(d.b1)s+=`<br><small style="opacity:.8">${d.b1}</small>`;
      const val=getElecValue(c.code,mode);if(val!==null)s+=`<br><small>${MAP_LAYER_DEFS[mode].lbl}: <strong>${val.toFixed(1)}%</strong></small>`;}
    return s;
  }
  return s+`<br><small>${c.density} hab/km² · ${c.nomCanton}</small>`;
}

function setMapLayer(mode){
  mobMapMode=mode;
  const cat=MAP_LAYER_DEFS[mode]?.cat||mode;
  syncCatBtns('mlbCatRow',cat);
  if(MAP_CATS_LIST[cat]?.subs){lastSubMode[cat]=mode;syncSubBtns('mlbSubRow',mode);}
  updateMapLegend(mode,'mapLegend');
  if(mode.startsWith('bv-winner') || mode.startsWith('bveleclegis-winner')) {
    if(typeof window.bvShowPolygons==='function') window.bvShowPolygons(mode, 'mob');
  } else {
    if(typeof window.bvHidePolygons==='function') window.bvHidePolygons('mob');
  }
  if(typeof _hidePopCard==='function')_hidePopCard();
  refreshMobMapMarkers();
}
function updateMapLegend(mode,legId){
  const leg=document.getElementById(legId||'mapLegend');if(!leg)return;
  if(!mode||mode==='pop'){
    leg.style.display='block';
    leg.innerHTML='<div class="map-legend-title">Densité de population</div>'+POP_DENSITY_COLORS.map(e=>`<div class="map-legend-item"><div class="map-legend-dot" style="background:${e.col}"></div><div class="map-legend-lbl">${e.lbl}</div></div>`).join('');
    return;
  }
  if(mode.startsWith('bv-winner')||mode.startsWith('bveleclegis-winner')){
    leg.style.display='none'; // BV legend is handled by bvLegendPC/Mob
    return;
  }
  if(mode.includes('-winner-t1')||mode.includes('-winner-t2')){
    const isLegis = mode.includes('legis');
    const is15 = mode.includes('15');
    const tour = mode.endsWith('t1') ? 1 : 2;
    let src;
    if (isLegis) src = tour===1 ? window.LEGIS2024T1 : window.LEGIS2024T2;
    else src = tour===1 ? (is15 ? elec15DataT1 : elecDataT1) : (is15 ? elec15DataT2 : elecDataT2);
    
    const present=new Set(Object.values(src || {}).map(d=>d.n1));
    leg.style.display='block';
    leg.innerHTML=`<div class="map-legend-title">${MAP_LAYER_DEFS[mode].lbl}</div>`+[...present].filter(Boolean).sort().map(n=>`<div class="map-legend-item"><div class="map-legend-dot" style="background:${window._getNuanceColor(n)}"></div><div class="map-legend-lbl">${NUANCE_LABELS[n]||n}</div></div>`).join('');
    return;
  }
  if(mode==='canton'){
    const cx=[...new Map(allCommunes.filter(c=>c.codeCanton).map(c=>[c.codeCanton,c.nomCanton])).entries()].sort((a,b)=>a[1].localeCompare(b[1],'fr'));
    leg.style.display='block';leg.innerHTML='<div class="map-legend-title">Cantons</div>'+cx.map(([k,n])=>`<div class="map-legend-item"><div class="map-legend-dot" style="background:${cantonColor(k)}"></div><div class="map-legend-lbl">${n}</div></div>`).join('');return;
  }
  if(mode==='csp-dom'){
    leg.style.display='block';leg.innerHTML='<div class="map-legend-title">CSP dominante</div>'+CSP_KEYS.map(k=>`<div class="map-legend-item"><div class="map-legend-dot" style="background:${CSP_COLORS[k]}"></div><div class="map-legend-lbl">${k}</div></div>`).join('');return;
  }
  if(mode==='age-dom'){
    leg.style.display='block';leg.innerHTML='<div class="map-legend-title">Âge dominant</div>'+AGE_KEYS.map(k=>`<div class="map-legend-item"><div class="map-legend-dot" style="background:${AGE_COLORS[k]}"></div><div class="map-legend-lbl">${k}</div></div>`).join('');return;
  }
  if(mode==='log-dom'){
    leg.style.display='block';leg.innerHTML='<div class="map-legend-title">Statut dominant</div>'+LOG_KEYS.map(k=>`<div class="map-legend-item"><div class="map-legend-dot" style="background:${LOG_COLORS[k]}"></div><div class="map-legend-lbl">${k}</div></div>`).join('');return;
  }
  const def=MAP_LAYER_DEFS[mode];if(!def?.col){leg.style.display='none';return;}
  const palette=LAYER_COLORS_5[mode];const th=computeQuantileTh(mode);
  if(!palette||!th){leg.style.display='none';return;}
  const fmt=v=>v%1===0?v.toFixed(0):v.toFixed(1);
  const labels=[`< ${fmt(th[0])}%`,`${fmt(th[0])}–${fmt(th[1])}%`,`${fmt(th[1])}–${fmt(th[2])}%`,`${fmt(th[2])}–${fmt(th[3])}%`,`> ${fmt(th[3])}%`];
  leg.style.display='block';
  leg.innerHTML=`<div class="map-legend-title">${def.lbl}</div>`+palette.map((col,i)=>`<div class="map-legend-item"><div style="width:14px;height:10px;border-radius:2px;flex-shrink:0;background:${col}"></div><div class="map-legend-lbl">${labels[i]}</div></div>`).join('');
}

function checkOrientation(){const lb=document.getElementById('landscapeBlock');if(!lb)return;lb.style.display=(window.innerWidth>window.innerHeight&&window.innerWidth<900)?'flex':'none';}
window.addEventListener('resize',checkOrientation);window.addEventListener('orientationchange',checkOrientation);window.addEventListener('load',checkOrientation);
function updateFixedBars(){if(window.innerWidth>768)return;if(typeof _mobPg!=='undefined'&&_mobPg==='carte')return;const hdr=document.querySelector('header'),tb=document.getElementById('tabBar'),sb=document.getElementById('mobileSearchBar'),fr=document.getElementById('mobFRow'),sp=document.getElementById('mobSpacer');const hH=hdr?hdr.offsetHeight:0,tH=(tb&&window.getComputedStyle(tb).display!=='none')?tb.offsetHeight:0,sH=(sb&&window.getComputedStyle(sb).display!=='none')?sb.offsetHeight:0,fH=(fr&&fr.style.display!=='none')?fr.offsetHeight:0;if(tb){tb.style.top=hH+'px';tb.style.position='fixed';}if(sb)sb.style.top=(hH+tH)+'px';if(fr)fr.style.top=(hH+tH+sH)+'px';if(sp)sp.style.height=(hH+tH+sH+fH)+'px'; const ah=document.querySelector('.analyse-header');if(ah)ah.style.top=(hH+tH)+'px';}
window.addEventListener('load',()=>{if(isMobile())showFRow();updateFixedBars();setTimeout(function(){if(isMobile())showFRow();updateFixedBars();},400);});window.addEventListener('resize',updateFixedBars);
let fabDir='up';function mobFabClick(){fabDir==='up'?window.scrollTo({top:0,behavior:'smooth'}):window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'});}
window.addEventListener('scroll',()=>{const f=document.getElementById('mobFab');if(!f)return;fabDir=window.scrollY<150?'down':'up';f.textContent=fabDir==='down'?'↓':'↑';},{passive:true});
let mobMapObj=null,mobMapDone=false,mobMapVisible=false,mobMarkersLayer=null;
function refreshMobMapMarkers(){
  if(!mobMapObj||!mobMapDone)return;
  if(mobMarkersLayer)mobMarkersLayer.clearLayers();else mobMarkersLayer=L.layerGroup().addTo(mobMapObj);
  const src=(filteredCommunes&&filteredCommunes.length<allCommunes.length)?filteredCommunes:allCommunes;
  const isDark = document.documentElement.dataset.theme === 'dark';
  const strokeCol = isDark ? '#0d2340' : '#ffffff';
  const isBV = mobMapMode && (mobMapMode.startsWith('bv-') || mobMapMode.startsWith('bveleclegis-'));

  src.forEach(c=>{
    if (isBV) return; // Hide commune completely in BV mode

    const s=getMarkerStyle(c,mobMapMode);
    if(c.contour){
      const lyr=L.geoJSON({type:'Feature',geometry:c.contour},{
        style:{fillColor:s.fill,fillOpacity:s.op,color:strokeCol,weight:0.6,opacity:0.5}
      }).bindPopup(buildPopup(c,mobMapMode)).on('click',()=>openDetail(c.code));
      lyr.addTo(mobMarkersLayer);
    } else if(c.centre){
      const[lng,lat]=c.centre.coordinates;
      L.circleMarker([lat,lng],{radius:s.r,color:s.fill,fillColor:s.fill,fillOpacity:s.op,weight:1})
       .bindPopup(buildPopup(c,mobMapMode)).addTo(mobMarkersLayer).on('click',()=>openDetail(c.code));
    }
  });
  if(filteredCommunes&&filteredCommunes.length<allCommunes.length&&filteredCommunes.length>0){
    const pts=filteredCommunes.filter(c=>c.centre).map(c=>[c.centre.coordinates[1],c.centre.coordinates[0]]);
    if(pts.length)try{mobMapObj.fitBounds(pts,{padding:[30,30]});}catch(e){}}
}

function initMobMap(){
  
  if(!el.style.height||el.style.height==='')el.style.height=(window.innerHeight*0.7)+'px';

  mobMapObj=L.map(el,{zoomControl:false}).setView([49.42,2.40],10);
  window.mobMapObj = mobMapObj;
  const _isDark = document.documentElement.dataset.theme === 'dark';
  const _tileUrl = _isDark
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
  const _tileAttr = _isDark ? '© CartoDB Dark' : '© CartoDB Positron';
  mobTileLayer = L.tileLayer(_tileUrl, {attribution: _tileAttr, maxZoom:19}).addTo(mobMapObj);
  L.control.zoom({position:'bottomright'}).addTo(mobMapObj);
  mobMarkersLayer=L.layerGroup().addTo(mobMapObj);mobMapDone=true;
  showOverlayBtn();
  ['mapLayerBar','mlbCatRow','mlbSubRow','mapLegend'].forEach(id=>{
    const el=document.getElementById(id);if(!el)return;
    try{L.DomEvent.disableClickPropagation(el);L.DomEvent.disableScrollPropagation(el);}catch(e){}
    ['touchstart','touchmove','touchend'].forEach(ev=>el.addEventListener(ev,e=>e.stopPropagation(),{passive:false}));
  });
  setMobCat(mobMapMode);
  if(typeof _hidePopCard==='function')_hidePopCard();
      refreshMobMapMarkers();}

const mSel={arr:new Set(),canton:new Set(),dens:new Set(),pop:'',sort:'nom',epci:new Set(),circo:new Set()};
let activeSh=null;
const DENS_O=[{v:'urban',l:'Urbain'},{v:'periurban',l:'Péri-urbain'},{v:'rural',l:'Rural'},{v:'very-rural',l:'Rural isolé'}];
const POP_O=[{v:'',l:'Toutes'},{v:'0-499',l:'< 500'},{v:'500-1999',l:'500–1 999'},{v:'2000-4999',l:'2 000–4 999'},{v:'5000-9999',l:'5 000–9 999'},{v:'10000-999999',l:'10 000+'}];
const SORT_O=[{v:'nom',l:'Nom A→Z'},{v:'nom-desc',l:'Nom Z→A'},{v:'pop-desc',l:'Pop ↓'},{v:'pop-asc',l:'Pop ↑'},{v:'density-desc',l:'Densité ↓'}];
function openSh(type){activeSh=type;const T={arr:'Arrondissement',canton:'Canton',dens:'Densité',pop:'Population',sort:'Tri',epci:'Communauté de communes',circo:'Circonscription'};document.getElementById('shTtl').textContent=T[type];const s=document.getElementById('shSrch');s.style.display=(type==='canton'||type==='epci'||type==='circo')?'block':'none';s.value='';document.getElementById('shAllBtn').style.display=['arr','canton','dens','epci','circo'].includes(type)?'block':'none';renderShItems(type,'');document.getElementById('shOv').classList.add('open');document.getElementById('shBox').classList.add('open');}
function renderShItems(type,q){const el=document.getElementById('shList');if(!el)return;let items=[];if(type==='arr')items=[...new Set(allCommunes.map(c=>c.codeArr).filter(Boolean))].sort().map(v=>({v,l:ARR_NAMES[v]||v,n:allCommunes.filter(c=>c.codeArr===v).length,on:mSel.arr.has(v)}));else if(type==='canton'){const cm=new Map();allCommunes.filter(c=>c.codeCanton).forEach(c=>{if(!cm.has(c.codeCanton))cm.set(c.codeCanton,c.nomCanton);});items=[...cm.entries()].sort((a,b)=>a[1].localeCompare(b[1],'fr')).filter(([,l])=>!q||l.toLowerCase().includes(q.toLowerCase())).map(([v,l])=>({v,l,n:allCommunes.filter(c=>c.codeCanton===v).length,on:mSel.canton.has(v)}));}else if(type==='circo'){const cirM=new Map();allCommunes.filter(c=>c.codeCirconscription).forEach(c=>{if(!cirM.has(c.codeCirconscription))cirM.set(c.codeCirconscription,c.nomCirconscription||c.codeCirconscription);});items=[...cirM.entries()].sort((a,b)=>a[1].localeCompare(b[1],'fr')).filter(([,l])=>!q||l.toLowerCase().includes(q.toLowerCase())).map(([v,l])=>({v,l,n:allCommunes.filter(c=>c.codeCirconscription===v).length,on:mSel.circo.has(v)}));}else if(type==='dens')items=DENS_O.map(o=>({...o,n:allCommunes.filter(c=>getDensityClass(c.density)===o.v).length,on:mSel.dens.has(o.v)}));else if(type==='pop')items=POP_O.map(o=>({...o,n:null,on:mSel.pop===o.v}));else if(type==='epci'){
  const em=new Map();
  allCommunes.forEach(function(c){
    if(c.codeEpci&&!em.has(c.codeEpci))em.set(c.codeEpci,c.nomEpci||c.codeEpci);
  });
  items=[...em.entries()].sort((a,b)=>a[1].localeCompare(b[1],'fr'))
    .filter(([,l])=>!q||l.toLowerCase().includes(q.toLowerCase()))
    .map(([v,l])=>({v,l,n:allCommunes.filter(c=>c.codeEpci===v).length,on:mSel.epci.has(v)}));
}else items=SORT_O.map(o=>({...o,n:null,on:mSel.sort===o.v}));el.innerHTML=items.map(it=>'<div class="sh-item" onclick="shTog(\''+it.v.replace(/\\/g,'\\\\').replace(/'/g,"\\'")+'\')"><div class="sh-cb'+(it.on?' on':'')+'"></div><span class="sh-lbl">'+it.l+'</span>'+(it.n!==null?'<span class="sh-cnt">'+it.n+'</span>':'')+'</div>').join('');}
function shTog(val){const t=activeSh;if(t==='pop')mSel.pop=val;else if(t==='sort')mSel.sort=val;else{const s=mSel[t];s.has(val)?s.delete(val):s.add(val);}renderShItems(t,document.getElementById('shSrch').value);applyMobFilters();updPills();}
function shAll(){const t=activeSh;if(!['arr','canton','dens','epci','circo'].includes(t))return;const s=mSel[t];const all=t==='arr'?[...new Set(allCommunes.map(c=>c.codeArr).filter(Boolean))]:t==='dens'?DENS_O.map(o=>o.v):t==='epci'?[...new Set(allCommunes.map(c=>c.codeEpci).filter(Boolean))]:t==='circo'?[...new Set(allCommunes.map(c=>c.codeCirconscription).filter(Boolean))]:[...new Set(allCommunes.map(c=>c.codeCanton).filter(Boolean))];s.size===all.length?s.clear():all.forEach(v=>s.add(v));renderShItems(t,'');applyMobFilters();updPills();}
function rstSh(){const t=activeSh;if(t==='pop')mSel.pop='';else if(t==='sort')mSel.sort='nom';else if(mSel[t]&&mSel[t].clear)mSel[t].clear();renderShItems(t,'');applyMobFilters();updPills();}
function closeSh(){document.getElementById('shBox').classList.remove('open');document.getElementById('shOv').classList.remove('open');activeSh=null;}
function updPills(){[{id:'fpCirco',k:'circo',c:'fpCircoC'},{id:'fpCanton',k:'canton',c:'fpCantonC'},{id:'fpDens',k:'dens',c:'fpDensC'},{id:'fpEpci',k:'epci',c:'fpEpciC'}].forEach(({id,k,c})=>{const n=mSel[k].size,b=document.getElementById(id),cnt=document.getElementById(c);if(b)b.classList.toggle('on',n>0);if(cnt)cnt.innerHTML=n>0?'<span class="mob-fcnt">'+n+'</span>':'';});const fp=document.getElementById('fpPop');if(fp)fp.classList.toggle('on',mSel.pop!=='');const fs=document.getElementById('fpSort');if(fs)fs.classList.toggle('on gold',mSel.sort!=='nom');}
function applyMobFilters(){if(!allCommunes||!allCommunes.length)return;let res=allCommunes.slice();const sv=(document.getElementById('mobileSearchInput')?.value||'').toLowerCase().trim();if(sv)res=res.filter(c=>c.nom.toLowerCase().includes(sv)||c.code.includes(sv)||c.codePostal.includes(sv));if(mSel.arr.size>0)res=res.filter(c=>mSel.arr.has(c.codeArr));if(mSel.canton.size>0)res=res.filter(c=>mSel.canton.has(c.codeCanton));if(mSel.circo.size>0)res=res.filter(c=>mSel.circo.has(c.codeCirconscription));if(mSel.dens.size>0)res=res.filter(c=>mSel.dens.has(getDensityClass(c.density)));
  if(mSel.epci.size>0)res=res.filter(c=>mSel.epci.has(c.codeEpci));if(mSel.pop){const[mn,mx]=mSel.pop.split('-').map(Number);res=res.filter(c=>c.population>=mn&&c.population<=mx);}const s=mSel.sort;res.sort((a,b)=>s==='nom'?a.nom.localeCompare(b.nom,'fr'):s==='nom-desc'?b.nom.localeCompare(a.nom,'fr'):s==='pop-desc'?b.population-a.population:s==='pop-asc'?a.population-b.population:s==='density-desc'?b.density-a.density:a.nom.localeCompare(b.nom,'fr'));filteredCommunes=res;renderMobileList();if(mobMapVisible)if(typeof _hidePopCard==='function')_hidePopCard();
      refreshMobMapMarkers();}

// ═══════════════════════════════════════════════════
// MOBILE RESPONSIVE
// ═══════════════════════════════════════════════════
function isMobile() { return window.innerWidth <= 768; }

function renderMobileList() {
  if (!isMobile()) return;
  const list = document.getElementById('mobileList');
  if (!list) return;
  const maxP = Math.max(...filteredCommunes.map(c => c.population), 1);
  if (filteredCommunes.length === 0) {
    list.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--txt-muted);font-size:14px">Aucune commune trouvée</div>';
  } else {
    const start = (currentPage - 1) * pageSize; const end = Math.min(start + pageSize, filteredCommunes.length); list.innerHTML = filteredCommunes.slice(start, end).map(c => {
      const dc = getDensityClass(c.density);
      const dcLabel = {urban:'Urbain',periurban:'Péri-urbain',rural:'Rural','very-rural':'Rural isolé'}[dc]||'';
      const pct = Math.round(c.population / maxP * 100);
      return '<div class="mob-commune-card" onclick="_mobPrevPg=\'liste\';openDetail(\'' + c.code + '\')">'
        + '<div class="mob-card-top">'
        + '<div><div class="mob-card-name">' + c.nom + '</div>'
        + '<div class="mob-card-code">' + c.code + ' <span style="opacity:.6;font-size:9px">(INSEE)</span> · ' + (c.codePostal||'–') + ' <span style="opacity:.6;font-size:9px">(CP)</span></div></div>'
        + '<div style="text-align:right"><div class="mob-card-pop">' + formatPop(c.population) + '</div>'
        + '<div class="mob-card-pop-lbl">habitants</div></div></div>'
        + '<div class="mob-pop-bar"><div class="mob-pop-bar-fill" style="width:' + pct + '%"></div></div>'
        + '<div class="mob-card-badges">'
        + '<span class="canton-badge">' + (c.nomCanton||'—') + '</span>'
        + (c.nomEpci ? '<span class="epci-badge">' + c.nomEpci + '</span>' : '')
        + (c.nomCirconscription ? '<span class="canton-badge" style="background:rgba(255,255,255,0.1);color:#aaa;border:1px solid #aaa;">' + c.nomCirconscription + '</span>' : '')
        + '<span class="density-badge density-' + dc + '">' + dcLabel + '</span>'
        + '<span style="margin-left:auto;color:var(--txt-muted);font-size:14px">›</span>'
        + '</div></div>';
    }).join('');
  }
  
}

function onMobileSearch(val) {
  var v = (val !== undefined && val !== null) ? val
        : (document.getElementById('mobileSearchInput') ? document.getElementById('mobileSearchInput').value : '');
  document.getElementById('searchInput').value = v;
  applyFilters();
}

function syncFromDrawer() {
  [['mobileFilterCanton','filterCanton'],
   ['mobileFilterCirco','filterCirco'],
   ['mobilePopPreset','popPreset'],['mobileFilterDensity','filterDensity'],
   ['mobileSortField','sortField']].forEach(function(pair) {
    var m=document.getElementById(pair[0]), d=document.getElementById(pair[1]);
    if(m&&d) d.value=m.value;
  });
  applyFilters();
  updateDrawerBadge();
}

function syncToDrawer() {
  [['filterCanton','mobileFilterCanton'],
   ['filterCirco','mobileFilterCirco'],
   ['popPreset','mobilePopPreset'],['filterDensity','mobileFilterDensity'],
   ['sortField','mobileSortField']].forEach(function(pair) {
    var d=document.getElementById(pair[0]), m=document.getElementById(pair[1]);
    if(d&&m){ m.innerHTML=''; Array.from(d.options).forEach(function(o){m.add(new Option(o.text,o.value,o.defaultSelected,o.selected));}); }
  });
}

function updateDrawerBadge() {
  var btn=document.getElementById('mobileFilterBtn');
  if(!btn) return;
  var active=['mobileFilterCirco','mobileFilterCanton','mobilePopPreset','mobileFilterDensity']
    .filter(function(id){var el=document.getElementById(id);return el&&el.value!=='';}).length;
  btn.classList.toggle('active', active>0);
  btn.innerHTML = active>0
    ? '⚙️ Filtres <span style="background:var(--navy);color:var(--gold);border-radius:10px;padding:1px 6px;font-size:11px">'+active+'</span>'
    : '⚙️ Filtres';
}

function openDrawer() {
  syncToDrawer();
  document.getElementById('filterDrawer').classList.add('open');
  var ov=document.getElementById('drawerOverlay');
  ov.style.display='block';
  setTimeout(function(){ov.style.opacity='1';},10);
}
function closeDrawer() {
  document.getElementById('filterDrawer').classList.remove('open');
  var ov=document.getElementById('drawerOverlay');
  ov.style.opacity='0';
  setTimeout(function(){ov.style.display='none';},250);
  updateDrawerBadge();
}
function resetMobileFilters() {
  ['mobileFilterCanton','mobileFilterCirco','mobilePopPreset','mobileFilterDensity'].forEach(function(id){
    var el=document.getElementById(id); if(el) el.value='';
  });
  var s=document.getElementById('mobileSortField'); if(s) s.value='nom';
  var si=document.getElementById('mobileSearchInput'); if(si) si.value='';
  document.getElementById('searchInput').value='';
  syncFromDrawer();
}

// Patch applyFilters pour déclencher renderMobileList après chaque filtre
(function() {
  var _orig = window.applyFilters;
  window.applyFilters = function() {
    _orig.apply(this, arguments);
    renderMobileList();
  };
})();

window.addEventListener('resize', function() { if(isMobile()) renderMobileList(); if(currentTab === 'table') { const m = document.getElementById('mobileList'); if(m) m.style.display = isMobile() ? 'block' : 'none'; } });


/* ══════════════════════════════════════════════════
   CONSTANTES + HELPERS v13
══════════════════════════════════════════════════ */
const CANTON_PAL=['#e74c3c','#e67e22','#f1c40f','#27ae60','#1abc9c','#3498db','#9b59b6','#e91e63','#ff5722','#795548','#607d8b','#009688','#8bc34a','#ff9800','#673ab7','#2196f3','#00bcd4','#4caf50','#ff6b6b','#feca57','#48dbfb','#ff9ff3','#54a0ff'];
function cantonColor(code){let h=0;for(const c of(code||''))h=((h*31)+c.charCodeAt(0))>>>0;return CANTON_PAL[h%CANTON_PAL.length];}

window.MAP_LAYER_DEFS={
  pop:{cat:'pop',lbl:'Pop.',direct:true},canton:{cat:'canton',lbl:'Canton',direct:true},
  'csp-dom':{cat:'csp',lbl:'CSP dom.',col:'#a968c3'},
  'csp-agri':{cat:'csp',lbl:'Agri.',col:'#27ae60'},'csp-arti':{cat:'csp',lbl:'Artisans',col:'#e67e22'},
  'csp-cadre':{cat:'csp',lbl:'Cadres',col:'#2980b9'},'csp-pi':{cat:'csp',lbl:'P.Interm.',col:'#8476ea'},
  'csp-emp':{cat:'csp',lbl:'Employés',col:'#d4a843'},'csp-ouv':{cat:'csp',lbl:'Ouvriers',col:'#d75c4f'},
  'age-dom':{cat:'age',lbl:'Âge dom.',col:'#3498db'},
  'age-0014':{cat:'age',lbl:'0–14 ans',col:'#3498db',ageKey:'0–14 ans',maxPct:25},
  'age-1529':{cat:'age',lbl:'15–29 ans',col:'#27ae60',ageKey:'15–29 ans',maxPct:25},
  'age-3044':{cat:'age',lbl:'30–44 ans',col:'#f39c12',ageKey:'30–44 ans',maxPct:22},
  'age-4559':{cat:'age',lbl:'45–59 ans',col:'#e74c3c',ageKey:'45–59 ans',maxPct:22},
  'age-6074':{cat:'age',lbl:'60–74 ans',col:'#a76ebf',ageKey:'60–74 ans',maxPct:20},
  'age-75p':{cat:'age',lbl:'75+ ans',col:'#1abc9c',ageKey:'75 ans +',maxPct:15},
  'log-dom':{cat:'log',lbl:'Statut dom.',col:'#2980b9'},
  'log-prop':{cat:'log',lbl:'Propriétaires',col:'#f39c12',logKey:'prop',maxPct:90},
  'log-loc':{cat:'log',lbl:'Locataires',col:'#3498db',logKey:'loc',maxPct:60},
  'log-maison':{cat:'log',lbl:'Maisons',col:'#27ae60',logKey:'maison',maxPct:90},
  'log-appart':{cat:'log',lbl:'Appartements',col:'#a76ebf',logKey:'appart',maxPct:70},
  'log-vac':{cat:'log',lbl:'Vacants',col:'#e74c3c',logKey:'vac',maxPct:25},
  'log-sec':{cat:'log',lbl:'Résid.sec.',col:'#1abc9c',logKey:'sec',maxPct:40},
  'elec-winner-t2':{cat:'elec',lbl:'Vainqueur T2 (Dép. 2021)',direct:true},
  'elec-abs-t1':{cat:'elec',lbl:'Abstention T1 2021',col:'#7f8c8d',maxPct:80},
  'elec-abs-t2':{cat:'elec',lbl:'Abstention T2 2021',col:'#95a5a6',maxPct:80},
  'elec-part-t1':{cat:'elec',lbl:'Participation T1 2021',col:'#27ae60',maxPct:60},
  'elec-rn-t1':{cat:'elec',lbl:'RN % T1 2021',col:'#1a3c8f',maxPct:50},
  'elec-dvd-t1':{cat:'elec',lbl:'Droite T1 (LR+DVD) 2021',col:'#1976D2',maxPct:50},
  'elec-ug-t1':{cat:'elec',lbl:'Gauche % T1 2021',col:'#e63946',maxPct:50},
  'elec-part-t2':{cat:'elec',lbl:'Participation T2 2021',col:'#27ae60',maxPct:70},
  'elec-rn-t2':{cat:'elec',lbl:'RN % T2 2021',col:'#0a1a5c',maxPct:60},
  'elec-dvd-t2':{cat:'elec',lbl:'Droite T2 (LR+DVD) 2021',col:'#1976D2',maxPct:60},
  'elec-ug-t2':{cat:'elec',lbl:'Gauche % T2 2021',col:'#C62828',maxPct:60},
  'elec15-rn-t1':{cat:'elec',lbl:'FN % T1 2015',col:'#1a3c8f',maxPct:50},
  'elec15-rn-t2':{cat:'elec',lbl:'FN % T2 2015',col:'#0a1a5c',maxPct:60},
  'elec15-dvd-t1':{cat:'elec',lbl:'Droite T1 (UD+DVD) 2015',col:'#1976D2',maxPct:50},
  'elec15-dvd-t2':{cat:'elec',lbl:'Droite T2 (UD+DVD) 2015',col:'#1976D2',maxPct:60},
  'elec15-ug-t1':{cat:'elec',lbl:'Gauche % T1 2015',col:'#e63946',maxPct:50},
  'elec15-ug-t2':{cat:'elec',lbl:'Gauche % T2 2015',col:'#C62828',maxPct:60},
  'elec15-winner-t1':{cat:'elec',lbl:'Vainqueur T1 (Dép. 2015)',direct:true},
  'elec15-winner-t2':{cat:'elec',lbl:'Vainqueur T2 (Dép. 2015)',direct:true},
  'elec15-abs-t1':{cat:'elec',lbl:'Abstention T1 2015',col:'#7f8c8d',maxPct:80},
  'elec15-abs-t2':{cat:'elec',lbl:'Abstention T2 2015',col:'#95a5a6',maxPct:80},
  'elec15-part-t1':{cat:'elec',lbl:'Participation T1 2015',col:'#27ae60',maxPct:60},
  'elec15-part-t2':{cat:'elec',lbl:'Participation T2 2015',col:'#27ae60',maxPct:70},
  'bv-winner-t1':{cat:'bvelec',lbl:'Vainqueur BV T1',direct:true},
  'bv-winner-t2':{cat:'bvelec',lbl:'Vainqueur BV T2',direct:true},
  'eleclegis-winner-t1':{cat:'eleclegis',lbl:'Vainqueur T1 (Législ. 2024)',direct:true},
  'eleclegis-abs-t1':{cat:'eleclegis',lbl:'Abstention T1 2024',col:'#7f8c8d',maxPct:80},
  'eleclegis-part-t1':{cat:'eleclegis',lbl:'Participation T1 2024',col:'#27ae60',maxPct:80},
  'eleclegis-rn-t1':{cat:'eleclegis',lbl:'RN/EXD % T1 2024',col:'#1a3c8f',maxPct:60},
  'eleclegis-dvd-t1':{cat:'eleclegis',lbl:'Droite/Centre % T1 2024',col:'#1976D2',maxPct:60},
  'eleclegis-ug-t1':{cat:'eleclegis',lbl:'NFP/Gauche % T1 2024',col:'#e63946',maxPct:60},
  'eleclegis-winner-t2':{cat:'eleclegis',lbl:'Vainqueur T2 (Législ. 2024)',direct:true},
  'eleclegis-abs-t2':{cat:'eleclegis',lbl:'Abstention T2 2024',col:'#95a5a6',maxPct:80},
  'eleclegis-part-t2':{cat:'eleclegis',lbl:'Participation T2 2024',col:'#27ae60',maxPct:80},
  'eleclegis-rn-t2':{cat:'eleclegis',lbl:'RN/EXD % T2 2024',col:'#0a1a5c',maxPct:70},
  'eleclegis-dvd-t2':{cat:'eleclegis',lbl:'Droite/Centre % T2 2024',col:'#1976D2',maxPct:70},
  'eleclegis-ug-t2':{cat:'eleclegis',lbl:'NFP/Gauche % T2 2024',col:'#C62828',maxPct:70},
  'bveleclegis-winner-t1':{cat:'bveleclegis',lbl:'Vainqueur BV T1 (Lég.)',direct:true},
  'bveleclegis-winner-t2':{cat:'bveleclegis',lbl:'Vainqueur BV T2 (Lég.)',direct:true}
};
const MAP_CATS_LIST={
  pop:{lbl:'👥 Pop.',subs:null},canton:{lbl:'🗺 Canton',subs:null},
  csp:{lbl:'👔 CSP',subs:['csp-dom','csp-agri','csp-arti','csp-cadre','csp-pi','csp-emp','csp-ouv']},
  age:{lbl:'🎂 Âge',subs:['age-dom','age-0014','age-1529','age-3044','age-4559','age-6074','age-75p']},
  log:{lbl:'🏠 Log.',subs:['log-dom','log-prop','log-loc','log-maison','log-appart','log-vac','log-sec']},
  elec:{lbl:'🗳️ Élec. dép.',subs:['elec-winner-t2','elec15-winner-t2','elec-abs-t1','elec15-abs-t1','elec-abs-t2','elec15-abs-t2','elec-part-t1','elec15-part-t1','elec-part-t2','elec15-part-t2','elec-rn-t1','elec15-rn-t1','elec-rn-t2','elec15-rn-t2','elec-dvd-t1','elec15-dvd-t1','elec-dvd-t2','elec15-dvd-t2','elec-ug-t1','elec15-ug-t1','elec-ug-t2','elec15-ug-t2']},
  bvelec:{lbl:'🗳️ BV départ.',subs:['bv-winner-t1','bv-winner-t2']},
  eleclegis:{lbl:'🗳️ Élec. législ.',subs:['eleclegis-winner-t1','eleclegis-winner-t2','eleclegis-abs-t1','eleclegis-abs-t2','eleclegis-part-t1','eleclegis-part-t2','eleclegis-rn-t1','eleclegis-rn-t2','eleclegis-dvd-t1','eleclegis-dvd-t2','eleclegis-ug-t1','eleclegis-ug-t2']},
  bveleclegis:{lbl:'🗳️ BV législ.',subs:['bveleclegis-winner-t1','bveleclegis-winner-t2']}
};
let pcMapMode='pop';
const lastSubMode={csp:'csp-dom',age:'age-dom',log:'log-dom',elec:'elec-winner-t2',bvelec:'bv-winner-t1',eleclegis:'eleclegis-winner-t1',bveleclegis:'bveleclegis-winner-t1'};

function getAgePct(code,mode){
  const def=MAP_LAYER_DEFS[mode],data=enrichedData[code]?.age;
  if(!def?.ageKey||!data)return null;
  const tot=data._total||Object.entries(data).filter(([k])=>k!=='_total').reduce((s,[,v])=>s+v,0);
  return tot?(data[def.ageKey]||0)/tot*100:null;
}
function getLogPct(code,mode){
  const def=MAP_LAYER_DEFS[mode],d=enrichedData[code]?.logement;
  if(!def?.logKey||!d)return null;
  const tot=d['Logements total']||0,rp=d['Rés. principales']||0;
  switch(def.logKey){
    case 'prop':   return rp?(d['Propriétaires']||0)/rp*100:null;
    case 'loc':    return rp?(d['Locataires']||0)/rp*100:null;
    case 'maison': return tot?(d['Maisons']||0)/tot*100:null;
    case 'appart': return tot?(d['Appartements']||0)/tot*100:null;
    case 'vac':    return tot?(d['Logts vacants']||0)/tot*100:null;
    case 'sec':    return tot?(d['Rés. secondaires']||0)/tot*100:null;
  }
  return null;
}

/* ── Barre groupée ── */
function buildSubRowHtml(cat,fnName,activeMode){
  const subs=MAP_CATS_LIST[cat]?.subs;if(!subs)return'';
  if(cat==='elec') {
    const pairs = [
      ['elec-winner-t2', 'elec15-winner-t2'],
      ['elec-abs-t1', 'elec15-abs-t1'],
      ['elec-abs-t2', 'elec15-abs-t2'],
      ['elec-part-t1', 'elec15-part-t1'],
      ['elec-part-t2', 'elec15-part-t2'],
      ['elec-rn-t1', 'elec15-rn-t1'],
      ['elec-rn-t2', 'elec15-rn-t2'],
      ['elec-dvd-t1', 'elec15-dvd-t1'],
      ['elec-dvd-t2', 'elec15-dvd-t2'],
      ['elec-ug-t1', 'elec15-ug-t1'],
      ['elec-ug-t2', 'elec15-ug-t2']
    ];
    return pairs.map(pair => {
      return '<div style="display:flex;flex-direction:column;gap:4px;">' + pair.map(id => {
        const def=MAP_LAYER_DEFS[id],isAct=id===activeMode;
        return`<button class="mlb-sub-btn${isAct?' active':''}" data-id="${id}" style="${isAct&&def.col?'background:'+def.col+';color:#0d2340;':''}" onclick="${fnName}('${id}')">${def.lbl}</button>`;
      }).join('') + '</div>';
    }).join('');
  }
  if(cat==='eleclegis') {
    const pairs = [
      ['eleclegis-winner-t1', 'eleclegis-winner-t2'],
      ['eleclegis-abs-t1', 'eleclegis-abs-t2'],
      ['eleclegis-part-t1', 'eleclegis-part-t2'],
      ['eleclegis-rn-t1', 'eleclegis-rn-t2'],
      ['eleclegis-dvd-t1', 'eleclegis-dvd-t2'],
      ['eleclegis-ug-t1', 'eleclegis-ug-t2']
    ];
    return pairs.map(pair => {
      return '<div style="display:flex;flex-direction:column;gap:4px;">' + pair.map(id => {
        const def=MAP_LAYER_DEFS[id],isAct=id===activeMode;
        return`<button class="mlb-sub-btn${isAct?' active':''}" data-id="${id}" style="${isAct&&def.col?'background:'+def.col+';color:#0d2340;':''}" onclick="${fnName}('${id}')">${def.lbl}</button>`;
      }).join('') + '</div>';
    }).join('');
  }
  return subs.map(id=>{
    const def=MAP_LAYER_DEFS[id],isAct=id===activeMode;
    return`<button class="mlb-sub-btn${isAct?' active':''}" data-id="${id}" style="${isAct&&def.col?'background:'+def.col+';color:#0d2340;':''}" onclick="${fnName}('${id}')">${def.lbl}</button>`;
  }).join('');
}

function syncCatBtns(rowId,cat){document.querySelectorAll(`#${rowId} .mlb-cat-btn`).forEach(b=>b.classList.toggle('active',b.dataset.cat===cat));}
function syncSubBtns(rowId,mode){
  document.querySelectorAll(`#${rowId} .mlb-sub-btn`).forEach(b=>{
    const def=MAP_LAYER_DEFS[b.dataset.id],isAct=b.dataset.id===mode;
    b.classList.toggle('active',isAct);b.style.background=isAct&&def?.col?def.col:'';b.style.color=isAct?'#0d2340':'';
  });
}

/* Mobile */
function setMobCat(cat){
  syncCatBtns('mlbCatRow',cat);
  const subRow=document.getElementById('mlbSubRow'),subs=MAP_CATS_LIST[cat]?.subs;
  if(!subs){subRow.style.display='none';setMapLayer(cat);if(typeof _mobShowMap==='function')setTimeout(_mobShowMap,10);return;}
  const mode=lastSubMode[cat]||subs[0];
  subRow.innerHTML=buildSubRowHtml(cat,'setMapLayer',mode);subRow.style.display='flex';
  if(typeof mobMapObj!=='undefined'&&mobMapObj){
    try{L.DomEvent.disableClickPropagation(subRow);L.DomEvent.disableScrollPropagation(subRow);}catch(e){}
    ['touchstart','touchmove','touchend'].forEach(ev=>subRow.addEventListener(ev,e=>e.stopPropagation(),{passive:false}));
  }
  setMapLayer(mode);
  // Recalculer la position de la carte pour faire de la place à mlbSubRow
  if(typeof _mobShowMap==='function') setTimeout(_mobShowMap, 10);
}

/* PC */
function setPcCat(cat){
  syncCatBtns('pcCatRow',cat);
  const subRow=document.getElementById('pcSubRow'),subs=MAP_CATS_LIST[cat]?.subs;
  if(!subs){subRow.style.display='none';setPcLayer(cat);return;}
  const mode=lastSubMode[cat]||subs[0];
  subRow.innerHTML=buildSubRowHtml(cat,'setPcLayer',mode);subRow.style.display='flex';
  setPcLayer(mode);
}
function setPcLayer(mode){
  pcMapMode=mode;
  const cat=MAP_LAYER_DEFS[mode]?.cat||mode;
  syncCatBtns('pcCatRow',cat);
  if(MAP_CATS_LIST[cat]?.subs){lastSubMode[cat]=mode;syncSubBtns('pcSubRow',mode);}
  if(mode.startsWith('bv-winner') || mode.startsWith('bveleclegis-winner')) {
    if(typeof window.bvShowPolygons==='function') window.bvShowPolygons(mode, 'pc');
  } else {
    if(typeof window.bvHidePolygons==='function') window.bvHidePolygons('pc');
  }
  if(typeof _hidePopCard==='function')_hidePopCard();
  updateMapMarkers(pcMapMode);
}

/* ══════════════════════════════════════════════════
   PALETTES QUANTILES v14
/* ══════════════════════════════════════════════════
   PALETTES QUANTILES v14
══════════════════════════════════════════════════ */
const POP_DENSITY_COLORS=[
  {th:25,   col:'#a8d8ea', lbl:'< 25 hab/km²  (très rural)'},
  {th:60,   col:'#52b788', lbl:'25–60 (rural)'},
  {th:150,  col:'#f9c74f', lbl:'60–150 (semi-rural)'},
  {th:500,  col:'#f4845f', lbl:'150–500 (peri-urbain)'},
  {th:Infinity, col:'#e63946', lbl:'> 500 (urbain)'},
];
function getPopDensityColor(den){
  for(const e of POP_DENSITY_COLORS){if(den<e.th)return e.col;}
  return POP_DENSITY_COLORS[POP_DENSITY_COLORS.length-1].col;
}

const LAYER_COLORS_5={
  'csp-agri': ['#edf8e9','#bae4b3','#74c476','#31a354','#006d2c'],
  'csp-arti': ['#feedde','#fdbe85','#fd8d3c','#e6550d','#a63603'],
  'csp-cadre':['#eff3ff','#c6dbef','#6baed6','#2171b5','#08519c'],
  'csp-pi':   ['#f2f0f7','#cbc9e2','#9e9ac8','#756bb1','#54278f'],
  'csp-emp':  ['#ffffd4','#fed98e','#fe9929','#d95f0e','#993404'],
  'csp-ouv':  ['#fff5f0','#fdbdab','#fc6955','#de2d26','#a50f15'],
  'age-0014': ['#eff3ff','#c6dbef','#6baed6','#2171b5','#08519c'],
  'age-1529': ['#f7fcf5','#c7e9c0','#74c476','#238b45','#005a32'],
  'age-3044': ['#fff5eb','#fdd0a2','#fd8d3c','#d94801','#7f2704'],
  'age-4559': ['#fff5f0','#fdbdab','#fc6955','#de2d26','#a50f15'],
  'age-6074': ['#f2f0f7','#cbc9e2','#9e9ac8','#756bb1','#3f007d'],
  'age-75p':  ['#e5f5f9','#99d8c9','#41b6c4','#1c87b0','#084081'],
  'log-prop': ['#ffffd4','#fed98e','#fe9929','#d95f0e','#993404'],
  'log-loc':  ['#f7fbff','#c6dbef','#6baed6','#2171b5','#084594'],
  'log-maison':['#f7fcf5','#c7e9c0','#74c476','#238b45','#005a32'],
  'log-appart':['#f2f0f7','#cbc9e2','#9e9ac8','#756bb1','#3f007d'],
  'log-vac':  ['#fff5f0','#fdbdab','#fc6955','#de2d26','#a50f15'],
  'log-sec':  ['#e5f5f9','#99d8c9','#41b6c4','#1c87b0','#084081'],
};

let _qtCache={};
function _clearQtCache(){_qtCache={};}

function getValueForMode(code,mode){
  if(mode.startsWith('age-'))return getAgePct(code,mode);
  if(mode.startsWith('log-'))return getLogPct(code,mode);
  if(mode in CSP_LAYER_MAP){const d=getCspData(code);return d?d.pcts[CSP_LAYER_MAP[mode]]:null;}
  if((mode.startsWith('elec-') || mode.startsWith('elec15-') || mode.startsWith('eleclegis-')) && !mode.includes('winner'))return getElecValue(code,mode);
  return null;
}

function computeQuantileTh(mode,n=5){
  if(_qtCache[mode])return _qtCache[mode];
  const vals=allCommunes.map(c=>getValueForMode(c.code,mode)).filter(v=>v!==null&&v>=0).sort((a,b)=>a-b);
  if(vals.length<n)return _qtCache[mode]=null;
  const th=[];for(let i=1;i<n;i++)th.push(vals[Math.floor(i*vals.length/n)]);
  return _qtCache[mode]=th;
}

function getQuantileColor(code,mode){
  const pal=LAYER_COLORS_5[mode];if(!pal)return null;
  const val=getValueForMode(code,mode);if(val===null)return null;
  const th=computeQuantileTh(mode);if(!th)return pal[2];
  let cls=th.length;
  for(let i=0;i<th.length;i++){if(val<=th[i]){cls=i;break;}}
  return pal[cls];
}

const COMMUNE_CONTOURS={"60001":{"type":"Polygon","coordinates":[[[1.7713,49.7102],[1.7742,49.7077],[1.7729,49.7021],[1.7736,49.7002],[1.7779,49.6979],[1.7868,49.6959],[1.7905,49.6921],[1.7925,49.6854],[1.7953,49.6815],[1.77,49.6835],[1.7703,49.6849],[1.7655,49.6859],[1.7655,49.6867],[1.7636,49.6875],[1.7559,49.6822],[1.7523,49.6811],[1.7503,49.6857],[1.7506,49.6893],[1.7489,49.6927],[1.7509,49.6939],[1.751,49.6952],[1.745,49.6982],[1.75,49.7003],[1.7564,49.7015],[1.7651,49.706],[1.7713,49.7102]]]},"60002":{"type":"Polygon","coordinates":[[[2.1367,49.3708],[2.1381,49.3723],[2.1366,49.3733],[2.1431,49.375],[2.1475,49.3739],[2.1473,49.3734],[2.1495,49.374],[2.15,49.3726],[2.153,49.3732],[2.1544,49.3715],[2.1556,49.3717],[2.1588,49.3689],[2.162,49.3687],[2.162,49.3698],[2.1654,49.3733],[2.1662,49.3766],[2.1702,49.3789],[2.1711,49.3781],[2.1699,49.3769],[2.1703,49.3759],[2.1724,49.3752],[2.1738,49.3768],[2.1761,49.3763],[2.182,49.3722],[2.1782,49.367],[2.1742,49.3685],[2.1682,49.3677],[2.1658,49.3684],[2.1637,49.366],[2.1654,49.3646],[2.1694,49.365],[2.1711,49.364],[2.1715,49.3626],[2.1703,49.3622],[2.1713,49.3604],[2.1698,49.3596],[2.1707,49.359],[2.1682,49.3578],[2.173,49.3511],[2.1687,49.3502],[2.1693,49.3489],[2.1665,49.3479],[2.1641,49.3474],[2.1638,49.349],[2.1617,49.3485],[2.1608,49.3492],[2.157,49.3475],[2.1619,49.341],[2.1608,49.3406],[2.1301,49.3606],[2.132,49.3625],[2.1331,49.3653],[2.1381,49.3702],[2.1367,49.3708]]]},"60003":{"type":"Polygon","coordinates":[[[2.1871,49.519],[2.187,49.5181],[2.1839,49.5166],[2.1831,49.5173],[2.182,49.5165],[2.181,49.5171],[2.1703,49.5067],[2.1685,49.5075],[2.1678,49.5067],[2.1664,49.5073],[2.1659,49.5068],[2.165,49.5073],[2.1662,49.5094],[2.1647,49.511],[2.1627,49.5097],[2.1599,49.5116],[2.1509,49.5131],[2.1516,49.5153],[2.1507,49.5158],[2.1491,49.5151],[2.1484,49.5137],[2.1474,49.5139],[2.1478,49.5195],[2.1468,49.5215],[2.1485,49.5255],[2.1481,49.5262],[2.152,49.5299],[2.1539,49.5293],[2.1565,49.5334],[2.1607,49.5318],[2.172,49.5299],[2.1722,49.5284],[2.174,49.5267],[2.1762,49.5281],[2.1796,49.5258],[2.1814,49.5268],[2.1806,49.5263],[2.1813,49.5258],[2.1855,49.524],[2.1871,49.519]]]},"60004":{"type":"Polygon","coordinates":[[[1.987,49.5651],[1.9911,49.5627],[1.9966,49.566],[2.005,49.5674],[2.0072,49.5669],[2.0104,49.5631],[2.0025,49.5617],[2.0063,49.5594],[2.0064,49.5583],[2.0083,49.5579],[2.0032,49.5546],[2.0011,49.5524],[2.001,49.5506],[1.9991,49.5482],[1.9957,49.548],[1.9905,49.5451],[1.9911,49.5442],[1.9871,49.5424],[1.9851,49.5436],[1.9816,49.5437],[1.9794,49.5427],[1.9767,49.5438],[1.9712,49.541],[1.9629,49.5432],[1.9581,49.5425],[1.9566,49.5435],[1.9544,49.5436],[1.9435,49.5431],[1.9387,49.5444],[1.9335,49.5471],[1.9313,49.5492],[1.9299,49.5521],[1.939,49.5574],[1.9343,49.559],[1.9346,49.5595],[1.951,49.5577],[1.9605,49.5625],[1.9624,49.5619],[1.9641,49.5643],[1.9667,49.564],[1.9695,49.566],[1.9656,49.5691],[1.9702,49.5743],[1.9758,49.5795],[1.9839,49.5838],[1.987,49.5651]]]},"60005":{"type":"Polygon","coordinates":[[[2.9383,49.1048],[2.94,49.1077],[2.9378,49.1087],[2.9396,49.1099],[2.9363,49.1124],[2.9382,49.1135],[2.936,49.1163],[2.9373,49.1167],[2.9375,49.1195],[2.9398,49.1198],[2.9401,49.1213],[2.9427,49.1213],[2.9381,49.1274],[2.9384,49.1299],[2.9442,49.1291],[2.9448,49.1321],[2.9465,49.1326],[2.9473,49.1338],[2.9487,49.133],[2.9494,49.1302],[2.9555,49.1331],[2.9576,49.1334],[2.9577,49.1344],[2.964,49.1349],[2.9669,49.1337],[2.9658,49.132],[2.9658,49.1237],[2.968,49.1115],[2.9722,49.1106],[2.9736,49.1077],[2.9733,49.1045],[2.9724,49.103],[2.9744,49.1029],[2.9733,49.101],[2.9774,49.1002],[2.9714,49.089],[2.9681,49.0897],[2.9686,49.0915],[2.9652,49.0911],[2.9606,49.0881],[2.9588,49.0878],[2.9565,49.0853],[2.9484,49.0869],[2.9458,49.0883],[2.9462,49.0891],[2.9451,49.0889],[2.9454,49.0895],[2.9439,49.0901],[2.945,49.0904],[2.9469,49.093],[2.946,49.0936],[2.9432,49.0921],[2.9418,49.0932],[2.9416,49.0908],[2.9353,49.0919],[2.936,49.0929],[2.93,49.0952],[2.9328,49.0986],[2.9363,49.0971],[2.9422,49.0996],[2.9399,49.1002],[2.9364,49.103],[2.9383,49.1048]]]},"60006":{"type":"Polygon","coordinates":[[[2.5699,49.3126],[2.5764,49.3154],[2.5762,49.3174],[2.575,49.3183],[2.5752,49.3195],[2.5726,49.32],[2.5722,49.3214],[2.5731,49.3238],[2.5768,49.3244],[2.5795,49.3285],[2.6032,49.3317],[2.604,49.3105],[2.6008,49.3095],[2.578,49.3064],[2.5775,49.3077],[2.574,49.3075],[2.5738,49.3092],[2.5745,49.3092],[2.574,49.31],[2.573,49.3096],[2.5718,49.3104],[2.5699,49.3126]]]},"60007":{"type":"Polygon","coordinates":[[[2.3884,49.3699],[2.3721,49.3641],[2.3736,49.3675],[2.3753,49.367],[2.3781,49.369],[2.3759,49.3712],[2.3807,49.3729],[2.379,49.3735],[2.3769,49.373],[2.3773,49.3736],[2.3752,49.3758],[2.3763,49.3767],[2.3757,49.377],[2.371,49.3769],[2.3692,49.3782],[2.3692,49.3796],[2.3705,49.3801],[2.3687,49.3809],[2.3675,49.3808],[2.3682,49.3796],[2.3655,49.3807],[2.3622,49.3801],[2.3631,49.381],[2.3628,49.3818],[2.3607,49.3811],[2.3591,49.3781],[2.3565,49.378],[2.3558,49.3786],[2.3589,49.3809],[2.3568,49.381],[2.3563,49.3817],[2.3544,49.3804],[2.3522,49.3819],[2.3524,49.3828],[2.3508,49.3832],[2.3524,49.3841],[2.3512,49.3855],[2.3505,49.3851],[2.349,49.386],[2.35,49.387],[2.349,49.3873],[2.3504,49.3875],[2.3515,49.3901],[2.3564,49.3899],[2.3562,49.3891],[2.3573,49.3891],[2.357,49.3903],[2.3623,49.3904],[2.3639,49.3941],[2.3659,49.3956],[2.3655,49.3973],[2.3669,49.3982],[2.3663,49.4024],[2.3671,49.4034],[2.3692,49.4035],[2.3687,49.4058],[2.3698,49.4072],[2.3749,49.4086],[2.3744,49.4103],[2.3728,49.411],[2.375,49.4132],[2.3767,49.4126],[2.3788,49.4149],[2.3771,49.4154],[2.3821,49.4219],[2.385,49.4235],[2.3894,49.4245],[2.3997,49.4245],[2.3993,49.4218],[2.3973,49.42],[2.3996,49.4198],[2.3995,49.4183],[2.4039,49.4162],[2.4058,49.4163],[2.4028,49.4092],[2.4005,49.4075],[2.3983,49.4041],[2.398,49.4027],[2.4005,49.4024],[2.4009,49.401],[2.4019,49.4013],[2.4023,49.4003],[2.4021,49.3995],[2.4001,49.3986],[2.4004,49.3979],[2.3991,49.3962],[2.4015,49.3917],[2.4078,49.3886],[2.4063,49.3856],[2.3983,49.3883],[2.3929,49.3835],[2.3917,49.3821],[2.3943,49.3817],[2.3937,49.3802],[2.3911,49.3783],[2.3893,49.3754],[2.388,49.3752],[2.3884,49.3732],[2.386,49.3729],[2.3884,49.3699]]]},"60008":{"type":"Polygon","coordinates":[[[2.3997,49.4245],[2.3995,49.4312],[2.4125,49.4319],[2.4135,49.4328],[2.4136,49.4347],[2.4151,49.4352],[2.4169,49.4341],[2.4247,49.4346],[2.4354,49.4341],[2.4355,49.4317],[2.4411,49.4328],[2.443,49.4325],[2.4446,49.4321],[2.4463,49.4295],[2.4441,49.4266],[2.4417,49.4258],[2.4422,49.4254],[2.4318,49.4178],[2.4292,49.4167],[2.4247,49.412],[2.4225,49.4123],[2.4208,49.4114],[2.4125,49.4127],[2.4114,49.4103],[2.4107,49.4104],[2.4108,49.4075],[2.4049,49.4035],[2.4037,49.4019],[2.4024,49.4021],[2.4009,49.401],[2.4005,49.4024],[2.398,49.4027],[2.3983,49.4041],[2.4005,49.4075],[2.4028,49.4092],[2.4058,49.4163],[2.4039,49.4162],[2.3995,49.4183],[2.3996,49.4198],[2.3973,49.42],[2.3993,49.4218],[2.3997,49.4245]]]},"60009":{"type":"Polygon","coordinates":[[[2.079,49.399],[2.0769,49.4023],[2.0761,49.4021],[2.0722,49.407],[2.079,49.4089],[2.0796,49.4076],[2.0831,49.4066],[2.0895,49.4059],[2.0884,49.4029],[2.0891,49.4028],[2.0975,49.4039],[2.1039,49.4038],[2.1078,49.4056],[2.1102,49.4083],[2.1119,49.4075],[2.1124,49.4085],[2.1169,49.4066],[2.1254,49.4153],[2.1257,49.4194],[2.1293,49.4199],[2.1297,49.4186],[2.1309,49.4203],[2.1333,49.42],[2.136,49.4227],[2.142,49.4214],[2.1402,49.4208],[2.1413,49.4202],[2.1406,49.4194],[2.1434,49.4188],[2.1506,49.41],[2.1586,49.4057],[2.1562,49.4043],[2.1593,49.4022],[2.1561,49.4007],[2.1526,49.4011],[2.1466,49.3999],[2.14,49.4019],[2.1377,49.3966],[2.1303,49.3957],[2.1282,49.3964],[2.125,49.3947],[2.1225,49.3963],[2.1215,49.3957],[2.1204,49.3923],[2.124,49.3923],[2.1249,49.393],[2.1274,49.3917],[2.1279,49.3895],[2.1264,49.3893],[2.1268,49.3881],[2.1315,49.39],[2.1327,49.388],[2.1358,49.3872],[2.1352,49.3839],[2.1358,49.3836],[2.136,49.3808],[2.1367,49.3808],[2.1355,49.3796],[2.1338,49.3796],[2.1336,49.3786],[2.1361,49.378],[2.1357,49.3776],[2.1372,49.3742],[2.1266,49.3708],[2.1274,49.37],[2.1232,49.3677],[2.1193,49.3677],[2.1076,49.3753],[2.1055,49.3776],[2.107,49.3788],[2.1053,49.3844],[2.1004,49.3831],[2.0936,49.3909],[2.0894,49.3892],[2.0879,49.392],[2.0857,49.3923],[2.0843,49.3945],[2.0844,49.3972],[2.0831,49.3967],[2.079,49.399]]]},"60010":{"type":"Polygon","coordinates":[[[2.0802,49.2211],[2.0809,49.2216],[2.0789,49.2289],[2.0771,49.2316],[2.0875,49.2336],[2.0983,49.2295],[2.1131,49.2322],[2.114,49.2297],[2.1154,49.23],[2.1176,49.2269],[2.1198,49.2221],[2.1201,49.2192],[2.1262,49.2146],[2.1467,49.212],[2.1483,49.2126],[2.1514,49.2118],[2.1725,49.2125],[2.1714,49.2122],[2.1726,49.2018],[2.1694,49.2011],[2.1664,49.2016],[2.1636,49.2002],[2.1641,49.1994],[2.1598,49.1985],[2.1547,49.1956],[2.1554,49.192],[2.1548,49.1915],[2.1576,49.1879],[2.1521,49.1836],[2.148,49.185],[2.1468,49.188],[2.1412,49.1859],[2.1408,49.1789],[2.1365,49.179],[2.1369,49.1808],[2.1351,49.1883],[2.1352,49.1912],[2.1318,49.1907],[2.13,49.1916],[2.1307,49.1925],[2.128,49.1936],[2.1255,49.1928],[2.126,49.1917],[2.1223,49.189],[2.1179,49.1872],[2.1133,49.1865],[2.1128,49.1875],[2.1105,49.1875],[2.1091,49.1909],[2.1036,49.1889],[2.1021,49.1904],[2.0977,49.1892],[2.0953,49.1901],[2.0958,49.1916],[2.0925,49.1934],[2.0923,49.1942],[2.089,49.1938],[2.0889,49.1962],[2.0927,49.1953],[2.0927,49.1963],[2.0919,49.1967],[2.0925,49.1975],[2.0903,49.1982],[2.0922,49.2012],[2.0905,49.2017],[2.0914,49.205],[2.0904,49.2061],[2.0909,49.2086],[2.0879,49.2091],[2.0871,49.2077],[2.0834,49.2056],[2.0824,49.2057],[2.0827,49.2069],[2.0807,49.2069],[2.0803,49.2058],[2.079,49.2059],[2.0805,49.2091],[2.0808,49.212],[2.0843,49.2174],[2.082,49.2185],[2.083,49.2198],[2.0824,49.2206],[2.0802,49.2211]]]},"60011":{"type":"Polygon","coordinates":[[[2.865,49.6272],[2.8643,49.6259],[2.8622,49.6251],[2.8618,49.6275],[2.86,49.6289],[2.8522,49.6245],[2.8454,49.6261],[2.8462,49.6221],[2.8402,49.6184],[2.8342,49.6176],[2.8282,49.6181],[2.8252,49.6192],[2.82,49.6179],[2.8189,49.6193],[2.8236,49.6219],[2.8256,49.6219],[2.816,49.6278],[2.8168,49.6323],[2.8185,49.632],[2.8274,49.6266],[2.8284,49.6268],[2.8304,49.6291],[2.8281,49.634],[2.8321,49.6338],[2.8342,49.6327],[2.8348,49.6312],[2.8364,49.6307],[2.8384,49.6282],[2.8405,49.6277],[2.8445,49.6308],[2.8439,49.6323],[2.8411,49.635],[2.8395,49.6344],[2.8307,49.6358],[2.83,49.6347],[2.8294,49.6354],[2.8274,49.6346],[2.8264,49.6354],[2.8258,49.6348],[2.825,49.6354],[2.8236,49.6346],[2.822,49.6349],[2.8231,49.637],[2.8219,49.6383],[2.8167,49.6397],[2.8119,49.6393],[2.8081,49.6458],[2.8051,49.6466],[2.8053,49.649],[2.8038,49.6496],[2.8046,49.6502],[2.8024,49.659],[2.8006,49.6583],[2.7969,49.6606],[2.8014,49.662],[2.8049,49.6599],[2.8072,49.6605],[2.8212,49.6592],[2.8245,49.6615],[2.8252,49.6611],[2.8256,49.6622],[2.8267,49.6618],[2.8278,49.6626],[2.833,49.6593],[2.8377,49.6622],[2.8442,49.6573],[2.8446,49.652],[2.8463,49.6486],[2.8493,49.6464],[2.8592,49.6438],[2.8575,49.6428],[2.8615,49.6413],[2.8614,49.6375],[2.865,49.6272]]]},"60012":{"type":"Polygon","coordinates":[[[2.159,49.2733],[2.1613,49.2694],[2.1628,49.2729],[2.171,49.2715],[2.1737,49.2699],[2.1735,49.2668],[2.1761,49.2629],[2.1752,49.2604],[2.1775,49.2559],[2.1795,49.2561],[2.1819,49.2537],[2.1807,49.2509],[2.1825,49.249],[2.1824,49.2469],[2.1811,49.2472],[2.1801,49.2457],[2.1807,49.2454],[2.1793,49.2442],[2.1799,49.2439],[2.1786,49.2434],[2.1775,49.2441],[2.1747,49.2472],[2.1725,49.2466],[2.1737,49.2448],[2.17,49.2438],[2.1643,49.2489],[2.1633,49.2481],[2.1625,49.2499],[2.1575,49.2505],[2.1572,49.2499],[2.1549,49.25],[2.1526,49.2537],[2.1513,49.259],[2.159,49.26],[2.1613,49.2681],[2.1602,49.2681],[2.1601,49.2692],[2.159,49.2687],[2.1576,49.2703],[2.1573,49.2734],[2.159,49.2733]]]},"60013":{"type":"Polygon","coordinates":[[[2.4855,49.2997],[2.4862,49.301],[2.4838,49.3035],[2.4877,49.3054],[2.4881,49.3069],[2.4927,49.309],[2.4891,49.3146],[2.4834,49.3185],[2.4918,49.3209],[2.4923,49.3205],[2.5134,49.3298],[2.5169,49.3279],[2.5198,49.3282],[2.5214,49.3242],[2.5187,49.3233],[2.5196,49.3222],[2.5186,49.3218],[2.519,49.3205],[2.5182,49.3201],[2.5184,49.3191],[2.5162,49.3185],[2.5165,49.3175],[2.5147,49.315],[2.5148,49.313],[2.5142,49.3131],[2.5146,49.3082],[2.5078,49.3022],[2.5047,49.3031],[2.5015,49.3052],[2.4855,49.2997]]]},"60014":{"type":"Polygon","coordinates":[[[2.5095,49.5001],[2.5077,49.4984],[2.5086,49.4974],[2.5104,49.4972],[2.5121,49.4948],[2.5141,49.4949],[2.5175,49.49],[2.5154,49.4898],[2.517,49.4875],[2.5199,49.4887],[2.5241,49.4863],[2.5267,49.4798],[2.5281,49.4794],[2.5145,49.4772],[2.5141,49.4815],[2.5018,49.482],[2.5013,49.4779],[2.495,49.4792],[2.4939,49.4774],[2.4848,49.4793],[2.4822,49.4839],[2.4721,49.4951],[2.4731,49.4956],[2.4723,49.4986],[2.4803,49.4967],[2.4829,49.4985],[2.4889,49.4965],[2.4928,49.4976],[2.4956,49.4959],[2.4974,49.4963],[2.4953,49.4976],[2.5003,49.5009],[2.5041,49.4995],[2.507,49.5014],[2.5095,49.5001]]]},"60015":{"type":"Polygon","coordinates":[[[2.3263,49.3205],[2.324,49.3236],[2.3233,49.3222],[2.3195,49.3241],[2.3188,49.3253],[2.3161,49.3256],[2.3174,49.3264],[2.3161,49.3271],[2.3193,49.3294],[2.3163,49.3307],[2.3167,49.3321],[2.3154,49.3323],[2.3162,49.3342],[2.3217,49.3349],[2.3213,49.3369],[2.3195,49.3376],[2.3202,49.3384],[2.318,49.3399],[2.3181,49.342],[2.3195,49.3428],[2.319,49.3411],[2.3198,49.3398],[2.3221,49.3403],[2.3256,49.3453],[2.3269,49.3462],[2.3293,49.3464],[2.3289,49.3492],[2.33,49.3465],[2.3399,49.3487],[2.3395,49.346],[2.3418,49.3467],[2.3438,49.3462],[2.3403,49.3394],[2.3332,49.3305],[2.3351,49.3284],[2.3382,49.3275],[2.3327,49.3247],[2.3329,49.3226],[2.3319,49.3215],[2.3263,49.3205]]]},"60016":{"type":"Polygon","coordinates":[[[2.3438,49.3462],[2.3457,49.3496],[2.3497,49.3537],[2.3455,49.358],[2.3473,49.36],[2.3497,49.3592],[2.3544,49.3609],[2.3562,49.3667],[2.3571,49.3662],[2.3576,49.3672],[2.3603,49.366],[2.3641,49.366],[2.3645,49.3678],[2.3687,49.3666],[2.3698,49.3687],[2.3737,49.3675],[2.3721,49.3641],[2.3796,49.3665],[2.3798,49.3647],[2.3817,49.3626],[2.3807,49.3624],[2.3808,49.3612],[2.3837,49.3551],[2.3851,49.3494],[2.3821,49.3494],[2.3802,49.3465],[2.3843,49.3436],[2.3849,49.342],[2.3763,49.3398],[2.3721,49.3343],[2.3631,49.3369],[2.3607,49.3347],[2.361,49.3342],[2.3568,49.3358],[2.3548,49.3339],[2.3466,49.3371],[2.3469,49.3398],[2.3411,49.3419],[2.3438,49.3462]]]},"60017":{"type":"Polygon","coordinates":[[[2.4096,49.5591],[2.411,49.5576],[2.3953,49.5516],[2.3981,49.5483],[2.3967,49.5473],[2.3909,49.553],[2.3866,49.5523],[2.3834,49.5536],[2.3818,49.5552],[2.3834,49.5567],[2.3779,49.5601],[2.3707,49.5626],[2.3744,49.5664],[2.369,49.5681],[2.3666,49.5672],[2.3619,49.5679],[2.3695,49.5706],[2.3677,49.5745],[2.3697,49.5744],[2.37,49.5771],[2.369,49.5786],[2.3707,49.58],[2.3644,49.5832],[2.367,49.5849],[2.3707,49.5855],[2.3719,49.5867],[2.3772,49.5833],[2.3762,49.5826],[2.3853,49.5769],[2.3893,49.5804],[2.3925,49.5789],[2.3922,49.5774],[2.3928,49.5765],[2.3922,49.5753],[2.4057,49.5703],[2.4062,49.5672],[2.4084,49.5676],[2.4091,49.5636],[2.4109,49.5634],[2.4096,49.5591]]]},"60019":{"type":"Polygon","coordinates":[[[2.7258,49.4882],[2.7222,49.4895],[2.7246,49.4917],[2.7158,49.4966],[2.7158,49.4979],[2.7043,49.4954],[2.7017,49.4985],[2.7071,49.5002],[2.7066,49.5019],[2.7023,49.5017],[2.7032,49.5019],[2.703,49.5029],[2.697,49.5023],[2.6963,49.5032],[2.6977,49.5058],[2.7003,49.5077],[2.6999,49.5079],[2.7043,49.5111],[2.697,49.5134],[2.7088,49.5194],[2.7192,49.5168],[2.7202,49.5174],[2.7315,49.5059],[2.735,49.5077],[2.739,49.5044],[2.7408,49.5074],[2.7453,49.5061],[2.7456,49.5067],[2.7514,49.5057],[2.7518,49.5072],[2.7572,49.5058],[2.7582,49.5064],[2.762,49.5035],[2.7692,49.4935],[2.7695,49.4889],[2.7702,49.4883],[2.7677,49.4856],[2.7636,49.4869],[2.7619,49.4843],[2.7622,49.4826],[2.7596,49.4811],[2.7596,49.4822],[2.7503,49.4843],[2.751,49.4865],[2.7466,49.4872],[2.7437,49.4861],[2.739,49.4914],[2.736,49.4915],[2.7341,49.4896],[2.7308,49.4888],[2.728,49.4903],[2.7258,49.4882]]]},"60020":{"type":"Polygon","coordinates":[[[2.9979,49.1428],[2.9949,49.1429],[2.9921,49.1441],[2.9901,49.1457],[2.9904,49.1462],[2.9868,49.1473],[2.9869,49.1481],[2.9823,49.1507],[2.9775,49.1494],[2.9735,49.1496],[2.9727,49.1504],[2.9746,49.1512],[2.9749,49.1521],[2.9765,49.152],[2.9767,49.1535],[2.9744,49.1536],[2.9748,49.1544],[2.9708,49.1553],[2.97,49.155],[2.9709,49.1569],[2.9718,49.157],[2.9702,49.1574],[2.9712,49.1594],[2.9691,49.1607],[2.9736,49.1608],[2.9751,49.1654],[2.9766,49.1662],[2.9762,49.167],[2.9794,49.1663],[2.9799,49.1683],[2.9813,49.1685],[2.9807,49.1662],[2.9832,49.166],[2.9828,49.1649],[2.984,49.1649],[2.9854,49.159],[2.9871,49.1583],[2.9895,49.16],[2.9901,49.159],[2.9956,49.1598],[2.9977,49.1593],[3.0009,49.1607],[3.0083,49.1593],[3.0066,49.1565],[3.0047,49.1566],[2.9979,49.1428]]]},"60021":{"type":"Polygon","coordinates":[[[3.1377,49.5786],[3.1383,49.576],[3.1405,49.5764],[3.1407,49.5751],[3.1335,49.5743],[3.1288,49.5722],[3.1277,49.5733],[3.1244,49.5729],[3.1213,49.5708],[3.1154,49.5711],[3.1127,49.57],[3.1131,49.5716],[3.1107,49.578],[3.1079,49.5778],[3.109,49.5783],[3.1081,49.5799],[3.11,49.5802],[3.1043,49.5877],[3.1161,49.5941],[3.1239,49.596],[3.1249,49.5944],[3.1265,49.5949],[3.1275,49.5939],[3.1282,49.5941],[3.1297,49.5922],[3.1308,49.5921],[3.1334,49.59],[3.131,49.5893],[3.1355,49.5806],[3.1364,49.5807],[3.1377,49.5786]]]},"60022":{"type":"Polygon","coordinates":[[[2.5481,49.2225],[2.5459,49.2213],[2.5422,49.2153],[2.5281,49.2105],[2.5262,49.2129],[2.4847,49.216],[2.486,49.2198],[2.4805,49.2201],[2.4807,49.2217],[2.4727,49.2219],[2.4736,49.2272],[2.4826,49.2258],[2.4846,49.2305],[2.4845,49.2339],[2.4875,49.2368],[2.5148,49.2428],[2.5126,49.2434],[2.5151,49.2461],[2.5101,49.248],[2.5123,49.2558],[2.5152,49.2534],[2.5194,49.254],[2.5252,49.2483],[2.5316,49.2471],[2.5304,49.241],[2.529,49.2412],[2.5285,49.24],[2.532,49.2377],[2.539,49.2308],[2.5408,49.2261],[2.5452,49.2247],[2.5481,49.2225]]]},"60023":{"type":"Polygon","coordinates":[[[2.7644,49.3608],[2.7591,49.3611],[2.7556,49.3632],[2.7577,49.3652],[2.7551,49.3676],[2.7543,49.3674],[2.7571,49.376],[2.755,49.377],[2.7562,49.3776],[2.7565,49.3783],[2.7556,49.3787],[2.7564,49.3792],[2.7674,49.3768],[2.769,49.3768],[2.7701,49.3781],[2.777,49.3764],[2.7749,49.3727],[2.7709,49.3691],[2.7644,49.3608]]]},"60024":{"type":"Polygon","coordinates":[[[2.7276,49.4136],[2.7309,49.4114],[2.7228,49.4079],[2.7235,49.4066],[2.7041,49.404],[2.705,49.4017],[2.7043,49.401],[2.6954,49.4014],[2.6966,49.398],[2.6827,49.3972],[2.6845,49.3927],[2.6773,49.3924],[2.6798,49.3907],[2.6776,49.3898],[2.6747,49.3928],[2.6724,49.3918],[2.6645,49.3962],[2.6666,49.3988],[2.6618,49.4068],[2.6637,49.4099],[2.6731,49.4153],[2.6777,49.4138],[2.6855,49.4157],[2.6876,49.415],[2.6907,49.4154],[2.6944,49.4112],[2.6993,49.4138],[2.7127,49.4138],[2.7164,49.4156],[2.7192,49.4148],[2.7195,49.4141],[2.7217,49.4151],[2.7222,49.4135],[2.7243,49.4138],[2.7259,49.4123],[2.7276,49.4136]]]},"60025":{"type":"Polygon","coordinates":[[[3.023,49.4452],[3.0265,49.4469],[3.0262,49.4475],[3.0328,49.4471],[3.0427,49.451],[3.0533,49.4507],[3.0545,49.4485],[3.0579,49.4475],[3.0559,49.4441],[3.0621,49.4438],[3.0613,49.4376],[3.0644,49.438],[3.067,49.4344],[3.0626,49.4338],[3.0658,49.4254],[3.0609,49.4145],[3.0637,49.413],[3.0637,49.4118],[3.0693,49.4107],[3.071,49.4039],[3.0651,49.3988],[3.0616,49.399],[3.053,49.4045],[3.0517,49.4037],[3.0474,49.4037],[3.0382,49.4063],[3.0391,49.4089],[3.0271,49.41],[3.0218,49.4084],[3.0213,49.4132],[3.0234,49.4185],[3.0258,49.4217],[3.0242,49.4256],[3.0231,49.4258],[3.0241,49.4293],[3.0178,49.4301],[3.0206,49.4317],[3.0226,49.4341],[3.0172,49.4358],[3.0216,49.4417],[3.0254,49.4423],[3.023,49.4452]]]},"60026":{"type":"Polygon","coordinates":[[[2.1126,49.5897],[2.1132,49.5895],[2.1125,49.5891],[2.1146,49.5879],[2.1167,49.5893],[2.1341,49.5834],[2.1328,49.5826],[2.1379,49.5809],[2.1371,49.5801],[2.139,49.5793],[2.1381,49.5782],[2.1413,49.5777],[2.1415,49.5752],[2.1456,49.5746],[2.1451,49.564],[2.1445,49.5627],[2.1393,49.5656],[2.1354,49.5641],[2.1322,49.5664],[2.1261,49.5617],[2.1236,49.5635],[2.118,49.5606],[2.1173,49.5625],[2.1049,49.5592],[2.1029,49.5607],[2.1024,49.5587],[2.0973,49.5607],[2.0964,49.5615],[2.0994,49.563],[2.0977,49.5637],[2.1022,49.5676],[2.1022,49.5685],[2.0977,49.5693],[2.1,49.5706],[2.1005,49.5731],[2.0999,49.5732],[2.1018,49.5772],[2.0987,49.5788],[2.1005,49.582],[2.1019,49.5824],[2.0988,49.5856],[2.1034,49.5843],[2.108,49.587],[2.1092,49.5866],[2.1099,49.5882],[2.1126,49.5897]]]},"60027":{"type":"Polygon","coordinates":[[[2.8188,49.1849],[2.8086,49.1875],[2.8087,49.1905],[2.8051,49.1898],[2.8053,49.1907],[2.8028,49.1911],[2.8039,49.1946],[2.8029,49.194],[2.7942,49.196],[2.7927,49.1952],[2.7912,49.1962],[2.792,49.1964],[2.7906,49.1987],[2.7911,49.2014],[2.7896,49.2015],[2.7899,49.2048],[2.7914,49.2051],[2.7933,49.2091],[2.7924,49.2121],[2.7909,49.2132],[2.7911,49.2141],[2.7871,49.2143],[2.7907,49.2253],[2.7904,49.2265],[2.7941,49.2267],[2.7944,49.2279],[2.7998,49.2279],[2.8003,49.2301],[2.8038,49.23],[2.8041,49.2311],[2.8102,49.2316],[2.8088,49.2348],[2.81,49.2351],[2.8266,49.2355],[2.8301,49.2328],[2.8314,49.2308],[2.8328,49.2311],[2.8337,49.2247],[2.8373,49.224],[2.8382,49.2219],[2.834,49.222],[2.8346,49.2203],[2.8374,49.2176],[2.8381,49.2156],[2.8397,49.2157],[2.8413,49.2139],[2.8418,49.2125],[2.8387,49.2113],[2.838,49.209],[2.834,49.2095],[2.8336,49.2058],[2.8299,49.2059],[2.8292,49.2023],[2.8285,49.2024],[2.8286,49.1987],[2.8245,49.1971],[2.8221,49.1923],[2.822,49.1874],[2.8188,49.1849]]]},"60028":{"type":"Polygon","coordinates":[[[2.5595,49.2127],[2.5545,49.2176],[2.5452,49.2247],[2.5408,49.2261],[2.539,49.2308],[2.532,49.2377],[2.5285,49.24],[2.529,49.2412],[2.5304,49.2409],[2.5309,49.2427],[2.5487,49.2505],[2.5538,49.2445],[2.5591,49.2447],[2.5588,49.2427],[2.5676,49.2427],[2.5638,49.2366],[2.571,49.2346],[2.5666,49.2304],[2.5745,49.2259],[2.5681,49.2224],[2.563,49.2158],[2.5595,49.2127]]]},"60029":{"type":"Polygon","coordinates":[[[1.9356,49.3678],[1.9345,49.3682],[1.9331,49.3671],[1.9321,49.3681],[1.933,49.3685],[1.9315,49.37],[1.9401,49.3752],[1.9377,49.3776],[1.9441,49.3811],[1.9471,49.3847],[1.9413,49.3868],[1.9435,49.3901],[1.9468,49.3929],[1.9522,49.3898],[1.9606,49.3865],[1.9654,49.3888],[1.9681,49.3892],[1.971,49.3919],[1.9687,49.397],[1.9706,49.4001],[1.9728,49.4003],[1.9762,49.3992],[1.974,49.3982],[1.9742,49.3962],[1.9764,49.3959],[1.9792,49.3967],[1.9818,49.3946],[1.9892,49.3967],[1.9959,49.4001],[2.0025,49.395],[2.0062,49.3936],[2.0022,49.3912],[2.0043,49.3893],[2.0062,49.3895],[2.0158,49.3845],[2.0177,49.3849],[2.0182,49.3864],[2.0205,49.3855],[2.0242,49.3829],[2.0253,49.3812],[2.0242,49.3803],[2.0257,49.379],[2.0254,49.3785],[2.032,49.3742],[2.0374,49.3764],[2.037,49.3792],[2.04,49.3817],[2.043,49.3825],[2.0483,49.3854],[2.0504,49.3838],[2.0495,49.3829],[2.0501,49.3825],[2.0457,49.3793],[2.0455,49.3781],[2.0461,49.3777],[2.0445,49.374],[2.0405,49.3704],[2.0395,49.3672],[2.0369,49.3667],[2.0317,49.3627],[2.0252,49.3526],[2.0203,49.3544],[2.0201,49.3565],[2.0156,49.3558],[2.016,49.3579],[2.0146,49.3585],[2.0065,49.3579],[2.0064,49.3607],[2.0,49.3603],[1.9972,49.358],[1.9964,49.355],[1.9972,49.3548],[1.9973,49.3517],[1.9991,49.3514],[2.0042,49.3473],[2.0029,49.3449],[1.998,49.3428],[1.9968,49.3416],[1.9918,49.3438],[1.9758,49.3456],[1.9707,49.3477],[1.9684,49.3496],[1.9704,49.3516],[1.9772,49.3503],[1.9787,49.3534],[1.97,49.3545],[1.9655,49.356],[1.9665,49.3565],[1.9642,49.358],[1.9655,49.3589],[1.9559,49.362],[1.9548,49.3626],[1.9559,49.3636],[1.9547,49.3639],[1.9542,49.3651],[1.9489,49.3669],[1.9464,49.3691],[1.9444,49.3678],[1.9433,49.3658],[1.9398,49.3652],[1.9356,49.3678]]]},"60030":{"type":"Polygon","coordinates":[[[2.0624,49.3229],[2.0663,49.3267],[2.0706,49.326],[2.0745,49.3293],[2.0784,49.3307],[2.0799,49.3323],[2.079,49.3327],[2.0799,49.3336],[2.0794,49.3387],[2.0781,49.3417],[2.0776,49.3468],[2.0818,49.3512],[2.0852,49.3562],[2.0869,49.3615],[2.0901,49.3638],[2.0914,49.368],[2.0901,49.37],[2.0915,49.3723],[2.0984,49.3738],[2.1041,49.377],[2.1054,49.3745],[2.1053,49.3728],[2.1086,49.373],[2.1085,49.3715],[2.1092,49.3712],[2.1095,49.3721],[2.1125,49.3705],[2.1104,49.3688],[2.1141,49.3665],[2.1155,49.3677],[2.1177,49.3664],[2.1168,49.3657],[2.118,49.3646],[2.119,49.3657],[2.1217,49.3651],[2.1175,49.3636],[2.1157,49.3641],[2.1156,49.3631],[2.1123,49.3631],[2.1135,49.3613],[2.1086,49.3596],[2.1109,49.3578],[2.1064,49.3556],[2.1076,49.3538],[2.1034,49.3525],[2.1044,49.351],[2.1098,49.3503],[2.1114,49.3473],[2.1109,49.346],[2.1115,49.345],[2.1061,49.3425],[2.1069,49.3415],[2.1061,49.3413],[2.1046,49.3381],[2.1074,49.3369],[2.1049,49.3332],[2.1077,49.332],[2.1063,49.3305],[2.1083,49.3295],[2.0967,49.3251],[2.0942,49.3248],[2.094,49.3259],[2.0909,49.3258],[2.0889,49.3241],[2.084,49.3258],[2.0829,49.3247],[2.087,49.3235],[2.0852,49.32],[2.0858,49.3193],[2.0822,49.3155],[2.0756,49.3145],[2.0689,49.3151],[2.062,49.317],[2.061,49.3174],[2.0619,49.3189],[2.0648,49.3218],[2.067,49.3226],[2.0624,49.3229]]]},"60031":{"type":"Polygon","coordinates":[[[3.038,49.1691],[3.0379,49.1704],[3.0364,49.1719],[3.0381,49.175],[3.0363,49.1769],[3.0349,49.1836],[3.0471,49.1851],[3.0462,49.1882],[3.0504,49.1906],[3.0532,49.1902],[3.0573,49.1959],[3.0643,49.1929],[3.0653,49.1942],[3.069,49.1945],[3.0744,49.1971],[3.0733,49.196],[3.074,49.1957],[3.0758,49.1959],[3.0774,49.1946],[3.0809,49.1945],[3.0843,49.1928],[3.0839,49.1922],[3.0817,49.1931],[3.0817,49.1912],[3.0856,49.1905],[3.0843,49.1888],[3.0807,49.1892],[3.0815,49.1873],[3.0849,49.1863],[3.0859,49.1872],[3.0852,49.1879],[3.0878,49.1876],[3.0878,49.185],[3.0853,49.1843],[3.0836,49.1812],[3.0846,49.1788],[3.0816,49.178],[3.0808,49.1751],[3.0821,49.1747],[3.0813,49.1716],[3.0819,49.1687],[3.0815,49.1653],[3.0838,49.163],[3.0822,49.1617],[3.0847,49.1593],[3.0837,49.1591],[3.0811,49.1609],[3.0742,49.1618],[3.0667,49.1662],[3.0567,49.1679],[3.0492,49.1729],[3.0416,49.1696],[3.038,49.1691]]]},"60032":{"type":"Polygon","coordinates":[[[3.1005,49.4393],[3.1008,49.4606],[3.0993,49.4645],[3.0933,49.4687],[3.1032,49.4687],[3.1138,49.4667],[3.1222,49.4635],[3.1286,49.4623],[3.1426,49.4579],[3.1466,49.456],[3.155,49.4543],[3.1606,49.4519],[3.1606,49.4511],[3.1658,49.4472],[3.1622,49.4459],[3.161,49.4427],[3.1624,49.4406],[3.1648,49.4416],[3.1651,49.4408],[3.1518,49.4363],[3.1462,49.4354],[3.1443,49.434],[3.1439,49.4346],[3.1388,49.4337],[3.1372,49.4325],[3.1314,49.4316],[3.1205,49.4313],[3.1168,49.435],[3.112,49.4357],[3.1107,49.4383],[3.1005,49.4393]]]},"60033":{"type":"Polygon","coordinates":[[[2.501,49.1946],[2.5015,49.1958],[2.5085,49.1951],[2.5158,49.1971],[2.5165,49.1964],[2.5193,49.1964],[2.5194,49.1958],[2.5247,49.1966],[2.5258,49.1938],[2.5352,49.1958],[2.5434,49.1963],[2.5442,49.1977],[2.5454,49.1974],[2.5452,49.196],[2.5566,49.1964],[2.5564,49.1977],[2.5552,49.1986],[2.5564,49.1986],[2.5585,49.1984],[2.5593,49.1957],[2.5613,49.1953],[2.56,49.1928],[2.5613,49.1932],[2.5617,49.1919],[2.5644,49.1919],[2.5567,49.186],[2.553,49.1746],[2.5391,49.169],[2.5263,49.1727],[2.5088,49.1665],[2.4914,49.1833],[2.497,49.1844],[2.4981,49.1929],[2.501,49.1946]]]},"60034":{"type":"Polygon","coordinates":[[[2.4546,49.4599],[2.4581,49.4572],[2.4556,49.4545],[2.4564,49.4467],[2.4529,49.4438],[2.4486,49.4449],[2.4489,49.4416],[2.4541,49.4404],[2.4576,49.437],[2.4554,49.4336],[2.4503,49.4291],[2.4454,49.4311],[2.4446,49.4321],[2.4418,49.4327],[2.4355,49.4317],[2.4354,49.4341],[2.4247,49.4346],[2.4169,49.4341],[2.4151,49.4352],[2.4136,49.4347],[2.4135,49.4328],[2.4125,49.4319],[2.3995,49.4312],[2.399,49.4366],[2.3861,49.4398],[2.3829,49.4391],[2.3803,49.4435],[2.38,49.4451],[2.3839,49.4464],[2.3878,49.4435],[2.3954,49.4438],[2.3919,49.4485],[2.3971,49.4519],[2.3965,49.4544],[2.3999,49.4581],[2.4051,49.4558],[2.4089,49.4557],[2.4088,49.458],[2.4154,49.4597],[2.4211,49.4602],[2.428,49.4581],[2.4301,49.4564],[2.4354,49.4555],[2.4417,49.4563],[2.4447,49.458],[2.4501,49.4562],[2.4546,49.4599]]]},"60035":{"type":"Polygon","coordinates":[[[2.8456,49.6706],[2.8475,49.6722],[2.8833,49.6509],[2.8818,49.6489],[2.882,49.6459],[2.8874,49.6428],[2.8818,49.6404],[2.8795,49.6411],[2.8767,49.6375],[2.8806,49.6359],[2.8768,49.6317],[2.8754,49.6323],[2.8704,49.632],[2.87,49.6306],[2.8677,49.6299],[2.865,49.6272],[2.8614,49.6375],[2.8615,49.6413],[2.8575,49.6428],[2.8592,49.6438],[2.8493,49.6464],[2.8456,49.6495],[2.8444,49.653],[2.8448,49.6559],[2.8433,49.6585],[2.8501,49.6624],[2.85,49.6634],[2.8465,49.6672],[2.847,49.6697],[2.8456,49.6706]]]},"60036":{"type":"Polygon","coordinates":[[[2.5768,49.368],[2.578,49.3691],[2.5708,49.37],[2.5684,49.3774],[2.5641,49.384],[2.561,49.3853],[2.5586,49.3845],[2.5619,49.393],[2.5729,49.4067],[2.5747,49.4062],[2.5746,49.4053],[2.5889,49.4017],[2.5884,49.4001],[2.5929,49.4001],[2.5921,49.3976],[2.5943,49.3977],[2.5932,49.3911],[2.5879,49.3868],[2.5879,49.3846],[2.5851,49.3823],[2.5852,49.3809],[2.5825,49.3795],[2.5832,49.3777],[2.5823,49.3743],[2.5809,49.3741],[2.5816,49.3718],[2.5793,49.3727],[2.5796,49.3685],[2.5768,49.368]]]},"60037":{"type":"Polygon","coordinates":[[[3.1043,49.5877],[3.11,49.5802],[3.1081,49.5799],[3.109,49.5783],[3.1079,49.5778],[3.1107,49.578],[3.1131,49.5716],[3.1127,49.57],[3.1082,49.5705],[3.1076,49.5715],[3.1043,49.5708],[3.1018,49.5716],[3.0955,49.5705],[3.0909,49.5683],[3.0846,49.5695],[3.0809,49.5691],[3.0784,49.5708],[3.0772,49.5691],[3.0753,49.5711],[3.0708,49.5723],[3.0713,49.573],[3.0704,49.5743],[3.071,49.5751],[3.0733,49.5764],[3.0761,49.5765],[3.0758,49.5769],[3.0775,49.5774],[3.0781,49.5787],[3.0717,49.5796],[3.0698,49.5809],[3.07,49.582],[3.0716,49.582],[3.0717,49.5865],[3.0743,49.5868],[3.0749,49.5915],[3.083,49.5926],[3.0863,49.5962],[3.0876,49.5969],[3.0892,49.5966],[3.0895,49.5982],[3.0929,49.5993],[3.0926,49.5998],[3.0967,49.6023],[3.1028,49.599],[3.099,49.5981],[3.0997,49.5966],[3.0991,49.5964],[3.1029,49.5928],[3.1043,49.5877]]]},"60039":{"type":"Polygon","coordinates":[[[2.3569,49.6185],[2.3565,49.6214],[2.3631,49.6217],[2.3644,49.6224],[2.3643,49.6239],[2.3695,49.6264],[2.368,49.6288],[2.3737,49.6299],[2.3736,49.6306],[2.3752,49.6304],[2.3752,49.6296],[2.3769,49.6289],[2.3768,49.633],[2.3799,49.6314],[2.3906,49.6362],[2.3909,49.6324],[2.3898,49.6314],[2.3934,49.6326],[2.3955,49.6309],[2.3947,49.6277],[2.3981,49.6271],[2.3975,49.6263],[2.3983,49.6261],[2.4015,49.6264],[2.4014,49.6253],[2.4,49.6244],[2.4023,49.6241],[2.3997,49.6215],[2.4018,49.6195],[2.3973,49.6173],[2.4024,49.6158],[2.4018,49.6154],[2.4045,49.6142],[2.4039,49.6134],[2.395,49.6159],[2.3906,49.6114],[2.3892,49.6116],[2.3893,49.6109],[2.3868,49.61],[2.3868,49.6108],[2.3815,49.6104],[2.3793,49.6128],[2.3711,49.61],[2.367,49.6141],[2.3637,49.6136],[2.3621,49.6143],[2.3615,49.617],[2.3569,49.6185]]]},"60040":{"type":"Polygon","coordinates":[[[2.6034,49.437],[2.5997,49.4317],[2.6043,49.4319],[2.5993,49.4275],[2.6095,49.4242],[2.6084,49.4212],[2.6152,49.4178],[2.6112,49.4162],[2.6148,49.4134],[2.613,49.4101],[2.6115,49.4102],[2.6087,49.405],[2.5963,49.4011],[2.5968,49.4001],[2.5884,49.4001],[2.5889,49.4017],[2.5746,49.4053],[2.5747,49.4062],[2.5729,49.4067],[2.5711,49.405],[2.5686,49.405],[2.5693,49.4077],[2.5627,49.4076],[2.5642,49.408],[2.5647,49.4095],[2.5615,49.4096],[2.5615,49.4112],[2.5557,49.4113],[2.5554,49.4159],[2.556,49.4185],[2.5536,49.4186],[2.5515,49.4177],[2.5504,49.4194],[2.5503,49.4202],[2.5536,49.4232],[2.5583,49.4241],[2.5625,49.4275],[2.5605,49.4282],[2.5598,49.4272],[2.5516,49.4284],[2.5514,49.4301],[2.5627,49.433],[2.5635,49.4316],[2.569,49.4308],[2.5725,49.4364],[2.569,49.4399],[2.574,49.4422],[2.5812,49.4437],[2.5971,49.4402],[2.6051,49.4395],[2.6034,49.437]]]},"60041":{"type":"Polygon","coordinates":[[[2.2072,49.384],[2.2019,49.3852],[2.1988,49.3871],[2.1965,49.3875],[2.1948,49.3886],[2.1951,49.3896],[2.1938,49.3896],[2.1918,49.3927],[2.1928,49.3931],[2.1937,49.3919],[2.1949,49.3927],[2.1966,49.392],[2.2078,49.3984],[2.2092,49.4002],[2.2138,49.3978],[2.2127,49.3947],[2.2155,49.3945],[2.2204,49.3984],[2.2202,49.4004],[2.2239,49.4006],[2.2245,49.4027],[2.2281,49.402],[2.2279,49.3959],[2.2289,49.3953],[2.2298,49.3924],[2.2373,49.394],[2.243,49.394],[2.2504,49.3928],[2.2568,49.3881],[2.2648,49.3847],[2.2664,49.3829],[2.2641,49.381],[2.2605,49.3812],[2.2584,49.3802],[2.252,49.3739],[2.2397,49.3664],[2.2376,49.369],[2.2346,49.3689],[2.2316,49.3698],[2.2312,49.3705],[2.2326,49.3718],[2.2265,49.3746],[2.2262,49.3759],[2.2246,49.3751],[2.2237,49.3763],[2.2229,49.3758],[2.221,49.3772],[2.2194,49.3769],[2.2194,49.3778],[2.2213,49.3783],[2.2197,49.3801],[2.2164,49.3801],[2.2123,49.3841],[2.2081,49.3831],[2.2072,49.384]]]},"60042":{"type":"Polygon","coordinates":[[[2.4852,49.3596],[2.4983,49.36],[2.4973,49.3566],[2.4955,49.3552],[2.4943,49.3559],[2.493,49.3549],[2.4942,49.3541],[2.4901,49.3473],[2.4798,49.3418],[2.479,49.3425],[2.4689,49.339],[2.4673,49.3391],[2.4666,49.3373],[2.4584,49.3344],[2.4566,49.3344],[2.4559,49.3373],[2.4507,49.336],[2.4502,49.3352],[2.4453,49.3426],[2.4414,49.3402],[2.4406,49.3421],[2.441,49.3447],[2.4402,49.345],[2.441,49.3451],[2.4414,49.3464],[2.4404,49.3497],[2.4411,49.3512],[2.4427,49.3517],[2.4433,49.3572],[2.4453,49.3595],[2.4492,49.3588],[2.4508,49.3574],[2.463,49.3582],[2.4688,49.3626],[2.4735,49.3591],[2.4852,49.3596]]]},"60043":{"type":"Polygon","coordinates":[[[2.9919,49.493],[2.9904,49.4929],[2.9892,49.4908],[2.988,49.4908],[2.983,49.4875],[2.9792,49.4888],[2.9745,49.4892],[2.9733,49.4908],[2.9666,49.4937],[2.9638,49.4929],[2.9695,49.4977],[2.968,49.499],[2.9692,49.5001],[2.9688,49.5016],[2.9654,49.5032],[2.9659,49.5046],[2.968,49.505],[2.9672,49.5076],[2.9678,49.5084],[2.9776,49.5087],[2.979,49.5098],[2.9814,49.51],[2.9821,49.5099],[2.9817,49.5084],[2.99,49.5059],[2.9977,49.5069],[2.9988,49.5044],[3.0033,49.501],[3.0032,49.5004],[3.0004,49.4975],[2.9962,49.497],[2.9946,49.4958],[2.9955,49.4936],[2.9919,49.493]]]},"60044":{"type":"Polygon","coordinates":[[[2.3317,49.3085],[2.3324,49.3078],[2.3321,49.3062],[2.3344,49.3062],[2.3343,49.3038],[2.3371,49.3042],[2.3392,49.3023],[2.3436,49.3013],[2.348,49.2942],[2.3502,49.2937],[2.3488,49.2923],[2.3497,49.2921],[2.3494,49.2905],[2.3461,49.2893],[2.3466,49.2883],[2.339,49.2854],[2.3345,49.2857],[2.3332,49.2825],[2.3321,49.2822],[2.3317,49.283],[2.3301,49.2826],[2.3328,49.286],[2.327,49.2875],[2.3231,49.2866],[2.3225,49.2885],[2.3189,49.2911],[2.3176,49.2913],[2.3171,49.2907],[2.3178,49.2901],[2.3162,49.2899],[2.315,49.2921],[2.3087,49.2904],[2.2956,49.2981],[2.2843,49.3037],[2.2869,49.3046],[2.2873,49.3055],[2.2884,49.3049],[2.2955,49.3064],[2.3,49.306],[2.3026,49.3036],[2.3062,49.3049],[2.3083,49.3027],[2.3109,49.3037],[2.3115,49.3032],[2.3142,49.3052],[2.3158,49.3045],[2.3317,49.3085]]]},"60045":{"type":"Polygon","coordinates":[[[2.6688,49.2322],[2.6722,49.232],[2.6761,49.233],[2.6798,49.2359],[2.6833,49.2374],[2.6889,49.2358],[2.6883,49.2343],[2.6927,49.2333],[2.6957,49.2311],[2.6948,49.2306],[2.6958,49.23],[2.697,49.2309],[2.7008,49.2288],[2.7031,49.2284],[2.7018,49.2269],[2.6984,49.2281],[2.6944,49.2212],[2.6922,49.2209],[2.6898,49.218],[2.686,49.2176],[2.6891,49.2165],[2.6875,49.2162],[2.6883,49.2159],[2.6866,49.2138],[2.6807,49.2157],[2.6792,49.2143],[2.6746,49.2135],[2.6722,49.2056],[2.666,49.2042],[2.665,49.2079],[2.6624,49.2063],[2.658,49.2088],[2.6621,49.2113],[2.6537,49.2097],[2.6549,49.2112],[2.6518,49.2131],[2.6536,49.2141],[2.6493,49.2136],[2.6466,49.2157],[2.6552,49.2216],[2.6495,49.2226],[2.6561,49.2246],[2.6585,49.2264],[2.6513,49.2289],[2.6628,49.2335],[2.6656,49.2337],[2.6688,49.2322]]]},"60046":{"type":"Polygon","coordinates":[[[2.9717,49.188],[2.9812,49.1846],[2.9806,49.1837],[2.9808,49.1793],[2.9783,49.1746],[2.9805,49.1684],[2.9799,49.1683],[2.9794,49.1663],[2.9762,49.167],[2.9766,49.1662],[2.9751,49.1654],[2.9736,49.1608],[2.9691,49.1607],[2.9639,49.1662],[2.9582,49.1658],[2.954,49.168],[2.9541,49.1689],[2.9472,49.169],[2.942,49.1779],[2.9343,49.1769],[2.9276,49.1771],[2.9267,49.1765],[2.9257,49.1776],[2.9265,49.1781],[2.926,49.1796],[2.9246,49.1784],[2.9209,49.1803],[2.9276,49.1858],[2.9278,49.1845],[2.9307,49.1858],[2.9383,49.1871],[2.9409,49.1896],[2.9483,49.1902],[2.9502,49.1872],[2.9548,49.1865],[2.9604,49.1867],[2.9605,49.1859],[2.9716,49.1859],[2.9711,49.187],[2.9717,49.188]]]},"60047":{"type":"Polygon","coordinates":[[[2.7163,49.201],[2.722,49.2016],[2.7215,49.2019],[2.7225,49.2033],[2.7219,49.205],[2.7277,49.2056],[2.7277,49.207],[2.7289,49.2074],[2.7398,49.2067],[2.7411,49.2088],[2.7463,49.2067],[2.7457,49.2032],[2.7532,49.2001],[2.7561,49.1971],[2.7546,49.1968],[2.7553,49.1959],[2.7517,49.1937],[2.7507,49.1928],[2.7514,49.1924],[2.7494,49.1908],[2.7526,49.1901],[2.7552,49.1871],[2.7565,49.1878],[2.7564,49.1871],[2.7577,49.1872],[2.7584,49.1845],[2.7689,49.1859],[2.7699,49.1844],[2.766,49.1833],[2.7704,49.1822],[2.7665,49.1792],[2.7648,49.176],[2.7663,49.1711],[2.7646,49.1709],[2.7647,49.1686],[2.7625,49.1692],[2.7561,49.1674],[2.754,49.164],[2.7545,49.1635],[2.7507,49.162],[2.7504,49.1609],[2.7492,49.1602],[2.7526,49.1573],[2.7478,49.1488],[2.7466,49.1451],[2.7448,49.1454],[2.7447,49.1446],[2.7439,49.1447],[2.7436,49.1427],[2.7412,49.1427],[2.738,49.1391],[2.7349,49.1406],[2.7279,49.1402],[2.7253,49.1438],[2.7177,49.1477],[2.7184,49.1486],[2.7175,49.1554],[2.7156,49.162],[2.7186,49.1625],[2.7181,49.1674],[2.713,49.1674],[2.7107,49.1661],[2.711,49.1667],[2.7081,49.1672],[2.7079,49.1666],[2.7059,49.1673],[2.703,49.1669],[2.7021,49.1682],[2.6999,49.1681],[2.6976,49.1741],[2.6999,49.174],[2.7052,49.1761],[2.7038,49.1795],[2.7099,49.1825],[2.7072,49.1849],[2.7119,49.1874],[2.7127,49.1865],[2.7201,49.1902],[2.7186,49.1929],[2.7146,49.1965],[2.7166,49.1969],[2.7141,49.2],[2.7163,49.201]]]},"60048":{"type":"Polygon","coordinates":[[[2.7793,49.4441],[2.7744,49.4396],[2.7651,49.4425],[2.7638,49.4413],[2.7652,49.4365],[2.7612,49.4372],[2.7604,49.4418],[2.7539,49.4432],[2.7536,49.4453],[2.7506,49.4476],[2.75,49.4495],[2.7421,49.4502],[2.7407,49.4539],[2.7392,49.4527],[2.7366,49.456],[2.7327,49.4536],[2.7316,49.4545],[2.7302,49.4544],[2.7301,49.4575],[2.7286,49.4592],[2.729,49.4633],[2.7265,49.463],[2.726,49.4655],[2.7494,49.4665],[2.7598,49.466],[2.767,49.4679],[2.7702,49.4695],[2.7733,49.4682],[2.7708,49.4646],[2.7722,49.4643],[2.7708,49.4628],[2.7778,49.4573],[2.7731,49.4526],[2.77,49.4538],[2.7665,49.4501],[2.7797,49.4463],[2.781,49.4454],[2.7793,49.4441]]]},"60049":{"type":"Polygon","coordinates":[[[1.7449,49.5395],[1.7393,49.5434],[1.7322,49.5411],[1.7266,49.5418],[1.7276,49.5428],[1.7228,49.5442],[1.7235,49.5451],[1.7243,49.545],[1.7248,49.5462],[1.7241,49.5464],[1.7253,49.5485],[1.7264,49.5483],[1.7283,49.554],[1.729,49.5538],[1.7309,49.5563],[1.7268,49.558],[1.7283,49.5604],[1.73,49.5614],[1.7333,49.559],[1.7333,49.557],[1.7344,49.5569],[1.7366,49.5571],[1.7429,49.5612],[1.7463,49.5596],[1.7452,49.5588],[1.7466,49.558],[1.7458,49.5574],[1.7463,49.5568],[1.7519,49.5522],[1.7531,49.5526],[1.7544,49.5515],[1.7534,49.5509],[1.7544,49.5503],[1.7536,49.5496],[1.7477,49.5465],[1.7486,49.5446],[1.7458,49.5423],[1.7449,49.5395]]]},"60050":{"type":"Polygon","coordinates":[[[2.6244,49.332],[2.6182,49.3304],[2.6098,49.3383],[2.6078,49.3387],[2.6099,49.3409],[2.6091,49.3412],[2.6101,49.3424],[2.6074,49.3419],[2.6082,49.3461],[2.6076,49.347],[2.6165,49.3512],[2.6145,49.3543],[2.6159,49.3545],[2.6165,49.3531],[2.618,49.3534],[2.6193,49.352],[2.6198,49.3525],[2.6225,49.3501],[2.6269,49.3525],[2.627,49.3516],[2.6334,49.3521],[2.6327,49.3535],[2.6358,49.3544],[2.6375,49.3541],[2.6389,49.3565],[2.6471,49.3566],[2.6437,49.3545],[2.6427,49.3521],[2.6355,49.3521],[2.6319,49.3495],[2.6321,49.348],[2.6333,49.3479],[2.6321,49.3477],[2.634,49.3418],[2.6307,49.3418],[2.6326,49.3359],[2.6317,49.3357],[2.6335,49.3349],[2.6304,49.3325],[2.6244,49.332]]]},"60051":{"type":"Polygon","coordinates":[[[2.0912,49.6911],[2.0879,49.6903],[2.0765,49.6831],[2.0731,49.6818],[2.0749,49.6803],[2.0755,49.6784],[2.0485,49.6695],[2.0404,49.6658],[2.0376,49.6695],[2.037,49.6694],[2.0346,49.6738],[2.0486,49.678],[2.0464,49.6828],[2.0509,49.6863],[2.0531,49.6861],[2.0538,49.6848],[2.0562,49.6839],[2.0628,49.6861],[2.0654,49.6831],[2.0705,49.6844],[2.0739,49.6863],[2.0816,49.6939],[2.0881,49.6904],[2.0903,49.6921],[2.0912,49.6911]]]},"60052":{"type":"Polygon","coordinates":[[[3.0959,49.6232],[3.0911,49.6305],[3.0893,49.6307],[3.0884,49.6312],[3.0887,49.6319],[3.0855,49.6309],[3.0862,49.6342],[3.0879,49.6374],[3.0878,49.6398],[3.0898,49.6412],[3.091,49.6448],[3.0918,49.6449],[3.0953,49.6505],[3.1056,49.6501],[3.1064,49.6471],[3.1077,49.6469],[3.1084,49.6441],[3.1113,49.6427],[3.11,49.642],[3.1119,49.6418],[3.1114,49.6401],[3.113,49.6394],[3.1101,49.637],[3.1085,49.6369],[3.1128,49.6313],[3.1062,49.6265],[3.0959,49.6232]]]},"60053":{"type":"Polygon","coordinates":[[[2.956,49.6608],[2.9358,49.6586],[2.9348,49.6574],[2.9282,49.6568],[2.9219,49.6537],[2.9192,49.6534],[2.9173,49.6519],[2.9156,49.6518],[2.9116,49.6534],[2.9046,49.6511],[2.901,49.654],[2.9016,49.6545],[2.9005,49.6561],[2.8938,49.6521],[2.8872,49.6511],[2.8866,49.6504],[2.89,49.6496],[2.8877,49.6483],[2.87,49.6588],[2.8755,49.6615],[2.8733,49.661],[2.8718,49.6618],[2.8736,49.6631],[2.8712,49.664],[2.8712,49.6648],[2.8744,49.6655],[2.8783,49.6629],[2.88,49.6635],[2.8819,49.663],[2.8779,49.6666],[2.8789,49.6673],[2.8774,49.6674],[2.8798,49.6689],[2.8809,49.6684],[2.8822,49.669],[2.884,49.6648],[2.887,49.6671],[2.8895,49.6672],[2.8882,49.6686],[2.8886,49.671],[2.8906,49.6729],[2.8917,49.6729],[2.8894,49.6768],[2.8884,49.6822],[2.8916,49.6834],[2.8925,49.6854],[2.8936,49.686],[2.8963,49.6852],[2.8985,49.6864],[2.9001,49.6857],[2.9021,49.6831],[2.903,49.6805],[2.9056,49.681],[2.9103,49.677],[2.914,49.6756],[2.9168,49.6701],[2.9367,49.6742],[2.9347,49.6768],[2.9401,49.6804],[2.9432,49.6739],[2.9486,49.6751],[2.9499,49.6705],[2.9539,49.6663],[2.9491,49.6646],[2.9496,49.6637],[2.9536,49.663],[2.9537,49.6616],[2.9557,49.6614],[2.956,49.6608]]]},"60054":{"type":"Polygon","coordinates":[[[1.9676,49.3442],[1.9707,49.3477],[1.9758,49.3456],[1.9933,49.3433],[1.9968,49.3416],[1.9931,49.3391],[1.994,49.3367],[1.9999,49.3335],[2.0018,49.3314],[2.006,49.3327],[2.0097,49.3323],[2.0227,49.3348],[2.0234,49.3274],[2.0346,49.3221],[2.0278,49.3152],[2.028,49.3146],[2.0348,49.309],[2.0353,49.3058],[2.0369,49.3024],[2.0383,49.3003],[2.0398,49.2998],[2.0385,49.2973],[2.0408,49.2947],[2.0405,49.294],[2.036,49.295],[2.0333,49.2991],[2.0308,49.3008],[2.0277,49.2983],[2.0239,49.2992],[2.0196,49.3016],[2.0197,49.3071],[2.0144,49.3101],[2.0161,49.3138],[2.0112,49.3154],[2.0069,49.3224],[2.0036,49.3244],[1.9894,49.3292],[1.9846,49.3298],[1.9834,49.3313],[1.9825,49.3304],[1.9773,49.3302],[1.9711,49.3328],[1.9695,49.3312],[1.9681,49.3309],[1.9606,49.3332],[1.9619,49.3344],[1.9613,49.337],[1.9649,49.3396],[1.9656,49.3409],[1.9645,49.3409],[1.9676,49.3442]]]},"60055":{"type":"Polygon","coordinates":[[[2.98,49.5937],[2.9581,49.6067],[2.9603,49.6087],[2.959,49.6094],[2.9637,49.6127],[2.9633,49.6132],[2.9728,49.6186],[2.9765,49.6198],[2.981,49.6185],[2.9832,49.619],[2.9845,49.6203],[2.9851,49.6184],[2.987,49.6175],[2.9873,49.6162],[2.9865,49.6152],[2.987,49.6143],[2.9845,49.6118],[2.9841,49.6095],[2.9852,49.6077],[2.9833,49.606],[2.9827,49.6063],[2.9822,49.6052],[2.9856,49.6025],[2.9846,49.6014],[2.9869,49.5995],[2.9865,49.5989],[2.9873,49.5982],[2.9862,49.5977],[2.988,49.5972],[2.9886,49.5957],[2.9896,49.5952],[2.98,49.5937]]]},"60056":{"type":"Polygon","coordinates":[[[2.5857,49.2786],[2.58,49.2797],[2.574,49.2772],[2.5507,49.2933],[2.548,49.3007],[2.5533,49.2999],[2.5662,49.3033],[2.5801,49.3034],[2.5804,49.3],[2.5816,49.2977],[2.5842,49.2956],[2.5836,49.2953],[2.5848,49.2937],[2.5841,49.2934],[2.5853,49.291],[2.5845,49.2911],[2.5842,49.2894],[2.5833,49.2897],[2.5846,49.2886],[2.5857,49.2786]]]},"60057":{"type":"Polygon","coordinates":[[[2.0601,49.4626],[2.0624,49.4632],[2.0647,49.4605],[2.0656,49.4617],[2.0781,49.4697],[2.079,49.4727],[2.0829,49.4784],[2.0844,49.4822],[2.0872,49.4814],[2.0865,49.4802],[2.0877,49.4789],[2.0922,49.4775],[2.0956,49.4742],[2.093,49.4736],[2.0903,49.4718],[2.091,49.4708],[2.0887,49.4692],[2.0971,49.4639],[2.0953,49.4626],[2.0993,49.4605],[2.0923,49.4566],[2.0999,49.4521],[2.1117,49.4425],[2.1185,49.4501],[2.1285,49.4457],[2.1287,49.4447],[2.1306,49.4439],[2.1327,49.4446],[2.1365,49.4437],[2.14,49.4445],[2.1412,49.4429],[2.1401,49.4407],[2.1378,49.4411],[2.1365,49.4383],[2.1284,49.4384],[2.1286,49.4369],[2.1299,49.4368],[2.1294,49.4357],[2.1317,49.4355],[2.1316,49.4367],[2.1322,49.4367],[2.1338,49.4361],[2.1339,49.4348],[2.1288,49.434],[2.1292,49.4322],[2.1278,49.432],[2.1276,49.4305],[2.1266,49.4307],[2.1255,49.4276],[2.1277,49.427],[2.1269,49.4239],[2.126,49.4241],[2.1259,49.4163],[2.1227,49.4119],[2.1169,49.4066],[2.1124,49.4085],[2.1119,49.4075],[2.1102,49.4083],[2.1078,49.4056],[2.1039,49.4038],[2.0975,49.4039],[2.0891,49.4028],[2.0884,49.4029],[2.0895,49.4059],[2.0831,49.4066],[2.0796,49.4076],[2.079,49.4089],[2.0713,49.4066],[2.069,49.4082],[2.07,49.4086],[2.0674,49.4103],[2.067,49.4115],[2.0658,49.4105],[2.0643,49.4111],[2.0661,49.4133],[2.0645,49.4141],[2.0654,49.415],[2.0643,49.4156],[2.0663,49.418],[2.0619,49.4194],[2.0563,49.4159],[2.0543,49.4178],[2.0592,49.4205],[2.057,49.4215],[2.0569,49.4234],[2.0537,49.4253],[2.0575,49.4271],[2.0542,49.428],[2.0558,49.4288],[2.0519,49.431],[2.0529,49.432],[2.0496,49.4321],[2.0501,49.4335],[2.0491,49.4339],[2.0463,49.4332],[2.0447,49.4355],[2.0348,49.4353],[2.0346,49.4359],[2.0349,49.437],[2.0407,49.4391],[2.0342,49.4438],[2.044,49.4484],[2.0427,49.45],[2.0371,49.4512],[2.0375,49.4528],[2.0444,49.4519],[2.044,49.4524],[2.0478,49.4544],[2.0476,49.456],[2.0581,49.4571],[2.0589,49.4577],[2.0575,49.4594],[2.0598,49.4582],[2.0608,49.4586],[2.0605,49.4604],[2.0594,49.461],[2.0601,49.4626]]]},"60058":{"type":"Polygon","coordinates":[[[2.331,49.626],[2.3389,49.6282],[2.3398,49.629],[2.3421,49.6292],[2.3475,49.6246],[2.3533,49.6215],[2.3533,49.6201],[2.3547,49.6194],[2.3522,49.6162],[2.3568,49.6154],[2.3559,49.613],[2.3551,49.613],[2.3554,49.6114],[2.3546,49.6111],[2.3554,49.6099],[2.3515,49.6082],[2.3503,49.6047],[2.3467,49.6015],[2.3474,49.6007],[2.3376,49.5954],[2.3393,49.5923],[2.3357,49.5908],[2.3366,49.5888],[2.3348,49.5884],[2.3329,49.5908],[2.3207,49.5866],[2.3183,49.5882],[2.3156,49.5871],[2.3147,49.5881],[2.3108,49.5873],[2.311,49.5883],[2.3097,49.5885],[2.31,49.5904],[2.3057,49.5921],[2.3048,49.594],[2.3027,49.5932],[2.3015,49.5938],[2.3043,49.6021],[2.3053,49.6032],[2.3078,49.6017],[2.3101,49.6033],[2.3102,49.6059],[2.3113,49.6057],[2.311,49.6068],[2.3137,49.607],[2.3122,49.609],[2.317,49.6138],[2.3342,49.6221],[2.331,49.626]]]},"60059":{"type":"Polygon","coordinates":[[[3.0437,49.6062],[3.0418,49.6075],[3.0397,49.6077],[3.0392,49.6141],[3.0626,49.61],[3.0657,49.6086],[3.0686,49.6085],[3.0711,49.6067],[3.0769,49.6058],[3.0763,49.605],[3.0768,49.6044],[3.0742,49.6035],[3.0748,49.6021],[3.078,49.6031],[3.0768,49.6009],[3.0785,49.5984],[3.0803,49.5965],[3.0845,49.5949],[3.082,49.5922],[3.0749,49.5915],[3.0743,49.5868],[3.0717,49.5865],[3.0716,49.582],[3.07,49.582],[3.0698,49.5809],[3.0717,49.5796],[3.0781,49.5787],[3.0775,49.5774],[3.0716,49.5756],[3.0681,49.58],[3.0667,49.5796],[3.0664,49.581],[3.0654,49.5808],[3.0648,49.5817],[3.0643,49.5844],[3.0629,49.5843],[3.0625,49.5866],[3.0611,49.5866],[3.0587,49.5926],[3.0549,49.5957],[3.0522,49.5998],[3.0516,49.6012],[3.0522,49.6024],[3.051,49.605],[3.0484,49.6048],[3.0455,49.6066],[3.0437,49.6062]]]},"60060":{"type":"Polygon","coordinates":[[[2.2198,49.1796],[2.2186,49.1807],[2.2121,49.1765],[2.2132,49.1759],[2.2029,49.1741],[2.1991,49.1753],[2.1953,49.1731],[2.1921,49.1736],[2.1889,49.1731],[2.1824,49.1744],[2.182,49.1737],[2.1761,49.176],[2.1775,49.1777],[2.1823,49.18],[2.1817,49.1802],[2.1852,49.1837],[2.1858,49.1833],[2.1884,49.1848],[2.1985,49.1868],[2.2096,49.1922],[2.2207,49.201],[2.2249,49.2021],[2.2252,49.2036],[2.2372,49.2028],[2.2458,49.204],[2.2511,49.1967],[2.2344,49.1909],[2.2256,49.1855],[2.2247,49.1842],[2.225,49.1831],[2.2234,49.1823],[2.2247,49.1797],[2.2271,49.1777],[2.2259,49.1768],[2.2198,49.1796]]]},"60061":{"type":"Polygon","coordinates":[[[2.6564,49.5458],[2.6635,49.5455],[2.6632,49.5404],[2.667,49.5405],[2.6667,49.5367],[2.6691,49.5367],[2.6675,49.5342],[2.662,49.5322],[2.6566,49.5319],[2.6559,49.5298],[2.6538,49.5273],[2.6506,49.5281],[2.6466,49.5279],[2.6456,49.5244],[2.645,49.5244],[2.6454,49.5213],[2.6417,49.5211],[2.6418,49.5232],[2.6396,49.5232],[2.6387,49.5243],[2.6391,49.5301],[2.6409,49.5304],[2.6416,49.5355],[2.6477,49.5382],[2.6448,49.5405],[2.6491,49.544],[2.6486,49.5444],[2.6519,49.543],[2.6521,49.5459],[2.6564,49.5458]]]},"60062":{"type":"Polygon","coordinates":[[[3.0597,49.6708],[3.0644,49.6714],[3.0679,49.6763],[3.0778,49.6826],[3.076,49.6872],[3.08,49.688],[3.0778,49.6893],[3.0796,49.6917],[3.0836,49.6905],[3.0849,49.6915],[3.0839,49.6932],[3.0849,49.6948],[3.0916,49.697],[3.0919,49.6994],[3.0929,49.6998],[3.0957,49.6997],[3.0955,49.6989],[3.0999,49.6987],[3.1069,49.6886],[3.0989,49.6843],[3.0906,49.6692],[3.0909,49.6686],[3.0885,49.6684],[3.0887,49.6675],[3.0872,49.6665],[3.089,49.6614],[3.0825,49.6602],[3.0811,49.6609],[3.0746,49.6611],[3.0678,49.66],[3.0638,49.6633],[3.0649,49.664],[3.0635,49.6671],[3.0597,49.6708]]]},"60063":{"type":"Polygon","coordinates":[[[2.0252,49.3526],[2.0317,49.3627],[2.0369,49.3667],[2.0395,49.3672],[2.0405,49.3704],[2.0445,49.374],[2.0461,49.3777],[2.0455,49.3781],[2.0457,49.3793],[2.0501,49.3825],[2.0495,49.3829],[2.0504,49.3838],[2.0498,49.3845],[2.0521,49.3847],[2.0542,49.3836],[2.0541,49.3829],[2.0583,49.3828],[2.0598,49.3797],[2.0629,49.377],[2.0679,49.3756],[2.0736,49.3763],[2.079,49.3729],[2.0779,49.3728],[2.076,49.3708],[2.0803,49.3696],[2.0811,49.3704],[2.0831,49.3687],[2.0825,49.3676],[2.0838,49.3672],[2.084,49.3681],[2.0855,49.3659],[2.0853,49.3637],[2.0823,49.3606],[2.0865,49.36],[2.0854,49.3565],[2.0818,49.3512],[2.0776,49.3468],[2.0781,49.3417],[2.0794,49.3387],[2.0799,49.3336],[2.079,49.3327],[2.0721,49.3347],[2.0691,49.3336],[2.0689,49.3353],[2.0667,49.3359],[2.0663,49.335],[2.0631,49.3355],[2.0629,49.3321],[2.0573,49.3347],[2.0572,49.3355],[2.0511,49.3362],[2.0518,49.3376],[2.0551,49.3388],[2.0525,49.3416],[2.0552,49.343],[2.0557,49.3448],[2.0535,49.3451],[2.0479,49.3424],[2.0436,49.3433],[2.0435,49.3445],[2.0424,49.3447],[2.037,49.3445],[2.0348,49.3436],[2.0331,49.3443],[2.0342,49.3475],[2.0321,49.349],[2.0298,49.3483],[2.0279,49.3501],[2.0287,49.3508],[2.0278,49.3513],[2.0283,49.3517],[2.0252,49.3526]]]},"60064":{"type":"Polygon","coordinates":[[[3.0123,49.4071],[3.0016,49.407],[2.9975,49.4089],[2.9942,49.4093],[2.9899,49.4122],[2.979,49.4098],[2.9737,49.4112],[2.9693,49.4111],[2.9619,49.4084],[2.9587,49.4105],[2.9591,49.418],[2.964,49.4188],[2.9684,49.4208],[2.9719,49.4199],[2.9736,49.42],[2.975,49.4212],[2.9824,49.4202],[2.9908,49.4242],[2.9957,49.4275],[2.9965,49.429],[2.9983,49.4293],[2.9991,49.4392],[3.0012,49.4392],[3.001,49.4427],[3.002,49.4423],[3.0177,49.4439],[3.0201,49.4467],[3.0217,49.4468],[3.0254,49.4423],[3.0216,49.4417],[3.0172,49.4358],[3.0226,49.4341],[3.0206,49.4317],[3.0178,49.4301],[3.0241,49.4293],[3.0231,49.4258],[3.0242,49.4256],[3.0258,49.4217],[3.0234,49.4185],[3.0213,49.4132],[3.0218,49.4084],[3.0189,49.4085],[3.0123,49.4071]]]},"60065":{"type":"Polygon","coordinates":[[[2.2249,49.3244],[2.2227,49.3239],[2.2223,49.3224],[2.2196,49.3241],[2.2194,49.3257],[2.2184,49.326],[2.2188,49.3282],[2.2076,49.3369],[2.2079,49.3403],[2.2057,49.3413],[2.2073,49.3429],[2.2065,49.343],[2.206,49.3469],[2.2096,49.3469],[2.209,49.3478],[2.2099,49.3485],[2.2093,49.3499],[2.2065,49.3497],[2.2077,49.3506],[2.2053,49.3511],[2.2044,49.3525],[2.2056,49.3528],[2.2056,49.3542],[2.2093,49.356],[2.2153,49.3566],[2.2158,49.3575],[2.2174,49.3577],[2.2172,49.3585],[2.2229,49.3591],[2.2233,49.3607],[2.2256,49.361],[2.2251,49.3631],[2.2315,49.3643],[2.2314,49.3636],[2.2329,49.3629],[2.2369,49.3629],[2.237,49.3621],[2.2379,49.3622],[2.2387,49.3593],[2.2398,49.3595],[2.2406,49.3572],[2.2391,49.3567],[2.2393,49.3557],[2.2423,49.3541],[2.2375,49.352],[2.2385,49.3505],[2.2379,49.35],[2.2348,49.3504],[2.2354,49.3495],[2.2347,49.3488],[2.2371,49.3475],[2.2357,49.3466],[2.2323,49.3408],[2.2342,49.3386],[2.232,49.3366],[2.2341,49.3351],[2.2249,49.3244]]]},"60066":{"type":"Polygon","coordinates":[[[2.8627,49.2717],[2.8599,49.2821],[2.8625,49.287],[2.8633,49.287],[2.8636,49.2886],[2.8644,49.289],[2.8756,49.2892],[2.8762,49.2877],[2.8782,49.287],[2.8785,49.2862],[2.8917,49.2854],[2.8919,49.2835],[2.8933,49.2825],[2.8933,49.2792],[2.8918,49.2789],[2.8902,49.2772],[2.8892,49.2757],[2.8892,49.2742],[2.8875,49.2742],[2.888,49.2683],[2.8627,49.2717]]]},"60067":{"type":"Polygon","coordinates":[[[2.7869,49.2893],[2.7936,49.2919],[2.8001,49.2924],[2.8038,49.2963],[2.8061,49.2951],[2.8083,49.297],[2.816,49.2999],[2.8191,49.3022],[2.8233,49.3077],[2.8296,49.3095],[2.8303,49.3083],[2.8299,49.3066],[2.834,49.3065],[2.8352,49.3052],[2.8342,49.3051],[2.8343,49.303],[2.8356,49.3011],[2.8354,49.2984],[2.8386,49.2966],[2.8372,49.2952],[2.8371,49.2931],[2.8395,49.2925],[2.8385,49.291],[2.8366,49.2911],[2.8359,49.2877],[2.8346,49.2862],[2.829,49.285],[2.8216,49.2735],[2.8057,49.2764],[2.8088,49.271],[2.8086,49.2698],[2.8053,49.2695],[2.8023,49.2707],[2.7949,49.2714],[2.7949,49.2724],[2.7916,49.2742],[2.7777,49.2734],[2.7771,49.2754],[2.7777,49.2757],[2.7839,49.2755],[2.7843,49.2761],[2.7844,49.2767],[2.7825,49.2766],[2.7808,49.2777],[2.7814,49.2792],[2.7844,49.2818],[2.7848,49.2851],[2.7869,49.2893]]]},"60068":{"type":"Polygon","coordinates":[[[2.8216,49.3083],[2.8235,49.3078],[2.8229,49.3067],[2.8191,49.3022],[2.816,49.2999],[2.8083,49.297],[2.8061,49.2951],[2.8038,49.2963],[2.8001,49.2924],[2.7936,49.2919],[2.7869,49.2893],[2.7853,49.2896],[2.7899,49.2932],[2.7927,49.297],[2.7947,49.2977],[2.796,49.2994],[2.7923,49.301],[2.7918,49.3019],[2.7836,49.3032],[2.783,49.3041],[2.7739,49.3073],[2.7754,49.3091],[2.7794,49.3113],[2.781,49.3097],[2.7836,49.3086],[2.7893,49.3123],[2.7908,49.3143],[2.7928,49.3136],[2.7953,49.3142],[2.7967,49.317],[2.7989,49.3164],[2.8031,49.3176],[2.803,49.3214],[2.8068,49.32],[2.8144,49.3202],[2.8184,49.3186],[2.8274,49.3195],[2.8313,49.318],[2.8314,49.3173],[2.8289,49.3176],[2.8281,49.316],[2.8262,49.3156],[2.8229,49.3114],[2.8197,49.3097],[2.8216,49.3083]]]},"60069":{"type":"Polygon","coordinates":[[[2.9209,49.1803],[2.9246,49.1784],[2.926,49.1796],[2.9265,49.1781],[2.9257,49.1776],[2.9267,49.1765],[2.9276,49.1771],[2.9343,49.1769],[2.942,49.1779],[2.9472,49.169],[2.9541,49.1689],[2.954,49.168],[2.9582,49.1658],[2.9639,49.1662],[2.9697,49.1598],[2.9712,49.1594],[2.9702,49.1574],[2.9718,49.157],[2.9709,49.1569],[2.97,49.155],[2.9708,49.1553],[2.9748,49.1544],[2.9744,49.1536],[2.9767,49.1535],[2.9765,49.152],[2.9749,49.1521],[2.9746,49.1512],[2.9727,49.1504],[2.9735,49.1496],[2.9775,49.1494],[2.9719,49.143],[2.97,49.1366],[2.967,49.1336],[2.964,49.1349],[2.9577,49.1344],[2.9576,49.1334],[2.9555,49.1331],[2.9494,49.1302],[2.9485,49.1332],[2.9425,49.1369],[2.9379,49.1386],[2.9329,49.1429],[2.933,49.1437],[2.9286,49.143],[2.9278,49.1463],[2.9243,49.15],[2.9222,49.1499],[2.9166,49.1524],[2.9182,49.1532],[2.9183,49.1557],[2.9193,49.1556],[2.9196,49.1563],[2.9171,49.1572],[2.9182,49.1595],[2.9144,49.1594],[2.9144,49.1625],[2.913,49.1627],[2.9103,49.1655],[2.9108,49.1656],[2.9101,49.1668],[2.9139,49.1677],[2.9095,49.1706],[2.9118,49.1716],[2.9077,49.175],[2.9151,49.1756],[2.9209,49.1803]]]},"60070":{"type":"Polygon","coordinates":[[[2.8437,49.4526],[2.8458,49.4525],[2.84,49.4493],[2.839,49.4496],[2.8308,49.4437],[2.827,49.4434],[2.8291,49.4417],[2.8262,49.4409],[2.8176,49.4359],[2.8163,49.4364],[2.8158,49.4351],[2.8063,49.4425],[2.8052,49.4425],[2.8031,49.4441],[2.8106,49.4484],[2.8117,49.4475],[2.8248,49.4542],[2.8234,49.4561],[2.8255,49.457],[2.8283,49.4597],[2.8322,49.4591],[2.835,49.4574],[2.8363,49.4579],[2.8393,49.4559],[2.8425,49.4552],[2.844,49.4539],[2.8437,49.4526]]]},"60071":{"type":"Polygon","coordinates":[[[2.7338,49.567],[2.7303,49.5686],[2.7314,49.5717],[2.7238,49.5733],[2.7264,49.588],[2.7282,49.5875],[2.7297,49.5887],[2.7313,49.5888],[2.7346,49.587],[2.7363,49.5895],[2.7384,49.5889],[2.7392,49.5877],[2.7458,49.5862],[2.7489,49.5846],[2.7451,49.5829],[2.7457,49.5809],[2.7562,49.5776],[2.757,49.5765],[2.7546,49.5737],[2.7536,49.5681],[2.7499,49.5688],[2.7393,49.5687],[2.7386,49.5672],[2.7375,49.5675],[2.7365,49.5653],[2.7338,49.567]]]},"60072":{"type":"Polygon","coordinates":[[[3.0903,49.3984],[3.0804,49.3978],[3.0809,49.3984],[3.0656,49.3991],[3.071,49.4039],[3.0693,49.4107],[3.0637,49.4118],[3.0637,49.413],[3.0609,49.4145],[3.0658,49.4254],[3.0626,49.4338],[3.067,49.4344],[3.0647,49.4378],[3.0629,49.4389],[3.0709,49.4387],[3.0702,49.4336],[3.0755,49.4326],[3.0789,49.43],[3.0711,49.4234],[3.0707,49.4222],[3.0727,49.4206],[3.0751,49.4212],[3.0754,49.4204],[3.0791,49.4205],[3.0813,49.4195],[3.0941,49.421],[3.0979,49.4102],[3.0955,49.3981],[3.0903,49.3984]]]},"60073":{"type":"Polygon","coordinates":[[[1.856,49.4761],[1.8622,49.4733],[1.8595,49.4718],[1.8612,49.4706],[1.8634,49.4712],[1.8659,49.4708],[1.8662,49.4721],[1.8677,49.4708],[1.8675,49.4697],[1.8718,49.4703],[1.8724,49.4692],[1.8796,49.4671],[1.8847,49.4661],[1.8853,49.4666],[1.8878,49.4594],[1.889,49.4588],[1.8866,49.4564],[1.8924,49.4502],[1.8915,49.4453],[1.8872,49.4437],[1.8805,49.444],[1.8794,49.4428],[1.8794,49.4397],[1.8706,49.4416],[1.856,49.4409],[1.8579,49.442],[1.8569,49.4425],[1.8534,49.4418],[1.8515,49.4429],[1.8475,49.443],[1.846,49.4438],[1.8469,49.4455],[1.8271,49.4501],[1.8355,49.4597],[1.8378,49.4611],[1.84,49.4646],[1.8427,49.4649],[1.8465,49.4676],[1.8485,49.467],[1.8489,49.4698],[1.8499,49.4698],[1.8502,49.4718],[1.856,49.4761]]]},"60074":{"type":"Polygon","coordinates":[[[2.3162,49.2366],[2.3312,49.2397],[2.3426,49.2436],[2.3526,49.2412],[2.359,49.2409],[2.3594,49.2397],[2.3586,49.2383],[2.3604,49.2357],[2.3645,49.2332],[2.3599,49.2309],[2.3622,49.2289],[2.3615,49.2286],[2.3674,49.2235],[2.3747,49.2187],[2.3726,49.2177],[2.3689,49.2196],[2.3648,49.2167],[2.3392,49.2148],[2.3392,49.2106],[2.3339,49.2109],[2.3331,49.2185],[2.3295,49.2231],[2.3281,49.2238],[2.3289,49.2246],[2.3172,49.2322],[2.3192,49.235],[2.3162,49.2366]]]},"60075":{"type":"Polygon","coordinates":[[[2.1837,49.6746],[2.1876,49.6724],[2.1912,49.6756],[2.1951,49.6729],[2.1976,49.6726],[2.198,49.6732],[2.2061,49.6712],[2.2064,49.6706],[2.2014,49.6684],[2.2035,49.6664],[2.2074,49.6665],[2.2075,49.6628],[2.2093,49.6616],[2.2033,49.6591],[2.2013,49.6562],[2.1884,49.6491],[2.1862,49.6485],[2.1836,49.6505],[2.1805,49.6486],[2.1788,49.6494],[2.1758,49.6495],[2.1765,49.6518],[2.1737,49.6532],[2.176,49.655],[2.1764,49.6569],[2.1736,49.6607],[2.1748,49.6639],[2.1761,49.6636],[2.1778,49.6668],[2.1758,49.6698],[2.1759,49.6738],[2.1809,49.6746],[2.1823,49.6755],[2.1837,49.6746]]]},"60076":{"type":"Polygon","coordinates":[[[1.7743,49.6559],[1.7714,49.6561],[1.7714,49.657],[1.7695,49.6571],[1.7612,49.6564],[1.7594,49.6574],[1.7569,49.6566],[1.7557,49.6575],[1.7541,49.6569],[1.7515,49.6594],[1.755,49.6646],[1.7433,49.6694],[1.7322,49.6668],[1.7258,49.663],[1.7239,49.661],[1.7225,49.6616],[1.722,49.6665],[1.7233,49.6695],[1.7226,49.6717],[1.7229,49.6723],[1.7338,49.6739],[1.7457,49.6797],[1.7524,49.6807],[1.7559,49.6822],[1.7636,49.6875],[1.7655,49.6867],[1.7655,49.6859],[1.7703,49.6849],[1.77,49.6835],[1.7951,49.6815],[1.7945,49.6787],[1.795,49.6775],[1.7936,49.6725],[1.795,49.6671],[1.7925,49.6672],[1.788,49.6646],[1.7753,49.6618],[1.7743,49.6559]]]},"60077":{"type":"Polygon","coordinates":[[[2.0562,49.5835],[2.058,49.5819],[2.06,49.5818],[2.0621,49.5837],[2.0651,49.5835],[2.0655,49.5821],[2.0664,49.5825],[2.0677,49.5814],[2.0696,49.5818],[2.0719,49.5782],[2.076,49.5751],[2.075,49.5735],[2.0667,49.5688],[2.0725,49.5667],[2.0736,49.568],[2.0794,49.5657],[2.0876,49.5645],[2.0887,49.5645],[2.0916,49.5676],[2.092,49.5665],[2.0899,49.5604],[2.0835,49.5571],[2.082,49.5552],[2.0818,49.5531],[2.0844,49.5508],[2.0876,49.5498],[2.0904,49.5465],[2.0873,49.5448],[2.0936,49.5402],[2.0885,49.5372],[2.0836,49.5355],[2.0805,49.538],[2.0745,49.5378],[2.0723,49.5408],[2.069,49.5424],[2.0662,49.5454],[2.0651,49.5449],[2.0624,49.5455],[2.0616,49.5446],[2.058,49.5452],[2.0524,49.5429],[2.0475,49.5446],[2.0418,49.5484],[2.0409,49.5504],[2.0419,49.5505],[2.041,49.553],[2.0388,49.5553],[2.04,49.5555],[2.0373,49.5573],[2.0344,49.5612],[2.0254,49.5658],[2.0292,49.5684],[2.0267,49.5696],[2.0323,49.5718],[2.0334,49.5739],[2.0326,49.5774],[2.0336,49.5781],[2.0356,49.5778],[2.041,49.5805],[2.0486,49.5811],[2.0562,49.5835]]]},"60078":{"type":"Polygon","coordinates":[[[2.6207,49.3974],[2.6244,49.3974],[2.6226,49.3916],[2.6319,49.3851],[2.6246,49.3755],[2.6171,49.3749],[2.6164,49.3728],[2.6119,49.3744],[2.6099,49.374],[2.6099,49.3847],[2.6083,49.387],[2.6109,49.3941],[2.6181,49.3927],[2.6179,49.3945],[2.6192,49.394],[2.6188,49.3973],[2.6207,49.3974]]]},"60079":{"type":"Polygon","coordinates":[[[2.8619,49.187],[2.874,49.1911],[2.8796,49.1898],[2.8796,49.1883],[2.8868,49.188],[2.894,49.1847],[2.8931,49.1842],[2.8938,49.1836],[2.8912,49.185],[2.893,49.1836],[2.8925,49.183],[2.8934,49.1835],[2.8965,49.1818],[2.9032,49.1801],[2.9066,49.1756],[2.908,49.1757],[2.9084,49.175],[2.9077,49.175],[2.9118,49.1716],[2.9095,49.1706],[2.9139,49.1677],[2.9101,49.1668],[2.9108,49.1656],[2.9103,49.1655],[2.913,49.1627],[2.9144,49.1625],[2.9144,49.1594],[2.9182,49.1595],[2.9171,49.1572],[2.9196,49.1563],[2.9193,49.1556],[2.9183,49.1557],[2.9182,49.1532],[2.9144,49.1521],[2.909,49.1521],[2.9063,49.1529],[2.907,49.1543],[2.9043,49.1548],[2.8895,49.153],[2.8843,49.1506],[2.8839,49.143],[2.8816,49.1441],[2.8771,49.1444],[2.8763,49.1425],[2.8743,49.1423],[2.8725,49.1409],[2.8667,49.1422],[2.8656,49.1413],[2.8606,49.1418],[2.8573,49.1635],[2.8615,49.1822],[2.8635,49.1828],[2.8619,49.187]]]},"60081":{"type":"Polygon","coordinates":[[[2.1559,49.4854],[2.153,49.4827],[2.1632,49.4774],[2.1653,49.4778],[2.1644,49.4724],[2.1664,49.4722],[2.1658,49.467],[2.1615,49.4656],[2.1594,49.4632],[2.1585,49.4635],[2.1557,49.4597],[2.1459,49.4629],[2.1449,49.4654],[2.143,49.4659],[2.1398,49.4658],[2.1351,49.4639],[2.1313,49.47],[2.1372,49.47],[2.1326,49.4747],[2.143,49.4816],[2.1485,49.4862],[2.1512,49.4874],[2.1559,49.4854]]]},"60082":{"type":"Polygon","coordinates":[[[2.1837,49.6746],[2.1878,49.678],[2.1884,49.6776],[2.1922,49.6801],[2.1942,49.6796],[2.1964,49.6822],[2.1992,49.6822],[2.201,49.6879],[2.2042,49.6869],[2.2045,49.686],[2.209,49.6859],[2.2152,49.6869],[2.2229,49.6868],[2.2224,49.6873],[2.2303,49.6894],[2.2278,49.6914],[2.2291,49.6936],[2.2303,49.6932],[2.2321,49.695],[2.2322,49.6974],[2.2351,49.7001],[2.2327,49.7021],[2.2431,49.7022],[2.2471,49.7017],[2.2497,49.6973],[2.2585,49.6953],[2.2629,49.6953],[2.2748,49.6912],[2.2808,49.6909],[2.2847,49.6896],[2.2876,49.6876],[2.2912,49.6832],[2.2912,49.6798],[2.292,49.6786],[2.2912,49.6757],[2.2953,49.6743],[2.2935,49.6718],[2.2945,49.6712],[2.2945,49.6701],[2.293,49.6701],[2.2927,49.6713],[2.2864,49.6737],[2.2806,49.6736],[2.2802,49.673],[2.2763,49.6737],[2.2764,49.6757],[2.2731,49.6758],[2.2735,49.671],[2.2672,49.6707],[2.2675,49.668],[2.2531,49.6672],[2.2506,49.67],[2.2463,49.6675],[2.2502,49.6644],[2.246,49.6622],[2.2424,49.6614],[2.241,49.6616],[2.2358,49.6653],[2.2362,49.6667],[2.2312,49.6667],[2.2307,49.6685],[2.2217,49.6681],[2.2206,49.6674],[2.2183,49.6696],[2.2161,49.669],[2.2165,49.6681],[2.2157,49.6675],[2.2126,49.6663],[2.2035,49.6664],[2.2014,49.6684],[2.2064,49.6706],[2.2061,49.6712],[2.198,49.6732],[2.1976,49.6726],[2.1951,49.6729],[2.1912,49.6756],[2.1876,49.6724],[2.1837,49.6746]]]},"60083":{"type":"Polygon","coordinates":[[[2.9519,49.2805],[2.9586,49.2848],[2.9637,49.2872],[2.9632,49.2916],[2.9644,49.2924],[2.9637,49.2936],[2.9664,49.2966],[2.9659,49.2978],[2.9665,49.2991],[2.9701,49.3027],[2.9716,49.3029],[2.973,49.3017],[2.9745,49.3027],[2.9758,49.3022],[2.9748,49.3012],[2.9764,49.3007],[2.9772,49.299],[2.9802,49.2992],[2.9842,49.3013],[2.9853,49.3008],[2.9848,49.3002],[2.9809,49.2982],[2.9812,49.2976],[2.9834,49.2969],[2.9848,49.2986],[2.9867,49.2989],[2.9859,49.2994],[2.9864,49.3],[2.9887,49.2992],[2.9877,49.2974],[2.9893,49.2957],[2.9904,49.2976],[2.9912,49.297],[2.9929,49.2986],[2.9943,49.2984],[2.9956,49.2963],[2.9927,49.2936],[2.9863,49.2904],[2.9856,49.2893],[2.9861,49.2878],[2.9958,49.2866],[2.9991,49.2893],[3.0032,49.291],[3.0052,49.2931],[3.0067,49.292],[3.0102,49.2925],[3.0108,49.291],[3.0128,49.2919],[3.0114,49.2903],[3.0135,49.2892],[3.021,49.2899],[3.0182,49.2858],[3.0141,49.283],[3.0126,49.2782],[3.0104,49.2762],[3.0039,49.2767],[3.0017,49.274],[3.0003,49.2745],[2.9922,49.2658],[2.9908,49.2637],[2.9911,49.2617],[2.9864,49.2611],[2.9874,49.2588],[2.9798,49.2574],[2.9797,49.2562],[2.9774,49.2566],[2.9776,49.2581],[2.9724,49.2608],[2.9711,49.263],[2.9713,49.2642],[2.9625,49.2707],[2.9612,49.2705],[2.9618,49.2697],[2.9598,49.2705],[2.9556,49.2705],[2.9532,49.2687],[2.9535,49.2728],[2.9511,49.274],[2.9491,49.2778],[2.9519,49.2805]]]},"60084":{"type":"Polygon","coordinates":[[[1.9435,49.5149],[1.9438,49.5167],[1.9414,49.5174],[1.9447,49.5259],[1.944,49.5274],[1.9468,49.5293],[1.9453,49.5305],[1.9462,49.5309],[1.9541,49.5298],[1.9551,49.5291],[1.9547,49.5276],[1.9667,49.525],[1.968,49.5214],[1.9689,49.5215],[1.9685,49.5201],[1.9695,49.5194],[1.9689,49.5191],[1.9716,49.5178],[1.9718,49.5167],[1.9705,49.5163],[1.972,49.5155],[1.97,49.5133],[1.9739,49.5126],[1.9746,49.5118],[1.9738,49.5097],[1.9787,49.5085],[1.9766,49.505],[1.9789,49.5032],[1.9789,49.5026],[1.9774,49.5024],[1.9786,49.5016],[1.9775,49.5007],[1.9782,49.5002],[1.9734,49.4946],[1.9723,49.4943],[1.9698,49.4986],[1.9668,49.4968],[1.9602,49.4948],[1.9542,49.4942],[1.9524,49.4921],[1.9469,49.4891],[1.9429,49.4922],[1.943,49.4949],[1.9355,49.4945],[1.9356,49.4951],[1.93,49.494],[1.9289,49.4972],[1.9315,49.4976],[1.932,49.5013],[1.9333,49.5015],[1.9342,49.5008],[1.9394,49.5036],[1.9472,49.5057],[1.9513,49.5085],[1.9513,49.5101],[1.9528,49.5109],[1.9519,49.5119],[1.9466,49.514],[1.9433,49.5137],[1.9435,49.5149]]]},"60085":{"type":"Polygon","coordinates":[[[2.3677,49.5745],[2.3655,49.5743],[2.3638,49.5729],[2.3577,49.5731],[2.3518,49.5713],[2.3504,49.5712],[2.3517,49.5734],[2.3461,49.5726],[2.3454,49.5717],[2.3462,49.5709],[2.342,49.5694],[2.342,49.5712],[2.3402,49.5743],[2.3396,49.5765],[2.3402,49.5767],[2.3383,49.582],[2.3366,49.5853],[2.3349,49.5867],[2.3369,49.5872],[2.3357,49.5908],[2.3393,49.5923],[2.3376,49.5954],[2.3474,49.6007],[2.3467,49.6015],[2.3503,49.6047],[2.3549,49.5991],[2.3549,49.597],[2.3556,49.5973],[2.3585,49.5948],[2.3594,49.5951],[2.3619,49.5922],[2.3648,49.5921],[2.3676,49.5876],[2.3652,49.5869],[2.367,49.5847],[2.3644,49.5832],[2.3707,49.58],[2.369,49.5786],[2.37,49.5771],[2.3697,49.5744],[2.3677,49.5745]]]},"60086":{"type":"Polygon","coordinates":[[[2.3733,49.1594],[2.3701,49.1588],[2.3703,49.1568],[2.3672,49.1559],[2.366,49.1548],[2.3665,49.154],[2.3649,49.1535],[2.365,49.1524],[2.3622,49.1525],[2.3618,49.1502],[2.3593,49.1473],[2.356,49.1487],[2.3534,49.1512],[2.3549,49.1517],[2.3554,49.1533],[2.3538,49.1539],[2.3542,49.1543],[2.346,49.1623],[2.3413,49.1649],[2.3355,49.1707],[2.3273,49.1765],[2.3276,49.1771],[2.326,49.1777],[2.3258,49.1787],[2.3232,49.1795],[2.3237,49.1799],[2.3196,49.1824],[2.3231,49.1855],[2.3248,49.184],[2.3284,49.1864],[2.3289,49.1892],[2.3303,49.1895],[2.3281,49.1918],[2.3302,49.1917],[2.3346,49.1936],[2.3371,49.1911],[2.3412,49.194],[2.3356,49.197],[2.3372,49.1982],[2.3443,49.1942],[2.3436,49.1935],[2.3463,49.1928],[2.347,49.1938],[2.363,49.1922],[2.3628,49.1904],[2.3667,49.1903],[2.3711,49.1847],[2.3705,49.1781],[2.3692,49.1752],[2.3701,49.1751],[2.3697,49.1736],[2.3746,49.1728],[2.3727,49.1712],[2.3725,49.1689],[2.3715,49.1688],[2.3695,49.1663],[2.371,49.166],[2.3709,49.1634],[2.3735,49.1625],[2.3713,49.1618],[2.3733,49.1594]]]},"60087":{"type":"Polygon","coordinates":[[[2.6319,49.1708],[2.6443,49.1768],[2.6472,49.1796],[2.6511,49.1819],[2.6502,49.1826],[2.6508,49.1849],[2.6533,49.1873],[2.6556,49.1869],[2.6638,49.1996],[2.6687,49.1984],[2.666,49.2042],[2.6722,49.2056],[2.6746,49.2135],[2.6792,49.2143],[2.6807,49.2157],[2.6917,49.212],[2.6898,49.2111],[2.6926,49.2095],[2.6917,49.2074],[2.6938,49.2075],[2.6924,49.2044],[2.6958,49.2033],[2.6979,49.2054],[2.7007,49.2042],[2.7031,49.2061],[2.7054,49.2046],[2.7093,49.2065],[2.7169,49.2013],[2.7141,49.2],[2.7142,49.199],[2.7096,49.1962],[2.7063,49.1979],[2.7015,49.1943],[2.6999,49.1956],[2.695,49.1973],[2.6836,49.1867],[2.6852,49.186],[2.6759,49.1798],[2.6755,49.1791],[2.6765,49.1783],[2.6747,49.1762],[2.6732,49.172],[2.6736,49.1704],[2.6693,49.1677],[2.6676,49.1682],[2.6653,49.1645],[2.6632,49.1653],[2.6615,49.1643],[2.6605,49.1632],[2.6623,49.16],[2.651,49.1639],[2.6459,49.1638],[2.645,49.1642],[2.6435,49.1672],[2.64,49.168],[2.6377,49.1706],[2.6319,49.1708]]]},"60088":{"type":"Polygon","coordinates":[[[2.158,49.1726],[2.165,49.1789],[2.1641,49.1798],[2.1617,49.1796],[2.1561,49.1831],[2.1524,49.1838],[2.1576,49.1879],[2.1548,49.1915],[2.1554,49.192],[2.1547,49.1956],[2.1598,49.1985],[2.1641,49.1994],[2.1636,49.2002],[2.1664,49.2016],[2.1694,49.2011],[2.1726,49.2018],[2.1714,49.2122],[2.1725,49.2123],[2.1729,49.2139],[2.1752,49.2144],[2.1744,49.2172],[2.1766,49.2238],[2.1824,49.2296],[2.185,49.2294],[2.1865,49.2302],[2.1947,49.2387],[2.197,49.2398],[2.1983,49.239],[2.2005,49.2414],[2.1977,49.2423],[2.1996,49.2448],[2.2002,49.2473],[2.1995,49.2522],[2.2053,49.254],[2.2067,49.2536],[2.2108,49.2456],[2.215,49.2397],[2.2246,49.2301],[2.2235,49.2301],[2.2256,49.2282],[2.2196,49.2253],[2.2246,49.2227],[2.2163,49.2227],[2.2144,49.2206],[2.2156,49.2165],[2.2142,49.2134],[2.2177,49.2127],[2.2177,49.2093],[2.2186,49.2095],[2.2203,49.2072],[2.2217,49.2074],[2.2237,49.2053],[2.2274,49.2077],[2.2307,49.2053],[2.2305,49.2034],[2.2251,49.2035],[2.2249,49.2021],[2.2207,49.201],[2.2096,49.1922],[2.1985,49.1868],[2.1884,49.1848],[2.1858,49.1833],[2.1852,49.1837],[2.1817,49.1802],[2.1823,49.18],[2.1775,49.1777],[2.1749,49.175],[2.1794,49.1736],[2.1822,49.1704],[2.1793,49.1708],[2.1715,49.1679],[2.1704,49.1664],[2.1711,49.165],[2.1706,49.1644],[2.1688,49.1639],[2.1626,49.1671],[2.162,49.1687],[2.158,49.1726]]]},"60089":{"type":"Polygon","coordinates":[[[1.8862,49.2376],[1.888,49.2265],[1.8924,49.2252],[1.8964,49.2229],[1.8906,49.2116],[1.8843,49.2064],[1.8828,49.2071],[1.8809,49.2064],[1.8805,49.2026],[1.8776,49.1961],[1.8757,49.1973],[1.8733,49.1941],[1.8718,49.1943],[1.8683,49.196],[1.8688,49.1967],[1.8635,49.1987],[1.8631,49.1998],[1.8611,49.2001],[1.8617,49.2011],[1.8609,49.2015],[1.8619,49.2025],[1.8599,49.2036],[1.8494,49.2038],[1.8502,49.2046],[1.8459,49.2072],[1.8464,49.2077],[1.8449,49.2086],[1.8504,49.2136],[1.8452,49.2168],[1.8526,49.2176],[1.8478,49.2222],[1.8516,49.2243],[1.8534,49.2238],[1.8663,49.2288],[1.8646,49.2295],[1.8657,49.2306],[1.8626,49.231],[1.8628,49.2317],[1.8665,49.2318],[1.8672,49.2338],[1.8751,49.2371],[1.8862,49.2376]]]},"60090":{"type":"Polygon","coordinates":[[[1.9344,49.1735],[1.9315,49.175],[1.9319,49.1742],[1.9244,49.1736],[1.9238,49.1724],[1.8947,49.1661],[1.8951,49.165],[1.8901,49.1641],[1.8897,49.165],[1.8883,49.1647],[1.8869,49.1642],[1.8874,49.163],[1.883,49.1626],[1.8837,49.1661],[1.8823,49.168],[1.8809,49.1673],[1.8767,49.1714],[1.8761,49.1751],[1.8844,49.1786],[1.8843,49.1799],[1.8968,49.1853],[1.8991,49.1839],[1.9003,49.1846],[1.9029,49.182],[1.9103,49.1777],[1.9124,49.1787],[1.9179,49.1789],[1.9228,49.1752],[1.9259,49.1748],[1.9283,49.1757],[1.9287,49.1784],[1.9294,49.1782],[1.9301,49.1795],[1.932,49.1793],[1.9312,49.177],[1.9333,49.1759],[1.9344,49.1735]]]},"60091":{"type":"Polygon","coordinates":[[[2.8709,49.1077],[2.8813,49.1244],[2.8915,49.1256],[2.8923,49.1288],[2.9114,49.1268],[2.9228,49.1351],[2.9322,49.1379],[2.9361,49.1404],[2.9379,49.1386],[2.9425,49.1369],[2.9473,49.1338],[2.9465,49.1326],[2.9448,49.1321],[2.9442,49.1291],[2.9384,49.1299],[2.9381,49.1274],[2.9427,49.1213],[2.9401,49.1213],[2.9398,49.1198],[2.9375,49.1195],[2.9373,49.1167],[2.936,49.1163],[2.9382,49.1135],[2.9363,49.1124],[2.9396,49.1099],[2.9378,49.1087],[2.94,49.1077],[2.9383,49.1048],[2.9338,49.1061],[2.9333,49.1072],[2.9349,49.1077],[2.9345,49.1084],[2.9352,49.1087],[2.9335,49.1104],[2.9267,49.1094],[2.9282,49.1064],[2.9247,49.1044],[2.9207,49.1002],[2.9182,49.0991],[2.9013,49.1015],[2.8995,49.1025],[2.8972,49.1021],[2.8987,49.1052],[2.8917,49.1069],[2.8784,49.1061],[2.8709,49.1077]]]},"60092":{"type":"Polygon","coordinates":[[[2.9951,49.1429],[2.9979,49.1428],[2.9997,49.1415],[3.01,49.1419],[3.0148,49.1412],[3.0196,49.142],[3.0222,49.1405],[3.0281,49.1396],[3.0297,49.139],[3.0291,49.1376],[3.0374,49.1359],[3.0419,49.1336],[3.0399,49.1321],[3.0325,49.13],[3.0329,49.1295],[3.0277,49.126],[3.0269,49.1264],[3.0259,49.1254],[3.0249,49.1258],[3.0236,49.1242],[3.0211,49.124],[3.0193,49.1215],[3.0165,49.1198],[3.0117,49.1197],[3.0094,49.118],[3.0077,49.1182],[3.0068,49.116],[2.9939,49.1172],[2.9942,49.1181],[2.9903,49.12],[2.988,49.1238],[2.9875,49.1237],[2.9879,49.1261],[2.9864,49.1312],[2.9898,49.1351],[2.9897,49.1359],[2.9915,49.1372],[2.9951,49.1429]]]},"60093":{"type":"Polygon","coordinates":[[[2.6742,49.6001],[2.6735,49.6037],[2.6745,49.6038],[2.6748,49.6058],[2.6826,49.6078],[2.6814,49.6099],[2.6881,49.614],[2.6861,49.6169],[2.6892,49.6193],[2.6884,49.6196],[2.6892,49.6206],[2.6886,49.621],[2.6897,49.6224],[2.6881,49.6227],[2.6888,49.6232],[2.6873,49.6247],[2.6887,49.6254],[2.6892,49.6249],[2.6946,49.6262],[2.6966,49.6255],[2.6998,49.6264],[2.6998,49.6255],[2.7022,49.6238],[2.7067,49.6247],[2.7067,49.6254],[2.7076,49.6254],[2.7075,49.6268],[2.711,49.6262],[2.713,49.6246],[2.7152,49.6244],[2.7149,49.624],[2.7179,49.6232],[2.7204,49.6213],[2.7209,49.6216],[2.7188,49.6199],[2.7211,49.6176],[2.7198,49.6171],[2.7226,49.6143],[2.7219,49.6098],[2.7173,49.6093],[2.7146,49.6078],[2.7145,49.6044],[2.7159,49.6038],[2.7145,49.6035],[2.7198,49.5996],[2.7186,49.5935],[2.7161,49.5897],[2.7079,49.5905],[2.708,49.5892],[2.7064,49.5876],[2.7027,49.5893],[2.7013,49.5885],[2.7017,49.5893],[2.699,49.5908],[2.6998,49.5914],[2.6973,49.5919],[2.6971,49.5941],[2.6953,49.594],[2.6932,49.5979],[2.6897,49.5968],[2.6888,49.5981],[2.6855,49.5975],[2.683,49.5991],[2.6791,49.5969],[2.6742,49.6001]]]},"60094":{"type":"Polygon","coordinates":[[[3.0351,49.2058],[3.0361,49.205],[3.0378,49.2063],[3.041,49.2059],[3.0419,49.2096],[3.0462,49.2101],[3.0474,49.2098],[3.0476,49.2089],[3.0494,49.2093],[3.0511,49.2086],[3.0524,49.2061],[3.0554,49.2058],[3.0557,49.2045],[3.0651,49.2049],[3.0655,49.2035],[3.0595,49.2026],[3.0563,49.2001],[3.0581,49.1979],[3.0572,49.1969],[3.0576,49.1962],[3.0594,49.196],[3.0637,49.193],[3.0573,49.1959],[3.0532,49.1902],[3.0504,49.1906],[3.0462,49.1882],[3.0471,49.1851],[3.0425,49.1846],[3.0427,49.1852],[3.0402,49.1854],[3.0409,49.1867],[3.0402,49.1868],[3.0404,49.1876],[3.0375,49.1886],[3.0388,49.1892],[3.0391,49.1916],[3.038,49.1924],[3.0379,49.1938],[3.0336,49.1973],[3.0354,49.198],[3.0346,49.2002],[3.0327,49.2004],[3.0317,49.2017],[3.0334,49.2055],[3.0351,49.2058]]]},"60095":{"type":"Polygon","coordinates":[[[1.7669,49.252],[1.7794,49.2485],[1.7891,49.249],[1.7909,49.2439],[1.7859,49.2451],[1.7786,49.2447],[1.7769,49.2457],[1.7763,49.2443],[1.7707,49.2428],[1.7649,49.2429],[1.762,49.2414],[1.7514,49.2404],[1.7487,49.2368],[1.7497,49.2365],[1.747,49.2329],[1.7487,49.2303],[1.7458,49.2245],[1.7441,49.2244],[1.7438,49.223],[1.7404,49.2228],[1.7404,49.2243],[1.7384,49.2241],[1.738,49.2254],[1.7333,49.2265],[1.7321,49.2281],[1.7297,49.2292],[1.7253,49.2298],[1.7153,49.2334],[1.7143,49.2326],[1.7121,49.233],[1.7132,49.2351],[1.7126,49.2413],[1.7094,49.2415],[1.7096,49.2387],[1.7083,49.2359],[1.7071,49.2358],[1.7064,49.2342],[1.7053,49.2344],[1.7044,49.2324],[1.699,49.235],[1.7021,49.239],[1.7013,49.2397],[1.7023,49.2405],[1.7016,49.2434],[1.6991,49.2452],[1.6986,49.2471],[1.6997,49.2479],[1.7012,49.2518],[1.7051,49.2527],[1.7045,49.2493],[1.7134,49.2498],[1.72,49.2491],[1.7247,49.2548],[1.7295,49.2553],[1.7453,49.2524],[1.7641,49.2528],[1.7669,49.252]]]},"60097":{"type":"Polygon","coordinates":[[[1.9098,49.3328],[1.9107,49.3316],[1.9001,49.3238],[1.8991,49.3242],[1.8979,49.3206],[1.8948,49.3211],[1.8954,49.3185],[1.8914,49.3199],[1.89,49.3164],[1.8916,49.3159],[1.8897,49.3111],[1.8865,49.312],[1.8866,49.313],[1.8819,49.3142],[1.8809,49.3135],[1.8737,49.3158],[1.8679,49.3086],[1.8666,49.3073],[1.866,49.308],[1.8617,49.3033],[1.8626,49.3062],[1.861,49.3069],[1.8615,49.3074],[1.8578,49.3102],[1.8454,49.3132],[1.8399,49.3162],[1.8434,49.3231],[1.8479,49.3262],[1.8454,49.3289],[1.8467,49.3306],[1.8477,49.3302],[1.8512,49.3344],[1.8548,49.3329],[1.8561,49.3334],[1.8596,49.3306],[1.8588,49.3295],[1.8576,49.3298],[1.8568,49.3286],[1.8606,49.327],[1.8596,49.3249],[1.8644,49.3243],[1.8639,49.3239],[1.8653,49.3231],[1.8649,49.322],[1.8667,49.322],[1.8675,49.3234],[1.8678,49.327],[1.8697,49.3269],[1.8702,49.3279],[1.8723,49.3273],[1.877,49.3316],[1.88,49.3288],[1.8819,49.3299],[1.8859,49.3283],[1.8872,49.3296],[1.8923,49.3261],[1.9002,49.3296],[1.9043,49.3336],[1.9068,49.3344],[1.9073,49.3323],[1.9098,49.3328]]]},"60098":{"type":"Polygon","coordinates":[[[1.7743,49.6559],[1.7764,49.6556],[1.7764,49.6521],[1.7729,49.6521],[1.7756,49.648],[1.7668,49.647],[1.7663,49.6479],[1.764,49.648],[1.764,49.6487],[1.7593,49.6482],[1.7476,49.6427],[1.7414,49.6456],[1.7409,49.6524],[1.7455,49.6544],[1.7444,49.6553],[1.7515,49.6594],[1.7541,49.6569],[1.7557,49.6575],[1.7569,49.6566],[1.7594,49.6574],[1.7612,49.6564],[1.7695,49.6571],[1.7714,49.657],[1.7714,49.6561],[1.7743,49.6559]]]},"60099":{"type":"Polygon","coordinates":[[[2.766,49.4676],[2.7624,49.4745],[2.7619,49.4843],[2.7636,49.4869],[2.7739,49.4837],[2.7744,49.4851],[2.7926,49.4743],[2.7916,49.473],[2.7858,49.4744],[2.7855,49.4736],[2.7866,49.4733],[2.7855,49.4718],[2.781,49.4728],[2.7804,49.474],[2.7789,49.4742],[2.7774,49.4727],[2.78,49.4718],[2.7809,49.4687],[2.7742,49.4704],[2.7733,49.4682],[2.7702,49.4695],[2.766,49.4676]]]},"60100":{"type":"Polygon","coordinates":[[[2.6598,49.2325],[2.6595,49.2346],[2.6582,49.2353],[2.6604,49.2367],[2.6595,49.2374],[2.6607,49.2387],[2.6599,49.2399],[2.6612,49.2402],[2.6593,49.2447],[2.6604,49.245],[2.6599,49.2458],[2.6609,49.2463],[2.6598,49.2474],[2.6603,49.2476],[2.6582,49.2534],[2.6608,49.2563],[2.6662,49.2574],[2.6654,49.2595],[2.6718,49.2637],[2.6783,49.2665],[2.6884,49.2692],[2.6897,49.2675],[2.6996,49.269],[2.7021,49.2673],[2.7005,49.2666],[2.7019,49.2618],[2.7003,49.262],[2.6998,49.2602],[2.6965,49.2602],[2.7036,49.25],[2.6721,49.2374],[2.6737,49.2363],[2.673,49.236],[2.6738,49.2354],[2.6733,49.2351],[2.6752,49.2337],[2.6719,49.2321],[2.668,49.2322],[2.6652,49.2338],[2.6598,49.2325]]]},"60101":{"type":"Polygon","coordinates":[[[2.9014,49.0853],[2.8996,49.0836],[2.8957,49.0773],[2.8875,49.0795],[2.8865,49.0782],[2.8854,49.0786],[2.8836,49.0761],[2.8803,49.0759],[2.8796,49.0738],[2.8759,49.0741],[2.8734,49.0717],[2.8719,49.0721],[2.8702,49.0701],[2.8664,49.0707],[2.8561,49.0701],[2.8546,49.0704],[2.855,49.0735],[2.8542,49.0746],[2.8498,49.0774],[2.8504,49.0775],[2.8489,49.079],[2.848,49.0825],[2.8451,49.0848],[2.8441,49.0873],[2.8451,49.0903],[2.8443,49.0906],[2.8452,49.093],[2.8484,49.0943],[2.8483,49.0967],[2.8533,49.097],[2.853,49.0991],[2.8551,49.1018],[2.87,49.1078],[2.8784,49.1061],[2.8917,49.1069],[2.8987,49.1052],[2.8972,49.1021],[2.8995,49.1025],[2.902,49.1013],[2.9019,49.1004],[2.9061,49.0985],[2.9042,49.0962],[2.9048,49.0941],[2.8961,49.088],[2.9014,49.0853]]]},"60102":{"type":"Polygon","coordinates":[[[2.548,49.3007],[2.5395,49.3018],[2.5261,49.2989],[2.5232,49.3069],[2.5314,49.3092],[2.532,49.3083],[2.5413,49.3107],[2.5454,49.3149],[2.5481,49.3157],[2.5517,49.3144],[2.5537,49.3151],[2.5565,49.3128],[2.5638,49.3145],[2.5651,49.3122],[2.5683,49.3119],[2.5699,49.3126],[2.5718,49.3104],[2.573,49.3096],[2.574,49.31],[2.5745,49.3092],[2.5738,49.3092],[2.574,49.3075],[2.5775,49.3077],[2.578,49.3064],[2.5769,49.3057],[2.5766,49.3035],[2.5654,49.3032],[2.5533,49.2999],[2.548,49.3007]]]},"60103":{"type":"Polygon","coordinates":[[[2.2765,49.3879],[2.2742,49.3872],[2.2721,49.3892],[2.2705,49.3863],[2.2661,49.3838],[2.2568,49.3881],[2.2504,49.3928],[2.243,49.394],[2.2373,49.394],[2.2298,49.3924],[2.2289,49.3953],[2.2279,49.3959],[2.2281,49.402],[2.2245,49.4027],[2.2239,49.4006],[2.2202,49.4004],[2.2204,49.3984],[2.2178,49.3959],[2.2155,49.3945],[2.2127,49.3947],[2.2137,49.398],[2.215,49.3995],[2.212,49.401],[2.2154,49.403],[2.2167,49.4047],[2.2175,49.408],[2.219,49.4094],[2.2179,49.4109],[2.2168,49.4109],[2.2194,49.4196],[2.22,49.4195],[2.2208,49.4218],[2.2237,49.4213],[2.2245,49.4256],[2.224,49.4256],[2.228,49.4311],[2.2286,49.4355],[2.2326,49.4355],[2.232,49.4371],[2.234,49.4367],[2.2366,49.441],[2.2424,49.4403],[2.2433,49.4411],[2.2447,49.4408],[2.2443,49.4389],[2.2434,49.4389],[2.2431,49.4378],[2.2479,49.4376],[2.2491,49.4351],[2.2497,49.4351],[2.25,49.4369],[2.2553,49.4362],[2.2561,49.4384],[2.2609,49.438],[2.2611,49.4396],[2.2645,49.4399],[2.2643,49.4387],[2.2699,49.436],[2.2744,49.4374],[2.2807,49.4344],[2.2781,49.4258],[2.2787,49.4257],[2.2783,49.4248],[2.2806,49.4243],[2.2768,49.4141],[2.2773,49.4137],[2.2767,49.4137],[2.276,49.4115],[2.2775,49.4113],[2.2772,49.4074],[2.2749,49.4074],[2.2753,49.4025],[2.2762,49.4025],[2.2762,49.4016],[2.2728,49.4016],[2.2726,49.4005],[2.2798,49.3888],[2.2765,49.3879]]]},"60104":{"type":"Polygon","coordinates":[[[2.2689,49.6126],[2.2667,49.6116],[2.2609,49.6174],[2.2542,49.6147],[2.2535,49.618],[2.2509,49.6193],[2.2499,49.6225],[2.2486,49.6224],[2.2485,49.6236],[2.2505,49.6256],[2.2503,49.6277],[2.2372,49.6291],[2.2371,49.6301],[2.2348,49.6311],[2.2523,49.6332],[2.2649,49.6364],[2.2705,49.6369],[2.2703,49.6377],[2.2712,49.6377],[2.2728,49.6404],[2.2698,49.6422],[2.2738,49.6452],[2.2729,49.6465],[2.2787,49.6478],[2.2804,49.6469],[2.2852,49.6504],[2.2859,49.6499],[2.2943,49.6507],[2.2949,49.659],[2.2966,49.6597],[2.3003,49.6604],[2.3,49.6557],[2.3043,49.656],[2.3043,49.6506],[2.3027,49.6499],[2.3042,49.6475],[2.3079,49.6494],[2.3114,49.65],[2.3157,49.649],[2.3159,49.6474],[2.3176,49.6459],[2.3213,49.6455],[2.3265,49.6464],[2.329,49.648],[2.3321,49.6487],[2.3401,49.629],[2.3258,49.624],[2.3177,49.6269],[2.31,49.6285],[2.3091,49.6267],[2.3008,49.6259],[2.2994,49.6254],[2.2996,49.6245],[2.2977,49.6259],[2.295,49.6257],[2.295,49.6248],[2.2912,49.6253],[2.2904,49.6241],[2.2839,49.6196],[2.2689,49.6126]]]},"60105":{"type":"Polygon","coordinates":[[[3.1265,49.5729],[3.1265,49.57],[3.1258,49.5698],[3.126,49.5648],[3.1299,49.5612],[3.1311,49.5614],[3.1307,49.5605],[3.1331,49.5606],[3.1337,49.5596],[3.1322,49.5573],[3.1287,49.5556],[3.1296,49.555],[3.1279,49.553],[3.1278,49.5521],[3.1301,49.5494],[3.1298,49.5482],[3.1313,49.547],[3.1317,49.544],[3.126,49.5422],[3.1229,49.5456],[3.1222,49.5483],[3.1189,49.5506],[3.118,49.5502],[3.1154,49.5516],[3.1097,49.5525],[3.1101,49.5536],[3.1093,49.5551],[3.1019,49.5574],[3.0997,49.5596],[3.0962,49.5598],[3.0952,49.5623],[3.0964,49.5625],[3.0962,49.563],[3.0938,49.5653],[3.0948,49.5658],[3.0923,49.5667],[3.093,49.5668],[3.0911,49.5675],[3.0909,49.5683],[3.0955,49.5705],[3.1018,49.5716],[3.1043,49.5708],[3.1076,49.5715],[3.1082,49.5705],[3.1119,49.5699],[3.1154,49.5711],[3.1211,49.5707],[3.1241,49.5729],[3.1265,49.5729]]]},"60106":{"type":"Polygon","coordinates":[[[2.4338,49.3801],[2.4326,49.3823],[2.4372,49.3825],[2.4408,49.387],[2.4667,49.4007],[2.4682,49.4006],[2.468,49.3972],[2.4704,49.3976],[2.471,49.3964],[2.4772,49.3959],[2.4774,49.3948],[2.4808,49.3948],[2.4797,49.3922],[2.4734,49.3871],[2.4676,49.3806],[2.4691,49.3803],[2.4683,49.3747],[2.4692,49.3711],[2.4685,49.3692],[2.4723,49.3684],[2.4692,49.3623],[2.463,49.3582],[2.4508,49.3574],[2.4492,49.3588],[2.4453,49.3595],[2.4436,49.3579],[2.4435,49.3603],[2.4454,49.3607],[2.4436,49.3629],[2.4437,49.3664],[2.4422,49.3675],[2.4438,49.3682],[2.4444,49.3693],[2.4407,49.3727],[2.4396,49.3727],[2.4402,49.3736],[2.4383,49.3751],[2.4384,49.3765],[2.4338,49.3801]]]},"60107":{"type":"Polygon","coordinates":[[[2.4313,49.3458],[2.4293,49.3491],[2.4276,49.3494],[2.425,49.3535],[2.4243,49.3533],[2.4237,49.3543],[2.4173,49.3519],[2.4113,49.3522],[2.4059,49.3541],[2.4054,49.3559],[2.4068,49.356],[2.4064,49.3572],[2.4074,49.3579],[2.4041,49.3609],[2.3997,49.3628],[2.3927,49.364],[2.395,49.3672],[2.405,49.3691],[2.4074,49.3683],[2.4116,49.369],[2.4172,49.3681],[2.4167,49.367],[2.419,49.3669],[2.42,49.366],[2.4225,49.3672],[2.4186,49.3699],[2.4192,49.3702],[2.4185,49.3712],[2.4224,49.372],[2.422,49.3727],[2.423,49.3731],[2.4225,49.3741],[2.4209,49.3748],[2.4275,49.3768],[2.4281,49.3772],[2.4277,49.3776],[2.4307,49.3789],[2.4299,49.3798],[2.4344,49.38],[2.4359,49.378],[2.4384,49.3765],[2.4383,49.3751],[2.4402,49.3736],[2.4396,49.3727],[2.4407,49.3727],[2.4444,49.3693],[2.4438,49.3682],[2.4422,49.3675],[2.4437,49.3664],[2.4436,49.3629],[2.4454,49.3607],[2.4435,49.3603],[2.4438,49.3576],[2.4427,49.3517],[2.4411,49.3512],[2.4403,49.3487],[2.4407,49.3474],[2.4392,49.3474],[2.4393,49.3466],[2.4313,49.3458]]]},"60108":{"type":"Polygon","coordinates":[[[1.8981,49.6587],[1.9028,49.6583],[1.9079,49.6606],[1.9098,49.6587],[1.9139,49.6595],[1.9157,49.6568],[1.9151,49.6568],[1.915,49.6551],[1.9249,49.6542],[1.9247,49.6536],[1.9268,49.6533],[1.9267,49.6427],[1.9394,49.6383],[1.9385,49.6367],[1.9348,49.6342],[1.9317,49.6335],[1.9296,49.6317],[1.9333,49.6294],[1.9293,49.6279],[1.9251,49.6244],[1.9216,49.6258],[1.9186,49.6246],[1.9159,49.6266],[1.9141,49.6222],[1.9027,49.6299],[1.9047,49.631],[1.9041,49.6312],[1.905,49.6316],[1.9045,49.6342],[1.9074,49.6368],[1.9072,49.6384],[1.902,49.6378],[1.9028,49.6478],[1.9073,49.6488],[1.9086,49.6539],[1.906,49.6546],[1.9051,49.6565],[1.898,49.6578],[1.8981,49.6587]]]},"60109":{"type":"Polygon","coordinates":[[[1.8776,49.6605],[1.8909,49.6626],[1.8918,49.661],[1.8934,49.6613],[1.8946,49.6589],[1.8981,49.6587],[1.898,49.6578],[1.9051,49.6565],[1.906,49.6546],[1.9086,49.6539],[1.9073,49.6488],[1.9028,49.6478],[1.902,49.6378],[1.9074,49.6381],[1.9074,49.6367],[1.9045,49.6342],[1.905,49.6316],[1.9036,49.6313],[1.9006,49.6335],[1.8906,49.6299],[1.8883,49.6315],[1.8887,49.6319],[1.8848,49.6337],[1.8666,49.6379],[1.8695,49.6394],[1.869,49.6456],[1.8742,49.6447],[1.8749,49.6548],[1.878,49.6575],[1.8765,49.6584],[1.8784,49.6593],[1.8776,49.6605]]]},"60110":{"type":"Polygon","coordinates":[[[1.8144,49.6502],[1.8146,49.6511],[1.8175,49.6516],[1.8156,49.655],[1.8157,49.6578],[1.8191,49.6583],[1.8208,49.6635],[1.8241,49.6638],[1.8248,49.6632],[1.8261,49.6641],[1.8338,49.6651],[1.8383,49.6665],[1.8465,49.6709],[1.8496,49.676],[1.8532,49.6752],[1.8541,49.6771],[1.8566,49.6764],[1.8568,49.6736],[1.8585,49.6732],[1.8596,49.6741],[1.8613,49.6734],[1.8587,49.6692],[1.8554,49.6682],[1.8563,49.6675],[1.8524,49.6661],[1.8432,49.6652],[1.8399,49.6638],[1.8391,49.6632],[1.8376,49.6572],[1.8363,49.6573],[1.8357,49.656],[1.8333,49.657],[1.8322,49.656],[1.8313,49.6564],[1.8293,49.6552],[1.8303,49.6546],[1.8283,49.6519],[1.8209,49.6522],[1.8215,49.6503],[1.8196,49.6494],[1.8144,49.6502]]]},"60111":{"type":"Polygon","coordinates":[[[2.4653,49.6381],[2.47,49.6351],[2.473,49.6356],[2.4734,49.6351],[2.4721,49.6346],[2.4739,49.6327],[2.4692,49.6291],[2.4647,49.6288],[2.4635,49.6283],[2.4636,49.6276],[2.4712,49.6253],[2.4716,49.6246],[2.4705,49.6237],[2.4784,49.6204],[2.4778,49.6199],[2.472,49.6183],[2.4713,49.6192],[2.4678,49.6173],[2.4655,49.6181],[2.4684,49.6204],[2.4643,49.6232],[2.4461,49.6202],[2.4429,49.6185],[2.4437,49.6178],[2.4408,49.6169],[2.4394,49.6182],[2.4368,49.6184],[2.4348,49.6203],[2.4322,49.6256],[2.4322,49.6284],[2.4386,49.63],[2.4381,49.6311],[2.4433,49.6337],[2.4423,49.6339],[2.4432,49.6352],[2.4427,49.6373],[2.4483,49.6395],[2.4533,49.6412],[2.4556,49.6412],[2.4529,49.6385],[2.4539,49.6377],[2.4535,49.6354],[2.4576,49.6341],[2.4653,49.6381]]]},"60112":{"type":"Polygon","coordinates":[[[2.4765,49.5536],[2.4701,49.5458],[2.4627,49.5476],[2.4595,49.5459],[2.4519,49.5464],[2.4489,49.5452],[2.4481,49.5426],[2.4497,49.5402],[2.4478,49.5393],[2.4475,49.5403],[2.4453,49.5402],[2.4467,49.5419],[2.4361,49.5441],[2.4384,49.5526],[2.4358,49.5529],[2.4359,49.556],[2.4398,49.5662],[2.4391,49.5691],[2.4407,49.5699],[2.4397,49.5726],[2.4413,49.5728],[2.4419,49.5712],[2.4471,49.5718],[2.4484,49.5684],[2.4524,49.5688],[2.4569,49.5648],[2.456,49.5641],[2.4599,49.5624],[2.4608,49.5637],[2.4667,49.5608],[2.4716,49.5638],[2.4789,49.5599],[2.4817,49.5599],[2.4833,49.5586],[2.4765,49.5536]]]},"60113":{"type":"Polygon","coordinates":[[[2.2797,49.5304],[2.2885,49.5364],[2.2914,49.535],[2.2934,49.5329],[2.2969,49.5315],[2.2988,49.532],[2.3077,49.5291],[2.3227,49.5303],[2.3256,49.5352],[2.3301,49.5328],[2.3309,49.5338],[2.3308,49.5319],[2.3342,49.5314],[2.3358,49.5324],[2.3467,49.5284],[2.3375,49.5233],[2.341,49.5216],[2.341,49.5204],[2.3383,49.5152],[2.3363,49.515],[2.3363,49.5125],[2.3344,49.5104],[2.3265,49.5152],[2.3246,49.5158],[2.3238,49.515],[2.3211,49.5152],[2.3159,49.5174],[2.3085,49.5237],[2.309,49.5273],[2.3069,49.5278],[2.3053,49.5261],[2.3008,49.5265],[2.2993,49.5237],[2.2956,49.5199],[2.2955,49.5182],[2.2913,49.5161],[2.2865,49.5185],[2.2845,49.5183],[2.293,49.5266],[2.2797,49.5304]]]},"60114":{"type":"Polygon","coordinates":[[[1.8035,49.5353],[1.8054,49.5382],[1.8041,49.5392],[1.8114,49.5436],[1.8108,49.547],[1.8132,49.5483],[1.8159,49.5476],[1.8176,49.5449],[1.8203,49.5434],[1.822,49.5409],[1.8278,49.5365],[1.833,49.5349],[1.8306,49.5322],[1.8322,49.5315],[1.83,49.5306],[1.8303,49.5293],[1.8283,49.528],[1.8192,49.5266],[1.8158,49.5253],[1.8107,49.5251],[1.8049,49.5262],[1.8036,49.525],[1.8023,49.5256],[1.7993,49.5252],[1.7994,49.5264],[1.7984,49.5273],[1.8017,49.5291],[1.8036,49.5331],[1.8048,49.5333],[1.8035,49.5353]]]},"60115":{"type":"Polygon","coordinates":[[[2.3032,49.478],[2.3245,49.4823],[2.3259,49.4809],[2.3239,49.4791],[2.3306,49.4784],[2.33,49.4766],[2.3367,49.4743],[2.3363,49.4736],[2.3392,49.4729],[2.3399,49.4743],[2.3514,49.4717],[2.3517,49.4726],[2.3571,49.4719],[2.3583,49.4692],[2.3593,49.4693],[2.3589,49.468],[2.3525,49.4617],[2.3577,49.4577],[2.3614,49.4575],[2.3623,49.4553],[2.364,49.4555],[2.3646,49.4545],[2.3708,49.4533],[2.3691,49.4498],[2.3707,49.4475],[2.3761,49.4442],[2.3648,49.4398],[2.3558,49.4388],[2.3478,49.4336],[2.3414,49.4261],[2.336,49.4269],[2.335,49.426],[2.3319,49.4262],[2.3322,49.43],[2.3391,49.4334],[2.3367,49.4355],[2.3325,49.435],[2.335,49.4366],[2.3342,49.4398],[2.3382,49.4436],[2.3373,49.4456],[2.3305,49.4484],[2.3302,49.4478],[2.3316,49.4472],[2.3319,49.4457],[2.3249,49.4457],[2.3249,49.4467],[2.3209,49.4464],[2.3164,49.4494],[2.3102,49.4554],[2.3022,49.4586],[2.2959,49.4628],[2.2955,49.4637],[2.2974,49.4642],[2.2984,49.463],[2.3029,49.4636],[2.301,49.4662],[2.3024,49.4711],[2.2994,49.4749],[2.3044,49.4767],[2.3032,49.478]]]},"60116":{"type":"Polygon","coordinates":[[[2.3263,49.3205],[2.3319,49.3215],[2.3329,49.3226],[2.3327,49.3247],[2.3382,49.3275],[2.3351,49.3284],[2.3332,49.3305],[2.3403,49.3394],[2.3411,49.3419],[2.3469,49.3398],[2.3466,49.3371],[2.3548,49.3339],[2.3568,49.3358],[2.361,49.3342],[2.3607,49.3347],[2.3631,49.3369],[2.3721,49.3343],[2.3714,49.3326],[2.3741,49.3324],[2.3741,49.3317],[2.3725,49.3316],[2.3716,49.3293],[2.3763,49.3259],[2.3753,49.3251],[2.3755,49.3239],[2.3782,49.3227],[2.3805,49.3235],[2.3825,49.3211],[2.3836,49.3197],[2.3825,49.3194],[2.3847,49.3124],[2.3955,49.3139],[2.3967,49.3094],[2.392,49.3085],[2.3929,49.307],[2.3913,49.3066],[2.3908,49.3074],[2.3886,49.3068],[2.3878,49.3076],[2.3795,49.3053],[2.3786,49.3041],[2.3785,49.2998],[2.3779,49.2994],[2.3788,49.2989],[2.3779,49.2982],[2.3792,49.2974],[2.3795,49.2896],[2.3782,49.2904],[2.3772,49.289],[2.3765,49.2894],[2.3726,49.2883],[2.373,49.2872],[2.3715,49.2862],[2.3719,49.2857],[2.3667,49.2836],[2.3647,49.2838],[2.3652,49.2847],[2.3643,49.2856],[2.3594,49.2866],[2.3568,49.2909],[2.3551,49.29],[2.3537,49.2915],[2.3514,49.2909],[2.3506,49.2921],[2.3489,49.2922],[2.3502,49.2939],[2.348,49.2942],[2.3436,49.3013],[2.3392,49.3023],[2.3371,49.3042],[2.3343,49.3038],[2.3344,49.3062],[2.3319,49.3064],[2.3324,49.3078],[2.3314,49.3096],[2.3317,49.3107],[2.3307,49.3113],[2.3339,49.3124],[2.3319,49.3134],[2.3325,49.3141],[2.3317,49.3145],[2.3298,49.3135],[2.3288,49.3149],[2.3297,49.3159],[2.3285,49.3176],[2.3276,49.3171],[2.3263,49.3205]]]},"60117":{"type":"Polygon","coordinates":[[[2.9955,49.6305],[2.9895,49.6267],[2.9872,49.6231],[2.9852,49.6231],[2.9845,49.6203],[2.9783,49.6216],[2.9764,49.621],[2.9671,49.6218],[2.9648,49.6237],[2.9644,49.6251],[2.9656,49.6256],[2.9636,49.627],[2.9715,49.6353],[2.9694,49.6366],[2.9722,49.6374],[2.9782,49.6442],[2.9839,49.6436],[2.9845,49.6425],[2.9883,49.6416],[2.9881,49.6409],[2.9908,49.6375],[2.9952,49.634],[2.9956,49.6346],[2.9969,49.6337],[2.9988,49.6351],[3.0,49.633],[2.9955,49.6305]]]},"60118":{"type":"Polygon","coordinates":[[[3.0497,49.5308],[3.0561,49.5307],[3.056,49.5317],[3.0631,49.5297],[3.0628,49.5316],[3.0639,49.5352],[3.0634,49.5361],[3.0602,49.5373],[3.0688,49.5393],[3.0744,49.5356],[3.0729,49.5337],[3.0713,49.5335],[3.0698,49.5318],[3.0744,49.5275],[3.0748,49.5259],[3.0801,49.5251],[3.0824,49.5265],[3.0859,49.525],[3.0895,49.5218],[3.0861,49.5191],[3.0846,49.5196],[3.0836,49.5186],[3.0831,49.5193],[3.0796,49.5162],[3.0787,49.5173],[3.0741,49.5156],[3.0741,49.5145],[3.0756,49.5146],[3.076,49.5128],[3.0749,49.5117],[3.074,49.5084],[3.0683,49.5073],[3.0679,49.5065],[3.069,49.5058],[3.0612,49.5019],[3.0596,49.5026],[3.0583,49.5004],[3.0563,49.5039],[3.0569,49.5078],[3.0551,49.5089],[3.0537,49.5134],[3.0498,49.5175],[3.0479,49.5179],[3.0448,49.5202],[3.0476,49.5241],[3.0514,49.5249],[3.0497,49.5308]]]},"60119":{"type":"Polygon","coordinates":[[[2.8809,49.5255],[2.8835,49.5266],[2.8863,49.5294],[2.899,49.5239],[2.9003,49.5228],[2.8992,49.5216],[2.8997,49.5197],[2.9033,49.5181],[2.9056,49.5147],[2.908,49.5136],[2.9095,49.5094],[2.9091,49.5089],[2.9115,49.5085],[2.9112,49.5079],[2.9131,49.5071],[2.9121,49.5059],[2.9154,49.5048],[2.9189,49.505],[2.9195,49.4997],[2.9217,49.4999],[2.9262,49.4989],[2.9248,49.4971],[2.9263,49.4966],[2.9252,49.4949],[2.9175,49.4979],[2.9093,49.4992],[2.9052,49.4979],[2.9033,49.4964],[2.9025,49.4937],[2.9046,49.4914],[2.9032,49.4903],[2.9036,49.4885],[2.9014,49.4866],[2.9009,49.4845],[2.8994,49.4843],[2.8993,49.4855],[2.8963,49.4865],[2.8931,49.4891],[2.8868,49.488],[2.884,49.4883],[2.8834,49.4894],[2.8838,49.4906],[2.887,49.4934],[2.8869,49.4952],[2.8897,49.4988],[2.8903,49.4987],[2.8905,49.4998],[2.8896,49.5012],[2.8868,49.5025],[2.8859,49.5055],[2.8809,49.51],[2.8836,49.5136],[2.8874,49.5159],[2.8878,49.5172],[2.8849,49.5181],[2.8845,49.519],[2.8866,49.5197],[2.8866,49.5208],[2.889,49.5224],[2.8858,49.5235],[2.8832,49.5231],[2.8809,49.5242],[2.8809,49.5255]]]},"60120":{"type":"Polygon","coordinates":[[[2.3721,49.3343],[2.3763,49.3398],[2.3815,49.3408],[2.3835,49.339],[2.3829,49.3387],[2.3863,49.3361],[2.3898,49.3374],[2.3919,49.3361],[2.3951,49.3382],[2.3961,49.3374],[2.3979,49.3382],[2.3994,49.3368],[2.4038,49.3402],[2.4079,49.3376],[2.413,49.3383],[2.4129,49.337],[2.4147,49.3372],[2.4145,49.336],[2.4184,49.3368],[2.4189,49.3359],[2.4233,49.3365],[2.4259,49.3342],[2.4294,49.3328],[2.4233,49.3317],[2.4218,49.3268],[2.4237,49.3264],[2.4241,49.3235],[2.4324,49.321],[2.426,49.3207],[2.4256,49.3175],[2.4274,49.3169],[2.4268,49.3165],[2.4237,49.3172],[2.4178,49.3165],[2.4158,49.3149],[2.4144,49.3152],[2.4091,49.3131],[2.404,49.3127],[2.3969,49.309],[2.3955,49.3139],[2.3847,49.3124],[2.3825,49.3194],[2.3836,49.3197],[2.3825,49.3211],[2.3805,49.3235],[2.3782,49.3227],[2.3755,49.3239],[2.3753,49.3251],[2.3763,49.3259],[2.3716,49.3293],[2.3725,49.3316],[2.3741,49.3317],[2.3741,49.3324],[2.3714,49.3326],[2.3721,49.3343]]]},"60121":{"type":"Polygon","coordinates":[[[2.9534,49.6605],[2.9588,49.6609],[2.9668,49.6601],[2.9714,49.6583],[2.969,49.6553],[2.9709,49.6539],[2.9705,49.6525],[2.975,49.6484],[2.9809,49.6484],[2.9803,49.6467],[2.9774,49.6427],[2.9722,49.6374],[2.9706,49.6367],[2.9687,49.6374],[2.9673,49.641],[2.9622,49.6391],[2.9616,49.6403],[2.9607,49.6404],[2.9596,49.6404],[2.9595,49.6396],[2.9584,49.6392],[2.9583,49.6412],[2.957,49.6409],[2.9562,49.6388],[2.9551,49.6391],[2.9558,49.6401],[2.9514,49.6416],[2.9488,49.6436],[2.9489,49.6475],[2.9448,49.6472],[2.9432,49.6499],[2.942,49.6497],[2.9387,49.6558],[2.9386,49.6567],[2.9404,49.6567],[2.9423,49.655],[2.946,49.6558],[2.9536,49.6584],[2.9534,49.6605]]]},"60122":{"type":"Polygon","coordinates":[[[1.7874,49.6105],[1.7858,49.6086],[1.7785,49.6039],[1.7748,49.6057],[1.7736,49.6045],[1.772,49.605],[1.7679,49.6013],[1.7686,49.601],[1.7662,49.5967],[1.7635,49.5955],[1.7612,49.5975],[1.7547,49.6001],[1.7548,49.5983],[1.7538,49.5979],[1.7499,49.6011],[1.7464,49.6019],[1.7442,49.6034],[1.7431,49.6026],[1.7399,49.6036],[1.7375,49.6035],[1.736,49.6044],[1.733,49.6024],[1.7335,49.6021],[1.7275,49.5996],[1.724,49.6019],[1.7271,49.6043],[1.728,49.6088],[1.7327,49.6121],[1.7322,49.6123],[1.7337,49.6158],[1.7329,49.6175],[1.7304,49.6182],[1.7301,49.6204],[1.7346,49.6253],[1.7335,49.6261],[1.7357,49.6284],[1.7352,49.6289],[1.7381,49.6306],[1.7426,49.6318],[1.7503,49.6325],[1.7561,49.6319],[1.769,49.627],[1.7729,49.6248],[1.7744,49.6224],[1.7781,49.62],[1.7788,49.6206],[1.7813,49.6199],[1.7857,49.6167],[1.7842,49.6163],[1.7845,49.6133],[1.7874,49.6105]]]},"60123":{"type":"Polygon","coordinates":[[[2.3677,49.5745],[2.3695,49.5706],[2.3619,49.5679],[2.3558,49.5667],[2.3569,49.5606],[2.3553,49.5575],[2.3503,49.554],[2.3508,49.5537],[2.3499,49.5532],[2.3511,49.5522],[2.3493,49.5516],[2.3482,49.5525],[2.346,49.5514],[2.345,49.5521],[2.3432,49.5501],[2.3321,49.5527],[2.3309,49.5513],[2.326,49.5529],[2.3251,49.5518],[2.3139,49.5577],[2.3043,49.5541],[2.2998,49.5575],[2.2956,49.5547],[2.2886,49.5596],[2.2893,49.5597],[2.2884,49.5623],[2.2897,49.564],[2.2935,49.5651],[2.2942,49.5666],[2.2961,49.5647],[2.297,49.5651],[2.2964,49.5662],[2.3032,49.5713],[2.3066,49.5718],[2.3072,49.5713],[2.3101,49.5738],[2.3107,49.5749],[2.3102,49.5774],[2.3129,49.5825],[2.3154,49.5828],[2.3136,49.5799],[2.3158,49.5796],[2.3174,49.5821],[2.3202,49.5808],[2.3194,49.5792],[2.3213,49.5796],[2.3232,49.5781],[2.3237,49.5787],[2.3268,49.5757],[2.3273,49.5764],[2.3311,49.5711],[2.3298,49.5707],[2.3372,49.5683],[2.3387,49.5671],[2.342,49.5694],[2.3462,49.5709],[2.3454,49.5717],[2.3461,49.5726],[2.3517,49.5734],[2.3504,49.5712],[2.3518,49.5713],[2.3577,49.5731],[2.3638,49.5729],[2.3655,49.5743],[2.3677,49.5745]]]},"60124":{"type":"Polygon","coordinates":[[[2.9136,49.633],[2.9203,49.6291],[2.9178,49.6288],[2.9149,49.6259],[2.9157,49.6252],[2.9138,49.6255],[2.9108,49.6244],[2.9087,49.6226],[2.9046,49.6216],[2.8981,49.6171],[2.895,49.616],[2.8872,49.6157],[2.8851,49.6187],[2.8824,49.6172],[2.8824,49.6134],[2.8762,49.6133],[2.8781,49.6167],[2.875,49.6183],[2.8721,49.6145],[2.8691,49.6159],[2.8671,49.6148],[2.8565,49.6223],[2.8532,49.6225],[2.8536,49.6241],[2.8522,49.6245],[2.86,49.6289],[2.8618,49.6275],[2.8622,49.6251],[2.8643,49.6259],[2.8677,49.6299],[2.87,49.6306],[2.8704,49.632],[2.8754,49.6323],[2.8768,49.6317],[2.8806,49.6359],[2.8767,49.6375],[2.8795,49.6411],[2.8818,49.6404],[2.8874,49.6428],[2.882,49.6459],[2.8818,49.6489],[2.8833,49.6509],[2.9136,49.633]]]},"60125":{"type":"Polygon","coordinates":[[[2.7077,49.3768],[2.6984,49.378],[2.6988,49.3806],[2.6931,49.3777],[2.6885,49.3825],[2.6737,49.3794],[2.6731,49.3804],[2.672,49.3802],[2.6705,49.3825],[2.6712,49.3829],[2.6675,49.3864],[2.6689,49.3872],[2.6671,49.3888],[2.6747,49.3928],[2.6776,49.3898],[2.6798,49.3907],[2.6773,49.3924],[2.6845,49.3927],[2.6827,49.3972],[2.6966,49.398],[2.6954,49.4014],[2.7043,49.401],[2.705,49.4017],[2.704,49.404],[2.7153,49.4054],[2.7159,49.4028],[2.7181,49.4024],[2.7188,49.4],[2.7206,49.4],[2.7222,49.3966],[2.7197,49.3961],[2.7156,49.3934],[2.7224,49.3912],[2.724,49.389],[2.7228,49.3871],[2.7228,49.3797],[2.7116,49.3768],[2.7078,49.3786],[2.7077,49.3768]]]},"60126":{"type":"Polygon","coordinates":[[[2.8708,49.5309],[2.8699,49.5336],[2.8632,49.5365],[2.8614,49.5364],[2.863,49.5387],[2.8678,49.5381],[2.8804,49.5388],[2.8792,49.5422],[2.8762,49.5446],[2.8795,49.5491],[2.8796,49.5506],[2.8846,49.5546],[2.8837,49.5551],[2.8922,49.5583],[2.8968,49.5617],[2.9048,49.5643],[2.9047,49.5657],[2.9075,49.5656],[2.9111,49.5627],[2.9164,49.5632],[2.9217,49.5622],[2.9239,49.5627],[2.9216,49.5589],[2.917,49.5543],[2.9147,49.5505],[2.9145,49.5497],[2.9157,49.5492],[2.915,49.548],[2.9148,49.5423],[2.9158,49.5419],[2.9013,49.5413],[2.8995,49.5394],[2.895,49.5399],[2.8943,49.5405],[2.8918,49.5402],[2.8912,49.5397],[2.8923,49.5372],[2.8871,49.5355],[2.8906,49.5335],[2.8923,49.5335],[2.8927,49.5325],[2.8902,49.532],[2.8878,49.5303],[2.8801,49.5332],[2.8708,49.5309]]]},"60127":{"type":"Polygon","coordinates":[[[2.8119,49.5899],[2.8077,49.5852],[2.8062,49.5855],[2.8041,49.5833],[2.7997,49.5847],[2.7973,49.5842],[2.7961,49.5859],[2.7975,49.5874],[2.7938,49.5896],[2.7866,49.5971],[2.7899,49.5981],[2.7865,49.6008],[2.7879,49.6017],[2.7804,49.6045],[2.7804,49.6061],[2.7777,49.6094],[2.7776,49.6113],[2.7755,49.6151],[2.7772,49.6154],[2.7865,49.6121],[2.7941,49.6176],[2.7967,49.6146],[2.7993,49.6156],[2.8046,49.6128],[2.8052,49.6133],[2.8095,49.6121],[2.8118,49.6138],[2.813,49.6131],[2.8153,49.6159],[2.821,49.6132],[2.8263,49.609],[2.8207,49.6046],[2.8234,49.6022],[2.8082,49.6034],[2.8099,49.6015],[2.8079,49.6012],[2.8069,49.5985],[2.8084,49.5979],[2.8067,49.5956],[2.8193,49.5949],[2.8175,49.593],[2.8164,49.5933],[2.8119,49.5899]]]},"60128":{"type":"Polygon","coordinates":[[[1.7335,49.6261],[1.7346,49.6253],[1.7301,49.6204],[1.7304,49.6182],[1.7334,49.6167],[1.7336,49.6145],[1.7322,49.6123],[1.7327,49.6121],[1.728,49.6088],[1.7271,49.6043],[1.7222,49.6005],[1.7229,49.5999],[1.7224,49.5995],[1.725,49.5983],[1.7199,49.5938],[1.7214,49.5934],[1.7217,49.5913],[1.7207,49.5898],[1.7135,49.5874],[1.7092,49.5869],[1.7053,49.5909],[1.7088,49.5949],[1.7043,49.5954],[1.7024,49.5963],[1.7027,49.5981],[1.7014,49.5989],[1.6951,49.5997],[1.6939,49.6011],[1.6999,49.6025],[1.7059,49.6064],[1.71,49.6122],[1.718,49.6148],[1.7182,49.6192],[1.7205,49.621],[1.7216,49.6236],[1.717,49.6322],[1.7173,49.6331],[1.7271,49.63],[1.7335,49.6261]]]},"60129":{"type":"Polygon","coordinates":[[[2.9916,49.5493],[2.9999,49.5489],[3.0001,49.548],[2.9986,49.5461],[2.9934,49.5438],[2.9939,49.5411],[2.9993,49.5411],[3.0007,49.5434],[3.0003,49.5449],[3.0023,49.5469],[3.0098,49.5441],[3.0114,49.5445],[3.0172,49.5433],[3.0185,49.5413],[3.0269,49.5383],[3.0292,49.5358],[3.0315,49.5359],[3.0353,49.5377],[3.0444,49.5351],[3.0463,49.5361],[3.0509,49.5285],[3.0514,49.5249],[3.0476,49.5241],[3.0448,49.5202],[3.0479,49.5179],[3.0498,49.5175],[3.0537,49.5134],[3.0551,49.5089],[3.0569,49.5078],[3.0563,49.5039],[3.0583,49.5004],[3.0565,49.4994],[3.0562,49.4978],[3.0527,49.4978],[3.053,49.4968],[3.0516,49.497],[3.051,49.4951],[3.0448,49.4942],[3.0403,49.4989],[3.0367,49.4978],[3.0355,49.496],[3.0174,49.4992],[3.0161,49.5017],[3.0108,49.4986],[3.0055,49.5012],[3.0038,49.5005],[3.002,49.5018],[2.9981,49.5053],[2.9979,49.5083],[2.9969,49.5104],[2.998,49.5139],[2.9914,49.5185],[2.9911,49.5194],[2.9925,49.5214],[2.9929,49.5242],[2.9967,49.5276],[2.9893,49.5318],[2.9909,49.5329],[2.9923,49.5425],[2.9914,49.5461],[2.9916,49.5493]]]},"60130":{"type":"Polygon","coordinates":[[[2.4983,49.36],[2.4852,49.3596],[2.4928,49.3686],[2.4978,49.3782],[2.502,49.3789],[2.5026,49.3858],[2.5079,49.3914],[2.5065,49.3942],[2.5125,49.3996],[2.5134,49.4013],[2.5173,49.4002],[2.5175,49.403],[2.5198,49.4028],[2.52,49.4036],[2.5213,49.4038],[2.5209,49.4052],[2.5253,49.4052],[2.5256,49.4044],[2.5305,49.4041],[2.532,49.403],[2.5329,49.4052],[2.5359,49.4041],[2.5329,49.3947],[2.5315,49.3923],[2.5303,49.3921],[2.5323,49.3895],[2.5347,49.3909],[2.5383,49.391],[2.5384,49.3899],[2.5358,49.3902],[2.5357,49.3895],[2.5461,49.3846],[2.545,49.3792],[2.5458,49.3764],[2.5414,49.375],[2.5362,49.3708],[2.53,49.368],[2.5295,49.3673],[2.5324,49.364],[2.53,49.364],[2.5273,49.3616],[2.5201,49.3605],[2.4983,49.36]]]},"60131":{"type":"Polygon","coordinates":[[[2.0824,49.6711],[2.0852,49.6712],[2.0855,49.6707],[2.0896,49.6716],[2.0943,49.6649],[2.1092,49.6639],[2.1092,49.6655],[2.111,49.6655],[2.1111,49.6638],[2.1292,49.6616],[2.129,49.6609],[2.1302,49.6603],[2.1406,49.6575],[2.1379,49.6576],[2.136,49.6561],[2.1381,49.6535],[2.1351,49.6511],[2.1359,49.6505],[2.1323,49.6479],[2.1336,49.6474],[2.1342,49.6457],[2.1309,49.6462],[2.128,49.6442],[2.1256,49.6352],[2.1247,49.6355],[2.1224,49.6341],[2.122,49.6367],[2.1172,49.6368],[2.1183,49.6382],[2.1169,49.6387],[2.1103,49.6359],[2.1095,49.6346],[2.1061,49.635],[2.1049,49.6327],[2.1034,49.6334],[2.1025,49.6326],[2.1043,49.6314],[2.1018,49.63],[2.1004,49.6309],[2.0979,49.6298],[2.0971,49.633],[2.096,49.6337],[2.0949,49.6332],[2.0908,49.6355],[2.095,49.6364],[2.0937,49.6388],[2.092,49.638],[2.0858,49.6378],[2.0726,49.6334],[2.0704,49.636],[2.0669,49.6347],[2.0661,49.6356],[2.0674,49.6363],[2.0661,49.6382],[2.0694,49.6397],[2.0809,49.6435],[2.0821,49.642],[2.0853,49.6431],[2.0844,49.6453],[2.0852,49.6486],[2.0861,49.6491],[2.0858,49.6503],[2.0876,49.6502],[2.0877,49.6515],[2.0927,49.6527],[2.0965,49.6562],[2.0902,49.6606],[2.0829,49.6599],[2.0775,49.6613],[2.0775,49.6635],[2.0766,49.6642],[2.0775,49.6652],[2.0792,49.6651],[2.0795,49.6662],[2.0775,49.67],[2.0824,49.6711]]]},"60132":{"type":"Polygon","coordinates":[[[2.9203,49.6291],[2.9136,49.633],[2.915,49.634],[2.914,49.6346],[2.9179,49.6376],[2.9192,49.6371],[2.9201,49.6397],[2.923,49.6394],[2.9236,49.641],[2.9266,49.6403],[2.9281,49.6434],[2.9274,49.6441],[2.9297,49.6438],[2.9311,49.6471],[2.9489,49.6475],[2.9488,49.6436],[2.9514,49.6416],[2.9558,49.6401],[2.9551,49.6391],[2.9562,49.6388],[2.957,49.6409],[2.9583,49.6412],[2.9584,49.6392],[2.9595,49.6396],[2.9596,49.6404],[2.9607,49.6404],[2.9616,49.6403],[2.9622,49.6391],[2.9673,49.641],[2.9687,49.6374],[2.9715,49.6353],[2.9636,49.627],[2.9656,49.6256],[2.9644,49.6251],[2.9597,49.6267],[2.956,49.6293],[2.9532,49.6285],[2.9508,49.6265],[2.9461,49.6305],[2.9453,49.6292],[2.944,49.6296],[2.9417,49.6274],[2.941,49.6281],[2.933,49.6223],[2.9302,49.6232],[2.9203,49.6291]]]},"60133":{"type":"Polygon","coordinates":[[[2.3406,49.5196],[2.341,49.5216],[2.3375,49.5233],[2.3467,49.5284],[2.3475,49.53],[2.3529,49.5329],[2.3547,49.532],[2.3558,49.5335],[2.3609,49.5356],[2.3614,49.5348],[2.3719,49.5369],[2.3764,49.5342],[2.3813,49.538],[2.3827,49.5373],[2.3851,49.5415],[2.379,49.5427],[2.382,49.5442],[2.3858,49.5502],[2.3827,49.5519],[2.3821,49.5509],[2.3784,49.5529],[2.3818,49.5552],[2.3866,49.5523],[2.3909,49.553],[2.3967,49.5473],[2.3981,49.5483],[2.4085,49.5361],[2.4033,49.5362],[2.4028,49.5348],[2.3996,49.5349],[2.3966,49.5321],[2.3992,49.5309],[2.3982,49.5302],[2.3955,49.5313],[2.3943,49.5301],[2.3962,49.5292],[2.3987,49.5294],[2.3997,49.5284],[2.3969,49.5272],[2.4032,49.5247],[2.4094,49.5207],[2.4091,49.5197],[2.4064,49.52],[2.4024,49.514],[2.4047,49.513],[2.398,49.5104],[2.3939,49.5082],[2.3937,49.5072],[2.3887,49.5099],[2.3871,49.5087],[2.3814,49.5116],[2.3703,49.5104],[2.3707,49.512],[2.3699,49.5133],[2.3623,49.516],[2.3472,49.5125],[2.3417,49.5145],[2.3445,49.5172],[2.3406,49.5196]]]},"60134":{"type":"Polygon","coordinates":[[[2.4072,49.3032],[2.4014,49.3068],[2.3976,49.308],[2.3969,49.309],[2.404,49.3127],[2.4091,49.3131],[2.4144,49.3152],[2.4158,49.3149],[2.4178,49.3165],[2.4237,49.3172],[2.4268,49.3165],[2.4274,49.3169],[2.4256,49.3175],[2.426,49.3207],[2.4327,49.321],[2.4332,49.3222],[2.4403,49.3222],[2.4493,49.3243],[2.4549,49.3156],[2.4577,49.3162],[2.4589,49.3148],[2.4588,49.3109],[2.4539,49.3087],[2.4538,49.3107],[2.4496,49.3139],[2.4463,49.3126],[2.446,49.3106],[2.4389,49.3099],[2.4376,49.3089],[2.4297,49.3089],[2.424,49.308],[2.4072,49.3032]]]},"60135":{"type":"Polygon","coordinates":[[[2.2223,49.3224],[2.2227,49.3239],[2.2296,49.3247],[2.2352,49.3225],[2.2364,49.3232],[2.239,49.3212],[2.2407,49.3219],[2.2485,49.3191],[2.2589,49.3172],[2.2604,49.3151],[2.2621,49.3149],[2.2639,49.3122],[2.2673,49.3136],[2.2712,49.3112],[2.2755,49.3098],[2.2813,49.3058],[2.2771,49.3042],[2.2714,49.3002],[2.274,49.2957],[2.2684,49.2917],[2.2693,49.291],[2.2575,49.2857],[2.2458,49.2783],[2.2447,49.2794],[2.2436,49.279],[2.2414,49.2808],[2.2418,49.2812],[2.2385,49.2813],[2.2365,49.2822],[2.2374,49.2834],[2.2359,49.2843],[2.231,49.2849],[2.2301,49.2868],[2.2307,49.2874],[2.2234,49.288],[2.2244,49.2894],[2.2148,49.2942],[2.2157,49.2958],[2.2073,49.2942],[2.2072,49.2958],[2.2061,49.2963],[2.2087,49.2989],[2.2042,49.301],[2.2026,49.3003],[2.2017,49.302],[2.2001,49.3018],[2.1976,49.304],[2.2004,49.3074],[2.1999,49.3079],[2.2024,49.31],[2.2079,49.3119],[2.211,49.3155],[2.2186,49.3195],[2.2223,49.3224]]]},"60136":{"type":"Polygon","coordinates":[[[1.9485,49.6527],[1.9567,49.6575],[1.9554,49.6576],[1.9565,49.6585],[1.9577,49.6616],[1.9553,49.6621],[1.9579,49.6666],[1.9596,49.6661],[1.9768,49.6676],[1.9775,49.6667],[1.9912,49.6667],[2.0014,49.6659],[2.0144,49.6682],[2.0156,49.6645],[2.0163,49.6648],[2.0224,49.6606],[2.0261,49.6595],[2.0295,49.6599],[2.0307,49.6588],[2.0249,49.6574],[2.0192,49.6541],[2.0031,49.6525],[1.9972,49.6501],[1.9955,49.6511],[1.9947,49.6531],[1.9938,49.6521],[1.9903,49.6512],[1.986,49.6514],[1.986,49.6472],[1.9782,49.6504],[1.9749,49.6489],[1.9751,49.6455],[1.9676,49.6449],[1.9632,49.646],[1.9562,49.6441],[1.9497,49.648],[1.9494,49.6508],[1.9476,49.6522],[1.9485,49.6527]]]},"60137":{"type":"Polygon","coordinates":[[[2.5225,49.4498],[2.5262,49.4538],[2.5227,49.4553],[2.5246,49.4566],[2.5275,49.4551],[2.5303,49.4549],[2.5333,49.4585],[2.5379,49.4573],[2.5388,49.4555],[2.5388,49.4533],[2.5441,49.4517],[2.5462,49.4482],[2.549,49.4467],[2.5538,49.4458],[2.5568,49.4399],[2.5564,49.437],[2.5628,49.4344],[2.5636,49.4333],[2.5514,49.4301],[2.5509,49.4319],[2.5496,49.4323],[2.5497,49.4335],[2.5481,49.434],[2.5467,49.4333],[2.5436,49.4341],[2.541,49.4322],[2.5374,49.4337],[2.5372,49.4329],[2.5354,49.432],[2.5276,49.4357],[2.5284,49.4371],[2.5287,49.4424],[2.519,49.4463],[2.5225,49.4498]]]},"60138":{"type":"Polygon","coordinates":[[[2.612,49.2458],[2.6224,49.2458],[2.624,49.2397],[2.6219,49.2374],[2.6243,49.2361],[2.6237,49.2351],[2.6288,49.2317],[2.6334,49.2321],[2.635,49.2305],[2.6357,49.2276],[2.6378,49.2275],[2.6378,49.2263],[2.6463,49.2304],[2.6506,49.2299],[2.6535,49.2316],[2.6567,49.2306],[2.6513,49.2289],[2.6585,49.2264],[2.6561,49.2246],[2.6495,49.2226],[2.6552,49.2216],[2.6466,49.2157],[2.6493,49.2136],[2.6429,49.2129],[2.644,49.2137],[2.6432,49.2143],[2.6358,49.2135],[2.6336,49.2119],[2.6092,49.2094],[2.606,49.2135],[2.601,49.2122],[2.6027,49.2142],[2.5986,49.2155],[2.5957,49.2148],[2.596,49.2157],[2.5872,49.2308],[2.5951,49.2384],[2.612,49.2458]]]},"60139":{"type":"Polygon","coordinates":[[[2.2413,49.1516],[2.2336,49.1516],[2.2336,49.1527],[2.2318,49.1524],[2.2321,49.1514],[2.2293,49.1515],[2.2223,49.1523],[2.2168,49.1539],[2.2231,49.1597],[2.2242,49.1624],[2.2304,49.1638],[2.23,49.1643],[2.2354,49.167],[2.2315,49.1705],[2.2238,49.174],[2.2198,49.1796],[2.2259,49.1768],[2.2271,49.1777],[2.2247,49.1797],[2.2234,49.1823],[2.225,49.1831],[2.225,49.1849],[2.2278,49.1872],[2.2344,49.1909],[2.2527,49.1972],[2.254,49.1939],[2.2547,49.1937],[2.2523,49.1876],[2.2567,49.1852],[2.2585,49.1823],[2.2642,49.1852],[2.2756,49.1724],[2.2732,49.1663],[2.2595,49.1566],[2.2601,49.1553],[2.2588,49.1558],[2.2538,49.1526],[2.2504,49.1535],[2.2419,49.1534],[2.2413,49.1516]]]},"60140":{"type":"Polygon","coordinates":[[[1.7904,49.2469],[1.7894,49.2537],[1.7938,49.2592],[1.795,49.2624],[1.7988,49.2679],[1.8029,49.2719],[1.8024,49.2735],[1.8091,49.2741],[1.813,49.2725],[1.8231,49.2715],[1.8371,49.2652],[1.8327,49.2609],[1.8321,49.2572],[1.8243,49.2566],[1.8236,49.2549],[1.824,49.2546],[1.8218,49.2544],[1.822,49.252],[1.8199,49.252],[1.816,49.2537],[1.8149,49.2509],[1.8094,49.2488],[1.8032,49.2452],[1.7955,49.2452],[1.7927,49.2456],[1.7904,49.2469]]]},"60141":{"type":"Polygon","coordinates":[[[2.501,49.1946],[2.4981,49.1929],[2.497,49.1844],[2.4914,49.1833],[2.5088,49.1665],[2.5261,49.1726],[2.5272,49.1656],[2.5243,49.1605],[2.5084,49.1584],[2.5071,49.1593],[2.5048,49.1595],[2.5016,49.1583],[2.4898,49.1581],[2.4871,49.1597],[2.4842,49.1591],[2.4829,49.158],[2.4627,49.1633],[2.463,49.1625],[2.4615,49.1582],[2.4592,49.1566],[2.4543,49.1595],[2.4513,49.1633],[2.448,49.1654],[2.4594,49.1843],[2.4577,49.1909],[2.4587,49.1918],[2.4567,49.2023],[2.4693,49.2033],[2.4664,49.1993],[2.4673,49.1982],[2.4668,49.1978],[2.4795,49.199],[2.501,49.1946]]]},"60142":{"type":"Polygon","coordinates":[[[2.5313,49.0995],[2.5104,49.1043],[2.5098,49.1036],[2.505,49.1038],[2.4901,49.1062],[2.4912,49.1114],[2.503,49.1177],[2.4991,49.1222],[2.5034,49.125],[2.5135,49.1233],[2.5143,49.1264],[2.518,49.1278],[2.5237,49.123],[2.5277,49.1258],[2.5282,49.1275],[2.5268,49.13],[2.5225,49.1314],[2.5244,49.1344],[2.5264,49.1356],[2.5272,49.1373],[2.5267,49.1384],[2.5334,49.1401],[2.5381,49.1396],[2.5424,49.1458],[2.55,49.1399],[2.5523,49.1395],[2.555,49.1428],[2.5595,49.1404],[2.5621,49.1403],[2.5525,49.126],[2.5422,49.1223],[2.5385,49.1218],[2.5368,49.1201],[2.533,49.1195],[2.5313,49.0995]]]},"60143":{"type":"Polygon","coordinates":[[[1.8757,49.2486],[1.8769,49.2532],[1.8649,49.2559],[1.8637,49.2553],[1.8536,49.257],[1.847,49.2605],[1.8489,49.2626],[1.8375,49.2657],[1.8427,49.2722],[1.8433,49.274],[1.8465,49.2758],[1.8477,49.2755],[1.8482,49.2769],[1.8482,49.2764],[1.8516,49.2758],[1.8534,49.2797],[1.8516,49.2808],[1.8626,49.2898],[1.8644,49.2893],[1.868,49.2916],[1.8743,49.2922],[1.8778,49.2951],[1.877,49.2963],[1.8781,49.2974],[1.8809,49.2963],[1.8831,49.2981],[1.8842,49.295],[1.8869,49.2956],[1.8922,49.2902],[1.8894,49.289],[1.8882,49.2877],[1.8875,49.2838],[1.8914,49.2828],[1.8931,49.283],[1.8947,49.2845],[1.8961,49.2839],[1.8948,49.2824],[1.8993,49.2803],[1.9031,49.2854],[1.9051,49.2867],[1.9064,49.2874],[1.9108,49.2865],[1.9116,49.2884],[1.9124,49.2878],[1.9146,49.2894],[1.9231,49.2882],[1.9228,49.2877],[1.9243,49.287],[1.9252,49.2876],[1.9281,49.2869],[1.9273,49.2858],[1.9246,49.2849],[1.9269,49.2831],[1.9256,49.2789],[1.9202,49.2773],[1.9164,49.2737],[1.917,49.2717],[1.9232,49.2706],[1.9224,49.2692],[1.9194,49.269],[1.9203,49.2677],[1.9188,49.267],[1.9176,49.2674],[1.9143,49.2652],[1.9135,49.2658],[1.9125,49.2652],[1.9131,49.2646],[1.91,49.2627],[1.9065,49.2632],[1.9028,49.2618],[1.9007,49.2593],[1.8942,49.2566],[1.8961,49.2551],[1.8932,49.2537],[1.8904,49.2562],[1.8887,49.2599],[1.8877,49.2584],[1.8843,49.2573],[1.8859,49.2558],[1.8843,49.2548],[1.8837,49.2553],[1.8757,49.2486]]]},"60144":{"type":"Polygon","coordinates":[[[1.9736,49.1839],[1.97,49.1858],[1.9674,49.1856],[1.9661,49.1868],[1.9616,49.1871],[1.9653,49.1904],[1.9646,49.1917],[1.9663,49.1927],[1.9657,49.1932],[1.9688,49.1933],[1.9703,49.1942],[1.9748,49.1932],[1.9754,49.1957],[1.9765,49.1955],[1.9771,49.1963],[1.9819,49.1954],[1.9842,49.1959],[1.9887,49.1937],[1.9946,49.194],[1.9997,49.1928],[2.0013,49.1932],[2.0042,49.1957],[2.0127,49.1916],[2.0185,49.1906],[2.0218,49.1888],[2.0047,49.1772],[1.9991,49.1754],[1.9993,49.1759],[1.9954,49.177],[1.9922,49.1762],[1.9909,49.1766],[1.9879,49.179],[1.9835,49.1799],[1.9823,49.1816],[1.9736,49.1839]]]},"60145":{"type":"Polygon","coordinates":[[[3.0363,49.3256],[3.0338,49.331],[3.0288,49.3328],[3.0215,49.333],[3.0212,49.3364],[3.0172,49.3355],[3.0172,49.3361],[3.0126,49.3371],[3.0206,49.3419],[3.0163,49.3428],[3.0232,49.3496],[3.0245,49.3543],[3.0236,49.3554],[3.0247,49.3558],[3.024,49.3565],[3.0253,49.3605],[3.0245,49.3605],[3.0287,49.3654],[3.0339,49.3638],[3.0345,49.3645],[3.036,49.3642],[3.0375,49.3632],[3.045,49.3632],[3.0462,49.3604],[3.0495,49.3597],[3.0508,49.3584],[3.0565,49.3566],[3.0625,49.3565],[3.0605,49.3504],[3.0655,49.3488],[3.0672,49.349],[3.0688,49.3475],[3.0662,49.347],[3.0668,49.3457],[3.0615,49.3454],[3.0622,49.3424],[3.0619,49.3404],[3.0532,49.3398],[3.0493,49.3378],[3.0426,49.3329],[3.0439,49.332],[3.0423,49.3307],[3.0441,49.329],[3.0409,49.3283],[3.0392,49.3273],[3.0397,49.3269],[3.0363,49.3256]]]},"60146":{"type":"Polygon","coordinates":[[[2.3547,49.6194],[2.3615,49.617],[2.3621,49.6143],[2.3637,49.6136],[2.367,49.6141],[2.3711,49.61],[2.3793,49.6128],[2.3815,49.6104],[2.3868,49.6108],[2.3868,49.61],[2.3893,49.6109],[2.3892,49.6116],[2.3906,49.6114],[2.395,49.6159],[2.4039,49.6134],[2.4048,49.6142],[2.4058,49.613],[2.4097,49.6129],[2.4106,49.612],[2.4176,49.6182],[2.4171,49.6188],[2.4158,49.6179],[2.4153,49.6204],[2.417,49.6208],[2.4213,49.6198],[2.4288,49.6201],[2.4297,49.6193],[2.4294,49.6159],[2.422,49.6142],[2.4226,49.6135],[2.4165,49.6105],[2.414,49.6116],[2.4083,49.6085],[2.4069,49.6094],[2.3995,49.6045],[2.3982,49.6029],[2.3943,49.6011],[2.3914,49.5976],[2.3923,49.5966],[2.3882,49.5938],[2.3828,49.5911],[2.3813,49.5923],[2.3741,49.5855],[2.3719,49.5867],[2.3707,49.5855],[2.367,49.5849],[2.3652,49.5869],[2.3676,49.5876],[2.3648,49.5921],[2.3619,49.5922],[2.3594,49.5951],[2.3585,49.5948],[2.3556,49.5973],[2.3549,49.597],[2.3549,49.5991],[2.3501,49.6051],[2.3519,49.6085],[2.3554,49.6099],[2.3546,49.6111],[2.3554,49.6114],[2.3551,49.613],[2.3559,49.613],[2.3568,49.6154],[2.3522,49.6162],[2.3547,49.6194]]]},"60147":{"type":"Polygon","coordinates":[[[2.8305,49.514],[2.831,49.5149],[2.8365,49.5184],[2.8376,49.5231],[2.8403,49.5271],[2.846,49.5323],[2.8503,49.535],[2.8526,49.5333],[2.8575,49.5355],[2.8632,49.5365],[2.87,49.5333],[2.8708,49.5309],[2.8698,49.5218],[2.8688,49.5231],[2.8671,49.5233],[2.8632,49.5213],[2.8634,49.518],[2.8655,49.5173],[2.8639,49.5133],[2.8644,49.5117],[2.8603,49.5101],[2.8628,49.5056],[2.863,49.5028],[2.8618,49.5003],[2.8626,49.4997],[2.8607,49.4965],[2.8561,49.4974],[2.8548,49.497],[2.8523,49.498],[2.8502,49.5],[2.8495,49.4992],[2.849,49.4998],[2.8425,49.5005],[2.8407,49.5018],[2.8413,49.5027],[2.8343,49.505],[2.8328,49.5067],[2.8333,49.5071],[2.8322,49.5071],[2.8326,49.5078],[2.8289,49.51],[2.8312,49.5122],[2.8305,49.514]]]},"60148":{"type":"Polygon","coordinates":[[[2.8483,49.0967],[2.8482,49.0974],[2.8469,49.0974],[2.847,49.0998],[2.8461,49.0997],[2.8439,49.1016],[2.8431,49.1038],[2.8417,49.1049],[2.8386,49.1053],[2.8373,49.1071],[2.8361,49.1064],[2.8347,49.1099],[2.8312,49.1145],[2.8306,49.1172],[2.8441,49.1277],[2.845,49.129],[2.8438,49.1293],[2.8462,49.1327],[2.8577,49.1312],[2.8585,49.1335],[2.8611,49.1358],[2.8747,49.1358],[2.8751,49.1324],[2.8856,49.1323],[2.8877,49.1319],[2.8864,49.1308],[2.8917,49.1303],[2.8923,49.1288],[2.8915,49.1256],[2.8813,49.1244],[2.8709,49.1077],[2.8551,49.1018],[2.853,49.0991],[2.8533,49.097],[2.8483,49.0967]]]},"60149":{"type":"Polygon","coordinates":[[[2.6859,49.3723],[2.6937,49.3633],[2.6955,49.3636],[2.6968,49.3614],[2.7,49.3594],[2.6995,49.3542],[2.6985,49.352],[2.6997,49.3478],[2.6983,49.3475],[2.6984,49.345],[2.6995,49.344],[2.6988,49.3411],[2.7017,49.3409],[2.7019,49.3352],[2.6953,49.3338],[2.6964,49.3282],[2.6782,49.3272],[2.6764,49.3255],[2.6721,49.3245],[2.6656,49.3253],[2.6659,49.3264],[2.6621,49.327],[2.6624,49.3282],[2.66,49.3285],[2.6606,49.3309],[2.659,49.3326],[2.6596,49.3326],[2.6574,49.3407],[2.6552,49.3569],[2.6589,49.3579],[2.6576,49.3592],[2.6634,49.3605],[2.6641,49.3598],[2.6662,49.36],[2.6652,49.3614],[2.6704,49.3628],[2.671,49.3614],[2.6749,49.3624],[2.6736,49.3659],[2.6801,49.3669],[2.6779,49.3694],[2.6859,49.3723]]]},"60150":{"type":"Polygon","coordinates":[[[2.9233,49.542],[2.9235,49.5432],[2.9395,49.5463],[2.9434,49.5486],[2.9431,49.5494],[2.9469,49.5491],[2.9505,49.5507],[2.952,49.5498],[2.9555,49.5504],[2.9597,49.5497],[2.9676,49.547],[2.9698,49.5473],[2.9713,49.5466],[2.9723,49.5484],[2.9753,49.5462],[2.9798,49.5447],[2.9807,49.5478],[2.9835,49.5489],[2.983,49.5507],[2.984,49.5512],[2.9822,49.5526],[2.9835,49.5529],[2.9912,49.5506],[2.9923,49.5425],[2.9909,49.5329],[2.9893,49.5318],[2.9967,49.5276],[2.9929,49.5242],[2.9925,49.5214],[2.9911,49.5194],[2.9914,49.5185],[2.998,49.5139],[2.9969,49.5104],[2.9979,49.5083],[2.9977,49.5069],[2.99,49.5059],[2.9817,49.5084],[2.9821,49.5099],[2.9814,49.51],[2.979,49.5098],[2.9776,49.5087],[2.9678,49.5084],[2.9672,49.5076],[2.968,49.505],[2.9659,49.5046],[2.9656,49.5029],[2.9633,49.5035],[2.9637,49.5048],[2.963,49.5055],[2.9595,49.5043],[2.9569,49.505],[2.953,49.5079],[2.9541,49.5134],[2.9565,49.5148],[2.9625,49.5142],[2.968,49.5149],[2.9693,49.5159],[2.9698,49.5175],[2.9726,49.5183],[2.9716,49.5197],[2.972,49.5244],[2.9681,49.5251],[2.9679,49.5261],[2.9698,49.5271],[2.9661,49.5282],[2.9663,49.5299],[2.9679,49.5315],[2.966,49.5323],[2.9657,49.5332],[2.9694,49.5323],[2.9703,49.5335],[2.9699,49.535],[2.9413,49.5349],[2.9353,49.5362],[2.9308,49.5384],[2.926,49.5392],[2.9233,49.542]]]},"60151":{"type":"Polygon","coordinates":[[[2.8743,49.4615],[2.8768,49.4607],[2.8779,49.4615],[2.8791,49.4608],[2.8779,49.4602],[2.8839,49.4584],[2.8838,49.4577],[2.9024,49.4565],[2.9089,49.4498],[2.9415,49.4589],[2.9294,49.4417],[2.9341,49.4408],[2.9349,49.4394],[2.9343,49.4373],[2.9264,49.4288],[2.9218,49.4265],[2.9215,49.4251],[2.9175,49.4242],[2.9183,49.4229],[2.9156,49.4246],[2.9128,49.4297],[2.9133,49.4315],[2.9125,49.4326],[2.9095,49.4337],[2.9023,49.4323],[2.9001,49.4309],[2.8963,49.4243],[2.893,49.4263],[2.8932,49.4276],[2.8921,49.4281],[2.8922,49.4287],[2.8889,49.4293],[2.888,49.4281],[2.8839,49.4275],[2.8816,49.4282],[2.8819,49.4293],[2.8793,49.4301],[2.8775,49.4276],[2.8747,49.4282],[2.8673,49.4273],[2.863,49.4282],[2.8622,49.4271],[2.8602,49.4266],[2.8586,49.4279],[2.8593,49.4282],[2.859,49.4311],[2.8602,49.4313],[2.859,49.4324],[2.8496,49.4344],[2.8512,49.4366],[2.8582,49.437],[2.8642,49.4402],[2.8648,49.4448],[2.867,49.4501],[2.8655,49.4527],[2.8653,49.4553],[2.8681,49.459],[2.8743,49.4615]]]},"60152":{"type":"Polygon","coordinates":[[[2.613,49.4101],[2.6185,49.4094],[2.6138,49.4019],[2.6207,49.3974],[2.6188,49.3973],[2.6192,49.394],[2.6179,49.3945],[2.6181,49.3927],[2.6109,49.3941],[2.6094,49.3906],[2.6083,49.387],[2.6099,49.3847],[2.6095,49.3774],[2.61,49.3745],[2.6057,49.3653],[2.6063,49.3608],[2.6052,49.3552],[2.6026,49.3547],[2.6016,49.3591],[2.5935,49.3575],[2.5884,49.358],[2.5878,49.3555],[2.5868,49.3549],[2.5877,49.354],[2.5856,49.3502],[2.5865,49.35],[2.5851,49.3473],[2.5865,49.3468],[2.5855,49.3446],[2.5776,49.3456],[2.5776,49.3481],[2.5782,49.3481],[2.5787,49.3495],[2.5807,49.3492],[2.5828,49.3537],[2.5797,49.3552],[2.5816,49.3597],[2.5775,49.3633],[2.5782,49.3656],[2.5763,49.3658],[2.5766,49.3679],[2.5796,49.3685],[2.5793,49.3727],[2.5816,49.3718],[2.5809,49.3741],[2.5823,49.3743],[2.5832,49.3777],[2.5825,49.3795],[2.5852,49.3809],[2.5851,49.3823],[2.5879,49.3846],[2.5879,49.3868],[2.5932,49.3911],[2.5943,49.3977],[2.5921,49.3976],[2.5929,49.4001],[2.5968,49.4001],[2.5963,49.4011],[2.6087,49.405],[2.6115,49.4102],[2.613,49.4101]]]},"60153":{"type":"Polygon","coordinates":[[[2.0661,49.6382],[2.0649,49.6383],[2.0591,49.6352],[2.0561,49.6381],[2.0594,49.6391],[2.0587,49.64],[2.0579,49.6397],[2.0568,49.6407],[2.0558,49.6402],[2.0543,49.6413],[2.0523,49.6409],[2.051,49.6435],[2.0607,49.644],[2.0633,49.6445],[2.0655,49.6461],[2.0657,49.6518],[2.0644,49.6518],[2.0642,49.6549],[2.065,49.6553],[2.0643,49.656],[2.0737,49.6603],[2.0764,49.6601],[2.0781,49.6613],[2.0829,49.6599],[2.0902,49.6606],[2.0965,49.6562],[2.0927,49.6527],[2.0877,49.6515],[2.0876,49.6502],[2.0858,49.6503],[2.0861,49.6491],[2.0852,49.6486],[2.0844,49.6453],[2.0853,49.6431],[2.0821,49.642],[2.0809,49.6435],[2.0785,49.6423],[2.0738,49.6416],[2.0661,49.6382]]]},"60154":{"type":"Polygon","coordinates":[[[2.5331,49.3425],[2.5536,49.3398],[2.5515,49.3286],[2.5475,49.3276],[2.5431,49.3251],[2.5448,49.3239],[2.5465,49.3213],[2.5467,49.3204],[2.5435,49.3203],[2.5437,49.3162],[2.5461,49.315],[2.5413,49.3107],[2.5343,49.3086],[2.532,49.3083],[2.5314,49.3092],[2.5232,49.3069],[2.5202,49.3073],[2.5204,49.3079],[2.5189,49.3084],[2.5185,49.3079],[2.5146,49.3088],[2.5142,49.3131],[2.5148,49.313],[2.5147,49.315],[2.5165,49.3175],[2.5162,49.3185],[2.5184,49.3191],[2.5182,49.3201],[2.519,49.3205],[2.5186,49.3218],[2.5196,49.3222],[2.5187,49.3233],[2.5214,49.3242],[2.5198,49.3282],[2.5245,49.3277],[2.5331,49.3425]]]},"60155":{"type":"Polygon","coordinates":[[[2.3007,49.2568],[2.3045,49.2581],[2.3022,49.2605],[2.3045,49.2615],[2.3076,49.259],[2.319,49.2681],[2.3209,49.2674],[2.3221,49.2702],[2.3234,49.2699],[2.325,49.2728],[2.3278,49.2722],[2.3284,49.2755],[2.3276,49.2787],[2.3308,49.2798],[2.3309,49.2804],[2.329,49.281],[2.3284,49.2823],[2.3317,49.283],[2.3321,49.2822],[2.3332,49.2825],[2.3345,49.2857],[2.338,49.2853],[2.3422,49.2863],[2.3466,49.2883],[2.3461,49.2893],[2.3494,49.2905],[2.3497,49.2921],[2.3506,49.2921],[2.3514,49.2909],[2.3539,49.2914],[2.3551,49.29],[2.3568,49.2909],[2.3594,49.2866],[2.3623,49.2855],[2.3641,49.2857],[2.3651,49.2848],[2.3642,49.2797],[2.363,49.2792],[2.3627,49.2741],[2.3608,49.2733],[2.3622,49.2714],[2.3638,49.2711],[2.3646,49.2695],[2.3639,49.2687],[2.3641,49.2674],[2.3693,49.2661],[2.3655,49.2621],[2.3628,49.2613],[2.3624,49.26],[2.357,49.2611],[2.3593,49.2554],[2.3565,49.2547],[2.3565,49.2521],[2.3552,49.2511],[2.3563,49.2492],[2.3549,49.2477],[2.3567,49.2476],[2.3561,49.2463],[2.3566,49.2458],[2.3578,49.2462],[2.3583,49.2452],[2.3526,49.2412],[2.3426,49.2436],[2.3312,49.2397],[2.3162,49.2366],[2.3104,49.2396],[2.3113,49.2418],[2.3093,49.2441],[2.3134,49.2465],[2.3073,49.2518],[2.3085,49.2524],[2.306,49.2529],[2.3038,49.2545],[2.3025,49.2538],[2.3015,49.2543],[2.3008,49.2548],[2.3018,49.2556],[2.3007,49.2568]]]},"60156":{"type":"Polygon","coordinates":[[[2.8471,49.4533],[2.8471,49.4541],[2.8505,49.454],[2.8512,49.4533],[2.8505,49.4523],[2.852,49.4518],[2.8554,49.4539],[2.857,49.4539],[2.857,49.451],[2.8581,49.4483],[2.8662,49.4486],[2.8646,49.4438],[2.8645,49.4406],[2.8619,49.4387],[2.8582,49.437],[2.8512,49.4366],[2.8496,49.4344],[2.8435,49.4333],[2.8392,49.431],[2.8359,49.4281],[2.8257,49.4367],[2.8243,49.436],[2.8213,49.4381],[2.8291,49.4417],[2.827,49.4434],[2.8308,49.4437],[2.839,49.4496],[2.84,49.4493],[2.8458,49.4525],[2.8437,49.4526],[2.8471,49.4533]]]},"60157":{"type":"Polygon","coordinates":[[[2.4326,49.3823],[2.4338,49.3801],[2.4299,49.3798],[2.4307,49.3789],[2.4277,49.3776],[2.4281,49.3772],[2.4275,49.3768],[2.4209,49.3748],[2.4225,49.3741],[2.423,49.3731],[2.422,49.3727],[2.4224,49.372],[2.4185,49.3712],[2.4192,49.3702],[2.4186,49.3699],[2.4225,49.3672],[2.42,49.366],[2.419,49.3669],[2.4167,49.367],[2.4172,49.3681],[2.4116,49.369],[2.4074,49.3683],[2.405,49.3691],[2.3905,49.366],[2.386,49.3729],[2.3884,49.3732],[2.388,49.3752],[2.3893,49.3754],[2.3911,49.3783],[2.3941,49.3809],[2.3943,49.3817],[2.3917,49.3822],[2.3983,49.3883],[2.4063,49.3856],[2.4078,49.3886],[2.4051,49.3895],[2.4056,49.3902],[2.4121,49.3905],[2.4188,49.3895],[2.4205,49.388],[2.426,49.3867],[2.4291,49.3873],[2.4298,49.3868],[2.4295,49.3841],[2.4326,49.3823]]]},"60158":{"type":"Polygon","coordinates":[[[2.5714,49.5488],[2.5666,49.5442],[2.5659,49.5448],[2.5628,49.5437],[2.5635,49.5431],[2.5593,49.5409],[2.5628,49.5384],[2.5589,49.5357],[2.5577,49.5376],[2.5585,49.5384],[2.5572,49.5379],[2.5528,49.5408],[2.5531,49.5415],[2.5409,49.545],[2.5411,49.5458],[2.5384,49.5453],[2.5346,49.5473],[2.5368,49.5477],[2.5372,49.5525],[2.5378,49.5526],[2.5374,49.5564],[2.5404,49.5571],[2.5417,49.5597],[2.544,49.5602],[2.5314,49.5672],[2.5351,49.5727],[2.5379,49.5711],[2.5446,49.5715],[2.5518,49.5702],[2.5521,49.5684],[2.5566,49.5694],[2.5585,49.5665],[2.5609,49.5646],[2.5522,49.5627],[2.5525,49.5616],[2.5539,49.5601],[2.5605,49.5616],[2.565,49.5584],[2.5665,49.5581],[2.5662,49.5569],[2.5674,49.5563],[2.567,49.5549],[2.5681,49.555],[2.568,49.5538],[2.5695,49.5536],[2.5714,49.5488]]]},"60159":{"type":"Polygon","coordinates":[[[2.9301,49.4152],[2.9289,49.4115],[2.9237,49.4129],[2.9215,49.4118],[2.9201,49.4088],[2.9213,49.4077],[2.9209,49.404],[2.9155,49.4036],[2.9143,49.4019],[2.9091,49.398],[2.9006,49.3938],[2.8853,49.3905],[2.8921,49.3681],[2.8063,49.3668],[2.7933,49.3821],[2.7919,49.3815],[2.7895,49.3831],[2.7827,49.3845],[2.7792,49.3862],[2.782,49.3911],[2.7837,49.3961],[2.7951,49.4035],[2.797,49.4059],[2.7993,49.4113],[2.8029,49.4127],[2.8068,49.4129],[2.8121,49.4144],[2.8186,49.4178],[2.8176,49.4188],[2.8165,49.4186],[2.8151,49.4209],[2.8215,49.4241],[2.8235,49.4218],[2.8248,49.4221],[2.8253,49.4213],[2.8283,49.4226],[2.8398,49.4314],[2.8459,49.4342],[2.8507,49.4344],[2.8534,49.4332],[2.8587,49.4327],[2.8602,49.4313],[2.859,49.4311],[2.8588,49.4272],[2.8602,49.4266],[2.8622,49.4271],[2.863,49.4282],[2.8673,49.4273],[2.8747,49.4282],[2.8775,49.4276],[2.8793,49.4301],[2.8819,49.4293],[2.8816,49.4282],[2.8839,49.4275],[2.888,49.4281],[2.8889,49.4293],[2.8922,49.4287],[2.8921,49.4281],[2.8932,49.4276],[2.893,49.4263],[2.8963,49.4243],[2.9001,49.4309],[2.9023,49.4323],[2.9095,49.4337],[2.9125,49.4326],[2.9133,49.4315],[2.9128,49.4297],[2.9156,49.4246],[2.9183,49.4229],[2.9175,49.4242],[2.9187,49.4246],[2.9199,49.4213],[2.9217,49.419],[2.9258,49.4163],[2.9301,49.4152]]]},"60160":{"type":"Polygon","coordinates":[[[2.7573,49.6211],[2.7576,49.6181],[2.7596,49.6177],[2.7568,49.6144],[2.7556,49.6118],[2.7537,49.6019],[2.7529,49.602],[2.7522,49.5999],[2.7488,49.5988],[2.7452,49.5916],[2.7393,49.5876],[2.7384,49.5889],[2.7363,49.5895],[2.7346,49.587],[2.7313,49.5888],[2.7297,49.5887],[2.7282,49.5875],[2.723,49.5901],[2.7184,49.589],[2.7163,49.59],[2.7186,49.5935],[2.7198,49.5996],[2.7145,49.6035],[2.7159,49.6038],[2.7145,49.6044],[2.7146,49.6078],[2.7173,49.6093],[2.7219,49.6098],[2.7226,49.6143],[2.7198,49.6171],[2.7211,49.6176],[2.7188,49.6199],[2.7209,49.6216],[2.724,49.6234],[2.7249,49.6232],[2.7251,49.6247],[2.7273,49.6264],[2.738,49.6241],[2.7388,49.6273],[2.7485,49.6243],[2.7477,49.6233],[2.7573,49.6211]]]},"60161":{"type":"Polygon","coordinates":[[[2.0361,49.6443],[2.0418,49.6534],[2.0448,49.6558],[2.0444,49.6585],[2.0493,49.6593],[2.0523,49.6617],[2.0572,49.6634],[2.0604,49.6657],[2.062,49.666],[2.0634,49.665],[2.0615,49.6627],[2.0728,49.6616],[2.0737,49.6603],[2.0643,49.656],[2.065,49.6553],[2.0642,49.6549],[2.0644,49.6518],[2.0657,49.6518],[2.0655,49.6461],[2.0633,49.6445],[2.0532,49.6433],[2.0455,49.6439],[2.0457,49.6445],[2.0361,49.6443]]]},"60162":{"type":"Polygon","coordinates":[[[2.1158,49.2667],[2.1123,49.2698],[2.1098,49.268],[2.109,49.2687],[2.1073,49.2674],[2.1035,49.2696],[2.102,49.2695],[2.1019,49.2688],[2.0963,49.2694],[2.0956,49.2686],[2.0939,49.2688],[2.0969,49.2752],[2.0973,49.2819],[2.0968,49.2865],[2.1017,49.2874],[2.1122,49.2853],[2.1224,49.2851],[2.1248,49.2815],[2.1292,49.2828],[2.1297,49.2818],[2.1289,49.2798],[2.127,49.2789],[2.1253,49.2761],[2.1226,49.2759],[2.1225,49.2726],[2.1202,49.2724],[2.1214,49.2677],[2.1182,49.2661],[2.1164,49.266],[2.1158,49.2667]]]},"60163":{"type":"Polygon","coordinates":[[[2.2089,49.6342],[2.2054,49.635],[2.2049,49.633],[2.2055,49.6266],[2.2033,49.6265],[2.2034,49.6298],[2.1957,49.6263],[2.1929,49.6242],[2.1892,49.6265],[2.1879,49.6253],[2.1816,49.6286],[2.1791,49.6347],[2.1777,49.635],[2.1781,49.6379],[2.1767,49.6398],[2.1759,49.6471],[2.1783,49.6492],[2.1805,49.6486],[2.1836,49.6505],[2.1862,49.6485],[2.1884,49.6491],[2.2013,49.6562],[2.2033,49.6591],[2.21,49.6618],[2.2103,49.6608],[2.2115,49.6607],[2.2126,49.6573],[2.2157,49.6561],[2.217,49.6527],[2.2189,49.6518],[2.2209,49.6488],[2.2197,49.6474],[2.215,49.6464],[2.2151,49.6453],[2.2138,49.6458],[2.2133,49.6436],[2.2084,49.6454],[2.2069,49.6401],[2.212,49.6381],[2.2092,49.6357],[2.2089,49.6342]]]},"60164":{"type":"Polygon","coordinates":[[[1.8118,49.4216],[1.8454,49.413],[1.8517,49.4125],[1.8574,49.411],[1.8602,49.4095],[1.8605,49.41],[1.8674,49.4086],[1.8642,49.4068],[1.8647,49.4064],[1.8571,49.3997],[1.8611,49.396],[1.8611,49.3936],[1.8632,49.3914],[1.8623,49.3899],[1.8552,49.3851],[1.8541,49.3834],[1.8508,49.3824],[1.8486,49.3828],[1.8454,49.3812],[1.8409,49.3804],[1.838,49.3791],[1.8366,49.3772],[1.8351,49.3766],[1.8318,49.3799],[1.8335,49.384],[1.8332,49.3877],[1.8183,49.3884],[1.8167,49.3892],[1.8131,49.3934],[1.8042,49.3865],[1.801,49.3865],[1.8027,49.3912],[1.8013,49.3913],[1.8064,49.3946],[1.8079,49.3982],[1.8064,49.3987],[1.8074,49.4008],[1.8043,49.4021],[1.8051,49.4022],[1.8053,49.4051],[1.8064,49.407],[1.8023,49.409],[1.8029,49.4095],[1.8019,49.4103],[1.8034,49.4113],[1.8078,49.4117],[1.8072,49.412],[1.8103,49.415],[1.8118,49.415],[1.8144,49.4167],[1.8152,49.4183],[1.8089,49.419],[1.8118,49.4216]]]},"60165":{"type":"Polygon","coordinates":[[[2.1224,49.3216],[2.1232,49.3214],[2.1225,49.3211],[2.1275,49.3198],[2.1226,49.3173],[2.126,49.3165],[2.1259,49.3158],[2.1337,49.3152],[2.1354,49.3132],[2.1393,49.3131],[2.1382,49.3091],[2.1394,49.3077],[2.1396,49.306],[2.1369,49.305],[2.1376,49.2996],[2.133,49.299],[2.1211,49.2994],[2.1146,49.3025],[2.1101,49.303],[2.1083,49.3051],[2.1108,49.3102],[2.11,49.3105],[2.1124,49.3127],[2.1153,49.3137],[2.1109,49.3174],[2.1153,49.3178],[2.1224,49.3216]]]},"60166":{"type":"Polygon","coordinates":[[[2.8471,49.4533],[2.8437,49.4526],[2.844,49.4539],[2.8425,49.4552],[2.8393,49.4559],[2.8357,49.4581],[2.835,49.4574],[2.8322,49.4591],[2.8278,49.4596],[2.8255,49.457],[2.8234,49.4561],[2.8248,49.4542],[2.8117,49.4475],[2.8106,49.4484],[2.8031,49.4441],[2.8052,49.4425],[2.8032,49.4423],[2.7965,49.4428],[2.7906,49.4474],[2.7844,49.4426],[2.7795,49.444],[2.781,49.4454],[2.7797,49.4463],[2.7665,49.4501],[2.77,49.4538],[2.7731,49.4526],[2.7778,49.4573],[2.7708,49.4628],[2.7722,49.4643],[2.7708,49.4646],[2.7742,49.4704],[2.7809,49.4687],[2.78,49.4718],[2.7774,49.4727],[2.7792,49.4742],[2.7804,49.474],[2.781,49.4728],[2.7855,49.4718],[2.7866,49.4733],[2.7855,49.4736],[2.7858,49.4744],[2.7916,49.473],[2.7926,49.4743],[2.8004,49.4716],[2.8018,49.4735],[2.8051,49.4731],[2.8064,49.4727],[2.8049,49.4704],[2.8023,49.4711],[2.8011,49.4703],[2.811,49.4663],[2.8216,49.4662],[2.8252,49.4671],[2.8263,49.4663],[2.8305,49.4659],[2.8326,49.465],[2.8313,49.4642],[2.8324,49.4631],[2.8308,49.4621],[2.8471,49.4533]]]},"60167":{"type":"Polygon","coordinates":[[[3.0288,49.3897],[3.0257,49.3907],[3.0243,49.3928],[3.0185,49.3938],[3.0166,49.3955],[3.0175,49.3966],[3.0163,49.3981],[3.0129,49.3971],[3.0112,49.4017],[3.0123,49.4071],[3.0189,49.4085],[3.0239,49.4086],[3.0275,49.41],[3.0391,49.4089],[3.0382,49.4063],[3.0451,49.404],[3.0435,49.3977],[3.036,49.394],[3.0333,49.3889],[3.0323,49.3894],[3.0308,49.3886],[3.0288,49.3897]]]},"60168":{"type":"Polygon","coordinates":[[[2.6279,49.5855],[2.6288,49.5851],[2.6272,49.584],[2.6287,49.5815],[2.6303,49.5806],[2.6293,49.5802],[2.63,49.5792],[2.6309,49.5797],[2.6322,49.5789],[2.6332,49.58],[2.6392,49.5763],[2.6399,49.5767],[2.64,49.5758],[2.6406,49.5762],[2.6532,49.5701],[2.6447,49.5635],[2.6438,49.5637],[2.6409,49.5602],[2.6383,49.561],[2.636,49.5582],[2.6282,49.5609],[2.6281,49.5585],[2.6271,49.5589],[2.6266,49.5584],[2.625,49.5594],[2.622,49.558],[2.6215,49.5584],[2.6197,49.5557],[2.6132,49.5586],[2.6143,49.5592],[2.6089,49.563],[2.6092,49.5687],[2.6034,49.5719],[2.6135,49.5805],[2.6122,49.5814],[2.6137,49.5828],[2.616,49.5815],[2.6181,49.5834],[2.6214,49.5817],[2.6279,49.5855]]]},"60169":{"type":"Polygon","coordinates":[[[1.7669,49.252],[1.7641,49.2528],[1.7453,49.2524],[1.7295,49.2553],[1.7247,49.2548],[1.72,49.2491],[1.7134,49.2498],[1.7045,49.2493],[1.7051,49.2527],[1.701,49.2523],[1.7078,49.2552],[1.7084,49.2579],[1.7077,49.2608],[1.7065,49.2615],[1.7096,49.2625],[1.7082,49.264],[1.7087,49.2647],[1.7262,49.2648],[1.7302,49.2661],[1.7315,49.2676],[1.7364,49.2703],[1.7433,49.2682],[1.7476,49.269],[1.7474,49.2684],[1.7482,49.2679],[1.7494,49.2689],[1.7495,49.268],[1.751,49.2675],[1.7537,49.2687],[1.7566,49.2719],[1.7589,49.2724],[1.7583,49.2676],[1.7567,49.2673],[1.7566,49.2662],[1.7586,49.2656],[1.759,49.2628],[1.7619,49.2631],[1.7618,49.2614],[1.765,49.2634],[1.7668,49.2615],[1.7673,49.2587],[1.7688,49.2562],[1.7669,49.252]]]},"60170":{"type":"Polygon","coordinates":[[[2.5281,49.2105],[2.5422,49.2153],[2.5459,49.2213],[2.5481,49.2225],[2.5595,49.2127],[2.5578,49.2109],[2.5651,49.2088],[2.5616,49.2036],[2.5625,49.2008],[2.5613,49.1995],[2.5552,49.1986],[2.5564,49.1977],[2.5566,49.1964],[2.5452,49.196],[2.5454,49.1974],[2.5442,49.1977],[2.5434,49.1963],[2.5352,49.1958],[2.5258,49.1938],[2.5247,49.1966],[2.529,49.197],[2.5287,49.1996],[2.5301,49.1997],[2.53,49.2008],[2.5265,49.201],[2.5267,49.2039],[2.5278,49.2053],[2.527,49.2059],[2.5283,49.2068],[2.5279,49.2094],[2.5255,49.2096],[2.5281,49.2105]]]},"60171":{"type":"Polygon","coordinates":[[[3.0826,49.3979],[3.0903,49.3984],[3.092,49.3972],[3.091,49.3965],[3.091,49.3948],[3.0903,49.3939],[3.0915,49.3917],[3.0907,49.3892],[3.0937,49.3857],[3.0945,49.3806],[3.0954,49.3796],[3.095,49.3765],[3.0923,49.3752],[3.0905,49.3752],[3.089,49.3777],[3.0848,49.3767],[3.0804,49.374],[3.0798,49.3748],[3.0777,49.3742],[3.0772,49.3751],[3.0729,49.3741],[3.072,49.3762],[3.0741,49.3764],[3.0751,49.3772],[3.0752,49.3793],[3.0796,49.382],[3.0784,49.3828],[3.0772,49.3822],[3.0755,49.3837],[3.0772,49.3856],[3.0775,49.3867],[3.0765,49.3871],[3.0783,49.3881],[3.0793,49.3905],[3.0806,49.3907],[3.0812,49.3919],[3.0806,49.3938],[3.0809,49.3946],[3.0823,49.3945],[3.0826,49.3979]]]},"60172":{"type":"Polygon","coordinates":[[[2.4355,49.134],[2.4408,49.1459],[2.4477,49.1446],[2.4474,49.1457],[2.449,49.1471],[2.4551,49.1478],[2.4546,49.149],[2.4555,49.1494],[2.4615,49.1505],[2.4638,49.1502],[2.4675,49.1514],[2.4677,49.1529],[2.4721,49.1553],[2.4827,49.1579],[2.4842,49.1591],[2.4871,49.1597],[2.4898,49.1581],[2.4957,49.1585],[2.4945,49.158],[2.4946,49.1567],[2.5002,49.1568],[2.4842,49.1387],[2.4842,49.1364],[2.4826,49.1326],[2.4788,49.131],[2.4753,49.131],[2.4715,49.1354],[2.4697,49.1353],[2.4695,49.1347],[2.4676,49.135],[2.4676,49.1361],[2.4613,49.1361],[2.4625,49.1393],[2.4589,49.1409],[2.4477,49.136],[2.4403,49.1342],[2.4355,49.134]]]},"60173":{"type":"Polygon","coordinates":[[[2.4169,49.2515],[2.4156,49.2501],[2.4179,49.2495],[2.4165,49.2491],[2.4167,49.2423],[2.4071,49.242],[2.4093,49.2371],[2.3971,49.2407],[2.395,49.2384],[2.3949,49.2367],[2.3859,49.2379],[2.3825,49.2373],[2.3816,49.2386],[2.379,49.2373],[2.3721,49.2406],[2.3722,49.2427],[2.3739,49.245],[2.3737,49.2461],[2.3769,49.2498],[2.3787,49.2505],[2.3791,49.2529],[2.3823,49.252],[2.384,49.2552],[2.3794,49.2562],[2.3799,49.257],[2.3763,49.2586],[2.3775,49.2604],[2.3888,49.2599],[2.3933,49.2589],[2.3978,49.2603],[2.4031,49.258],[2.4034,49.2596],[2.4055,49.261],[2.4083,49.2591],[2.4095,49.2571],[2.4137,49.2551],[2.4093,49.2549],[2.4134,49.2544],[2.4157,49.2532],[2.4158,49.2517],[2.4169,49.2515]]]},"60174":{"type":"Polygon","coordinates":[[[2.7957,49.6298],[2.7896,49.6381],[2.7913,49.6397],[2.7892,49.6402],[2.7914,49.6447],[2.7931,49.6446],[2.7914,49.6483],[2.7936,49.6486],[2.7934,49.6494],[2.7947,49.6497],[2.7935,49.6557],[2.8024,49.6588],[2.8046,49.6502],[2.8038,49.6496],[2.8053,49.649],[2.8051,49.6466],[2.8081,49.6458],[2.8119,49.6393],[2.8167,49.6397],[2.8219,49.6383],[2.8231,49.637],[2.822,49.6349],[2.8236,49.6346],[2.825,49.6354],[2.8261,49.6348],[2.8264,49.6354],[2.8274,49.6346],[2.8294,49.6354],[2.83,49.6347],[2.8307,49.6358],[2.8395,49.6344],[2.8411,49.635],[2.8439,49.6323],[2.8445,49.6308],[2.8399,49.6278],[2.8384,49.6282],[2.8364,49.6307],[2.8348,49.6312],[2.8342,49.6327],[2.8321,49.6338],[2.8288,49.6342],[2.8281,49.634],[2.8304,49.6291],[2.8284,49.6268],[2.8274,49.6266],[2.818,49.6322],[2.8128,49.6326],[2.81,49.6347],[2.8098,49.6357],[2.8077,49.6366],[2.8049,49.6253],[2.8029,49.6283],[2.7957,49.6298]]]},"60175":{"type":"Polygon","coordinates":[[[2.4875,49.2368],[2.4761,49.2408],[2.4742,49.2407],[2.4758,49.2431],[2.4708,49.245],[2.4683,49.2437],[2.4655,49.2402],[2.4592,49.2419],[2.4599,49.243],[2.4665,49.2442],[2.4673,49.2451],[2.4599,49.2446],[2.4572,49.245],[2.4559,49.2463],[2.4564,49.2488],[2.4554,49.2499],[2.4581,49.2531],[2.4557,49.254],[2.4544,49.2552],[2.4548,49.2556],[2.4532,49.2563],[2.4589,49.2599],[2.4568,49.2616],[2.4602,49.2641],[2.4731,49.267],[2.4735,49.266],[2.4834,49.27],[2.4887,49.2656],[2.4916,49.2685],[2.4948,49.2739],[2.4973,49.2745],[2.4981,49.2726],[2.4975,49.2712],[2.4988,49.2702],[2.4972,49.2694],[2.4985,49.2678],[2.4953,49.2655],[2.506,49.2577],[2.5073,49.258],[2.5124,49.2562],[2.5101,49.248],[2.5151,49.2461],[2.5126,49.2434],[2.5148,49.2428],[2.4875,49.2368]]]},"60176":{"type":"Polygon","coordinates":[[[2.9355,49.2332],[2.9362,49.2282],[2.9336,49.2287],[2.9321,49.2277],[2.9276,49.2293],[2.9271,49.2255],[2.9319,49.2231],[2.9297,49.2209],[2.9299,49.2202],[2.9273,49.22],[2.9277,49.2208],[2.925,49.2219],[2.9243,49.2199],[2.9189,49.2172],[2.9179,49.2159],[2.9166,49.2155],[2.9156,49.2161],[2.9146,49.2157],[2.9153,49.2152],[2.9112,49.2131],[2.9038,49.2144],[2.902,49.2133],[2.8982,49.22],[2.8939,49.221],[2.8934,49.2198],[2.8894,49.2188],[2.8855,49.2186],[2.8852,49.2197],[2.8793,49.2198],[2.8784,49.2212],[2.8688,49.2262],[2.8716,49.2284],[2.8726,49.2281],[2.8734,49.2288],[2.8742,49.2299],[2.8729,49.2301],[2.8742,49.2305],[2.8746,49.2327],[2.8668,49.2347],[2.8675,49.2369],[2.8655,49.2372],[2.8692,49.2428],[2.8677,49.2429],[2.8684,49.2441],[2.8634,49.2448],[2.8652,49.2473],[2.8648,49.2484],[2.8675,49.2509],[2.8659,49.2527],[2.8656,49.2554],[2.8793,49.2533],[2.8794,49.2601],[2.8899,49.2586],[2.9075,49.2545],[2.9073,49.2508],[2.9233,49.2385],[2.9255,49.24],[2.9246,49.2375],[2.9254,49.2373],[2.9249,49.2364],[2.9258,49.2363],[2.9251,49.2341],[2.9283,49.2337],[2.9279,49.2331],[2.9303,49.2322],[2.9306,49.2331],[2.9355,49.2332]]]},"60177":{"type":"Polygon","coordinates":[[[2.5992,49.4461],[2.5999,49.4435],[2.5969,49.4403],[2.5812,49.4437],[2.5711,49.4412],[2.569,49.4399],[2.5725,49.4364],[2.569,49.4308],[2.5635,49.4316],[2.5627,49.433],[2.5636,49.4333],[2.5628,49.4344],[2.5564,49.437],[2.5568,49.4399],[2.5538,49.4458],[2.5516,49.4459],[2.5462,49.4482],[2.5442,49.4516],[2.5411,49.4528],[2.5514,49.4556],[2.5578,49.4596],[2.56,49.4599],[2.5607,49.4621],[2.5628,49.4616],[2.5642,49.4628],[2.5713,49.4599],[2.5716,49.4606],[2.5788,49.4582],[2.5837,49.4611],[2.5834,49.4562],[2.5858,49.4526],[2.5827,49.4521],[2.5843,49.4473],[2.5869,49.4469],[2.5881,49.4475],[2.5992,49.4461]]]},"60178":{"type":"Polygon","coordinates":[[[2.0621,49.5837],[2.06,49.5818],[2.058,49.5819],[2.0557,49.5837],[2.0555,49.5856],[2.0548,49.5859],[2.056,49.5897],[2.0632,49.599],[2.0643,49.5985],[2.0661,49.5993],[2.0653,49.6],[2.0664,49.6004],[2.0659,49.6008],[2.0677,49.6031],[2.0647,49.6046],[2.0664,49.6058],[2.0616,49.6085],[2.0631,49.6101],[2.0618,49.6106],[2.0687,49.6193],[2.0721,49.6186],[2.0673,49.629],[2.0761,49.6335],[2.0757,49.6341],[2.0806,49.6361],[2.0858,49.6378],[2.092,49.638],[2.0937,49.6388],[2.095,49.6364],[2.0908,49.6355],[2.0949,49.6332],[2.096,49.6337],[2.0971,49.633],[2.098,49.6295],[2.0933,49.6285],[2.0929,49.6271],[2.0939,49.6238],[2.099,49.6222],[2.1021,49.6238],[2.104,49.6238],[2.1065,49.6222],[2.1071,49.6196],[2.1099,49.6183],[2.1114,49.6146],[2.1134,49.6132],[2.1138,49.6102],[2.1095,49.6101],[2.1084,49.6044],[2.1174,49.6043],[2.1172,49.5985],[2.097,49.6026],[2.0961,49.6004],[2.0926,49.6015],[2.0811,49.5946],[2.0804,49.5967],[2.076,49.5936],[2.0677,49.5973],[2.0632,49.5931],[2.0621,49.5837]]]},"60179":{"type":"Polygon","coordinates":[[[2.4872,49.5613],[2.4895,49.5629],[2.4897,49.5672],[2.4926,49.5706],[2.4958,49.5723],[2.4892,49.5783],[2.488,49.5855],[2.4889,49.5856],[2.4893,49.588],[2.4955,49.5869],[2.4972,49.5876],[2.4995,49.5853],[2.5014,49.5801],[2.5052,49.5802],[2.5094,49.5785],[2.508,49.5776],[2.5097,49.5764],[2.5131,49.5781],[2.5138,49.5756],[2.5157,49.5742],[2.516,49.5732],[2.5144,49.5734],[2.5078,49.5704],[2.5087,49.5698],[2.509,49.5655],[2.5021,49.5663],[2.5023,49.5633],[2.4987,49.5641],[2.4933,49.5584],[2.4872,49.5613]]]},"60180":{"type":"Polygon","coordinates":[[[1.9462,49.5309],[1.9453,49.5305],[1.9468,49.5293],[1.944,49.5274],[1.9447,49.5259],[1.9414,49.5174],[1.9439,49.5166],[1.9432,49.5147],[1.9422,49.5152],[1.9359,49.515],[1.9286,49.5166],[1.9269,49.5144],[1.9169,49.5085],[1.9172,49.5079],[1.915,49.506],[1.9099,49.5027],[1.9078,49.5044],[1.9088,49.5052],[1.9029,49.5099],[1.9012,49.5092],[1.8985,49.5115],[1.9009,49.5125],[1.9002,49.5134],[1.9067,49.5165],[1.9094,49.5186],[1.9101,49.5205],[1.9108,49.5205],[1.9094,49.522],[1.9104,49.5229],[1.9088,49.5231],[1.9128,49.5295],[1.9115,49.5299],[1.9136,49.5339],[1.9111,49.5357],[1.9143,49.5384],[1.9204,49.5407],[1.9244,49.5408],[1.9296,49.5447],[1.9324,49.5481],[1.9387,49.5444],[1.9432,49.5431],[1.9422,49.5414],[1.9428,49.5329],[1.9462,49.5309]]]},"60181":{"type":"Polygon","coordinates":[[[3.0437,49.6062],[3.049,49.6034],[3.0431,49.6017],[3.0414,49.604],[3.037,49.6033],[3.0344,49.6069],[3.0288,49.6054],[3.0281,49.6044],[3.0261,49.6045],[3.0253,49.6062],[3.0212,49.6077],[3.0193,49.6053],[3.017,49.6064],[3.0162,49.6059],[3.012,49.6078],[3.0086,49.6082],[3.0098,49.6112],[3.007,49.6191],[3.0052,49.6214],[3.0032,49.6216],[3.0038,49.6229],[2.9969,49.6241],[2.9986,49.6276],[3.0001,49.6272],[3.0025,49.6291],[3.0034,49.6311],[2.9977,49.6286],[2.9955,49.6305],[3.0,49.633],[2.9988,49.6351],[3.0012,49.6358],[3.0013,49.6364],[3.0062,49.6371],[3.0076,49.638],[3.0068,49.6388],[3.011,49.6407],[3.0158,49.6403],[3.0168,49.6417],[3.0209,49.641],[3.0214,49.6403],[3.0339,49.6385],[3.037,49.6407],[3.0372,49.6397],[3.0427,49.6391],[3.0373,49.6315],[3.0384,49.6313],[3.0386,49.6303],[3.0374,49.6272],[3.0379,49.6264],[3.0405,49.6242],[3.0428,49.6249],[3.0462,49.6241],[3.0472,49.6214],[3.0545,49.6207],[3.0571,49.6177],[3.0489,49.6171],[3.0446,49.6149],[3.039,49.614],[3.0396,49.6134],[3.0397,49.6077],[3.0418,49.6075],[3.0437,49.6062]]]},"60182":{"type":"Polygon","coordinates":[[[2.2033,49.6265],[2.2027,49.6138],[2.1764,49.6129],[2.1745,49.6153],[2.1788,49.6209],[2.1773,49.6211],[2.1783,49.6233],[2.1774,49.6235],[2.1776,49.6248],[2.1762,49.6278],[2.1777,49.635],[2.1791,49.6347],[2.1816,49.6286],[2.1879,49.6253],[2.1892,49.6265],[2.1929,49.6242],[2.1957,49.6263],[2.2034,49.6298],[2.2033,49.6265]]]},"60183":{"type":"Polygon","coordinates":[[[2.2152,49.6869],[2.209,49.6859],[2.2045,49.686],[2.2042,49.6869],[2.201,49.6879],[2.1992,49.6822],[2.1964,49.6822],[2.1942,49.6796],[2.1922,49.6801],[2.1884,49.6776],[2.1878,49.678],[2.1837,49.6746],[2.1823,49.6755],[2.1809,49.6746],[2.1759,49.6738],[2.1756,49.6706],[2.1764,49.6685],[2.1737,49.6684],[2.1707,49.6693],[2.1728,49.6724],[2.1725,49.6732],[2.1732,49.6734],[2.1724,49.6738],[2.1736,49.6755],[2.1747,49.6802],[2.1725,49.6805],[2.1728,49.6819],[2.1692,49.6837],[2.1595,49.6849],[2.1585,49.6834],[2.1438,49.6859],[2.1416,49.6856],[2.1384,49.6815],[2.1257,49.6835],[2.1242,49.6879],[2.1283,49.6895],[2.1326,49.6892],[2.1342,49.6897],[2.1338,49.6902],[2.1344,49.6906],[2.1408,49.6915],[2.1468,49.6986],[2.1501,49.7001],[2.1518,49.7022],[2.1626,49.703],[2.1659,49.7021],[2.1659,49.703],[2.1687,49.7014],[2.174,49.7011],[2.1821,49.7042],[2.187,49.7022],[2.1904,49.7038],[2.1936,49.7016],[2.1987,49.6961],[2.2098,49.6908],[2.213,49.6879],[2.2152,49.6869]]]},"60184":{"type":"Polygon","coordinates":[[[3.0235,49.3782],[3.0243,49.379],[3.0235,49.3802],[3.0296,49.3799],[3.0344,49.3862],[3.0318,49.3857],[3.0323,49.3865],[3.0301,49.3873],[3.0288,49.3897],[3.0308,49.3886],[3.0323,49.3894],[3.0333,49.3889],[3.0353,49.3929],[3.0383,49.3924],[3.0393,49.3906],[3.0417,49.389],[3.0434,49.3897],[3.0445,49.3891],[3.0444,49.388],[3.0454,49.3886],[3.0484,49.3873],[3.0485,49.3863],[3.0468,49.3865],[3.046,49.385],[3.0439,49.3852],[3.0436,49.384],[3.042,49.3841],[3.042,49.3812],[3.044,49.3804],[3.0424,49.3748],[3.0448,49.3739],[3.0464,49.3712],[3.0406,49.368],[3.0398,49.3655],[3.0459,49.3649],[3.0454,49.3641],[3.0424,49.3645],[3.0411,49.3636],[3.0377,49.364],[3.0373,49.3634],[3.0345,49.3645],[3.0339,49.3638],[3.0301,49.3654],[3.0253,49.3659],[3.0256,49.3665],[3.0245,49.3671],[3.0271,49.3697],[3.0264,49.3707],[3.0283,49.3728],[3.0283,49.3749],[3.0235,49.3782]]]},"60185":{"type":"Polygon","coordinates":[[[2.3281,49.2239],[2.3331,49.2185],[2.3339,49.211],[2.3335,49.2063],[2.3352,49.2061],[2.3344,49.2028],[2.3317,49.2003],[2.3356,49.197],[2.3412,49.194],[2.3371,49.1911],[2.3346,49.1936],[2.3302,49.1917],[2.3293,49.1921],[2.3288,49.1943],[2.3267,49.1946],[2.325,49.1977],[2.3226,49.1975],[2.317,49.1991],[2.3178,49.1994],[2.3146,49.2022],[2.316,49.2029],[2.315,49.204],[2.3135,49.2037],[2.3077,49.2059],[2.3053,49.2078],[2.3024,49.2079],[2.3032,49.2148],[2.3014,49.2218],[2.3115,49.2228],[2.3114,49.2234],[2.317,49.2238],[2.3246,49.223],[2.3281,49.2239]]]},"60186":{"type":"Polygon","coordinates":[[[2.4576,49.437],[2.4541,49.4404],[2.4489,49.4415],[2.4486,49.4449],[2.4529,49.4438],[2.4564,49.4467],[2.4556,49.4545],[2.4581,49.4572],[2.4546,49.4599],[2.4564,49.4655],[2.4643,49.4645],[2.4641,49.4636],[2.4672,49.4633],[2.4723,49.4565],[2.474,49.4572],[2.4751,49.456],[2.4758,49.4565],[2.482,49.4493],[2.4836,49.4504],[2.4823,49.4512],[2.4837,49.4518],[2.4862,49.4515],[2.4875,49.4524],[2.4887,49.4517],[2.4925,49.4545],[2.4948,49.4532],[2.4961,49.4552],[2.4975,49.4548],[2.4947,49.4505],[2.4933,49.45],[2.4933,49.4459],[2.495,49.4455],[2.4946,49.4441],[2.4934,49.4444],[2.493,49.4411],[2.4869,49.4363],[2.4853,49.4339],[2.4822,49.4346],[2.4813,49.4362],[2.4819,49.4373],[2.4733,49.4366],[2.4737,49.4375],[2.4637,49.4385],[2.464,49.4401],[2.4601,49.4404],[2.4576,49.437]]]},"60187":{"type":"Polygon","coordinates":[[[1.8468,49.4127],[1.8171,49.42],[1.8118,49.4216],[1.8122,49.423],[1.8108,49.4231],[1.8116,49.4265],[1.8108,49.4273],[1.8122,49.4288],[1.8107,49.4291],[1.8143,49.4361],[1.8186,49.4393],[1.8225,49.4512],[1.8469,49.4455],[1.846,49.4438],[1.8475,49.443],[1.8515,49.4429],[1.8534,49.4418],[1.8569,49.4425],[1.8579,49.442],[1.856,49.4409],[1.8632,49.4412],[1.8565,49.4266],[1.8498,49.4269],[1.8476,49.4201],[1.848,49.4154],[1.8468,49.4127]]]},"60188":{"type":"Polygon","coordinates":[[[2.9705,49.3703],[2.9694,49.3812],[2.9764,49.3829],[2.9778,49.3839],[2.9775,49.3883],[2.9934,49.3955],[2.9981,49.4007],[2.9993,49.4036],[3.0006,49.4038],[3.0004,49.4059],[3.0016,49.407],[3.0123,49.4071],[3.0112,49.4017],[3.0129,49.3971],[3.0163,49.3981],[3.0175,49.3966],[3.0166,49.3955],[3.0185,49.3938],[3.0243,49.3928],[3.0255,49.3908],[3.0285,49.3899],[3.0301,49.3873],[3.0323,49.3865],[3.0318,49.3857],[3.0344,49.3862],[3.0296,49.3799],[3.0235,49.3802],[3.0243,49.379],[3.0235,49.3782],[3.0214,49.3798],[3.0193,49.3792],[3.0161,49.3795],[3.0116,49.3785],[3.0125,49.3768],[3.0114,49.377],[3.0107,49.3785],[3.0098,49.3784],[3.0087,49.3774],[3.0018,49.3759],[2.9984,49.372],[2.9936,49.3701],[2.9885,49.3701],[2.9885,49.371],[2.9705,49.3703]]]},"60189":{"type":"Polygon","coordinates":[[[3.0734,49.5381],[3.0797,49.541],[3.0908,49.5438],[3.1033,49.5515],[3.1122,49.5524],[3.118,49.5502],[3.1189,49.5506],[3.1226,49.5478],[3.1229,49.5456],[3.126,49.5422],[3.1273,49.5357],[3.1282,49.5356],[3.129,49.5339],[3.1269,49.5293],[3.1282,49.5276],[3.1243,49.5244],[3.1257,49.5234],[3.1234,49.5216],[3.1227,49.5196],[3.1217,49.5197],[3.1215,49.5208],[3.119,49.5215],[3.1106,49.5206],[3.1057,49.5188],[3.096,49.518],[3.096,49.5189],[3.0897,49.5217],[3.0859,49.525],[3.0824,49.5265],[3.0801,49.5251],[3.0748,49.5259],[3.0744,49.5275],[3.0698,49.5318],[3.0713,49.5335],[3.0729,49.5337],[3.0743,49.5355],[3.0751,49.5371],[3.0734,49.5381]]]},"60190":{"type":"Polygon","coordinates":[[[2.9812,49.1846],[2.9838,49.1844],[2.9853,49.1885],[2.9887,49.1879],[2.989,49.1885],[3.0,49.1862],[3.0058,49.183],[3.0162,49.1827],[3.0186,49.1758],[3.0227,49.1709],[3.0142,49.1695],[3.0151,49.1692],[3.0122,49.1652],[3.0137,49.1645],[3.0108,49.1595],[3.0009,49.1607],[2.9977,49.1593],[2.9956,49.1598],[2.9901,49.159],[2.9895,49.16],[2.9871,49.1583],[2.9854,49.159],[2.984,49.1649],[2.9828,49.1649],[2.9832,49.166],[2.9807,49.1662],[2.9813,49.1685],[2.9805,49.1684],[2.9783,49.1746],[2.9808,49.1793],[2.9806,49.1837],[2.9812,49.1846]]]},"60191":{"type":"Polygon","coordinates":[[[2.7032,49.5288],[2.6968,49.5296],[2.6981,49.5318],[2.691,49.534],[2.6914,49.5353],[2.6902,49.5376],[2.6905,49.5383],[2.6924,49.5393],[2.6964,49.5437],[2.6943,49.5444],[2.6928,49.5464],[2.6911,49.5461],[2.6882,49.5477],[2.6872,49.5469],[2.6831,49.5493],[2.6761,49.5476],[2.6739,49.554],[2.669,49.5531],[2.6673,49.5579],[2.6696,49.5584],[2.6691,49.5608],[2.675,49.562],[2.6821,49.5582],[2.6887,49.5609],[2.6895,49.563],[2.6981,49.5621],[2.698,49.5603],[2.6993,49.5614],[2.7068,49.5597],[2.707,49.5588],[2.7122,49.559],[2.7137,49.5568],[2.7245,49.5585],[2.7245,49.5576],[2.7257,49.5577],[2.7261,49.5562],[2.7236,49.555],[2.7251,49.5537],[2.7244,49.5528],[2.7294,49.5493],[2.7258,49.5441],[2.7228,49.5419],[2.714,49.5423],[2.7105,49.5368],[2.7133,49.5374],[2.7128,49.5354],[2.7111,49.5346],[2.7068,49.5303],[2.7032,49.5288]]]},"60192":{"type":"Polygon","coordinates":[[[2.8954,49.5772],[2.892,49.5796],[2.8917,49.5816],[2.8935,49.5823],[2.8909,49.5855],[2.8945,49.5883],[2.8942,49.5896],[2.8933,49.5893],[2.893,49.5901],[2.9032,49.592],[2.9046,49.5962],[2.904,49.5983],[2.9061,49.5985],[2.9079,49.5965],[2.9089,49.5966],[2.9087,49.5955],[2.9095,49.5955],[2.9105,49.5927],[2.9158,49.5938],[2.9231,49.5968],[2.9236,49.5942],[2.9256,49.5944],[2.9278,49.5926],[2.9265,49.5882],[2.9235,49.5852],[2.9242,49.5852],[2.9241,49.5841],[2.923,49.5824],[2.9226,49.5787],[2.9198,49.5791],[2.9137,49.5769],[2.9114,49.5784],[2.909,49.5768],[2.9075,49.5777],[2.9044,49.5753],[2.8988,49.5737],[2.8954,49.5772]]]},"60193":{"type":"Polygon","coordinates":[[[1.8945,49.6996],[1.9142,49.7122],[1.9173,49.7154],[1.9194,49.7159],[1.9225,49.715],[1.9272,49.717],[1.9278,49.7165],[1.9292,49.7189],[1.9333,49.72],[1.9353,49.7197],[1.9362,49.7153],[1.9378,49.713],[1.9468,49.704],[1.9488,49.7007],[1.9442,49.6982],[1.9365,49.6897],[1.936,49.6914],[1.9214,49.6865],[1.9133,49.6859],[1.9102,49.6859],[1.9079,49.6867],[1.9055,49.6888],[1.9037,49.692],[1.8995,49.6949],[1.9004,49.6956],[1.8984,49.6956],[1.9024,49.698],[1.9019,49.6984],[1.9009,49.699],[1.8968,49.697],[1.896,49.6976],[1.897,49.6983],[1.8945,49.6996]]]},"60194":{"type":"Polygon","coordinates":[[[1.9376,49.6912],[1.9442,49.6982],[1.9475,49.7004],[1.9529,49.7021],[1.9562,49.7056],[1.9591,49.7069],[1.9621,49.7108],[1.9642,49.7165],[1.9715,49.7202],[1.9715,49.7158],[1.978,49.7097],[1.9828,49.7117],[1.9838,49.7104],[1.989,49.7117],[1.989,49.7088],[2.0022,49.7134],[2.003,49.7123],[2.0065,49.7128],[2.0051,49.7111],[2.0079,49.7086],[2.0113,49.7079],[2.0172,49.7082],[2.0224,49.7113],[2.0282,49.7109],[2.0266,49.7102],[2.0224,49.7055],[2.0233,49.7053],[2.0225,49.7031],[2.0278,49.7031],[2.0287,49.6997],[2.0257,49.7],[2.0263,49.6974],[2.0252,49.6972],[2.0252,49.6962],[2.028,49.6947],[2.0274,49.6942],[2.0189,49.6928],[2.0042,49.6936],[1.9968,49.6925],[1.986,49.6875],[1.9836,49.6839],[1.9773,49.6882],[1.9729,49.6848],[1.9682,49.6831],[1.9605,49.6833],[1.9543,49.681],[1.9519,49.684],[1.9487,49.6842],[1.9467,49.6854],[1.9455,49.6842],[1.9438,49.6872],[1.9376,49.6912]]]},"60195":{"type":"Polygon","coordinates":[[[1.8452,49.2168],[1.8405,49.2197],[1.8411,49.2163],[1.8346,49.2177],[1.8318,49.2169],[1.8189,49.2252],[1.8146,49.2244],[1.8104,49.2289],[1.8135,49.2301],[1.8147,49.2339],[1.8166,49.2342],[1.8185,49.2356],[1.8175,49.2361],[1.8234,49.2393],[1.8202,49.2415],[1.8219,49.2425],[1.8213,49.2436],[1.8237,49.244],[1.8236,49.2454],[1.8245,49.2455],[1.8256,49.248],[1.8236,49.2496],[1.8218,49.2488],[1.8185,49.2512],[1.8149,49.2512],[1.816,49.2537],[1.8199,49.252],[1.822,49.252],[1.8218,49.2544],[1.824,49.2546],[1.8236,49.2549],[1.8243,49.2566],[1.8321,49.2572],[1.8327,49.2609],[1.8375,49.2657],[1.8489,49.2626],[1.847,49.2605],[1.8536,49.257],[1.8513,49.2558],[1.8533,49.2541],[1.8501,49.2543],[1.8501,49.2526],[1.8492,49.2518],[1.8456,49.2516],[1.8426,49.2498],[1.8417,49.2483],[1.8365,49.247],[1.8357,49.245],[1.835,49.241],[1.8374,49.2367],[1.8393,49.235],[1.8392,49.2331],[1.8381,49.2325],[1.8383,49.2293],[1.84,49.2277],[1.843,49.2263],[1.8526,49.2176],[1.8452,49.2168]]]},"60196":{"type":"Polygon","coordinates":[[[2.1224,49.3216],[2.1153,49.3178],[2.1109,49.3174],[2.1153,49.3137],[2.1124,49.3127],[2.11,49.3105],[2.1108,49.3102],[2.1081,49.3055],[2.1101,49.303],[2.1146,49.3025],[2.1211,49.2994],[2.1269,49.2992],[2.1263,49.2968],[2.1236,49.2927],[2.1234,49.2867],[2.1224,49.2851],[2.1122,49.2853],[2.1017,49.2874],[2.0968,49.2865],[2.0971,49.2767],[2.0906,49.2775],[2.0903,49.2795],[2.083,49.2818],[2.0836,49.2838],[2.0762,49.2832],[2.073,49.2854],[2.0709,49.2891],[2.0715,49.2895],[2.0712,49.2929],[2.0719,49.2963],[2.0748,49.3019],[2.0786,49.3035],[2.081,49.3077],[2.0784,49.3077],[2.0819,49.3135],[2.0806,49.3151],[2.0775,49.315],[2.0822,49.3155],[2.0858,49.3193],[2.0852,49.32],[2.087,49.3235],[2.0829,49.3247],[2.084,49.3258],[2.0889,49.3241],[2.0909,49.3258],[2.094,49.3259],[2.0942,49.3248],[2.0967,49.3251],[2.1079,49.3293],[2.1091,49.3287],[2.1098,49.3269],[2.1158,49.327],[2.1193,49.3258],[2.1203,49.3231],[2.1224,49.3216]]]},"60197":{"type":"Polygon","coordinates":[[[2.2067,49.2536],[2.2124,49.2538],[2.22,49.2554],[2.2208,49.2544],[2.2223,49.2545],[2.2256,49.2523],[2.2299,49.2514],[2.232,49.2518],[2.233,49.2538],[2.2346,49.2547],[2.2363,49.2548],[2.239,49.2522],[2.2409,49.254],[2.2429,49.2546],[2.2442,49.2537],[2.2494,49.2542],[2.256,49.2527],[2.2606,49.2535],[2.2662,49.25],[2.2651,49.2483],[2.2646,49.2446],[2.2659,49.2386],[2.2668,49.2384],[2.2679,49.236],[2.2651,49.2341],[2.2641,49.232],[2.2621,49.2316],[2.2638,49.2308],[2.2598,49.2258],[2.2546,49.227],[2.2546,49.2224],[2.2495,49.2214],[2.2497,49.2223],[2.2431,49.225],[2.2421,49.2229],[2.2405,49.2233],[2.2409,49.2245],[2.2388,49.2243],[2.239,49.2251],[2.2361,49.2258],[2.2357,49.2314],[2.2341,49.2349],[2.2214,49.2333],[2.2158,49.2388],[2.2116,49.2444],[2.2067,49.2536]]]},"60198":{"type":"Polygon","coordinates":[[[2.8588,49.5709],[2.8529,49.5733],[2.8537,49.574],[2.8523,49.5745],[2.8553,49.5768],[2.8562,49.5792],[2.8578,49.5789],[2.8573,49.5799],[2.8597,49.5814],[2.862,49.581],[2.8634,49.5821],[2.8625,49.5827],[2.8632,49.5839],[2.8626,49.5841],[2.8674,49.5873],[2.8671,49.5878],[2.8697,49.5901],[2.8679,49.5911],[2.8676,49.5933],[2.8719,49.5971],[2.8643,49.5981],[2.8668,49.5996],[2.8658,49.5999],[2.8674,49.6008],[2.8666,49.6012],[2.8694,49.6029],[2.8685,49.6033],[2.8692,49.6042],[2.8643,49.608],[2.8774,49.6106],[2.8762,49.6133],[2.8824,49.6134],[2.8828,49.6105],[2.8852,49.6101],[2.8837,49.6065],[2.8841,49.6059],[2.8865,49.6058],[2.8865,49.6047],[2.8875,49.6045],[2.8887,49.6027],[2.8897,49.6031],[2.8912,49.601],[2.8929,49.6032],[2.8935,49.6029],[2.8928,49.602],[2.8972,49.5996],[2.897,49.5984],[2.9035,49.5971],[2.9039,49.5958],[2.9045,49.5958],[2.9032,49.592],[2.893,49.5901],[2.8933,49.5893],[2.8942,49.5896],[2.8945,49.5883],[2.8909,49.5855],[2.8935,49.5823],[2.8917,49.5816],[2.892,49.5796],[2.8954,49.5772],[2.8948,49.5768],[2.8912,49.5754],[2.8885,49.5779],[2.8825,49.5778],[2.882,49.5785],[2.8783,49.5762],[2.8709,49.5736],[2.8673,49.5746],[2.8664,49.5736],[2.867,49.5732],[2.8651,49.573],[2.866,49.5726],[2.8644,49.5721],[2.8648,49.5717],[2.8588,49.5709]]]},"60199":{"type":"Polygon","coordinates":[[[2.1764,49.6129],[2.1637,49.6124],[2.1638,49.6132],[2.1595,49.6131],[2.1555,49.6173],[2.1463,49.6224],[2.1505,49.6238],[2.1495,49.627],[2.1498,49.6282],[2.1506,49.6283],[2.1495,49.6315],[2.1528,49.636],[2.1529,49.6399],[2.1539,49.6398],[2.1543,49.6408],[2.1592,49.6403],[2.1594,49.6413],[2.1605,49.6415],[2.1628,49.6439],[2.1611,49.6448],[2.1609,49.6456],[2.1617,49.646],[2.1648,49.6468],[2.1686,49.6438],[2.1709,49.6437],[2.1732,49.6439],[2.1743,49.6453],[2.176,49.6451],[2.1767,49.6398],[2.1781,49.6379],[2.1762,49.6278],[2.1776,49.6248],[2.1774,49.6235],[2.1783,49.6233],[2.1773,49.6211],[2.1788,49.6209],[2.1745,49.6153],[2.1764,49.6129]]]},"60200":{"type":"Polygon","coordinates":[[[2.5718,49.5971],[2.5725,49.5968],[2.5701,49.5939],[2.5715,49.5929],[2.5664,49.5898],[2.5667,49.5892],[2.5625,49.5883],[2.5604,49.5917],[2.5614,49.592],[2.5566,49.5953],[2.5478,49.5933],[2.5469,49.5949],[2.5443,49.5953],[2.5456,49.5967],[2.544,49.5983],[2.5453,49.5985],[2.5441,49.6015],[2.5425,49.6042],[2.5402,49.6039],[2.5441,49.6061],[2.5565,49.6073],[2.556,49.6079],[2.5577,49.6084],[2.5571,49.6072],[2.5592,49.6082],[2.5591,49.6054],[2.5626,49.6051],[2.5617,49.6041],[2.5679,49.6033],[2.5672,49.6003],[2.5692,49.6007],[2.5709,49.5989],[2.5697,49.5974],[2.571,49.5967],[2.5718,49.5971]]]},"60201":{"type":"Polygon","coordinates":[[[2.5221,49.5787],[2.5212,49.5805],[2.5225,49.5812],[2.5212,49.5823],[2.5224,49.5836],[2.5215,49.5866],[2.5245,49.588],[2.5227,49.588],[2.5286,49.5916],[2.5276,49.5922],[2.5283,49.5933],[2.5258,49.5942],[2.529,49.5945],[2.5316,49.5963],[2.5257,49.6002],[2.5311,49.6022],[2.5318,49.6015],[2.5365,49.6042],[2.5425,49.6042],[2.5453,49.5985],[2.544,49.5983],[2.5456,49.5967],[2.5443,49.5953],[2.5463,49.595],[2.5447,49.5919],[2.5452,49.5907],[2.5357,49.5848],[2.5253,49.5808],[2.5221,49.5787]]]},"60203":{"type":"Polygon","coordinates":[[[2.8225,49.2358],[2.8224,49.2372],[2.8244,49.2374],[2.8244,49.2385],[2.8261,49.2388],[2.8244,49.2418],[2.8275,49.241],[2.8291,49.2427],[2.8282,49.2429],[2.829,49.2437],[2.8302,49.2433],[2.8381,49.2452],[2.837,49.2469],[2.8422,49.2474],[2.842,49.2461],[2.8469,49.2464],[2.847,49.2453],[2.8529,49.2453],[2.8526,49.2448],[2.8579,49.2439],[2.8603,49.2474],[2.8648,49.2484],[2.8652,49.2473],[2.8634,49.2448],[2.8684,49.2441],[2.8677,49.2429],[2.8692,49.2428],[2.8655,49.2372],[2.8675,49.2369],[2.8668,49.2347],[2.8746,49.2327],[2.8742,49.2305],[2.8729,49.2301],[2.8742,49.2299],[2.8734,49.2288],[2.8726,49.2281],[2.8716,49.2284],[2.8688,49.2262],[2.8699,49.2253],[2.8547,49.218],[2.8485,49.2165],[2.8489,49.2158],[2.8467,49.2154],[2.8471,49.2143],[2.846,49.2142],[2.8463,49.2137],[2.8399,49.2112],[2.8418,49.2125],[2.8413,49.2139],[2.8397,49.2157],[2.8381,49.2156],[2.8374,49.2176],[2.8346,49.2203],[2.834,49.222],[2.8382,49.2219],[2.8373,49.224],[2.8337,49.2247],[2.8328,49.2311],[2.8314,49.2308],[2.8274,49.2353],[2.8225,49.2358]]]},"60204":{"type":"Polygon","coordinates":[[[2.8877,49.6483],[2.89,49.6496],[2.8866,49.6504],[2.8872,49.6511],[2.8938,49.6521],[2.9005,49.6561],[2.9016,49.6545],[2.901,49.654],[2.9046,49.6511],[2.9116,49.6534],[2.9156,49.6518],[2.9173,49.6519],[2.9192,49.6534],[2.9219,49.6537],[2.9299,49.6572],[2.9348,49.6574],[2.9358,49.6586],[2.9397,49.6594],[2.9534,49.6605],[2.9536,49.6584],[2.946,49.6558],[2.9423,49.655],[2.9416,49.6563],[2.9386,49.6567],[2.942,49.6497],[2.9432,49.6499],[2.9448,49.6472],[2.9423,49.6477],[2.9311,49.6471],[2.9297,49.6438],[2.9274,49.6441],[2.9281,49.6434],[2.9266,49.6403],[2.9236,49.641],[2.923,49.6394],[2.9201,49.6397],[2.9192,49.6371],[2.9179,49.6376],[2.914,49.6346],[2.915,49.634],[2.9136,49.633],[2.8877,49.6483]]]},"60205":{"type":"Polygon","coordinates":[[[1.9035,49.6846],[1.9015,49.6881],[1.8919,49.6912],[1.8881,49.6915],[1.881,49.6977],[1.8945,49.6996],[1.897,49.6983],[1.896,49.6976],[1.8968,49.697],[1.9009,49.699],[1.9019,49.6984],[1.9024,49.698],[1.8984,49.6956],[1.9004,49.6956],[1.8995,49.6949],[1.9037,49.692],[1.9076,49.6869],[1.9035,49.6846]]]},"60206":{"type":"Polygon","coordinates":[[[2.8403,49.5468],[2.8446,49.5468],[2.8479,49.5457],[2.8539,49.5467],[2.8595,49.5433],[2.8539,49.5382],[2.8608,49.5378],[2.8633,49.5394],[2.8677,49.5404],[2.8666,49.5413],[2.8723,49.5422],[2.8764,49.5445],[2.8792,49.5422],[2.8804,49.5388],[2.8678,49.5381],[2.863,49.5387],[2.8614,49.5364],[2.8526,49.5333],[2.8503,49.535],[2.846,49.5323],[2.8403,49.5271],[2.8376,49.5231],[2.8365,49.5184],[2.831,49.5149],[2.8307,49.514],[2.8249,49.5144],[2.8219,49.5128],[2.8194,49.5137],[2.8165,49.5122],[2.8139,49.5141],[2.8083,49.5157],[2.8081,49.5167],[2.7984,49.518],[2.7999,49.5202],[2.8007,49.5289],[2.8014,49.5305],[2.8076,49.5317],[2.8058,49.5343],[2.8055,49.5359],[2.8066,49.5413],[2.8132,49.541],[2.8127,49.5431],[2.815,49.5454],[2.8213,49.5453],[2.828,49.5462],[2.8329,49.5445],[2.834,49.5458],[2.8368,49.5456],[2.8403,49.5468]]]},"60207":{"type":"Polygon","coordinates":[[[3.0104,49.2762],[3.0126,49.2782],[3.0136,49.282],[3.0158,49.2803],[3.0193,49.2803],[3.0193,49.2826],[3.0201,49.2837],[3.0219,49.2842],[3.0221,49.2854],[3.0252,49.2879],[3.0267,49.2876],[3.0274,49.2896],[3.0284,49.29],[3.0291,49.2874],[3.0326,49.2868],[3.0359,49.2877],[3.0375,49.2863],[3.0359,49.2836],[3.0369,49.2811],[3.0358,49.2787],[3.0268,49.2755],[3.0275,49.2717],[3.0151,49.2764],[3.0104,49.2762]]]},"60208":{"type":"Polygon","coordinates":[[[1.8342,49.319],[1.8454,49.3132],[1.8578,49.3102],[1.8615,49.3074],[1.861,49.3069],[1.8626,49.3062],[1.8617,49.3033],[1.8595,49.3014],[1.8581,49.298],[1.8552,49.296],[1.8597,49.293],[1.8563,49.2921],[1.8524,49.2942],[1.8504,49.2928],[1.8482,49.293],[1.8334,49.2987],[1.8328,49.2979],[1.8288,49.2992],[1.8285,49.3028],[1.8292,49.3066],[1.8312,49.3098],[1.8307,49.3117],[1.832,49.3139],[1.8317,49.3158],[1.8342,49.319]]]},"60209":{"type":"Polygon","coordinates":[[[1.9518,49.2988],[1.9515,49.2957],[1.9524,49.2955],[1.9479,49.2875],[1.9487,49.2873],[1.9465,49.2855],[1.9527,49.2835],[1.9522,49.283],[1.9577,49.2812],[1.9576,49.2806],[1.9593,49.2798],[1.9652,49.2813],[1.9672,49.2808],[1.9705,49.2772],[1.9695,49.2759],[1.9695,49.2744],[1.9665,49.275],[1.9661,49.2743],[1.9574,49.2741],[1.9546,49.2705],[1.9532,49.2701],[1.9521,49.2679],[1.9495,49.2681],[1.9491,49.2712],[1.9479,49.2713],[1.9429,49.2663],[1.9359,49.2671],[1.9325,49.2656],[1.931,49.2663],[1.9283,49.2656],[1.9268,49.2671],[1.9275,49.2701],[1.917,49.2717],[1.9164,49.2737],[1.9202,49.2773],[1.9256,49.2789],[1.926,49.2801],[1.9269,49.2831],[1.9246,49.2849],[1.9273,49.2858],[1.9281,49.2869],[1.9252,49.2876],[1.9243,49.287],[1.9228,49.2877],[1.9231,49.2882],[1.9146,49.2894],[1.9124,49.2878],[1.9116,49.2884],[1.9108,49.2865],[1.9064,49.2874],[1.9031,49.2854],[1.8993,49.2803],[1.8948,49.2824],[1.8961,49.2839],[1.8947,49.2845],[1.8931,49.283],[1.8914,49.2828],[1.8875,49.2838],[1.8881,49.2876],[1.8894,49.289],[1.8929,49.2903],[1.895,49.292],[1.8977,49.2914],[1.8986,49.2923],[1.9013,49.2912],[1.9072,49.2975],[1.9113,49.3006],[1.9128,49.3],[1.917,49.3111],[1.9151,49.3118],[1.9166,49.3143],[1.9162,49.3158],[1.9177,49.3208],[1.916,49.3211],[1.9222,49.3249],[1.9246,49.3238],[1.9278,49.3261],[1.9347,49.3226],[1.9359,49.3234],[1.9402,49.3212],[1.9375,49.3185],[1.9352,49.3132],[1.9422,49.3146],[1.9557,49.3064],[1.9507,49.2992],[1.9518,49.2988]]]},"60210":{"type":"Polygon","coordinates":[[[2.5454,49.3803],[2.5461,49.3846],[2.5357,49.3895],[2.5358,49.3902],[2.5384,49.3899],[2.5383,49.391],[2.5347,49.3909],[2.5323,49.3895],[2.5303,49.3921],[2.5315,49.3923],[2.5329,49.3947],[2.5359,49.4041],[2.538,49.4033],[2.5396,49.4085],[2.542,49.4084],[2.5422,49.4091],[2.5385,49.4095],[2.5398,49.4149],[2.5469,49.4223],[2.5486,49.4224],[2.551,49.4207],[2.5504,49.4194],[2.5515,49.4177],[2.5536,49.4186],[2.556,49.4185],[2.5554,49.4159],[2.5557,49.4113],[2.5615,49.4112],[2.5615,49.4096],[2.5647,49.4095],[2.5642,49.408],[2.5627,49.4076],[2.5693,49.4077],[2.5686,49.405],[2.5711,49.405],[2.5619,49.393],[2.5602,49.3874],[2.5585,49.3843],[2.5571,49.3832],[2.5559,49.3836],[2.5551,49.3825],[2.5523,49.3827],[2.551,49.3811],[2.5468,49.3827],[2.5454,49.3803]]]},"60211":{"type":"Polygon","coordinates":[[[1.7978,49.3304],[1.7986,49.3303],[1.7977,49.3287],[1.8084,49.3237],[1.8014,49.318],[1.8035,49.3107],[1.8036,49.3077],[1.8057,49.3061],[1.8046,49.302],[1.7993,49.2984],[1.7836,49.2948],[1.7844,49.2932],[1.778,49.2921],[1.7787,49.2899],[1.7779,49.2896],[1.7746,49.2916],[1.7723,49.2911],[1.7719,49.2925],[1.7727,49.2934],[1.7715,49.2949],[1.7727,49.2954],[1.772,49.2964],[1.774,49.297],[1.7756,49.2992],[1.7747,49.3005],[1.775,49.306],[1.773,49.3074],[1.7732,49.3088],[1.7722,49.3094],[1.7731,49.3095],[1.773,49.3106],[1.7702,49.3109],[1.7714,49.3123],[1.7732,49.3122],[1.7702,49.3128],[1.7717,49.3132],[1.7721,49.3141],[1.7671,49.3161],[1.7677,49.3209],[1.7693,49.3222],[1.7687,49.3239],[1.7705,49.3242],[1.7708,49.326],[1.7716,49.326],[1.7717,49.3267],[1.7915,49.33],[1.7978,49.3304]]]},"60212":{"type":"Polygon","coordinates":[[[2.3014,49.2218],[2.2973,49.2227],[2.2965,49.2296],[2.2922,49.2343],[2.2964,49.2367],[2.2951,49.2381],[2.2993,49.2404],[2.2986,49.2413],[2.3043,49.2446],[2.2988,49.2509],[2.305,49.2537],[2.3085,49.2524],[2.3073,49.2518],[2.3134,49.2465],[2.3093,49.2441],[2.3113,49.2418],[2.3104,49.2396],[2.3192,49.235],[2.3172,49.2322],[2.3291,49.2243],[2.3249,49.2231],[2.317,49.2238],[2.3014,49.2218]]]},"60213":{"type":"Polygon","coordinates":[[[2.7266,49.135],[2.7316,49.1302],[2.7319,49.1291],[2.7344,49.1279],[2.736,49.1227],[2.7384,49.1189],[2.7436,49.1215],[2.7502,49.1165],[2.7432,49.1136],[2.7443,49.1122],[2.7404,49.1103],[2.7396,49.1111],[2.7365,49.1095],[2.7334,49.1064],[2.7362,49.1054],[2.74,49.1024],[2.7377,49.101],[2.7335,49.1043],[2.7323,49.1036],[2.7275,49.1074],[2.7263,49.1067],[2.7236,49.1087],[2.7221,49.1073],[2.7015,49.1121],[2.6996,49.1127],[2.6998,49.1132],[2.6933,49.1146],[2.687,49.1172],[2.687,49.1185],[2.6638,49.1217],[2.6646,49.1187],[2.6601,49.1178],[2.6563,49.1278],[2.6481,49.1261],[2.6473,49.1273],[2.6504,49.1304],[2.6507,49.1358],[2.65,49.1379],[2.6507,49.1391],[2.6622,49.1442],[2.6638,49.1464],[2.6732,49.1483],[2.6764,49.1484],[2.6782,49.1454],[2.6824,49.1426],[2.6891,49.1397],[2.6927,49.1424],[2.6964,49.1424],[2.6969,49.138],[2.6961,49.1358],[2.6965,49.1351],[2.7015,49.1342],[2.7024,49.1325],[2.7045,49.1312],[2.7027,49.1302],[2.7041,49.1287],[2.7171,49.1304],[2.7205,49.1298],[2.7204,49.1276],[2.7258,49.1276],[2.7254,49.1318],[2.7241,49.1329],[2.7266,49.135]]]},"60214":{"type":"Polygon","coordinates":[[[1.7736,49.6045],[1.7748,49.6057],[1.7785,49.6039],[1.7858,49.6086],[1.7874,49.6105],[1.7994,49.61],[1.8028,49.6115],[1.807,49.6076],[1.8137,49.6035],[1.8124,49.6027],[1.8148,49.6003],[1.8123,49.5902],[1.8137,49.5863],[1.8111,49.5854],[1.8078,49.5813],[1.8038,49.5738],[1.7992,49.5697],[1.7901,49.5747],[1.7898,49.5768],[1.785,49.5821],[1.7862,49.5834],[1.7856,49.5839],[1.782,49.5827],[1.7802,49.5829],[1.7803,49.5836],[1.7753,49.5823],[1.775,49.5848],[1.7843,49.5881],[1.7808,49.5927],[1.7755,49.5919],[1.7748,49.5906],[1.7733,49.5914],[1.7763,49.5937],[1.7759,49.5942],[1.78,49.5952],[1.7788,49.5959],[1.7728,49.594],[1.7733,49.5959],[1.7756,49.5975],[1.7699,49.6003],[1.7736,49.6045]]]},"60215":{"type":"Polygon","coordinates":[[[2.4667,49.4007],[2.4595,49.3964],[2.4557,49.4015],[2.4537,49.4019],[2.4521,49.407],[2.4524,49.4086],[2.4509,49.4089],[2.4465,49.4077],[2.4426,49.4098],[2.4452,49.4131],[2.4451,49.4146],[2.443,49.4156],[2.4404,49.4142],[2.4395,49.4158],[2.4377,49.4159],[2.4364,49.4148],[2.4335,49.4157],[2.4316,49.414],[2.4275,49.4149],[2.437,49.4221],[2.4437,49.426],[2.4443,49.4254],[2.4634,49.425],[2.4653,49.424],[2.469,49.4238],[2.4688,49.4232],[2.4733,49.4221],[2.4715,49.4196],[2.4723,49.4195],[2.4719,49.4154],[2.4742,49.4151],[2.4736,49.4117],[2.475,49.4116],[2.4732,49.4048],[2.4667,49.4007]]]},"60216":{"type":"Polygon","coordinates":[[[2.5092,49.4571],[2.5079,49.4575],[2.5055,49.455],[2.4983,49.4551],[2.4988,49.4534],[2.4969,49.4538],[2.4975,49.4548],[2.4961,49.4552],[2.4948,49.4532],[2.4925,49.4545],[2.4887,49.4517],[2.4875,49.4524],[2.4862,49.4515],[2.4853,49.4519],[2.4823,49.4512],[2.4836,49.4504],[2.482,49.4493],[2.4758,49.4565],[2.4751,49.456],[2.474,49.4572],[2.4723,49.4565],[2.4672,49.4633],[2.4661,49.4631],[2.4658,49.465],[2.4684,49.4654],[2.4689,49.4647],[2.4742,49.4668],[2.4802,49.4664],[2.483,49.4672],[2.4879,49.4655],[2.4886,49.4673],[2.4913,49.4669],[2.4918,49.4677],[2.4936,49.4655],[2.4949,49.4663],[2.4974,49.4647],[2.501,49.4644],[2.5011,49.4639],[2.5126,49.4626],[2.5143,49.4614],[2.511,49.4595],[2.5092,49.4571]]]},"60217":{"type":"Polygon","coordinates":[[[1.7734,49.5456],[1.7756,49.5477],[1.7736,49.5475],[1.7737,49.5485],[1.7773,49.5497],[1.7783,49.5494],[1.7844,49.5525],[1.7853,49.5519],[1.7871,49.5526],[1.7881,49.553],[1.7879,49.5538],[1.7897,49.5545],[1.792,49.5542],[1.7917,49.5551],[1.7928,49.5562],[1.7913,49.5567],[1.7994,49.5615],[1.7982,49.5659],[1.8012,49.5689],[1.7993,49.5696],[1.8038,49.5738],[1.8082,49.5819],[1.8114,49.5857],[1.8165,49.5865],[1.8173,49.5848],[1.8207,49.5823],[1.8262,49.5793],[1.8283,49.5795],[1.8293,49.5809],[1.8311,49.5805],[1.8276,49.5756],[1.8278,49.5732],[1.8178,49.5685],[1.8184,49.5672],[1.817,49.5657],[1.8188,49.5653],[1.8211,49.5625],[1.8239,49.5608],[1.8259,49.5598],[1.8263,49.5603],[1.8296,49.5558],[1.8289,49.551],[1.8313,49.5505],[1.8314,49.5497],[1.8298,49.5492],[1.8297,49.5484],[1.8315,49.5487],[1.8292,49.5455],[1.8227,49.5436],[1.8221,49.5444],[1.8199,49.5436],[1.8171,49.5454],[1.8159,49.5476],[1.8132,49.5483],[1.8108,49.547],[1.8114,49.5436],[1.8041,49.5392],[1.8054,49.5382],[1.804,49.5355],[1.8011,49.5373],[1.7997,49.5366],[1.7983,49.5382],[1.7917,49.5352],[1.7896,49.5352],[1.7868,49.5352],[1.7778,49.5389],[1.7757,49.5379],[1.7736,49.5389],[1.7726,49.5382],[1.7703,49.5401],[1.7713,49.5407],[1.7696,49.5417],[1.7734,49.5456]]]},"60218":{"type":"Polygon","coordinates":[[[2.1725,49.2125],[2.1514,49.2118],[2.1483,49.2126],[2.15,49.214],[2.1474,49.2154],[2.1472,49.2166],[2.1501,49.218],[2.1535,49.2218],[2.1603,49.2337],[2.1631,49.2336],[2.1634,49.2383],[2.1644,49.2403],[2.1721,49.2406],[2.17,49.2438],[2.1737,49.2448],[2.1725,49.2466],[2.1747,49.2472],[2.1786,49.2434],[2.1799,49.2439],[2.1793,49.2442],[2.1807,49.2454],[2.1801,49.2457],[2.1811,49.2472],[2.1824,49.2469],[2.1825,49.249],[2.1878,49.2484],[2.1885,49.2496],[2.1995,49.2522],[2.2002,49.2473],[2.1996,49.2448],[2.1977,49.2423],[2.1999,49.242],[2.2003,49.2411],[2.1983,49.239],[2.197,49.2398],[2.1947,49.2387],[2.1865,49.2302],[2.185,49.2294],[2.1824,49.2296],[2.1766,49.2238],[2.1744,49.2172],[2.1752,49.2144],[2.1729,49.2139],[2.1725,49.2125]]]},"60219":{"type":"Polygon","coordinates":[[[1.8094,49.7542],[1.8207,49.7392],[1.8086,49.735],[1.8081,49.7363],[1.8071,49.7364],[1.8062,49.7378],[1.7952,49.736],[1.7896,49.7421],[1.7892,49.7443],[1.7882,49.744],[1.7851,49.7512],[1.7899,49.7518],[1.7899,49.7538],[1.7922,49.7538],[1.7942,49.75],[1.798,49.7511],[1.7969,49.7525],[1.7982,49.7529],[1.7999,49.7509],[1.8072,49.7534],[1.8068,49.754],[1.8094,49.7542]]]},"60220":{"type":"Polygon","coordinates":[[[1.8797,49.4407],[1.8806,49.4406],[1.8812,49.439],[1.8834,49.4374],[1.881,49.4346],[1.8799,49.4304],[1.8819,49.4287],[1.8805,49.4267],[1.8783,49.4259],[1.8748,49.4204],[1.8741,49.4205],[1.8741,49.4167],[1.8727,49.4139],[1.8745,49.4126],[1.8737,49.4121],[1.8728,49.4089],[1.8674,49.4086],[1.8605,49.41],[1.8602,49.4095],[1.8574,49.411],[1.8517,49.4125],[1.8468,49.4127],[1.848,49.4154],[1.8476,49.4201],[1.8498,49.4269],[1.8565,49.4266],[1.8632,49.4412],[1.8709,49.4416],[1.8794,49.4397],[1.8797,49.4407]]]},"60221":{"type":"Polygon","coordinates":[[[2.2437,49.6325],[2.2403,49.6351],[2.2491,49.6367],[2.2485,49.637],[2.2509,49.6393],[2.2481,49.6413],[2.2541,49.6439],[2.251,49.6443],[2.2482,49.6473],[2.2502,49.6482],[2.2475,49.6496],[2.2486,49.6507],[2.25,49.6501],[2.2568,49.6538],[2.2525,49.6565],[2.251,49.6599],[2.254,49.6603],[2.2486,49.6662],[2.248,49.6658],[2.2463,49.6675],[2.2506,49.67],[2.2531,49.6672],[2.2675,49.668],[2.2672,49.6707],[2.2735,49.671],[2.2731,49.6758],[2.2764,49.6757],[2.2763,49.6737],[2.2802,49.673],[2.2806,49.6736],[2.2858,49.6738],[2.2927,49.6713],[2.293,49.6701],[2.2916,49.6696],[2.2937,49.6684],[2.2925,49.6666],[2.291,49.6666],[2.2916,49.666],[2.2912,49.6655],[2.2894,49.6653],[2.2893,49.6629],[2.2886,49.6625],[2.2912,49.6582],[2.295,49.6591],[2.2943,49.6507],[2.2859,49.6499],[2.2852,49.6504],[2.2804,49.6469],[2.2787,49.6478],[2.2729,49.6465],[2.2738,49.6452],[2.2698,49.6422],[2.2728,49.6404],[2.2712,49.6377],[2.2703,49.6377],[2.2705,49.6369],[2.2649,49.6364],[2.2523,49.6332],[2.2437,49.6325]]]},"60222":{"type":"Polygon","coordinates":[[[2.2947,49.5076],[2.3006,49.5044],[2.3022,49.5016],[2.3074,49.4984],[2.3078,49.4977],[2.3057,49.4954],[2.3086,49.4954],[2.3077,49.4907],[2.3048,49.491],[2.3042,49.4895],[2.3092,49.4889],[2.3043,49.4864],[2.3063,49.4835],[2.3016,49.4821],[2.3022,49.479],[2.3044,49.4767],[2.2994,49.4749],[2.3024,49.4711],[2.301,49.4662],[2.3029,49.4636],[2.2984,49.463],[2.2974,49.4642],[2.28,49.4598],[2.278,49.4622],[2.2709,49.4606],[2.27,49.4612],[2.2652,49.4583],[2.2634,49.4584],[2.2612,49.4586],[2.2594,49.4612],[2.2589,49.4632],[2.2595,49.4664],[2.2581,49.4682],[2.2472,49.4659],[2.2452,49.4699],[2.2591,49.4729],[2.2564,49.475],[2.2612,49.4826],[2.2648,49.4843],[2.2639,49.4865],[2.2633,49.4866],[2.2645,49.4902],[2.267,49.4908],[2.2688,49.4939],[2.2665,49.4948],[2.2664,49.4959],[2.2753,49.4963],[2.2805,49.4992],[2.2912,49.5001],[2.2911,49.5009],[2.2939,49.5021],[2.2929,49.5044],[2.2936,49.5061],[2.2931,49.5063],[2.2947,49.5076]]]},"60223":{"type":"Polygon","coordinates":[[[2.6185,49.4094],[2.613,49.4101],[2.6148,49.4134],[2.6112,49.4162],[2.6152,49.4178],[2.6084,49.4212],[2.6095,49.4242],[2.5993,49.4275],[2.6043,49.4319],[2.5997,49.4317],[2.6034,49.437],[2.6122,49.4363],[2.6132,49.4378],[2.624,49.4333],[2.6254,49.432],[2.6271,49.4337],[2.6283,49.4339],[2.6298,49.4369],[2.6389,49.443],[2.6402,49.4395],[2.6433,49.4392],[2.644,49.4372],[2.6436,49.4358],[2.6445,49.4357],[2.6489,49.4307],[2.6513,49.4307],[2.6528,49.4331],[2.6579,49.4318],[2.658,49.433],[2.6594,49.4337],[2.6583,49.4267],[2.6602,49.4258],[2.6616,49.4233],[2.6522,49.4228],[2.6519,49.421],[2.6455,49.4221],[2.6429,49.4182],[2.6408,49.4199],[2.6393,49.4173],[2.6337,49.4188],[2.6308,49.4136],[2.6227,49.4153],[2.6218,49.4133],[2.6231,49.413],[2.6209,49.4091],[2.6185,49.4094]]]},"60224":{"type":"Polygon","coordinates":[[[2.9949,49.1171],[2.9943,49.1128],[2.9936,49.1128],[2.9925,49.11],[2.9903,49.1096],[2.9903,49.1086],[2.9882,49.107],[2.9866,49.1067],[2.9861,49.1074],[2.983,49.1076],[2.981,49.1087],[2.9788,49.1082],[2.9733,49.1093],[2.9722,49.1106],[2.968,49.1115],[2.9658,49.1237],[2.9658,49.132],[2.9701,49.1368],[2.9727,49.1441],[2.9777,49.1498],[2.983,49.1504],[2.9869,49.1481],[2.9868,49.1473],[2.9904,49.1462],[2.9901,49.1457],[2.9921,49.1441],[2.9951,49.1429],[2.9915,49.1372],[2.9897,49.1359],[2.9898,49.1351],[2.9864,49.1312],[2.9879,49.1261],[2.9875,49.1237],[2.988,49.1238],[2.9903,49.12],[2.9949,49.1171]]]},"60225":{"type":"Polygon","coordinates":[[[2.3995,49.4312],[2.3997,49.4245],[2.3908,49.4247],[2.385,49.4235],[2.3803,49.4203],[2.378,49.4172],[2.3788,49.4169],[2.3771,49.4154],[2.3788,49.4149],[2.3767,49.4126],[2.375,49.4132],[2.3728,49.411],[2.3649,49.4136],[2.3572,49.4149],[2.3502,49.419],[2.343,49.4189],[2.3401,49.4213],[2.3399,49.424],[2.3428,49.4283],[2.3478,49.4336],[2.3558,49.4388],[2.3648,49.4398],[2.38,49.4451],[2.3805,49.4429],[2.3829,49.4391],[2.3861,49.4398],[2.399,49.4366],[2.3995,49.4312]]]},"60226":{"type":"Polygon","coordinates":[[[2.6782,49.0861],[2.6888,49.0918],[2.7002,49.0945],[2.7038,49.096],[2.7109,49.1054],[2.7111,49.1096],[2.7165,49.109],[2.7222,49.1073],[2.7236,49.1087],[2.7263,49.1067],[2.7275,49.1074],[2.7323,49.1036],[2.7335,49.1043],[2.7377,49.101],[2.7364,49.1004],[2.7353,49.1012],[2.7281,49.0938],[2.7255,49.0883],[2.7242,49.0807],[2.7199,49.079],[2.721,49.0751],[2.7062,49.0653],[2.6958,49.0646],[2.6959,49.0655],[2.691,49.0666],[2.6896,49.0678],[2.6905,49.0699],[2.695,49.075],[2.6832,49.082],[2.6782,49.0861]]]},"60227":{"type":"Polygon","coordinates":[[[2.9239,49.5627],[2.9217,49.5622],[2.9164,49.5632],[2.9111,49.5627],[2.9075,49.5656],[2.9028,49.5661],[2.9014,49.5674],[2.9009,49.5715],[2.8988,49.5737],[2.9044,49.5753],[2.9075,49.5777],[2.909,49.5768],[2.9114,49.5784],[2.9137,49.5769],[2.9198,49.5791],[2.9226,49.5787],[2.9269,49.5746],[2.9303,49.5731],[2.9297,49.5725],[2.933,49.571],[2.9308,49.5688],[2.926,49.5679],[2.9281,49.5644],[2.9292,49.5642],[2.9291,49.5631],[2.9239,49.5627]]]},"60228":{"type":"Polygon","coordinates":[[[1.9359,49.2327],[1.9305,49.2353],[1.9325,49.2369],[1.9177,49.2419],[1.9199,49.2454],[1.9197,49.2463],[1.9206,49.2459],[1.9228,49.2483],[1.9216,49.249],[1.923,49.2504],[1.9252,49.2494],[1.9295,49.2539],[1.9305,49.2535],[1.9314,49.2545],[1.9346,49.2528],[1.938,49.2561],[1.9359,49.2583],[1.937,49.2591],[1.9391,49.2586],[1.9406,49.2606],[1.9414,49.2645],[1.9479,49.2713],[1.9491,49.2712],[1.9495,49.2681],[1.9521,49.2679],[1.9532,49.2701],[1.9546,49.2705],[1.9574,49.2741],[1.9582,49.2738],[1.9569,49.2722],[1.9598,49.2724],[1.9604,49.2685],[1.9586,49.2669],[1.9636,49.2666],[1.9639,49.2673],[1.966,49.2674],[1.966,49.2657],[1.9646,49.2653],[1.9647,49.2619],[1.9584,49.2608],[1.9576,49.2548],[1.9585,49.2546],[1.9542,49.2448],[1.9591,49.2439],[1.9572,49.2371],[1.9578,49.2369],[1.9558,49.2344],[1.9583,49.2331],[1.9552,49.23],[1.9548,49.2277],[1.9435,49.2313],[1.9419,49.2298],[1.9359,49.2327]]]},"60229":{"type":"Polygon","coordinates":[[[2.6822,49.3812],[2.6885,49.3825],[2.6931,49.3777],[2.6988,49.3806],[2.6984,49.378],[2.7077,49.3768],[2.7072,49.3749],[2.7106,49.3656],[2.6937,49.3633],[2.6859,49.3723],[2.6827,49.3787],[2.6822,49.3812]]]},"60230":{"type":"Polygon","coordinates":[[[2.2417,49.4647],[2.2581,49.4682],[2.2595,49.4664],[2.2593,49.4616],[2.2612,49.4586],[2.2655,49.4564],[2.2672,49.4531],[2.2704,49.4508],[2.2721,49.4476],[2.2773,49.4424],[2.2724,49.4406],[2.2744,49.4374],[2.2699,49.436],[2.2643,49.4387],[2.2645,49.4399],[2.2611,49.4396],[2.2609,49.438],[2.2561,49.4384],[2.2553,49.4362],[2.25,49.4369],[2.2497,49.4351],[2.2491,49.4351],[2.2479,49.4376],[2.2431,49.4378],[2.2434,49.4389],[2.2443,49.4389],[2.2447,49.4408],[2.2433,49.4411],[2.2424,49.4403],[2.2366,49.441],[2.234,49.4367],[2.2303,49.4381],[2.227,49.4437],[2.2246,49.4463],[2.226,49.4466],[2.2257,49.4476],[2.2374,49.4485],[2.2389,49.4533],[2.2414,49.4526],[2.2407,49.454],[2.243,49.4539],[2.2417,49.4567],[2.2397,49.4562],[2.2387,49.4582],[2.2432,49.4592],[2.2417,49.4647]]]},"60231":{"type":"Polygon","coordinates":[[[2.9254,49.2373],[2.9246,49.2375],[2.9255,49.24],[2.9233,49.2385],[2.9073,49.2508],[2.9075,49.2545],[2.8899,49.2586],[2.8794,49.2601],[2.8794,49.2626],[2.8807,49.2625],[2.8819,49.2693],[2.888,49.2683],[2.8875,49.2742],[2.8892,49.2742],[2.8892,49.2757],[2.8902,49.2772],[2.8935,49.2798],[2.8933,49.2825],[2.8915,49.2844],[2.8921,49.2859],[2.8969,49.286],[2.8973,49.285],[2.8935,49.2842],[2.8942,49.2838],[2.8942,49.2812],[2.895,49.2809],[2.8957,49.282],[2.9042,49.28],[2.9094,49.2709],[2.9133,49.2716],[2.9148,49.268],[2.9357,49.2683],[2.9349,49.2672],[2.936,49.267],[2.9361,49.2677],[2.939,49.2676],[2.9421,49.269],[2.9424,49.2705],[2.9456,49.2686],[2.9469,49.2669],[2.9477,49.2671],[2.948,49.2665],[2.9466,49.2659],[2.9468,49.2648],[2.9432,49.2644],[2.9419,49.2596],[2.9466,49.2595],[2.945,49.2575],[2.9452,49.2565],[2.9442,49.2565],[2.9377,49.2474],[2.9365,49.2475],[2.9339,49.2395],[2.9288,49.2399],[2.9254,49.2373]]]},"60232":{"type":"Polygon","coordinates":[[[2.4972,49.5876],[2.4953,49.5889],[2.4978,49.59],[2.4987,49.5972],[2.5014,49.5964],[2.5033,49.6005],[2.5086,49.6017],[2.509,49.6005],[2.5151,49.6027],[2.5177,49.5986],[2.5193,49.6002],[2.5257,49.6002],[2.5316,49.5963],[2.529,49.5945],[2.5258,49.5942],[2.5283,49.5933],[2.5276,49.5922],[2.5286,49.5916],[2.5227,49.588],[2.5245,49.588],[2.5215,49.5866],[2.5224,49.5836],[2.5212,49.5823],[2.5225,49.5812],[2.5212,49.5805],[2.5234,49.5765],[2.5174,49.5739],[2.517,49.5749],[2.5158,49.574],[2.5138,49.5756],[2.5131,49.5781],[2.5097,49.5764],[2.508,49.5776],[2.5094,49.5785],[2.5052,49.5802],[2.5014,49.5801],[2.4995,49.5853],[2.4972,49.5876]]]},"60233":{"type":"Polygon","coordinates":[[[1.8322,49.6343],[1.8358,49.6386],[1.8273,49.6423],[1.8259,49.6444],[1.8185,49.6425],[1.8183,49.644],[1.8174,49.6439],[1.8176,49.6457],[1.8127,49.6469],[1.8144,49.6502],[1.8196,49.6494],[1.8215,49.6503],[1.8209,49.6522],[1.8283,49.6519],[1.8303,49.6546],[1.8293,49.6552],[1.8313,49.6564],[1.8322,49.656],[1.8333,49.657],[1.8357,49.656],[1.8363,49.6573],[1.8376,49.6572],[1.8391,49.6632],[1.8399,49.6638],[1.8432,49.6652],[1.8524,49.6661],[1.8563,49.6675],[1.8554,49.6682],[1.8587,49.6692],[1.861,49.6722],[1.8615,49.6746],[1.8683,49.668],[1.8721,49.6692],[1.8784,49.6593],[1.8765,49.6584],[1.878,49.6575],[1.8749,49.6548],[1.8742,49.6447],[1.869,49.6456],[1.8693,49.6391],[1.8666,49.6379],[1.8642,49.6391],[1.8618,49.6385],[1.86,49.6374],[1.8588,49.6343],[1.8602,49.6323],[1.8452,49.6276],[1.8376,49.6304],[1.8345,49.6335],[1.835,49.6343],[1.8322,49.6343]]]},"60234":{"type":"Polygon","coordinates":[[[2.4326,49.3823],[2.4295,49.3841],[2.4293,49.3873],[2.426,49.3867],[2.4205,49.388],[2.4188,49.3895],[2.4121,49.3905],[2.4045,49.3901],[2.4008,49.3926],[2.3991,49.3962],[2.4004,49.3979],[2.4,49.3985],[2.4023,49.3997],[2.4024,49.4021],[2.4037,49.4019],[2.4049,49.4035],[2.4108,49.4075],[2.4107,49.4104],[2.4114,49.4103],[2.4125,49.4127],[2.4208,49.4114],[2.4225,49.4123],[2.4247,49.412],[2.4275,49.4149],[2.4316,49.414],[2.4335,49.4157],[2.4364,49.4148],[2.4377,49.4159],[2.4395,49.4158],[2.4404,49.4142],[2.443,49.4156],[2.4454,49.4138],[2.4428,49.4096],[2.4465,49.4077],[2.4509,49.4089],[2.4524,49.4086],[2.4521,49.407],[2.4537,49.4019],[2.4557,49.4015],[2.4595,49.3964],[2.4408,49.387],[2.4372,49.3825],[2.4326,49.3823]]]},"60235":{"type":"Polygon","coordinates":[[[1.8399,49.3162],[1.8342,49.319],[1.835,49.3195],[1.8331,49.3208],[1.8319,49.3197],[1.8267,49.3197],[1.8226,49.3209],[1.8238,49.3227],[1.8207,49.3239],[1.8193,49.3236],[1.8182,49.3218],[1.8106,49.3246],[1.8084,49.3237],[1.7977,49.3287],[1.7992,49.333],[1.7945,49.3383],[1.7994,49.3451],[1.8015,49.3466],[1.8021,49.3463],[1.8049,49.3523],[1.806,49.3569],[1.8128,49.3564],[1.8175,49.358],[1.8176,49.3591],[1.819,49.3601],[1.819,49.3625],[1.8209,49.3637],[1.8232,49.3687],[1.8289,49.3702],[1.8305,49.3745],[1.8364,49.377],[1.838,49.3791],[1.8474,49.374],[1.8531,49.373],[1.859,49.3703],[1.8641,49.3663],[1.8543,49.3624],[1.8556,49.359],[1.8496,49.3518],[1.8472,49.3476],[1.8466,49.3451],[1.8425,49.3407],[1.8454,49.3374],[1.8499,49.3385],[1.8525,49.3383],[1.8518,49.335],[1.8477,49.3302],[1.8467,49.3306],[1.8454,49.3289],[1.8479,49.3262],[1.8434,49.3231],[1.8399,49.3162]]]},"60236":{"type":"Polygon","coordinates":[[[3.0332,49.6831],[3.0339,49.6869],[3.0379,49.6916],[3.0391,49.6915],[3.0403,49.6927],[3.0405,49.697],[3.0426,49.696],[3.0435,49.6964],[3.0456,49.6945],[3.0486,49.6955],[3.0501,49.6935],[3.0567,49.6935],[3.0564,49.6923],[3.0599,49.692],[3.0585,49.6889],[3.0585,49.685],[3.0564,49.6756],[3.0528,49.676],[3.0424,49.6738],[3.0409,49.6786],[3.036,49.6826],[3.0341,49.6835],[3.0332,49.6831]]]},"60237":{"type":"Polygon","coordinates":[[[2.2475,49.6496],[2.244,49.6514],[2.2395,49.6502],[2.2383,49.6518],[2.2348,49.6537],[2.2256,49.6506],[2.2201,49.6498],[2.2189,49.6518],[2.217,49.6527],[2.2157,49.6561],[2.2126,49.6573],[2.2115,49.6607],[2.2075,49.6628],[2.2074,49.6665],[2.2126,49.6663],[2.2157,49.6675],[2.2165,49.6681],[2.2161,49.669],[2.2183,49.6696],[2.2206,49.6674],[2.2217,49.6681],[2.2307,49.6685],[2.2312,49.6667],[2.2362,49.6667],[2.2358,49.6653],[2.241,49.6616],[2.245,49.6619],[2.2502,49.6644],[2.254,49.6603],[2.251,49.6599],[2.2525,49.6565],[2.2568,49.6538],[2.25,49.6501],[2.2486,49.6507],[2.2475,49.6496]]]},"60238":{"type":"Polygon","coordinates":[[[2.6072,49.2775],[2.6171,49.2704],[2.6167,49.2694],[2.62,49.2589],[2.6196,49.2566],[2.612,49.2458],[2.5828,49.2459],[2.5608,49.2615],[2.574,49.2772],[2.58,49.2797],[2.593,49.2772],[2.6072,49.2775]]]},"60239":{"type":"Polygon","coordinates":[[[1.9548,49.2277],[1.9552,49.23],[1.9583,49.2331],[1.9558,49.2344],[1.9578,49.2369],[1.9572,49.2371],[1.9591,49.2439],[1.9542,49.2448],[1.9585,49.2546],[1.9576,49.2548],[1.9584,49.2608],[1.9647,49.2619],[1.9646,49.2653],[1.966,49.2657],[1.966,49.2674],[1.9639,49.2673],[1.9636,49.2666],[1.9586,49.2669],[1.9604,49.2685],[1.9598,49.2724],[1.957,49.2726],[1.9582,49.2738],[1.9661,49.2743],[1.9665,49.275],[1.9695,49.2744],[1.9691,49.2732],[1.9701,49.2696],[1.9713,49.2694],[1.9701,49.2674],[1.9712,49.2612],[1.9698,49.2573],[1.9721,49.2565],[1.9717,49.2534],[1.9728,49.2527],[1.9706,49.2507],[1.9738,49.2492],[1.9735,49.2482],[1.9777,49.2466],[1.9774,49.2462],[1.9817,49.2451],[1.9819,49.2462],[1.984,49.2458],[1.9833,49.2437],[1.985,49.2433],[1.9842,49.2419],[1.9857,49.2415],[1.9836,49.237],[1.9801,49.2373],[1.9799,49.236],[1.9764,49.2365],[1.9766,49.2358],[1.9743,49.2357],[1.9751,49.2329],[1.9724,49.2268],[1.9649,49.2259],[1.9636,49.2245],[1.9587,49.2264],[1.9542,49.2257],[1.9548,49.2277]]]},"60240":{"type":"Polygon","coordinates":[[[2.111,49.6655],[2.1085,49.6685],[2.1056,49.6701],[2.1052,49.6714],[2.106,49.672],[2.1169,49.6713],[2.1188,49.6721],[2.1215,49.6748],[2.1231,49.6747],[2.1226,49.6754],[2.1272,49.6784],[2.1258,49.6786],[2.1261,49.6797],[2.1227,49.6807],[2.1227,49.6829],[2.1284,49.6834],[2.1389,49.6814],[2.1416,49.6856],[2.1438,49.6859],[2.1585,49.6834],[2.1595,49.6849],[2.1679,49.6842],[2.1728,49.6819],[2.1725,49.6805],[2.1747,49.6802],[2.1736,49.6755],[2.1724,49.6738],[2.1732,49.6734],[2.1725,49.6732],[2.1728,49.6724],[2.1707,49.6693],[2.1764,49.6685],[2.1777,49.6669],[2.1773,49.665],[2.1759,49.6634],[2.1748,49.6639],[2.1741,49.6622],[2.1736,49.6607],[2.1765,49.6565],[2.1756,49.6546],[2.1737,49.6532],[2.1765,49.6518],[2.1758,49.6495],[2.1788,49.6494],[2.176,49.6473],[2.176,49.6451],[2.1743,49.6453],[2.1732,49.6439],[2.1686,49.6438],[2.1648,49.6468],[2.1609,49.6456],[2.1628,49.6439],[2.1605,49.6415],[2.1594,49.6413],[2.1592,49.6403],[2.1543,49.6408],[2.1539,49.6398],[2.1529,49.6399],[2.1532,49.6371],[2.1525,49.6353],[2.1515,49.6351],[2.15,49.6375],[2.1478,49.6383],[2.1474,49.6402],[2.146,49.6398],[2.1436,49.6405],[2.1424,49.6437],[2.1339,49.644],[2.1337,49.6472],[2.1323,49.6479],[2.1359,49.6505],[2.1351,49.6511],[2.1381,49.6535],[2.136,49.6561],[2.1379,49.6576],[2.1405,49.6579],[2.1359,49.6584],[2.1302,49.6603],[2.129,49.6609],[2.1292,49.6616],[2.1111,49.6638],[2.111,49.6655]]]},"60241":{"type":"Polygon","coordinates":[[[2.6004,49.164],[2.6145,49.1668],[2.6161,49.1715],[2.6377,49.1706],[2.64,49.168],[2.6435,49.1672],[2.645,49.1642],[2.651,49.1639],[2.6623,49.16],[2.6605,49.1632],[2.6615,49.1643],[2.6632,49.1653],[2.6653,49.1645],[2.6676,49.1682],[2.6693,49.1677],[2.6736,49.1704],[2.6732,49.172],[2.6747,49.1762],[2.6765,49.1783],[2.6755,49.1791],[2.6759,49.1798],[2.6852,49.186],[2.6836,49.1867],[2.695,49.1973],[2.6999,49.1956],[2.7015,49.1943],[2.7063,49.1979],[2.7096,49.1962],[2.7142,49.199],[2.7141,49.2],[2.7166,49.197],[2.7146,49.1965],[2.7186,49.1929],[2.7201,49.1902],[2.7127,49.1865],[2.7119,49.1874],[2.7072,49.1849],[2.7099,49.1825],[2.7038,49.1795],[2.7052,49.1761],[2.6999,49.174],[2.6976,49.1742],[2.6999,49.1681],[2.7021,49.1682],[2.703,49.1669],[2.6982,49.1665],[2.6978,49.1675],[2.694,49.166],[2.687,49.1669],[2.6883,49.1634],[2.6859,49.1599],[2.6865,49.1589],[2.6859,49.1578],[2.6868,49.1577],[2.6871,49.1564],[2.6894,49.156],[2.6943,49.1515],[2.7025,49.1481],[2.7079,49.1447],[2.7194,49.1397],[2.7281,49.1369],[2.7241,49.1329],[2.7254,49.1318],[2.7258,49.1276],[2.7204,49.1276],[2.7205,49.1298],[2.7171,49.1304],[2.7041,49.1287],[2.7027,49.1302],[2.7045,49.1312],[2.7024,49.1325],[2.7015,49.1342],[2.6965,49.1351],[2.6961,49.1358],[2.6969,49.138],[2.6964,49.1424],[2.6927,49.1424],[2.6891,49.1397],[2.6824,49.1426],[2.6782,49.1454],[2.6764,49.1484],[2.6717,49.1482],[2.6638,49.1464],[2.6622,49.1442],[2.6543,49.1411],[2.6507,49.1391],[2.65,49.1379],[2.6507,49.1358],[2.6504,49.1304],[2.6473,49.1273],[2.6481,49.1261],[2.6563,49.1278],[2.6601,49.1178],[2.6575,49.1182],[2.6483,49.1167],[2.6409,49.1199],[2.6367,49.1167],[2.6344,49.1216],[2.6266,49.1225],[2.6265,49.1243],[2.6236,49.1242],[2.6223,49.1259],[2.6226,49.1294],[2.6242,49.1314],[2.624,49.1325],[2.6117,49.1412],[2.6149,49.1442],[2.6157,49.1463],[2.6121,49.1483],[2.6078,49.1479],[2.5974,49.1524],[2.5936,49.1549],[2.5923,49.1608],[2.6004,49.164]]]},"60242":{"type":"Polygon","coordinates":[[[1.9276,49.5997],[1.9254,49.6017],[1.9272,49.6029],[1.9249,49.6052],[1.9387,49.6072],[1.9384,49.6076],[1.9422,49.6089],[1.947,49.6091],[1.9469,49.6098],[1.9557,49.6092],[1.9527,49.6068],[1.9571,49.6043],[1.9574,49.6049],[1.9611,49.6044],[1.9618,49.605],[1.9642,49.6026],[1.9686,49.6024],[1.9688,49.6061],[1.9724,49.6052],[1.9713,49.6067],[1.9767,49.6103],[1.985,49.6036],[1.9803,49.6009],[1.9818,49.6002],[1.9802,49.5972],[1.9698,49.5937],[1.9683,49.5918],[1.9635,49.5886],[1.9607,49.5932],[1.9598,49.5925],[1.9611,49.5883],[1.9601,49.5867],[1.9563,49.5871],[1.9543,49.5842],[1.9561,49.5827],[1.9556,49.5823],[1.9534,49.5833],[1.9534,49.5849],[1.9494,49.585],[1.9484,49.5883],[1.9448,49.5864],[1.9397,49.5909],[1.9404,49.5916],[1.9391,49.5914],[1.9293,49.6008],[1.9276,49.5997]]]},"60243":{"type":"Polygon","coordinates":[[[2.1559,49.4854],[2.1512,49.4874],[2.1496,49.4867],[2.1463,49.4885],[2.1428,49.4889],[2.143,49.4896],[2.1398,49.4911],[2.1381,49.493],[2.1363,49.4927],[2.1365,49.4946],[2.1315,49.4971],[2.1328,49.4989],[2.13,49.5011],[2.1301,49.5035],[2.131,49.5027],[2.133,49.5055],[2.1312,49.5064],[2.1318,49.5075],[2.1313,49.5093],[2.134,49.512],[2.1315,49.5129],[2.1287,49.5163],[2.1322,49.5236],[2.139,49.5223],[2.1387,49.5213],[2.1404,49.5209],[2.1469,49.5206],[2.1468,49.5215],[2.1478,49.5195],[2.1474,49.5139],[2.1484,49.5137],[2.1491,49.5151],[2.1507,49.5158],[2.1516,49.5153],[2.1509,49.5131],[2.1599,49.5116],[2.1627,49.5097],[2.1647,49.511],[2.1662,49.5094],[2.165,49.5073],[2.1678,49.5067],[2.1685,49.5075],[2.1717,49.5055],[2.1703,49.5036],[2.1712,49.5029],[2.165,49.4989],[2.1624,49.5],[2.1594,49.4985],[2.1574,49.4962],[2.1596,49.4953],[2.1585,49.494],[2.1596,49.4936],[2.1585,49.4924],[2.1627,49.4905],[2.1559,49.4854]]]},"60244":{"type":"Polygon","coordinates":[[[1.7544,49.5515],[1.7531,49.5526],[1.7519,49.5522],[1.7463,49.5568],[1.7458,49.5574],[1.7466,49.558],[1.7452,49.5588],[1.7463,49.5596],[1.7429,49.5612],[1.7504,49.5676],[1.7507,49.57],[1.7533,49.5711],[1.7528,49.5714],[1.754,49.5723],[1.7525,49.5735],[1.7607,49.5783],[1.7643,49.5772],[1.7659,49.5783],[1.7671,49.5778],[1.77,49.5801],[1.7726,49.5799],[1.7753,49.5823],[1.7777,49.5832],[1.7803,49.5836],[1.7802,49.5829],[1.782,49.5827],[1.7856,49.5839],[1.7862,49.5834],[1.785,49.5821],[1.7898,49.5768],[1.7901,49.5747],[1.7869,49.5748],[1.7818,49.5716],[1.7846,49.5691],[1.7832,49.5683],[1.7838,49.568],[1.7803,49.5655],[1.7807,49.5652],[1.7775,49.5641],[1.7781,49.5633],[1.7653,49.5587],[1.7596,49.5543],[1.7544,49.5515]]]},"60245":{"type":"Polygon","coordinates":[[[1.7335,49.6261],[1.7271,49.63],[1.7111,49.6353],[1.6986,49.644],[1.7085,49.6464],[1.7117,49.6502],[1.7128,49.6548],[1.7196,49.6566],[1.7214,49.6586],[1.7225,49.6616],[1.724,49.6611],[1.725,49.6625],[1.7314,49.6665],[1.7433,49.6694],[1.755,49.6646],[1.7515,49.6594],[1.7444,49.6553],[1.7455,49.6544],[1.7409,49.6524],[1.7414,49.6456],[1.7476,49.6427],[1.7593,49.6482],[1.764,49.6487],[1.764,49.648],[1.7663,49.6479],[1.7668,49.647],[1.7756,49.648],[1.7756,49.6403],[1.7715,49.6399],[1.7702,49.6337],[1.7581,49.6339],[1.7587,49.6309],[1.7523,49.6325],[1.7408,49.6315],[1.7352,49.6289],[1.7357,49.6284],[1.7335,49.6261]]]},"60247":{"type":"Polygon","coordinates":[[[2.5221,49.4323],[2.5274,49.4326],[2.5271,49.434],[2.5254,49.4341],[2.5276,49.4357],[2.5354,49.432],[2.5372,49.4329],[2.5374,49.4337],[2.541,49.4322],[2.5436,49.4341],[2.5467,49.4333],[2.5481,49.434],[2.5497,49.4335],[2.5496,49.4323],[2.5509,49.4319],[2.5516,49.4284],[2.5598,49.4272],[2.5605,49.4282],[2.5625,49.4275],[2.5583,49.4241],[2.5536,49.4232],[2.551,49.4207],[2.5486,49.4224],[2.5469,49.4223],[2.541,49.4164],[2.5394,49.4169],[2.5396,49.4175],[2.5344,49.4185],[2.5348,49.4205],[2.5338,49.422],[2.5292,49.4254],[2.5273,49.4252],[2.5264,49.4285],[2.5227,49.4284],[2.5221,49.4323]]]},"60248":{"type":"Polygon","coordinates":[[[1.8204,49.7227],[1.8119,49.7227],[1.8049,49.7217],[1.8008,49.7244],[1.7971,49.7295],[1.7963,49.7362],[1.8062,49.7378],[1.8071,49.7364],[1.8081,49.7363],[1.8086,49.735],[1.8208,49.7392],[1.8351,49.7405],[1.8396,49.7393],[1.8414,49.7337],[1.8397,49.7311],[1.8204,49.7227]]]},"60249":{"type":"Polygon","coordinates":[[[2.3301,49.2826],[2.3284,49.2823],[2.3289,49.2815],[2.3284,49.2814],[2.3309,49.2804],[2.3308,49.2798],[2.3274,49.2781],[2.3284,49.2755],[2.3278,49.2722],[2.325,49.2728],[2.3234,49.2699],[2.3221,49.2702],[2.3209,49.2674],[2.319,49.2681],[2.3076,49.259],[2.3007,49.2646],[2.3017,49.2656],[2.3005,49.2661],[2.3012,49.2666],[2.2984,49.2677],[2.2994,49.2683],[2.2986,49.2689],[2.3009,49.2704],[2.3002,49.2706],[2.3013,49.273],[2.301,49.2745],[2.2996,49.2744],[2.2988,49.2782],[2.3013,49.2792],[2.3015,49.2799],[2.306,49.2802],[2.3032,49.2838],[2.3082,49.2851],[2.307,49.2901],[2.315,49.2921],[2.3162,49.2899],[2.3178,49.2901],[2.3171,49.2907],[2.3176,49.2913],[2.3189,49.2911],[2.3225,49.2885],[2.3231,49.2866],[2.327,49.2875],[2.3328,49.286],[2.3301,49.2826]]]},"60250":{"type":"Polygon","coordinates":[[[2.0241,49.4783],[2.027,49.4775],[2.0266,49.4783],[2.0276,49.4782],[2.03,49.4763],[2.0299,49.4757],[2.0319,49.4749],[2.0375,49.4749],[2.0397,49.4735],[2.0397,49.4716],[2.0414,49.4704],[2.0413,49.4692],[2.048,49.4673],[2.0478,49.4658],[2.0497,49.4653],[2.0499,49.4637],[2.0599,49.4629],[2.0603,49.4624],[2.0594,49.461],[2.0605,49.4604],[2.0608,49.4586],[2.0598,49.4582],[2.0575,49.4594],[2.0589,49.4577],[2.0581,49.4571],[2.0476,49.456],[2.0478,49.4544],[2.044,49.4524],[2.0444,49.4519],[2.0375,49.4527],[2.0182,49.4595],[2.02,49.4614],[2.0162,49.4618],[2.01,49.4638],[2.0057,49.4639],[2.0062,49.4658],[2.005,49.4663],[2.0062,49.4736],[2.0094,49.4726],[2.0099,49.4741],[2.0187,49.4757],[2.0241,49.4783]]]},"60251":{"type":"Polygon","coordinates":[[[2.187,49.4578],[2.1884,49.4589],[2.19,49.458],[2.1923,49.4596],[2.1979,49.4596],[2.198,49.4609],[2.2025,49.4606],[2.2028,49.4615],[2.2046,49.462],[2.201,49.4735],[2.2058,49.4751],[2.2107,49.4741],[2.2124,49.4741],[2.2124,49.4751],[2.2204,49.4752],[2.2339,49.4741],[2.2362,49.4735],[2.2355,49.4727],[2.2408,49.4717],[2.2404,49.4681],[2.2432,49.4592],[2.2387,49.4582],[2.2397,49.4562],[2.2417,49.4567],[2.243,49.4539],[2.2407,49.454],[2.2414,49.4526],[2.2389,49.4533],[2.2374,49.4485],[2.2096,49.4469],[2.2017,49.4473],[2.178,49.4415],[2.1782,49.4438],[2.184,49.4488],[2.1842,49.4503],[2.1875,49.4544],[2.187,49.4578]]]},"60252":{"type":"Polygon","coordinates":[[[2.3915,49.4823],[2.3977,49.4814],[2.3966,49.4789],[2.3993,49.4774],[2.3986,49.4767],[2.4011,49.475],[2.4009,49.474],[2.4043,49.4716],[2.4008,49.4701],[2.4046,49.4676],[2.4049,49.4636],[2.4056,49.4637],[2.4058,49.4618],[2.4068,49.4617],[2.4051,49.4558],[2.3999,49.4581],[2.3965,49.4544],[2.3971,49.4519],[2.3919,49.4485],[2.3954,49.4438],[2.3878,49.4435],[2.3839,49.4464],[2.3761,49.4442],[2.3707,49.4475],[2.3691,49.4498],[2.3708,49.4533],[2.3646,49.4545],[2.364,49.4555],[2.3623,49.4553],[2.3614,49.4575],[2.3577,49.4577],[2.3525,49.4617],[2.3589,49.468],[2.3593,49.4693],[2.3583,49.4692],[2.3571,49.4716],[2.3581,49.4737],[2.3624,49.4733],[2.3656,49.4778],[2.3915,49.4823]]]},"60253":{"type":"Polygon","coordinates":[[[2.1172,49.5985],[2.1173,49.6024],[2.1365,49.5999],[2.1357,49.6066],[2.1487,49.606],[2.1495,49.6089],[2.1489,49.6118],[2.1463,49.612],[2.1428,49.6153],[2.1432,49.6174],[2.1472,49.6218],[2.1555,49.6173],[2.1595,49.6131],[2.1638,49.6132],[2.1617,49.6064],[2.1521,49.5951],[2.1538,49.5932],[2.1517,49.5919],[2.1525,49.5902],[2.1617,49.5892],[2.1683,49.5904],[2.1687,49.5888],[2.172,49.5891],[2.172,49.5909],[2.1758,49.591],[2.1764,49.5891],[2.1769,49.5893],[2.1773,49.5856],[2.1751,49.5858],[2.1746,49.5823],[2.1761,49.582],[2.1755,49.5808],[2.1744,49.5808],[2.1749,49.5792],[2.1738,49.5787],[2.1761,49.5784],[2.1762,49.5772],[2.1773,49.5772],[2.1768,49.5743],[2.173,49.575],[2.1687,49.5746],[2.1686,49.5737],[2.1651,49.5733],[2.1656,49.5721],[2.1635,49.5717],[2.1637,49.5703],[2.1623,49.5701],[2.1625,49.5691],[2.1535,49.5689],[2.1526,49.5679],[2.1563,49.5669],[2.151,49.5602],[2.145,49.564],[2.1456,49.5746],[2.1415,49.5752],[2.1413,49.5777],[2.1381,49.5782],[2.139,49.5793],[2.1371,49.5801],[2.1379,49.5809],[2.1328,49.5826],[2.1341,49.5834],[2.1167,49.5893],[2.1146,49.5879],[2.1125,49.5891],[2.1163,49.5924],[2.1168,49.5936],[2.1154,49.594],[2.1166,49.5943],[2.1162,49.5956],[2.1178,49.5983],[2.1172,49.5985]]]},"60254":{"type":"Polygon","coordinates":[[[2.6391,49.4427],[2.6403,49.4426],[2.6383,49.4439],[2.6362,49.4468],[2.6381,49.4486],[2.6429,49.4481],[2.6429,49.4504],[2.6409,49.452],[2.6427,49.4521],[2.6442,49.4511],[2.6482,49.4573],[2.662,49.4534],[2.6644,49.4568],[2.6669,49.456],[2.6691,49.4562],[2.667,49.4535],[2.6707,49.4527],[2.6746,49.4537],[2.6737,49.4545],[2.6786,49.4603],[2.6795,49.4598],[2.6794,49.4591],[2.6844,49.4573],[2.6884,49.4598],[2.691,49.4583],[2.6964,49.4613],[2.702,49.4565],[2.6994,49.4513],[2.6982,49.451],[2.6976,49.4494],[2.6913,49.4468],[2.6934,49.4451],[2.6883,49.4431],[2.6823,49.4417],[2.6811,49.4396],[2.6734,49.4412],[2.673,49.4383],[2.6687,49.4382],[2.658,49.433],[2.6579,49.4318],[2.6528,49.4331],[2.6513,49.4307],[2.6489,49.4307],[2.6445,49.4357],[2.6436,49.4358],[2.644,49.4372],[2.6433,49.4392],[2.6402,49.4395],[2.6391,49.4427]]]},"60255":{"type":"Polygon","coordinates":[[[2.9858,49.6693],[2.9841,49.6729],[2.9841,49.6743],[2.9852,49.6788],[2.9867,49.6795],[2.9884,49.6833],[2.9874,49.6835],[2.9878,49.6843],[2.9911,49.6836],[2.9973,49.6787],[3.0023,49.6786],[3.0066,49.6833],[3.0101,49.6854],[3.0071,49.6904],[3.008,49.693],[3.0156,49.693],[3.0157,49.6907],[3.018,49.6907],[3.0164,49.6853],[3.0215,49.6842],[3.023,49.6821],[3.0283,49.6799],[3.0158,49.6753],[3.0115,49.6745],[3.0166,49.673],[3.0174,49.6703],[3.0196,49.6681],[3.0164,49.6657],[3.0095,49.6637],[3.0104,49.6608],[2.9897,49.6623],[2.9867,49.6644],[2.9857,49.6641],[2.9858,49.6693]]]},"60256":{"type":"Polygon","coordinates":[[[1.9518,49.2988],[1.9554,49.2979],[1.9567,49.2993],[1.967,49.3048],[1.9725,49.3007],[1.9694,49.2974],[1.9727,49.296],[1.9752,49.2963],[1.9756,49.2935],[1.9769,49.2922],[1.9809,49.2913],[1.9785,49.288],[1.9803,49.2867],[1.98,49.2858],[1.9862,49.2855],[1.985,49.2879],[1.9864,49.2878],[1.987,49.2901],[1.9867,49.2947],[1.9878,49.2935],[1.9879,49.2917],[1.99,49.2912],[1.9907,49.2871],[1.9926,49.2871],[1.993,49.291],[1.9918,49.2947],[1.997,49.2953],[1.9977,49.2963],[2.0021,49.298],[2.0044,49.3021],[2.0031,49.3029],[2.0021,49.3052],[2.0035,49.3078],[2.0086,49.3109],[2.0117,49.3146],[2.0131,49.3152],[2.0164,49.3134],[2.0144,49.3101],[2.0197,49.3071],[2.0196,49.3016],[2.0239,49.2992],[2.0277,49.2983],[2.0308,49.3008],[2.0333,49.2991],[2.0371,49.2925],[2.0333,49.2907],[2.0361,49.2874],[2.0328,49.2828],[2.0313,49.282],[2.0318,49.279],[2.0299,49.2765],[2.0312,49.2758],[2.028,49.2742],[2.0288,49.2738],[2.0277,49.2728],[2.0266,49.2735],[2.0243,49.2726],[2.0214,49.2727],[2.0182,49.2685],[2.0162,49.2683],[2.0155,49.2714],[2.0124,49.2724],[2.007,49.2697],[2.0076,49.268],[2.0097,49.2669],[2.0082,49.2661],[1.9995,49.2675],[1.9987,49.2678],[1.9993,49.2687],[1.9984,49.2691],[2.0034,49.2738],[1.9957,49.2766],[1.9904,49.2773],[1.9878,49.2724],[1.9842,49.2726],[1.9822,49.2743],[1.9817,49.2725],[1.981,49.2727],[1.98,49.2717],[1.9843,49.2696],[1.9817,49.2682],[1.9765,49.2709],[1.9755,49.2694],[1.9736,49.2695],[1.9727,49.2681],[1.9707,49.2684],[1.9713,49.2694],[1.9701,49.2696],[1.9691,49.2732],[1.9695,49.2759],[1.9705,49.2772],[1.9672,49.2808],[1.9652,49.2813],[1.9593,49.2798],[1.9576,49.2806],[1.9577,49.2812],[1.9522,49.283],[1.9527,49.2835],[1.9465,49.2855],[1.9487,49.2873],[1.9479,49.2875],[1.9524,49.2955],[1.9515,49.2957],[1.9518,49.2988]]]},"60257":{"type":"Polygon","coordinates":[[[1.9836,49.237],[1.9857,49.2415],[1.9842,49.2419],[1.985,49.2433],[1.9833,49.2437],[1.984,49.2458],[1.9819,49.2462],[1.9817,49.2451],[1.9774,49.2462],[1.9777,49.2466],[1.9735,49.2482],[1.9738,49.2492],[1.9706,49.2507],[1.9728,49.2527],[1.9717,49.2534],[1.9721,49.2565],[1.9698,49.2573],[1.9712,49.2612],[1.9701,49.2674],[1.9707,49.2684],[1.9727,49.2681],[1.9736,49.2695],[1.9755,49.2694],[1.9765,49.2709],[1.9812,49.2688],[1.9826,49.2671],[1.9891,49.2628],[1.9883,49.2623],[1.9917,49.2607],[1.9946,49.2622],[1.996,49.2616],[1.9981,49.2638],[2.0056,49.2617],[2.0029,49.2533],[2.0034,49.2512],[2.0076,49.2512],[2.0092,49.2502],[2.0084,49.2491],[2.0105,49.2493],[2.0108,49.2484],[2.0085,49.2466],[2.0066,49.2463],[2.009,49.2426],[2.0028,49.241],[2.0026,49.2398],[2.0046,49.2396],[2.0027,49.2366],[1.9925,49.2395],[1.9918,49.2382],[1.9939,49.2322],[1.9911,49.232],[1.9922,49.2315],[1.9922,49.2282],[1.984,49.2275],[1.9854,49.23],[1.9825,49.2307],[1.9837,49.2332],[1.9826,49.2334],[1.9836,49.237]]]},"60258":{"type":"Polygon","coordinates":[[[2.7951,49.6166],[2.7975,49.6177],[2.799,49.6205],[2.7957,49.6298],[2.8029,49.6283],[2.8049,49.6253],[2.8077,49.6366],[2.8098,49.6357],[2.81,49.6347],[2.8128,49.6326],[2.8168,49.6323],[2.816,49.6278],[2.8256,49.6219],[2.8236,49.6219],[2.8188,49.6192],[2.8198,49.6184],[2.8158,49.6164],[2.818,49.6148],[2.8153,49.6159],[2.813,49.6131],[2.8118,49.6138],[2.8095,49.6121],[2.8052,49.6133],[2.8046,49.6128],[2.7993,49.6156],[2.7967,49.6146],[2.7951,49.6166]]]},"60259":{"type":"Polygon","coordinates":[[[2.2306,49.2052],[2.2393,49.2062],[2.2421,49.2076],[2.2418,49.2087],[2.2433,49.2086],[2.2457,49.2137],[2.2491,49.2144],[2.2498,49.2122],[2.2558,49.212],[2.2564,49.2129],[2.2573,49.2128],[2.2571,49.2084],[2.2674,49.2087],[2.2702,49.2095],[2.2725,49.2071],[2.2737,49.208],[2.2748,49.2072],[2.2732,49.2066],[2.2761,49.2036],[2.2751,49.2035],[2.2753,49.2029],[2.2805,49.2048],[2.2818,49.1996],[2.2845,49.1991],[2.2858,49.2028],[2.2882,49.2022],[2.2857,49.1989],[2.2847,49.1944],[2.2827,49.193],[2.2841,49.1899],[2.2737,49.189],[2.2727,49.1904],[2.2585,49.1823],[2.2567,49.1852],[2.2523,49.1876],[2.2547,49.1937],[2.254,49.1939],[2.2527,49.1972],[2.2511,49.1967],[2.2458,49.204],[2.2372,49.2028],[2.233,49.203],[2.2305,49.2034],[2.2306,49.2052]]]},"60260":{"type":"Polygon","coordinates":[[[2.8973,49.2853],[2.9045,49.2848],[2.9047,49.2842],[2.907,49.2843],[2.9079,49.2834],[2.91,49.2853],[2.9158,49.2856],[2.9162,49.2898],[2.9157,49.2902],[2.9164,49.291],[2.921,49.2892],[2.9298,49.2912],[2.9311,49.2876],[2.9323,49.2865],[2.9402,49.2824],[2.9414,49.2824],[2.9446,49.2844],[2.9497,49.2852],[2.9486,49.2838],[2.9487,49.2813],[2.952,49.2808],[2.9491,49.2778],[2.9511,49.274],[2.9535,49.2728],[2.9532,49.2687],[2.9489,49.2665],[2.9469,49.2669],[2.9456,49.2686],[2.9424,49.2705],[2.9421,49.269],[2.939,49.2676],[2.9361,49.2677],[2.936,49.267],[2.9349,49.2672],[2.9357,49.2683],[2.9148,49.268],[2.9133,49.2716],[2.9094,49.2709],[2.9042,49.28],[2.8957,49.282],[2.895,49.2809],[2.8942,49.2812],[2.8942,49.2838],[2.8935,49.2842],[2.8973,49.2853]]]},"60261":{"type":"Polygon","coordinates":[[[2.7561,49.1971],[2.7532,49.2001],[2.7457,49.2032],[2.7463,49.2067],[2.7411,49.2088],[2.7398,49.2067],[2.7317,49.2071],[2.7302,49.2091],[2.7303,49.2128],[2.7218,49.2139],[2.7235,49.2207],[2.7313,49.2214],[2.7395,49.2209],[2.7397,49.2233],[2.7471,49.224],[2.747,49.2223],[2.7592,49.2224],[2.7588,49.2253],[2.7626,49.2257],[2.7621,49.2251],[2.7673,49.2258],[2.7673,49.2251],[2.7904,49.2267],[2.7907,49.2253],[2.7871,49.2143],[2.7911,49.2141],[2.7909,49.2132],[2.7924,49.2121],[2.7933,49.2091],[2.7914,49.2051],[2.7899,49.2048],[2.7896,49.2015],[2.7911,49.2014],[2.7908,49.1996],[2.7825,49.1992],[2.7807,49.2],[2.7771,49.1999],[2.777,49.2012],[2.7703,49.1986],[2.7689,49.1992],[2.7653,49.199],[2.7664,49.1952],[2.7621,49.1951],[2.7596,49.1995],[2.7561,49.1971]]]},"60262":{"type":"Polygon","coordinates":[[[2.5818,49.5993],[2.5817,49.6],[2.5836,49.6011],[2.5814,49.6022],[2.5819,49.6033],[2.5833,49.6029],[2.5838,49.604],[2.5868,49.604],[2.5877,49.6058],[2.5836,49.6065],[2.5825,49.6075],[2.5859,49.608],[2.5876,49.6066],[2.5916,49.6088],[2.5955,49.6087],[2.5967,49.6101],[2.5932,49.6116],[2.5932,49.6123],[2.5973,49.6116],[2.6,49.6084],[2.6024,49.6089],[2.6052,49.6079],[2.6091,49.6077],[2.6114,49.6097],[2.6134,49.6089],[2.6124,49.6097],[2.6159,49.6124],[2.6242,49.6102],[2.626,49.6109],[2.6273,49.6099],[2.6229,49.6058],[2.6259,49.6033],[2.6276,49.6038],[2.6331,49.5988],[2.6322,49.5965],[2.6283,49.5967],[2.6276,49.5947],[2.6282,49.5947],[2.6277,49.5917],[2.6258,49.5918],[2.6295,49.5885],[2.626,49.5873],[2.6279,49.5854],[2.6214,49.5817],[2.6181,49.5834],[2.616,49.5815],[2.6137,49.5828],[2.6122,49.5814],[2.6135,49.5805],[2.6105,49.5776],[2.6066,49.5799],[2.6059,49.5792],[2.6003,49.582],[2.6004,49.5835],[2.5881,49.5921],[2.5902,49.5932],[2.5818,49.5993]]]},"60263":{"type":"Polygon","coordinates":[[[2.956,49.678],[2.9606,49.6765],[2.9634,49.6724],[2.9642,49.6731],[2.9708,49.6739],[2.9718,49.6709],[2.9709,49.6681],[2.9717,49.6639],[2.9776,49.6655],[2.9777,49.6684],[2.9831,49.6684],[2.9858,49.6693],[2.9857,49.6641],[2.9867,49.6644],[2.9897,49.6623],[2.9958,49.6619],[2.9903,49.6561],[2.9905,49.6553],[2.9894,49.6557],[2.9863,49.6533],[2.9875,49.6514],[2.9872,49.6494],[2.9847,49.6469],[2.9836,49.6469],[2.9817,49.6439],[2.9782,49.6442],[2.981,49.6484],[2.975,49.6484],[2.973,49.6496],[2.9725,49.651],[2.9704,49.6526],[2.9709,49.6539],[2.969,49.6553],[2.9714,49.6583],[2.9668,49.6601],[2.956,49.6608],[2.9557,49.6614],[2.9537,49.6616],[2.9536,49.663],[2.9496,49.6637],[2.9491,49.6646],[2.9539,49.6663],[2.9554,49.6653],[2.955,49.6675],[2.953,49.6702],[2.9535,49.6758],[2.9522,49.6781],[2.956,49.678]]]},"60264":{"type":"Polygon","coordinates":[[[2.1055,49.3776],[2.0984,49.3738],[2.0913,49.3721],[2.0901,49.37],[2.0913,49.3683],[2.0906,49.3671],[2.091,49.3658],[2.0901,49.3638],[2.0869,49.3615],[2.0864,49.36],[2.0823,49.3606],[2.0853,49.3638],[2.0855,49.3659],[2.084,49.3681],[2.0838,49.3672],[2.0825,49.3676],[2.0831,49.3687],[2.0811,49.3704],[2.0803,49.3696],[2.076,49.3708],[2.0786,49.3732],[2.0734,49.3764],[2.0679,49.3756],[2.0629,49.377],[2.0598,49.3797],[2.0584,49.3828],[2.0604,49.385],[2.0688,49.3862],[2.0684,49.3885],[2.0721,49.3906],[2.0729,49.3928],[2.0724,49.3938],[2.0751,49.3945],[2.0748,49.3963],[2.0769,49.3973],[2.077,49.3986],[2.0794,49.3991],[2.0831,49.3967],[2.0844,49.3972],[2.0843,49.3945],[2.0857,49.3923],[2.0879,49.392],[2.0894,49.3892],[2.0936,49.3909],[2.1004,49.3831],[2.1053,49.3844],[2.107,49.3788],[2.1055,49.3776]]]},"60265":{"type":"Polygon","coordinates":[[[2.1992,49.5614],[2.1898,49.5662],[2.1885,49.5684],[2.1897,49.5687],[2.1886,49.5709],[2.19,49.5707],[2.1909,49.5722],[2.193,49.5716],[2.194,49.5735],[2.1998,49.5735],[2.2026,49.5764],[2.2037,49.5791],[2.2056,49.58],[2.2109,49.5781],[2.2158,49.578],[2.2188,49.5766],[2.22,49.5755],[2.2195,49.5746],[2.2217,49.5733],[2.227,49.5734],[2.2339,49.5778],[2.2345,49.5766],[2.2314,49.5747],[2.2345,49.5728],[2.2304,49.565],[2.2359,49.563],[2.2331,49.5576],[2.2319,49.5581],[2.2309,49.5551],[2.2331,49.5535],[2.2265,49.5526],[2.228,49.5517],[2.2201,49.5504],[2.2162,49.5514],[2.2154,49.5538],[2.2113,49.5554],[2.2117,49.5559],[2.21,49.5558],[2.2106,49.5568],[2.2082,49.5567],[2.2038,49.558],[2.1992,49.5614]]]},"60267":{"type":"Polygon","coordinates":[[[2.1219,49.634],[2.1185,49.6334],[2.1175,49.6291],[2.1218,49.6302],[2.1246,49.6277],[2.121,49.626],[2.1259,49.6202],[2.1288,49.6211],[2.1287,49.6205],[2.1233,49.619],[2.1186,49.6165],[2.1213,49.6143],[2.1145,49.6115],[2.1136,49.6115],[2.1134,49.6132],[2.1114,49.6146],[2.1099,49.6183],[2.1071,49.6196],[2.1067,49.622],[2.1048,49.6236],[2.1021,49.6238],[2.099,49.6222],[2.0939,49.6238],[2.0929,49.6271],[2.0933,49.6285],[2.0946,49.6291],[2.098,49.6295],[2.1004,49.6309],[2.1018,49.63],[2.1037,49.631],[2.1043,49.6314],[2.1025,49.6326],[2.1034,49.6334],[2.1049,49.6327],[2.1061,49.635],[2.1095,49.6346],[2.1103,49.6359],[2.1169,49.6387],[2.1183,49.6382],[2.1172,49.6368],[2.122,49.6367],[2.1219,49.634]]]},"60268":{"type":"Polygon","coordinates":[[[2.4029,49.5859],[2.4033,49.5863],[2.4055,49.5847],[2.4087,49.5838],[2.4091,49.5847],[2.4149,49.5854],[2.4184,49.5839],[2.4182,49.5849],[2.4206,49.5855],[2.4222,49.5836],[2.4275,49.5889],[2.4238,49.5895],[2.4284,49.5932],[2.433,49.5924],[2.4326,49.5919],[2.4371,49.5906],[2.4338,49.5854],[2.4392,49.5839],[2.436,49.5809],[2.4338,49.5812],[2.4306,49.5789],[2.4401,49.5738],[2.4397,49.5726],[2.4407,49.5699],[2.4391,49.5691],[2.4398,49.5662],[2.4362,49.5566],[2.4222,49.558],[2.4208,49.5573],[2.4146,49.5576],[2.4148,49.5587],[2.4096,49.5591],[2.4109,49.5634],[2.4091,49.5636],[2.4084,49.5676],[2.4062,49.5672],[2.4057,49.5703],[2.3922,49.5753],[2.3937,49.5856],[2.3973,49.5837],[2.3998,49.5855],[2.401,49.5846],[2.4029,49.5859]]]},"60269":{"type":"Polygon","coordinates":[[[1.9621,49.6353],[1.9643,49.6353],[1.9647,49.6332],[1.9691,49.6295],[1.9648,49.626],[1.9674,49.6235],[1.975,49.6216],[1.9774,49.6192],[1.9788,49.6194],[1.9778,49.6157],[1.976,49.6135],[1.977,49.6133],[1.9767,49.6126],[1.9801,49.6119],[1.9789,49.6104],[1.978,49.6109],[1.973,49.6084],[1.9731,49.6075],[1.9713,49.6067],[1.9724,49.6052],[1.9688,49.6061],[1.9682,49.604],[1.9686,49.6024],[1.9642,49.6026],[1.9618,49.605],[1.9611,49.6044],[1.9574,49.6049],[1.9571,49.6043],[1.9527,49.6068],[1.9557,49.6092],[1.9469,49.6098],[1.9461,49.6121],[1.9467,49.6148],[1.944,49.6182],[1.9466,49.6219],[1.9465,49.623],[1.9448,49.6238],[1.9391,49.6238],[1.947,49.6301],[1.9508,49.6281],[1.9621,49.6353]]]},"60270":{"type":"Polygon","coordinates":[[[2.9845,49.6203],[2.9852,49.6231],[2.9872,49.6231],[2.9895,49.6267],[2.9955,49.6305],[2.9977,49.6286],[3.0034,49.6311],[3.0025,49.6291],[3.0001,49.6272],[2.9986,49.6276],[2.9969,49.6241],[3.0038,49.6229],[3.0032,49.6216],[3.0052,49.6214],[3.008,49.6175],[3.008,49.6157],[3.0097,49.6119],[3.0085,49.6077],[3.0064,49.604],[3.0068,49.6013],[3.0049,49.5944],[3.0022,49.5994],[3.0001,49.5974],[2.9979,49.5972],[2.9979,49.5965],[2.9965,49.596],[2.9947,49.5969],[2.9913,49.5956],[2.9903,49.5962],[2.9903,49.5942],[2.988,49.5972],[2.9862,49.5977],[2.9873,49.5982],[2.9865,49.5989],[2.9869,49.5995],[2.9846,49.6014],[2.9856,49.6025],[2.9822,49.6052],[2.9827,49.6063],[2.9833,49.606],[2.9852,49.6077],[2.9841,49.6095],[2.9845,49.6118],[2.987,49.6143],[2.9865,49.6152],[2.9873,49.6162],[2.987,49.6175],[2.9851,49.6184],[2.9845,49.6203]]]},"60271":{"type":"Polygon","coordinates":[[[1.8303,49.5293],[1.8297,49.5302],[1.8322,49.5315],[1.8306,49.5322],[1.833,49.5349],[1.8278,49.5365],[1.822,49.5409],[1.8199,49.5436],[1.8221,49.5444],[1.8227,49.5436],[1.8292,49.5455],[1.831,49.5472],[1.8315,49.5488],[1.8338,49.5495],[1.8491,49.5464],[1.851,49.5447],[1.858,49.5415],[1.8602,49.538],[1.8613,49.5385],[1.8651,49.5366],[1.8655,49.5363],[1.863,49.5352],[1.8664,49.5348],[1.8621,49.5337],[1.8608,49.5301],[1.8562,49.5316],[1.8545,49.5294],[1.8492,49.5296],[1.846,49.531],[1.8346,49.5285],[1.8306,49.5287],[1.8303,49.5293]]]},"60272":{"type":"Polygon","coordinates":[[[2.8969,49.286],[2.8937,49.2862],[2.8897,49.2852],[2.8857,49.2862],[2.8785,49.2862],[2.8782,49.287],[2.8762,49.2877],[2.8756,49.2892],[2.869,49.2892],[2.87,49.2932],[2.8747,49.2937],[2.8782,49.2976],[2.8774,49.298],[2.8842,49.3023],[2.8814,49.3036],[2.8733,49.3024],[2.8726,49.3043],[2.8739,49.3094],[2.8838,49.3118],[2.8802,49.319],[2.8879,49.3217],[2.8885,49.321],[2.8875,49.3194],[2.8923,49.3146],[2.898,49.3132],[2.9009,49.3151],[2.902,49.3149],[2.9062,49.3081],[2.9097,49.3044],[2.9116,49.3037],[2.9065,49.2986],[2.906,49.2954],[2.9013,49.2903],[2.8997,49.2902],[2.8984,49.2913],[2.8983,49.2881],[2.8969,49.286]]]},"60273":{"type":"Polygon","coordinates":[[[2.8059,49.4728],[2.8061,49.4734],[2.8089,49.4727],[2.8097,49.4742],[2.8156,49.4781],[2.8146,49.4812],[2.8216,49.4823],[2.8228,49.4818],[2.8229,49.4808],[2.8266,49.4814],[2.8401,49.4793],[2.8441,49.4795],[2.8452,49.4768],[2.8464,49.4761],[2.8448,49.4756],[2.8452,49.4747],[2.8422,49.474],[2.8413,49.4717],[2.8397,49.4706],[2.8332,49.4696],[2.8305,49.4659],[2.8263,49.4663],[2.8252,49.4671],[2.8216,49.4662],[2.811,49.4663],[2.8011,49.4703],[2.8023,49.4711],[2.8046,49.4702],[2.8059,49.4728]]]},"60274":{"type":"Polygon","coordinates":[[[2.8359,49.2877],[2.8429,49.2885],[2.8438,49.2875],[2.8425,49.2864],[2.8433,49.286],[2.8424,49.2843],[2.8449,49.282],[2.8442,49.2813],[2.847,49.2792],[2.8487,49.2789],[2.851,49.2809],[2.8522,49.2799],[2.8539,49.2806],[2.8568,49.277],[2.8566,49.2759],[2.8579,49.2742],[2.8577,49.2677],[2.849,49.2672],[2.8488,49.2642],[2.8509,49.2634],[2.8515,49.2622],[2.8499,49.2619],[2.8478,49.2587],[2.8454,49.2577],[2.8391,49.2577],[2.8397,49.2591],[2.8377,49.2587],[2.8374,49.2594],[2.8348,49.2596],[2.8343,49.261],[2.8317,49.2612],[2.8318,49.263],[2.8291,49.2684],[2.8275,49.2683],[2.8248,49.2733],[2.8216,49.2735],[2.829,49.285],[2.8328,49.2853],[2.8359,49.2877]]]},"60275":{"type":"Polygon","coordinates":[[[1.9085,49.5035],[1.9107,49.5016],[1.9125,49.5015],[1.9163,49.5044],[1.9168,49.5039],[1.9157,49.503],[1.9154,49.501],[1.9163,49.5005],[1.9155,49.4994],[1.9166,49.4993],[1.9171,49.4975],[1.9162,49.4964],[1.9223,49.4937],[1.9215,49.4926],[1.9185,49.4937],[1.9167,49.4916],[1.9141,49.4927],[1.9095,49.4879],[1.9081,49.4909],[1.9025,49.4876],[1.8982,49.488],[1.8976,49.4872],[1.8951,49.488],[1.8942,49.4875],[1.8925,49.4885],[1.8891,49.4841],[1.8875,49.485],[1.888,49.4877],[1.8871,49.4885],[1.8883,49.4894],[1.8869,49.4914],[1.8878,49.4919],[1.8837,49.4935],[1.8802,49.4936],[1.8805,49.4953],[1.8823,49.4949],[1.8849,49.5017],[1.8898,49.5039],[1.8921,49.5046],[1.8932,49.5035],[1.8942,49.5042],[1.8962,49.5027],[1.8968,49.5035],[1.9033,49.5002],[1.9085,49.5035]]]},"60276":{"type":"Polygon","coordinates":[[[2.5234,49.5765],[2.5221,49.5787],[2.5239,49.5799],[2.5357,49.5848],[2.5452,49.5907],[2.5447,49.5919],[2.5463,49.595],[2.5478,49.5933],[2.5566,49.5953],[2.5614,49.592],[2.5604,49.5917],[2.5651,49.5846],[2.5641,49.5844],[2.5721,49.5818],[2.5616,49.5775],[2.5604,49.5784],[2.5518,49.5702],[2.5446,49.5715],[2.5379,49.5711],[2.5345,49.5733],[2.5328,49.5732],[2.5325,49.5753],[2.5276,49.5745],[2.5234,49.5765]]]},"60277":{"type":"Polygon","coordinates":[[[2.0576,49.4212],[2.0535,49.4185],[2.0504,49.4209],[2.0491,49.4192],[2.0473,49.42],[2.0475,49.4193],[2.0441,49.4183],[2.0395,49.4186],[2.0402,49.419],[2.0394,49.4193],[2.0381,49.4185],[2.0371,49.4156],[2.0334,49.4144],[2.0317,49.412],[2.0277,49.4111],[2.0283,49.4092],[2.026,49.4097],[2.0257,49.4091],[2.0254,49.4097],[2.0215,49.4086],[2.0197,49.4094],[2.0201,49.41],[2.0188,49.41],[2.0197,49.411],[2.0189,49.4124],[2.0202,49.413],[2.0185,49.4139],[2.0189,49.4144],[2.018,49.4161],[2.0163,49.416],[2.0133,49.419],[2.0139,49.4249],[2.0225,49.4349],[2.0242,49.4364],[2.0278,49.4375],[2.034,49.4415],[2.0363,49.4423],[2.0407,49.4391],[2.0349,49.437],[2.0348,49.4353],[2.0447,49.4355],[2.0463,49.4332],[2.0491,49.4339],[2.0501,49.4335],[2.0496,49.4321],[2.0529,49.432],[2.0519,49.431],[2.0558,49.4288],[2.0542,49.428],[2.0575,49.4271],[2.0537,49.4253],[2.0569,49.4234],[2.0576,49.4212]]]},"60278":{"type":"Polygon","coordinates":[[[3.0524,49.7139],[3.0566,49.713],[3.0581,49.7116],[3.0593,49.7126],[3.0648,49.7127],[3.0647,49.7139],[3.0654,49.7142],[3.0686,49.7129],[3.074,49.7131],[3.0743,49.7114],[3.0784,49.7109],[3.0834,49.7127],[3.0847,49.7091],[3.0847,49.7064],[3.0827,49.7002],[3.0782,49.6949],[3.0781,49.6934],[3.0797,49.6918],[3.0785,49.6902],[3.0729,49.6908],[3.0703,49.6938],[3.0672,49.6927],[3.0663,49.6961],[3.0613,49.6956],[3.0599,49.692],[3.0564,49.6923],[3.0567,49.6935],[3.0555,49.6936],[3.0559,49.6943],[3.0548,49.6957],[3.0596,49.7021],[3.0576,49.7025],[3.0584,49.7052],[3.0571,49.7058],[3.057,49.7081],[3.0534,49.7101],[3.0539,49.7113],[3.0524,49.7139]]]},"60279":{"type":"Polygon","coordinates":[[[2.9607,49.2316],[2.9644,49.2319],[2.9642,49.2309],[2.959,49.2286],[2.958,49.2269],[2.9593,49.226],[2.9605,49.2225],[2.9649,49.2203],[2.962,49.2184],[2.9676,49.2167],[2.9684,49.2146],[2.9708,49.2144],[2.9712,49.2128],[2.9698,49.2104],[2.9685,49.2114],[2.9667,49.2096],[2.9647,49.2093],[2.965,49.2062],[2.9623,49.2061],[2.9621,49.205],[2.9602,49.2048],[2.96,49.204],[2.9527,49.2034],[2.952,49.2055],[2.9487,49.2066],[2.9481,49.2075],[2.9431,49.208],[2.9388,49.2101],[2.9403,49.2111],[2.9394,49.2133],[2.937,49.214],[2.9373,49.2145],[2.9362,49.2151],[2.9327,49.215],[2.9318,49.2162],[2.9293,49.2164],[2.9246,49.2203],[2.925,49.2219],[2.9277,49.2208],[2.9273,49.22],[2.9299,49.2202],[2.9297,49.2209],[2.9319,49.2231],[2.9271,49.2255],[2.9276,49.2293],[2.9321,49.2277],[2.9336,49.2287],[2.9362,49.2282],[2.9355,49.2333],[2.9378,49.2332],[2.9454,49.2359],[2.9482,49.2361],[2.9506,49.2375],[2.9542,49.2367],[2.9544,49.2359],[2.9586,49.2339],[2.959,49.2323],[2.9607,49.2316]]]},"60280":{"type":"Polygon","coordinates":[[[1.796,49.7271],[1.7859,49.7225],[1.7839,49.7236],[1.7802,49.7236],[1.7782,49.7225],[1.7771,49.7189],[1.7751,49.7164],[1.7736,49.7163],[1.7725,49.7144],[1.7706,49.7144],[1.7727,49.7164],[1.7704,49.7175],[1.7709,49.722],[1.7696,49.7226],[1.7707,49.7242],[1.7684,49.7274],[1.7675,49.7272],[1.7656,49.7287],[1.7679,49.7295],[1.7672,49.7303],[1.7677,49.7316],[1.7729,49.7309],[1.7736,49.7335],[1.7807,49.7338],[1.781,49.7351],[1.7822,49.7352],[1.7857,49.7339],[1.7856,49.7334],[1.796,49.7271]]]},"60281":{"type":"Polygon","coordinates":[[[2.6968,49.5296],[2.7032,49.5288],[2.703,49.5269],[2.7073,49.5228],[2.7088,49.5194],[2.697,49.5134],[2.7043,49.5111],[2.697,49.5049],[2.6963,49.5034],[2.697,49.5023],[2.703,49.5029],[2.7032,49.5019],[2.7023,49.5017],[2.7066,49.5019],[2.7071,49.5002],[2.7017,49.4985],[2.7043,49.4954],[2.7158,49.4979],[2.7158,49.4966],[2.7246,49.4917],[2.7222,49.4895],[2.7278,49.4875],[2.7251,49.4849],[2.7196,49.4869],[2.716,49.4829],[2.7138,49.4831],[2.7121,49.4812],[2.7121,49.4783],[2.7111,49.4785],[2.7087,49.4756],[2.7056,49.4753],[2.7045,49.4733],[2.6975,49.4755],[2.6939,49.4777],[2.6917,49.4802],[2.692,49.4821],[2.6908,49.4832],[2.6723,49.4877],[2.6729,49.4888],[2.6708,49.4898],[2.6685,49.4894],[2.6672,49.4871],[2.6646,49.4889],[2.6612,49.4867],[2.6599,49.4873],[2.659,49.4892],[2.661,49.4894],[2.6609,49.4914],[2.6626,49.4921],[2.6639,49.4951],[2.669,49.4938],[2.6696,49.4962],[2.6699,49.4977],[2.6663,49.5017],[2.6643,49.5024],[2.6623,49.5053],[2.6648,49.5088],[2.6635,49.5104],[2.6636,49.5131],[2.6722,49.5142],[2.676,49.5132],[2.6812,49.5153],[2.6795,49.5215],[2.6806,49.5217],[2.6788,49.5239],[2.6797,49.5287],[2.6837,49.5274],[2.6853,49.5302],[2.6968,49.5296]]]},"60282":{"type":"Polygon","coordinates":[[[2.3913,49.2043],[2.3959,49.2048],[2.4021,49.2033],[2.4131,49.2048],[2.4205,49.2085],[2.4229,49.2136],[2.4286,49.2113],[2.4314,49.2125],[2.4352,49.2115],[2.4429,49.2117],[2.4631,49.2086],[2.4611,49.2026],[2.4567,49.2023],[2.4587,49.1918],[2.4577,49.1909],[2.4594,49.1843],[2.4483,49.1665],[2.4426,49.1701],[2.4371,49.1712],[2.434,49.1697],[2.4338,49.1706],[2.3798,49.1733],[2.3786,49.1749],[2.375,49.1762],[2.3741,49.1731],[2.3697,49.1736],[2.3701,49.1751],[2.3692,49.1752],[2.3706,49.1787],[2.3709,49.1854],[2.3755,49.1852],[2.3787,49.1918],[2.3858,49.1955],[2.3859,49.197],[2.3913,49.2025],[2.3913,49.2043]]]},"60283":{"type":"Polygon","coordinates":[[[2.2296,49.7022],[2.2312,49.7028],[2.2351,49.7001],[2.2322,49.6974],[2.2321,49.695],[2.2303,49.6932],[2.2291,49.6936],[2.2282,49.6924],[2.2278,49.6912],[2.2303,49.6894],[2.2224,49.6873],[2.2229,49.6868],[2.2158,49.6868],[2.2132,49.6878],[2.21,49.6907],[2.2041,49.6939],[2.1987,49.6961],[2.1921,49.7028],[2.1928,49.7031],[2.1948,49.7011],[2.1972,49.7017],[2.2001,49.6987],[2.2036,49.6983],[2.2148,49.7021],[2.2173,49.7019],[2.2174,49.7025],[2.2196,49.7024],[2.2199,49.7013],[2.2217,49.7012],[2.2218,49.7023],[2.2296,49.7022]]]},"60284":{"type":"Polygon","coordinates":[[[2.6822,49.3812],[2.6827,49.3787],[2.6859,49.3723],[2.6779,49.3694],[2.6801,49.3669],[2.6736,49.3659],[2.6749,49.3624],[2.671,49.3614],[2.6704,49.3628],[2.6652,49.3614],[2.6662,49.36],[2.6641,49.3598],[2.6634,49.3605],[2.6576,49.3592],[2.6589,49.3579],[2.6552,49.3569],[2.6533,49.361],[2.6471,49.3566],[2.6389,49.3565],[2.6375,49.3541],[2.6361,49.3539],[2.634,49.3563],[2.6362,49.3593],[2.6362,49.3613],[2.6377,49.3635],[2.6383,49.3669],[2.6376,49.3673],[2.6438,49.3788],[2.6438,49.3812],[2.641,49.3828],[2.644,49.3855],[2.643,49.3859],[2.6443,49.3871],[2.6457,49.3864],[2.6468,49.3874],[2.6455,49.388],[2.6481,49.3954],[2.651,49.3954],[2.649,49.3986],[2.6525,49.3989],[2.6517,49.3997],[2.6555,49.3996],[2.6552,49.4009],[2.6601,49.4008],[2.6593,49.4034],[2.6624,49.4056],[2.6644,49.4032],[2.6666,49.3988],[2.6645,49.3962],[2.6724,49.3918],[2.6671,49.3888],[2.6689,49.3872],[2.6675,49.3864],[2.6712,49.3829],[2.6705,49.3825],[2.672,49.3802],[2.6731,49.3804],[2.6737,49.3794],[2.6822,49.3812]]]},"60285":{"type":"Polygon","coordinates":[[[2.5992,49.4461],[2.5881,49.4475],[2.5869,49.4469],[2.5843,49.4473],[2.5827,49.4521],[2.5858,49.4526],[2.5834,49.4566],[2.5835,49.4572],[2.5907,49.4578],[2.5946,49.4666],[2.5975,49.4674],[2.5954,49.4689],[2.5994,49.474],[2.6015,49.4737],[2.6004,49.4746],[2.6054,49.4791],[2.6115,49.48],[2.6121,49.4807],[2.6169,49.4792],[2.6205,49.48],[2.6213,49.4795],[2.6208,49.4791],[2.633,49.4745],[2.6332,49.4701],[2.6306,49.4663],[2.6228,49.4691],[2.619,49.4639],[2.6152,49.4612],[2.6106,49.4592],[2.6097,49.4563],[2.5992,49.4461]]]},"60286":{"type":"Polygon","coordinates":[[[1.9596,49.6662],[1.9579,49.6666],[1.9553,49.6621],[1.9577,49.6616],[1.9565,49.6585],[1.9554,49.6576],[1.9567,49.6575],[1.9485,49.6527],[1.9436,49.6572],[1.942,49.657],[1.9417,49.6582],[1.9379,49.658],[1.9377,49.6594],[1.93,49.6583],[1.9287,49.6609],[1.9217,49.6613],[1.9098,49.6587],[1.9079,49.6606],[1.9028,49.6583],[1.8946,49.6589],[1.8934,49.6613],[1.9023,49.6634],[1.9118,49.6679],[1.9095,49.6702],[1.9128,49.6713],[1.9149,49.6687],[1.9356,49.6729],[1.9356,49.6746],[1.9376,49.6746],[1.9376,49.6764],[1.9425,49.6775],[1.9529,49.6824],[1.9569,49.6778],[1.9544,49.6766],[1.9567,49.6733],[1.956,49.6731],[1.9572,49.6713],[1.9561,49.6711],[1.9596,49.6662]]]},"60287":{"type":"Polygon","coordinates":[[[3.0936,49.6225],[3.1022,49.6157],[3.1009,49.6159],[3.0979,49.6139],[3.0995,49.6126],[3.0995,49.6117],[3.1027,49.61],[3.1042,49.6077],[3.0995,49.605],[3.0968,49.6023],[3.0945,49.6012],[3.095,49.6008],[3.0926,49.5998],[3.0929,49.5993],[3.0895,49.5982],[3.0892,49.5966],[3.0876,49.5969],[3.0845,49.5949],[3.0803,49.5965],[3.0785,49.5984],[3.0768,49.6009],[3.078,49.6031],[3.0748,49.6021],[3.0742,49.6035],[3.0768,49.6044],[3.0763,49.605],[3.0769,49.6058],[3.0711,49.6067],[3.0686,49.6085],[3.0657,49.6086],[3.0626,49.61],[3.0392,49.6141],[3.0446,49.6149],[3.0489,49.6171],[3.0571,49.6177],[3.0545,49.6207],[3.0557,49.6211],[3.0591,49.6201],[3.0669,49.6207],[3.0743,49.6227],[3.0765,49.6255],[3.0864,49.6268],[3.0874,49.6237],[3.0898,49.6213],[3.0936,49.6225]]]},"60288":{"type":"Polygon","coordinates":[[[1.8804,49.5738],[1.8835,49.5746],[1.8848,49.573],[1.8895,49.5737],[1.889,49.5747],[1.8902,49.5755],[1.8929,49.5755],[1.893,49.5745],[1.8947,49.5746],[1.8948,49.5739],[1.8937,49.5738],[1.8941,49.5727],[1.8898,49.5716],[1.8903,49.5707],[1.8959,49.5726],[1.8966,49.5715],[1.9025,49.5701],[1.9021,49.5688],[1.9085,49.5646],[1.9111,49.5664],[1.9141,49.5658],[1.9184,49.5645],[1.9199,49.563],[1.9212,49.5634],[1.9261,49.5602],[1.9296,49.5604],[1.939,49.5574],[1.9373,49.5559],[1.9305,49.5527],[1.9302,49.5515],[1.921,49.5481],[1.9158,49.545],[1.9137,49.5462],[1.91,49.5448],[1.9086,49.5458],[1.9099,49.547],[1.9069,49.5496],[1.902,49.5467],[1.8983,49.5505],[1.8953,49.5491],[1.8947,49.5496],[1.898,49.5511],[1.8971,49.5529],[1.8888,49.5591],[1.8866,49.5572],[1.882,49.5608],[1.881,49.5621],[1.8841,49.5642],[1.8843,49.5652],[1.8832,49.5677],[1.8818,49.5672],[1.8791,49.5689],[1.8823,49.5712],[1.8804,49.5738]]]},"60289":{"type":"Polygon","coordinates":[[[1.9783,49.6195],[1.9774,49.6192],[1.975,49.6216],[1.9705,49.6223],[1.968,49.6238],[1.9677,49.6233],[1.9648,49.626],[1.9691,49.6295],[1.9647,49.6332],[1.9643,49.6353],[1.9621,49.6353],[1.957,49.6391],[1.9608,49.6404],[1.9575,49.6444],[1.9632,49.646],[1.9676,49.6449],[1.9691,49.6455],[1.9858,49.6456],[1.9862,49.6439],[1.9938,49.6443],[1.9946,49.6401],[1.9968,49.6348],[1.9976,49.6256],[1.9909,49.625],[1.979,49.6206],[1.9783,49.6195]]]},"60290":{"type":"Polygon","coordinates":[[[2.1496,49.4867],[2.1313,49.4739],[2.1298,49.4753],[2.126,49.4732],[2.1232,49.4759],[2.1207,49.4739],[2.1205,49.4758],[2.1182,49.4803],[2.112,49.4852],[2.1155,49.487],[2.1154,49.489],[2.1127,49.4904],[2.1163,49.4939],[2.1177,49.4984],[2.1201,49.4991],[2.1266,49.4981],[2.1302,49.4999],[2.13,49.5011],[2.1328,49.4989],[2.1315,49.4971],[2.1365,49.4946],[2.1363,49.4927],[2.1378,49.4931],[2.1398,49.4911],[2.143,49.4896],[2.1428,49.4889],[2.1463,49.4885],[2.1496,49.4867]]]},"60291":{"type":"Polygon","coordinates":[[[3.0564,49.6756],[3.0554,49.6698],[3.0597,49.6708],[3.0635,49.6671],[3.0649,49.664],[3.0638,49.6633],[3.0678,49.66],[3.0743,49.6611],[3.0811,49.6609],[3.0825,49.6602],[3.0875,49.661],[3.089,49.6614],[3.0872,49.6665],[3.0887,49.6675],[3.0885,49.6684],[3.0909,49.6686],[3.0906,49.6692],[3.0991,49.6842],[3.1086,49.6644],[3.1062,49.6619],[3.108,49.6581],[3.102,49.6566],[3.0975,49.6568],[3.0964,49.6505],[3.0953,49.6505],[3.0918,49.6449],[3.091,49.6448],[3.0898,49.6412],[3.0878,49.6398],[3.0865,49.6399],[3.0863,49.6416],[3.0603,49.6445],[3.0612,49.6453],[3.0605,49.6458],[3.0565,49.6432],[3.0572,49.6422],[3.0519,49.6412],[3.0457,49.6432],[3.0428,49.6391],[3.0372,49.6397],[3.037,49.6407],[3.0339,49.6385],[3.0214,49.6403],[3.0209,49.641],[3.0168,49.6417],[3.0158,49.6403],[3.0112,49.6406],[3.0267,49.6491],[3.0253,49.6517],[3.0166,49.6561],[3.0135,49.6563],[3.0141,49.6568],[3.0121,49.6574],[3.0109,49.6564],[3.0079,49.6563],[3.0082,49.6573],[3.0093,49.6575],[3.0091,49.6607],[3.0104,49.6608],[3.0095,49.6637],[3.0164,49.6657],[3.0196,49.6681],[3.0174,49.6703],[3.0166,49.673],[3.0115,49.6745],[3.0158,49.6753],[3.0283,49.6799],[3.0341,49.6835],[3.0409,49.6786],[3.0424,49.6738],[3.0528,49.676],[3.0564,49.6756]]]},"60292":{"type":"Polygon","coordinates":[[[2.7847,49.5649],[2.7855,49.5661],[2.7845,49.5663],[2.7836,49.5694],[2.787,49.5695],[2.7868,49.5729],[2.7848,49.5744],[2.785,49.5751],[2.791,49.5756],[2.7958,49.5776],[2.7939,49.5797],[2.7927,49.5795],[2.7921,49.5826],[2.7961,49.5859],[2.7973,49.5842],[2.7997,49.5847],[2.8017,49.5842],[2.8074,49.581],[2.8146,49.5791],[2.8155,49.5782],[2.8139,49.5772],[2.8176,49.5747],[2.8146,49.5727],[2.8165,49.5714],[2.8169,49.5694],[2.8149,49.5638],[2.8129,49.5634],[2.8167,49.5616],[2.8175,49.56],[2.8161,49.5577],[2.8113,49.5604],[2.8104,49.5584],[2.8057,49.5577],[2.7954,49.5597],[2.7963,49.5603],[2.7955,49.5611],[2.7917,49.5622],[2.7908,49.5615],[2.7883,49.5621],[2.7884,49.5633],[2.7847,49.5649]]]},"60293":{"type":"Polygon","coordinates":[[[1.8735,49.1741],[1.8678,49.1718],[1.8582,49.17],[1.8565,49.172],[1.8579,49.1722],[1.8568,49.1734],[1.8551,49.1719],[1.851,49.1705],[1.8489,49.1706],[1.8479,49.172],[1.849,49.1724],[1.8467,49.1755],[1.8491,49.1771],[1.8481,49.178],[1.846,49.1767],[1.8444,49.1786],[1.8399,49.1806],[1.8434,49.1828],[1.8408,49.1848],[1.8397,49.1881],[1.8385,49.1882],[1.8392,49.1899],[1.8379,49.1913],[1.8329,49.1923],[1.832,49.1917],[1.8314,49.1932],[1.8258,49.1988],[1.8239,49.1985],[1.8284,49.2019],[1.8328,49.1991],[1.8344,49.2003],[1.8337,49.2008],[1.8349,49.2022],[1.8365,49.202],[1.8384,49.2035],[1.8396,49.207],[1.8404,49.2066],[1.8441,49.2091],[1.8502,49.2046],[1.8494,49.2038],[1.8599,49.2036],[1.8619,49.2025],[1.8609,49.2015],[1.8617,49.2011],[1.8611,49.2001],[1.8631,49.1998],[1.8635,49.1987],[1.8688,49.1967],[1.8683,49.196],[1.8718,49.1943],[1.8722,49.1921],[1.8711,49.1863],[1.8671,49.1857],[1.8765,49.1796],[1.8735,49.1741]]]},"60294":{"type":"Polygon","coordinates":[[[2.6708,49.5815],[2.6698,49.5814],[2.6693,49.5826],[2.6724,49.5844],[2.6733,49.5858],[2.6719,49.586],[2.6703,49.5889],[2.6715,49.5899],[2.67,49.5916],[2.6719,49.5926],[2.6737,49.5948],[2.6715,49.5986],[2.6684,49.5981],[2.6681,49.5991],[2.6697,49.6001],[2.6742,49.6001],[2.6791,49.5969],[2.683,49.5991],[2.6855,49.5975],[2.6888,49.5981],[2.6897,49.5968],[2.6932,49.5979],[2.6953,49.594],[2.6971,49.5941],[2.6973,49.5919],[2.6998,49.5914],[2.699,49.5908],[2.7017,49.5893],[2.6929,49.5849],[2.6905,49.5866],[2.6865,49.5844],[2.6826,49.584],[2.6798,49.5822],[2.6787,49.5827],[2.6769,49.5799],[2.6708,49.5815]]]},"60295":{"type":"Polygon","coordinates":[[[1.9562,49.6441],[1.9582,49.6425],[1.9453,49.6411],[1.9452,49.6417],[1.9386,49.6424],[1.9389,49.6384],[1.9313,49.641],[1.9267,49.6427],[1.9268,49.6533],[1.9247,49.6536],[1.9249,49.6542],[1.915,49.6551],[1.9151,49.6568],[1.9157,49.6568],[1.9139,49.6595],[1.9217,49.6613],[1.9287,49.6609],[1.93,49.6583],[1.9377,49.6594],[1.9379,49.658],[1.9417,49.6582],[1.942,49.657],[1.9436,49.6572],[1.9485,49.6527],[1.9476,49.6522],[1.9494,49.6508],[1.95,49.6477],[1.9562,49.6441]]]},"60296":{"type":"Polygon","coordinates":[[[1.8141,49.4904],[1.8065,49.4913],[1.8057,49.4944],[1.8011,49.4941],[1.7892,49.4904],[1.7884,49.4912],[1.7875,49.4908],[1.7873,49.4917],[1.7889,49.4919],[1.7875,49.4935],[1.7908,49.498],[1.7879,49.4991],[1.7866,49.4982],[1.7852,49.4988],[1.789,49.5011],[1.7903,49.5035],[1.7872,49.5073],[1.7858,49.5078],[1.7882,49.5152],[1.79,49.5166],[1.7889,49.5169],[1.7922,49.5189],[1.7929,49.5183],[1.7966,49.52],[1.7973,49.5227],[1.8034,49.5248],[1.8049,49.5262],[1.8122,49.525],[1.8204,49.5266],[1.8212,49.5235],[1.8283,49.5162],[1.8307,49.5158],[1.835,49.5172],[1.8357,49.516],[1.8358,49.5119],[1.833,49.5091],[1.8323,49.5069],[1.8262,49.505],[1.8233,49.5011],[1.8235,49.4977],[1.8195,49.4971],[1.8163,49.495],[1.8126,49.4953],[1.8124,49.4924],[1.8141,49.4904]]]},"60297":{"type":"Polygon","coordinates":[[[2.0361,49.6443],[2.033,49.6446],[2.0346,49.6422],[2.026,49.6409],[2.0234,49.6392],[2.014,49.6357],[2.0081,49.6299],[1.9976,49.6257],[1.9968,49.6348],[1.9946,49.6401],[1.9938,49.6443],[1.9888,49.6437],[1.9862,49.6439],[1.9858,49.6456],[1.9751,49.6455],[1.9749,49.6489],[1.9782,49.6504],[1.986,49.6472],[1.986,49.6514],[1.9903,49.6512],[1.9938,49.6521],[1.9947,49.6531],[1.9965,49.65],[2.0031,49.6525],[2.0192,49.6541],[2.0249,49.6574],[2.0328,49.6597],[2.0418,49.6588],[2.0424,49.6595],[2.0444,49.659],[2.0448,49.6558],[2.0418,49.6534],[2.0361,49.6443]]]},"60298":{"type":"Polygon","coordinates":[[[1.8537,49.5126],[1.8553,49.5153],[1.8556,49.5179],[1.8605,49.5182],[1.8613,49.5189],[1.8645,49.5175],[1.867,49.5189],[1.8671,49.52],[1.8663,49.5206],[1.867,49.5213],[1.8689,49.521],[1.8696,49.5225],[1.8718,49.522],[1.8723,49.5226],[1.8726,49.5211],[1.8747,49.522],[1.8771,49.5198],[1.8791,49.5209],[1.8802,49.5206],[1.8846,49.5186],[1.8839,49.5179],[1.8903,49.5163],[1.891,49.5152],[1.8957,49.5133],[1.8967,49.5139],[1.8982,49.5128],[1.9002,49.5134],[1.9009,49.5125],[1.8985,49.5114],[1.9012,49.5092],[1.9029,49.5099],[1.9088,49.5052],[1.9078,49.5044],[1.9085,49.5035],[1.9033,49.5002],[1.8968,49.5035],[1.8962,49.5027],[1.8942,49.5042],[1.8932,49.5035],[1.8921,49.5046],[1.8898,49.5039],[1.8849,49.5017],[1.8823,49.4949],[1.8805,49.4953],[1.8802,49.4936],[1.877,49.4939],[1.8755,49.4966],[1.8725,49.4984],[1.873,49.4988],[1.8706,49.499],[1.8655,49.4978],[1.8651,49.4994],[1.8685,49.4996],[1.8687,49.5007],[1.8671,49.5016],[1.8682,49.5025],[1.8676,49.5033],[1.8684,49.5059],[1.8667,49.5062],[1.8689,49.5118],[1.8645,49.5108],[1.864,49.5116],[1.86,49.512],[1.8586,49.513],[1.8537,49.5126]]]},"60299":{"type":"Polygon","coordinates":[[[2.2033,49.6265],[2.2055,49.6266],[2.2049,49.633],[2.2054,49.635],[2.2094,49.6335],[2.2087,49.6302],[2.2104,49.6339],[2.2118,49.6341],[2.2122,49.6349],[2.2211,49.6331],[2.2323,49.6333],[2.2319,49.6327],[2.2327,49.6325],[2.2415,49.6343],[2.2437,49.6324],[2.2348,49.6311],[2.2371,49.6301],[2.2372,49.6291],[2.2503,49.6277],[2.2505,49.6256],[2.2485,49.6236],[2.2486,49.6224],[2.2504,49.622],[2.2509,49.6193],[2.2535,49.618],[2.2544,49.6156],[2.2487,49.6146],[2.2472,49.6091],[2.2415,49.6117],[2.233,49.6102],[2.2322,49.6096],[2.233,49.609],[2.2305,49.6078],[2.2289,49.609],[2.2264,49.608],[2.2259,49.6075],[2.2282,49.6048],[2.2279,49.6024],[2.2192,49.6037],[2.2062,49.6038],[2.2045,49.6029],[2.2003,49.6036],[2.2032,49.6155],[2.2033,49.6265]]]},"60301":{"type":"Polygon","coordinates":[[[1.9223,49.4937],[1.9162,49.4964],[1.9171,49.4975],[1.9166,49.4993],[1.9155,49.4994],[1.9163,49.5005],[1.9154,49.501],[1.9157,49.503],[1.9168,49.5039],[1.9163,49.5044],[1.9125,49.5015],[1.9098,49.5024],[1.915,49.506],[1.9172,49.5079],[1.9169,49.5085],[1.9269,49.5144],[1.9286,49.5166],[1.9359,49.515],[1.9422,49.5152],[1.9437,49.5148],[1.9433,49.5137],[1.9468,49.5139],[1.9469,49.5133],[1.9517,49.512],[1.9527,49.511],[1.9513,49.5101],[1.9513,49.5085],[1.9503,49.5073],[1.949,49.5072],[1.9472,49.5057],[1.9394,49.5036],[1.9342,49.5008],[1.9333,49.5015],[1.932,49.5013],[1.9315,49.4976],[1.9289,49.4972],[1.9264,49.498],[1.927,49.4958],[1.9223,49.4937]]]},"60302":{"type":"Polygon","coordinates":[[[2.2472,49.4659],[2.2413,49.4647],[2.2403,49.4687],[2.2408,49.4717],[2.2355,49.4727],[2.2362,49.4735],[2.2339,49.4741],[2.2124,49.4751],[2.2137,49.4803],[2.2211,49.481],[2.2214,49.4879],[2.2236,49.4912],[2.2245,49.499],[2.2312,49.4992],[2.2299,49.5003],[2.2333,49.5003],[2.2376,49.5025],[2.2439,49.5085],[2.2508,49.5067],[2.2493,49.506],[2.2487,49.5043],[2.247,49.5035],[2.2461,49.5018],[2.2469,49.5013],[2.2511,49.5027],[2.2496,49.4991],[2.2607,49.4963],[2.2653,49.4965],[2.2664,49.4959],[2.2666,49.4947],[2.2688,49.4939],[2.267,49.4908],[2.2645,49.4902],[2.2633,49.4866],[2.2639,49.4865],[2.2648,49.4843],[2.2612,49.4826],[2.2564,49.475],[2.2591,49.4729],[2.2452,49.4699],[2.2472,49.4659]]]},"60303":{"type":"Polygon","coordinates":[[[1.8656,49.6247],[1.8612,49.6233],[1.8601,49.624],[1.8567,49.6234],[1.8548,49.6208],[1.8506,49.6222],[1.8493,49.6256],[1.8452,49.6276],[1.8602,49.6323],[1.8588,49.6343],[1.86,49.6374],[1.8642,49.6391],[1.867,49.6377],[1.8862,49.6332],[1.8887,49.6319],[1.8883,49.6315],[1.894,49.6267],[1.8887,49.626],[1.8808,49.6227],[1.8794,49.6204],[1.8801,49.617],[1.8785,49.6168],[1.8777,49.6158],[1.8718,49.6175],[1.867,49.6254],[1.8656,49.6247]]]},"60304":{"type":"Polygon","coordinates":[[[1.984,49.5838],[1.9829,49.5853],[1.9938,49.5874],[1.995,49.588],[1.9947,49.5897],[1.9985,49.5903],[2.0014,49.5924],[2.0033,49.5939],[2.0016,49.5997],[2.007,49.6006],[2.0076,49.5999],[2.0106,49.6004],[2.0133,49.5963],[2.0142,49.5927],[2.0179,49.5914],[2.0183,49.5905],[2.022,49.5892],[2.0235,49.5878],[2.034,49.5845],[2.0366,49.5849],[2.0362,49.5825],[2.041,49.5805],[2.0356,49.5778],[2.0306,49.5796],[2.024,49.5757],[2.0172,49.5772],[2.0084,49.575],[2.0042,49.5764],[2.0028,49.5744],[1.998,49.5712],[1.9892,49.5681],[1.987,49.5651],[1.984,49.5838]]]},"60305":{"type":"Polygon","coordinates":[[[3.0769,49.3556],[3.0755,49.3557],[3.0751,49.349],[3.0736,49.349],[3.074,49.3481],[3.0689,49.3474],[3.0672,49.349],[3.0655,49.3488],[3.0605,49.3504],[3.0625,49.3565],[3.0565,49.3566],[3.0508,49.3584],[3.0495,49.3597],[3.0462,49.3604],[3.045,49.3632],[3.0373,49.3634],[3.0377,49.364],[3.0411,49.3636],[3.0424,49.3645],[3.0455,49.3642],[3.0459,49.3649],[3.0398,49.3655],[3.0406,49.368],[3.0464,49.3712],[3.0453,49.3727],[3.0567,49.3726],[3.0567,49.3747],[3.0669,49.3769],[3.0676,49.3762],[3.072,49.3761],[3.0729,49.3741],[3.0772,49.3751],[3.0777,49.3742],[3.0798,49.3748],[3.0804,49.374],[3.0771,49.3715],[3.0769,49.3556]]]},"60306":{"type":"Polygon","coordinates":[[[1.7875,49.5065],[1.7872,49.5061],[1.7838,49.5073],[1.7803,49.5099],[1.7775,49.5092],[1.7764,49.5104],[1.777,49.5108],[1.7715,49.5131],[1.7697,49.5132],[1.7682,49.5121],[1.7663,49.5133],[1.761,49.5134],[1.7586,49.5143],[1.7573,49.5162],[1.7548,49.5169],[1.7561,49.5177],[1.7546,49.5183],[1.755,49.5191],[1.7544,49.5194],[1.7561,49.5204],[1.7549,49.5218],[1.7665,49.5335],[1.7679,49.5328],[1.7766,49.5386],[1.7795,49.5385],[1.7868,49.5352],[1.7917,49.5352],[1.7983,49.5382],[1.7997,49.5366],[1.8011,49.5373],[1.8028,49.5365],[1.8048,49.5333],[1.8036,49.5331],[1.8017,49.5291],[1.7984,49.5273],[1.7994,49.5264],[1.7993,49.5252],[1.8023,49.5256],[1.8036,49.525],[1.7973,49.5227],[1.7966,49.52],[1.7956,49.5194],[1.7929,49.5183],[1.7922,49.5189],[1.7889,49.5169],[1.79,49.5166],[1.7882,49.5152],[1.7858,49.5078],[1.7875,49.5065]]]},"60307":{"type":"Polygon","coordinates":[[[2.2712,49.316],[2.2656,49.3194],[2.256,49.3235],[2.2603,49.3284],[2.2603,49.3296],[2.2571,49.3302],[2.2543,49.3289],[2.2537,49.3303],[2.2509,49.331],[2.2534,49.3376],[2.2535,49.3409],[2.2553,49.3416],[2.259,49.3466],[2.2619,49.3463],[2.2628,49.345],[2.2647,49.3457],[2.2672,49.345],[2.2709,49.3455],[2.2728,49.3444],[2.2753,49.3451],[2.2785,49.3437],[2.2807,49.3439],[2.2794,49.3434],[2.2797,49.3429],[2.2789,49.343],[2.2805,49.3413],[2.2811,49.3417],[2.282,49.3407],[2.2844,49.3418],[2.2872,49.3405],[2.2871,49.3396],[2.2902,49.3394],[2.2908,49.3378],[2.2919,49.3375],[2.2874,49.3344],[2.2876,49.3329],[2.2911,49.3318],[2.2899,49.3301],[2.2859,49.3275],[2.2845,49.329],[2.2824,49.3282],[2.2769,49.3232],[2.2777,49.3203],[2.2762,49.32],[2.2777,49.3192],[2.276,49.3176],[2.2712,49.316]]]},"60308":{"type":"Polygon","coordinates":[[[2.6543,49.4557],[2.6632,49.4715],[2.661,49.4723],[2.6627,49.4748],[2.6593,49.4769],[2.6603,49.4788],[2.6574,49.4795],[2.6608,49.4861],[2.6632,49.4883],[2.6646,49.4889],[2.6672,49.4871],[2.6685,49.4894],[2.6708,49.4898],[2.6729,49.4888],[2.6723,49.4877],[2.6908,49.4832],[2.692,49.4821],[2.6918,49.48],[2.6959,49.4762],[2.6946,49.4746],[2.6953,49.4737],[2.695,49.4728],[2.6889,49.4689],[2.6864,49.472],[2.6827,49.4742],[2.6794,49.4709],[2.6829,49.4693],[2.6808,49.4664],[2.6817,49.4662],[2.6813,49.4653],[2.6818,49.4653],[2.6808,49.463],[2.6859,49.4622],[2.6835,49.4606],[2.6795,49.4596],[2.6786,49.4603],[2.6737,49.4545],[2.6743,49.4536],[2.6707,49.4527],[2.667,49.4535],[2.6691,49.4562],[2.6669,49.456],[2.6644,49.4568],[2.662,49.4534],[2.6543,49.4557]]]},"60309":{"type":"Polygon","coordinates":[[[2.0382,49.1924],[2.037,49.1934],[2.0372,49.1952],[2.0394,49.2026],[2.0352,49.2038],[2.0359,49.2062],[2.0353,49.2062],[2.0336,49.2111],[2.035,49.2122],[2.0352,49.2135],[2.0382,49.2129],[2.0403,49.2141],[2.0399,49.2145],[2.041,49.2152],[2.0397,49.2165],[2.0414,49.2176],[2.042,49.2194],[2.0414,49.2202],[2.0432,49.2202],[2.0429,49.2193],[2.0443,49.2191],[2.0446,49.2217],[2.0526,49.2214],[2.0531,49.2236],[2.0561,49.2244],[2.0569,49.223],[2.0563,49.2209],[2.0619,49.219],[2.0739,49.2182],[2.0759,49.2195],[2.0768,49.2212],[2.0792,49.2204],[2.0802,49.2211],[2.083,49.2198],[2.082,49.2185],[2.0843,49.2174],[2.0823,49.2151],[2.0807,49.2107],[2.0773,49.2099],[2.0771,49.2087],[2.0748,49.2088],[2.0726,49.2062],[2.0725,49.2042],[2.0558,49.1989],[2.0473,49.1987],[2.047,49.1959],[2.0462,49.1964],[2.0382,49.1924]]]},"60310":{"type":"Polygon","coordinates":[[[1.99,49.4945],[1.9945,49.4918],[1.9968,49.4927],[2.0015,49.49],[2.0055,49.4906],[2.0086,49.4898],[2.0176,49.4896],[2.0193,49.4884],[2.0197,49.4869],[2.0187,49.4857],[2.0197,49.4855],[2.0206,49.4839],[2.0187,49.4838],[2.0195,49.4831],[2.0192,49.4824],[2.0217,49.4813],[2.0211,49.4796],[2.0241,49.4783],[2.0187,49.4757],[2.0099,49.4741],[2.0094,49.4726],[1.9929,49.4755],[1.9934,49.4778],[1.9895,49.4766],[1.9865,49.48],[1.988,49.4806],[1.986,49.4823],[1.9876,49.4839],[1.9838,49.4843],[1.985,49.4855],[1.9844,49.4863],[1.9849,49.4874],[1.9839,49.4879],[1.9848,49.489],[1.9842,49.4894],[1.9861,49.4913],[1.9876,49.4913],[1.9874,49.4921],[1.9891,49.4924],[1.99,49.4945]]]},"60311":{"type":"Polygon","coordinates":[[[2.4422,49.5995],[2.4399,49.597],[2.433,49.5924],[2.4284,49.5932],[2.4238,49.5895],[2.4275,49.5889],[2.4222,49.5836],[2.4206,49.5855],[2.4182,49.5849],[2.4184,49.5839],[2.4149,49.5854],[2.4091,49.5847],[2.4086,49.5838],[2.4055,49.5847],[2.4033,49.5863],[2.4029,49.5859],[2.3971,49.5898],[2.4049,49.5945],[2.4083,49.5921],[2.4096,49.5929],[2.4061,49.595],[2.4076,49.5954],[2.4101,49.5982],[2.4131,49.6029],[2.4246,49.6072],[2.4201,49.6117],[2.4189,49.611],[2.4181,49.6115],[2.4226,49.6135],[2.422,49.6142],[2.4252,49.615],[2.4294,49.6159],[2.4316,49.6116],[2.4366,49.6082],[2.4317,49.6066],[2.4376,49.6024],[2.4364,49.6004],[2.4422,49.5995]]]},"60312":{"type":"Polygon","coordinates":[[[1.7438,49.5825],[1.7496,49.5875],[1.7539,49.5889],[1.753,49.5896],[1.7626,49.5964],[1.7635,49.5955],[1.7662,49.5967],[1.7686,49.601],[1.7679,49.6013],[1.772,49.605],[1.7736,49.6045],[1.7699,49.6003],[1.7756,49.5975],[1.7733,49.5959],[1.7728,49.594],[1.7788,49.5959],[1.78,49.5952],[1.7759,49.5942],[1.7763,49.5937],[1.7733,49.5914],[1.7748,49.5906],[1.7755,49.5919],[1.7808,49.5927],[1.7843,49.5881],[1.775,49.5848],[1.7753,49.5823],[1.7726,49.5799],[1.77,49.5801],[1.7671,49.5778],[1.7659,49.5783],[1.7643,49.5772],[1.7607,49.5783],[1.7525,49.5735],[1.7485,49.5775],[1.7475,49.5773],[1.7447,49.5802],[1.7438,49.5825]]]},"60313":{"type":"Polygon","coordinates":[[[2.2661,49.3838],[2.2705,49.3863],[2.2721,49.3892],[2.274,49.3872],[2.277,49.3875],[2.2803,49.3713],[2.2773,49.3697],[2.2787,49.369],[2.2753,49.3648],[2.2742,49.3648],[2.2744,49.366],[2.2727,49.3651],[2.2721,49.3641],[2.2726,49.3608],[2.2701,49.3598],[2.2709,49.3595],[2.2705,49.3592],[2.2727,49.3556],[2.2724,49.3513],[2.273,49.3512],[2.2699,49.3453],[2.2647,49.3457],[2.2628,49.345],[2.2619,49.3463],[2.259,49.3466],[2.2553,49.3416],[2.2535,49.3409],[2.2534,49.3376],[2.2509,49.331],[2.2499,49.3315],[2.2474,49.3292],[2.2381,49.3331],[2.2356,49.3347],[2.2352,49.3376],[2.2323,49.3408],[2.2357,49.3466],[2.2371,49.3475],[2.2347,49.3488],[2.2354,49.3495],[2.2348,49.3504],[2.2379,49.35],[2.2385,49.3505],[2.2375,49.352],[2.2423,49.3541],[2.2393,49.3557],[2.2391,49.3567],[2.2406,49.3572],[2.2398,49.3595],[2.2387,49.3593],[2.2379,49.3622],[2.237,49.3621],[2.2369,49.3629],[2.2344,49.3626],[2.2351,49.3651],[2.2366,49.3649],[2.2385,49.3662],[2.237,49.3692],[2.2401,49.3664],[2.2413,49.3679],[2.2464,49.3702],[2.252,49.3739],[2.2584,49.3802],[2.2605,49.3812],[2.2651,49.3814],[2.2663,49.3825],[2.2661,49.3838]]]},"60314":{"type":"Polygon","coordinates":[[[2.0111,49.6325],[2.0144,49.6354],[2.014,49.6357],[2.0234,49.6392],[2.026,49.6409],[2.0346,49.6422],[2.033,49.6446],[2.0414,49.644],[2.0457,49.6445],[2.0455,49.6439],[2.051,49.6435],[2.0523,49.6409],[2.0543,49.6413],[2.0558,49.6402],[2.0568,49.6407],[2.0579,49.6397],[2.0587,49.64],[2.0594,49.6391],[2.0561,49.6381],[2.0591,49.6352],[2.0649,49.6383],[2.0661,49.6382],[2.0674,49.6363],[2.0661,49.6356],[2.0669,49.6347],[2.0704,49.636],[2.0726,49.6334],[2.0753,49.6346],[2.0761,49.6335],[2.0673,49.629],[2.0662,49.6296],[2.0526,49.6234],[2.045,49.6214],[2.0443,49.6227],[2.0355,49.6213],[2.0362,49.6199],[2.0327,49.62],[2.0331,49.6182],[2.0326,49.6176],[2.0332,49.6173],[2.0307,49.6176],[2.0301,49.6167],[2.0258,49.6179],[2.0259,49.6195],[2.0249,49.6203],[2.0239,49.6194],[2.017,49.6222],[2.0187,49.6264],[2.0216,49.6264],[2.0111,49.6325]]]},"60315":{"type":"Polygon","coordinates":[[[1.8877,49.4574],[1.889,49.4588],[1.8878,49.4594],[1.8859,49.4658],[1.8847,49.4673],[1.8881,49.4736],[1.8882,49.476],[1.8896,49.4786],[1.8919,49.4811],[1.8905,49.4831],[1.8912,49.4836],[1.8893,49.4843],[1.8925,49.4885],[1.8942,49.4875],[1.8951,49.488],[1.8976,49.4872],[1.8982,49.488],[1.9025,49.4876],[1.9081,49.4909],[1.9099,49.487],[1.9245,49.4865],[1.925,49.4855],[1.9269,49.4851],[1.9263,49.4845],[1.929,49.4797],[1.9336,49.4804],[1.9386,49.4788],[1.9317,49.4752],[1.932,49.4745],[1.9303,49.4739],[1.9295,49.4722],[1.9257,49.4721],[1.93,49.4691],[1.9326,49.4686],[1.9303,49.4637],[1.9354,49.4629],[1.9363,49.4615],[1.9361,49.4592],[1.9372,49.4576],[1.9363,49.4561],[1.9338,49.455],[1.9343,49.4525],[1.9312,49.4502],[1.927,49.4527],[1.9267,49.4546],[1.929,49.4596],[1.9273,49.4611],[1.927,49.4623],[1.9237,49.4635],[1.9179,49.4628],[1.9166,49.4614],[1.9131,49.4617],[1.9063,49.4584],[1.9074,49.4574],[1.9061,49.4568],[1.9071,49.4559],[1.9046,49.4551],[1.9003,49.455],[1.9002,49.4576],[1.9016,49.4594],[1.8974,49.4596],[1.8981,49.461],[1.8971,49.4605],[1.8955,49.4623],[1.8938,49.4616],[1.892,49.4625],[1.8913,49.4616],[1.8911,49.4592],[1.8929,49.4579],[1.8877,49.4574]]]},"60316":{"type":"Polygon","coordinates":[[[2.1224,49.3216],[2.1203,49.3231],[2.1193,49.3258],[2.1175,49.3266],[2.13,49.334],[2.128,49.3344],[2.1286,49.3362],[2.132,49.3358],[2.1332,49.3384],[2.1376,49.34],[2.1427,49.3446],[2.1432,49.3474],[2.1459,49.3482],[2.144,49.3493],[2.1455,49.3504],[2.1608,49.3406],[2.1594,49.3401],[2.1595,49.3385],[2.1609,49.3385],[2.1608,49.3365],[2.1626,49.3364],[2.1629,49.3346],[2.1616,49.3342],[2.1576,49.3341],[2.1571,49.335],[2.1498,49.3332],[2.1429,49.3326],[2.1428,49.3314],[2.1411,49.3318],[2.141,49.3311],[2.1337,49.3299],[2.1353,49.328],[2.1284,49.3262],[2.1224,49.3216]]]},"60317":{"type":"Polygon","coordinates":[[[2.2867,49.3407],[2.2872,49.3414],[2.2887,49.3409],[2.2902,49.3434],[2.2919,49.3427],[2.2939,49.3456],[2.2962,49.3461],[2.2982,49.3489],[2.2996,49.3491],[2.2983,49.3519],[2.3001,49.3537],[2.3,49.3587],[2.2999,49.3594],[2.2983,49.36],[2.2994,49.3619],[2.3024,49.3642],[2.3054,49.364],[2.3077,49.3677],[2.306,49.3645],[2.3057,49.3619],[2.307,49.3595],[2.3065,49.3592],[2.3132,49.3563],[2.3166,49.3533],[2.3222,49.3537],[2.323,49.3522],[2.324,49.3526],[2.3256,49.3497],[2.3284,49.3506],[2.3289,49.3495],[2.3293,49.3464],[2.3269,49.3462],[2.3256,49.3453],[2.3221,49.3403],[2.3198,49.3398],[2.319,49.3411],[2.3195,49.3428],[2.3181,49.342],[2.318,49.3399],[2.3202,49.3384],[2.3195,49.3376],[2.3213,49.3369],[2.3217,49.3349],[2.3162,49.3342],[2.3154,49.3323],[2.3167,49.3321],[2.3163,49.3307],[2.3193,49.3294],[2.3161,49.3271],[2.3174,49.3264],[2.3161,49.3256],[2.3128,49.3269],[2.3142,49.3274],[2.3122,49.328],[2.3135,49.329],[2.3127,49.3299],[2.3112,49.3289],[2.3111,49.33],[2.3076,49.3302],[2.3059,49.3318],[2.3034,49.3302],[2.2987,49.3327],[2.2912,49.3353],[2.2902,49.3359],[2.2919,49.3376],[2.2908,49.3378],[2.2902,49.3394],[2.2871,49.3396],[2.2867,49.3407]]]},"60318":{"type":"Polygon","coordinates":[[[2.6471,49.3566],[2.6533,49.361],[2.6557,49.3557],[2.6574,49.3407],[2.6596,49.3326],[2.659,49.3326],[2.6606,49.3309],[2.66,49.3285],[2.6624,49.3282],[2.6621,49.327],[2.6659,49.3264],[2.6656,49.3253],[2.6718,49.3245],[2.6761,49.3255],[2.6738,49.3233],[2.6722,49.3202],[2.6547,49.3231],[2.6477,49.3269],[2.6358,49.3278],[2.6296,49.3258],[2.6244,49.332],[2.6304,49.3325],[2.6335,49.3349],[2.6317,49.3357],[2.6326,49.3359],[2.6307,49.3418],[2.634,49.3418],[2.6321,49.3477],[2.6333,49.3479],[2.6321,49.348],[2.6319,49.3495],[2.6355,49.3521],[2.6427,49.3521],[2.6437,49.3545],[2.6471,49.3566]]]},"60319":{"type":"Polygon","coordinates":[[[1.9456,49.3393],[1.9401,49.3379],[1.9368,49.3385],[1.9367,49.3402],[1.9389,49.3429],[1.9374,49.3448],[1.9359,49.3495],[1.9306,49.3532],[1.9275,49.3565],[1.9262,49.3592],[1.9257,49.3619],[1.9283,49.3627],[1.9305,49.365],[1.9352,49.3677],[1.9386,49.3665],[1.9398,49.3652],[1.9433,49.3658],[1.9444,49.3678],[1.9464,49.3691],[1.9489,49.3669],[1.9542,49.3651],[1.9547,49.3639],[1.9559,49.3636],[1.9548,49.3626],[1.9559,49.362],[1.9655,49.3589],[1.9642,49.358],[1.9665,49.3565],[1.9655,49.356],[1.97,49.3545],[1.9787,49.3534],[1.9772,49.3503],[1.9704,49.3516],[1.9684,49.3496],[1.9707,49.3478],[1.9676,49.3442],[1.9577,49.3479],[1.9564,49.3467],[1.9553,49.3472],[1.9541,49.3461],[1.9527,49.3421],[1.9503,49.3406],[1.9456,49.3393]]]},"60320":{"type":"MultiPolygon","coordinates":[[[[3.0425,49.1846],[3.03,49.183],[3.0283,49.1859],[3.0257,49.1865],[3.0257,49.1874],[3.0269,49.1878],[3.0257,49.1892],[3.0261,49.1903],[3.0286,49.1905],[3.0261,49.193],[3.0174,49.1899],[3.0144,49.1866],[3.013,49.1871],[3.0135,49.1853],[3.0127,49.1846],[3.0089,49.1842],[3.0086,49.1854],[3.0054,49.1851],[3.0056,49.1862],[3.0037,49.1865],[3.0045,49.1869],[3.0044,49.1877],[3.0023,49.1881],[3.0034,49.1904],[3.0027,49.1918],[3.004,49.1918],[3.0033,49.1922],[3.0035,49.1935],[3.0001,49.1951],[3.0009,49.1955],[2.9999,49.1966],[3.0006,49.1978],[3.0,49.1995],[2.9974,49.1992],[2.9965,49.1999],[2.9973,49.2009],[3.0005,49.2007],[3.0013,49.202],[3.0031,49.2026],[3.0013,49.2039],[3.0024,49.2048],[3.0026,49.2063],[2.9944,49.2095],[3.0022,49.2144],[3.0149,49.2168],[3.0177,49.217],[3.0293,49.2138],[3.0318,49.212],[3.0348,49.2073],[3.0351,49.2058],[3.0334,49.2055],[3.0333,49.2043],[3.0315,49.2022],[3.0327,49.2004],[3.0346,49.2002],[3.035,49.1995],[3.0354,49.198],[3.0336,49.1973],[3.0379,49.1938],[3.038,49.1924],[3.0391,49.1916],[3.0388,49.1892],[3.0376,49.1891],[3.0376,49.1885],[3.0404,49.1876],[3.0402,49.1868],[3.0409,49.1867],[3.0402,49.1854],[3.0427,49.1852],[3.0425,49.1846]]],[[[2.989,49.1885],[2.9896,49.189],[2.9887,49.1903],[2.9902,49.1923],[2.9897,49.1925],[2.9929,49.1957],[2.9935,49.1954],[2.9917,49.1938],[2.9923,49.1929],[2.9948,49.1926],[2.9943,49.1895],[2.9972,49.1892],[2.997,49.1884],[2.9978,49.1882],[2.9966,49.1869],[2.989,49.1885]]],[[[2.9959,49.192],[2.9989,49.193],[2.999,49.1911],[3.0008,49.1908],[2.9998,49.1893],[2.999,49.1895],[2.9993,49.1901],[2.9966,49.1909],[2.9959,49.192]]]]},"60321":{"type":"Polygon","coordinates":[[[2.0224,49.2184],[2.0213,49.2231],[2.0158,49.2255],[2.012,49.2246],[2.0082,49.2254],[2.0079,49.2265],[2.0058,49.2268],[2.0031,49.2254],[1.9967,49.2238],[1.9896,49.2236],[1.9922,49.2273],[1.9922,49.2313],[1.9911,49.232],[1.9939,49.2322],[1.9918,49.2382],[1.9926,49.2396],[2.0027,49.2366],[2.0046,49.2396],[2.0026,49.2398],[2.0028,49.241],[2.009,49.2426],[2.0066,49.2463],[2.0131,49.2491],[2.015,49.2483],[2.0193,49.2486],[2.024,49.2477],[2.0235,49.2461],[2.0261,49.245],[2.0256,49.2436],[2.0292,49.2426],[2.0332,49.2427],[2.0354,49.2416],[2.0471,49.2404],[2.0496,49.2407],[2.0501,49.2414],[2.0513,49.2407],[2.063,49.2438],[2.0684,49.2411],[2.0637,49.2382],[2.0645,49.2362],[2.0678,49.2356],[2.066,49.2328],[2.0685,49.2326],[2.0685,49.2308],[2.0637,49.2256],[2.0601,49.2268],[2.0593,49.2259],[2.0556,49.2258],[2.0561,49.2244],[2.0531,49.2236],[2.0526,49.2214],[2.0446,49.2217],[2.0443,49.2191],[2.0429,49.2193],[2.0432,49.2202],[2.0414,49.2202],[2.042,49.2194],[2.0414,49.2176],[2.0397,49.2165],[2.041,49.2152],[2.0395,49.2135],[2.0369,49.2128],[2.0367,49.2136],[2.0289,49.2146],[2.0271,49.2158],[2.0271,49.2172],[2.0256,49.2189],[2.0224,49.2184]]]},"60322":{"type":"Polygon","coordinates":[[[1.8897,49.3111],[1.8926,49.3092],[1.8894,49.3031],[1.8882,49.303],[1.8889,49.3028],[1.8883,49.2998],[1.8831,49.2987],[1.8809,49.2963],[1.8781,49.2974],[1.877,49.2963],[1.8778,49.2951],[1.8743,49.2922],[1.868,49.2916],[1.8644,49.2893],[1.8563,49.2921],[1.8597,49.293],[1.8552,49.296],[1.8581,49.298],[1.8595,49.3014],[1.866,49.308],[1.8666,49.3073],[1.8737,49.3158],[1.8809,49.3135],[1.8819,49.3142],[1.8866,49.313],[1.8865,49.312],[1.8897,49.3111]]]},"60323":{"type":"Polygon","coordinates":[[[2.8653,49.4553],[2.8655,49.4527],[2.867,49.4501],[2.8662,49.4486],[2.8604,49.4479],[2.8581,49.4483],[2.857,49.451],[2.8571,49.4539],[2.8554,49.4539],[2.852,49.4518],[2.8505,49.4523],[2.8512,49.4533],[2.8488,49.4553],[2.8483,49.4566],[2.8497,49.4576],[2.8525,49.4565],[2.8544,49.458],[2.86,49.4585],[2.8612,49.4599],[2.8653,49.4553]]]},"60324":{"type":"Polygon","coordinates":[[[3.0353,49.3929],[3.036,49.394],[3.0435,49.3977],[3.0451,49.404],[3.0517,49.4037],[3.053,49.4045],[3.0616,49.399],[3.0826,49.3979],[3.0823,49.3945],[3.0809,49.3946],[3.0806,49.3938],[3.0812,49.3919],[3.0806,49.3907],[3.0793,49.3905],[3.0783,49.3881],[3.0765,49.3871],[3.0775,49.3867],[3.0772,49.3856],[3.0755,49.3837],[3.0772,49.3822],[3.0784,49.3828],[3.0796,49.382],[3.0752,49.3793],[3.0751,49.3772],[3.071,49.376],[3.0676,49.3762],[3.0669,49.3769],[3.0567,49.3747],[3.0567,49.3726],[3.0453,49.3727],[3.0448,49.3739],[3.0424,49.3748],[3.044,49.3804],[3.042,49.3812],[3.042,49.3841],[3.0436,49.384],[3.0439,49.3852],[3.046,49.385],[3.0468,49.3865],[3.0485,49.3863],[3.0484,49.3873],[3.0454,49.3886],[3.0444,49.388],[3.0445,49.3891],[3.0434,49.3897],[3.0417,49.389],[3.0393,49.3906],[3.0383,49.3924],[3.0353,49.3929]]]},"60325":{"type":"Polygon","coordinates":[[[2.751,49.4107],[2.7647,49.4131],[2.7697,49.4127],[2.7682,49.4103],[2.7697,49.4087],[2.7731,49.4095],[2.777,49.4069],[2.7791,49.4079],[2.7823,49.4058],[2.7841,49.4065],[2.7869,49.4043],[2.7891,49.4057],[2.7951,49.4035],[2.7834,49.3957],[2.7817,49.3905],[2.7767,49.3827],[2.7775,49.3784],[2.777,49.3764],[2.7701,49.3781],[2.769,49.3768],[2.7618,49.3777],[2.7573,49.3791],[2.7575,49.3803],[2.7559,49.3824],[2.7563,49.3828],[2.7538,49.3858],[2.7496,49.387],[2.7497,49.3881],[2.7471,49.3938],[2.7505,49.3966],[2.7486,49.3976],[2.7473,49.4026],[2.7458,49.4034],[2.7463,49.4036],[2.7455,49.4051],[2.751,49.4107]]]},"60326":{"type":"Polygon","coordinates":[[[2.7153,49.4054],[2.7235,49.4066],[2.7228,49.4079],[2.7309,49.4114],[2.7276,49.4136],[2.7351,49.4173],[2.7368,49.4202],[2.7376,49.4198],[2.7379,49.4204],[2.7419,49.4181],[2.7478,49.4169],[2.7509,49.4127],[2.751,49.4109],[2.7496,49.4086],[2.7455,49.405],[2.7463,49.4036],[2.7458,49.4034],[2.7473,49.4026],[2.7486,49.3976],[2.7505,49.3966],[2.7471,49.3938],[2.7499,49.3872],[2.747,49.3879],[2.7464,49.3867],[2.7436,49.3853],[2.7418,49.3854],[2.7399,49.3832],[2.7389,49.3835],[2.7375,49.3824],[2.7365,49.3829],[2.7338,49.3812],[2.7339,49.3803],[2.7277,49.3791],[2.7275,49.3804],[2.7228,49.3797],[2.7228,49.3871],[2.724,49.389],[2.7224,49.3912],[2.7156,49.3934],[2.7197,49.3961],[2.7222,49.3966],[2.7206,49.4],[2.7188,49.4],[2.7181,49.4024],[2.7159,49.4028],[2.7153,49.4054]]]},"60327":{"type":"Polygon","coordinates":[[[1.9278,49.3261],[1.9324,49.3282],[1.9303,49.3298],[1.931,49.3335],[1.9343,49.3323],[1.9359,49.3326],[1.936,49.3338],[1.9389,49.3341],[1.9456,49.3393],[1.9503,49.3406],[1.9527,49.3421],[1.9541,49.3461],[1.9553,49.3472],[1.9564,49.3467],[1.9577,49.3479],[1.9676,49.3442],[1.9645,49.3409],[1.9656,49.3409],[1.9649,49.3396],[1.9613,49.337],[1.9619,49.3344],[1.9606,49.3332],[1.9681,49.3309],[1.9695,49.3312],[1.9711,49.3328],[1.9773,49.3302],[1.9825,49.3304],[1.9834,49.3313],[1.9846,49.3298],[1.9894,49.3292],[1.9987,49.3262],[1.9891,49.3184],[1.9877,49.319],[1.9847,49.3151],[1.985,49.3138],[1.9838,49.3118],[1.9836,49.3093],[1.9825,49.308],[1.9826,49.307],[1.9774,49.3065],[1.9734,49.3051],[1.9724,49.303],[1.9709,49.3023],[1.967,49.3048],[1.9653,49.3043],[1.9554,49.2979],[1.9507,49.2992],[1.9557,49.3064],[1.9422,49.3146],[1.9352,49.3132],[1.9375,49.3185],[1.9402,49.3212],[1.9359,49.3234],[1.9347,49.3226],[1.9278,49.3261]]]},"60328":{"type":"Polygon","coordinates":[[[2.0709,49.537],[2.076,49.538],[2.0805,49.538],[2.0842,49.5355],[2.0936,49.5402],[2.0967,49.5399],[2.0977,49.5378],[2.1045,49.536],[2.1131,49.5305],[2.1082,49.5287],[2.1069,49.5273],[2.1062,49.5277],[2.1048,49.527],[2.1086,49.5247],[2.1076,49.5207],[2.1156,49.5133],[2.114,49.5109],[2.1038,49.5124],[2.102,49.5092],[2.0992,49.5099],[2.0999,49.5112],[2.095,49.5134],[2.0916,49.5095],[2.0899,49.5113],[2.0881,49.5078],[2.0841,49.5084],[2.0825,49.5042],[2.078,49.5059],[2.0811,49.5078],[2.0752,49.5117],[2.0769,49.5124],[2.0751,49.5132],[2.0784,49.5176],[2.0735,49.5188],[2.0749,49.5205],[2.0734,49.5212],[2.076,49.5251],[2.0736,49.526],[2.0747,49.5284],[2.0759,49.5289],[2.0676,49.5284],[2.0668,49.5321],[2.072,49.5355],[2.0709,49.537]]]},"60329":{"type":"Polygon","coordinates":[[[2.7489,49.5846],[2.7568,49.5864],[2.7595,49.5842],[2.7603,49.5816],[2.7636,49.5826],[2.7634,49.5838],[2.7659,49.5829],[2.7663,49.5836],[2.7704,49.5817],[2.7713,49.5825],[2.7742,49.5804],[2.7759,49.581],[2.7774,49.5796],[2.777,49.5775],[2.7781,49.5771],[2.7769,49.5747],[2.778,49.574],[2.778,49.5705],[2.7759,49.5673],[2.7547,49.564],[2.7559,49.566],[2.7536,49.5681],[2.7536,49.5698],[2.7549,49.5745],[2.756,49.5748],[2.757,49.5765],[2.7562,49.5776],[2.7457,49.5809],[2.7451,49.5829],[2.7489,49.5846]]]},"60330":{"type":"Polygon","coordinates":[[[2.1788,49.2869],[2.1782,49.283],[2.1797,49.2827],[2.1781,49.2755],[2.1737,49.2699],[2.171,49.2715],[2.1628,49.2729],[2.1614,49.2694],[2.1582,49.2746],[2.1524,49.2798],[2.1467,49.2785],[2.1468,49.2775],[2.1392,49.2761],[2.1355,49.2764],[2.1267,49.2784],[2.1292,49.2802],[2.1297,49.2818],[2.1292,49.2828],[2.1248,49.2815],[2.1224,49.2851],[2.1234,49.2867],[2.1236,49.2927],[2.1263,49.2968],[2.127,49.2997],[2.133,49.299],[2.1413,49.2995],[2.1487,49.2974],[2.1536,49.2945],[2.1609,49.296],[2.1689,49.3044],[2.1751,49.3023],[2.1741,49.2994],[2.1749,49.2991],[2.1733,49.2972],[2.1746,49.297],[2.1713,49.2932],[2.1709,49.29],[2.1788,49.2869]]]},"60331":{"type":"Polygon","coordinates":[[[1.8641,49.3663],[1.8853,49.3699],[1.8961,49.3696],[1.8975,49.3712],[1.9075,49.3749],[1.9138,49.372],[1.9142,49.3703],[1.922,49.37],[1.9225,49.3663],[1.9257,49.3619],[1.9275,49.3565],[1.9306,49.3532],[1.9334,49.3517],[1.9276,49.3493],[1.9183,49.3471],[1.9119,49.3432],[1.9062,49.3396],[1.9098,49.3371],[1.9139,49.3362],[1.9113,49.3332],[1.9073,49.3323],[1.9068,49.3344],[1.9043,49.3336],[1.9002,49.3296],[1.8923,49.3261],[1.8892,49.3281],[1.8904,49.3288],[1.8847,49.3335],[1.8873,49.3349],[1.8883,49.3397],[1.8871,49.3396],[1.8821,49.349],[1.8634,49.3544],[1.8662,49.3589],[1.8641,49.3663]]]},"60332":{"type":"Polygon","coordinates":[[[2.4901,49.3473],[2.4942,49.3541],[2.493,49.3549],[2.4943,49.3559],[2.4955,49.3552],[2.4972,49.3564],[2.4983,49.36],[2.5141,49.3605],[2.514,49.3555],[2.5167,49.3525],[2.5189,49.353],[2.521,49.3486],[2.523,49.3489],[2.5243,49.3438],[2.5119,49.3455],[2.5061,49.3471],[2.5065,49.3488],[2.5038,49.3499],[2.4988,49.3493],[2.4961,49.3501],[2.4932,49.3486],[2.4931,49.3469],[2.4901,49.3473]]]},"60333":{"type":"Polygon","coordinates":[[[1.9345,49.4527],[1.9363,49.4528],[1.9363,49.4537],[1.9383,49.4544],[1.9407,49.4531],[1.9404,49.4523],[1.9389,49.4521],[1.9404,49.4512],[1.9403,49.4496],[1.9436,49.4508],[1.9482,49.4502],[1.9513,49.4491],[1.9522,49.4473],[1.9554,49.4474],[1.9536,49.4431],[1.9544,49.4427],[1.9536,49.4418],[1.9545,49.4414],[1.949,49.44],[1.9493,49.4385],[1.948,49.4383],[1.9503,49.4361],[1.9495,49.4351],[1.9502,49.4341],[1.949,49.4328],[1.949,49.4319],[1.9462,49.4305],[1.9407,49.4302],[1.9388,49.4306],[1.9398,49.4317],[1.9391,49.432],[1.9338,49.4326],[1.9211,49.436],[1.9173,49.4395],[1.9144,49.441],[1.8971,49.4408],[1.891,49.4427],[1.8897,49.445],[1.8915,49.4453],[1.8922,49.4467],[1.8916,49.4468],[1.8926,49.4488],[1.8921,49.451],[1.8866,49.4564],[1.8877,49.4574],[1.8929,49.4579],[1.8911,49.4592],[1.892,49.4625],[1.8938,49.4616],[1.8955,49.4623],[1.8971,49.4605],[1.8981,49.461],[1.8974,49.4596],[1.9016,49.4594],[1.9,49.4559],[1.9012,49.4546],[1.9067,49.4557],[1.9061,49.4568],[1.9074,49.4574],[1.9063,49.4584],[1.9131,49.4617],[1.9166,49.4614],[1.9179,49.4628],[1.9237,49.4635],[1.927,49.4623],[1.9273,49.4611],[1.929,49.4596],[1.9267,49.4546],[1.927,49.4527],[1.9311,49.4502],[1.9345,49.4527]]]},"60334":{"type":"Polygon","coordinates":[[[2.2363,49.2548],[2.2339,49.2546],[2.232,49.2518],[2.2299,49.2514],[2.2256,49.2523],[2.2223,49.2545],[2.2208,49.2544],[2.22,49.2554],[2.2261,49.2568],[2.228,49.2615],[2.2217,49.2639],[2.2207,49.2656],[2.2232,49.2711],[2.2255,49.2723],[2.2306,49.2729],[2.2257,49.2776],[2.2265,49.2783],[2.226,49.2786],[2.2332,49.2799],[2.2327,49.2806],[2.2358,49.2826],[2.2385,49.2813],[2.2418,49.2812],[2.2414,49.2808],[2.2436,49.279],[2.2447,49.2794],[2.2458,49.2783],[2.2592,49.2716],[2.2535,49.269],[2.2494,49.2657],[2.2452,49.2674],[2.2434,49.2656],[2.2369,49.2674],[2.234,49.2609],[2.2342,49.2597],[2.2355,49.2588],[2.2363,49.2548]]]},"60335":{"type":"Polygon","coordinates":[[[1.858,49.5415],[1.8586,49.5427],[1.8597,49.5418],[1.8616,49.5437],[1.8635,49.5436],[1.8688,49.5461],[1.8702,49.5456],[1.8829,49.5602],[1.8866,49.5572],[1.8888,49.5591],[1.8967,49.5535],[1.898,49.5511],[1.8947,49.5496],[1.8953,49.5491],[1.8945,49.5485],[1.889,49.5471],[1.8854,49.5421],[1.8829,49.5421],[1.8801,49.5402],[1.8781,49.5379],[1.8784,49.5367],[1.8743,49.5326],[1.8751,49.5322],[1.8746,49.5317],[1.8776,49.5306],[1.8751,49.5283],[1.8746,49.5264],[1.8718,49.522],[1.8696,49.5225],[1.8689,49.521],[1.867,49.5213],[1.8653,49.5204],[1.8642,49.5209],[1.8636,49.5214],[1.8646,49.5219],[1.86,49.5266],[1.8621,49.5337],[1.8664,49.5348],[1.863,49.5352],[1.8655,49.5363],[1.8635,49.5378],[1.8629,49.5374],[1.8613,49.5385],[1.8602,49.538],[1.858,49.5415]]]},"60336":{"type":"Polygon","coordinates":[[[2.1514,49.5598],[2.1563,49.5669],[2.1526,49.5679],[2.1535,49.5689],[2.1625,49.5691],[2.1623,49.5701],[2.1637,49.5703],[2.1635,49.5717],[2.1656,49.5721],[2.1651,49.5733],[2.173,49.575],[2.1768,49.5743],[2.1772,49.5756],[2.183,49.5748],[2.1824,49.5738],[2.189,49.572],[2.1882,49.571],[2.1895,49.5699],[2.1897,49.5687],[2.1885,49.5684],[2.1898,49.5662],[2.1992,49.5614],[2.1974,49.5595],[2.1939,49.5607],[2.1922,49.5578],[2.1919,49.5532],[2.1906,49.5533],[2.1906,49.5513],[2.188,49.5512],[2.1896,49.5504],[2.1908,49.5477],[2.1892,49.5476],[2.1785,49.5522],[2.1772,49.5512],[2.1725,49.5548],[2.1686,49.5549],[2.1657,49.5559],[2.1656,49.557],[2.1586,49.5552],[2.1577,49.5587],[2.153,49.5587],[2.1514,49.5598]]]},"60337":{"type":"Polygon","coordinates":[[[2.751,49.4107],[2.7509,49.4127],[2.7481,49.4167],[2.7419,49.4181],[2.7379,49.4204],[2.7401,49.4249],[2.7391,49.4283],[2.7302,49.4303],[2.7283,49.4314],[2.7278,49.4329],[2.7254,49.4335],[2.7277,49.4348],[2.7268,49.439],[2.7276,49.4391],[2.7264,49.4419],[2.7244,49.4416],[2.7222,49.4469],[2.7264,49.451],[2.7316,49.4545],[2.7327,49.4536],[2.7366,49.456],[2.7392,49.4527],[2.7407,49.4539],[2.7421,49.4502],[2.75,49.4495],[2.7506,49.4476],[2.7536,49.4453],[2.7539,49.4432],[2.7604,49.4418],[2.7612,49.4372],[2.7652,49.4365],[2.7638,49.4413],[2.7651,49.4425],[2.7744,49.4396],[2.7727,49.4366],[2.7673,49.4313],[2.766,49.427],[2.7609,49.4194],[2.7574,49.4155],[2.7537,49.4129],[2.7537,49.411],[2.751,49.4107]]]},"60338":{"type":"Polygon","coordinates":[[[2.8413,49.3673],[2.8437,49.3491],[2.7577,49.3313],[2.7544,49.3287],[2.7526,49.3329],[2.7485,49.3359],[2.752,49.3397],[2.7575,49.3427],[2.7565,49.3439],[2.7617,49.346],[2.7656,49.35],[2.7671,49.3546],[2.7644,49.3612],[2.7755,49.3736],[2.7775,49.3775],[2.7767,49.3827],[2.7792,49.3862],[2.7827,49.3845],[2.7895,49.3831],[2.7919,49.3815],[2.7933,49.3821],[2.8063,49.3668],[2.8413,49.3673]]]},"60339":{"type":"MultiPolygon","coordinates":[[[[2.2035,49.5095],[2.207,49.5112],[2.2135,49.507],[2.2139,49.5081],[2.2179,49.5065],[2.2203,49.5083],[2.2312,49.4992],[2.2245,49.499],[2.2236,49.4912],[2.2214,49.4879],[2.2211,49.481],[2.2137,49.4803],[2.213,49.4777],[2.2063,49.4781],[2.2074,49.4796],[2.2044,49.4803],[2.2051,49.4811],[2.1979,49.4837],[2.1946,49.4871],[2.1967,49.4879],[2.1964,49.4933],[2.2018,49.4949],[2.1981,49.4997],[2.1996,49.5014],[2.2031,49.5028],[2.2013,49.505],[2.2062,49.5074],[2.2035,49.5095]]],[[[2.2182,49.5103],[2.2189,49.5109],[2.2223,49.5096],[2.2213,49.5091],[2.2182,49.5103]]]]},"60340":{"type":"Polygon","coordinates":[[[2.9309,49.6229],[2.9477,49.6128],[2.9345,49.6005],[2.9304,49.5985],[2.9246,49.5975],[2.9214,49.5956],[2.9105,49.5927],[2.9095,49.5955],[2.9087,49.5955],[2.9089,49.5966],[2.9079,49.5965],[2.9061,49.5985],[2.904,49.5983],[2.9046,49.5962],[2.9039,49.5958],[2.9035,49.5971],[2.897,49.5984],[2.8972,49.5996],[2.8961,49.6006],[2.8953,49.6004],[2.8928,49.602],[2.8935,49.6029],[2.8921,49.6027],[2.8912,49.601],[2.8897,49.6031],[2.8887,49.6027],[2.8875,49.6045],[2.8865,49.6047],[2.8865,49.6058],[2.8842,49.6059],[2.8837,49.6065],[2.8852,49.6101],[2.8828,49.6105],[2.8824,49.6172],[2.8851,49.6187],[2.8872,49.6157],[2.895,49.616],[2.8981,49.6171],[2.9046,49.6216],[2.9087,49.6226],[2.9108,49.6244],[2.9138,49.6255],[2.9151,49.625],[2.9157,49.6252],[2.9149,49.6259],[2.9178,49.6288],[2.9203,49.6291],[2.9309,49.6229]]]},"60341":{"type":"Polygon","coordinates":[[[2.7242,49.0807],[2.7255,49.0883],[2.7281,49.0938],[2.7353,49.1012],[2.741,49.097],[2.7513,49.0915],[2.7762,49.0793],[2.783,49.0776],[2.7873,49.0755],[2.7779,49.0703],[2.7744,49.0705],[2.766,49.0646],[2.754,49.0608],[2.7405,49.0611],[2.7346,49.0605],[2.7327,49.0641],[2.733,49.0673],[2.7317,49.0682],[2.7323,49.0705],[2.7306,49.0726],[2.7298,49.075],[2.7249,49.0756],[2.724,49.0782],[2.7242,49.0807]]]},"60342":{"type":"Polygon","coordinates":[[[2.4072,49.3032],[2.424,49.308],[2.4297,49.3089],[2.4376,49.3089],[2.4389,49.3099],[2.446,49.3106],[2.4463,49.3126],[2.4496,49.3139],[2.4538,49.3107],[2.4539,49.3087],[2.4567,49.3101],[2.4584,49.3003],[2.4558,49.2993],[2.4518,49.2959],[2.4511,49.2965],[2.4503,49.296],[2.4496,49.2947],[2.4523,49.2928],[2.4523,49.2915],[2.4541,49.2913],[2.4548,49.2902],[2.4572,49.2892],[2.4489,49.2838],[2.4479,49.2849],[2.4433,49.2809],[2.4397,49.2827],[2.4382,49.2822],[2.4352,49.2846],[2.4338,49.2848],[2.4318,49.2838],[2.4309,49.2839],[2.4313,49.2846],[2.4286,49.2852],[2.4232,49.2851],[2.4164,49.2879],[2.4159,49.2883],[2.4168,49.2893],[2.4128,49.2908],[2.4131,49.2915],[2.411,49.2917],[2.4087,49.2962],[2.4111,49.2967],[2.4114,49.3008],[2.4072,49.3032]]]},"60343":{"type":"Polygon","coordinates":[[[1.7801,49.3769],[1.7761,49.3794],[1.776,49.3801],[1.771,49.3788],[1.7682,49.3792],[1.7642,49.3771],[1.7613,49.3785],[1.7651,49.3846],[1.7674,49.3903],[1.768,49.3953],[1.7689,49.3961],[1.7703,49.3971],[1.7718,49.3968],[1.7731,49.3991],[1.7777,49.3972],[1.7836,49.3995],[1.7872,49.4002],[1.7873,49.3996],[1.7914,49.3995],[1.7988,49.4017],[1.805,49.4022],[1.8074,49.4008],[1.8064,49.3987],[1.8079,49.3982],[1.8068,49.3965],[1.8075,49.3961],[1.8064,49.3946],[1.8013,49.3913],[1.8027,49.3912],[1.8016,49.3873],[1.7997,49.3846],[1.7983,49.3842],[1.796,49.3803],[1.7954,49.3773],[1.791,49.3801],[1.7864,49.3793],[1.7801,49.3769]]]},"60344":{"type":"Polygon","coordinates":[[[1.8853,49.3699],[1.8641,49.3663],[1.859,49.3703],[1.8531,49.373],[1.8474,49.374],[1.838,49.3791],[1.8457,49.3813],[1.8483,49.3827],[1.8511,49.3825],[1.8541,49.3834],[1.8552,49.3851],[1.8599,49.3876],[1.8632,49.3914],[1.8611,49.3936],[1.8608,49.3964],[1.8571,49.3997],[1.8647,49.4064],[1.8642,49.4068],[1.8674,49.4086],[1.8772,49.4092],[1.8972,49.402],[1.8926,49.3985],[1.8975,49.3993],[1.9001,49.3978],[1.8923,49.3846],[1.8875,49.3858],[1.8858,49.3811],[1.8853,49.3699]]]},"60345":{"type":"Polygon","coordinates":[[[2.4576,49.437],[2.4601,49.4404],[2.464,49.4401],[2.4637,49.4385],[2.4738,49.4375],[2.4733,49.4366],[2.4819,49.4373],[2.4813,49.4362],[2.4824,49.4343],[2.4818,49.4304],[2.4783,49.4204],[2.4634,49.425],[2.4443,49.4254],[2.4437,49.426],[2.4422,49.4254],[2.4417,49.4258],[2.4441,49.4266],[2.4463,49.4295],[2.4453,49.4311],[2.4507,49.4292],[2.4554,49.4336],[2.4576,49.437]]]},"60346":{"type":"Polygon","coordinates":[[[2.4408,49.1459],[2.4277,49.1491],[2.4155,49.1499],[2.4156,49.1518],[2.4131,49.1524],[2.4043,49.1519],[2.3912,49.1493],[2.3808,49.1579],[2.3733,49.1594],[2.3713,49.1618],[2.3735,49.1625],[2.3709,49.1634],[2.371,49.166],[2.3695,49.1663],[2.3715,49.1688],[2.3725,49.1689],[2.3727,49.1712],[2.3746,49.1728],[2.3741,49.1731],[2.375,49.1762],[2.3786,49.1749],[2.3798,49.1733],[2.4338,49.1706],[2.434,49.1697],[2.4371,49.1712],[2.4426,49.1701],[2.4483,49.1665],[2.448,49.1654],[2.4513,49.1633],[2.4538,49.1599],[2.4592,49.1566],[2.4615,49.1582],[2.463,49.1625],[2.4627,49.1633],[2.4829,49.158],[2.4721,49.1553],[2.4677,49.1529],[2.4675,49.1514],[2.4638,49.1502],[2.4615,49.1505],[2.4555,49.1494],[2.4546,49.149],[2.4551,49.1478],[2.449,49.1471],[2.4474,49.1457],[2.4477,49.1446],[2.4408,49.1459]]]},"60347":{"type":"Polygon","coordinates":[[[1.745,49.6982],[1.7432,49.7],[1.7435,49.7024],[1.7333,49.6991],[1.7239,49.6938],[1.7201,49.6895],[1.7178,49.6847],[1.7163,49.6835],[1.7135,49.6824],[1.7052,49.6813],[1.702,49.6854],[1.6955,49.6906],[1.6904,49.694],[1.6889,49.6939],[1.6889,49.6953],[1.6925,49.6967],[1.7018,49.7028],[1.7055,49.7073],[1.7127,49.705],[1.7155,49.7098],[1.7148,49.7138],[1.7224,49.7158],[1.7263,49.7142],[1.7264,49.7129],[1.7277,49.713],[1.7285,49.7118],[1.7349,49.7151],[1.7345,49.7162],[1.7416,49.7216],[1.7417,49.7226],[1.7479,49.7257],[1.7466,49.7273],[1.7486,49.7284],[1.7433,49.7323],[1.7448,49.733],[1.7427,49.7346],[1.7429,49.7384],[1.7459,49.7387],[1.7506,49.7365],[1.7576,49.7376],[1.7644,49.7363],[1.7641,49.7352],[1.7652,49.7353],[1.764,49.7325],[1.7677,49.7316],[1.7672,49.7303],[1.7679,49.7295],[1.7656,49.7287],[1.7675,49.7272],[1.7684,49.7274],[1.7707,49.7242],[1.7696,49.7226],[1.7709,49.722],[1.7704,49.7175],[1.7727,49.7164],[1.7697,49.7132],[1.7713,49.7102],[1.7673,49.7073],[1.7564,49.7015],[1.75,49.7003],[1.745,49.6982]]]},"60348":{"type":"Polygon","coordinates":[[[2.9713,49.5781],[2.9703,49.5762],[2.9714,49.5731],[2.9711,49.5705],[2.9697,49.568],[2.9695,49.566],[2.9674,49.5654],[2.9598,49.5635],[2.953,49.5628],[2.9468,49.5709],[2.9555,49.5718],[2.9525,49.5744],[2.9548,49.576],[2.9554,49.5777],[2.9595,49.5789],[2.9589,49.5797],[2.9612,49.5788],[2.9686,49.5788],[2.9713,49.5781]]]},"60350":{"type":"Polygon","coordinates":[[[2.8522,49.6245],[2.8536,49.6241],[2.8532,49.6225],[2.8565,49.6223],[2.8671,49.6148],[2.8691,49.6159],[2.8721,49.6145],[2.875,49.6183],[2.8781,49.6167],[2.876,49.6128],[2.8774,49.6106],[2.8643,49.608],[2.8692,49.6042],[2.8685,49.6033],[2.8694,49.6029],[2.8666,49.6012],[2.8674,49.6008],[2.8658,49.5999],[2.8668,49.5996],[2.8643,49.5981],[2.8719,49.5971],[2.8676,49.5933],[2.8679,49.5911],[2.8697,49.5901],[2.8671,49.5878],[2.8674,49.5873],[2.8626,49.5841],[2.8632,49.5839],[2.8625,49.5827],[2.8634,49.5821],[2.862,49.581],[2.8597,49.5814],[2.8573,49.5799],[2.8578,49.5789],[2.8562,49.5792],[2.8542,49.5756],[2.8523,49.5745],[2.848,49.5759],[2.8438,49.5733],[2.8377,49.5757],[2.8383,49.5767],[2.8356,49.5778],[2.8358,49.5806],[2.8351,49.5813],[2.8357,49.5824],[2.82,49.584],[2.8119,49.5899],[2.8164,49.5933],[2.8175,49.593],[2.8193,49.5949],[2.8067,49.5956],[2.8084,49.5979],[2.8069,49.5985],[2.8079,49.6012],[2.8099,49.6015],[2.8082,49.6034],[2.8234,49.6022],[2.8207,49.6046],[2.8263,49.609],[2.8158,49.6164],[2.8197,49.6183],[2.8252,49.6192],[2.8282,49.6181],[2.8342,49.6176],[2.8402,49.6184],[2.8462,49.6221],[2.8454,49.6261],[2.8522,49.6245]]]},"60351":{"type":"Polygon","coordinates":[[[2.6564,49.5458],[2.6569,49.5512],[2.6551,49.5511],[2.6564,49.553],[2.6537,49.553],[2.657,49.5573],[2.6676,49.5573],[2.669,49.5531],[2.6739,49.554],[2.6761,49.5476],[2.6831,49.5493],[2.6872,49.5469],[2.6882,49.5477],[2.6911,49.5461],[2.6928,49.5464],[2.6943,49.5444],[2.6964,49.5437],[2.6902,49.5376],[2.6917,49.5334],[2.6981,49.5318],[2.6968,49.5296],[2.6853,49.5302],[2.6837,49.5274],[2.6796,49.5287],[2.6788,49.5239],[2.6806,49.5217],[2.6795,49.5215],[2.6812,49.5153],[2.6752,49.5131],[2.6715,49.514],[2.671,49.5148],[2.666,49.5142],[2.6629,49.5172],[2.6635,49.5187],[2.6597,49.5192],[2.6585,49.5208],[2.6636,49.522],[2.6675,49.5256],[2.6653,49.5273],[2.6659,49.5289],[2.6637,49.5296],[2.6645,49.5315],[2.6699,49.5302],[2.671,49.5331],[2.6675,49.5342],[2.6691,49.5367],[2.6667,49.5367],[2.667,49.5405],[2.6632,49.5404],[2.6635,49.5455],[2.6564,49.5458]]]},"60352":{"type":"Polygon","coordinates":[[[1.7903,49.2468],[1.7955,49.2452],[1.8032,49.2452],[1.8149,49.2512],[1.8185,49.2512],[1.8218,49.2488],[1.8236,49.2496],[1.8256,49.248],[1.8245,49.2455],[1.8236,49.2454],[1.8237,49.244],[1.8213,49.2436],[1.8219,49.2425],[1.8202,49.2415],[1.8234,49.2393],[1.8175,49.2361],[1.8185,49.2356],[1.8166,49.2342],[1.8147,49.2339],[1.8135,49.2301],[1.812,49.2296],[1.808,49.2313],[1.8048,49.2307],[1.7999,49.2362],[1.7985,49.2356],[1.7951,49.2361],[1.791,49.2434],[1.7903,49.2468]]]},"60353":{"type":"Polygon","coordinates":[[[2.1257,49.6835],[2.1227,49.6829],[2.1227,49.6807],[2.1261,49.6797],[2.1258,49.6786],[2.1272,49.6784],[2.1226,49.6754],[2.1231,49.6747],[2.1215,49.6748],[2.1183,49.6717],[2.1151,49.6711],[2.106,49.672],[2.1052,49.6714],[2.1057,49.6699],[2.111,49.6661],[2.111,49.6655],[2.1092,49.6655],[2.1092,49.6639],[2.0936,49.6651],[2.0896,49.6716],[2.0855,49.6707],[2.0852,49.6712],[2.0824,49.6711],[2.0786,49.6744],[2.0749,49.6803],[2.0731,49.6818],[2.0765,49.6831],[2.0879,49.6903],[2.1033,49.6948],[2.1157,49.6929],[2.1188,49.6894],[2.1216,49.688],[2.1242,49.6879],[2.1257,49.6835]]]},"60354":{"type":"Polygon","coordinates":[[[2.03,49.6881],[2.0281,49.6847],[2.026,49.6848],[2.0271,49.6806],[2.012,49.6773],[2.0037,49.6786],[1.9886,49.6889],[1.9968,49.6925],[2.0042,49.6936],[2.0158,49.6928],[2.0232,49.6935],[2.0271,49.6893],[2.03,49.6881]]]},"60355":{"type":"Polygon","coordinates":[[[2.232,49.4371],[2.2326,49.4355],[2.2286,49.4355],[2.228,49.4311],[2.224,49.4256],[2.2245,49.4256],[2.2237,49.4213],[2.2208,49.4218],[2.22,49.4195],[2.2194,49.4196],[2.2168,49.4109],[2.2179,49.4109],[2.219,49.4094],[2.2175,49.408],[2.2167,49.4047],[2.2156,49.4035],[2.2134,49.4045],[2.2139,49.4075],[2.2099,49.4092],[2.2061,49.4051],[2.1949,49.4093],[2.1971,49.4125],[2.1942,49.4127],[2.1939,49.416],[2.192,49.4162],[2.1919,49.4177],[2.1823,49.4208],[2.1833,49.4219],[2.1788,49.4233],[2.1795,49.4243],[2.1741,49.4257],[2.1736,49.4251],[2.1701,49.4265],[2.1706,49.4269],[2.1661,49.4292],[2.1665,49.43],[2.1643,49.4303],[2.1643,49.4321],[2.1537,49.4321],[2.1534,49.4333],[2.1534,49.4351],[2.159,49.4355],[2.1766,49.4349],[2.1777,49.4414],[2.2034,49.4475],[2.2096,49.4469],[2.2257,49.4476],[2.226,49.4466],[2.2246,49.4463],[2.2292,49.4406],[2.2299,49.4385],[2.2323,49.4377],[2.232,49.4371]]]},"60356":{"type":"Polygon","coordinates":[[[1.9289,49.2132],[1.9449,49.2076],[1.9486,49.209],[1.9502,49.2079],[1.9593,49.1992],[1.9599,49.1958],[1.9612,49.1934],[1.9663,49.1927],[1.9646,49.1917],[1.9653,49.1904],[1.9616,49.1871],[1.9661,49.1868],[1.9674,49.1856],[1.9701,49.1858],[1.9736,49.1839],[1.9733,49.1831],[1.96,49.1735],[1.9497,49.1705],[1.9453,49.1715],[1.9423,49.17],[1.9394,49.1707],[1.9354,49.1696],[1.9346,49.1705],[1.9344,49.1745],[1.9312,49.177],[1.932,49.1793],[1.9301,49.1795],[1.9294,49.1782],[1.9287,49.1784],[1.9283,49.1757],[1.9259,49.1748],[1.9228,49.1752],[1.9179,49.1789],[1.9124,49.1787],[1.9103,49.1777],[1.9029,49.182],[1.9003,49.1846],[1.8991,49.1839],[1.8968,49.1853],[1.8951,49.1842],[1.8907,49.1872],[1.8961,49.1906],[1.8954,49.1907],[1.9004,49.1956],[1.9023,49.1956],[1.9098,49.1925],[1.9104,49.1932],[1.908,49.194],[1.9155,49.2075],[1.9174,49.2082],[1.9156,49.2098],[1.9193,49.2122],[1.9213,49.2095],[1.9264,49.2128],[1.9277,49.2117],[1.9289,49.2132]]]},"60357":{"type":"Polygon","coordinates":[[[2.5263,49.4814],[2.5241,49.4863],[2.5199,49.4887],[2.517,49.4875],[2.5154,49.4898],[2.5175,49.49],[2.5141,49.4949],[2.5121,49.4948],[2.5104,49.4972],[2.5086,49.4974],[2.5077,49.4984],[2.5123,49.503],[2.5168,49.5034],[2.5176,49.5082],[2.5206,49.5078],[2.5219,49.5104],[2.5199,49.5117],[2.5225,49.5134],[2.5259,49.5146],[2.5292,49.5139],[2.5335,49.5151],[2.5445,49.5151],[2.5452,49.514],[2.5442,49.5136],[2.544,49.5101],[2.5464,49.5093],[2.5478,49.5105],[2.5499,49.5094],[2.546,49.5059],[2.5494,49.5054],[2.5496,49.5012],[2.5505,49.5013],[2.5506,49.4955],[2.5523,49.4952],[2.55,49.4927],[2.554,49.4912],[2.5481,49.4867],[2.5449,49.4879],[2.5423,49.4875],[2.5337,49.484],[2.5303,49.4816],[2.5263,49.4814]]]},"60358":{"type":"Polygon","coordinates":[[[2.9084,49.175],[2.908,49.1757],[2.9066,49.1756],[2.9032,49.1801],[2.8965,49.1818],[2.8934,49.1835],[2.8921,49.1832],[2.893,49.1836],[2.8911,49.1848],[2.8938,49.1836],[2.8933,49.1853],[2.8868,49.188],[2.8796,49.1883],[2.8786,49.1943],[2.8735,49.1956],[2.8737,49.1961],[2.8825,49.1967],[2.883,49.1957],[2.8965,49.1986],[2.8978,49.2015],[2.8996,49.2019],[2.8992,49.2048],[2.9009,49.2077],[2.9008,49.2107],[2.9026,49.2109],[2.901,49.2132],[2.9028,49.2134],[2.9038,49.2144],[2.9112,49.2131],[2.9153,49.2152],[2.9146,49.2157],[2.9156,49.2161],[2.9166,49.2155],[2.9179,49.2159],[2.9189,49.2172],[2.9246,49.2203],[2.9293,49.2164],[2.9318,49.2162],[2.9327,49.215],[2.9362,49.2151],[2.9373,49.2145],[2.937,49.214],[2.9394,49.2133],[2.9403,49.2111],[2.9388,49.2101],[2.9431,49.208],[2.9481,49.2075],[2.9487,49.2066],[2.952,49.2055],[2.9527,49.2034],[2.9397,49.1993],[2.9423,49.1972],[2.9403,49.1964],[2.9415,49.1964],[2.9416,49.1912],[2.9383,49.1871],[2.9307,49.1858],[2.9278,49.1845],[2.9276,49.1858],[2.9151,49.1756],[2.9084,49.175]]]},"60359":{"type":"Polygon","coordinates":[[[1.9453,49.4817],[1.9386,49.4788],[1.9336,49.4804],[1.929,49.4797],[1.9263,49.4845],[1.9269,49.4851],[1.925,49.4855],[1.9245,49.4865],[1.9152,49.4863],[1.9099,49.487],[1.9095,49.4879],[1.9141,49.4927],[1.9167,49.4916],[1.9185,49.4937],[1.9215,49.4926],[1.9229,49.4942],[1.9259,49.4951],[1.927,49.4958],[1.9264,49.498],[1.9288,49.4976],[1.93,49.494],[1.9356,49.4951],[1.9355,49.4945],[1.943,49.4949],[1.9429,49.4922],[1.9469,49.4891],[1.9456,49.4883],[1.9435,49.4891],[1.9414,49.4887],[1.9391,49.4903],[1.9381,49.489],[1.9398,49.4864],[1.9409,49.4864],[1.9415,49.4852],[1.9407,49.4851],[1.941,49.4834],[1.9453,49.4817]]]},"60360":{"type":"Polygon","coordinates":[[[2.4489,49.3243],[2.4449,49.331],[2.4454,49.332],[2.4448,49.333],[2.4463,49.3343],[2.4559,49.3373],[2.4566,49.3344],[2.459,49.3345],[2.4666,49.3373],[2.4673,49.3391],[2.4689,49.339],[2.479,49.3425],[2.4798,49.3418],[2.4834,49.3437],[2.4863,49.3421],[2.4805,49.3334],[2.4813,49.3329],[2.4799,49.3263],[2.477,49.324],[2.4743,49.3238],[2.4727,49.3254],[2.4692,49.3234],[2.4665,49.3211],[2.4668,49.3207],[2.4652,49.3207],[2.4643,49.32],[2.4647,49.3195],[2.4549,49.3156],[2.4489,49.3243]]]},"60361":{"type":"Polygon","coordinates":[[[1.8927,49.216],[1.8964,49.2229],[1.8924,49.2252],[1.888,49.2265],[1.8861,49.2389],[1.8788,49.2404],[1.8801,49.2429],[1.8748,49.245],[1.8757,49.2486],[1.8837,49.2553],[1.8843,49.2548],[1.8859,49.2558],[1.8843,49.2573],[1.8877,49.2584],[1.8887,49.2599],[1.8904,49.2562],[1.8932,49.2537],[1.895,49.2546],[1.8995,49.2501],[1.9082,49.2466],[1.9187,49.2436],[1.9177,49.2419],[1.9325,49.2369],[1.9305,49.2353],[1.9359,49.2327],[1.9326,49.2242],[1.9319,49.2242],[1.9324,49.2238],[1.9291,49.2139],[1.9277,49.2117],[1.9264,49.2128],[1.9213,49.2095],[1.9193,49.2122],[1.9169,49.2107],[1.909,49.2137],[1.9053,49.2141],[1.8993,49.2167],[1.8971,49.2144],[1.8927,49.216]]]},"60362":{"type":"Polygon","coordinates":[[[2.9858,49.6693],[2.9831,49.6684],[2.9777,49.6684],[2.9776,49.6655],[2.9717,49.6639],[2.9709,49.6681],[2.9718,49.6709],[2.9708,49.6739],[2.9642,49.6731],[2.9634,49.6724],[2.9606,49.6765],[2.9496,49.6808],[2.9479,49.6824],[2.9505,49.6839],[2.9497,49.6848],[2.9508,49.6851],[2.9493,49.6862],[2.9497,49.69],[2.9485,49.6942],[2.9619,49.6934],[2.9658,49.6958],[2.9738,49.6973],[2.9764,49.6994],[2.9753,49.7026],[2.9773,49.7057],[2.9827,49.7041],[2.9914,49.7041],[2.9893,49.7053],[2.9894,49.7084],[2.997,49.7077],[2.9969,49.7066],[2.998,49.7066],[2.9976,49.706],[3.0011,49.704],[3.0014,49.703],[3.005,49.7031],[3.0057,49.7001],[3.0049,49.6958],[3.0058,49.6934],[3.0078,49.6936],[3.0071,49.6904],[3.0101,49.6854],[3.0066,49.6833],[3.0023,49.6786],[2.9973,49.6787],[2.9911,49.6836],[2.9878,49.6843],[2.9874,49.6835],[2.9884,49.6833],[2.9867,49.6795],[2.9852,49.6788],[2.9841,49.6743],[2.9841,49.6729],[2.9858,49.6693]]]},"60363":{"type":"Polygon","coordinates":[[[1.8735,49.1741],[1.8765,49.1796],[1.8671,49.1857],[1.8711,49.1863],[1.8722,49.1921],[1.8715,49.1943],[1.8733,49.1941],[1.8757,49.1973],[1.8776,49.1961],[1.8805,49.2026],[1.8809,49.2064],[1.8828,49.2071],[1.8843,49.2064],[1.8865,49.2079],[1.8906,49.2116],[1.8927,49.216],[1.8971,49.2144],[1.8993,49.2167],[1.9053,49.2141],[1.909,49.2137],[1.9169,49.2107],[1.9156,49.2093],[1.9174,49.2082],[1.9155,49.2075],[1.908,49.194],[1.9104,49.1932],[1.9098,49.1925],[1.9023,49.1956],[1.9004,49.1956],[1.8954,49.1907],[1.8961,49.1906],[1.8907,49.1872],[1.895,49.1841],[1.8843,49.1799],[1.8844,49.1786],[1.8735,49.1741]]]},"60364":{"type":"Polygon","coordinates":[[[2.4643,49.4913],[2.4721,49.4951],[2.4822,49.4839],[2.4848,49.4793],[2.4939,49.4774],[2.495,49.4792],[2.5013,49.4779],[2.5018,49.482],[2.5141,49.4815],[2.5145,49.4772],[2.526,49.4792],[2.5294,49.4774],[2.5241,49.4737],[2.527,49.4721],[2.5266,49.4688],[2.5285,49.467],[2.5143,49.4614],[2.5126,49.4626],[2.4974,49.4647],[2.4949,49.4663],[2.4936,49.4655],[2.4918,49.4677],[2.4913,49.4669],[2.4886,49.4673],[2.4879,49.4655],[2.483,49.4672],[2.4802,49.4664],[2.4742,49.4668],[2.4689,49.4647],[2.4684,49.4654],[2.4658,49.465],[2.466,49.4634],[2.4641,49.4636],[2.4643,49.4645],[2.4534,49.4661],[2.4519,49.4653],[2.4507,49.4667],[2.4525,49.467],[2.4536,49.4699],[2.4574,49.4712],[2.4557,49.4721],[2.4607,49.4746],[2.46,49.4754],[2.4624,49.4755],[2.4659,49.4785],[2.4659,49.4807],[2.4687,49.4876],[2.4643,49.4913]]]},"60365":{"type":"Polygon","coordinates":[[[2.041,49.5805],[2.0362,49.5825],[2.0366,49.5849],[2.034,49.5845],[2.0235,49.5878],[2.022,49.5892],[2.0183,49.5905],[2.0179,49.5914],[2.0142,49.5927],[2.0133,49.5963],[2.0106,49.6004],[2.0076,49.5999],[2.0018,49.6074],[2.0042,49.607],[2.0042,49.6104],[2.0066,49.6148],[2.0141,49.6183],[2.0194,49.6185],[2.0217,49.6204],[2.0239,49.6194],[2.0249,49.6203],[2.0259,49.6195],[2.0258,49.6179],[2.027,49.6175],[2.0301,49.6167],[2.0307,49.6176],[2.0332,49.6173],[2.0326,49.6176],[2.0331,49.6182],[2.0327,49.62],[2.0362,49.6199],[2.0355,49.6213],[2.0443,49.6227],[2.045,49.6214],[2.0497,49.6225],[2.0579,49.6253],[2.0635,49.6285],[2.0668,49.6294],[2.0689,49.6266],[2.0721,49.6186],[2.0687,49.6193],[2.0618,49.6106],[2.0631,49.6101],[2.0616,49.6085],[2.0664,49.6058],[2.0647,49.6046],[2.0677,49.6031],[2.0659,49.6008],[2.0664,49.6004],[2.0653,49.6],[2.0661,49.5993],[2.0643,49.5985],[2.0632,49.599],[2.056,49.5897],[2.0548,49.5859],[2.0562,49.5835],[2.0486,49.5811],[2.041,49.5805]]]},"60366":{"type":"Polygon","coordinates":[[[2.2997,49.4301],[2.3025,49.4314],[2.3032,49.431],[2.307,49.4336],[2.3035,49.4352],[2.3112,49.4464],[2.3167,49.4434],[2.3208,49.4456],[2.3209,49.4464],[2.3249,49.4467],[2.3249,49.4457],[2.3319,49.4457],[2.3316,49.4472],[2.3302,49.4478],[2.3305,49.4484],[2.3327,49.4479],[2.3373,49.4456],[2.3382,49.4438],[2.3342,49.4398],[2.335,49.4366],[2.3325,49.435],[2.3367,49.4355],[2.3391,49.4334],[2.3322,49.43],[2.3319,49.4262],[2.335,49.426],[2.336,49.4269],[2.3414,49.4261],[2.3399,49.424],[2.3401,49.4213],[2.343,49.4189],[2.3502,49.419],[2.3572,49.4149],[2.3531,49.4159],[2.3517,49.415],[2.3459,49.4156],[2.3475,49.4146],[2.3474,49.4122],[2.3489,49.4112],[2.3487,49.4106],[2.3478,49.4107],[2.347,49.4092],[2.3402,49.4077],[2.3359,49.4086],[2.335,49.4072],[2.3315,49.4085],[2.3258,49.4084],[2.3182,49.4101],[2.3163,49.4111],[2.3164,49.414],[2.3035,49.4166],[2.3029,49.4224],[2.2997,49.4301]]]},"60367":{"type":"Polygon","coordinates":[[[1.9187,49.2436],[1.9082,49.2466],[1.8995,49.2501],[1.895,49.2546],[1.8961,49.2551],[1.8942,49.2566],[1.9007,49.2593],[1.904,49.2624],[1.9065,49.2632],[1.91,49.2627],[1.9131,49.2646],[1.9125,49.2652],[1.9135,49.2658],[1.9143,49.2652],[1.9176,49.2674],[1.9188,49.267],[1.9203,49.2677],[1.9194,49.269],[1.9224,49.2692],[1.9232,49.2706],[1.9275,49.2701],[1.9268,49.2671],[1.9283,49.2656],[1.931,49.2663],[1.9325,49.2656],[1.9359,49.2671],[1.9429,49.2663],[1.9408,49.2635],[1.9406,49.2606],[1.9391,49.2586],[1.937,49.2591],[1.9359,49.2583],[1.938,49.2561],[1.9352,49.2533],[1.9346,49.2528],[1.9314,49.2545],[1.9285,49.2532],[1.9252,49.2494],[1.923,49.2504],[1.9216,49.249],[1.9228,49.2483],[1.9206,49.2459],[1.9197,49.2463],[1.9199,49.2454],[1.9187,49.2436]]]},"60368":{"type":"Polygon","coordinates":[[[2.8505,49.454],[2.8471,49.4541],[2.8471,49.4533],[2.8308,49.4621],[2.8324,49.4631],[2.8313,49.4642],[2.8326,49.465],[2.8305,49.4659],[2.8332,49.4696],[2.8397,49.4706],[2.8413,49.4717],[2.8422,49.474],[2.8452,49.4747],[2.8448,49.4756],[2.8464,49.4761],[2.8452,49.4768],[2.8441,49.4795],[2.8613,49.4792],[2.866,49.4743],[2.8656,49.4737],[2.8687,49.4741],[2.8703,49.4708],[2.8729,49.4703],[2.8742,49.4692],[2.8743,49.4682],[2.8727,49.468],[2.8727,49.4673],[2.8748,49.467],[2.8769,49.4654],[2.8765,49.4627],[2.8681,49.459],[2.8653,49.4553],[2.8612,49.4599],[2.86,49.4585],[2.8544,49.458],[2.8525,49.4565],[2.8487,49.4574],[2.8488,49.4553],[2.8505,49.454]]]},"60369":{"type":"Polygon","coordinates":[[[2.6722,49.3202],[2.6738,49.3233],[2.6772,49.3269],[2.6965,49.3283],[2.6953,49.3338],[2.7019,49.3352],[2.7017,49.3409],[2.6988,49.3411],[2.6995,49.344],[2.6984,49.345],[2.6983,49.3475],[2.6997,49.3478],[2.6985,49.352],[2.6995,49.3542],[2.7,49.3594],[2.6968,49.3614],[2.6955,49.3636],[2.7106,49.3656],[2.7072,49.3749],[2.7078,49.3786],[2.7116,49.3768],[2.7236,49.3797],[2.7233,49.3755],[2.7257,49.3742],[2.7262,49.3712],[2.7292,49.367],[2.7289,49.3651],[2.7309,49.363],[2.732,49.3598],[2.7304,49.3568],[2.7299,49.3519],[2.7233,49.3494],[2.722,49.3483],[2.7222,49.3474],[2.7266,49.3395],[2.7311,49.3347],[2.7362,49.3309],[2.7333,49.3272],[2.731,49.3209],[2.7274,49.317],[2.7255,49.3125],[2.7232,49.3111],[2.7188,49.3106],[2.7112,49.313],[2.7009,49.3148],[2.6965,49.3149],[2.6895,49.3136],[2.6853,49.3139],[2.679,49.316],[2.6722,49.3202]]]},"60370":{"type":"Polygon","coordinates":[[[2.0939,49.2688],[2.0956,49.2686],[2.0963,49.2694],[2.1019,49.2688],[2.102,49.2695],[2.1035,49.2696],[2.1073,49.2674],[2.109,49.2687],[2.1098,49.268],[2.1123,49.2698],[2.1158,49.2667],[2.1126,49.2648],[2.1169,49.2564],[2.1184,49.2561],[2.1164,49.2522],[2.1156,49.2526],[2.1158,49.247],[2.1122,49.2417],[2.1115,49.2384],[2.0925,49.242],[2.0938,49.2612],[2.0926,49.2677],[2.094,49.2675],[2.0939,49.2688]]]},"60371":{"type":"Polygon","coordinates":[[[1.8084,49.6068],[1.8098,49.608],[1.8108,49.6073],[1.8274,49.6104],[1.8283,49.6076],[1.8318,49.6082],[1.8322,49.6073],[1.835,49.6067],[1.8384,49.6045],[1.8355,49.6035],[1.8369,49.6017],[1.8392,49.6012],[1.8409,49.6018],[1.8431,49.6008],[1.8453,49.5986],[1.8447,49.5984],[1.8464,49.5968],[1.846,49.5965],[1.8499,49.596],[1.8541,49.59],[1.8471,49.5855],[1.8482,49.5839],[1.8439,49.5818],[1.8452,49.5805],[1.8389,49.5794],[1.8395,49.5786],[1.8388,49.578],[1.8402,49.5756],[1.8338,49.5767],[1.8291,49.5749],[1.8283,49.5768],[1.8311,49.5805],[1.8293,49.5809],[1.8283,49.5795],[1.8262,49.5793],[1.8207,49.5823],[1.8173,49.5848],[1.8165,49.5865],[1.8136,49.5864],[1.8123,49.5906],[1.8148,49.6003],[1.8124,49.6027],[1.8137,49.6035],[1.8133,49.6042],[1.8084,49.6068]]]},"60372":{"type":"Polygon","coordinates":[[[2.1511,49.5602],[2.1502,49.5579],[2.147,49.5578],[2.1481,49.5562],[2.1429,49.5555],[2.1421,49.5566],[2.1376,49.5559],[2.1408,49.5535],[2.1401,49.5529],[2.1443,49.551],[2.1419,49.5484],[2.1448,49.5462],[2.1389,49.5433],[2.1383,49.5439],[2.1357,49.5432],[2.1366,49.5415],[2.1298,49.5384],[2.1258,49.5417],[2.1241,49.5415],[2.1228,49.5428],[2.1116,49.539],[2.1126,49.5375],[2.1092,49.5352],[2.1108,49.534],[2.1097,49.533],[2.1023,49.537],[2.0977,49.5378],[2.0967,49.5399],[2.0942,49.5398],[2.0902,49.5425],[2.0873,49.5448],[2.0904,49.5465],[2.0876,49.5498],[2.0844,49.5508],[2.0818,49.5531],[2.082,49.5552],[2.0835,49.5571],[2.0899,49.5604],[2.0916,49.5656],[2.0978,49.5692],[2.1022,49.5685],[2.1022,49.5676],[2.0977,49.5637],[2.0994,49.563],[2.0964,49.5615],[2.1024,49.5587],[2.1029,49.5607],[2.1049,49.5592],[2.1173,49.5625],[2.118,49.5606],[2.1236,49.5635],[2.1261,49.5617],[2.1322,49.5664],[2.1354,49.5641],[2.1393,49.5656],[2.1445,49.5627],[2.145,49.564],[2.1511,49.5602]]]},"60373":{"type":"Polygon","coordinates":[[[2.8815,49.5325],[2.8783,49.5267],[2.8809,49.5255],[2.8809,49.5242],[2.8832,49.5231],[2.8858,49.5235],[2.889,49.5224],[2.8866,49.5208],[2.8866,49.5197],[2.8845,49.519],[2.8849,49.5181],[2.8878,49.5172],[2.8874,49.5159],[2.8836,49.5136],[2.8809,49.51],[2.8859,49.5055],[2.8868,49.5025],[2.8896,49.5012],[2.8905,49.4998],[2.8903,49.4987],[2.8897,49.4988],[2.8869,49.4952],[2.887,49.4934],[2.8838,49.4906],[2.8834,49.4894],[2.884,49.4883],[2.8827,49.4893],[2.8808,49.4892],[2.8803,49.4896],[2.8811,49.4902],[2.8775,49.491],[2.8774,49.4919],[2.87,49.493],[2.8658,49.4956],[2.8679,49.4976],[2.87,49.4982],[2.8618,49.4999],[2.8629,49.5026],[2.8629,49.5052],[2.8603,49.51],[2.8644,49.5117],[2.8639,49.5133],[2.8655,49.5173],[2.8634,49.518],[2.8632,49.5213],[2.8671,49.5233],[2.8688,49.5231],[2.8698,49.5218],[2.8708,49.5309],[2.8801,49.5332],[2.8815,49.5325]]]},"60374":{"type":"Polygon","coordinates":[[[2.4765,49.5536],[2.4872,49.5613],[2.4933,49.5584],[2.4987,49.5641],[2.5023,49.5633],[2.5021,49.5663],[2.509,49.5655],[2.5087,49.5698],[2.5078,49.5704],[2.5144,49.5734],[2.516,49.5732],[2.5162,49.5749],[2.517,49.5749],[2.5174,49.5739],[2.5234,49.5765],[2.5276,49.5745],[2.5325,49.5753],[2.5328,49.5732],[2.5351,49.5727],[2.5314,49.5672],[2.544,49.5602],[2.5417,49.5597],[2.5404,49.5571],[2.5374,49.5564],[2.5378,49.5526],[2.5372,49.5525],[2.5368,49.5477],[2.5346,49.5473],[2.5384,49.5453],[2.5414,49.5457],[2.5408,49.5448],[2.5418,49.543],[2.5406,49.5426],[2.5445,49.5397],[2.5458,49.5404],[2.5492,49.5364],[2.5419,49.5341],[2.5407,49.5352],[2.5365,49.5332],[2.536,49.5292],[2.5349,49.5288],[2.5366,49.5259],[2.5352,49.5242],[2.529,49.525],[2.526,49.5238],[2.5221,49.5241],[2.5206,49.5263],[2.5193,49.5259],[2.517,49.5281],[2.5135,49.5266],[2.5121,49.5282],[2.5034,49.5299],[2.5018,49.5273],[2.4963,49.5315],[2.4943,49.5307],[2.4926,49.532],[2.487,49.53],[2.4822,49.5362],[2.4792,49.5349],[2.4802,49.5366],[2.4791,49.539],[2.4792,49.5473],[2.4854,49.5482],[2.4811,49.5516],[2.4801,49.5509],[2.4765,49.5536]]]},"60375":{"type":"Polygon","coordinates":[[[2.5221,49.4323],[2.5227,49.4284],[2.5264,49.4285],[2.5273,49.4252],[2.5292,49.4254],[2.5338,49.422],[2.5348,49.4205],[2.5344,49.4185],[2.5396,49.4175],[2.5394,49.4169],[2.541,49.4164],[2.5398,49.4149],[2.5385,49.4095],[2.5422,49.4091],[2.542,49.4084],[2.5396,49.4085],[2.538,49.4033],[2.5329,49.4052],[2.532,49.403],[2.5305,49.4041],[2.5256,49.4044],[2.5253,49.4052],[2.5209,49.4052],[2.5213,49.4038],[2.52,49.4036],[2.5198,49.4028],[2.5175,49.403],[2.5173,49.4002],[2.5099,49.402],[2.5104,49.4027],[2.5012,49.4041],[2.5021,49.4077],[2.5059,49.4087],[2.5069,49.4136],[2.5065,49.4158],[2.5091,49.4175],[2.5098,49.4189],[2.5092,49.4193],[2.5112,49.4211],[2.5151,49.4236],[2.5141,49.4254],[2.5124,49.4255],[2.5114,49.429],[2.5177,49.4303],[2.5221,49.4323]]]},"60376":{"type":"Polygon","coordinates":[[[2.1177,49.4984],[2.1178,49.5026],[2.1168,49.5035],[2.1177,49.5078],[2.1191,49.5093],[2.114,49.5109],[2.1156,49.5133],[2.1076,49.5207],[2.1086,49.5247],[2.1048,49.527],[2.1062,49.5277],[2.1069,49.5273],[2.1082,49.5287],[2.113,49.5306],[2.1151,49.5307],[2.1155,49.5297],[2.1187,49.5296],[2.1198,49.5294],[2.1196,49.5286],[2.1273,49.5271],[2.1262,49.5252],[2.1324,49.5237],[2.1314,49.523],[2.1289,49.5176],[2.1297,49.5173],[2.1287,49.5163],[2.1315,49.5129],[2.134,49.512],[2.1313,49.5093],[2.1318,49.5075],[2.1312,49.5064],[2.133,49.5055],[2.131,49.5027],[2.1301,49.5035],[2.1302,49.4999],[2.1266,49.4981],[2.1201,49.4991],[2.1177,49.4984]]]},"60377":{"type":"Polygon","coordinates":[[[2.1976,49.5991],[2.2006,49.6038],[2.2045,49.6029],[2.2062,49.6038],[2.2192,49.6037],[2.2317,49.6021],[2.2322,49.5979],[2.2354,49.598],[2.2353,49.5974],[2.2325,49.597],[2.2324,49.5948],[2.2347,49.5945],[2.2348,49.5927],[2.241,49.5931],[2.2417,49.5923],[2.2412,49.5922],[2.2414,49.5907],[2.2437,49.5909],[2.2475,49.5869],[2.2342,49.5831],[2.2316,49.5817],[2.2339,49.5778],[2.227,49.5734],[2.2215,49.5734],[2.2195,49.5746],[2.22,49.5755],[2.2188,49.5766],[2.2158,49.578],[2.2085,49.5787],[2.2073,49.5794],[2.2085,49.5809],[2.2054,49.5815],[2.2048,49.5836],[2.2026,49.5833],[2.2011,49.5848],[2.1969,49.5908],[2.201,49.5976],[2.1976,49.5991]]]},"60378":{"type":"Polygon","coordinates":[[[2.8407,49.5018],[2.837,49.4983],[2.8328,49.4992],[2.8284,49.4951],[2.826,49.4915],[2.8218,49.4917],[2.8214,49.4924],[2.8202,49.4923],[2.8197,49.4942],[2.8174,49.4944],[2.8167,49.4953],[2.8168,49.4944],[2.8161,49.4946],[2.8166,49.4963],[2.8151,49.4967],[2.8139,49.4984],[2.8117,49.4986],[2.8113,49.4998],[2.8124,49.5016],[2.8099,49.5016],[2.808,49.5033],[2.8125,49.5057],[2.8155,49.5088],[2.817,49.512],[2.8165,49.5122],[2.8184,49.5133],[2.8206,49.5137],[2.8219,49.5128],[2.8268,49.5145],[2.8305,49.514],[2.8312,49.5122],[2.8289,49.51],[2.8326,49.5078],[2.8322,49.5071],[2.8333,49.5071],[2.8328,49.5067],[2.8343,49.505],[2.8413,49.5027],[2.8407,49.5018]]]},"60379":{"type":"Polygon","coordinates":[[[2.8235,49.5544],[2.8257,49.5544],[2.8286,49.5533],[2.8299,49.5512],[2.8323,49.5514],[2.8408,49.5477],[2.8403,49.5468],[2.8368,49.5456],[2.834,49.5458],[2.8329,49.5445],[2.828,49.5462],[2.8213,49.5453],[2.815,49.5454],[2.8127,49.5431],[2.8132,49.541],[2.8066,49.5413],[2.8055,49.5365],[2.8043,49.5368],[2.8016,49.5354],[2.7903,49.5352],[2.7842,49.5371],[2.78,49.5373],[2.7766,49.5388],[2.7739,49.5439],[2.7704,49.5449],[2.7666,49.5476],[2.7683,49.5486],[2.767,49.5491],[2.77,49.5517],[2.7816,49.5605],[2.7847,49.5649],[2.7884,49.5633],[2.7883,49.5621],[2.7908,49.5615],[2.7917,49.5622],[2.7959,49.5608],[2.7963,49.5603],[2.7954,49.5597],[2.8039,49.558],[2.8104,49.5584],[2.8113,49.5604],[2.8161,49.5577],[2.8166,49.5587],[2.8182,49.5579],[2.8204,49.5563],[2.821,49.5553],[2.8203,49.555],[2.8217,49.5536],[2.8235,49.5544]]]},"60380":{"type":"Polygon","coordinates":[[[3.1051,49.148],[3.1023,49.1483],[3.1007,49.1462],[3.0953,49.1435],[3.0934,49.1417],[3.0911,49.138],[3.0923,49.1376],[3.092,49.1351],[3.0937,49.1335],[3.098,49.1329],[3.0978,49.132],[3.0986,49.1316],[3.0952,49.1311],[3.0945,49.1295],[3.0937,49.1298],[3.0885,49.1254],[3.09,49.1247],[3.0899,49.1242],[3.0838,49.1209],[3.0766,49.122],[3.066,49.128],[3.0657,49.129],[3.0634,49.1292],[3.0623,49.1284],[3.0542,49.1291],[3.0536,49.1281],[3.0556,49.1286],[3.0555,49.1276],[3.05,49.127],[3.0468,49.1232],[3.0463,49.1237],[3.0438,49.1223],[3.0432,49.1226],[3.0447,49.1247],[3.0412,49.1247],[3.0417,49.1255],[3.0412,49.1274],[3.0375,49.1282],[3.0364,49.1294],[3.0417,49.1333],[3.0466,49.1321],[3.0496,49.1302],[3.0506,49.1327],[3.0555,49.1352],[3.0549,49.1363],[3.0562,49.137],[3.0561,49.139],[3.0552,49.1391],[3.0558,49.14],[3.0551,49.1401],[3.0575,49.1427],[3.0556,49.143],[3.056,49.1438],[3.05,49.1449],[3.0523,49.1471],[3.0533,49.1492],[3.0496,49.1509],[3.0571,49.1513],[3.0595,49.1507],[3.0657,49.1518],[3.0687,49.1515],[3.0725,49.1534],[3.0774,49.1537],[3.0787,49.1545],[3.0785,49.1559],[3.0826,49.1565],[3.0845,49.1576],[3.0862,49.1561],[3.0879,49.1566],[3.0918,49.1533],[3.0974,49.1507],[3.0997,49.15],[3.102,49.1513],[3.1033,49.1502],[3.1044,49.1507],[3.1074,49.1489],[3.1051,49.148]]]},"60381":{"type":"Polygon","coordinates":[[[2.8475,49.6722],[2.8576,49.6782],[2.8591,49.6789],[2.8596,49.6782],[2.8622,49.6796],[2.8598,49.6813],[2.8582,49.6804],[2.8569,49.6829],[2.8578,49.6834],[2.8571,49.6837],[2.8658,49.6855],[2.8692,49.6834],[2.873,49.6845],[2.8743,49.6858],[2.8784,49.681],[2.8774,49.6785],[2.8782,49.6769],[2.8804,49.6752],[2.8831,49.6745],[2.8853,49.6719],[2.8886,49.671],[2.8882,49.6686],[2.8895,49.6672],[2.887,49.6671],[2.884,49.6648],[2.8822,49.669],[2.8809,49.6684],[2.8798,49.6689],[2.8774,49.6674],[2.8789,49.6673],[2.8779,49.6666],[2.8819,49.663],[2.88,49.6635],[2.8783,49.6629],[2.8744,49.6655],[2.8712,49.6648],[2.8712,49.664],[2.8736,49.6631],[2.8718,49.6618],[2.8733,49.661],[2.8755,49.6615],[2.87,49.6588],[2.8475,49.6722]]]},"60382":{"type":"Polygon","coordinates":[[[2.7744,49.4396],[2.7793,49.4441],[2.7844,49.4426],[2.7906,49.4474],[2.7965,49.4428],[2.8063,49.4425],[2.8158,49.4351],[2.8163,49.4364],[2.8176,49.4359],[2.8213,49.4381],[2.8243,49.436],[2.8257,49.4367],[2.8359,49.4281],[2.8288,49.4228],[2.8253,49.4213],[2.8248,49.4221],[2.8235,49.4218],[2.8215,49.4241],[2.8151,49.4209],[2.8165,49.4186],[2.8176,49.4188],[2.8186,49.4178],[2.8142,49.4156],[2.8121,49.4178],[2.8119,49.4196],[2.8108,49.4192],[2.8071,49.4211],[2.8072,49.4223],[2.8059,49.4233],[2.8063,49.4237],[2.8018,49.4255],[2.8002,49.425],[2.7916,49.4322],[2.7885,49.4307],[2.7734,49.4379],[2.7744,49.4396]]]},"60383":{"type":"Polygon","coordinates":[[[2.766,49.5492],[2.7683,49.5486],[2.7666,49.5476],[2.7685,49.5468],[2.768,49.5462],[2.7739,49.5439],[2.7766,49.5388],[2.78,49.5373],[2.7842,49.5371],[2.7903,49.5352],[2.7992,49.5351],[2.8026,49.5356],[2.8043,49.5368],[2.8055,49.5365],[2.8058,49.5343],[2.8076,49.5317],[2.8014,49.5305],[2.8007,49.5289],[2.7999,49.5202],[2.7981,49.5173],[2.7964,49.5183],[2.7948,49.5178],[2.7886,49.5183],[2.7865,49.5158],[2.7775,49.5162],[2.7772,49.514],[2.7728,49.5155],[2.7774,49.5181],[2.7743,49.518],[2.7737,49.5198],[2.769,49.519],[2.7668,49.5205],[2.7644,49.5236],[2.7582,49.527],[2.7527,49.5282],[2.7596,49.5324],[2.7595,49.5348],[2.7607,49.5358],[2.7606,49.5429],[2.7646,49.5446],[2.766,49.5492]]]},"60385":{"type":"MultiPolygon","coordinates":[[[[3.0838,49.163],[3.0873,49.16],[3.0901,49.1589],[3.0909,49.1568],[3.093,49.1549],[3.0985,49.1544],[3.099,49.1552],[3.1005,49.1546],[3.0974,49.1565],[3.0922,49.1618],[3.092,49.1612],[3.0889,49.1622],[3.0895,49.163],[3.0883,49.1648],[3.0887,49.1676],[3.0861,49.1683],[3.0873,49.1712],[3.0864,49.1718],[3.0848,49.1711],[3.0858,49.1727],[3.0843,49.173],[3.0861,49.1761],[3.088,49.1763],[3.0895,49.1776],[3.0885,49.1781],[3.0903,49.18],[3.0893,49.1811],[3.0921,49.1844],[3.0915,49.1849],[3.0921,49.1861],[3.0898,49.1865],[3.0921,49.1875],[3.0938,49.1873],[3.0944,49.1882],[3.0923,49.1895],[3.0928,49.1898],[3.0985,49.1908],[3.1005,49.192],[3.0968,49.1946],[3.0983,49.1953],[3.0979,49.1961],[3.0997,49.1958],[3.0993,49.1968],[3.1011,49.1979],[3.1128,49.1928],[3.1172,49.1895],[3.1163,49.1873],[3.1172,49.1852],[3.1148,49.1842],[3.1155,49.1839],[3.1159,49.1818],[3.1124,49.182],[3.1137,49.1807],[3.1141,49.1784],[3.1168,49.1763],[3.1141,49.1752],[3.1125,49.1757],[3.1114,49.1742],[3.1126,49.1734],[3.112,49.1714],[3.1109,49.1705],[3.1098,49.1713],[3.1079,49.17],[3.1075,49.167],[3.1082,49.1659],[3.1163,49.1697],[3.1217,49.1616],[3.1473,49.1628],[3.1472,49.1615],[3.1483,49.161],[3.1401,49.1557],[3.1412,49.1535],[3.1378,49.1524],[3.1381,49.1518],[3.1312,49.1512],[3.1314,49.1506],[3.1251,49.1487],[3.1244,49.1469],[3.1282,49.146],[3.1275,49.145],[3.1076,49.1465],[3.1054,49.1478],[3.1074,49.1489],[3.1044,49.1507],[3.1033,49.1502],[3.102,49.1513],[3.0997,49.15],[3.0907,49.154],[3.0879,49.1573],[3.0822,49.1615],[3.0838,49.163]]],[[[3.0941,49.1424],[3.1007,49.1462],[3.1019,49.148],[3.1037,49.1484],[3.1051,49.148],[3.107,49.145],[3.1134,49.1413],[3.115,49.1387],[3.117,49.1386],[3.1142,49.1381],[3.1111,49.1317],[3.0941,49.1424]]]]},"60386":{"type":"Polygon","coordinates":[[[2.7766,49.5143],[2.7762,49.5118],[2.7772,49.5114],[2.7742,49.5113],[2.7755,49.5096],[2.7741,49.5085],[2.7672,49.5085],[2.7666,49.5072],[2.7661,49.5083],[2.7633,49.5085],[2.7594,49.5053],[2.7582,49.5064],[2.7572,49.5058],[2.7518,49.5072],[2.7514,49.5057],[2.7456,49.5067],[2.7453,49.5061],[2.7408,49.5074],[2.739,49.5044],[2.735,49.5077],[2.7315,49.5059],[2.7202,49.5174],[2.7204,49.5189],[2.7277,49.5257],[2.7364,49.524],[2.7363,49.5231],[2.7423,49.5231],[2.7477,49.5236],[2.7526,49.5259],[2.7533,49.5256],[2.7563,49.5276],[2.7647,49.5234],[2.7668,49.5205],[2.769,49.519],[2.7737,49.5198],[2.7743,49.518],[2.7774,49.5181],[2.7728,49.5155],[2.7766,49.5143]]]},"60387":{"type":"Polygon","coordinates":[[[1.9828,49.5852],[1.984,49.5838],[1.9758,49.5795],[1.9656,49.5691],[1.9695,49.566],[1.9667,49.564],[1.9641,49.5643],[1.9624,49.5619],[1.9605,49.5625],[1.951,49.5577],[1.9363,49.5597],[1.9345,49.5593],[1.9296,49.5604],[1.9261,49.5602],[1.9211,49.5634],[1.9238,49.5638],[1.9284,49.5662],[1.943,49.5693],[1.9462,49.5718],[1.948,49.5721],[1.946,49.5757],[1.946,49.5767],[1.9475,49.5769],[1.9457,49.5777],[1.9478,49.5795],[1.9437,49.5839],[1.9464,49.5848],[1.9448,49.5864],[1.9484,49.5883],[1.9494,49.585],[1.9534,49.5849],[1.9534,49.5833],[1.9558,49.5824],[1.9543,49.584],[1.9558,49.5866],[1.9563,49.5871],[1.9601,49.5867],[1.9611,49.5883],[1.9597,49.5925],[1.9607,49.5932],[1.9635,49.5886],[1.9683,49.5918],[1.9698,49.5937],[1.9802,49.5972],[1.9802,49.5947],[1.9842,49.5942],[1.9852,49.5925],[1.9836,49.5908],[1.9828,49.5885],[1.9814,49.5882],[1.9834,49.587],[1.9828,49.5852]]]},"60388":{"type":"Polygon","coordinates":[[[1.8747,49.522],[1.8739,49.5232],[1.8755,49.5241],[1.8766,49.5229],[1.8832,49.522],[1.8841,49.5228],[1.8859,49.5219],[1.8867,49.523],[1.8878,49.5225],[1.8894,49.5243],[1.8865,49.5251],[1.887,49.5259],[1.8917,49.5242],[1.8922,49.5256],[1.8933,49.5255],[1.8934,49.527],[1.9038,49.5415],[1.9052,49.5401],[1.9115,49.5438],[1.91,49.5448],[1.9137,49.5462],[1.9158,49.545],[1.921,49.5481],[1.9302,49.5515],[1.9324,49.5481],[1.9296,49.5447],[1.9244,49.5408],[1.9204,49.5407],[1.9143,49.5384],[1.9111,49.5357],[1.9136,49.5339],[1.9115,49.5299],[1.9128,49.5295],[1.9088,49.5231],[1.9104,49.5229],[1.9094,49.522],[1.9108,49.5205],[1.9101,49.5205],[1.9094,49.5186],[1.9043,49.515],[1.8982,49.5128],[1.8967,49.5139],[1.8957,49.5133],[1.891,49.5152],[1.8903,49.5163],[1.8839,49.5179],[1.8846,49.5186],[1.8802,49.5206],[1.8791,49.5209],[1.8771,49.5198],[1.8747,49.522]]]},"60389":{"type":"Polygon","coordinates":[[[3.0959,49.6232],[3.0898,49.6213],[3.0874,49.6237],[3.0864,49.6268],[3.0762,49.6255],[3.0762,49.6244],[3.0746,49.6229],[3.069,49.6216],[3.0685,49.6224],[3.0702,49.6228],[3.0703,49.6244],[3.0673,49.6282],[3.0671,49.6299],[3.0682,49.6319],[3.0682,49.6347],[3.0695,49.6351],[3.0695,49.6359],[3.0691,49.6388],[3.0665,49.6414],[3.066,49.6442],[3.0808,49.6425],[3.084,49.6419],[3.0841,49.6413],[3.0863,49.6416],[3.0865,49.6399],[3.0878,49.6398],[3.0879,49.6375],[3.0855,49.6309],[3.0887,49.6319],[3.0884,49.6312],[3.0893,49.6307],[3.0911,49.6305],[3.0959,49.6232]]]},"60390":{"type":"Polygon","coordinates":[[[2.1922,49.547],[2.1916,49.5464],[2.1862,49.5474],[2.1852,49.5466],[2.1834,49.5404],[2.1857,49.5396],[2.1837,49.5336],[2.1822,49.5337],[2.1847,49.527],[2.1835,49.5271],[2.1813,49.5258],[2.1806,49.5263],[2.1814,49.5268],[2.1796,49.5258],[2.1762,49.5281],[2.174,49.5267],[2.1722,49.5284],[2.172,49.5299],[2.1607,49.5318],[2.1525,49.5359],[2.1562,49.5387],[2.1536,49.5408],[2.1501,49.5395],[2.1464,49.5394],[2.1474,49.541],[2.1427,49.5426],[2.1448,49.5436],[2.1426,49.5452],[2.1448,49.5462],[2.1419,49.5484],[2.1443,49.551],[2.1401,49.5529],[2.1408,49.5535],[2.1376,49.5559],[2.1421,49.5566],[2.1429,49.5555],[2.1481,49.5562],[2.147,49.5578],[2.1502,49.5579],[2.1503,49.5593],[2.1514,49.5598],[2.153,49.5587],[2.1577,49.5587],[2.1586,49.5552],[2.1656,49.557],[2.1657,49.5559],[2.1686,49.5549],[2.1725,49.5548],[2.1772,49.5512],[2.1785,49.5522],[2.1854,49.5489],[2.1922,49.547]]]},"60391":{"type":"Polygon","coordinates":[[[2.3721,49.2406],[2.3594,49.2397],[2.359,49.2409],[2.3526,49.2412],[2.3583,49.2452],[2.3578,49.2462],[2.3566,49.2458],[2.3561,49.2463],[2.3567,49.2476],[2.3549,49.2477],[2.3563,49.2492],[2.3552,49.2511],[2.3565,49.2521],[2.3565,49.2547],[2.3593,49.2554],[2.357,49.2611],[2.3624,49.26],[2.3628,49.2613],[2.3655,49.2621],[2.3694,49.2661],[2.3708,49.266],[2.3717,49.2644],[2.3735,49.2641],[2.3731,49.2635],[2.3743,49.2637],[2.3773,49.262],[2.3806,49.2624],[2.3806,49.2612],[2.3818,49.2608],[2.3814,49.2602],[2.3775,49.2604],[2.3763,49.2586],[2.3799,49.257],[2.3794,49.2562],[2.384,49.2552],[2.3823,49.252],[2.3791,49.2529],[2.3787,49.2505],[2.3769,49.2498],[2.3737,49.2461],[2.3739,49.245],[2.3722,49.2427],[2.3721,49.2406]]]},"60392":{"type":"Polygon","coordinates":[[[2.8273,49.4812],[2.8272,49.4836],[2.8248,49.487],[2.8261,49.492],[2.8328,49.4992],[2.837,49.4983],[2.8407,49.5018],[2.8444,49.4999],[2.8453,49.5004],[2.8495,49.4992],[2.8502,49.5],[2.8523,49.498],[2.8548,49.497],[2.8561,49.4974],[2.8607,49.4965],[2.8627,49.4998],[2.8679,49.499],[2.87,49.4982],[2.8679,49.4976],[2.8658,49.4956],[2.87,49.493],[2.8774,49.4919],[2.8775,49.491],[2.8797,49.4903],[2.8764,49.4889],[2.8734,49.4896],[2.8718,49.4877],[2.8722,49.4869],[2.8642,49.482],[2.8627,49.4819],[2.8617,49.4792],[2.8401,49.4793],[2.8273,49.4812]]]},"60393":{"type":"Polygon","coordinates":[[[2.3647,49.2838],[2.3667,49.2836],[2.3719,49.2857],[2.3715,49.2862],[2.373,49.2872],[2.3726,49.2883],[2.3765,49.2894],[2.3772,49.289],[2.3782,49.2904],[2.3795,49.2889],[2.3776,49.2842],[2.385,49.2876],[2.3886,49.2881],[2.3909,49.2904],[2.3916,49.2899],[2.3896,49.2877],[2.3913,49.2881],[2.3908,49.2874],[2.3925,49.2833],[2.3842,49.2796],[2.3832,49.2782],[2.3846,49.2783],[2.3774,49.2679],[2.3717,49.2668],[2.3725,49.2652],[2.3775,49.262],[2.3739,49.2638],[2.3731,49.2635],[2.3736,49.264],[2.3714,49.2646],[2.3705,49.2661],[2.3639,49.2675],[2.3646,49.2696],[2.3607,49.2737],[2.3627,49.2741],[2.363,49.2792],[2.3642,49.2797],[2.3647,49.2838]]]},"60394":{"type":"Polygon","coordinates":[[[2.5844,49.5163],[2.5839,49.5188],[2.5896,49.5171],[2.5941,49.5177],[2.5946,49.522],[2.5881,49.5225],[2.5883,49.5288],[2.5904,49.5271],[2.5979,49.5284],[2.5981,49.5297],[2.6025,49.5296],[2.5989,49.534],[2.6055,49.5373],[2.6105,49.5316],[2.6107,49.5298],[2.6177,49.5286],[2.6228,49.5258],[2.6239,49.5262],[2.6246,49.5253],[2.6218,49.5232],[2.6207,49.5205],[2.6172,49.5203],[2.6185,49.5153],[2.6159,49.5155],[2.6158,49.5142],[2.6136,49.5136],[2.611,49.5091],[2.6092,49.5112],[2.6081,49.5112],[2.6078,49.5105],[2.6017,49.51],[2.6014,49.5091],[2.5987,49.5095],[2.5979,49.5074],[2.5934,49.5082],[2.5908,49.5089],[2.5886,49.5113],[2.5897,49.5124],[2.5889,49.5133],[2.591,49.5137],[2.588,49.5159],[2.5844,49.5163]]]},"60395":{"type":"Polygon","coordinates":[[[2.1483,49.2126],[2.1467,49.212],[2.1262,49.2146],[2.1201,49.2192],[2.1198,49.2221],[2.1176,49.2269],[2.1154,49.23],[2.114,49.2297],[2.1131,49.2322],[2.0983,49.2295],[2.0875,49.2336],[2.0916,49.2376],[2.0926,49.242],[2.1115,49.2384],[2.1122,49.2417],[2.1158,49.247],[2.1156,49.2526],[2.1164,49.2522],[2.1184,49.2561],[2.1169,49.2564],[2.1126,49.2648],[2.1158,49.2667],[2.1164,49.266],[2.1182,49.2661],[2.1213,49.2676],[2.1213,49.2699],[2.1202,49.2724],[2.1225,49.2726],[2.1226,49.2759],[2.1253,49.2761],[2.1266,49.2784],[2.1392,49.2761],[2.1468,49.2775],[2.1467,49.2785],[2.1524,49.2798],[2.159,49.2733],[2.1573,49.2734],[2.1582,49.2693],[2.1591,49.2693],[2.159,49.2687],[2.1601,49.2692],[2.1602,49.2681],[2.1613,49.2681],[2.159,49.26],[2.1513,49.259],[2.1526,49.2537],[2.1555,49.2496],[2.1575,49.2505],[2.1625,49.2499],[2.1633,49.2481],[2.1643,49.2489],[2.1696,49.2447],[2.1721,49.2406],[2.1644,49.2403],[2.1634,49.2383],[2.1631,49.2336],[2.1603,49.2337],[2.1535,49.2218],[2.1501,49.218],[2.1472,49.2166],[2.1474,49.2154],[2.15,49.214],[2.1483,49.2126]]]},"60396":{"type":"Polygon","coordinates":[[[2.657,49.5573],[2.6537,49.553],[2.6564,49.553],[2.6551,49.5511],[2.6569,49.5512],[2.6564,49.5458],[2.6521,49.5459],[2.6519,49.543],[2.6486,49.5444],[2.6491,49.544],[2.6448,49.5405],[2.6477,49.5382],[2.6416,49.5355],[2.6409,49.5304],[2.6391,49.5301],[2.6389,49.5292],[2.6387,49.5243],[2.64,49.5232],[2.6382,49.5231],[2.6393,49.5198],[2.6379,49.52],[2.6367,49.5218],[2.6332,49.5236],[2.6247,49.5251],[2.6239,49.5262],[2.6228,49.5258],[2.6177,49.5286],[2.6107,49.5298],[2.6105,49.5316],[2.6044,49.5392],[2.6032,49.5436],[2.6065,49.5438],[2.6078,49.5453],[2.6072,49.5455],[2.6108,49.5492],[2.6052,49.5507],[2.6067,49.5524],[2.6039,49.5531],[2.6132,49.5586],[2.6197,49.5557],[2.6215,49.5584],[2.622,49.558],[2.625,49.5594],[2.6266,49.5584],[2.6271,49.5589],[2.6281,49.5585],[2.6282,49.5609],[2.636,49.5582],[2.6383,49.561],[2.6409,49.5602],[2.6438,49.5637],[2.6509,49.5619],[2.6519,49.5626],[2.6571,49.5607],[2.656,49.5579],[2.657,49.5573]]]},"60397":{"type":"Polygon","coordinates":[[[2.0755,49.6784],[2.0786,49.6744],[2.0828,49.6707],[2.0775,49.67],[2.0795,49.6662],[2.0792,49.6651],[2.0775,49.6652],[2.0766,49.6642],[2.0774,49.6641],[2.0775,49.6613],[2.0781,49.6613],[2.0764,49.6601],[2.0737,49.6603],[2.0728,49.6616],[2.0615,49.6627],[2.0634,49.665],[2.062,49.666],[2.0523,49.6617],[2.0493,49.6593],[2.0448,49.6584],[2.0404,49.6658],[2.0485,49.6695],[2.0755,49.6784]]]},"60398":{"type":"Polygon","coordinates":[[[2.2622,49.1584],[2.2732,49.1663],[2.2756,49.1724],[2.2643,49.1852],[2.2727,49.1904],[2.2737,49.189],[2.2841,49.1899],[2.284,49.1888],[2.2849,49.1886],[2.2859,49.19],[2.2876,49.1897],[2.2891,49.1903],[2.2925,49.1889],[2.2929,49.1906],[2.299,49.1876],[2.2983,49.1856],[2.3018,49.185],[2.3001,49.1812],[2.2995,49.176],[2.2966,49.1762],[2.2957,49.1733],[2.2948,49.1734],[2.2942,49.1717],[2.2902,49.1715],[2.2903,49.1707],[2.2888,49.1707],[2.2895,49.168],[2.287,49.1672],[2.2876,49.1659],[2.2851,49.1657],[2.2854,49.162],[2.2865,49.1599],[2.2759,49.1588],[2.2682,49.1558],[2.2622,49.1584]]]},"60399":{"type":"Polygon","coordinates":[[[2.3906,49.6362],[2.3942,49.6354],[2.3969,49.6372],[2.4002,49.635],[2.402,49.6368],[2.4137,49.6342],[2.4187,49.6319],[2.4202,49.6327],[2.4223,49.6327],[2.4219,49.6319],[2.4237,49.6289],[2.4264,49.6294],[2.4275,49.6282],[2.4255,49.6275],[2.4262,49.6254],[2.4249,49.623],[2.4288,49.6201],[2.4213,49.6198],[2.417,49.6208],[2.4153,49.6204],[2.4158,49.6179],[2.4171,49.6188],[2.4176,49.6182],[2.4106,49.612],[2.4097,49.6129],[2.4054,49.6132],[2.4051,49.614],[2.4018,49.6154],[2.4024,49.6158],[2.3973,49.6173],[2.4018,49.6195],[2.3997,49.6215],[2.4023,49.6241],[2.4,49.6244],[2.4014,49.6253],[2.4015,49.6264],[2.3983,49.6261],[2.3975,49.6263],[2.3981,49.6271],[2.3947,49.6277],[2.3955,49.6309],[2.3934,49.6326],[2.3898,49.6314],[2.3909,49.6324],[2.3906,49.6362]]]},"60400":{"type":"Polygon","coordinates":[[[2.3915,49.4826],[2.3656,49.4778],[2.3624,49.4733],[2.3581,49.4737],[2.3571,49.4719],[2.3517,49.4726],[2.3514,49.4717],[2.3399,49.4743],[2.3392,49.4729],[2.3363,49.4736],[2.3367,49.4743],[2.33,49.4766],[2.3306,49.4784],[2.3239,49.4791],[2.3259,49.4809],[2.3245,49.4823],[2.3206,49.4814],[2.3202,49.4837],[2.3214,49.4867],[2.325,49.4895],[2.3299,49.4916],[2.3323,49.4908],[2.3361,49.4949],[2.3439,49.4907],[2.3434,49.4927],[2.3483,49.4898],[2.3499,49.4916],[2.3526,49.4906],[2.352,49.49],[2.354,49.4889],[2.356,49.4894],[2.3553,49.4879],[2.356,49.4869],[2.3554,49.4827],[2.3565,49.4822],[2.3616,49.4844],[2.3649,49.4874],[2.3706,49.4853],[2.3729,49.483],[2.3788,49.4864],[2.3821,49.4869],[2.3915,49.4826]]]},"60401":{"type":"Polygon","coordinates":[[[2.0121,49.315],[2.0086,49.3109],[2.0035,49.3078],[2.0021,49.3052],[2.0031,49.3029],[2.0044,49.3021],[2.0021,49.298],[1.9977,49.2963],[1.997,49.2953],[1.9918,49.2947],[1.993,49.291],[1.9926,49.2871],[1.9907,49.2871],[1.99,49.2912],[1.9879,49.2917],[1.9878,49.2935],[1.9867,49.2947],[1.987,49.2901],[1.9864,49.2878],[1.985,49.2879],[1.9862,49.2855],[1.98,49.2858],[1.9803,49.2867],[1.9785,49.288],[1.9809,49.2913],[1.9769,49.2922],[1.9756,49.2935],[1.9752,49.2963],[1.9727,49.296],[1.9694,49.2974],[1.9725,49.3007],[1.9709,49.3023],[1.9724,49.303],[1.9734,49.3051],[1.9774,49.3065],[1.9826,49.307],[1.9825,49.308],[1.9836,49.3093],[1.9838,49.3118],[1.985,49.3138],[1.9847,49.3151],[1.9877,49.319],[1.9891,49.3184],[1.9987,49.3262],[2.0067,49.3225],[2.0111,49.3155],[2.0121,49.315]]]},"60402":{"type":"Polygon","coordinates":[[[2.7572,49.3792],[2.7556,49.3787],[2.7565,49.3783],[2.755,49.377],[2.7571,49.376],[2.7543,49.3674],[2.7551,49.3676],[2.7577,49.3652],[2.7556,49.3632],[2.7591,49.3611],[2.7644,49.3608],[2.7671,49.3546],[2.767,49.3529],[2.7642,49.3481],[2.758,49.3442],[2.7449,49.3574],[2.7443,49.3567],[2.7424,49.3582],[2.7417,49.3577],[2.741,49.3589],[2.7344,49.3573],[2.7333,49.3562],[2.7309,49.3567],[2.732,49.3595],[2.7318,49.3611],[2.7289,49.3651],[2.7292,49.367],[2.7262,49.3712],[2.7257,49.3742],[2.7233,49.3757],[2.7236,49.3798],[2.7275,49.3804],[2.7277,49.3791],[2.7339,49.3803],[2.7338,49.3812],[2.7365,49.3829],[2.7375,49.3824],[2.7389,49.3835],[2.7399,49.3832],[2.7418,49.3854],[2.7436,49.3853],[2.7464,49.3867],[2.747,49.3879],[2.7538,49.3858],[2.7563,49.3828],[2.7559,49.3824],[2.7575,49.3803],[2.7572,49.3792]]]},"60403":{"type":"Polygon","coordinates":[[[2.025,49.478],[2.0211,49.4796],[2.0217,49.4813],[2.0195,49.4819],[2.0187,49.4838],[2.0206,49.4839],[2.0197,49.4855],[2.0187,49.4857],[2.0197,49.4869],[2.0193,49.4884],[2.0176,49.4896],[2.0086,49.4898],[2.0055,49.4906],[2.0029,49.4899],[2.0004,49.4904],[1.9968,49.4927],[1.9945,49.4918],[1.99,49.4945],[1.9879,49.4969],[1.9778,49.5004],[1.9786,49.5016],[1.9774,49.5024],[1.9789,49.5026],[1.9789,49.5032],[1.9766,49.505],[1.9787,49.5085],[1.9738,49.5097],[1.9746,49.5118],[1.9739,49.5126],[1.97,49.5133],[1.972,49.5155],[1.9705,49.5163],[1.9718,49.5167],[1.9716,49.5178],[1.9689,49.5191],[1.9695,49.5194],[1.9685,49.5201],[1.9689,49.5215],[1.968,49.5214],[1.9674,49.5236],[1.9728,49.5265],[1.9723,49.527],[1.9736,49.5275],[1.9731,49.5283],[1.9761,49.5284],[1.9752,49.5298],[1.9795,49.5299],[1.9813,49.5271],[1.983,49.5262],[1.9901,49.5255],[1.9918,49.5198],[1.9965,49.5178],[1.995,49.5155],[2.0005,49.5162],[2.0072,49.5152],[2.0079,49.5161],[2.0166,49.5172],[2.0165,49.518],[2.0176,49.5178],[2.0188,49.5196],[2.021,49.5188],[2.0273,49.5263],[2.0294,49.5248],[2.0307,49.5255],[2.0259,49.5289],[2.0296,49.5305],[2.0324,49.533],[2.032,49.5348],[2.0338,49.5358],[2.0353,49.535],[2.0366,49.5359],[2.0391,49.5344],[2.0412,49.5351],[2.0462,49.5315],[2.0475,49.5317],[2.0557,49.5273],[2.0499,49.5221],[2.0467,49.5177],[2.0467,49.5144],[2.0438,49.5125],[2.0419,49.5101],[2.0416,49.5047],[2.0432,49.5018],[2.0424,49.5015],[2.0455,49.498],[2.0456,49.497],[2.0436,49.4972],[2.0435,49.4965],[2.0399,49.4959],[2.0388,49.4942],[2.0371,49.4935],[2.0363,49.4915],[2.0317,49.4877],[2.0334,49.4865],[2.0316,49.4852],[2.0293,49.4861],[2.0269,49.4847],[2.0275,49.4834],[2.0259,49.4819],[2.0281,49.4813],[2.0311,49.4786],[2.028,49.4784],[2.0267,49.4791],[2.025,49.478]]]},"60404":{"type":"Polygon","coordinates":[[[2.4758,49.3235],[2.4891,49.3146],[2.4927,49.309],[2.4814,49.3048],[2.4796,49.3034],[2.473,49.3016],[2.4714,49.3018],[2.4701,49.3029],[2.4712,49.3058],[2.4706,49.3063],[2.4684,49.3061],[2.4657,49.307],[2.4621,49.3026],[2.458,49.3107],[2.4589,49.311],[2.4587,49.3153],[2.4577,49.3162],[2.4549,49.3156],[2.4647,49.3195],[2.4643,49.32],[2.4652,49.3207],[2.4668,49.3207],[2.4665,49.3211],[2.4692,49.3234],[2.4727,49.3254],[2.4741,49.3239],[2.4758,49.3235]]]},"60405":{"type":"Polygon","coordinates":[[[1.8146,49.6511],[1.8122,49.6507],[1.7909,49.6637],[1.7951,49.6667],[1.7936,49.6725],[1.795,49.6775],[1.7945,49.6787],[1.7951,49.6815],[1.8048,49.6832],[1.8018,49.6901],[1.8062,49.6904],[1.809,49.6914],[1.8151,49.685],[1.8165,49.6852],[1.8189,49.6824],[1.8247,49.6835],[1.8266,49.6819],[1.8267,49.6804],[1.8351,49.681],[1.854,49.68],[1.8402,49.6746],[1.841,49.6732],[1.8424,49.6739],[1.8432,49.672],[1.841,49.6712],[1.8426,49.6687],[1.8383,49.6665],[1.8338,49.6651],[1.8261,49.6641],[1.8248,49.6632],[1.8241,49.6638],[1.8208,49.6635],[1.8191,49.6583],[1.8157,49.6578],[1.8156,49.655],[1.8175,49.6516],[1.8146,49.6511]]]},"60406":{"type":"Polygon","coordinates":[[[2.6033,49.3331],[2.6032,49.3317],[2.595,49.3301],[2.5795,49.3285],[2.5768,49.3244],[2.5731,49.3238],[2.5722,49.3214],[2.5726,49.32],[2.5752,49.3195],[2.575,49.3183],[2.5762,49.3174],[2.5764,49.3154],[2.5686,49.312],[2.5651,49.3122],[2.5638,49.3145],[2.5565,49.3128],[2.5537,49.3151],[2.5517,49.3144],[2.5481,49.3157],[2.5461,49.315],[2.5437,49.3162],[2.5436,49.3207],[2.5467,49.3204],[2.5448,49.3239],[2.5431,49.3251],[2.5475,49.3276],[2.5515,49.3286],[2.5536,49.3398],[2.6033,49.3331]]]},"60407":{"type":"Polygon","coordinates":[[[1.7756,49.648],[1.7729,49.6521],[1.7765,49.6524],[1.7764,49.6556],[1.7743,49.6559],[1.7741,49.6572],[1.7753,49.6618],[1.788,49.6646],[1.7925,49.6672],[1.7951,49.6667],[1.7909,49.6637],[1.8122,49.6507],[1.7962,49.6479],[1.7957,49.6454],[1.793,49.6441],[1.7931,49.6412],[1.7924,49.6415],[1.79,49.6395],[1.7824,49.6406],[1.7756,49.6403],[1.7756,49.648]]]},"60408":{"type":"Polygon","coordinates":[[[2.717,49.471],[2.7058,49.4753],[2.7087,49.4756],[2.7111,49.4785],[2.7121,49.4783],[2.7121,49.4812],[2.7138,49.4831],[2.716,49.4829],[2.7196,49.4869],[2.7251,49.4849],[2.7278,49.4875],[2.7258,49.4882],[2.728,49.4903],[2.7308,49.4888],[2.7341,49.4896],[2.736,49.4915],[2.739,49.4914],[2.7437,49.4861],[2.7466,49.4872],[2.751,49.4865],[2.7503,49.4843],[2.7596,49.4822],[2.7596,49.4811],[2.7622,49.4826],[2.7624,49.4742],[2.7639,49.4723],[2.7634,49.4718],[2.7642,49.472],[2.766,49.4676],[2.7598,49.466],[2.7494,49.4665],[2.726,49.4655],[2.7257,49.4662],[2.7228,49.4673],[2.7211,49.4694],[2.717,49.471]]]},"60409":{"type":"Polygon","coordinates":[[[2.4881,49.3069],[2.4877,49.3054],[2.4838,49.3035],[2.4862,49.3009],[2.4852,49.2983],[2.483,49.2979],[2.4836,49.296],[2.4813,49.2951],[2.4822,49.2936],[2.4787,49.2921],[2.4791,49.2917],[2.4781,49.2898],[2.4786,49.2895],[2.4768,49.2894],[2.4757,49.2881],[2.4777,49.2876],[2.4768,49.285],[2.4731,49.285],[2.4666,49.2876],[2.4566,49.2888],[2.4572,49.2892],[2.4548,49.2902],[2.4541,49.2913],[2.4523,49.2915],[2.4523,49.2928],[2.4497,49.2945],[2.4503,49.296],[2.4511,49.2965],[2.4518,49.2959],[2.4558,49.2993],[2.4584,49.3003],[2.4565,49.3102],[2.4575,49.3107],[2.4621,49.3026],[2.4657,49.307],[2.4711,49.3058],[2.4701,49.3029],[2.4724,49.3015],[2.4796,49.3034],[2.486,49.3067],[2.4881,49.3069]]]},"60410":{"type":"Polygon","coordinates":[[[3.1225,49.6021],[3.1216,49.6013],[3.1229,49.5989],[3.1245,49.5995],[3.1259,49.5985],[3.1244,49.5979],[3.1251,49.5968],[3.1161,49.5941],[3.1043,49.5877],[3.1029,49.5928],[3.0991,49.5964],[3.0997,49.5966],[3.099,49.5981],[3.1028,49.599],[3.0968,49.6023],[3.0995,49.605],[3.1042,49.6077],[3.1027,49.61],[3.0995,49.6117],[3.0995,49.6126],[3.0979,49.6139],[3.1009,49.6159],[3.1077,49.6146],[3.1087,49.6154],[3.11,49.6134],[3.107,49.6138],[3.1101,49.6105],[3.1154,49.6067],[3.116,49.6072],[3.1206,49.6032],[3.122,49.604],[3.1225,49.6021]]]},"60411":{"type":"Polygon","coordinates":[[[1.9936,49.2122],[1.9898,49.2111],[1.9886,49.2096],[1.9884,49.2077],[1.9906,49.2058],[1.9877,49.2044],[1.9891,49.2036],[1.9873,49.2018],[1.9891,49.2011],[1.9875,49.2002],[1.985,49.2003],[1.9821,49.1973],[1.9842,49.1959],[1.9819,49.1954],[1.9771,49.1963],[1.9765,49.1955],[1.9754,49.1957],[1.9748,49.1932],[1.9703,49.1942],[1.9688,49.1933],[1.9612,49.1934],[1.9599,49.1958],[1.9593,49.1992],[1.9486,49.2089],[1.9508,49.2212],[1.9528,49.222],[1.954,49.2243],[1.9522,49.2252],[1.9583,49.2263],[1.964,49.2245],[1.9649,49.2259],[1.9724,49.2268],[1.9751,49.2329],[1.9743,49.2357],[1.9766,49.2358],[1.9764,49.2365],[1.9799,49.236],[1.9801,49.2373],[1.9836,49.237],[1.9826,49.2334],[1.9837,49.2332],[1.9825,49.2307],[1.9854,49.23],[1.984,49.2275],[1.9922,49.2278],[1.9893,49.2235],[1.9803,49.2243],[1.9806,49.2234],[1.9797,49.2219],[1.9808,49.2179],[1.9788,49.2157],[1.9803,49.2147],[1.9816,49.215],[1.9809,49.2141],[1.9824,49.2136],[1.9875,49.2131],[1.9879,49.2138],[1.9913,49.2128],[1.9925,49.2137],[1.9936,49.2122]]]},"60412":{"type":"Polygon","coordinates":[[[1.7936,49.1803],[1.7909,49.18],[1.7897,49.1818],[1.7886,49.1815],[1.7864,49.1831],[1.7867,49.1842],[1.7848,49.1858],[1.7809,49.1843],[1.7775,49.184],[1.777,49.185],[1.7835,49.1872],[1.7807,49.1921],[1.7864,49.1943],[1.7853,49.1965],[1.7813,49.1958],[1.781,49.1971],[1.7822,49.1967],[1.7844,49.1974],[1.7841,49.1983],[1.788,49.1988],[1.7868,49.2012],[1.7945,49.2029],[1.7948,49.2033],[1.7912,49.2052],[1.7959,49.2079],[1.8015,49.2049],[1.8033,49.2069],[1.8075,49.2052],[1.8112,49.2001],[1.8146,49.1996],[1.8142,49.1977],[1.8194,49.196],[1.8196,49.1945],[1.8181,49.1942],[1.8147,49.1951],[1.8134,49.1945],[1.8101,49.1976],[1.8083,49.1966],[1.8061,49.1934],[1.8077,49.1925],[1.8071,49.191],[1.8037,49.1909],[1.8028,49.1868],[1.7977,49.187],[1.797,49.1852],[1.7955,49.1853],[1.7935,49.1827],[1.7936,49.1803]]]},"60413":{"type":"Polygon","coordinates":[[[2.7591,49.1141],[2.7573,49.1148],[2.7552,49.1133],[2.7436,49.1215],[2.7384,49.1189],[2.736,49.1227],[2.7344,49.1279],[2.7319,49.1291],[2.7316,49.1302],[2.7266,49.135],[2.7289,49.1382],[2.7272,49.14],[2.7349,49.1406],[2.738,49.1391],[2.7412,49.1427],[2.7436,49.1427],[2.7439,49.1447],[2.7447,49.1446],[2.7448,49.1454],[2.7466,49.145],[2.7476,49.1363],[2.7537,49.1401],[2.7598,49.1361],[2.7573,49.1353],[2.7606,49.1326],[2.7653,49.1336],[2.7637,49.1319],[2.7637,49.1302],[2.7624,49.1303],[2.7637,49.1252],[2.7674,49.1246],[2.7677,49.1238],[2.762,49.1184],[2.7626,49.1181],[2.7591,49.1141]]]},"60414":{"type":"Polygon","coordinates":[[[2.4554,49.2499],[2.4536,49.2453],[2.4508,49.2461],[2.4494,49.2446],[2.4419,49.2456],[2.4416,49.2451],[2.437,49.2464],[2.433,49.2496],[2.4338,49.2509],[2.4293,49.2525],[2.4237,49.2519],[2.4239,49.2511],[2.4224,49.2509],[2.4185,49.2508],[2.4162,49.2516],[2.4157,49.2532],[2.4134,49.2544],[2.4093,49.2549],[2.4137,49.2551],[2.4087,49.2578],[2.4072,49.2616],[2.4079,49.2633],[2.4041,49.2649],[2.4027,49.2665],[2.4031,49.267],[2.4,49.2679],[2.3999,49.2688],[2.4041,49.2728],[2.4051,49.2726],[2.4045,49.2754],[2.4096,49.2761],[2.4099,49.2745],[2.4113,49.275],[2.4113,49.276],[2.4129,49.2759],[2.4127,49.2774],[2.4142,49.2795],[2.4175,49.2806],[2.4186,49.2794],[2.4208,49.2798],[2.4214,49.2789],[2.4234,49.2799],[2.4243,49.2785],[2.4242,49.279],[2.4262,49.2792],[2.429,49.2789],[2.4298,49.2802],[2.4347,49.28],[2.4353,49.2811],[2.4353,49.2795],[2.4371,49.2794],[2.437,49.2774],[2.4383,49.2769],[2.4377,49.2759],[2.4403,49.2739],[2.4449,49.2727],[2.4458,49.2715],[2.4459,49.2694],[2.445,49.2694],[2.4459,49.268],[2.4499,49.2679],[2.4501,49.2667],[2.4514,49.2669],[2.4521,49.2656],[2.4542,49.2661],[2.4556,49.2651],[2.4568,49.266],[2.4604,49.264],[2.4568,49.2616],[2.4589,49.2599],[2.4532,49.2563],[2.4548,49.2556],[2.4544,49.2552],[2.4557,49.254],[2.4581,49.2531],[2.4554,49.2499]]]},"60415":{"type":"Polygon","coordinates":[[[2.7317,49.2071],[2.7289,49.2074],[2.7277,49.207],[2.7277,49.2056],[2.7219,49.205],[2.7225,49.2033],[2.7215,49.2019],[2.722,49.2016],[2.7163,49.201],[2.7169,49.2013],[2.7093,49.2065],[2.7054,49.2046],[2.7031,49.2061],[2.7007,49.2042],[2.6979,49.2054],[2.6958,49.2033],[2.6924,49.2044],[2.6938,49.2075],[2.6917,49.2074],[2.6926,49.2095],[2.6898,49.2111],[2.6917,49.212],[2.6866,49.2138],[2.6883,49.2159],[2.6875,49.2162],[2.6891,49.2165],[2.686,49.2176],[2.6898,49.218],[2.6922,49.2209],[2.6944,49.2212],[2.6984,49.2281],[2.7018,49.2269],[2.7031,49.2284],[2.7087,49.2266],[2.7081,49.2257],[2.714,49.225],[2.7134,49.2237],[2.722,49.2234],[2.7218,49.2214],[2.7237,49.2213],[2.7218,49.2139],[2.7303,49.2128],[2.7302,49.2091],[2.7317,49.2071]]]},"60416":{"type":"Polygon","coordinates":[[[2.5589,49.5357],[2.5628,49.5384],[2.5593,49.5409],[2.5635,49.5431],[2.5628,49.5437],[2.5659,49.5448],[2.5666,49.5442],[2.5714,49.5488],[2.5798,49.5468],[2.5801,49.5483],[2.5846,49.5459],[2.5882,49.5481],[2.5899,49.5451],[2.5932,49.5469],[2.5945,49.5467],[2.5965,49.5441],[2.6029,49.5459],[2.6044,49.5392],[2.6055,49.5373],[2.5989,49.534],[2.6025,49.5296],[2.5981,49.5297],[2.5979,49.5284],[2.5904,49.5271],[2.5835,49.5326],[2.5823,49.529],[2.5806,49.5312],[2.5773,49.5302],[2.5747,49.5337],[2.5738,49.5318],[2.5694,49.5368],[2.5677,49.5376],[2.5677,49.5386],[2.5602,49.5343],[2.5589,49.5357]]]},"60418":{"type":"Polygon","coordinates":[[[2.5844,49.5163],[2.588,49.5159],[2.591,49.5137],[2.5889,49.5133],[2.5897,49.5124],[2.5886,49.5113],[2.5908,49.5089],[2.5957,49.5076],[2.5946,49.5057],[2.5977,49.5055],[2.5982,49.5048],[2.5974,49.5045],[2.5986,49.5041],[2.5958,49.5023],[2.5996,49.5035],[2.6006,49.5023],[2.6032,49.5023],[2.6044,49.5013],[2.6,49.4956],[2.5924,49.4969],[2.5943,49.5011],[2.5904,49.4997],[2.5828,49.4991],[2.5767,49.4941],[2.5738,49.4929],[2.5681,49.4918],[2.5676,49.4931],[2.571,49.4941],[2.5703,49.495],[2.5671,49.4939],[2.5615,49.491],[2.5618,49.4905],[2.5558,49.4903],[2.5528,49.4882],[2.5515,49.4858],[2.5492,49.487],[2.554,49.4912],[2.55,49.4927],[2.5523,49.4952],[2.5506,49.4955],[2.5505,49.5013],[2.5496,49.5012],[2.5494,49.5054],[2.546,49.5059],[2.5499,49.5094],[2.5478,49.5105],[2.5464,49.5093],[2.544,49.5101],[2.5442,49.5136],[2.5495,49.5149],[2.55,49.5156],[2.5529,49.5152],[2.554,49.5141],[2.5567,49.515],[2.5583,49.516],[2.5554,49.5182],[2.5557,49.5186],[2.5565,49.518],[2.5585,49.5191],[2.56,49.5182],[2.5631,49.5185],[2.5635,49.5217],[2.5651,49.5223],[2.5673,49.5161],[2.5691,49.514],[2.5665,49.5117],[2.5738,49.5114],[2.5743,49.5107],[2.5804,49.5118],[2.5829,49.5107],[2.5851,49.5119],[2.5815,49.5158],[2.5844,49.5163]]]},"60420":{"type":"Polygon","coordinates":[[[1.777,49.185],[1.7743,49.1847],[1.7686,49.1874],[1.7696,49.1876],[1.7672,49.1902],[1.769,49.1909],[1.7684,49.1915],[1.7693,49.1918],[1.7673,49.1939],[1.7668,49.1969],[1.7657,49.197],[1.7659,49.1978],[1.7674,49.2007],[1.7685,49.2006],[1.7687,49.2023],[1.7694,49.2023],[1.7726,49.2066],[1.7705,49.2101],[1.7705,49.2114],[1.7681,49.213],[1.7652,49.2175],[1.7661,49.2213],[1.7756,49.2234],[1.7755,49.2256],[1.7823,49.2248],[1.7832,49.2257],[1.7819,49.2263],[1.7826,49.2267],[1.7819,49.2271],[1.78,49.2276],[1.7789,49.2298],[1.7737,49.2307],[1.7738,49.2318],[1.7696,49.2358],[1.7696,49.2369],[1.7712,49.2389],[1.767,49.2396],[1.7677,49.2405],[1.7671,49.2421],[1.7695,49.2421],[1.7706,49.2432],[1.7744,49.2436],[1.7763,49.2443],[1.7769,49.2457],[1.7786,49.2447],[1.7859,49.2451],[1.7909,49.2439],[1.7951,49.2361],[1.7985,49.2356],[1.7999,49.2362],[1.8048,49.2307],[1.808,49.2313],[1.812,49.2296],[1.8104,49.2289],[1.8146,49.2244],[1.8189,49.2252],[1.8323,49.2165],[1.8258,49.2123],[1.8244,49.2104],[1.8252,49.2101],[1.824,49.2091],[1.8241,49.2077],[1.8265,49.2065],[1.8239,49.2046],[1.8243,49.2019],[1.8209,49.1995],[1.8112,49.2001],[1.8075,49.2052],[1.8033,49.2069],[1.8015,49.2049],[1.7959,49.2079],[1.7912,49.2052],[1.7948,49.2033],[1.7945,49.2029],[1.7868,49.2012],[1.788,49.1988],[1.7841,49.1983],[1.7844,49.1974],[1.7822,49.1967],[1.781,49.1971],[1.7813,49.1958],[1.7853,49.1965],[1.7864,49.1943],[1.7807,49.1921],[1.7835,49.1872],[1.777,49.185]]]},"60421":{"type":"Polygon","coordinates":[[[2.6319,49.1708],[2.6161,49.1715],[2.6145,49.1668],[2.6004,49.164],[2.5996,49.1684],[2.6016,49.1769],[2.6026,49.1763],[2.6052,49.1777],[2.6058,49.1814],[2.6118,49.1846],[2.6159,49.1856],[2.616,49.1891],[2.6179,49.1894],[2.6169,49.1919],[2.6176,49.194],[2.6144,49.1942],[2.6149,49.1957],[2.6157,49.1966],[2.6167,49.1963],[2.6172,49.1978],[2.6129,49.1984],[2.6195,49.2013],[2.6268,49.209],[2.6282,49.2086],[2.6297,49.2098],[2.6315,49.2093],[2.6338,49.2123],[2.6358,49.2135],[2.6432,49.2143],[2.644,49.2137],[2.6429,49.2129],[2.6536,49.2141],[2.6518,49.2131],[2.6549,49.2112],[2.6537,49.2097],[2.6621,49.2113],[2.658,49.2088],[2.6624,49.2063],[2.665,49.2079],[2.6687,49.1984],[2.6638,49.1996],[2.6556,49.1869],[2.6533,49.1873],[2.6508,49.1849],[2.6502,49.1826],[2.6511,49.1819],[2.6472,49.1796],[2.6443,49.1768],[2.6319,49.1708]]]},"60422":{"type":"Polygon","coordinates":[[[2.7279,49.1402],[2.7272,49.14],[2.7289,49.1382],[2.7281,49.1369],[2.7194,49.1397],[2.694,49.1517],[2.6894,49.156],[2.6871,49.1564],[2.6868,49.1577],[2.6861,49.1575],[2.6865,49.1589],[2.6859,49.1599],[2.6883,49.1634],[2.687,49.1669],[2.694,49.166],[2.6978,49.1675],[2.6982,49.1665],[2.7059,49.1673],[2.711,49.1667],[2.7107,49.1661],[2.713,49.1674],[2.7181,49.1674],[2.7186,49.1625],[2.7156,49.162],[2.7175,49.1554],[2.7184,49.1486],[2.7177,49.1477],[2.7253,49.1438],[2.7279,49.1402]]]},"60423":{"type":"Polygon","coordinates":[[[2.9334,49.4935],[2.9343,49.4926],[2.9325,49.4894],[2.9314,49.4823],[2.932,49.4808],[2.9311,49.4783],[2.9328,49.4775],[2.9363,49.4701],[2.9198,49.4712],[2.9081,49.4659],[2.9081,49.4672],[2.9106,49.4681],[2.9103,49.4718],[2.9021,49.4706],[2.8953,49.4711],[2.8944,49.4706],[2.8921,49.4717],[2.8916,49.471],[2.8901,49.4712],[2.8913,49.4744],[2.8944,49.4775],[2.8976,49.479],[2.8989,49.4818],[2.8986,49.4839],[2.9015,49.4848],[2.9012,49.4863],[2.9036,49.4885],[2.9032,49.4903],[2.9046,49.4914],[2.9031,49.4925],[2.9025,49.4945],[2.9036,49.4968],[2.9052,49.4979],[2.9093,49.4992],[2.9125,49.4991],[2.9175,49.4979],[2.9215,49.4959],[2.9274,49.4947],[2.9291,49.4935],[2.9334,49.4935]]]},"60424":{"type":"Polygon","coordinates":[[[2.7058,49.4753],[2.717,49.471],[2.7141,49.4718],[2.7122,49.4713],[2.7092,49.4691],[2.7071,49.4655],[2.7105,49.4649],[2.7065,49.4584],[2.7106,49.4581],[2.709,49.4556],[2.7018,49.4562],[2.6964,49.4613],[2.691,49.4583],[2.6884,49.4598],[2.6844,49.4573],[2.6794,49.4591],[2.6859,49.4622],[2.6808,49.463],[2.6818,49.4653],[2.6813,49.4653],[2.6817,49.4662],[2.6808,49.4664],[2.6829,49.4693],[2.6794,49.4709],[2.6826,49.4742],[2.6864,49.472],[2.6889,49.4689],[2.695,49.4728],[2.6953,49.4737],[2.6946,49.4746],[2.6962,49.4767],[2.6975,49.4755],[2.7045,49.4733],[2.7058,49.4753]]]},"60425":{"type":"Polygon","coordinates":[[[2.2664,49.4959],[2.2646,49.4966],[2.2607,49.4963],[2.2496,49.4991],[2.2511,49.5027],[2.2463,49.5015],[2.247,49.5035],[2.2479,49.5034],[2.2493,49.506],[2.2508,49.5067],[2.2439,49.5085],[2.2452,49.5102],[2.2437,49.5109],[2.2488,49.5142],[2.2503,49.5187],[2.2527,49.5187],[2.2569,49.5225],[2.265,49.5247],[2.2714,49.5245],[2.2714,49.527],[2.2724,49.5292],[2.2768,49.5316],[2.293,49.5266],[2.2842,49.5185],[2.2865,49.5185],[2.2913,49.5161],[2.2955,49.5182],[2.2956,49.5199],[2.2993,49.5237],[2.3008,49.5265],[2.3053,49.5261],[2.3017,49.5214],[2.3012,49.5196],[2.3041,49.5182],[2.3028,49.5172],[2.3038,49.5168],[2.2931,49.5063],[2.2936,49.5061],[2.2929,49.5044],[2.2939,49.5021],[2.2911,49.5009],[2.2912,49.5001],[2.2901,49.5005],[2.2903,49.5],[2.2787,49.4987],[2.2753,49.4963],[2.2664,49.4959]]]},"60426":{"type":"Polygon","coordinates":[[[2.1964,49.3876],[2.2019,49.3852],[2.2072,49.384],[2.2061,49.3835],[2.2064,49.3829],[2.2008,49.3812],[2.1991,49.3799],[2.1984,49.3791],[2.1992,49.3765],[2.1984,49.3747],[2.1961,49.3765],[2.1897,49.3745],[2.182,49.377],[2.1833,49.3779],[2.1836,49.3816],[2.1877,49.3837],[2.1866,49.3842],[2.1874,49.3847],[2.1874,49.386],[2.1889,49.3864],[2.191,49.3856],[2.1964,49.3876]]]},"60427":{"type":"Polygon","coordinates":[[[1.9896,49.2236],[1.9967,49.2238],[2.0031,49.2254],[2.0058,49.2268],[2.0079,49.2265],[2.0082,49.2254],[2.012,49.2246],[2.0158,49.2255],[2.0213,49.2231],[2.0224,49.2177],[2.02,49.2144],[2.0169,49.2135],[2.0111,49.2134],[2.0103,49.215],[2.0026,49.2123],[2.0013,49.2135],[1.9973,49.2135],[1.9936,49.2122],[1.9925,49.2137],[1.9913,49.2128],[1.9879,49.2138],[1.9875,49.2131],[1.9824,49.2136],[1.9809,49.2141],[1.9816,49.215],[1.9803,49.2147],[1.9788,49.2157],[1.9808,49.2179],[1.9797,49.2219],[1.9806,49.2234],[1.9803,49.2243],[1.9871,49.2232],[1.9896,49.2236]]]},"60428":{"type":"Polygon","coordinates":[[[1.984,49.4537],[1.9859,49.4558],[1.9855,49.4562],[1.9886,49.4578],[2.0,49.4615],[2.0031,49.4637],[2.008,49.4639],[2.02,49.4614],[2.0182,49.4595],[2.0375,49.4527],[2.0371,49.4512],[2.0427,49.45],[2.044,49.4484],[2.0342,49.4438],[2.0363,49.4423],[2.034,49.4415],[2.0278,49.4375],[2.0242,49.4364],[2.0217,49.434],[2.0128,49.437],[2.0112,49.4384],[2.0064,49.4396],[2.0055,49.4391],[2.0006,49.4413],[2.0,49.4417],[2.0025,49.4432],[1.9973,49.4462],[1.9979,49.4468],[1.9916,49.449],[1.984,49.4537]]]},"60429":{"type":"Polygon","coordinates":[[[2.3293,49.1921],[2.3281,49.1918],[2.3303,49.1895],[2.3289,49.1892],[2.3284,49.1864],[2.3248,49.184],[2.3231,49.1855],[2.3216,49.1844],[2.3108,49.1867],[2.3104,49.185],[2.3085,49.1854],[2.3082,49.1846],[2.3062,49.1848],[2.3057,49.1834],[2.3013,49.184],[2.3018,49.185],[2.2983,49.1856],[2.299,49.1876],[2.2929,49.1906],[2.2925,49.1889],[2.2891,49.1903],[2.2876,49.1897],[2.2859,49.19],[2.2849,49.1886],[2.284,49.1888],[2.2827,49.193],[2.2847,49.1944],[2.2857,49.1989],[2.2882,49.2022],[2.2858,49.2028],[2.2866,49.2069],[2.2949,49.2039],[2.2945,49.2068],[2.2993,49.2062],[2.2995,49.2071],[2.3053,49.2078],[2.3077,49.2059],[2.3135,49.2037],[2.315,49.204],[2.316,49.2029],[2.3146,49.2022],[2.3178,49.1994],[2.317,49.1991],[2.3226,49.1975],[2.325,49.1977],[2.3267,49.1946],[2.3288,49.1943],[2.3293,49.1921]]]},"60430":{"type":"Polygon","coordinates":[[[2.9003,49.3148],[2.8798,49.3316],[2.8818,49.3357],[2.889,49.338],[2.8933,49.3352],[2.9067,49.3419],[2.9093,49.3407],[2.9128,49.3361],[2.9173,49.3362],[2.9206,49.3346],[2.9224,49.3344],[2.9298,49.3381],[2.9306,49.3305],[2.9443,49.3267],[2.9413,49.3243],[2.9447,49.3253],[2.956,49.3215],[2.9632,49.3201],[2.9645,49.3216],[2.9664,49.3209],[2.9657,49.3202],[2.9683,49.3196],[2.9669,49.3179],[2.9719,49.3158],[2.9723,49.312],[2.9755,49.3125],[2.9803,49.3113],[2.9771,49.308],[2.9788,49.3057],[2.9767,49.3058],[2.9764,49.3046],[2.9741,49.3043],[2.9683,49.3052],[2.9679,49.3026],[2.9701,49.3027],[2.9665,49.2991],[2.9659,49.2978],[2.9664,49.2966],[2.9637,49.2936],[2.9644,49.2924],[2.9632,49.2916],[2.9638,49.2873],[2.9519,49.2805],[2.9487,49.2813],[2.9486,49.2838],[2.9497,49.2852],[2.9446,49.2844],[2.9414,49.2824],[2.9402,49.2824],[2.9323,49.2865],[2.9311,49.2876],[2.9298,49.2912],[2.921,49.2892],[2.9164,49.291],[2.9157,49.2902],[2.9162,49.2898],[2.9158,49.2856],[2.91,49.2853],[2.9079,49.2834],[2.907,49.2843],[2.9047,49.2842],[2.9045,49.2848],[2.8971,49.2854],[2.8983,49.2881],[2.8984,49.2913],[2.8997,49.2902],[2.9013,49.2903],[2.906,49.2954],[2.9065,49.2986],[2.9116,49.3037],[2.9097,49.3044],[2.9062,49.3081],[2.902,49.3149],[2.9003,49.3148]]]},"60431":{"type":"Polygon","coordinates":[[[3.0491,49.5588],[3.0471,49.5581],[3.0449,49.5586],[3.0455,49.5565],[3.0444,49.5553],[3.0259,49.5663],[3.0273,49.5685],[3.0268,49.5705],[3.0314,49.5694],[3.0338,49.5712],[3.0317,49.5779],[3.0307,49.5787],[3.033,49.5789],[3.0334,49.5781],[3.0394,49.5789],[3.0461,49.5781],[3.0517,49.5797],[3.0529,49.5772],[3.0502,49.5742],[3.0484,49.5735],[3.0501,49.5724],[3.0506,49.5732],[3.0518,49.5731],[3.0526,49.5721],[3.0547,49.5733],[3.0551,49.5714],[3.0529,49.5704],[3.0552,49.5691],[3.0617,49.5697],[3.0627,49.5677],[3.0608,49.567],[3.0553,49.5687],[3.0517,49.5673],[3.0516,49.5652],[3.0499,49.5664],[3.0487,49.5661],[3.0484,49.5647],[3.0461,49.566],[3.0443,49.5655],[3.0484,49.5622],[3.0471,49.5605],[3.0498,49.5604],[3.0491,49.5588]]]},"60432":{"type":"MultiPolygon","coordinates":[[[[2.6194,49.0946],[2.6161,49.0939],[2.6101,49.095],[2.6061,49.0983],[2.5915,49.1051],[2.5923,49.1059],[2.5977,49.1069],[2.5999,49.109],[2.5994,49.1092],[2.6004,49.1107],[2.5992,49.1118],[2.597,49.1109],[2.5955,49.1121],[2.5966,49.1136],[2.5919,49.1156],[2.5916,49.1175],[2.5881,49.1207],[2.584,49.1216],[2.585,49.1256],[2.5875,49.1279],[2.5865,49.1306],[2.589,49.1299],[2.5915,49.1314],[2.5911,49.1323],[2.593,49.132],[2.5942,49.1307],[2.5961,49.1308],[2.5925,49.1343],[2.5876,49.1367],[2.5883,49.1381],[2.586,49.1402],[2.5909,49.1448],[2.5893,49.1457],[2.5883,49.1498],[2.5974,49.1524],[2.6078,49.1479],[2.6121,49.1483],[2.6157,49.1463],[2.6149,49.1442],[2.6117,49.1412],[2.624,49.1325],[2.6242,49.1314],[2.6226,49.1294],[2.6222,49.1273],[2.6236,49.1242],[2.6265,49.1243],[2.6266,49.1225],[2.6338,49.122],[2.6367,49.1167],[2.6388,49.1166],[2.6391,49.1154],[2.638,49.1141],[2.6336,49.1105],[2.631,49.103],[2.6271,49.1025],[2.6277,49.1018],[2.6242,49.1006],[2.6251,49.1001],[2.6244,49.0997],[2.625,49.099],[2.6221,49.0948],[2.6201,49.0953],[2.6194,49.0946]]],[[[2.5801,49.0898],[2.5786,49.092],[2.5747,49.0934],[2.5721,49.0934],[2.5731,49.0944],[2.574,49.0937],[2.5744,49.0945],[2.5755,49.0943],[2.5776,49.0971],[2.5781,49.0967],[2.5797,49.0978],[2.5838,49.0941],[2.5856,49.0939],[2.588,49.0955],[2.5888,49.0947],[2.5876,49.0935],[2.5896,49.0918],[2.5867,49.0904],[2.5878,49.087],[2.5853,49.085],[2.5813,49.0868],[2.5835,49.0886],[2.5801,49.0898]]]]},"60433":{"type":"Polygon","coordinates":[[[2.2066,49.2539],[2.1885,49.2496],[2.1878,49.2484],[2.1815,49.2495],[2.1807,49.2512],[2.1819,49.2537],[2.1795,49.2561],[2.1775,49.2559],[2.1752,49.2604],[2.1761,49.2629],[2.1733,49.2676],[2.1737,49.27],[2.1781,49.2755],[2.1787,49.2776],[2.1797,49.2827],[2.1782,49.283],[2.1788,49.2869],[2.1859,49.2846],[2.1865,49.2768],[2.1954,49.2751],[2.2042,49.2702],[2.204,49.2625],[2.2066,49.2539]]]},"60434":{"type":"Polygon","coordinates":[[[2.6487,49.5723],[2.6497,49.5718],[2.6529,49.5738],[2.6544,49.5729],[2.665,49.5772],[2.6636,49.5778],[2.6669,49.5797],[2.6663,49.5806],[2.6703,49.581],[2.6712,49.5817],[2.6769,49.5799],[2.6787,49.5827],[2.6801,49.582],[2.6791,49.5809],[2.6806,49.5805],[2.6803,49.5798],[2.6815,49.5789],[2.6892,49.5765],[2.6924,49.5763],[2.6915,49.5742],[2.6924,49.5739],[2.6959,49.5744],[2.694,49.5702],[2.6966,49.5686],[2.7003,49.568],[2.6987,49.5652],[2.6981,49.5621],[2.6895,49.563],[2.6887,49.5609],[2.6821,49.5582],[2.675,49.562],[2.6691,49.5608],[2.6696,49.5584],[2.6673,49.5579],[2.6676,49.5573],[2.6576,49.5569],[2.656,49.5579],[2.6571,49.5607],[2.6519,49.5626],[2.6509,49.5619],[2.6447,49.5635],[2.6532,49.5701],[2.6487,49.5723]]]},"60435":{"type":"Polygon","coordinates":[[[1.8835,49.5746],[1.8804,49.5738],[1.8793,49.575],[1.8786,49.5747],[1.879,49.574],[1.8779,49.5736],[1.8777,49.5742],[1.8738,49.5718],[1.8706,49.5729],[1.8682,49.5727],[1.8668,49.5742],[1.8677,49.576],[1.8628,49.5794],[1.8645,49.5801],[1.8613,49.5824],[1.8599,49.5804],[1.8572,49.5811],[1.8533,49.5799],[1.8485,49.5831],[1.8462,49.5822],[1.8456,49.5828],[1.8482,49.5839],[1.8471,49.5855],[1.8521,49.5892],[1.8678,49.5966],[1.8701,49.5931],[1.8758,49.5956],[1.8759,49.5935],[1.8778,49.594],[1.8815,49.593],[1.8896,49.5931],[1.8873,49.5872],[1.8882,49.5861],[1.8878,49.5848],[1.8886,49.5824],[1.8903,49.5812],[1.8916,49.5815],[1.8915,49.5806],[1.8873,49.5771],[1.8881,49.5762],[1.8835,49.5746]]]},"60436":{"type":"Polygon","coordinates":[[[2.4029,49.5859],[2.401,49.5846],[2.3998,49.5855],[2.3973,49.5837],[2.3937,49.5856],[2.3925,49.5789],[2.3893,49.5804],[2.3853,49.5769],[2.3762,49.5826],[2.3772,49.5833],[2.3741,49.5855],[2.3813,49.5923],[2.3828,49.5911],[2.3923,49.5966],[2.3914,49.5976],[2.3943,49.6011],[2.3982,49.6029],[2.3995,49.6045],[2.4069,49.6094],[2.4083,49.6085],[2.414,49.6116],[2.4165,49.6105],[2.4201,49.6117],[2.4246,49.6072],[2.4131,49.6029],[2.4101,49.5982],[2.4076,49.5954],[2.4061,49.595],[2.4096,49.5929],[2.4086,49.5923],[2.4049,49.5945],[2.3971,49.5898],[2.4029,49.5859]]]},"60437":{"type":"Polygon","coordinates":[[[2.2712,49.316],[2.2639,49.3122],[2.2621,49.3149],[2.2604,49.3151],[2.2589,49.3172],[2.2485,49.3191],[2.2407,49.3219],[2.239,49.3212],[2.2364,49.3232],[2.2352,49.3225],[2.2296,49.3247],[2.2249,49.3244],[2.2341,49.3351],[2.232,49.3366],[2.2342,49.3386],[2.2353,49.3373],[2.2356,49.3347],[2.2474,49.3292],[2.2499,49.3315],[2.2537,49.3303],[2.2543,49.3289],[2.2571,49.3302],[2.2603,49.3296],[2.2603,49.3284],[2.256,49.3235],[2.2656,49.3194],[2.2712,49.316]]]},"60438":{"type":"Polygon","coordinates":[[[3.0352,49.4831],[3.0367,49.4847],[3.0369,49.4866],[3.034,49.4908],[3.0282,49.4923],[3.0355,49.4959],[3.0367,49.4978],[3.0403,49.4989],[3.0448,49.4942],[3.051,49.4951],[3.0516,49.497],[3.053,49.4968],[3.0527,49.4978],[3.0564,49.4977],[3.0581,49.4958],[3.0661,49.4899],[3.0686,49.4856],[3.0763,49.4783],[3.0787,49.4724],[3.0784,49.4641],[3.0856,49.4657],[3.0907,49.4684],[3.0932,49.4688],[3.0993,49.4645],[3.1008,49.4602],[3.1005,49.4395],[3.0942,49.4407],[3.0941,49.4413],[3.0908,49.4411],[3.0885,49.44],[3.083,49.4396],[3.0809,49.4402],[3.0794,49.4394],[3.0753,49.44],[3.0738,49.4413],[3.0723,49.4411],[3.0724,49.4399],[3.0745,49.4389],[3.0737,49.4384],[3.0629,49.4389],[3.0644,49.438],[3.0613,49.4376],[3.0621,49.4438],[3.0559,49.4441],[3.0579,49.4475],[3.0545,49.4485],[3.0533,49.4507],[3.0488,49.4514],[3.0494,49.4528],[3.051,49.4539],[3.0509,49.4548],[3.0477,49.4597],[3.0507,49.4627],[3.0531,49.4636],[3.0523,49.4639],[3.0538,49.4668],[3.0515,49.4683],[3.0504,49.4679],[3.0432,49.4707],[3.0415,49.4724],[3.0421,49.4725],[3.0415,49.4735],[3.0402,49.4731],[3.0386,49.4749],[3.0377,49.4783],[3.0366,49.4788],[3.0371,49.4827],[3.0352,49.4831]]]},"60439":{"type":"Polygon","coordinates":[[[2.2673,49.3136],[2.2667,49.3141],[2.2762,49.3177],[2.2777,49.3192],[2.2762,49.32],[2.2777,49.3203],[2.2769,49.3232],[2.2824,49.3282],[2.2845,49.329],[2.2859,49.3275],[2.2899,49.3301],[2.2911,49.3318],[2.2876,49.3329],[2.2874,49.3344],[2.2883,49.3355],[2.2902,49.3359],[2.3034,49.3302],[2.3059,49.3318],[2.3076,49.3302],[2.3111,49.33],[2.3112,49.3289],[2.3127,49.3299],[2.3135,49.329],[2.3122,49.328],[2.3142,49.3274],[2.313,49.3268],[2.3172,49.325],[2.3188,49.3253],[2.3195,49.3241],[2.3233,49.3222],[2.324,49.3236],[2.3253,49.3225],[2.3276,49.3171],[2.3285,49.3176],[2.3297,49.3159],[2.3288,49.3149],[2.3298,49.3135],[2.3317,49.3145],[2.3325,49.3141],[2.3319,49.3134],[2.3339,49.3124],[2.3307,49.3113],[2.3317,49.3107],[2.3317,49.3085],[2.3158,49.3045],[2.3142,49.3052],[2.3115,49.3032],[2.3109,49.3037],[2.3083,49.3027],[2.3062,49.3049],[2.3026,49.3036],[2.3,49.306],[2.2955,49.3064],[2.2884,49.3049],[2.2873,49.3055],[2.2869,49.3046],[2.2843,49.3037],[2.2755,49.3098],[2.2712,49.3112],[2.2673,49.3136]]]},"60440":{"type":"Polygon","coordinates":[[[2.6368,49.5043],[2.6383,49.4946],[2.639,49.4945],[2.6387,49.4933],[2.652,49.4914],[2.6525,49.4907],[2.6571,49.4908],[2.653,49.4893],[2.6555,49.4891],[2.6612,49.4867],[2.6571,49.4787],[2.6526,49.474],[2.6382,49.4774],[2.6379,49.4785],[2.6331,49.4784],[2.633,49.4745],[2.6208,49.4791],[2.6213,49.4795],[2.6205,49.48],[2.6169,49.4792],[2.6121,49.4807],[2.6114,49.4834],[2.6083,49.4873],[2.6115,49.4881],[2.6078,49.4906],[2.6104,49.4912],[2.6137,49.4953],[2.6203,49.4972],[2.6241,49.4962],[2.6272,49.4979],[2.6275,49.4987],[2.6254,49.4995],[2.6273,49.502],[2.6305,49.5029],[2.6341,49.5056],[2.6368,49.5043]]]},"60441":{"type":"Polygon","coordinates":[[[2.6481,49.3954],[2.6448,49.3954],[2.6401,49.3912],[2.6352,49.3945],[2.6308,49.3898],[2.6338,49.3877],[2.6319,49.3851],[2.6226,49.3916],[2.6244,49.3974],[2.6207,49.3974],[2.6138,49.4019],[2.6177,49.4087],[2.6185,49.4094],[2.6209,49.4091],[2.6231,49.413],[2.6218,49.4133],[2.6227,49.4153],[2.6308,49.4136],[2.6337,49.4188],[2.6393,49.4173],[2.6408,49.4199],[2.6429,49.4182],[2.6455,49.4221],[2.6519,49.421],[2.6522,49.4228],[2.661,49.4231],[2.6616,49.424],[2.668,49.4214],[2.6708,49.4187],[2.6719,49.4188],[2.6732,49.4153],[2.6634,49.4097],[2.6618,49.4068],[2.6624,49.4056],[2.6593,49.4034],[2.6601,49.4008],[2.6552,49.4009],[2.6555,49.3996],[2.6517,49.3997],[2.6525,49.3989],[2.649,49.3986],[2.651,49.3954],[2.6481,49.3954]]]},"60442":{"type":"Polygon","coordinates":[[[2.113,49.5306],[2.1096,49.5331],[2.1108,49.534],[2.1092,49.5352],[2.1126,49.5375],[2.1116,49.539],[2.1228,49.5428],[2.1241,49.5415],[2.1258,49.5417],[2.1298,49.5384],[2.1366,49.5415],[2.1357,49.5432],[2.1383,49.5439],[2.1389,49.5433],[2.1426,49.5452],[2.1448,49.5436],[2.1427,49.5426],[2.1474,49.541],[2.1464,49.5394],[2.1501,49.5395],[2.1536,49.5408],[2.1562,49.5387],[2.1525,49.5359],[2.1565,49.5334],[2.1539,49.5293],[2.152,49.5299],[2.1481,49.5262],[2.1485,49.5255],[2.1469,49.5206],[2.1387,49.5213],[2.139,49.5223],[2.1262,49.5252],[2.1273,49.5271],[2.1196,49.5286],[2.1198,49.5294],[2.1187,49.5296],[2.1155,49.5297],[2.1151,49.5307],[2.113,49.5306]]]},"60443":{"type":"Polygon","coordinates":[[[2.9958,49.6619],[3.0091,49.6607],[3.0093,49.6575],[3.0082,49.6573],[3.0079,49.6563],[3.0109,49.6564],[3.0121,49.6574],[3.0141,49.6568],[3.0135,49.6563],[3.0166,49.6561],[3.0253,49.6517],[3.0267,49.6491],[3.0068,49.6388],[3.0076,49.638],[3.0062,49.6371],[3.0013,49.6364],[2.9969,49.6337],[2.9956,49.6346],[2.9952,49.634],[2.9908,49.6375],[2.9881,49.6409],[2.9883,49.6416],[2.9817,49.6439],[2.9836,49.6469],[2.9847,49.6469],[2.9872,49.6494],[2.9875,49.6514],[2.9863,49.6533],[2.9894,49.6557],[2.9905,49.6553],[2.9903,49.6561],[2.9958,49.6619]]]},"60444":{"type":"Polygon","coordinates":[[[1.8098,49.608],[1.8084,49.6068],[1.8028,49.6115],[1.7994,49.61],[1.7874,49.6105],[1.7845,49.6133],[1.7842,49.6163],[1.7857,49.6167],[1.7833,49.6188],[1.7788,49.6206],[1.7781,49.62],[1.7744,49.6224],[1.7732,49.6246],[1.7696,49.6267],[1.7587,49.6309],[1.758,49.6338],[1.7701,49.6336],[1.7715,49.6399],[1.7756,49.6403],[1.7773,49.6359],[1.7836,49.6292],[1.7886,49.6219],[1.8019,49.6276],[1.8027,49.6264],[1.8067,49.6266],[1.8085,49.6246],[1.8072,49.6243],[1.8078,49.623],[1.8063,49.6223],[1.8071,49.6208],[1.8056,49.6205],[1.8065,49.618],[1.8053,49.618],[1.8081,49.6166],[1.8065,49.6164],[1.8089,49.6131],[1.8059,49.6118],[1.8098,49.608]]]},"60445":{"type":"Polygon","coordinates":[[[3.0562,49.4978],[3.0565,49.4994],[3.0583,49.5004],[3.0596,49.5026],[3.0612,49.5019],[3.069,49.5058],[3.0679,49.5065],[3.0683,49.5073],[3.0744,49.5088],[3.0749,49.5117],[3.076,49.5128],[3.0756,49.5146],[3.0741,49.5145],[3.0741,49.5156],[3.0787,49.5173],[3.0796,49.5162],[3.0831,49.5193],[3.0836,49.5186],[3.0846,49.5196],[3.0861,49.5191],[3.0895,49.5218],[3.096,49.5189],[3.0955,49.5136],[3.0991,49.5103],[3.0998,49.5078],[3.1013,49.5066],[3.1001,49.5059],[3.1102,49.5019],[3.1157,49.4971],[3.1153,49.4962],[3.1166,49.495],[3.1218,49.4938],[3.1207,49.4909],[3.1221,49.4907],[3.1218,49.4893],[3.1224,49.4891],[3.1212,49.4875],[3.1236,49.4865],[3.1222,49.4852],[3.1243,49.4837],[3.1233,49.4824],[3.1244,49.4801],[3.1194,49.4785],[3.1116,49.4784],[3.1085,49.4759],[3.1072,49.4759],[3.1062,49.4746],[3.1069,49.474],[3.1053,49.4732],[3.1073,49.4682],[3.1002,49.469],[3.0932,49.4688],[3.0907,49.4684],[3.0856,49.4657],[3.0784,49.4641],[3.0787,49.4724],[3.0763,49.4783],[3.0686,49.4856],[3.0661,49.4899],[3.0562,49.4978]]]},"60446":{"type":"Polygon","coordinates":[[[2.8135,49.1136],[2.8034,49.1206],[2.8011,49.1229],[2.7987,49.1237],[2.789,49.1247],[2.7747,49.1241],[2.7637,49.1252],[2.7624,49.1303],[2.7637,49.1302],[2.7637,49.1319],[2.7653,49.1336],[2.7633,49.1342],[2.77,49.1391],[2.7694,49.1396],[2.7763,49.1438],[2.7784,49.1475],[2.7852,49.155],[2.7966,49.1521],[2.8005,49.1543],[2.8027,49.156],[2.8022,49.1563],[2.8125,49.1592],[2.8136,49.1554],[2.816,49.1589],[2.8169,49.1586],[2.8206,49.1634],[2.8232,49.1651],[2.82,49.1601],[2.8223,49.1544],[2.8499,49.1435],[2.8546,49.1398],[2.8586,49.1399],[2.8607,49.1388],[2.8636,49.1386],[2.8585,49.1335],[2.8577,49.1312],[2.8462,49.1327],[2.8438,49.1293],[2.845,49.129],[2.8441,49.1277],[2.8306,49.1172],[2.8135,49.1136]]]},"60447":{"type":"Polygon","coordinates":[[[2.7391,49.2757],[2.7468,49.2751],[2.7497,49.2785],[2.7533,49.2885],[2.759,49.2934],[2.7626,49.2955],[2.775,49.2977],[2.7837,49.2971],[2.7843,49.2987],[2.7872,49.3004],[2.7882,49.3026],[2.7889,49.3026],[2.7921,49.3018],[2.7923,49.301],[2.796,49.2994],[2.7947,49.2977],[2.7927,49.297],[2.7899,49.2932],[2.7853,49.2896],[2.7869,49.2893],[2.7848,49.2851],[2.7844,49.2818],[2.7814,49.2792],[2.7808,49.2777],[2.7825,49.2766],[2.7844,49.2767],[2.7839,49.2755],[2.7777,49.2757],[2.7771,49.2754],[2.7777,49.2734],[2.7916,49.2742],[2.7949,49.2724],[2.7949,49.2714],[2.8023,49.2707],[2.8022,49.2693],[2.8039,49.2694],[2.804,49.2687],[2.803,49.2687],[2.8021,49.2613],[2.8003,49.2609],[2.8005,49.2587],[2.7992,49.2582],[2.8002,49.2562],[2.7916,49.2558],[2.7911,49.2518],[2.7832,49.2507],[2.7829,49.2489],[2.7809,49.2495],[2.777,49.2448],[2.7751,49.245],[2.7749,49.2442],[2.7737,49.2443],[2.7743,49.2458],[2.7732,49.246],[2.7738,49.2475],[2.7713,49.249],[2.7685,49.2485],[2.7655,49.2519],[2.7643,49.2522],[2.7602,49.252],[2.7601,49.251],[2.7566,49.2512],[2.7565,49.2548],[2.7538,49.2567],[2.7485,49.2592],[2.7457,49.2571],[2.7388,49.2627],[2.7401,49.2645],[2.7463,49.2669],[2.7411,49.2713],[2.7391,49.2757]]]},"60448":{"type":"Polygon","coordinates":[[[3.0562,49.1019],[3.0528,49.1033],[3.0519,49.1027],[3.0468,49.1049],[3.046,49.1039],[3.0432,49.1043],[3.043,49.1033],[3.0396,49.1023],[3.0365,49.1034],[3.0356,49.1072],[3.0351,49.1073],[3.0355,49.109],[3.0344,49.1092],[3.035,49.1102],[3.0325,49.1114],[3.0324,49.113],[3.0301,49.1133],[3.0306,49.1145],[3.029,49.115],[3.0293,49.1166],[3.0348,49.1196],[3.0381,49.1193],[3.0385,49.1235],[3.0377,49.1235],[3.0396,49.1258],[3.0408,49.1257],[3.0404,49.1271],[3.0375,49.1282],[3.0412,49.1274],[3.0417,49.1255],[3.0412,49.1247],[3.0447,49.1247],[3.0432,49.1226],[3.0438,49.1223],[3.0463,49.1237],[3.0468,49.1232],[3.05,49.127],[3.0555,49.1276],[3.0556,49.1286],[3.0536,49.1281],[3.0542,49.1291],[3.0623,49.1284],[3.0634,49.1292],[3.0657,49.129],[3.066,49.128],[3.0766,49.122],[3.0766,49.121],[3.072,49.1178],[3.0695,49.1176],[3.0703,49.1163],[3.0673,49.1142],[3.0689,49.1135],[3.0672,49.1129],[3.0673,49.1118],[3.065,49.1115],[3.065,49.1105],[3.0635,49.11],[3.0626,49.1066],[3.0593,49.1039],[3.0594,49.1026],[3.0562,49.1019]]]},"60449":{"type":"Polygon","coordinates":[[[2.6393,49.5198],[2.6383,49.5232],[2.6418,49.5232],[2.6417,49.5211],[2.6454,49.5213],[2.645,49.5244],[2.6456,49.5244],[2.6466,49.5279],[2.6506,49.5281],[2.6538,49.5273],[2.6559,49.5298],[2.6566,49.5319],[2.662,49.5322],[2.6675,49.5342],[2.671,49.5331],[2.6699,49.5302],[2.6645,49.5315],[2.6637,49.5296],[2.6659,49.5289],[2.6653,49.5273],[2.6675,49.5256],[2.664,49.5223],[2.6585,49.5205],[2.6597,49.5192],[2.6635,49.5187],[2.6629,49.5172],[2.666,49.5142],[2.671,49.5148],[2.6715,49.514],[2.6636,49.5131],[2.6635,49.5104],[2.6648,49.5088],[2.6623,49.5053],[2.6643,49.5024],[2.6663,49.5017],[2.6699,49.4977],[2.669,49.4938],[2.6639,49.4951],[2.6626,49.4921],[2.6609,49.4914],[2.661,49.4894],[2.659,49.4892],[2.6596,49.4872],[2.6555,49.4891],[2.653,49.4893],[2.6571,49.4908],[2.6525,49.4907],[2.652,49.4914],[2.6387,49.4933],[2.639,49.4945],[2.6383,49.4946],[2.6368,49.5043],[2.6425,49.5129],[2.6489,49.519],[2.6393,49.5198]]]},"60450":{"type":"Polygon","coordinates":[[[2.3024,49.2079],[2.3019,49.2069],[2.2995,49.2071],[2.2993,49.2062],[2.2945,49.2068],[2.2949,49.2039],[2.2866,49.2069],[2.2858,49.2015],[2.2845,49.1991],[2.2818,49.1996],[2.2804,49.2049],[2.2753,49.2029],[2.2751,49.2035],[2.2761,49.2036],[2.2732,49.2066],[2.2748,49.2072],[2.2737,49.208],[2.2725,49.2071],[2.2703,49.2095],[2.2674,49.2087],[2.2571,49.2084],[2.2573,49.2128],[2.2564,49.2129],[2.2558,49.212],[2.2498,49.2122],[2.2488,49.2143],[2.2495,49.2214],[2.2546,49.2224],[2.2546,49.227],[2.2598,49.2258],[2.2638,49.2308],[2.2621,49.2316],[2.2641,49.232],[2.2651,49.2341],[2.2679,49.236],[2.2668,49.2384],[2.2659,49.2386],[2.2646,49.2446],[2.2651,49.2483],[2.2662,49.25],[2.2651,49.2507],[2.2734,49.256],[2.2814,49.2546],[2.2896,49.2544],[2.297,49.2553],[2.3004,49.2571],[2.3018,49.2556],[2.3008,49.2548],[2.3015,49.2543],[2.3025,49.2538],[2.3038,49.2545],[2.305,49.2537],[2.2988,49.2509],[2.3043,49.2446],[2.2986,49.2413],[2.2993,49.2404],[2.2951,49.2381],[2.2964,49.2367],[2.2922,49.2343],[2.2965,49.2296],[2.2973,49.2227],[2.3014,49.2218],[2.3032,49.2148],[2.3024,49.2079]]]},"60451":{"type":"Polygon","coordinates":[[[2.3947,49.3668],[2.3927,49.364],[2.4018,49.3622],[2.4066,49.3592],[2.4073,49.3575],[2.4064,49.3572],[2.4068,49.356],[2.4054,49.3559],[2.4059,49.354],[2.4146,49.3518],[2.4173,49.3519],[2.4237,49.3543],[2.4243,49.3533],[2.425,49.3535],[2.4276,49.3494],[2.4293,49.3491],[2.4313,49.3458],[2.4212,49.3431],[2.4233,49.3365],[2.4189,49.3359],[2.4184,49.3368],[2.4145,49.336],[2.4147,49.3372],[2.4129,49.337],[2.413,49.3383],[2.4079,49.3376],[2.4038,49.3402],[2.3994,49.3368],[2.3979,49.3382],[2.3961,49.3374],[2.3951,49.3382],[2.3919,49.3361],[2.3898,49.3374],[2.3863,49.3361],[2.3829,49.3387],[2.3835,49.339],[2.3815,49.3408],[2.3849,49.342],[2.3843,49.3436],[2.3802,49.3465],[2.3821,49.3494],[2.3851,49.3494],[2.3837,49.3551],[2.3808,49.3612],[2.3807,49.3624],[2.3817,49.3626],[2.3798,49.3647],[2.3795,49.3664],[2.3884,49.3699],[2.3905,49.366],[2.3947,49.3668]]]},"60452":{"type":"Polygon","coordinates":[[[2.0382,49.1924],[2.036,49.1911],[2.0336,49.1881],[2.0326,49.1889],[2.0284,49.188],[2.0257,49.1888],[2.0218,49.1888],[2.0185,49.1906],[2.0127,49.1916],[2.0042,49.1957],[2.0013,49.1932],[1.9997,49.1928],[1.9946,49.194],[1.9884,49.1937],[1.9821,49.1973],[1.985,49.2003],[1.9875,49.2002],[1.9891,49.2011],[1.9873,49.2018],[1.9891,49.2036],[1.9877,49.2044],[1.9906,49.2058],[1.9884,49.2077],[1.9886,49.2096],[1.9898,49.2111],[1.9973,49.2135],[2.0013,49.2135],[2.0026,49.2123],[2.0103,49.215],[2.0111,49.2134],[2.0175,49.2136],[2.0204,49.2148],[2.0224,49.2184],[2.0256,49.2189],[2.0271,49.2172],[2.0271,49.2158],[2.0289,49.2146],[2.0353,49.2139],[2.0352,49.2125],[2.0336,49.2111],[2.0353,49.2062],[2.0359,49.2062],[2.0352,49.2038],[2.0394,49.2026],[2.0372,49.1952],[2.037,49.1934],[2.0382,49.1924]]]},"60454":{"type":"Polygon","coordinates":[[[2.3483,49.3594],[2.3483,49.3614],[2.3474,49.3612],[2.3428,49.3644],[2.3383,49.3613],[2.3377,49.362],[2.3388,49.3631],[2.3434,49.3653],[2.3421,49.3661],[2.3338,49.367],[2.3314,49.3689],[2.3312,49.3702],[2.3264,49.3699],[2.3248,49.3727],[2.3194,49.372],[2.3212,49.3703],[2.316,49.3674],[2.3142,49.3683],[2.3119,49.3659],[2.3083,49.3668],[2.3089,49.3674],[2.3077,49.3677],[2.3054,49.364],[2.3024,49.3642],[2.2994,49.3619],[2.2983,49.36],[2.2964,49.3605],[2.2971,49.3628],[2.2963,49.3631],[2.2975,49.3646],[2.2967,49.3658],[2.2938,49.3672],[2.2949,49.3695],[2.2947,49.3705],[2.2935,49.371],[2.2893,49.3671],[2.288,49.3668],[2.2878,49.3656],[2.2886,49.3649],[2.2877,49.3645],[2.2864,49.3673],[2.2892,49.3689],[2.2848,49.3681],[2.285,49.3675],[2.2843,49.3695],[2.2835,49.3695],[2.2829,49.3691],[2.2834,49.3678],[2.2828,49.3664],[2.2842,49.3656],[2.2834,49.3651],[2.2835,49.3656],[2.2797,49.3662],[2.279,49.3672],[2.2799,49.3687],[2.2773,49.3697],[2.2803,49.3713],[2.2774,49.3866],[2.2765,49.3879],[2.282,49.3896],[2.2781,49.395],[2.2931,49.3995],[2.2936,49.3979],[2.2954,49.3979],[2.2943,49.4008],[2.295,49.4027],[2.2967,49.404],[2.2983,49.4023],[2.3017,49.4043],[2.3056,49.4031],[2.3065,49.4037],[2.3056,49.406],[2.3088,49.4064],[2.3088,49.4058],[2.3151,49.4053],[2.3164,49.4074],[2.3141,49.4089],[2.3163,49.4111],[2.3258,49.4084],[2.3315,49.4085],[2.335,49.4072],[2.3359,49.4086],[2.3402,49.4077],[2.347,49.4092],[2.3478,49.4107],[2.3487,49.4106],[2.3489,49.4112],[2.3474,49.4122],[2.3475,49.4146],[2.3459,49.4156],[2.3517,49.415],[2.3531,49.4159],[2.3649,49.4136],[2.374,49.4106],[2.3749,49.4086],[2.3698,49.4072],[2.3687,49.4058],[2.3692,49.4035],[2.3671,49.4034],[2.3663,49.4024],[2.3669,49.3982],[2.3655,49.3973],[2.3659,49.3956],[2.3639,49.3941],[2.3623,49.3904],[2.357,49.3903],[2.3573,49.3891],[2.3562,49.3891],[2.3564,49.3899],[2.3515,49.3901],[2.3504,49.3875],[2.349,49.3873],[2.35,49.387],[2.349,49.386],[2.3505,49.3851],[2.3512,49.3855],[2.3524,49.3841],[2.3508,49.3833],[2.3524,49.3828],[2.3522,49.3819],[2.3544,49.3804],[2.3563,49.3817],[2.3568,49.381],[2.3589,49.3809],[2.3558,49.3786],[2.3565,49.378],[2.3591,49.3781],[2.3607,49.3811],[2.3628,49.3818],[2.3631,49.381],[2.3622,49.3801],[2.3655,49.3807],[2.3682,49.3796],[2.3675,49.3808],[2.3687,49.3809],[2.3705,49.3801],[2.3692,49.3796],[2.3692,49.3782],[2.371,49.3769],[2.3757,49.377],[2.3763,49.3767],[2.3752,49.3758],[2.3773,49.3736],[2.3769,49.373],[2.379,49.3735],[2.3807,49.3729],[2.3759,49.3712],[2.3781,49.369],[2.3753,49.367],[2.3698,49.3687],[2.3687,49.3666],[2.3645,49.3678],[2.3641,49.366],[2.3603,49.366],[2.3576,49.3672],[2.3571,49.3662],[2.3562,49.3667],[2.3544,49.3609],[2.3504,49.3593],[2.3483,49.3594]]]},"60456":{"type":"Polygon","coordinates":[[[2.5607,49.4621],[2.5623,49.4649],[2.5617,49.4649],[2.5617,49.4682],[2.5624,49.4737],[2.5613,49.4737],[2.561,49.4753],[2.5618,49.4758],[2.5599,49.479],[2.5583,49.4785],[2.5562,49.4818],[2.5519,49.4838],[2.5527,49.4857],[2.5519,49.4859],[2.5525,49.4878],[2.5558,49.4903],[2.5618,49.4905],[2.5615,49.491],[2.5671,49.4939],[2.5703,49.495],[2.571,49.4941],[2.5676,49.4931],[2.5681,49.4918],[2.5738,49.4929],[2.5767,49.4941],[2.5828,49.4991],[2.5904,49.4997],[2.5943,49.5011],[2.5924,49.4969],[2.6,49.4956],[2.6014,49.4974],[2.6035,49.4967],[2.603,49.4964],[2.6043,49.4957],[2.6027,49.4935],[2.6095,49.4914],[2.6078,49.4906],[2.6115,49.4881],[2.6083,49.4873],[2.6114,49.4834],[2.6121,49.4807],[2.6115,49.48],[2.6056,49.4793],[2.6004,49.4746],[2.6015,49.4737],[2.5994,49.474],[2.5954,49.4689],[2.5975,49.4674],[2.5946,49.4666],[2.5907,49.4578],[2.5835,49.4572],[2.5837,49.4611],[2.5788,49.4582],[2.5716,49.4606],[2.5713,49.4599],[2.5642,49.4628],[2.5628,49.4616],[2.5607,49.4621]]]},"60457":{"type":"Polygon","coordinates":[[[2.1816,49.526],[2.1835,49.5271],[2.1847,49.527],[2.1822,49.5337],[2.1837,49.5336],[2.1857,49.5396],[2.1834,49.5404],[2.1852,49.5466],[2.1862,49.5474],[2.1916,49.5464],[2.1922,49.547],[2.1983,49.5443],[2.1991,49.5384],[2.1978,49.5359],[2.1988,49.5346],[2.2006,49.535],[2.2022,49.5328],[2.2057,49.5348],[2.2079,49.5334],[2.2144,49.5352],[2.2122,49.5287],[2.2102,49.5258],[2.1981,49.5202],[2.1906,49.5225],[2.1899,49.5186],[2.1871,49.519],[2.1855,49.524],[2.1816,49.526]]]},"60458":{"type":"Polygon","coordinates":[[[2.0083,49.5579],[2.0064,49.5583],[2.0063,49.5594],[2.0025,49.5617],[2.0104,49.5631],[2.0069,49.5671],[2.0046,49.5675],[1.9966,49.566],[1.9911,49.5627],[1.987,49.5651],[1.9892,49.5681],[1.998,49.5712],[2.0028,49.5744],[2.0042,49.5764],[2.0084,49.575],[2.0172,49.5772],[2.024,49.5757],[2.0306,49.5796],[2.0336,49.5781],[2.0326,49.5774],[2.0334,49.5739],[2.0323,49.5718],[2.0267,49.5696],[2.0292,49.5684],[2.0254,49.5658],[2.0281,49.5641],[2.0272,49.5635],[2.0166,49.5631],[2.017,49.5627],[2.0142,49.5611],[2.0115,49.5573],[2.0083,49.5579]]]},"60459":{"type":"Polygon","coordinates":[[[2.7291,49.5495],[2.7244,49.5528],[2.7251,49.5537],[2.7236,49.555],[2.7261,49.5562],[2.7257,49.5577],[2.7245,49.5576],[2.7245,49.5585],[2.7287,49.5594],[2.7299,49.5586],[2.735,49.5584],[2.7399,49.5568],[2.746,49.5568],[2.746,49.5562],[2.7525,49.5571],[2.7543,49.5525],[2.7622,49.5511],[2.7646,49.5493],[2.766,49.5492],[2.7646,49.5446],[2.7599,49.5429],[2.7528,49.545],[2.7533,49.5456],[2.7525,49.546],[2.7511,49.5456],[2.7488,49.5462],[2.7493,49.547],[2.7467,49.5478],[2.7429,49.5481],[2.7392,49.5501],[2.7329,49.5499],[2.7327,49.5493],[2.7302,49.5512],[2.7291,49.5495]]]},"60460":{"type":"Polygon","coordinates":[[[1.9838,49.4843],[1.963,49.4837],[1.9619,49.4813],[1.9626,49.481],[1.9611,49.4797],[1.9478,49.4805],[1.9471,49.4829],[1.9464,49.4832],[1.9454,49.4816],[1.941,49.4834],[1.9407,49.4851],[1.9415,49.4852],[1.9409,49.4864],[1.9398,49.4864],[1.9381,49.4892],[1.9391,49.4903],[1.9414,49.4887],[1.9435,49.4891],[1.9457,49.4884],[1.9524,49.4921],[1.9542,49.4942],[1.9602,49.4948],[1.9668,49.4968],[1.9698,49.4986],[1.9723,49.4943],[1.9734,49.4946],[1.9782,49.5002],[1.9879,49.4969],[1.99,49.4945],[1.9891,49.4924],[1.9874,49.4921],[1.9876,49.4913],[1.9861,49.4913],[1.9842,49.4894],[1.9848,49.489],[1.9839,49.4879],[1.9849,49.4874],[1.9844,49.4863],[1.985,49.4855],[1.9838,49.4843]]]},"60461":{"type":"Polygon","coordinates":[[[2.166,49.4684],[2.173,49.4664],[2.1888,49.4654],[2.187,49.4579],[2.1875,49.4544],[2.1842,49.4503],[2.184,49.4488],[2.1782,49.4438],[2.1766,49.4349],[2.161,49.4356],[2.1493,49.4347],[2.1469,49.439],[2.144,49.4417],[2.1464,49.4426],[2.1441,49.4455],[2.1566,49.4483],[2.1534,49.4524],[2.1557,49.4597],[2.1585,49.4635],[2.1594,49.4632],[2.1615,49.4656],[2.1658,49.467],[2.166,49.4684]]]},"60462":{"type":"Polygon","coordinates":[[[2.1976,49.304],[2.193,49.3011],[2.1913,49.3021],[2.1814,49.3013],[2.1769,49.3017],[2.1687,49.3045],[2.1656,49.3046],[2.1626,49.3104],[2.1654,49.3125],[2.1674,49.3153],[2.1836,49.3249],[2.1829,49.3256],[2.1837,49.3277],[2.187,49.3292],[2.1936,49.3301],[2.1945,49.3321],[2.1948,49.338],[2.1959,49.3381],[2.1948,49.3401],[2.2025,49.3423],[2.2066,49.3424],[2.2057,49.3413],[2.2079,49.3403],[2.2076,49.3369],[2.2188,49.3282],[2.2184,49.326],[2.2194,49.3257],[2.2196,49.3241],[2.2223,49.3224],[2.2186,49.3195],[2.211,49.3155],[2.2079,49.3119],[2.2024,49.31],[2.1999,49.3079],[2.2004,49.3074],[2.1976,49.304]]]},"60463":{"type":"Polygon","coordinates":[[[2.4566,49.2888],[2.4666,49.2876],[2.4774,49.2832],[2.479,49.2835],[2.4835,49.28],[2.4926,49.2772],[2.4935,49.2759],[2.4959,49.2748],[2.4908,49.2674],[2.4887,49.2656],[2.4834,49.27],[2.4735,49.266],[2.4731,49.267],[2.4603,49.2641],[2.4568,49.266],[2.4556,49.2651],[2.4542,49.2661],[2.4521,49.2656],[2.4514,49.2669],[2.4501,49.2667],[2.4499,49.2679],[2.4459,49.268],[2.445,49.2694],[2.4459,49.2694],[2.4458,49.2715],[2.4449,49.2727],[2.4403,49.2739],[2.4377,49.2759],[2.4383,49.2769],[2.437,49.2774],[2.4371,49.2794],[2.4353,49.2795],[2.4355,49.2822],[2.4329,49.2835],[2.4338,49.2848],[2.4352,49.2846],[2.4382,49.2822],[2.4397,49.2827],[2.4433,49.2809],[2.4479,49.2849],[2.4489,49.2838],[2.4566,49.2888]]]},"60464":{"type":"Polygon","coordinates":[[[2.4852,49.3596],[2.4735,49.3591],[2.4692,49.3623],[2.4723,49.3684],[2.4685,49.3692],[2.4692,49.3711],[2.4683,49.3747],[2.4691,49.3803],[2.4676,49.3806],[2.4734,49.3871],[2.4797,49.3922],[2.4808,49.3948],[2.4774,49.3948],[2.4772,49.3959],[2.4757,49.396],[2.4766,49.4001],[2.4838,49.4008],[2.4921,49.3988],[2.4933,49.4014],[2.5013,49.4041],[2.5104,49.4027],[2.5099,49.402],[2.5134,49.4013],[2.5125,49.3996],[2.5065,49.3942],[2.5079,49.3914],[2.5026,49.3858],[2.502,49.3789],[2.4978,49.3782],[2.4928,49.3686],[2.4852,49.3596]]]},"60465":{"type":"Polygon","coordinates":[[[2.1922,49.547],[2.1908,49.5475],[2.1896,49.5504],[2.188,49.5512],[2.1906,49.5513],[2.1906,49.5533],[2.1919,49.5532],[2.1922,49.5578],[2.1939,49.5607],[2.1974,49.5595],[2.1992,49.5614],[2.2038,49.558],[2.2082,49.5567],[2.2106,49.5568],[2.21,49.5558],[2.2117,49.5559],[2.2113,49.5554],[2.2154,49.5538],[2.2162,49.5514],[2.2201,49.5504],[2.228,49.5517],[2.2265,49.5526],[2.2331,49.5535],[2.2309,49.5551],[2.2319,49.5581],[2.2463,49.5539],[2.2435,49.5523],[2.2455,49.5511],[2.2413,49.5482],[2.2438,49.5467],[2.2395,49.5429],[2.2358,49.5419],[2.2344,49.5438],[2.2326,49.5428],[2.2312,49.5429],[2.2264,49.5465],[2.2209,49.541],[2.2164,49.5385],[2.2144,49.5352],[2.2079,49.5334],[2.2057,49.5348],[2.2023,49.5328],[2.2006,49.535],[2.1988,49.5346],[2.1978,49.5359],[2.1991,49.5384],[2.1983,49.5443],[2.1922,49.547]]]},"60466":{"type":"Polygon","coordinates":[[[2.5276,49.4357],[2.5254,49.4341],[2.5271,49.434],[2.5274,49.4326],[2.5223,49.4324],[2.5175,49.4303],[2.5087,49.429],[2.5065,49.4279],[2.5032,49.4328],[2.5017,49.4371],[2.497,49.4376],[2.4924,49.4407],[2.4932,49.4416],[2.4934,49.4444],[2.4946,49.4441],[2.495,49.4455],[2.4933,49.4459],[2.4933,49.45],[2.4947,49.4505],[2.4969,49.4538],[2.4988,49.4534],[2.4983,49.4551],[2.5055,49.455],[2.5079,49.4575],[2.5121,49.4558],[2.5113,49.4556],[2.512,49.4543],[2.5154,49.4555],[2.5166,49.4545],[2.5172,49.455],[2.5196,49.4536],[2.5168,49.4516],[2.5188,49.4512],[2.5184,49.4502],[2.5225,49.4498],[2.519,49.4463],[2.5287,49.4424],[2.5284,49.4371],[2.5276,49.4357]]]},"60468":{"type":"Polygon","coordinates":[[[2.3361,49.4949],[2.3348,49.4958],[2.3375,49.4968],[2.3343,49.4985],[2.3333,49.4982],[2.3321,49.4994],[2.3326,49.5005],[2.3416,49.5047],[2.3406,49.5052],[2.3347,49.5022],[2.3355,49.5029],[2.3336,49.5047],[2.335,49.5067],[2.3386,49.5094],[2.3345,49.5105],[2.3363,49.5125],[2.3363,49.515],[2.3383,49.5152],[2.3406,49.5196],[2.3445,49.5172],[2.3417,49.5145],[2.3472,49.5125],[2.3623,49.516],[2.3699,49.5133],[2.3707,49.512],[2.3703,49.5104],[2.3814,49.5116],[2.3871,49.5087],[2.3887,49.5099],[2.3937,49.5072],[2.3936,49.5055],[2.3955,49.5042],[2.3953,49.5023],[2.3972,49.5006],[2.3862,49.4959],[2.3841,49.4925],[2.3912,49.4925],[2.3923,49.4897],[2.3788,49.4864],[2.3735,49.4829],[2.3706,49.4853],[2.3649,49.4874],[2.3616,49.4844],[2.3565,49.4822],[2.3554,49.4827],[2.356,49.4869],[2.3553,49.4879],[2.356,49.4894],[2.354,49.4889],[2.352,49.49],[2.3526,49.4906],[2.3499,49.4916],[2.3483,49.4898],[2.3434,49.4927],[2.3439,49.4907],[2.3361,49.4949]]]},"60469":{"type":"Polygon","coordinates":[[[2.2042,49.2702],[2.2046,49.2775],[2.2069,49.2783],[2.2135,49.2837],[2.2225,49.2801],[2.2283,49.2843],[2.2287,49.2859],[2.2301,49.2869],[2.231,49.2849],[2.2374,49.2834],[2.2365,49.2822],[2.2358,49.2826],[2.2327,49.2806],[2.2332,49.2799],[2.226,49.2786],[2.2265,49.2783],[2.2257,49.2776],[2.2306,49.2729],[2.2246,49.2719],[2.2231,49.271],[2.2209,49.2672],[2.2207,49.2656],[2.2217,49.2639],[2.228,49.2615],[2.2261,49.2568],[2.2124,49.2538],[2.2066,49.2539],[2.204,49.2625],[2.2042,49.2702]]]},"60470":{"type":"Polygon","coordinates":[[[2.2885,49.5364],[2.2797,49.5304],[2.2768,49.5316],[2.2724,49.5292],[2.2714,49.527],[2.2714,49.5245],[2.265,49.5247],[2.2591,49.523],[2.2594,49.5259],[2.2527,49.5274],[2.2528,49.5256],[2.2469,49.5247],[2.2396,49.5255],[2.24,49.5277],[2.2474,49.5319],[2.2495,49.5371],[2.2467,49.5394],[2.2437,49.5408],[2.2424,49.5398],[2.2384,49.5426],[2.2438,49.5467],[2.2413,49.5482],[2.2455,49.5511],[2.2435,49.5523],[2.2541,49.5582],[2.2594,49.5647],[2.2569,49.5712],[2.259,49.5718],[2.2614,49.574],[2.2652,49.5711],[2.2685,49.5735],[2.2702,49.5722],[2.2703,49.5728],[2.2727,49.5728],[2.2737,49.5754],[2.2754,49.5741],[2.2751,49.5725],[2.2734,49.5709],[2.2747,49.568],[2.278,49.5679],[2.2802,49.5653],[2.2819,49.5669],[2.2868,49.5648],[2.2921,49.5674],[2.2938,49.5664],[2.2935,49.5651],[2.2897,49.564],[2.2884,49.5623],[2.2893,49.5597],[2.2886,49.5596],[2.2849,49.549],[2.2834,49.5493],[2.2821,49.5462],[2.2846,49.5453],[2.2842,49.5437],[2.2854,49.5419],[2.2878,49.5391],[2.2899,49.5384],[2.2885,49.5364]]]},"60471":{"type":"Polygon","coordinates":[[[2.9812,49.593],[2.98,49.5937],[2.9819,49.5944],[2.9832,49.594],[2.9896,49.5952],[2.9904,49.5943],[2.9907,49.5963],[2.9913,49.5956],[2.9947,49.5969],[2.9965,49.596],[2.9979,49.5965],[2.9979,49.5972],[3.0001,49.5974],[3.0022,49.5994],[3.0049,49.5944],[3.0068,49.6013],[3.0064,49.604],[3.0086,49.6082],[3.012,49.6078],[3.0162,49.6059],[3.017,49.6064],[3.0193,49.6053],[3.0212,49.6077],[3.0253,49.6062],[3.0261,49.6045],[3.0281,49.6044],[3.0288,49.6054],[3.0308,49.6026],[3.0245,49.5966],[3.0272,49.5958],[3.0272,49.5948],[3.0245,49.5932],[3.0241,49.5909],[3.0204,49.5873],[3.0224,49.5869],[3.026,49.584],[3.0293,49.5856],[3.0329,49.5829],[3.0341,49.5791],[3.0307,49.5787],[3.0317,49.5779],[3.0338,49.5712],[3.0314,49.5694],[3.0268,49.5705],[3.0273,49.5685],[3.0259,49.5663],[3.0444,49.5553],[3.0412,49.5537],[3.0426,49.5523],[3.0384,49.5507],[3.0379,49.5491],[3.0369,49.5486],[3.0342,49.5493],[3.0304,49.5485],[3.0296,49.5498],[3.027,49.5498],[3.0257,49.5509],[3.0238,49.549],[3.0244,49.548],[3.0239,49.5478],[3.0188,49.5505],[3.0188,49.5511],[3.0204,49.5513],[3.0202,49.5525],[3.018,49.5528],[3.0175,49.5513],[3.016,49.552],[3.0157,49.5527],[3.0172,49.5543],[3.0164,49.5554],[3.0126,49.5558],[3.0087,49.5579],[3.0072,49.5597],[3.0036,49.5605],[3.0043,49.5634],[3.0001,49.5633],[2.9994,49.5641],[3.0007,49.5654],[3.0,49.566],[2.9951,49.567],[2.9915,49.5666],[2.9896,49.5685],[2.9888,49.5724],[2.9878,49.573],[2.9859,49.572],[2.9862,49.5705],[2.9803,49.5636],[2.9781,49.5642],[2.9777,49.5652],[2.9749,49.5667],[2.9755,49.567],[2.9703,49.5693],[2.9714,49.5725],[2.9703,49.5759],[2.9717,49.5789],[2.9712,49.5806],[2.9728,49.5815],[2.9726,49.5822],[2.9768,49.5841],[2.9776,49.5849],[2.9768,49.5851],[2.98,49.5877],[2.9853,49.5895],[2.9853,49.5905],[2.9812,49.593]]]},"60472":{"type":"Polygon","coordinates":[[[2.0282,49.7109],[2.0332,49.7112],[2.0347,49.7106],[2.0354,49.7093],[2.0352,49.7077],[2.0382,49.7073],[2.0384,49.7066],[2.0352,49.7065],[2.0349,49.7051],[2.0465,49.7028],[2.0465,49.701],[2.0444,49.7],[2.0467,49.6969],[2.0576,49.6987],[2.0578,49.6979],[2.0594,49.6973],[2.0604,49.6926],[2.0587,49.6915],[2.0596,49.6906],[2.063,49.6902],[2.0642,49.6879],[2.0617,49.6869],[2.0598,49.6884],[2.0559,49.6892],[2.0483,49.6882],[2.0422,49.6902],[2.0402,49.6891],[2.0394,49.687],[2.0359,49.6859],[2.0271,49.6893],[2.024,49.6934],[2.028,49.6947],[2.0252,49.6962],[2.0252,49.6972],[2.0263,49.6974],[2.0257,49.7],[2.0287,49.6997],[2.0278,49.7031],[2.0225,49.7031],[2.0233,49.7053],[2.0224,49.7055],[2.0266,49.7102],[2.0282,49.7109]]]},"60473":{"type":"Polygon","coordinates":[[[2.8483,49.0967],[2.8484,49.0943],[2.8452,49.093],[2.8443,49.0906],[2.8451,49.0903],[2.8442,49.0867],[2.8453,49.085],[2.8343,49.083],[2.8297,49.0836],[2.82,49.0874],[2.8092,49.0975],[2.8109,49.0982],[2.8154,49.1062],[2.8135,49.1136],[2.8306,49.1172],[2.8312,49.1145],[2.8347,49.1099],[2.8361,49.1064],[2.8373,49.1071],[2.8386,49.1053],[2.8417,49.1049],[2.8431,49.1038],[2.8439,49.1016],[2.8461,49.0997],[2.847,49.0998],[2.8469,49.0974],[2.8482,49.0974],[2.8483,49.0967]]]},"60474":{"type":"Polygon","coordinates":[[[2.8985,49.6864],[2.8972,49.6882],[2.8965,49.6878],[2.8945,49.6889],[2.8955,49.6899],[2.8943,49.693],[2.8923,49.6926],[2.8921,49.695],[2.8945,49.6957],[2.8926,49.6988],[2.9057,49.6996],[2.9052,49.7003],[2.9063,49.7006],[2.9053,49.7014],[2.907,49.7013],[2.9101,49.7036],[2.9125,49.7042],[2.9109,49.7056],[2.9113,49.7063],[2.9105,49.706],[2.909,49.7076],[2.9135,49.7097],[2.9138,49.7043],[2.9147,49.7036],[2.9158,49.704],[2.9174,49.7019],[2.9169,49.7017],[2.9203,49.6988],[2.9211,49.699],[2.9223,49.6963],[2.9212,49.6956],[2.9228,49.6941],[2.9242,49.6948],[2.9273,49.6921],[2.9268,49.6917],[2.9287,49.6901],[2.9281,49.6894],[2.93,49.6896],[2.9289,49.689],[2.9307,49.688],[2.9274,49.6873],[2.9284,49.6864],[2.9255,49.683],[2.9288,49.6801],[2.9356,49.6825],[2.9361,49.6812],[2.938,49.6814],[2.9382,49.6806],[2.9354,49.6777],[2.9304,49.6767],[2.9347,49.6768],[2.9367,49.6742],[2.9168,49.6701],[2.914,49.6756],[2.9103,49.677],[2.9056,49.681],[2.903,49.6805],[2.9021,49.6831],[2.9001,49.6857],[2.8985,49.6864]]]},"60476":{"type":"Polygon","coordinates":[[[1.8656,49.6247],[1.8665,49.6234],[1.8612,49.6224],[1.8595,49.6208],[1.8608,49.6197],[1.8574,49.6176],[1.8557,49.6144],[1.8549,49.6058],[1.853,49.603],[1.8458,49.5982],[1.8449,49.5982],[1.8453,49.5986],[1.8441,49.6002],[1.8409,49.6018],[1.8392,49.6012],[1.8369,49.6017],[1.8355,49.6035],[1.8384,49.6045],[1.835,49.6067],[1.8322,49.6073],[1.8318,49.6082],[1.8283,49.6076],[1.8274,49.6104],[1.8108,49.6073],[1.8059,49.6118],[1.8089,49.6131],[1.8065,49.6164],[1.8081,49.6166],[1.8053,49.618],[1.8065,49.618],[1.8056,49.6205],[1.8071,49.6208],[1.8063,49.6223],[1.8078,49.623],[1.8072,49.6243],[1.8085,49.6246],[1.8069,49.6263],[1.8154,49.626],[1.8158,49.6252],[1.819,49.6254],[1.819,49.6248],[1.8204,49.6247],[1.827,49.6275],[1.8322,49.6343],[1.835,49.6343],[1.8345,49.6335],[1.8376,49.6304],[1.8441,49.6285],[1.8465,49.6265],[1.8493,49.6256],[1.8504,49.6223],[1.8533,49.621],[1.8548,49.6208],[1.857,49.6235],[1.8601,49.624],[1.8612,49.6233],[1.8656,49.6247]]]},"60477":{"type":"Polygon","coordinates":[[[1.8895,49.4049],[1.8916,49.4058],[1.8927,49.4095],[1.8979,49.4127],[1.895,49.4142],[1.8989,49.4175],[1.9021,49.4188],[1.9014,49.419],[1.9015,49.4208],[1.9025,49.421],[1.9036,49.4256],[1.903,49.4265],[1.8974,49.4282],[1.8931,49.4242],[1.8899,49.4252],[1.8908,49.4281],[1.9018,49.4325],[1.9102,49.4412],[1.9144,49.441],[1.9225,49.4354],[1.9395,49.4319],[1.9391,49.4305],[1.9462,49.4305],[1.9491,49.4318],[1.947,49.4301],[1.9462,49.4272],[1.9501,49.4258],[1.9528,49.4233],[1.9503,49.4171],[1.9416,49.4126],[1.9403,49.4106],[1.9382,49.4102],[1.932,49.405],[1.9282,49.4041],[1.9256,49.402],[1.926,49.4004],[1.9252,49.3987],[1.919,49.3927],[1.9066,49.3954],[1.9027,49.3976],[1.8986,49.3982],[1.8975,49.3993],[1.8926,49.3985],[1.8972,49.402],[1.8895,49.4049]]]},"60478":{"type":"Polygon","coordinates":[[[2.9698,49.2104],[2.9721,49.2083],[2.9705,49.2077],[2.9705,49.2068],[2.9658,49.2052],[2.9675,49.2048],[2.967,49.2031],[2.97,49.2016],[2.9699,49.1998],[2.9725,49.1992],[2.9728,49.1981],[2.9739,49.1977],[2.972,49.1973],[2.9717,49.1963],[2.9694,49.1952],[2.9677,49.1919],[2.9705,49.1912],[2.9694,49.1905],[2.9717,49.188],[2.9711,49.187],[2.9716,49.1859],[2.9605,49.1859],[2.9604,49.1867],[2.9548,49.1865],[2.9502,49.1872],[2.9483,49.1902],[2.9409,49.1896],[2.9416,49.1912],[2.9416,49.1954],[2.9415,49.1964],[2.9403,49.1964],[2.9423,49.1972],[2.9397,49.1993],[2.9509,49.2031],[2.96,49.204],[2.9602,49.2048],[2.9621,49.205],[2.9623,49.2061],[2.965,49.2062],[2.9647,49.2093],[2.9667,49.2096],[2.9685,49.2114],[2.9698,49.2104]]]},"60479":{"type":"Polygon","coordinates":[[[2.8796,49.1898],[2.8739,49.1911],[2.8619,49.187],[2.8504,49.1903],[2.8492,49.1896],[2.8443,49.182],[2.8372,49.1799],[2.8357,49.1775],[2.823,49.1806],[2.8185,49.1779],[2.8169,49.1791],[2.8192,49.182],[2.8188,49.1849],[2.822,49.1874],[2.8221,49.1923],[2.8245,49.1971],[2.8286,49.1987],[2.8285,49.2024],[2.8292,49.2023],[2.8299,49.2059],[2.8336,49.2058],[2.834,49.2095],[2.838,49.209],[2.8387,49.2113],[2.8447,49.2127],[2.8444,49.2133],[2.8471,49.2143],[2.8467,49.2154],[2.8489,49.2158],[2.8485,49.2165],[2.8547,49.218],[2.8599,49.2208],[2.8647,49.213],[2.8633,49.2108],[2.8647,49.2086],[2.8614,49.2075],[2.8646,49.2039],[2.8653,49.202],[2.8646,49.2012],[2.874,49.197],[2.8735,49.1956],[2.8786,49.1943],[2.8796,49.1898]]]},"60480":{"type":"Polygon","coordinates":[[[2.1862,49.5179],[2.1893,49.5164],[2.1884,49.5142],[2.1934,49.512],[2.1978,49.5131],[2.2062,49.5074],[2.2013,49.505],[2.2031,49.5028],[2.1996,49.5014],[2.1981,49.4997],[2.2018,49.4949],[2.1964,49.4933],[2.1967,49.4879],[2.1907,49.4856],[2.1734,49.4813],[2.1632,49.4774],[2.153,49.4827],[2.1627,49.4905],[2.1585,49.4924],[2.1596,49.4936],[2.1585,49.494],[2.1596,49.4953],[2.1574,49.4962],[2.1594,49.4985],[2.1624,49.5],[2.165,49.4989],[2.1712,49.5029],[2.1703,49.5036],[2.1717,49.5055],[2.1703,49.5067],[2.181,49.5171],[2.182,49.5165],[2.1831,49.5173],[2.1839,49.5166],[2.1862,49.5179]]]},"60481":{"type":"Polygon","coordinates":[[[2.8798,49.3316],[2.9003,49.3148],[2.898,49.3132],[2.8923,49.3146],[2.8875,49.3194],[2.8885,49.321],[2.8879,49.3217],[2.8802,49.319],[2.8838,49.3118],[2.8739,49.3094],[2.8726,49.3043],[2.8733,49.3024],[2.8814,49.3036],[2.8842,49.3023],[2.8774,49.298],[2.8782,49.2976],[2.8747,49.2937],[2.87,49.2932],[2.8698,49.2904],[2.8689,49.2889],[2.8636,49.2886],[2.8633,49.287],[2.8625,49.287],[2.8599,49.2821],[2.8629,49.2719],[2.8624,49.2713],[2.858,49.2721],[2.8568,49.277],[2.8539,49.2806],[2.8522,49.2799],[2.851,49.2809],[2.8487,49.2789],[2.847,49.2792],[2.8442,49.2813],[2.8449,49.282],[2.8424,49.2843],[2.8433,49.286],[2.8425,49.2864],[2.8438,49.2875],[2.8429,49.2885],[2.8359,49.2877],[2.8366,49.2911],[2.8385,49.291],[2.8395,49.2925],[2.8371,49.2931],[2.8372,49.2952],[2.8386,49.2966],[2.8354,49.2984],[2.8356,49.3011],[2.8343,49.303],[2.8342,49.3051],[2.8352,49.3052],[2.834,49.3065],[2.8299,49.3066],[2.8303,49.3083],[2.8296,49.3095],[2.8238,49.3078],[2.8217,49.3087],[2.8223,49.3099],[2.8258,49.3116],[2.8352,49.3185],[2.8365,49.3202],[2.8366,49.3222],[2.8394,49.3246],[2.8474,49.3254],[2.8524,49.3288],[2.8585,49.327],[2.8798,49.3316]]]},"60482":{"type":"Polygon","coordinates":[[[2.4991,49.1222],[2.4753,49.1285],[2.4775,49.131],[2.4826,49.1326],[2.4842,49.1364],[2.4842,49.1387],[2.5002,49.1568],[2.4946,49.1567],[2.4945,49.158],[2.5016,49.1583],[2.5048,49.1595],[2.5071,49.1593],[2.5084,49.1584],[2.5243,49.1605],[2.5259,49.1568],[2.5236,49.1543],[2.53,49.155],[2.5337,49.1534],[2.5325,49.1506],[2.5331,49.1505],[2.5327,49.1494],[2.5336,49.1493],[2.5324,49.1465],[2.5345,49.1497],[2.542,49.1453],[2.5381,49.1396],[2.5334,49.1401],[2.5267,49.1384],[2.5272,49.1373],[2.5264,49.1356],[2.5244,49.1344],[2.5225,49.1314],[2.5268,49.13],[2.5282,49.1275],[2.5277,49.1258],[2.5237,49.123],[2.518,49.1278],[2.5143,49.1264],[2.5135,49.1233],[2.5034,49.125],[2.4991,49.1222]]]},"60483":{"type":"Polygon","coordinates":[[[2.7264,49.588],[2.7238,49.5733],[2.7314,49.5717],[2.7303,49.5686],[2.7338,49.567],[2.7274,49.5619],[2.7293,49.5606],[2.7286,49.5592],[2.7267,49.5585],[2.7137,49.5568],[2.7122,49.559],[2.707,49.5588],[2.7068,49.5597],[2.6993,49.5614],[2.698,49.5603],[2.6987,49.5652],[2.7003,49.568],[2.6966,49.5686],[2.694,49.5702],[2.6959,49.5744],[2.6915,49.5742],[2.6924,49.5763],[2.6845,49.5777],[2.6842,49.5785],[2.6832,49.5781],[2.6791,49.5809],[2.6822,49.5838],[2.6865,49.5844],[2.6905,49.5866],[2.6929,49.5849],[2.6961,49.5869],[2.7027,49.5893],[2.7064,49.5876],[2.708,49.5892],[2.7079,49.5905],[2.7163,49.59],[2.7184,49.589],[2.723,49.5901],[2.7264,49.588]]]},"60484":{"type":"Polygon","coordinates":[[[2.0412,49.5351],[2.0391,49.5344],[2.0366,49.5359],[2.0353,49.535],[2.0338,49.5358],[2.0325,49.5351],[2.0292,49.537],[2.0277,49.5362],[2.0254,49.5387],[2.0174,49.5397],[2.0148,49.5408],[2.0102,49.5445],[2.0115,49.5454],[2.0089,49.5503],[2.008,49.5504],[2.0084,49.5514],[2.0074,49.5516],[2.0106,49.5576],[2.0115,49.5573],[2.0142,49.5611],[2.0179,49.5634],[2.0272,49.5635],[2.0281,49.5641],[2.0339,49.5616],[2.0373,49.5573],[2.04,49.5555],[2.0388,49.5553],[2.041,49.553],[2.0419,49.5505],[2.0409,49.5504],[2.0418,49.5484],[2.0458,49.5454],[2.0429,49.5429],[2.0456,49.5407],[2.0417,49.5383],[2.0445,49.536],[2.0412,49.5351]]]},"60485":{"type":"Polygon","coordinates":[[[2.1637,49.6124],[2.2027,49.6138],[2.2003,49.6037],[2.1976,49.5991],[2.1915,49.5979],[2.1877,49.5941],[2.1874,49.5907],[2.1857,49.5916],[2.1741,49.5911],[2.172,49.5909],[2.172,49.5891],[2.1687,49.5888],[2.1683,49.5904],[2.1617,49.5892],[2.154,49.5897],[2.1525,49.5902],[2.1517,49.5919],[2.1538,49.5932],[2.1521,49.5951],[2.1617,49.6064],[2.1637,49.6124]]]},"60486":{"type":"Polygon","coordinates":[[[2.334,49.6439],[2.3321,49.6487],[2.329,49.648],[2.3265,49.6464],[2.3213,49.6455],[2.3176,49.6459],[2.3159,49.6474],[2.3157,49.649],[2.3114,49.65],[2.3079,49.6494],[2.3042,49.6475],[2.3027,49.6499],[2.3043,49.6506],[2.3043,49.656],[2.3,49.6557],[2.3004,49.6603],[2.2912,49.6582],[2.2886,49.6625],[2.2893,49.6629],[2.2889,49.6645],[2.2915,49.6657],[2.2914,49.667],[2.2925,49.6666],[2.2931,49.6672],[2.2937,49.6684],[2.2916,49.6696],[2.2945,49.6701],[2.2945,49.6712],[2.2935,49.6718],[2.2953,49.6743],[2.2912,49.6757],[2.292,49.6786],[2.2912,49.6798],[2.2912,49.6832],[2.2901,49.6846],[2.3018,49.6811],[2.3109,49.6856],[2.3161,49.6869],[2.315,49.6898],[2.3154,49.69],[2.317,49.6876],[2.3272,49.6829],[2.3319,49.6817],[2.3334,49.6794],[2.3352,49.6793],[2.3341,49.6768],[2.3351,49.6747],[2.334,49.6731],[2.3342,49.6705],[2.3394,49.6702],[2.341,49.6672],[2.3498,49.6644],[2.3511,49.6631],[2.3507,49.6611],[2.3519,49.6632],[2.3553,49.6643],[2.3574,49.6615],[2.357,49.6612],[2.3603,49.658],[2.3567,49.6563],[2.3551,49.6574],[2.3532,49.6574],[2.3545,49.6554],[2.3475,49.6542],[2.35,49.6521],[2.342,49.6484],[2.3435,49.6467],[2.334,49.6439]]]},"60487":{"type":"Polygon","coordinates":[[[1.7764,49.1849],[1.7769,49.1842],[1.7549,49.1746],[1.7524,49.1755],[1.7401,49.1808],[1.7443,49.1833],[1.741,49.1857],[1.7405,49.1906],[1.7394,49.1906],[1.7399,49.1921],[1.7364,49.1928],[1.7373,49.1948],[1.7291,49.1952],[1.7259,49.1942],[1.7251,49.2008],[1.7225,49.201],[1.7221,49.2025],[1.7199,49.2015],[1.7184,49.2028],[1.7155,49.2027],[1.716,49.2043],[1.7149,49.2074],[1.7202,49.2068],[1.722,49.21],[1.7301,49.2097],[1.7299,49.2103],[1.7337,49.211],[1.7323,49.2156],[1.7357,49.2161],[1.7341,49.2213],[1.7405,49.2237],[1.7402,49.2215],[1.7513,49.2201],[1.75,49.2182],[1.7633,49.2193],[1.7647,49.2165],[1.7661,49.2165],[1.7681,49.213],[1.7705,49.2114],[1.7705,49.2101],[1.7726,49.2066],[1.7694,49.2023],[1.7687,49.2023],[1.7685,49.2006],[1.7674,49.2007],[1.7659,49.1978],[1.7657,49.197],[1.7668,49.1969],[1.7673,49.1939],[1.7693,49.1918],[1.7684,49.1915],[1.769,49.1909],[1.7672,49.1902],[1.7696,49.1876],[1.7686,49.1874],[1.7743,49.1847],[1.7764,49.1849]]]},"60488":{"type":"Polygon","coordinates":[[[2.9703,49.5693],[2.9755,49.567],[2.9749,49.5667],[2.9777,49.5652],[2.9781,49.5642],[2.9816,49.5626],[2.9771,49.5608],[2.9743,49.5578],[2.9759,49.5587],[2.9782,49.5582],[2.9756,49.5542],[2.9762,49.5539],[2.9761,49.5527],[2.977,49.5531],[2.9781,49.549],[2.9801,49.5479],[2.9804,49.5503],[2.9825,49.5501],[2.9823,49.5487],[2.9797,49.5463],[2.9802,49.545],[2.9753,49.5462],[2.9723,49.5484],[2.9713,49.5466],[2.9698,49.5473],[2.9663,49.5472],[2.9555,49.5504],[2.952,49.5498],[2.9505,49.5507],[2.9475,49.5493],[2.9467,49.5497],[2.9489,49.5528],[2.9481,49.5525],[2.9476,49.554],[2.9487,49.5545],[2.9484,49.5557],[2.952,49.5555],[2.9516,49.5559],[2.9529,49.5561],[2.9539,49.5591],[2.953,49.5628],[2.9598,49.5635],[2.9695,49.566],[2.9703,49.5693]]]},"60489":{"type":"Polygon","coordinates":[[[2.8185,49.1779],[2.823,49.1806],[2.8357,49.1775],[2.8372,49.1799],[2.8443,49.182],[2.8492,49.1896],[2.8504,49.1903],[2.8619,49.187],[2.8635,49.1828],[2.8615,49.1822],[2.8573,49.1635],[2.8606,49.1418],[2.8591,49.1416],[2.8586,49.1399],[2.8547,49.1397],[2.8499,49.1435],[2.8223,49.1544],[2.82,49.1601],[2.8232,49.1651],[2.8222,49.1645],[2.8207,49.165],[2.8194,49.1677],[2.824,49.1783],[2.8185,49.1779]]]},"60490":{"type":"Polygon","coordinates":[[[1.9375,49.478],[1.9454,49.4816],[1.9464,49.4832],[1.9478,49.4817],[1.9478,49.4805],[1.9611,49.4797],[1.9626,49.481],[1.9619,49.4813],[1.963,49.4837],[1.9809,49.4844],[1.9876,49.4839],[1.986,49.4823],[1.988,49.4806],[1.9865,49.48],[1.9895,49.4766],[1.9934,49.4778],[1.9929,49.4755],[1.9993,49.474],[2.0062,49.4736],[2.005,49.4663],[2.0062,49.4658],[2.006,49.4643],[2.0031,49.4637],[2.0,49.4615],[1.992,49.4587],[1.991,49.4611],[1.9868,49.4651],[1.9842,49.4649],[1.9832,49.4668],[1.9815,49.4663],[1.978,49.4699],[1.9768,49.4696],[1.9704,49.4747],[1.9684,49.4747],[1.9641,49.4776],[1.963,49.4771],[1.9623,49.4784],[1.9591,49.4774],[1.9574,49.478],[1.9532,49.4748],[1.9511,49.4742],[1.9467,49.4753],[1.9459,49.474],[1.9401,49.4714],[1.9389,49.4728],[1.94,49.4732],[1.938,49.4757],[1.9375,49.478]]]},"60491":{"type":"Polygon","coordinates":[[[2.9264,49.3689],[2.9871,49.3709],[2.9923,49.3605],[3.0088,49.3554],[3.0045,49.3528],[3.0005,49.352],[2.9967,49.3499],[2.998,49.3483],[3.001,49.3469],[3.0098,49.3485],[3.0067,49.3445],[2.9933,49.3331],[2.974,49.326],[2.969,49.3265],[2.9632,49.3201],[2.956,49.3215],[2.9447,49.3253],[2.9413,49.3243],[2.9443,49.3267],[2.936,49.3289],[2.9396,49.34],[2.9393,49.3427],[2.9379,49.3469],[2.9323,49.3539],[2.9264,49.3689]]]},"60492":{"type":"Polygon","coordinates":[[[2.9343,49.4926],[2.9334,49.4935],[2.9343,49.4958],[2.9335,49.4965],[2.9365,49.4973],[2.9451,49.4973],[2.9458,49.4986],[2.9423,49.501],[2.9397,49.5012],[2.9358,49.5035],[2.9388,49.5045],[2.9384,49.5077],[2.9428,49.5082],[2.941,49.5111],[2.9394,49.5107],[2.9378,49.5127],[2.9399,49.514],[2.939,49.5145],[2.94,49.5158],[2.9326,49.5172],[2.9328,49.5178],[2.9311,49.5183],[2.9463,49.5344],[2.9699,49.535],[2.9703,49.5335],[2.9694,49.5323],[2.9657,49.5332],[2.966,49.5323],[2.9679,49.5315],[2.9663,49.5299],[2.9661,49.5282],[2.9698,49.5271],[2.9679,49.5261],[2.9681,49.5251],[2.972,49.5244],[2.9716,49.5197],[2.9726,49.5183],[2.9698,49.5175],[2.9693,49.5159],[2.968,49.5149],[2.9625,49.5142],[2.9557,49.5146],[2.9539,49.513],[2.953,49.5079],[2.9563,49.5052],[2.9588,49.5043],[2.9635,49.5053],[2.9633,49.5035],[2.9688,49.5016],[2.9692,49.5001],[2.968,49.499],[2.9693,49.4974],[2.9644,49.4939],[2.9631,49.4918],[2.9543,49.4907],[2.9521,49.4912],[2.9498,49.4889],[2.9478,49.4902],[2.9458,49.489],[2.9431,49.4898],[2.9426,49.4893],[2.9432,49.4881],[2.9425,49.4876],[2.9402,49.4879],[2.9396,49.4895],[2.9343,49.4926]]]},"60493":{"type":"Polygon","coordinates":[[[2.0709,49.537],[2.0665,49.534],[2.0661,49.5349],[2.0628,49.5327],[2.0636,49.5308],[2.0618,49.5296],[2.0605,49.5309],[2.0566,49.5285],[2.0549,49.5293],[2.0535,49.5285],[2.0475,49.5317],[2.0462,49.5315],[2.0412,49.5351],[2.0445,49.536],[2.0417,49.5383],[2.0456,49.5407],[2.0429,49.5429],[2.0459,49.5455],[2.0524,49.5429],[2.058,49.5452],[2.0616,49.5446],[2.0624,49.5455],[2.0651,49.5449],[2.0662,49.5454],[2.069,49.5424],[2.0702,49.5423],[2.0741,49.5389],[2.0745,49.5378],[2.0709,49.537]]]},"60494":{"type":"Polygon","coordinates":[[[2.5903,49.0799],[2.5866,49.0798],[2.5864,49.0805],[2.5836,49.0798],[2.5827,49.0824],[2.5789,49.0843],[2.5804,49.0867],[2.5777,49.0878],[2.5801,49.0898],[2.5835,49.0886],[2.5813,49.0868],[2.5853,49.085],[2.5878,49.087],[2.5867,49.0904],[2.5896,49.0918],[2.5876,49.0935],[2.5888,49.0947],[2.588,49.0955],[2.5856,49.0939],[2.5838,49.0941],[2.5797,49.0978],[2.5781,49.0967],[2.5776,49.0971],[2.5755,49.0943],[2.5744,49.0945],[2.574,49.0937],[2.571,49.0951],[2.567,49.0941],[2.5652,49.0949],[2.5624,49.0978],[2.5609,49.097],[2.5579,49.0987],[2.5585,49.0991],[2.5576,49.101],[2.5591,49.102],[2.5577,49.1023],[2.5579,49.1043],[2.556,49.1094],[2.5534,49.1105],[2.5518,49.1124],[2.5524,49.1141],[2.5559,49.1177],[2.5554,49.1178],[2.557,49.1219],[2.5569,49.1237],[2.5533,49.1246],[2.5499,49.1226],[2.5477,49.1203],[2.5471,49.1164],[2.5396,49.1164],[2.5393,49.1176],[2.5377,49.1177],[2.5391,49.1193],[2.5424,49.1193],[2.544,49.1201],[2.5441,49.1213],[2.5421,49.1222],[2.5525,49.126],[2.5621,49.1403],[2.5848,49.1417],[2.5883,49.1381],[2.5876,49.1367],[2.5925,49.1343],[2.5961,49.1308],[2.5942,49.1307],[2.593,49.132],[2.5911,49.1323],[2.5915,49.1314],[2.589,49.1299],[2.5865,49.1306],[2.5875,49.1279],[2.585,49.1256],[2.584,49.1216],[2.5881,49.1207],[2.5916,49.1175],[2.5919,49.1156],[2.5966,49.1136],[2.5955,49.1121],[2.597,49.1109],[2.5992,49.1118],[2.6004,49.1107],[2.5994,49.1092],[2.5999,49.109],[2.5977,49.1069],[2.5923,49.1059],[2.5915,49.1051],[2.6061,49.0983],[2.6097,49.0955],[2.6104,49.0935],[2.6053,49.0875],[2.6,49.0842],[2.5974,49.0815],[2.596,49.0818],[2.5903,49.0799]]]},"60495":{"type":"Polygon","coordinates":[[[2.44,49.5162],[2.4375,49.5185],[2.4378,49.5209],[2.4352,49.5238],[2.4317,49.5243],[2.4307,49.5284],[2.432,49.5287],[2.4315,49.5356],[2.437,49.538],[2.4351,49.5391],[2.4361,49.5441],[2.4467,49.5419],[2.4453,49.5402],[2.4475,49.5403],[2.4478,49.5393],[2.4497,49.5402],[2.4481,49.5426],[2.4489,49.5452],[2.4519,49.5464],[2.4595,49.5459],[2.4627,49.5476],[2.4701,49.5458],[2.4765,49.5536],[2.4801,49.5509],[2.4811,49.5516],[2.4854,49.5482],[2.4792,49.5473],[2.4791,49.539],[2.4802,49.5366],[2.4792,49.5349],[2.4822,49.5362],[2.487,49.53],[2.4732,49.5244],[2.4701,49.526],[2.4629,49.5242],[2.4624,49.5259],[2.4586,49.524],[2.4579,49.5233],[2.4587,49.5223],[2.4579,49.5216],[2.457,49.5223],[2.4527,49.5224],[2.4496,49.5213],[2.4497,49.5207],[2.446,49.5202],[2.4426,49.5175],[2.441,49.5177],[2.44,49.5162]]]},"60496":{"type":"Polygon","coordinates":[[[2.4294,49.6159],[2.4291,49.6172],[2.4368,49.6184],[2.4394,49.6182],[2.4408,49.6169],[2.442,49.6171],[2.4437,49.6178],[2.4429,49.6185],[2.4461,49.6202],[2.4643,49.6232],[2.4684,49.6204],[2.4655,49.6181],[2.4678,49.6173],[2.4713,49.6192],[2.472,49.6183],[2.4694,49.6139],[2.4639,49.6079],[2.4598,49.6046],[2.4572,49.6036],[2.4478,49.6029],[2.4441,49.6078],[2.4385,49.6066],[2.4384,49.6031],[2.4376,49.6024],[2.4317,49.6066],[2.4366,49.6082],[2.4316,49.6116],[2.4294,49.6159]]]},"60497":{"type":"Polygon","coordinates":[[[2.3206,49.4814],[2.3032,49.478],[2.3022,49.479],[2.3016,49.4821],[2.3063,49.4835],[2.3043,49.4864],[2.3092,49.4889],[2.3042,49.4895],[2.3048,49.491],[2.3077,49.4907],[2.3085,49.4926],[2.3086,49.4954],[2.3057,49.4954],[2.3078,49.4977],[2.3063,49.4991],[2.3114,49.5022],[2.316,49.503],[2.3191,49.5025],[2.3183,49.5018],[2.3233,49.5016],[2.3253,49.5],[2.326,49.5003],[2.3254,49.5013],[2.3265,49.5019],[2.3347,49.5022],[2.3406,49.5052],[2.3416,49.5047],[2.3323,49.5003],[2.3321,49.4994],[2.3333,49.4982],[2.3343,49.4985],[2.3375,49.4968],[2.3348,49.4958],[2.3361,49.4949],[2.3323,49.4908],[2.3299,49.4916],[2.325,49.4895],[2.3218,49.4871],[2.3202,49.4837],[2.3206,49.4814]]]},"60498":{"type":"Polygon","coordinates":[[[2.4721,49.4951],[2.4643,49.4913],[2.4618,49.4911],[2.456,49.4891],[2.4543,49.4913],[2.4508,49.4908],[2.4507,49.4926],[2.4529,49.4943],[2.4507,49.4962],[2.4517,49.4972],[2.4483,49.4951],[2.4436,49.4944],[2.4424,49.4979],[2.4423,49.5015],[2.4409,49.5038],[2.4426,49.5056],[2.4448,49.5109],[2.44,49.5162],[2.4408,49.5174],[2.4426,49.5175],[2.446,49.5202],[2.4497,49.5207],[2.4496,49.5213],[2.4527,49.5224],[2.457,49.5223],[2.4579,49.5216],[2.4587,49.5223],[2.4579,49.5233],[2.4586,49.524],[2.4624,49.5259],[2.4629,49.5242],[2.4701,49.526],[2.4742,49.5239],[2.4782,49.5165],[2.475,49.5164],[2.4752,49.5097],[2.4733,49.5037],[2.4703,49.503],[2.4725,49.4986],[2.4731,49.4956],[2.4721,49.4951]]]},"60499":{"type":"Polygon","coordinates":[[[2.8523,49.5745],[2.8537,49.574],[2.8529,49.5733],[2.8588,49.5709],[2.8531,49.5696],[2.8512,49.5678],[2.8384,49.5626],[2.8381,49.5618],[2.8371,49.5619],[2.8265,49.5574],[2.8235,49.5544],[2.8217,49.5536],[2.8203,49.555],[2.821,49.5553],[2.8204,49.5563],[2.8166,49.5587],[2.8175,49.56],[2.8165,49.5618],[2.8129,49.5634],[2.8149,49.5638],[2.8169,49.5694],[2.8165,49.5714],[2.8146,49.5727],[2.8176,49.5747],[2.8139,49.5772],[2.8155,49.5782],[2.8037,49.5829],[2.8062,49.5855],[2.8077,49.5852],[2.8119,49.5899],[2.82,49.584],[2.8357,49.5824],[2.8351,49.5813],[2.8358,49.5806],[2.8356,49.5778],[2.8383,49.5767],[2.8377,49.5757],[2.8438,49.5733],[2.848,49.5759],[2.8523,49.5745]]]},"60500":{"type":"Polygon","coordinates":[[[2.7502,49.1165],[2.7552,49.1133],[2.7573,49.1148],[2.7624,49.1128],[2.7649,49.1078],[2.7679,49.1049],[2.7641,49.1028],[2.7839,49.0889],[2.7877,49.0856],[2.7891,49.083],[2.7797,49.0828],[2.7712,49.084],[2.7686,49.0831],[2.7432,49.0958],[2.7365,49.1004],[2.74,49.1024],[2.7362,49.1054],[2.7334,49.1064],[2.7365,49.1095],[2.7396,49.1111],[2.7404,49.1103],[2.7443,49.1122],[2.7432,49.1136],[2.7502,49.1165]]]},"60501":{"type":"Polygon","coordinates":[[[2.9415,49.4589],[2.9089,49.4498],[2.9024,49.4565],[2.8838,49.4577],[2.8839,49.4584],[2.8779,49.4602],[2.8791,49.4608],[2.8779,49.4615],[2.8768,49.4607],[2.8743,49.4615],[2.8765,49.4627],[2.8769,49.4654],[2.8725,49.4679],[2.8776,49.4692],[2.877,49.4707],[2.8777,49.4715],[2.8812,49.471],[2.8825,49.4732],[2.8839,49.4739],[2.885,49.4731],[2.8831,49.4724],[2.883,49.4715],[2.885,49.4704],[2.8846,49.4682],[2.8857,49.4676],[2.8909,49.4678],[2.8913,49.4686],[2.8897,49.4693],[2.8896,49.4702],[2.8901,49.4712],[2.8916,49.471],[2.8921,49.4717],[2.8944,49.4706],[2.8953,49.4711],[2.9021,49.4706],[2.9103,49.4718],[2.9106,49.4681],[2.9081,49.4672],[2.9081,49.4659],[2.9198,49.4712],[2.9363,49.4701],[2.9415,49.4589]]]},"60502":{"type":"Polygon","coordinates":[[[3.0597,49.6708],[3.0554,49.6698],[3.0585,49.685],[3.0585,49.6889],[3.0613,49.6956],[3.0663,49.6961],[3.0672,49.6927],[3.0703,49.6938],[3.0729,49.6908],[3.0785,49.6902],[3.0778,49.6893],[3.08,49.688],[3.076,49.6872],[3.0778,49.6826],[3.0679,49.6763],[3.0644,49.6714],[3.0597,49.6708]]]},"60503":{"type":"Polygon","coordinates":[[[2.5625,49.5883],[2.5667,49.5892],[2.5664,49.5898],[2.5715,49.5929],[2.5701,49.5939],[2.5725,49.5968],[2.5718,49.5971],[2.5734,49.5985],[2.5756,49.5993],[2.5779,49.5963],[2.5818,49.5993],[2.5902,49.5932],[2.5881,49.5921],[2.6004,49.5835],[2.6003,49.582],[2.5988,49.5789],[2.5976,49.58],[2.5944,49.5756],[2.5956,49.5746],[2.5889,49.5726],[2.5868,49.5773],[2.5836,49.5763],[2.5838,49.5787],[2.5783,49.5764],[2.5764,49.5793],[2.5739,49.581],[2.5641,49.5844],[2.5651,49.5846],[2.5625,49.5883]]]},"60504":{"type":"Polygon","coordinates":[[[2.1829,49.3256],[2.1781,49.33],[2.1751,49.3364],[2.1741,49.3358],[2.1729,49.3366],[2.17,49.3349],[2.1629,49.3346],[2.1626,49.3364],[2.1608,49.3365],[2.1609,49.3385],[2.1595,49.3385],[2.1594,49.3401],[2.1619,49.341],[2.157,49.3475],[2.1608,49.3492],[2.1617,49.3485],[2.1638,49.349],[2.1641,49.3474],[2.1665,49.3479],[2.1693,49.3489],[2.1687,49.3502],[2.173,49.3511],[2.1682,49.3578],[2.1707,49.359],[2.1698,49.3596],[2.1713,49.3604],[2.1703,49.3622],[2.1715,49.3626],[2.1711,49.364],[2.1694,49.365],[2.165,49.3648],[2.1637,49.366],[2.1658,49.3684],[2.1682,49.3677],[2.1742,49.3685],[2.1782,49.367],[2.1815,49.3712],[2.1829,49.3664],[2.1881,49.3649],[2.193,49.3614],[2.1955,49.3579],[2.1985,49.3572],[2.1986,49.3563],[2.2043,49.3559],[2.2043,49.3565],[2.2067,49.3569],[2.2059,49.3574],[2.2063,49.358],[2.2125,49.3574],[2.2174,49.3581],[2.2153,49.3566],[2.2093,49.356],[2.2056,49.3542],[2.2056,49.3528],[2.2044,49.3525],[2.2053,49.3511],[2.2077,49.3506],[2.2065,49.3497],[2.2093,49.3499],[2.2099,49.3485],[2.209,49.3478],[2.2096,49.3469],[2.206,49.3469],[2.2072,49.3423],[2.2025,49.3423],[2.1948,49.3401],[2.1959,49.3381],[2.1948,49.338],[2.1945,49.3321],[2.1936,49.3301],[2.187,49.3292],[2.1837,49.3277],[2.1829,49.3256]]]},"60505":{"type":"Polygon","coordinates":[[[2.5243,49.1605],[2.5272,49.1656],[2.5261,49.1726],[2.5391,49.169],[2.553,49.1746],[2.5567,49.186],[2.5603,49.1885],[2.5619,49.1877],[2.5657,49.1885],[2.5739,49.1875],[2.5753,49.1868],[2.5743,49.1861],[2.5826,49.1845],[2.5795,49.18],[2.5848,49.1731],[2.6054,49.1785],[2.6052,49.1777],[2.6026,49.1763],[2.6016,49.1769],[2.6011,49.1759],[2.5996,49.1684],[2.6001,49.166],[2.5709,49.1676],[2.5631,49.157],[2.5626,49.1532],[2.5617,49.1532],[2.5629,49.1523],[2.5611,49.1492],[2.5599,49.1495],[2.5586,49.1476],[2.5597,49.1472],[2.5591,49.145],[2.5622,49.1443],[2.5621,49.1403],[2.5595,49.1404],[2.555,49.1428],[2.5523,49.1395],[2.55,49.1399],[2.5433,49.1445],[2.5426,49.1458],[2.542,49.1453],[2.5345,49.1497],[2.5324,49.1465],[2.5336,49.1493],[2.5327,49.1494],[2.5331,49.1505],[2.5325,49.1506],[2.5337,49.1534],[2.53,49.155],[2.5236,49.1543],[2.5259,49.1568],[2.5243,49.1605]]]},"60506":{"type":"Polygon","coordinates":[[[3.0001,49.5633],[2.9957,49.564],[2.9883,49.5634],[2.9875,49.5612],[2.9845,49.5596],[2.9832,49.5574],[2.98,49.5562],[2.9763,49.5527],[2.9757,49.555],[2.9782,49.5582],[2.9759,49.5587],[2.9743,49.5578],[2.9771,49.5608],[2.9816,49.5626],[2.9804,49.5637],[2.9862,49.5705],[2.9859,49.572],[2.9878,49.573],[2.9888,49.5724],[2.9896,49.5685],[2.9914,49.5666],[2.9951,49.567],[3.0,49.566],[3.0007,49.5654],[2.9994,49.5641],[3.0001,49.5633]]]},"60507":{"type":"Polygon","coordinates":[[[3.0444,49.5553],[3.0455,49.5565],[3.0448,49.5584],[3.0453,49.5587],[3.0471,49.5581],[3.0491,49.5588],[3.0506,49.5581],[3.0511,49.5569],[3.0561,49.5561],[3.0572,49.5552],[3.0609,49.556],[3.0621,49.5539],[3.0614,49.5526],[3.0619,49.5505],[3.0658,49.5471],[3.0681,49.5469],[3.0702,49.5399],[3.0751,49.5371],[3.074,49.5359],[3.0688,49.5393],[3.0602,49.5373],[3.0634,49.5361],[3.0639,49.5352],[3.0628,49.5316],[3.0631,49.5297],[3.056,49.5317],[3.0561,49.5307],[3.0497,49.5308],[3.0463,49.5361],[3.0444,49.5351],[3.0353,49.5377],[3.0315,49.5359],[3.0292,49.5358],[3.0269,49.5383],[3.0185,49.5413],[3.0172,49.5433],[3.0211,49.5455],[3.0262,49.5472],[3.0259,49.5485],[3.0274,49.5497],[3.0296,49.5498],[3.0304,49.5485],[3.0342,49.5493],[3.0373,49.5487],[3.0384,49.5507],[3.0426,49.5523],[3.0413,49.5538],[3.0444,49.5553]]]},"60508":{"type":"Polygon","coordinates":[[[2.6222,49.2778],[2.6233,49.28],[2.6236,49.2855],[2.6207,49.2898],[2.6171,49.2932],[2.6145,49.2928],[2.6127,49.2952],[2.611,49.3042],[2.6165,49.3039],[2.6193,49.3051],[2.6202,49.3061],[2.6204,49.3099],[2.6247,49.3141],[2.625,49.3155],[2.6261,49.3153],[2.6284,49.3171],[2.6535,49.3235],[2.6715,49.3204],[2.68,49.3156],[2.689,49.3136],[2.689,49.3125],[2.688,49.3122],[2.6874,49.3102],[2.6865,49.3097],[2.686,49.3066],[2.6838,49.3065],[2.6813,49.3039],[2.6796,49.3039],[2.6789,49.3017],[2.676,49.2994],[2.672,49.2985],[2.6725,49.2942],[2.6659,49.2839],[2.6668,49.2826],[2.6684,49.2824],[2.6668,49.2782],[2.6222,49.2778]]]},"60509":{"type":"Polygon","coordinates":[[[2.6078,49.3387],[2.6098,49.3383],[2.6182,49.3304],[2.6244,49.332],[2.6296,49.3258],[2.6346,49.3276],[2.6391,49.3278],[2.6488,49.3267],[2.6535,49.3235],[2.6284,49.3171],[2.6261,49.3153],[2.625,49.3155],[2.6247,49.3141],[2.6207,49.3103],[2.6202,49.3061],[2.6193,49.3051],[2.6165,49.3039],[2.611,49.3042],[2.6127,49.2952],[2.6145,49.2928],[2.6171,49.2932],[2.6207,49.2898],[2.6236,49.2855],[2.6233,49.28],[2.6222,49.2778],[2.5937,49.2772],[2.5857,49.2786],[2.5846,49.2886],[2.5833,49.2897],[2.5842,49.2894],[2.5845,49.2911],[2.5853,49.291],[2.5841,49.2934],[2.5848,49.2937],[2.5836,49.2953],[2.5842,49.2956],[2.5816,49.2977],[2.5804,49.3],[2.5801,49.3034],[2.5766,49.3035],[2.5768,49.3054],[2.5792,49.3069],[2.5918,49.3081],[2.604,49.3105],[2.6032,49.3328],[2.6058,49.3352],[2.6053,49.3355],[2.6063,49.3366],[2.6054,49.337],[2.6078,49.3387]]]},"60510":{"type":"Polygon","coordinates":[[[1.916,49.3211],[1.914,49.3232],[1.913,49.3299],[1.9118,49.33],[1.9098,49.3328],[1.9113,49.3332],[1.9139,49.3362],[1.9098,49.3371],[1.9062,49.3396],[1.9183,49.3471],[1.9276,49.3493],[1.9335,49.3515],[1.9359,49.3495],[1.9374,49.3448],[1.9389,49.3429],[1.9367,49.3402],[1.9368,49.3385],[1.9401,49.3379],[1.9456,49.3393],[1.9389,49.3341],[1.936,49.3338],[1.9359,49.3326],[1.9343,49.3323],[1.931,49.3335],[1.9303,49.3298],[1.9324,49.3282],[1.926,49.3252],[1.9246,49.3238],[1.9222,49.3249],[1.916,49.3211]]]},"60511":{"type":"Polygon","coordinates":[[[2.98,49.5937],[2.9812,49.593],[2.9804,49.5926],[2.9766,49.5929],[2.9748,49.592],[2.9718,49.5928],[2.9718,49.5921],[2.9659,49.5906],[2.9635,49.5909],[2.9601,49.5899],[2.9591,49.5913],[2.9503,49.5889],[2.9495,49.5901],[2.9444,49.5901],[2.9437,49.5918],[2.9415,49.5933],[2.9344,49.5947],[2.9294,49.5982],[2.9345,49.6005],[2.9398,49.6052],[2.9491,49.5991],[2.9515,49.6022],[2.9576,49.6069],[2.98,49.5937]]]},"60512":{"type":"Polygon","coordinates":[[[2.0368,49.2647],[2.0294,49.2625],[2.0256,49.2634],[2.0208,49.2605],[2.0202,49.2609],[2.0213,49.2631],[2.0174,49.2649],[2.0125,49.2648],[2.0104,49.2658],[2.0085,49.2654],[2.0082,49.2661],[2.0097,49.2669],[2.0076,49.268],[2.007,49.2697],[2.0124,49.2724],[2.0155,49.2714],[2.0162,49.2683],[2.0182,49.2685],[2.0214,49.2727],[2.0243,49.2726],[2.0266,49.2735],[2.0279,49.2729],[2.0288,49.2738],[2.028,49.2742],[2.0312,49.2758],[2.0299,49.2765],[2.0318,49.279],[2.0313,49.282],[2.0328,49.2828],[2.0361,49.2874],[2.0333,49.2907],[2.0371,49.2925],[2.036,49.295],[2.0405,49.294],[2.0398,49.2925],[2.0408,49.2893],[2.0436,49.2862],[2.0457,49.2869],[2.0455,49.284],[2.0471,49.2797],[2.0457,49.2763],[2.0386,49.2731],[2.0406,49.2726],[2.0358,49.2715],[2.039,49.2691],[2.0368,49.2647]]]},"60513":{"type":"Polygon","coordinates":[[[2.3747,49.2187],[2.3779,49.2165],[2.3769,49.2157],[2.3779,49.2146],[2.3804,49.2137],[2.3832,49.2114],[2.3813,49.2106],[2.385,49.2077],[2.3851,49.2049],[2.386,49.205],[2.3866,49.2036],[2.3913,49.2043],[2.3915,49.2035],[2.3859,49.197],[2.3858,49.1955],[2.3787,49.1918],[2.3755,49.1852],[2.3709,49.1854],[2.3667,49.1903],[2.3628,49.1904],[2.363,49.1922],[2.347,49.1938],[2.3463,49.1928],[2.3436,49.1935],[2.3443,49.1942],[2.3372,49.1982],[2.3356,49.197],[2.3317,49.2003],[2.3344,49.2028],[2.3352,49.2061],[2.3335,49.2063],[2.3339,49.2109],[2.3392,49.2106],[2.3392,49.2148],[2.3648,49.2167],[2.3689,49.2196],[2.3726,49.2177],[2.3747,49.2187]]]},"60514":{"type":"Polygon","coordinates":[[[1.9976,49.6257],[2.0081,49.6299],[2.0111,49.6325],[2.0216,49.6264],[2.0187,49.6264],[2.017,49.6222],[2.0218,49.6206],[2.0214,49.62],[2.0194,49.6185],[2.0156,49.6187],[2.0073,49.6153],[2.0042,49.6104],[2.0042,49.607],[2.0018,49.6074],[2.007,49.6006],[2.0016,49.5997],[1.9992,49.6048],[1.9951,49.6057],[1.9864,49.6103],[1.9866,49.611],[1.9767,49.6126],[1.977,49.6133],[1.976,49.6135],[1.9778,49.6157],[1.9788,49.6194],[1.9782,49.6198],[1.979,49.6206],[1.9909,49.625],[1.9976,49.6257]]]},"60515":{"type":"Polygon","coordinates":[[[2.526,49.4792],[2.5281,49.4794],[2.5267,49.4798],[2.5259,49.4813],[2.5303,49.4816],[2.5337,49.484],[2.5423,49.4875],[2.5449,49.4879],[2.5481,49.4867],[2.55,49.4878],[2.5492,49.487],[2.5527,49.4857],[2.5519,49.4838],[2.5562,49.4818],[2.5583,49.4785],[2.5599,49.479],[2.5618,49.4758],[2.561,49.4753],[2.5613,49.4737],[2.5624,49.4737],[2.5617,49.4682],[2.5617,49.4649],[2.5623,49.4649],[2.56,49.4599],[2.5578,49.4596],[2.5502,49.4551],[2.5411,49.4528],[2.5384,49.4536],[2.5384,49.4571],[2.5333,49.4585],[2.5303,49.4549],[2.5275,49.4551],[2.5246,49.4566],[2.5227,49.4553],[2.5262,49.4538],[2.5225,49.4498],[2.5184,49.4502],[2.5188,49.4512],[2.5168,49.4516],[2.5196,49.4537],[2.5154,49.4555],[2.512,49.4543],[2.5113,49.4556],[2.5121,49.4558],[2.5091,49.4569],[2.5128,49.4607],[2.5285,49.467],[2.5266,49.4688],[2.527,49.4721],[2.5241,49.4737],[2.5294,49.4774],[2.526,49.4792]]]},"60516":{"type":"Polygon","coordinates":[[[1.7455,49.4091],[1.7492,49.4103],[1.7591,49.4099],[1.759,49.4127],[1.7597,49.4142],[1.761,49.4161],[1.7635,49.4159],[1.7647,49.4176],[1.763,49.4184],[1.7669,49.4232],[1.7704,49.4223],[1.7726,49.4239],[1.7731,49.4257],[1.7778,49.4249],[1.7801,49.4271],[1.7867,49.4283],[1.7957,49.4257],[1.7979,49.4239],[1.7951,49.4228],[1.7912,49.4192],[1.7897,49.4159],[1.7902,49.4148],[1.7928,49.4145],[1.7936,49.4132],[1.7957,49.4132],[1.7962,49.4112],[1.7993,49.4113],[1.8019,49.4103],[1.8029,49.4095],[1.8023,49.409],[1.8064,49.407],[1.8053,49.4051],[1.8051,49.4022],[1.7988,49.4017],[1.7914,49.3995],[1.785,49.3998],[1.7777,49.3972],[1.7731,49.3991],[1.7718,49.3968],[1.7703,49.3971],[1.7709,49.399],[1.7627,49.403],[1.7606,49.4034],[1.7569,49.4055],[1.7524,49.4043],[1.7455,49.4091]]]},"60517":{"type":"Polygon","coordinates":[[[2.2488,49.2143],[2.2457,49.2137],[2.2433,49.2086],[2.2418,49.2087],[2.2421,49.2076],[2.2393,49.2062],[2.2308,49.2052],[2.2274,49.2078],[2.2237,49.2053],[2.2217,49.2074],[2.2203,49.2072],[2.2186,49.2095],[2.2177,49.2093],[2.2177,49.2127],[2.2142,49.2134],[2.2156,49.2165],[2.2144,49.2206],[2.2163,49.2227],[2.2246,49.2227],[2.2196,49.2253],[2.2256,49.2282],[2.2214,49.2333],[2.2341,49.2349],[2.2357,49.2314],[2.2361,49.2258],[2.239,49.2251],[2.2388,49.2243],[2.2409,49.2245],[2.2405,49.2233],[2.2421,49.2229],[2.2431,49.225],[2.2497,49.2223],[2.2488,49.2143]]]},"60518":{"type":"Polygon","coordinates":[[[2.1886,49.5709],[2.189,49.572],[2.1824,49.5738],[2.183,49.5748],[2.177,49.5756],[2.1773,49.5772],[2.1762,49.5772],[2.1761,49.5784],[2.174,49.5782],[2.1749,49.5792],[2.1744,49.5808],[2.1755,49.5808],[2.1761,49.582],[2.1746,49.5823],[2.1751,49.5858],[2.1773,49.5856],[2.1769,49.5893],[2.1764,49.5891],[2.1758,49.591],[2.1848,49.5917],[2.1874,49.5907],[2.1877,49.5941],[2.1915,49.5979],[2.1947,49.5982],[2.1965,49.5992],[2.1999,49.5984],[2.1997,49.5979],[2.201,49.5976],[2.1976,49.5926],[2.1972,49.5899],[2.2026,49.5833],[2.2048,49.5836],[2.2054,49.5815],[2.2085,49.5809],[2.2073,49.5794],[2.2056,49.58],[2.2037,49.5791],[2.2026,49.5764],[2.1998,49.5735],[2.194,49.5735],[2.193,49.5716],[2.1909,49.5722],[2.19,49.5707],[2.1886,49.5709]]]},"60519":{"type":"Polygon","coordinates":[[[3.0427,49.6391],[3.0457,49.6432],[3.0519,49.6412],[3.0572,49.6422],[3.0565,49.6432],[3.0605,49.6458],[3.0612,49.6453],[3.0603,49.6445],[3.0659,49.6437],[3.0665,49.6414],[3.0691,49.6388],[3.0695,49.6351],[3.0682,49.6347],[3.0682,49.6319],[3.0671,49.6299],[3.0673,49.6282],[3.0703,49.6244],[3.0702,49.6228],[3.0685,49.6224],[3.069,49.6216],[3.0679,49.6208],[3.0591,49.6201],[3.0567,49.6213],[3.0537,49.6206],[3.0481,49.6212],[3.0472,49.6214],[3.0462,49.6241],[3.0428,49.6249],[3.0405,49.6242],[3.0374,49.6272],[3.0386,49.6303],[3.0384,49.6313],[3.0373,49.6315],[3.0427,49.6391]]]},"60520":{"type":"Polygon","coordinates":[[[2.3063,49.4991],[2.3022,49.5016],[2.3006,49.5044],[2.2942,49.5079],[2.3038,49.5168],[2.3028,49.5172],[2.3041,49.5182],[2.3012,49.5196],[2.3017,49.5214],[2.3069,49.5278],[2.309,49.5273],[2.3085,49.5237],[2.3159,49.5174],[2.3211,49.5152],[2.3238,49.515],[2.3246,49.5158],[2.3265,49.5152],[2.3344,49.5104],[2.3386,49.5094],[2.335,49.5067],[2.3336,49.5047],[2.3355,49.5029],[2.3346,49.5025],[2.327,49.502],[2.3254,49.5013],[2.326,49.5003],[2.3253,49.5],[2.3233,49.5016],[2.3183,49.5018],[2.3191,49.5025],[2.316,49.503],[2.3114,49.5022],[2.3063,49.4991]]]},"60521":{"type":"Polygon","coordinates":[[[1.7677,49.7316],[1.764,49.7325],[1.7652,49.7353],[1.7641,49.7352],[1.7644,49.7363],[1.7576,49.7376],[1.7506,49.7365],[1.7459,49.7387],[1.7436,49.7427],[1.7438,49.7454],[1.7424,49.7454],[1.7427,49.7472],[1.7389,49.7492],[1.7405,49.7498],[1.7395,49.7508],[1.7416,49.7509],[1.7416,49.7522],[1.745,49.7545],[1.7446,49.7556],[1.7479,49.7581],[1.7473,49.7608],[1.7498,49.7639],[1.7552,49.7621],[1.7548,49.7615],[1.7567,49.7611],[1.758,49.7593],[1.7621,49.7571],[1.7663,49.7566],[1.7812,49.7587],[1.7909,49.7576],[1.7915,49.7559],[1.794,49.7547],[1.7898,49.7541],[1.7899,49.7518],[1.7851,49.7512],[1.7882,49.744],[1.7892,49.7443],[1.7897,49.7433],[1.7896,49.7421],[1.7952,49.736],[1.7962,49.7365],[1.7971,49.7295],[1.7985,49.7284],[1.796,49.7271],[1.7856,49.7334],[1.7857,49.7339],[1.7822,49.7352],[1.781,49.7351],[1.7807,49.7338],[1.7736,49.7335],[1.7729,49.7309],[1.7677,49.7316]]]},"60522":{"type":"Polygon","coordinates":[[[2.3981,49.5483],[2.3953,49.5516],[2.411,49.5576],[2.4097,49.5591],[2.4148,49.5587],[2.4146,49.5576],[2.4208,49.5573],[2.4222,49.558],[2.4362,49.5566],[2.4358,49.5529],[2.4384,49.5526],[2.4367,49.548],[2.4351,49.5391],[2.437,49.538],[2.4282,49.5342],[2.4276,49.5364],[2.4226,49.5363],[2.4224,49.5373],[2.4203,49.5371],[2.4197,49.5378],[2.41,49.5342],[2.3981,49.5483]]]},"60523":{"type":"Polygon","coordinates":[[[2.0213,49.4087],[2.0164,49.4008],[2.0141,49.4009],[2.0152,49.4001],[2.0142,49.3991],[2.0097,49.3968],[2.0062,49.3936],[2.0025,49.395],[1.9959,49.4001],[1.9892,49.3967],[1.9818,49.3946],[1.9792,49.3967],[1.9764,49.3959],[1.9739,49.3964],[1.974,49.3982],[1.9762,49.3991],[1.9759,49.4001],[1.9789,49.4028],[1.9796,49.4052],[1.9848,49.4078],[1.9784,49.4139],[1.9811,49.4161],[1.987,49.418],[1.9885,49.4196],[2.0047,49.417],[2.0053,49.4179],[2.0083,49.4182],[2.012,49.4176],[2.0131,49.4191],[2.0163,49.416],[2.018,49.4161],[2.0189,49.4144],[2.0185,49.4139],[2.0202,49.413],[2.0189,49.4124],[2.0197,49.411],[2.0188,49.41],[2.0201,49.41],[2.0197,49.4094],[2.0213,49.4087]]]},"60524":{"type":"Polygon","coordinates":[[[2.4502,49.3352],[2.4468,49.3344],[2.4448,49.333],[2.4454,49.332],[2.4449,49.331],[2.4489,49.3243],[2.4403,49.3222],[2.4332,49.3222],[2.4324,49.321],[2.4241,49.3235],[2.4237,49.3264],[2.4218,49.3268],[2.4233,49.3317],[2.4294,49.3328],[2.4259,49.3342],[2.4233,49.3363],[2.4212,49.3431],[2.4298,49.3456],[2.4393,49.3466],[2.4392,49.3474],[2.4407,49.3474],[2.4405,49.3481],[2.4413,49.3469],[2.441,49.3451],[2.4402,49.345],[2.441,49.3447],[2.4405,49.3424],[2.4414,49.3402],[2.4453,49.3426],[2.4502,49.3352]]]},"60525":{"type":"Polygon","coordinates":[[[2.7388,49.2627],[2.7301,49.254],[2.7278,49.2575],[2.7188,49.2495],[2.7151,49.2475],[2.7126,49.2492],[2.7094,49.2479],[2.705,49.2506],[2.7036,49.25],[2.6965,49.2602],[2.6998,49.2602],[2.7003,49.262],[2.7019,49.2618],[2.7005,49.2666],[2.7021,49.2673],[2.7044,49.2701],[2.7054,49.2701],[2.7066,49.2725],[2.7171,49.2709],[2.7183,49.2767],[2.7264,49.2747],[2.7387,49.2762],[2.7411,49.2713],[2.7463,49.2669],[2.7401,49.2645],[2.7388,49.2627]]]},"60526":{"type":"Polygon","coordinates":[[[2.5352,49.5242],[2.5339,49.5224],[2.5259,49.5179],[2.5317,49.5143],[2.5277,49.5139],[2.5259,49.5146],[2.5225,49.5134],[2.5199,49.5117],[2.5219,49.5104],[2.5206,49.5078],[2.5176,49.5082],[2.5168,49.5034],[2.5123,49.503],[2.5095,49.5001],[2.507,49.5014],[2.5041,49.4995],[2.5003,49.5009],[2.4953,49.4976],[2.4974,49.4963],[2.4956,49.4959],[2.4928,49.4976],[2.4889,49.4965],[2.4829,49.4985],[2.4803,49.4967],[2.4726,49.4984],[2.4703,49.503],[2.4733,49.5037],[2.4752,49.5097],[2.475,49.5164],[2.4782,49.5165],[2.4742,49.5239],[2.4732,49.5244],[2.4926,49.532],[2.4943,49.5307],[2.4963,49.5315],[2.5018,49.5273],[2.5034,49.5299],[2.5121,49.5282],[2.5135,49.5266],[2.517,49.5281],[2.5193,49.5259],[2.5206,49.5263],[2.5221,49.5241],[2.526,49.5238],[2.529,49.525],[2.5352,49.5242]]]},"60527":{"type":"Polygon","coordinates":[[[2.9014,49.0853],[2.8961,49.088],[2.9048,49.0941],[2.9042,49.0962],[2.9061,49.0985],[2.9019,49.1004],[2.902,49.1013],[2.9182,49.0991],[2.9207,49.1002],[2.9247,49.1044],[2.9282,49.1064],[2.9267,49.1094],[2.9294,49.11],[2.9335,49.1104],[2.9352,49.1087],[2.9345,49.1084],[2.9349,49.1077],[2.9333,49.1072],[2.9338,49.1061],[2.9383,49.1048],[2.9364,49.103],[2.9399,49.1002],[2.9424,49.0999],[2.9363,49.0971],[2.9328,49.0986],[2.93,49.0952],[2.936,49.0929],[2.9353,49.0919],[2.9416,49.0908],[2.9418,49.0932],[2.9432,49.0921],[2.946,49.0936],[2.9469,49.093],[2.945,49.0904],[2.9439,49.0901],[2.9455,49.0887],[2.9462,49.0891],[2.9443,49.0852],[2.9442,49.0816],[2.9429,49.0783],[2.9417,49.0784],[2.9415,49.0773],[2.9341,49.0791],[2.9348,49.0809],[2.9335,49.0816],[2.9291,49.0798],[2.9296,49.0795],[2.9286,49.0787],[2.9233,49.0776],[2.9214,49.0789],[2.9114,49.0821],[2.9062,49.0829],[2.9014,49.0853]]]},"60528":{"type":"Polygon","coordinates":[[[1.8536,49.257],[1.8637,49.2553],[1.8649,49.2559],[1.8769,49.2532],[1.8748,49.245],[1.8801,49.2429],[1.8788,49.2404],[1.8861,49.2389],[1.8862,49.2376],[1.8751,49.2371],[1.8672,49.2338],[1.8665,49.2318],[1.8628,49.2317],[1.8626,49.231],[1.8657,49.2306],[1.8646,49.2295],[1.8663,49.2288],[1.8534,49.2238],[1.8516,49.2243],[1.8478,49.2222],[1.8383,49.2293],[1.8381,49.2325],[1.8392,49.2331],[1.8393,49.235],[1.8374,49.2367],[1.835,49.241],[1.8357,49.245],[1.8365,49.247],[1.8417,49.2483],[1.8426,49.2498],[1.8456,49.2516],[1.8492,49.2518],[1.8501,49.2526],[1.8501,49.2543],[1.8533,49.2541],[1.8513,49.2558],[1.8536,49.257]]]},"60529":{"type":"Polygon","coordinates":[[[2.479,49.4226],[2.4818,49.4302],[2.4824,49.4344],[2.4832,49.4348],[2.4853,49.4339],[2.4869,49.4363],[2.4924,49.4407],[2.497,49.4376],[2.5017,49.4371],[2.5032,49.4328],[2.5065,49.4279],[2.5038,49.4261],[2.5021,49.4269],[2.4981,49.4233],[2.4992,49.4227],[2.495,49.4196],[2.4932,49.4208],[2.4899,49.4203],[2.49,49.4208],[2.4863,49.4219],[2.479,49.4226]]]},"60530":{"type":"Polygon","coordinates":[[[2.2744,49.4374],[2.2724,49.4406],[2.2773,49.4424],[2.2765,49.4438],[2.2721,49.4476],[2.2704,49.4508],[2.2672,49.4531],[2.2655,49.4564],[2.2612,49.4586],[2.2652,49.4583],[2.27,49.4612],[2.2709,49.4606],[2.278,49.4622],[2.28,49.4598],[2.2954,49.4638],[2.2959,49.4628],[2.3022,49.4586],[2.3102,49.4554],[2.3164,49.4494],[2.3209,49.4464],[2.3208,49.4456],[2.3167,49.4434],[2.3112,49.4464],[2.3035,49.4352],[2.307,49.4336],[2.3032,49.431],[2.3025,49.4314],[2.2997,49.4301],[2.2962,49.4349],[2.2931,49.437],[2.2929,49.4349],[2.2855,49.4353],[2.285,49.4303],[2.2797,49.4305],[2.2807,49.4344],[2.2744,49.4374]]]},"60531":{"type":"Polygon","coordinates":[[[2.717,49.471],[2.7208,49.4696],[2.723,49.4671],[2.7257,49.4662],[2.7265,49.463],[2.729,49.4633],[2.7286,49.4592],[2.7301,49.4575],[2.7299,49.455],[2.7312,49.454],[2.7264,49.451],[2.7222,49.4469],[2.7244,49.4416],[2.7264,49.4419],[2.7276,49.4391],[2.7268,49.439],[2.7277,49.4348],[2.7255,49.4334],[2.7278,49.4329],[2.7283,49.4314],[2.7302,49.4303],[2.7391,49.4283],[2.7401,49.4249],[2.7376,49.4198],[2.7368,49.4202],[2.7351,49.4173],[2.729,49.4146],[2.7259,49.4123],[2.7243,49.4138],[2.7222,49.4135],[2.7217,49.4151],[2.7195,49.4141],[2.7192,49.4148],[2.7164,49.4156],[2.7127,49.4138],[2.6993,49.4138],[2.6944,49.4112],[2.6907,49.4154],[2.6876,49.415],[2.6855,49.4157],[2.6801,49.4141],[2.675,49.4142],[2.6732,49.4153],[2.6719,49.4188],[2.6708,49.4187],[2.668,49.4214],[2.6616,49.4239],[2.6596,49.4263],[2.6585,49.4263],[2.6594,49.4337],[2.6687,49.4382],[2.673,49.4383],[2.6734,49.4412],[2.6811,49.4396],[2.6823,49.4417],[2.6883,49.4431],[2.6934,49.4451],[2.6913,49.4468],[2.6976,49.4494],[2.6982,49.451],[2.6994,49.4513],[2.7018,49.4562],[2.709,49.4556],[2.7106,49.4581],[2.7065,49.4584],[2.7105,49.4649],[2.7071,49.4655],[2.7092,49.4691],[2.7122,49.4713],[2.7141,49.4718],[2.717,49.471]]]},"60533":{"type":"Polygon","coordinates":[[[2.7032,49.5288],[2.7068,49.5303],[2.7111,49.5346],[2.7128,49.5354],[2.7133,49.5374],[2.7105,49.5368],[2.714,49.5422],[2.7228,49.5419],[2.7258,49.5441],[2.7302,49.5512],[2.7327,49.5493],[2.7329,49.5499],[2.7392,49.5501],[2.7429,49.5481],[2.7467,49.5478],[2.7493,49.547],[2.7488,49.5462],[2.7511,49.5456],[2.7525,49.546],[2.7533,49.5456],[2.7528,49.545],[2.7606,49.5429],[2.7607,49.5358],[2.7595,49.5348],[2.7596,49.5324],[2.7527,49.5282],[2.7563,49.5276],[2.7558,49.5269],[2.7477,49.5236],[2.7363,49.5231],[2.7364,49.524],[2.7277,49.5257],[2.7204,49.5189],[2.7201,49.5169],[2.7192,49.5168],[2.7088,49.5193],[2.7077,49.5223],[2.703,49.5269],[2.7032,49.5288]]]},"60534":{"type":"Polygon","coordinates":[[[2.9587,49.4105],[2.9522,49.4109],[2.937,49.4146],[2.9313,49.4147],[2.9277,49.4157],[2.922,49.4187],[2.9199,49.4213],[2.9187,49.4246],[2.9215,49.4251],[2.9218,49.4265],[2.9242,49.4272],[2.9282,49.4302],[2.9343,49.4373],[2.9349,49.4394],[2.9341,49.4408],[2.9294,49.4417],[2.9415,49.4589],[2.9511,49.4392],[2.9497,49.4373],[2.9519,49.4381],[2.951,49.4365],[2.9553,49.436],[2.9529,49.4338],[2.9569,49.4328],[2.9642,49.4327],[2.9667,49.4302],[2.9653,49.4294],[2.9684,49.426],[2.97,49.4247],[2.9707,49.425],[2.9757,49.423],[2.9736,49.42],[2.9682,49.4207],[2.964,49.4188],[2.9591,49.418],[2.9587,49.4105]]]},"60535":{"type":"Polygon","coordinates":[[[2.1862,49.5179],[2.1871,49.519],[2.1899,49.5186],[2.1906,49.5225],[2.1981,49.5202],[2.2102,49.5258],[2.2116,49.5274],[2.2144,49.5352],[2.2163,49.5383],[2.2209,49.541],[2.2264,49.5465],[2.2312,49.5429],[2.2326,49.5428],[2.2344,49.5438],[2.2358,49.5419],[2.2384,49.5426],[2.2424,49.5398],[2.2437,49.5408],[2.2495,49.5371],[2.2474,49.5319],[2.24,49.5277],[2.2396,49.5255],[2.2469,49.5247],[2.2528,49.5256],[2.2527,49.5274],[2.2594,49.5259],[2.2591,49.523],[2.2569,49.5225],[2.2527,49.5187],[2.2503,49.5187],[2.2488,49.5142],[2.2437,49.5109],[2.2452,49.5102],[2.2426,49.507],[2.2376,49.5025],[2.2333,49.5003],[2.2299,49.5003],[2.2203,49.5083],[2.2179,49.5065],[2.2139,49.5081],[2.2135,49.507],[2.207,49.5112],[2.203,49.5093],[2.1978,49.5131],[2.1933,49.5121],[2.1884,49.5142],[2.1893,49.5164],[2.1862,49.5179]],[[2.2182,49.5103],[2.2213,49.5091],[2.2223,49.5096],[2.2189,49.5109],[2.2182,49.5103]]]},"60536":{"type":"Polygon","coordinates":[[[2.7005,49.292],[2.6973,49.2962],[2.69,49.3027],[2.6896,49.3055],[2.6882,49.3053],[2.686,49.3066],[2.6865,49.3097],[2.6874,49.3102],[2.688,49.3122],[2.689,49.3125],[2.689,49.3136],[2.6979,49.315],[2.704,49.3143],[2.7034,49.3127],[2.7046,49.3112],[2.7044,49.3086],[2.7033,49.307],[2.705,49.3066],[2.7034,49.3049],[2.705,49.303],[2.7103,49.3002],[2.7098,49.2945],[2.709,49.2944],[2.7077,49.2919],[2.7005,49.292]]]},"60537":{"type":"Polygon","coordinates":[[[2.8809,49.5255],[2.8783,49.5267],[2.8815,49.5325],[2.8878,49.5303],[2.8902,49.532],[2.8927,49.5325],[2.8923,49.5335],[2.8906,49.5335],[2.8871,49.5355],[2.8923,49.5372],[2.8912,49.5397],[2.8921,49.5403],[2.8943,49.5405],[2.895,49.5399],[2.8995,49.5394],[2.9013,49.5413],[2.9174,49.542],[2.9198,49.5411],[2.9208,49.5423],[2.9233,49.542],[2.926,49.5392],[2.9308,49.5384],[2.9353,49.5362],[2.9413,49.5349],[2.9469,49.5351],[2.9311,49.5183],[2.9328,49.5178],[2.9326,49.5172],[2.94,49.5158],[2.939,49.5145],[2.9399,49.514],[2.9378,49.5127],[2.9394,49.5107],[2.941,49.5111],[2.9428,49.5082],[2.9384,49.5077],[2.9388,49.5045],[2.9358,49.5035],[2.9397,49.5012],[2.9423,49.501],[2.9458,49.4986],[2.9451,49.4973],[2.9365,49.4973],[2.9335,49.4965],[2.9343,49.4958],[2.9334,49.4935],[2.9292,49.4934],[2.9274,49.4947],[2.9252,49.4949],[2.9263,49.4966],[2.9248,49.4971],[2.9262,49.4989],[2.9217,49.4999],[2.9195,49.4997],[2.9189,49.505],[2.9154,49.5048],[2.9121,49.5059],[2.9131,49.5071],[2.9112,49.5079],[2.9115,49.5085],[2.9091,49.5089],[2.9095,49.5094],[2.908,49.5136],[2.9056,49.5147],[2.9033,49.5181],[2.8997,49.5197],[2.8992,49.5216],[2.9003,49.5228],[2.899,49.5239],[2.8863,49.5294],[2.8835,49.5266],[2.8809,49.5255]]]},"60538":{"type":"Polygon","coordinates":[[[2.7835,49.5686],[2.7845,49.5663],[2.7855,49.5661],[2.7827,49.5616],[2.767,49.5491],[2.7646,49.5493],[2.7636,49.5506],[2.7618,49.5512],[2.7543,49.5525],[2.7525,49.5571],[2.746,49.5562],[2.746,49.5568],[2.7399,49.5568],[2.735,49.5584],[2.7299,49.5586],[2.7287,49.5594],[2.7292,49.5611],[2.7274,49.5619],[2.7338,49.567],[2.7365,49.5653],[2.7375,49.5675],[2.7386,49.5672],[2.7393,49.5687],[2.7416,49.5683],[2.742,49.5691],[2.7535,49.5682],[2.7555,49.567],[2.7559,49.566],[2.7547,49.564],[2.7556,49.5638],[2.7835,49.5686]]]},"60539":{"type":"Polygon","coordinates":[[[2.5261,49.2989],[2.5227,49.2985],[2.5154,49.2948],[2.5127,49.2925],[2.5106,49.2887],[2.5017,49.2969],[2.5029,49.2976],[2.4995,49.2987],[2.4955,49.3023],[2.4989,49.3048],[2.4998,49.3041],[2.5015,49.3052],[2.5047,49.3031],[2.5078,49.3022],[2.5144,49.3087],[2.5185,49.3079],[2.5189,49.3084],[2.5204,49.3079],[2.5202,49.3073],[2.5232,49.3069],[2.5261,49.2989]]]},"60540":{"type":"Polygon","coordinates":[[[2.7565,49.3439],[2.7462,49.3433],[2.7409,49.3389],[2.7362,49.3309],[2.7311,49.3347],[2.7266,49.3395],[2.722,49.3483],[2.7263,49.351],[2.7299,49.3519],[2.7306,49.3571],[2.7333,49.3562],[2.7344,49.3573],[2.741,49.3589],[2.7417,49.3577],[2.7424,49.3582],[2.7443,49.3567],[2.7456,49.3571],[2.7577,49.3446],[2.7565,49.3439]]]},"60541":{"type":"Polygon","coordinates":[[[2.686,49.3066],[2.6882,49.3053],[2.6896,49.3055],[2.69,49.3027],[2.692,49.3015],[2.6947,49.2979],[2.6964,49.2971],[2.7001,49.293],[2.7007,49.2915],[2.6975,49.291],[2.6983,49.2882],[2.6974,49.2856],[2.6994,49.2835],[2.7009,49.2787],[2.6803,49.2824],[2.6793,49.2802],[2.6735,49.2795],[2.6722,49.2798],[2.672,49.2812],[2.6668,49.2826],[2.6659,49.2839],[2.6725,49.2942],[2.672,49.2985],[2.676,49.2994],[2.6789,49.3017],[2.6796,49.3039],[2.6813,49.3039],[2.6838,49.3065],[2.686,49.3066]]]},"60542":{"type":"Polygon","coordinates":[[[2.2156,49.4035],[2.212,49.401],[2.215,49.3995],[2.2138,49.3978],[2.2092,49.4002],[2.2078,49.3984],[2.1966,49.392],[2.1949,49.3927],[2.1937,49.3919],[2.1928,49.3931],[2.1909,49.3938],[2.1914,49.3944],[2.1895,49.3952],[2.1865,49.3938],[2.1788,49.3924],[2.1762,49.3938],[2.1717,49.3947],[2.1664,49.3945],[2.168,49.3966],[2.1669,49.3996],[2.17,49.4012],[2.167,49.4033],[2.1709,49.4063],[2.1698,49.4066],[2.1728,49.4094],[2.1785,49.4172],[2.1801,49.4171],[2.1823,49.4208],[2.19,49.4186],[2.1919,49.4177],[2.192,49.4162],[2.1939,49.416],[2.1942,49.4127],[2.1971,49.4125],[2.1949,49.4093],[2.2061,49.4051],[2.2099,49.4092],[2.2139,49.4075],[2.2134,49.4045],[2.2156,49.4035]]]},"60543":{"type":"Polygon","coordinates":[[[2.829,49.2437],[2.8229,49.2478],[2.8149,49.2502],[2.8054,49.255],[2.8002,49.2562],[2.7992,49.2582],[2.8005,49.2587],[2.8003,49.2609],[2.8021,49.2613],[2.803,49.2687],[2.804,49.2687],[2.8039,49.2694],[2.8022,49.2693],[2.8023,49.2707],[2.8053,49.2695],[2.8086,49.27],[2.8088,49.271],[2.8057,49.2764],[2.8248,49.2733],[2.8275,49.2683],[2.8291,49.2684],[2.8318,49.263],[2.8317,49.2612],[2.8343,49.261],[2.8348,49.2596],[2.8374,49.2594],[2.8377,49.2587],[2.8397,49.2591],[2.8384,49.2544],[2.8375,49.2544],[2.8381,49.2502],[2.8388,49.2502],[2.8395,49.2483],[2.8385,49.2482],[2.8388,49.2473],[2.837,49.2469],[2.8381,49.2452],[2.8302,49.2433],[2.829,49.2437]]]},"60544":{"type":"Polygon","coordinates":[[[2.4454,49.653],[2.4494,49.6472],[2.4406,49.6438],[2.4389,49.646],[2.4281,49.6446],[2.4287,49.6439],[2.4278,49.6434],[2.4272,49.6404],[2.4237,49.6349],[2.4187,49.6319],[2.4137,49.6342],[2.402,49.6368],[2.4002,49.635],[2.3969,49.6372],[2.3962,49.6367],[2.3885,49.6436],[2.38,49.6472],[2.3781,49.6465],[2.3771,49.6471],[2.3735,49.6562],[2.3884,49.6559],[2.4023,49.6606],[2.4035,49.6597],[2.4054,49.6607],[2.4062,49.6601],[2.4054,49.6618],[2.4126,49.663],[2.4138,49.661],[2.413,49.6604],[2.417,49.6586],[2.4214,49.6574],[2.423,49.659],[2.4272,49.6571],[2.4261,49.6565],[2.4265,49.6562],[2.4308,49.6569],[2.4322,49.6553],[2.4364,49.6564],[2.4388,49.6542],[2.4413,49.6543],[2.4425,49.6531],[2.4454,49.653]]]},"60545":{"type":"Polygon","coordinates":[[[1.7868,49.6959],[1.7779,49.6979],[1.774,49.6997],[1.7729,49.7021],[1.7742,49.7077],[1.771,49.7103],[1.7697,49.7126],[1.7706,49.7144],[1.7725,49.7144],[1.7736,49.7163],[1.7751,49.7164],[1.7771,49.7189],[1.7782,49.7225],[1.7808,49.7239],[1.7842,49.7236],[1.7859,49.7225],[1.7981,49.7282],[1.8008,49.7244],[1.8049,49.7217],[1.8119,49.7227],[1.8204,49.7227],[1.8226,49.7176],[1.8296,49.7201],[1.8301,49.7186],[1.8362,49.7189],[1.8363,49.7177],[1.8378,49.7182],[1.8415,49.7128],[1.838,49.7125],[1.838,49.709],[1.8374,49.7087],[1.8246,49.7057],[1.8211,49.7055],[1.818,49.7068],[1.8162,49.7066],[1.8048,49.701],[1.8043,49.7015],[1.7978,49.6995],[1.7942,49.6993],[1.7953,49.6973],[1.7932,49.6962],[1.7868,49.6959]]]},"60546":{"type":"Polygon","coordinates":[[[2.7561,49.1971],[2.7596,49.1995],[2.7621,49.1951],[2.7664,49.1952],[2.7653,49.199],[2.7689,49.1992],[2.7703,49.1986],[2.7771,49.2012],[2.7771,49.1999],[2.7807,49.2],[2.7825,49.1992],[2.7896,49.2],[2.7908,49.1996],[2.792,49.1964],[2.7912,49.1962],[2.7927,49.1952],[2.7942,49.196],[2.8029,49.194],[2.8039,49.1946],[2.8028,49.1911],[2.8053,49.1907],[2.8051,49.1898],[2.8087,49.1905],[2.8078,49.18],[2.7899,49.173],[2.7787,49.1713],[2.7753,49.17],[2.7733,49.1703],[2.7699,49.1686],[2.7647,49.1686],[2.7646,49.1709],[2.7663,49.1711],[2.7648,49.176],[2.7665,49.1792],[2.7704,49.1822],[2.766,49.1833],[2.7699,49.1844],[2.7689,49.1859],[2.7584,49.1845],[2.7577,49.1872],[2.7564,49.1871],[2.7565,49.1878],[2.7552,49.1871],[2.7526,49.1901],[2.7494,49.1908],[2.7514,49.1924],[2.7507,49.1928],[2.7517,49.1937],[2.7553,49.1959],[2.7546,49.1968],[2.7561,49.1971]]]},"60547":{"type":"Polygon","coordinates":[[[2.4834,49.3437],[2.4901,49.3473],[2.4931,49.3469],[2.4932,49.3486],[2.4961,49.3501],[2.4988,49.3493],[2.5031,49.3499],[2.5065,49.3488],[2.5061,49.3471],[2.5119,49.3455],[2.5331,49.3425],[2.5245,49.3277],[2.5215,49.3277],[2.5169,49.3279],[2.513,49.3302],[2.5119,49.3296],[2.5041,49.3359],[2.4993,49.3347],[2.4929,49.3362],[2.4926,49.3356],[2.4848,49.3399],[2.4863,49.3421],[2.4834,49.3437]]]},"60548":{"type":"Polygon","coordinates":[[[2.9949,49.1171],[3.0062,49.116],[3.0055,49.1056],[3.0068,49.1054],[3.0068,49.1037],[3.0109,49.1022],[3.0113,49.0999],[3.0107,49.0987],[3.0117,49.0971],[3.0116,49.0957],[3.0106,49.0951],[3.0085,49.0958],[3.0076,49.0942],[3.0045,49.0934],[3.0032,49.0916],[3.0024,49.0917],[3.004,49.0887],[3.0018,49.0887],[3.0009,49.0895],[2.9994,49.0874],[2.9964,49.0877],[2.9954,49.0855],[2.9912,49.084],[2.9883,49.0793],[2.9877,49.0767],[2.9883,49.072],[2.9868,49.0709],[2.9833,49.072],[2.9829,49.0711],[2.9796,49.0728],[2.9776,49.0722],[2.9773,49.0743],[2.9753,49.0739],[2.9746,49.0751],[2.975,49.0763],[2.9718,49.0837],[2.9725,49.0854],[2.9691,49.0856],[2.9702,49.0863],[2.9774,49.1002],[2.9733,49.101],[2.9744,49.1029],[2.9724,49.103],[2.9733,49.1045],[2.9733,49.1093],[2.9788,49.1082],[2.981,49.1087],[2.983,49.1076],[2.9861,49.1074],[2.9866,49.1067],[2.9882,49.107],[2.9903,49.1086],[2.9903,49.1096],[2.9925,49.11],[2.9936,49.1128],[2.9943,49.1128],[2.9949,49.1171]]]},"60549":{"type":"Polygon","coordinates":[[[2.1172,49.5985],[2.1178,49.5983],[2.1162,49.5956],[2.1166,49.5943],[2.1154,49.594],[2.1168,49.5936],[2.1161,49.5921],[2.1099,49.5882],[2.1092,49.5866],[2.108,49.587],[2.1034,49.5843],[2.0988,49.5856],[2.1019,49.5824],[2.1005,49.582],[2.0987,49.5788],[2.1018,49.5772],[2.1017,49.5763],[2.0999,49.5732],[2.1005,49.5731],[2.1,49.5706],[2.0941,49.5668],[2.0916,49.5656],[2.0916,49.5676],[2.0887,49.5645],[2.0876,49.5645],[2.0794,49.5657],[2.0736,49.568],[2.0725,49.5667],[2.0667,49.5688],[2.075,49.5735],[2.076,49.5751],[2.0719,49.5782],[2.0696,49.5818],[2.0677,49.5814],[2.0664,49.5825],[2.0655,49.5821],[2.0651,49.5835],[2.0621,49.5837],[2.0632,49.5931],[2.0677,49.5973],[2.076,49.5936],[2.0804,49.5967],[2.0811,49.5946],[2.0926,49.6015],[2.0961,49.6004],[2.097,49.6026],[2.1172,49.5985]]]},"60550":{"type":"Polygon","coordinates":[[[1.9767,49.6103],[1.978,49.6109],[1.9789,49.6104],[1.9806,49.6123],[1.9866,49.611],[1.9864,49.6103],[1.9951,49.6057],[1.9992,49.6048],[2.0007,49.6025],[2.0033,49.5939],[1.9985,49.5903],[1.9947,49.5897],[1.995,49.588],[1.9938,49.5874],[1.9828,49.5852],[1.9834,49.587],[1.9814,49.5882],[1.9828,49.5885],[1.9836,49.5908],[1.9852,49.5925],[1.9842,49.5942],[1.9802,49.5947],[1.9801,49.5978],[1.9818,49.6002],[1.9803,49.6009],[1.985,49.6036],[1.9767,49.6103]]]},"60551":{"type":"Polygon","coordinates":[[[2.3795,49.2896],[2.3792,49.2974],[2.3779,49.2982],[2.3788,49.2989],[2.3779,49.2994],[2.3785,49.2998],[2.3786,49.3041],[2.3795,49.3053],[2.3878,49.3076],[2.3886,49.3068],[2.3908,49.3074],[2.3913,49.3066],[2.3929,49.307],[2.392,49.3085],[2.3967,49.3094],[2.3976,49.308],[2.4019,49.3065],[2.4114,49.3008],[2.4111,49.2967],[2.4079,49.2961],[2.408,49.2955],[2.401,49.2943],[2.3989,49.2965],[2.3975,49.2958],[2.3982,49.295],[2.3974,49.2903],[2.3909,49.2904],[2.3886,49.2881],[2.385,49.2876],[2.3776,49.2842],[2.3795,49.2896]]]},"60552":{"type":"Polygon","coordinates":[[[2.902,49.2133],[2.901,49.2132],[2.9026,49.2109],[2.9008,49.2107],[2.9009,49.2077],[2.8992,49.2048],[2.8996,49.2019],[2.8978,49.2015],[2.8965,49.1986],[2.883,49.1957],[2.8825,49.1967],[2.8737,49.1961],[2.874,49.197],[2.8646,49.2012],[2.8653,49.202],[2.8646,49.2039],[2.8614,49.2075],[2.8647,49.2086],[2.8633,49.2108],[2.8647,49.213],[2.8599,49.2208],[2.87,49.2253],[2.8784,49.2212],[2.8801,49.2195],[2.8852,49.2197],[2.8855,49.2186],[2.8894,49.2188],[2.8934,49.2198],[2.8939,49.221],[2.8982,49.22],[2.902,49.2133]]]},"60553":{"type":"Polygon","coordinates":[[[2.5969,49.4403],[2.5999,49.4435],[2.5992,49.4461],[2.6097,49.4563],[2.6106,49.4592],[2.6152,49.4612],[2.619,49.4639],[2.6228,49.4691],[2.6306,49.4663],[2.6332,49.4701],[2.6331,49.4784],[2.6379,49.4785],[2.6382,49.4774],[2.6526,49.474],[2.6574,49.4795],[2.6603,49.4788],[2.6593,49.4769],[2.6627,49.4748],[2.661,49.4723],[2.6632,49.4715],[2.6543,49.4557],[2.6482,49.4573],[2.6442,49.4511],[2.6427,49.4521],[2.6409,49.452],[2.6429,49.4504],[2.6429,49.4481],[2.6381,49.4486],[2.6362,49.4468],[2.6383,49.4439],[2.6403,49.4426],[2.6389,49.443],[2.6298,49.4369],[2.6283,49.4339],[2.6271,49.4337],[2.6254,49.432],[2.624,49.4333],[2.6132,49.4378],[2.6122,49.4363],[2.6034,49.437],[2.6051,49.4395],[2.5969,49.4403]]]},"60554":{"type":"Polygon","coordinates":[[[3.0342,49.0885],[3.0329,49.0889],[3.0317,49.0857],[3.0155,49.0913],[3.0085,49.0916],[3.006,49.0864],[3.0044,49.0877],[3.0024,49.0917],[3.0032,49.0916],[3.0045,49.0934],[3.0076,49.0942],[3.0085,49.0958],[3.0106,49.0951],[3.0116,49.0957],[3.0117,49.0971],[3.0107,49.0987],[3.0113,49.0999],[3.0109,49.1022],[3.0068,49.1037],[3.0068,49.1054],[3.0055,49.1056],[3.0062,49.116],[3.0068,49.116],[3.0077,49.1182],[3.0094,49.118],[3.0117,49.1197],[3.0165,49.1198],[3.0193,49.1215],[3.0211,49.124],[3.0236,49.1242],[3.0249,49.1258],[3.0259,49.1254],[3.0269,49.1264],[3.0277,49.126],[3.0329,49.1295],[3.0325,49.13],[3.0391,49.1319],[3.0364,49.1294],[3.0375,49.1287],[3.0373,49.1278],[3.0404,49.1271],[3.0408,49.1257],[3.0396,49.1258],[3.0377,49.1235],[3.0385,49.1235],[3.0381,49.1193],[3.0348,49.1196],[3.0293,49.1166],[3.029,49.115],[3.0306,49.1145],[3.0301,49.1133],[3.0324,49.113],[3.0325,49.1114],[3.035,49.1102],[3.0344,49.1092],[3.0355,49.109],[3.0351,49.1073],[3.0372,49.103],[3.0369,49.1014],[3.0389,49.099],[3.0373,49.0925],[3.0342,49.0885]]]},"60555":{"type":"Polygon","coordinates":[[[2.3735,49.6562],[2.3777,49.6461],[2.3739,49.6453],[2.3744,49.6449],[2.3701,49.6423],[2.3669,49.6429],[2.3621,49.6401],[2.3618,49.6408],[2.3601,49.6406],[2.3607,49.6412],[2.3601,49.6417],[2.3612,49.6423],[2.3616,49.6459],[2.3625,49.6463],[2.3602,49.6467],[2.3502,49.6444],[2.3365,49.6378],[2.334,49.6439],[2.3435,49.6467],[2.342,49.6484],[2.35,49.6521],[2.3475,49.6542],[2.3545,49.6554],[2.3532,49.6574],[2.3551,49.6574],[2.3567,49.6563],[2.3603,49.658],[2.357,49.6612],[2.3574,49.6615],[2.3553,49.6643],[2.36,49.6664],[2.3619,49.6668],[2.366,49.6603],[2.3709,49.6564],[2.3735,49.6562]]]},"60556":{"type":"Polygon","coordinates":[[[2.5257,49.6002],[2.5193,49.6002],[2.5177,49.5986],[2.5151,49.6027],[2.509,49.6005],[2.5086,49.6017],[2.5033,49.6005],[2.5049,49.6038],[2.4925,49.6078],[2.4942,49.6089],[2.4917,49.6101],[2.4945,49.6117],[2.497,49.6147],[2.5051,49.6186],[2.511,49.623],[2.5268,49.6296],[2.5265,49.6287],[2.5293,49.6253],[2.534,49.6255],[2.534,49.6245],[2.5368,49.6241],[2.541,49.6249],[2.5373,49.6205],[2.5436,49.6191],[2.5437,49.6177],[2.5413,49.6155],[2.5476,49.6151],[2.5472,49.6162],[2.5595,49.6174],[2.5657,49.6191],[2.5672,49.618],[2.5674,49.6162],[2.5656,49.612],[2.5649,49.6113],[2.5616,49.6116],[2.5584,49.6074],[2.5571,49.6072],[2.5577,49.6084],[2.556,49.6079],[2.5565,49.6073],[2.5441,49.6061],[2.5402,49.6039],[2.5365,49.6042],[2.5318,49.6015],[2.5311,49.6022],[2.5257,49.6002]]]},"60557":{"type":"Polygon","coordinates":[[[1.8835,49.5746],[1.8881,49.5762],[1.8873,49.5771],[1.893,49.5813],[1.8997,49.5836],[1.9014,49.5849],[1.9046,49.5839],[1.9068,49.5852],[1.9085,49.587],[1.9059,49.59],[1.9077,49.5909],[1.9048,49.593],[1.9067,49.5939],[1.9062,49.5946],[1.907,49.5973],[1.9082,49.5965],[1.9108,49.5977],[1.9143,49.5961],[1.9179,49.5957],[1.9293,49.6008],[1.9391,49.5914],[1.9404,49.5916],[1.9397,49.5909],[1.9464,49.5848],[1.9437,49.5839],[1.9478,49.5795],[1.9457,49.5777],[1.9475,49.5769],[1.946,49.5767],[1.946,49.5757],[1.9481,49.5721],[1.9462,49.5718],[1.943,49.5693],[1.9284,49.5662],[1.9238,49.5638],[1.9199,49.563],[1.9184,49.5645],[1.9111,49.5664],[1.9085,49.5646],[1.9021,49.5688],[1.9025,49.5701],[1.8966,49.5715],[1.8959,49.5726],[1.8903,49.5707],[1.8898,49.5716],[1.8941,49.5727],[1.8937,49.5738],[1.8948,49.5739],[1.8947,49.5746],[1.893,49.5745],[1.8929,49.5755],[1.8902,49.5755],[1.889,49.5747],[1.8895,49.5737],[1.8848,49.573],[1.8835,49.5746]]]},"60558":{"type":"Polygon","coordinates":[[[2.7835,49.5686],[2.7761,49.5674],[2.778,49.5705],[2.778,49.574],[2.7769,49.5747],[2.7781,49.5771],[2.777,49.5775],[2.7774,49.5796],[2.7759,49.581],[2.7742,49.5804],[2.7713,49.5825],[2.7704,49.5817],[2.7663,49.5836],[2.7659,49.5829],[2.7634,49.5838],[2.7636,49.5826],[2.7603,49.5816],[2.7595,49.5842],[2.7568,49.5864],[2.7489,49.5846],[2.7451,49.5865],[2.7393,49.5876],[2.7452,49.5916],[2.7488,49.5988],[2.7522,49.5999],[2.7529,49.602],[2.7537,49.6019],[2.7556,49.6118],[2.7568,49.6144],[2.7597,49.6178],[2.7733,49.6135],[2.7755,49.6151],[2.7776,49.6113],[2.7777,49.6094],[2.7804,49.6061],[2.7804,49.6045],[2.7879,49.6017],[2.7865,49.6008],[2.7899,49.5981],[2.7866,49.5971],[2.7938,49.5896],[2.7975,49.5874],[2.7946,49.5849],[2.7951,49.5845],[2.7921,49.5826],[2.7927,49.5795],[2.7939,49.5797],[2.7958,49.5776],[2.791,49.5756],[2.7875,49.5748],[2.7851,49.5751],[2.7848,49.5744],[2.7868,49.5729],[2.787,49.5695],[2.7836,49.5694],[2.7835,49.5686]]]},"60559":{"type":"Polygon","coordinates":[[[2.2798,49.3888],[2.2726,49.4004],[2.2728,49.4016],[2.2762,49.4016],[2.2762,49.4025],[2.2753,49.4025],[2.2749,49.4074],[2.2772,49.4074],[2.2775,49.4113],[2.276,49.4115],[2.2767,49.4137],[2.2773,49.4137],[2.2768,49.4141],[2.2806,49.4243],[2.2783,49.4248],[2.2787,49.4257],[2.2781,49.4258],[2.2797,49.4305],[2.285,49.4303],[2.2855,49.4353],[2.2929,49.4349],[2.2931,49.437],[2.2962,49.4349],[2.3,49.4296],[2.3029,49.4224],[2.3035,49.4166],[2.3164,49.414],[2.316,49.4101],[2.3145,49.4099],[2.3141,49.4089],[2.3164,49.4074],[2.3155,49.4055],[2.3144,49.4051],[2.3088,49.4058],[2.3088,49.4064],[2.3056,49.406],[2.3065,49.4037],[2.3056,49.4031],[2.3017,49.4043],[2.2983,49.4023],[2.2967,49.404],[2.295,49.4027],[2.2943,49.4008],[2.2954,49.3979],[2.2936,49.3979],[2.2931,49.3995],[2.2781,49.395],[2.282,49.3896],[2.2798,49.3888]]]},"60560":{"type":"Polygon","coordinates":[[[2.7601,49.251],[2.7589,49.2485],[2.7548,49.2476],[2.7544,49.2448],[2.7517,49.2452],[2.7496,49.2336],[2.7557,49.2338],[2.7553,49.2249],[2.7588,49.2253],[2.7592,49.2224],[2.747,49.2223],[2.7471,49.224],[2.7397,49.2233],[2.7395,49.2209],[2.7313,49.2214],[2.7235,49.2207],[2.7237,49.2213],[2.7218,49.2214],[2.722,49.2234],[2.7134,49.2237],[2.714,49.225],[2.7081,49.2257],[2.7087,49.2266],[2.7008,49.2288],[2.697,49.2309],[2.6958,49.23],[2.6948,49.2306],[2.6957,49.2311],[2.6927,49.2333],[2.6883,49.2343],[2.6889,49.2358],[2.6833,49.2374],[2.6798,49.2359],[2.6761,49.233],[2.6722,49.232],[2.6688,49.2322],[2.6719,49.2321],[2.6752,49.2337],[2.6733,49.2351],[2.6738,49.2354],[2.673,49.236],[2.6737,49.2363],[2.6721,49.2374],[2.705,49.2506],[2.7094,49.2479],[2.7126,49.2492],[2.7151,49.2475],[2.7188,49.2495],[2.7278,49.2575],[2.7301,49.254],[2.7388,49.2627],[2.7457,49.2571],[2.7485,49.2592],[2.7538,49.2567],[2.7565,49.2548],[2.7566,49.2512],[2.7601,49.251]]]},"60561":{"type":"Polygon","coordinates":[[[2.9254,49.2373],[2.9288,49.2399],[2.9339,49.2395],[2.9365,49.2475],[2.9377,49.2474],[2.9442,49.2565],[2.9452,49.2565],[2.945,49.2575],[2.9466,49.2595],[2.9419,49.2596],[2.9432,49.2644],[2.9468,49.2648],[2.9466,49.2659],[2.9494,49.2667],[2.9556,49.2705],[2.9598,49.2705],[2.9618,49.2697],[2.9612,49.2705],[2.9625,49.2707],[2.9713,49.2642],[2.9711,49.263],[2.9724,49.2608],[2.9776,49.2581],[2.9774,49.2566],[2.9797,49.2562],[2.9822,49.2539],[2.9845,49.2533],[2.982,49.2527],[2.9822,49.2507],[2.9803,49.2495],[2.9807,49.2485],[2.979,49.2482],[2.9789,49.2465],[2.9753,49.2465],[2.9747,49.2454],[2.9756,49.2454],[2.9756,49.2448],[2.9745,49.2448],[2.9739,49.2433],[2.9741,49.24],[2.9692,49.2394],[2.9674,49.2358],[2.962,49.2364],[2.9607,49.2316],[2.959,49.2323],[2.9586,49.2339],[2.9544,49.2359],[2.9542,49.2367],[2.9506,49.2375],[2.9482,49.2361],[2.9454,49.2359],[2.9378,49.2332],[2.9306,49.2331],[2.9303,49.2322],[2.9279,49.2331],[2.9283,49.2337],[2.9251,49.2341],[2.9254,49.2373]]]},"60562":{"type":"Polygon","coordinates":[[[2.6034,49.3332],[2.5243,49.3438],[2.523,49.3489],[2.521,49.3486],[2.5189,49.353],[2.5167,49.3525],[2.514,49.3555],[2.5141,49.3604],[2.5273,49.3616],[2.53,49.364],[2.5323,49.3639],[2.5296,49.3677],[2.5362,49.3708],[2.5414,49.375],[2.5458,49.3764],[2.545,49.3792],[2.5468,49.3827],[2.551,49.3811],[2.5523,49.3827],[2.5551,49.3825],[2.5559,49.3836],[2.5571,49.3832],[2.5587,49.3845],[2.5626,49.3851],[2.5666,49.3809],[2.5708,49.37],[2.578,49.3691],[2.5766,49.3679],[2.5763,49.3658],[2.5782,49.3656],[2.5775,49.3633],[2.5816,49.3597],[2.5797,49.3552],[2.5828,49.3536],[2.5807,49.3492],[2.5787,49.3495],[2.5782,49.3481],[2.5776,49.3481],[2.5774,49.3457],[2.5855,49.3446],[2.5858,49.3459],[2.5917,49.345],[2.5909,49.344],[2.593,49.3432],[2.5893,49.3394],[2.6023,49.3352],[2.6013,49.3335],[2.6034,49.3332]]]},"60563":{"type":"Polygon","coordinates":[[[2.6319,49.3851],[2.6338,49.3877],[2.6308,49.3898],[2.6352,49.3945],[2.6401,49.3912],[2.6448,49.3954],[2.6481,49.3954],[2.6455,49.388],[2.6468,49.3874],[2.6457,49.3864],[2.6443,49.3871],[2.643,49.3859],[2.644,49.3855],[2.641,49.3828],[2.6438,49.3812],[2.6438,49.3788],[2.6376,49.3673],[2.6383,49.3669],[2.6377,49.3635],[2.6362,49.3613],[2.6362,49.3593],[2.634,49.3563],[2.6362,49.3545],[2.6327,49.3535],[2.6334,49.3521],[2.627,49.3516],[2.6269,49.3525],[2.6225,49.3501],[2.6198,49.3525],[2.6193,49.352],[2.618,49.3534],[2.6165,49.3531],[2.6159,49.3545],[2.6145,49.3543],[2.6143,49.3566],[2.6094,49.3562],[2.6087,49.3552],[2.605,49.3543],[2.6063,49.3608],[2.6057,49.3653],[2.6099,49.374],[2.6119,49.3744],[2.6164,49.3728],[2.6171,49.3749],[2.6246,49.3755],[2.6319,49.3851]]]},"60564":{"type":"Polygon","coordinates":[[[2.433,49.5924],[2.4399,49.597],[2.4456,49.6026],[2.448,49.5994],[2.4497,49.6003],[2.4537,49.5952],[2.4392,49.5921],[2.4386,49.5905],[2.4418,49.5916],[2.4481,49.5907],[2.451,49.5913],[2.4584,49.5891],[2.4678,49.5945],[2.475,49.5932],[2.4756,49.5923],[2.4802,49.5922],[2.484,49.5899],[2.4843,49.589],[2.4893,49.588],[2.4889,49.5856],[2.488,49.5855],[2.4892,49.5783],[2.4958,49.5723],[2.4926,49.5706],[2.4897,49.5672],[2.4895,49.5629],[2.4833,49.5586],[2.4817,49.5599],[2.4789,49.5599],[2.475,49.5614],[2.4716,49.5638],[2.4667,49.5608],[2.4608,49.5637],[2.4599,49.5624],[2.456,49.5641],[2.4569,49.5648],[2.4524,49.5688],[2.4484,49.5684],[2.4471,49.5718],[2.4419,49.5712],[2.4413,49.5728],[2.4402,49.5727],[2.4398,49.5742],[2.4306,49.5789],[2.4338,49.5812],[2.436,49.5809],[2.4392,49.5839],[2.4338,49.5854],[2.4374,49.5902],[2.4365,49.5911],[2.4326,49.5919],[2.433,49.5924]]]},"60565":{"type":"Polygon","coordinates":[[[2.2678,49.5881],[2.2695,49.5904],[2.2752,49.5914],[2.2826,49.5951],[2.2838,49.5945],[2.2851,49.5957],[2.2846,49.596],[2.2871,49.5969],[2.2898,49.5959],[2.2913,49.5981],[2.2905,49.5988],[2.2908,49.5997],[2.2927,49.6022],[2.2953,49.6007],[2.2976,49.601],[2.3034,49.5987],[2.3015,49.5939],[2.3027,49.5932],[2.3048,49.594],[2.3057,49.5921],[2.31,49.5904],[2.3097,49.5885],[2.311,49.5883],[2.3108,49.5873],[2.3147,49.5881],[2.3156,49.5871],[2.3183,49.5882],[2.3207,49.5866],[2.3329,49.5908],[2.3348,49.5884],[2.3364,49.5888],[2.3369,49.5872],[2.3349,49.5867],[2.3366,49.5853],[2.3383,49.582],[2.3402,49.5767],[2.3396,49.5765],[2.3402,49.5743],[2.342,49.5712],[2.342,49.5694],[2.3387,49.5671],[2.3372,49.5683],[2.3298,49.5707],[2.3311,49.5711],[2.3273,49.5764],[2.3268,49.5757],[2.3237,49.5787],[2.3232,49.5781],[2.3213,49.5796],[2.3194,49.5792],[2.3202,49.5808],[2.3174,49.5821],[2.3158,49.5796],[2.3136,49.5799],[2.3154,49.5828],[2.3129,49.5825],[2.3102,49.5774],[2.3107,49.5749],[2.3101,49.5738],[2.3072,49.5713],[2.3066,49.5718],[2.3032,49.5713],[2.2964,49.5662],[2.297,49.5651],[2.2961,49.5647],[2.2942,49.5666],[2.2921,49.5674],[2.2868,49.5648],[2.2819,49.5669],[2.2802,49.5653],[2.278,49.5679],[2.2747,49.568],[2.2734,49.5709],[2.2751,49.5725],[2.2754,49.5741],[2.2738,49.5753],[2.2744,49.5784],[2.2714,49.5784],[2.2727,49.5808],[2.2712,49.5811],[2.2704,49.5855],[2.2674,49.5856],[2.2678,49.5881]]]},"60566":{"type":"Polygon","coordinates":[[[1.8122,49.6507],[1.8146,49.6511],[1.8127,49.6469],[1.8176,49.6457],[1.8174,49.6439],[1.8183,49.644],[1.8185,49.6425],[1.8259,49.6444],[1.8273,49.6423],[1.8358,49.6386],[1.8332,49.6349],[1.8325,49.6351],[1.8281,49.6284],[1.8259,49.6266],[1.8204,49.6247],[1.8123,49.6264],[1.8027,49.6264],[1.8019,49.6276],[1.7886,49.6219],[1.7836,49.6292],[1.7773,49.6359],[1.7756,49.6403],[1.7824,49.6406],[1.7903,49.6395],[1.7924,49.6415],[1.7931,49.6412],[1.793,49.6441],[1.7957,49.6454],[1.7962,49.6479],[1.8122,49.6507]]]},"60567":{"type":"Polygon","coordinates":[[[1.8895,49.4049],[1.8772,49.4092],[1.8728,49.409],[1.8737,49.4121],[1.8745,49.4126],[1.8727,49.4139],[1.8741,49.4167],[1.8741,49.4205],[1.8748,49.4204],[1.8783,49.4259],[1.8805,49.4267],[1.8819,49.4287],[1.8799,49.4304],[1.881,49.4346],[1.8834,49.4374],[1.8812,49.439],[1.8806,49.4406],[1.8792,49.4407],[1.8794,49.4428],[1.8805,49.444],[1.8872,49.4437],[1.8899,49.4445],[1.8907,49.4441],[1.891,49.4427],[1.8943,49.4413],[1.9041,49.4405],[1.9099,49.4409],[1.9018,49.4325],[1.8908,49.4281],[1.8899,49.4252],[1.8931,49.4242],[1.8974,49.4282],[1.903,49.4265],[1.9036,49.4256],[1.9025,49.421],[1.9015,49.4208],[1.9014,49.419],[1.9021,49.4188],[1.8989,49.4175],[1.895,49.4142],[1.8979,49.4127],[1.8927,49.4095],[1.8916,49.4058],[1.8895,49.4049]]]},"60568":{"type":"Polygon","coordinates":[[[2.4667,49.4007],[2.4732,49.4048],[2.475,49.4116],[2.4736,49.4117],[2.4742,49.4151],[2.4719,49.4154],[2.4723,49.4195],[2.4715,49.4196],[2.4733,49.4221],[2.4783,49.4204],[2.479,49.4226],[2.486,49.422],[2.49,49.4208],[2.4899,49.4203],[2.4932,49.4208],[2.495,49.4196],[2.4992,49.4227],[2.4981,49.4233],[2.5021,49.4269],[2.5038,49.4261],[2.5087,49.429],[2.5114,49.429],[2.5124,49.4255],[2.5141,49.4254],[2.5151,49.4236],[2.5112,49.4211],[2.5092,49.4193],[2.5098,49.4189],[2.5091,49.4175],[2.5065,49.4158],[2.5069,49.4136],[2.5059,49.4087],[2.5021,49.4077],[2.5012,49.4036],[2.4933,49.4014],[2.4921,49.3988],[2.4838,49.4008],[2.4775,49.4007],[2.4776,49.4],[2.4766,49.4001],[2.4757,49.396],[2.471,49.3964],[2.4704,49.3976],[2.468,49.3972],[2.4682,49.4006],[2.4667,49.4007]]]},"60569":{"type":"Polygon","coordinates":[[[2.975,49.4212],[2.9757,49.423],[2.9707,49.425],[2.97,49.4247],[2.9684,49.426],[2.9653,49.4294],[2.9667,49.4302],[2.9642,49.4327],[2.9531,49.4336],[2.953,49.4343],[2.9553,49.436],[2.951,49.4365],[2.9519,49.4381],[2.9497,49.4373],[2.9511,49.4392],[2.9415,49.4589],[2.9876,49.4488],[2.9877,49.4505],[2.977,49.4574],[2.9861,49.4624],[2.9874,49.4612],[2.9975,49.4678],[3.0027,49.4673],[3.0068,49.4668],[3.0075,49.465],[3.0091,49.465],[3.0129,49.461],[3.0168,49.4547],[3.0262,49.4575],[3.0284,49.4538],[3.0278,49.4505],[3.0316,49.4499],[3.0307,49.4477],[3.0262,49.4475],[3.0265,49.4469],[3.023,49.4452],[3.0217,49.4468],[3.0201,49.4467],[3.0177,49.4439],[3.002,49.4423],[3.001,49.4427],[3.0012,49.4392],[2.9991,49.4392],[2.9983,49.4293],[2.9965,49.429],[2.9957,49.4275],[2.9908,49.4242],[2.9824,49.4202],[2.975,49.4212]]]},"60570":{"type":"Polygon","coordinates":[[[2.063,49.2438],[2.0543,49.2412],[2.0513,49.2407],[2.0501,49.2414],[2.0496,49.2407],[2.0471,49.2404],[2.0354,49.2416],[2.0332,49.2427],[2.0292,49.2426],[2.0256,49.2436],[2.0261,49.245],[2.0235,49.2461],[2.0246,49.2495],[2.0301,49.2495],[2.0331,49.2547],[2.034,49.2523],[2.0378,49.251],[2.0376,49.2539],[2.044,49.2567],[2.0438,49.2608],[2.0462,49.261],[2.0455,49.2646],[2.0368,49.2647],[2.039,49.2691],[2.0358,49.2715],[2.0406,49.2726],[2.0386,49.2731],[2.0457,49.2763],[2.0471,49.2797],[2.0455,49.284],[2.0457,49.2867],[2.0474,49.2866],[2.0479,49.2889],[2.0499,49.29],[2.0528,49.2939],[2.0545,49.2939],[2.0564,49.2914],[2.0664,49.297],[2.0712,49.2946],[2.0718,49.2961],[2.0712,49.2929],[2.0715,49.2895],[2.0709,49.2891],[2.0733,49.285],[2.0762,49.2832],[2.0836,49.2838],[2.083,49.2818],[2.0903,49.2795],[2.0906,49.2775],[2.0971,49.2767],[2.0939,49.2688],[2.094,49.2675],[2.0926,49.2677],[2.0938,49.2612],[2.0923,49.2393],[2.0887,49.2413],[2.0864,49.2454],[2.0806,49.2444],[2.0797,49.2475],[2.0777,49.2485],[2.071,49.2469],[2.0709,49.246],[2.0662,49.2458],[2.0665,49.2446],[2.063,49.2438]]]},"60571":{"type":"Polygon","coordinates":[[[1.8449,49.5982],[1.8458,49.5982],[1.853,49.603],[1.8549,49.6058],[1.8557,49.6144],[1.8574,49.6176],[1.8608,49.6197],[1.8595,49.6208],[1.8612,49.6224],[1.8665,49.6234],[1.8656,49.6247],[1.867,49.6254],[1.8718,49.6175],[1.8777,49.6158],[1.8785,49.6168],[1.8801,49.617],[1.8828,49.6148],[1.8793,49.6125],[1.8789,49.6084],[1.8778,49.6087],[1.8718,49.6031],[1.8688,49.5945],[1.8678,49.5966],[1.8541,49.59],[1.8499,49.596],[1.846,49.5965],[1.8464,49.5968],[1.8449,49.5982]]]},"60572":{"type":"Polygon","coordinates":[[[3.0016,49.3403],[3.0067,49.3445],[3.0098,49.3485],[3.001,49.3469],[2.9986,49.3478],[2.9967,49.3499],[3.0005,49.352],[3.0045,49.3528],[3.0088,49.3554],[2.9923,49.3605],[2.9871,49.3709],[2.9886,49.3709],[2.9885,49.3701],[2.9936,49.3701],[2.9984,49.372],[3.0018,49.3759],[3.0107,49.3785],[3.0114,49.377],[3.0125,49.3768],[3.0116,49.3785],[3.0214,49.3798],[3.0283,49.3749],[3.0283,49.3728],[3.0264,49.3707],[3.0271,49.3697],[3.0245,49.3671],[3.0256,49.3665],[3.0253,49.3659],[3.0287,49.3654],[3.0245,49.3605],[3.0253,49.3605],[3.024,49.3565],[3.0247,49.3558],[3.0236,49.3554],[3.0245,49.3543],[3.0232,49.3496],[3.0163,49.3428],[3.0206,49.3419],[3.0126,49.3371],[3.0016,49.3403]]]},"60573":{"type":"Polygon","coordinates":[[[2.2437,49.5909],[2.2429,49.5926],[2.244,49.5932],[2.2452,49.5918],[2.2487,49.5932],[2.2507,49.5947],[2.2502,49.5956],[2.2569,49.5954],[2.2627,49.5902],[2.2636,49.5905],[2.2644,49.5891],[2.2678,49.5881],[2.2674,49.5856],[2.2704,49.5855],[2.2712,49.5811],[2.2727,49.5808],[2.2714,49.5784],[2.2744,49.5784],[2.2727,49.5728],[2.2703,49.5728],[2.2702,49.5722],[2.2685,49.5735],[2.2652,49.5711],[2.2614,49.574],[2.259,49.5718],[2.2569,49.5712],[2.2594,49.5647],[2.2541,49.5582],[2.2465,49.5538],[2.2399,49.5556],[2.2394,49.5564],[2.2369,49.5562],[2.2331,49.5576],[2.2359,49.563],[2.2304,49.565],[2.2345,49.5728],[2.2314,49.5747],[2.2345,49.5766],[2.2316,49.5817],[2.2356,49.5836],[2.2472,49.5864],[2.247,49.5877],[2.2437,49.5909]]]},"60574":{"type":"Polygon","coordinates":[[[2.2699,49.3453],[2.273,49.3512],[2.2724,49.3513],[2.2727,49.3556],[2.2705,49.3592],[2.2709,49.3595],[2.2701,49.3598],[2.2726,49.3608],[2.2721,49.3641],[2.2727,49.3651],[2.2744,49.366],[2.2742,49.3648],[2.2753,49.3648],[2.2787,49.369],[2.2799,49.3687],[2.279,49.3672],[2.2797,49.3662],[2.2835,49.3656],[2.2834,49.3651],[2.2843,49.3659],[2.2828,49.3664],[2.2834,49.3678],[2.2829,49.3691],[2.2843,49.3695],[2.285,49.3675],[2.2848,49.3681],[2.2895,49.3688],[2.2864,49.3673],[2.2877,49.3645],[2.2886,49.3649],[2.2878,49.3656],[2.288,49.3668],[2.2893,49.3671],[2.2935,49.371],[2.2947,49.3705],[2.2949,49.3687],[2.2938,49.3672],[2.2967,49.3658],[2.2975,49.3646],[2.2963,49.3631],[2.2971,49.3628],[2.2964,49.3605],[2.2999,49.3594],[2.3001,49.3537],[2.2983,49.3519],[2.2996,49.3491],[2.2982,49.3489],[2.2962,49.3461],[2.2939,49.3456],[2.2919,49.3427],[2.2902,49.3434],[2.2887,49.3409],[2.2872,49.3414],[2.2867,49.3407],[2.2844,49.3418],[2.282,49.3407],[2.2789,49.343],[2.2797,49.3429],[2.2794,49.3434],[2.2807,49.3439],[2.2785,49.3437],[2.2758,49.345],[2.273,49.3444],[2.2712,49.3455],[2.2699,49.3453]]]},"60575":{"type":"Polygon","coordinates":[[[2.1788,49.2869],[2.1709,49.29],[2.1713,49.2932],[2.1746,49.297],[2.1733,49.2972],[2.1749,49.2991],[2.1741,49.2994],[2.1751,49.3023],[2.1814,49.3013],[2.1913,49.3021],[2.193,49.3011],[2.1976,49.304],[2.2001,49.3018],[2.2017,49.302],[2.2026,49.3003],[2.2042,49.301],[2.2087,49.2989],[2.2061,49.2963],[2.2072,49.2958],[2.2073,49.2942],[2.2157,49.2958],[2.2148,49.2942],[2.2244,49.2894],[2.2234,49.288],[2.2307,49.2874],[2.2287,49.2859],[2.2283,49.2843],[2.2225,49.2801],[2.2135,49.2837],[2.2069,49.2783],[2.2046,49.2775],[2.2042,49.2702],[2.1954,49.2751],[2.1865,49.2768],[2.1859,49.2846],[2.1788,49.2869]]]},"60576":{"type":"Polygon","coordinates":[[[1.984,49.4537],[1.9916,49.449],[1.9979,49.4468],[1.9973,49.4462],[2.0025,49.4432],[2.0009,49.4419],[1.9976,49.4426],[1.996,49.4412],[1.9939,49.4415],[1.9928,49.44],[1.9913,49.4405],[1.9882,49.4385],[1.985,49.4379],[1.9846,49.4386],[1.9834,49.4385],[1.9834,49.4373],[1.9789,49.4357],[1.9784,49.4368],[1.9702,49.4373],[1.9662,49.4307],[1.962,49.4269],[1.9536,49.4276],[1.9519,49.4296],[1.9529,49.43],[1.9528,49.4311],[1.9511,49.4325],[1.949,49.4328],[1.9502,49.4341],[1.9495,49.4351],[1.9503,49.4361],[1.948,49.4383],[1.9493,49.4385],[1.949,49.44],[1.9545,49.4414],[1.9536,49.4418],[1.9544,49.4427],[1.9536,49.4431],[1.9554,49.4474],[1.9593,49.4468],[1.9626,49.4487],[1.9653,49.4523],[1.9686,49.4541],[1.9703,49.4527],[1.9719,49.4524],[1.977,49.4538],[1.9776,49.4525],[1.9831,49.4544],[1.984,49.4537]]]},"60577":{"type":"Polygon","coordinates":[[[1.766,49.466],[1.7682,49.4662],[1.7714,49.4645],[1.7799,49.4642],[1.7796,49.4626],[1.7995,49.456],[1.799,49.4541],[1.8218,49.4491],[1.8186,49.4393],[1.8143,49.4361],[1.8107,49.4291],[1.8122,49.4288],[1.8108,49.4266],[1.8116,49.4265],[1.8108,49.4231],[1.8122,49.423],[1.8122,49.4222],[1.8089,49.419],[1.8152,49.4183],[1.8144,49.4167],[1.8118,49.415],[1.8103,49.415],[1.8072,49.412],[1.8078,49.4117],[1.8034,49.4113],[1.8019,49.4103],[1.7993,49.4113],[1.7962,49.4112],[1.7957,49.4132],[1.7936,49.4132],[1.7928,49.4145],[1.7902,49.4148],[1.7897,49.4159],[1.7912,49.4192],[1.7951,49.4228],[1.7979,49.4239],[1.7957,49.4257],[1.7872,49.4283],[1.781,49.4274],[1.7809,49.4268],[1.7725,49.428],[1.7724,49.4286],[1.7702,49.4295],[1.7664,49.43],[1.7632,49.43],[1.7574,49.4283],[1.7535,49.429],[1.7496,49.4308],[1.7496,49.4361],[1.7472,49.4372],[1.7481,49.4381],[1.7433,49.4391],[1.7407,49.4405],[1.7443,49.4426],[1.74,49.4491],[1.7435,49.4498],[1.746,49.4513],[1.7492,49.4516],[1.752,49.4535],[1.7511,49.4562],[1.748,49.4585],[1.7479,49.4598],[1.7521,49.4614],[1.7562,49.4617],[1.7572,49.463],[1.7602,49.4636],[1.7619,49.4659],[1.766,49.466]]]},"60578":{"type":"Polygon","coordinates":[[[2.7656,49.3114],[2.7666,49.3101],[2.7735,49.3081],[2.7742,49.3069],[2.7827,49.3042],[2.7836,49.3032],[2.7882,49.3026],[2.7879,49.3015],[2.7843,49.2987],[2.7837,49.2971],[2.775,49.2977],[2.7629,49.2957],[2.759,49.2934],[2.7533,49.2885],[2.7559,49.2963],[2.7552,49.2964],[2.7558,49.2981],[2.7564,49.298],[2.7558,49.2986],[2.757,49.3025],[2.7582,49.3044],[2.7575,49.3049],[2.758,49.3064],[2.7571,49.3078],[2.7578,49.3104],[2.7547,49.3127],[2.7656,49.3114]]]},"60579":{"type":"Polygon","coordinates":[[[2.8437,49.3491],[2.8413,49.3673],[2.9065,49.3683],[2.9097,49.3692],[2.9107,49.3684],[2.9264,49.3689],[2.9323,49.3539],[2.9379,49.3469],[2.9396,49.34],[2.936,49.3289],[2.9306,49.3305],[2.9298,49.3381],[2.9224,49.3344],[2.9206,49.3346],[2.9173,49.3362],[2.9128,49.3361],[2.9093,49.3407],[2.9067,49.3419],[2.8933,49.3352],[2.889,49.338],[2.8818,49.3357],[2.8798,49.3316],[2.8585,49.327],[2.8524,49.3288],[2.8474,49.3254],[2.8437,49.3491]]]},"60581":{"type":"Polygon","coordinates":[[[2.4085,49.5361],[2.41,49.5342],[2.4197,49.5378],[2.4203,49.5371],[2.4224,49.5373],[2.4226,49.5363],[2.4276,49.5364],[2.4282,49.5342],[2.4315,49.5356],[2.432,49.5287],[2.4307,49.5284],[2.4317,49.5243],[2.4352,49.5238],[2.4378,49.5209],[2.4375,49.5185],[2.4386,49.517],[2.4421,49.5145],[2.4448,49.5109],[2.4426,49.5056],[2.4409,49.5038],[2.4423,49.5015],[2.4424,49.4979],[2.4435,49.4946],[2.441,49.4933],[2.4399,49.4945],[2.4385,49.4935],[2.4361,49.4938],[2.4363,49.4922],[2.4332,49.4921],[2.4336,49.4932],[2.4298,49.4933],[2.4283,49.4952],[2.4194,49.4925],[2.4197,49.4918],[2.4158,49.4909],[2.4149,49.489],[2.4122,49.4887],[2.4074,49.4892],[2.4072,49.4886],[2.4023,49.4901],[2.4038,49.4916],[2.4031,49.4918],[2.3958,49.4893],[2.3923,49.4897],[2.3912,49.4925],[2.3841,49.4925],[2.3862,49.4959],[2.3972,49.5006],[2.3953,49.5023],[2.3955,49.5042],[2.3936,49.5055],[2.3938,49.5079],[2.3986,49.5107],[2.4047,49.513],[2.4024,49.514],[2.4064,49.52],[2.4091,49.5197],[2.4094,49.5207],[2.4032,49.5247],[2.3969,49.5272],[2.3997,49.5284],[2.3987,49.5294],[2.3962,49.5292],[2.3943,49.5301],[2.3955,49.5313],[2.3982,49.5302],[2.3992,49.5309],[2.3966,49.5321],[2.3996,49.5349],[2.4028,49.5348],[2.4033,49.5362],[2.4085,49.5361]]]},"60582":{"type":"Polygon","coordinates":[[[2.976,49.4892],[2.9762,49.4881],[2.9701,49.4702],[2.9415,49.4589],[2.9328,49.4775],[2.9312,49.478],[2.9325,49.4894],[2.9343,49.4926],[2.9391,49.4899],[2.9407,49.4877],[2.943,49.4879],[2.9431,49.4898],[2.9458,49.489],[2.9478,49.4902],[2.95,49.4889],[2.9521,49.4912],[2.9543,49.4907],[2.9628,49.4917],[2.9638,49.4929],[2.9666,49.4937],[2.9733,49.4908],[2.9745,49.4892],[2.976,49.4892]]]},"60583":{"type":"Polygon","coordinates":[[[2.0483,49.3854],[2.0396,49.3815],[2.037,49.3792],[2.0374,49.3764],[2.032,49.3742],[2.0254,49.3785],[2.0257,49.379],[2.0242,49.3803],[2.0253,49.3812],[2.0242,49.3829],[2.0205,49.3855],[2.0182,49.3864],[2.0177,49.3849],[2.0158,49.3845],[2.0062,49.3895],[2.0043,49.3893],[2.0022,49.3912],[2.0097,49.3968],[2.0142,49.3991],[2.0152,49.4001],[2.0141,49.4009],[2.0164,49.4008],[2.0225,49.3977],[2.0263,49.3997],[2.0282,49.3986],[2.0278,49.3979],[2.0286,49.3971],[2.0276,49.3963],[2.0306,49.3947],[2.0306,49.3932],[2.0429,49.3904],[2.0438,49.3892],[2.0465,49.3886],[2.0483,49.3854]]]},"60584":{"type":"Polygon","coordinates":[[[2.4229,49.2136],[2.4209,49.2089],[2.416,49.2057],[2.4021,49.2033],[2.3977,49.2043],[2.4057,49.2064],[2.4009,49.2117],[2.4023,49.2125],[2.4009,49.214],[2.4027,49.2167],[2.4009,49.2182],[2.3994,49.2174],[2.3967,49.2201],[2.3952,49.2241],[2.3917,49.2239],[2.3867,49.2259],[2.3828,49.2259],[2.3785,49.2295],[2.374,49.2292],[2.3699,49.2307],[2.3604,49.2357],[2.3586,49.2383],[2.3588,49.2395],[2.3718,49.2406],[2.379,49.2373],[2.3816,49.2386],[2.3825,49.2373],[2.3859,49.2379],[2.3949,49.2367],[2.395,49.2384],[2.3971,49.2407],[2.4093,49.2371],[2.4071,49.242],[2.4167,49.2423],[2.4168,49.2417],[2.4238,49.2403],[2.4241,49.2408],[2.4368,49.2375],[2.4391,49.2407],[2.4433,49.2402],[2.4415,49.2448],[2.4419,49.2456],[2.4494,49.2446],[2.4508,49.2461],[2.4536,49.2453],[2.4526,49.2424],[2.4453,49.2345],[2.4431,49.2309],[2.4403,49.2286],[2.4324,49.2251],[2.4289,49.219],[2.4229,49.2136]]]},"60585":{"type":"Polygon","coordinates":[[[2.5317,49.5143],[2.5259,49.5179],[2.5339,49.5224],[2.5366,49.5259],[2.5349,49.5288],[2.536,49.5292],[2.5365,49.5332],[2.5407,49.5352],[2.5419,49.5341],[2.5492,49.5364],[2.5458,49.5404],[2.5445,49.5397],[2.5424,49.5409],[2.5429,49.5414],[2.5412,49.5419],[2.5406,49.5426],[2.5418,49.543],[2.5409,49.545],[2.5531,49.5415],[2.5528,49.5408],[2.5572,49.5379],[2.5585,49.5384],[2.5577,49.5376],[2.5602,49.5343],[2.5677,49.5386],[2.5677,49.5376],[2.5694,49.5368],[2.5738,49.5318],[2.5747,49.5337],[2.5773,49.5302],[2.5806,49.5312],[2.5823,49.529],[2.5835,49.5326],[2.5883,49.5288],[2.5881,49.5225],[2.5946,49.522],[2.5941,49.5177],[2.5896,49.5171],[2.5839,49.5188],[2.5844,49.5163],[2.5815,49.5158],[2.5851,49.5119],[2.5829,49.5107],[2.5804,49.5118],[2.5743,49.5107],[2.5738,49.5114],[2.5665,49.5117],[2.5691,49.514],[2.5673,49.5161],[2.5651,49.5223],[2.5635,49.5217],[2.5631,49.5185],[2.56,49.5182],[2.5585,49.5191],[2.5565,49.518],[2.5557,49.5186],[2.5554,49.5182],[2.5583,49.516],[2.5543,49.5141],[2.5529,49.5152],[2.55,49.5156],[2.5495,49.5149],[2.5452,49.514],[2.5445,49.5151],[2.5335,49.5151],[2.5317,49.5143]]]},"60586":{"type":"Polygon","coordinates":[[[2.0722,49.407],[2.0761,49.4021],[2.0769,49.4023],[2.079,49.399],[2.077,49.3986],[2.0769,49.3973],[2.0748,49.3963],[2.0751,49.3945],[2.0724,49.3938],[2.0729,49.3928],[2.0721,49.3906],[2.0684,49.3885],[2.0688,49.3862],[2.0604,49.385],[2.0584,49.3828],[2.0541,49.3829],[2.0542,49.3836],[2.0521,49.3847],[2.0497,49.3844],[2.0481,49.3856],[2.0465,49.3886],[2.0438,49.3892],[2.0429,49.3904],[2.0359,49.3921],[2.045,49.4],[2.0535,49.4047],[2.053,49.4051],[2.0581,49.4083],[2.0563,49.4094],[2.0579,49.4108],[2.0595,49.4097],[2.0618,49.4116],[2.0658,49.4105],[2.067,49.4115],[2.0674,49.4103],[2.07,49.4086],[2.069,49.4082],[2.0713,49.4066],[2.0722,49.407]]]},"60587":{"type":"Polygon","coordinates":[[[2.6034,49.3332],[2.6013,49.3335],[2.6023,49.3352],[2.5893,49.3394],[2.593,49.3432],[2.5909,49.344],[2.5917,49.345],[2.5858,49.3459],[2.5865,49.3468],[2.5851,49.3473],[2.5865,49.35],[2.5856,49.3502],[2.5877,49.354],[2.5868,49.3549],[2.5878,49.3555],[2.5884,49.358],[2.5935,49.3575],[2.6016,49.3591],[2.6026,49.3547],[2.6052,49.3552],[2.605,49.3543],[2.6087,49.3552],[2.6094,49.3562],[2.6143,49.3566],[2.6144,49.3541],[2.6165,49.3512],[2.6076,49.347],[2.6082,49.3461],[2.6074,49.3419],[2.6101,49.3424],[2.6091,49.3412],[2.6099,49.3409],[2.6054,49.337],[2.6063,49.3366],[2.6053,49.3355],[2.6058,49.3352],[2.6034,49.3332]]]},"60588":{"type":"Polygon","coordinates":[[[1.8906,49.6299],[1.9006,49.6335],[1.9047,49.631],[1.9035,49.6306],[1.904,49.6303],[1.9027,49.6299],[1.9031,49.6295],[1.9142,49.6222],[1.9159,49.6266],[1.9186,49.6246],[1.9216,49.6258],[1.925,49.6244],[1.9295,49.628],[1.9333,49.6294],[1.9381,49.6295],[1.9379,49.6289],[1.9398,49.6283],[1.9387,49.625],[1.9401,49.625],[1.9391,49.6238],[1.9448,49.6238],[1.9465,49.623],[1.9466,49.6219],[1.944,49.6182],[1.9467,49.6148],[1.9461,49.6121],[1.947,49.6091],[1.944,49.6092],[1.9384,49.6076],[1.9387,49.6072],[1.9249,49.6052],[1.9272,49.6029],[1.9254,49.6017],[1.9276,49.5997],[1.9232,49.598],[1.9219,49.5994],[1.9197,49.5998],[1.9209,49.6018],[1.9184,49.6027],[1.9167,49.6022],[1.9138,49.6052],[1.9113,49.6052],[1.9112,49.6068],[1.9065,49.6073],[1.9061,49.6086],[1.9006,49.612],[1.9041,49.6183],[1.9039,49.6225],[1.8991,49.6249],[1.8928,49.6261],[1.894,49.6267],[1.8906,49.6299]]]},"60589":{"type":"Polygon","coordinates":[[[2.4536,49.2453],[2.4554,49.2499],[2.4564,49.2488],[2.4559,49.2463],[2.4572,49.245],[2.4673,49.2451],[2.4665,49.2442],[2.4599,49.243],[2.4592,49.2419],[2.4655,49.2402],[2.4683,49.2437],[2.4708,49.245],[2.4758,49.2431],[2.4742,49.2407],[2.4761,49.2408],[2.4875,49.2368],[2.4845,49.2339],[2.4846,49.2305],[2.4826,49.2258],[2.4736,49.2272],[2.4727,49.2219],[2.4807,49.2217],[2.4805,49.2201],[2.486,49.2198],[2.4843,49.2147],[2.4725,49.2079],[2.4693,49.2033],[2.4611,49.2026],[2.4631,49.2086],[2.4598,49.2088],[2.4596,49.2094],[2.4429,49.2117],[2.4352,49.2115],[2.4319,49.2125],[2.4286,49.2113],[2.4229,49.2136],[2.4289,49.219],[2.4324,49.2251],[2.4403,49.2286],[2.4431,49.2309],[2.4453,49.2345],[2.4526,49.2424],[2.4536,49.2453]]]},"60590":{"type":"Polygon","coordinates":[[[1.9708,49.5411],[1.9767,49.5438],[1.9794,49.5427],[1.9816,49.5437],[1.9851,49.5436],[1.9871,49.5424],[1.9911,49.5442],[1.9905,49.5451],[1.9957,49.548],[1.9991,49.5482],[2.001,49.5506],[2.0014,49.5527],[2.0086,49.5583],[2.0106,49.5576],[2.0074,49.5516],[2.0084,49.5514],[2.008,49.5504],[2.0089,49.5503],[2.0115,49.5454],[2.0102,49.5445],[2.0169,49.5398],[2.0254,49.5387],[2.0277,49.5362],[2.0292,49.537],[2.0325,49.5351],[2.032,49.5348],[2.0324,49.533],[2.0296,49.5305],[2.0259,49.5289],[2.0307,49.5255],[2.0294,49.5248],[2.0273,49.5263],[2.021,49.5188],[2.0188,49.5196],[2.0176,49.5178],[2.0165,49.518],[2.0166,49.5172],[2.0079,49.5161],[2.0072,49.5152],[2.0005,49.5162],[1.9959,49.5154],[1.995,49.5155],[1.9965,49.5178],[1.9918,49.5198],[1.9901,49.5255],[1.9841,49.5259],[1.9813,49.5271],[1.9795,49.5299],[1.9799,49.5325],[1.9792,49.5351],[1.9761,49.5366],[1.9708,49.5411]]]},"60591":{"type":"Polygon","coordinates":[[[1.949,49.4319],[1.949,49.4328],[1.9507,49.4326],[1.9528,49.4311],[1.9529,49.43],[1.9519,49.4296],[1.9536,49.4276],[1.962,49.4269],[1.9662,49.4307],[1.9702,49.4373],[1.9784,49.4368],[1.9789,49.4357],[1.9834,49.4373],[1.9834,49.4385],[1.9846,49.4386],[1.985,49.4379],[1.9882,49.4385],[1.9913,49.4405],[1.9928,49.44],[1.9939,49.4415],[1.996,49.4412],[1.9976,49.4426],[2.0055,49.4391],[2.0064,49.4396],[2.0112,49.4384],[2.0128,49.437],[2.0217,49.434],[2.0139,49.4249],[2.0137,49.4192],[2.012,49.4176],[2.0083,49.4182],[2.0042,49.417],[1.9885,49.4196],[1.987,49.418],[1.9805,49.4156],[1.9764,49.4157],[1.9739,49.4174],[1.9721,49.4161],[1.9696,49.4169],[1.9724,49.4215],[1.9708,49.4216],[1.971,49.4224],[1.9684,49.4225],[1.9624,49.4149],[1.9515,49.4191],[1.9528,49.4233],[1.9501,49.4258],[1.9462,49.4272],[1.947,49.4301],[1.949,49.4319]]]},"60592":{"type":"Polygon","coordinates":[[[1.7335,49.4411],[1.7339,49.4429],[1.7366,49.4445],[1.7356,49.4456],[1.7367,49.4478],[1.738,49.449],[1.74,49.4491],[1.7443,49.4426],[1.7407,49.4405],[1.7433,49.4391],[1.7481,49.4381],[1.7472,49.4372],[1.7496,49.4361],[1.7498,49.4308],[1.7535,49.429],[1.7574,49.4283],[1.7632,49.43],[1.7664,49.43],[1.7702,49.4295],[1.7724,49.4286],[1.7725,49.428],[1.7801,49.4271],[1.7778,49.4249],[1.7731,49.4257],[1.7726,49.4239],[1.7704,49.4223],[1.7669,49.4232],[1.763,49.4184],[1.7647,49.4176],[1.7635,49.4159],[1.761,49.4161],[1.7597,49.4142],[1.759,49.4127],[1.7591,49.4099],[1.7483,49.4103],[1.7442,49.4085],[1.7405,49.4056],[1.737,49.4073],[1.7357,49.4065],[1.7331,49.4072],[1.7208,49.4057],[1.7195,49.4038],[1.7165,49.4033],[1.714,49.407],[1.7142,49.4098],[1.7161,49.4107],[1.7151,49.415],[1.7166,49.4172],[1.7208,49.4182],[1.7227,49.42],[1.722,49.4205],[1.7242,49.4223],[1.7208,49.4242],[1.7236,49.4274],[1.7221,49.4295],[1.7235,49.4308],[1.7227,49.4329],[1.7235,49.4346],[1.7284,49.4365],[1.7282,49.4373],[1.7243,49.4395],[1.725,49.4405],[1.7245,49.4411],[1.7273,49.442],[1.7315,49.4404],[1.7335,49.4411]]]},"60593":{"type":"Polygon","coordinates":[[[3.0934,49.4246],[3.0941,49.421],[3.0913,49.4202],[3.0801,49.4195],[3.0791,49.4205],[3.0719,49.4211],[3.0707,49.4222],[3.0711,49.4234],[3.079,49.4295],[3.0777,49.4315],[3.0755,49.4326],[3.0702,49.4336],[3.0709,49.4385],[3.0745,49.4389],[3.0724,49.4399],[3.0723,49.4411],[3.0742,49.4413],[3.0753,49.44],[3.0798,49.4394],[3.0809,49.4402],[3.083,49.4396],[3.0885,49.44],[3.0908,49.4411],[3.0941,49.4413],[3.0942,49.4407],[3.1005,49.4395],[3.0931,49.4326],[3.0934,49.4246]]]},"60594":{"type":"Polygon","coordinates":[[[1.7455,49.5393],[1.7449,49.5395],[1.7458,49.5423],[1.7486,49.5446],[1.7477,49.5465],[1.7536,49.5496],[1.7606,49.5487],[1.7645,49.5463],[1.7732,49.5458],[1.7737,49.5454],[1.7696,49.5417],[1.7713,49.5407],[1.7703,49.5401],[1.7726,49.5382],[1.7736,49.5389],[1.7757,49.5379],[1.7679,49.5328],[1.7665,49.5335],[1.7549,49.5218],[1.7561,49.5204],[1.7544,49.5194],[1.755,49.5191],[1.7546,49.5183],[1.7561,49.5177],[1.7548,49.5169],[1.7573,49.5162],[1.7586,49.5143],[1.7606,49.5134],[1.7663,49.5133],[1.7685,49.512],[1.7681,49.5112],[1.7688,49.5107],[1.7668,49.5094],[1.763,49.5113],[1.7615,49.5106],[1.7595,49.5114],[1.7571,49.5095],[1.7579,49.5085],[1.7563,49.5053],[1.7552,49.5057],[1.752,49.5038],[1.7498,49.5044],[1.7485,49.5038],[1.751,49.5022],[1.7493,49.5015],[1.7526,49.4973],[1.7451,49.4889],[1.7433,49.4903],[1.744,49.491],[1.7434,49.4919],[1.7442,49.495],[1.7398,49.5],[1.7368,49.5004],[1.7372,49.5009],[1.7366,49.5012],[1.734,49.4991],[1.7317,49.4992],[1.7309,49.5001],[1.7253,49.4997],[1.726,49.502],[1.7251,49.5032],[1.7211,49.5038],[1.7179,49.503],[1.7154,49.5056],[1.7171,49.5059],[1.7167,49.5066],[1.7186,49.5076],[1.7215,49.5111],[1.7261,49.5139],[1.7376,49.52],[1.7403,49.5186],[1.7409,49.5191],[1.7381,49.5213],[1.7353,49.525],[1.7401,49.5271],[1.7404,49.5257],[1.7422,49.5281],[1.7442,49.5292],[1.7432,49.5301],[1.7459,49.5314],[1.7449,49.5321],[1.7443,49.5315],[1.7418,49.533],[1.7473,49.5362],[1.7478,49.5387],[1.7455,49.5393]]]},"60595":{"type":"Polygon","coordinates":[[[2.3915,49.4823],[2.3922,49.4835],[2.3917,49.4839],[2.3941,49.4875],[2.395,49.4866],[2.3978,49.4887],[2.4006,49.4872],[2.4022,49.4887],[2.4073,49.4869],[2.4059,49.4854],[2.4141,49.4835],[2.4141,49.4844],[2.4158,49.484],[2.4162,49.4849],[2.4187,49.485],[2.4179,49.4827],[2.4209,49.4828],[2.4384,49.4789],[2.4503,49.4751],[2.4574,49.4712],[2.4536,49.4699],[2.4525,49.467],[2.4507,49.4667],[2.4519,49.4653],[2.4527,49.4662],[2.4564,49.4655],[2.4549,49.4599],[2.4501,49.4562],[2.4447,49.458],[2.4417,49.4563],[2.4354,49.4555],[2.4301,49.4564],[2.428,49.4581],[2.4211,49.4602],[2.4154,49.4597],[2.4088,49.458],[2.4089,49.4557],[2.4051,49.4558],[2.4068,49.4617],[2.4058,49.4618],[2.4056,49.4637],[2.4049,49.4636],[2.4046,49.4676],[2.4008,49.4701],[2.4043,49.4716],[2.4009,49.474],[2.4011,49.475],[2.3986,49.4767],[2.3993,49.4774],[2.3966,49.4789],[2.3977,49.4814],[2.3915,49.4823]]]},"60596":{"type":"Polygon","coordinates":[[[1.7626,49.5964],[1.753,49.5896],[1.7539,49.5889],[1.7496,49.5875],[1.7438,49.5825],[1.7377,49.5853],[1.7323,49.5847],[1.7294,49.5883],[1.7222,49.5891],[1.7209,49.59],[1.7217,49.5913],[1.7214,49.5934],[1.7199,49.5938],[1.725,49.5983],[1.7224,49.5995],[1.7227,49.6012],[1.724,49.6019],[1.7275,49.5996],[1.7335,49.6021],[1.733,49.6024],[1.736,49.6044],[1.7375,49.6035],[1.7399,49.6036],[1.7431,49.6026],[1.7442,49.6034],[1.7464,49.6019],[1.7499,49.6011],[1.7538,49.5979],[1.7548,49.5983],[1.7547,49.6001],[1.7626,49.5964]]]},"60597":{"type":"Polygon","coordinates":[[[2.774,49.3078],[2.7655,49.3108],[2.7667,49.3136],[2.7734,49.3172],[2.7741,49.3204],[2.7723,49.3255],[2.7617,49.3221],[2.7545,49.3227],[2.7525,49.3247],[2.7548,49.3272],[2.7544,49.3287],[2.7577,49.3313],[2.8438,49.349],[2.8474,49.3254],[2.8394,49.3246],[2.8366,49.3222],[2.8365,49.3202],[2.8352,49.3185],[2.8258,49.3116],[2.8223,49.3099],[2.8216,49.3083],[2.8197,49.3097],[2.8229,49.3114],[2.8262,49.3156],[2.8281,49.316],[2.8289,49.3176],[2.8314,49.3173],[2.8313,49.318],[2.8274,49.3195],[2.8184,49.3186],[2.8144,49.3202],[2.8068,49.32],[2.803,49.3214],[2.8031,49.3176],[2.7989,49.3164],[2.7967,49.317],[2.7953,49.3142],[2.7928,49.3136],[2.7908,49.3143],[2.7893,49.3123],[2.7836,49.3086],[2.781,49.3097],[2.7794,49.3113],[2.774,49.3078]]]},"60598":{"type":"Polygon","coordinates":[[[2.1041,49.377],[2.1055,49.3776],[2.1076,49.3753],[2.1195,49.3676],[2.1232,49.3677],[2.1287,49.3706],[2.1315,49.367],[2.1367,49.3708],[2.1381,49.3702],[2.1331,49.3653],[2.132,49.3625],[2.1301,49.3606],[2.1455,49.3504],[2.144,49.3493],[2.1459,49.3482],[2.1432,49.3474],[2.1427,49.3446],[2.1376,49.34],[2.1332,49.3384],[2.132,49.3358],[2.1286,49.3362],[2.128,49.3344],[2.13,49.334],[2.1175,49.3266],[2.1098,49.3269],[2.1091,49.3287],[2.1079,49.3293],[2.1084,49.3296],[2.1063,49.3305],[2.1077,49.332],[2.1049,49.3332],[2.1074,49.3369],[2.1046,49.3381],[2.1061,49.3413],[2.1069,49.3415],[2.1061,49.3425],[2.1115,49.345],[2.1109,49.346],[2.1114,49.3473],[2.1098,49.3503],[2.1044,49.351],[2.1034,49.3525],[2.1076,49.3538],[2.1064,49.3556],[2.1109,49.3578],[2.1086,49.3596],[2.1135,49.3613],[2.1123,49.3631],[2.1156,49.3631],[2.1157,49.3641],[2.1175,49.3636],[2.1217,49.3651],[2.119,49.3657],[2.118,49.3646],[2.1168,49.3657],[2.1177,49.3664],[2.1155,49.3677],[2.1141,49.3665],[2.1104,49.3688],[2.1125,49.3705],[2.1095,49.3721],[2.1092,49.3712],[2.1085,49.3715],[2.1086,49.373],[2.1053,49.3728],[2.1054,49.3745],[2.1041,49.377]]]},"60599":{"type":"Polygon","coordinates":[[[1.7953,49.6815],[1.7925,49.6854],[1.7905,49.6921],[1.7868,49.6959],[1.7932,49.6962],[1.7953,49.6973],[1.7942,49.6993],[1.7978,49.6995],[1.8043,49.7015],[1.8048,49.701],[1.8162,49.7066],[1.818,49.7068],[1.8211,49.7055],[1.8246,49.7057],[1.838,49.709],[1.8439,49.7045],[1.8465,49.7048],[1.86,49.6908],[1.864,49.6832],[1.8503,49.6823],[1.83,49.6837],[1.8189,49.6824],[1.8165,49.6852],[1.8151,49.685],[1.809,49.6914],[1.8062,49.6904],[1.8018,49.6901],[1.8048,49.6832],[1.7953,49.6815]]]},"60600":{"type":"Polygon","coordinates":[[[2.7533,49.2885],[2.7497,49.2785],[2.7468,49.2751],[2.7391,49.2757],[2.7387,49.2762],[2.7428,49.2766],[2.7437,49.2796],[2.7398,49.2795],[2.7424,49.286],[2.7369,49.293],[2.735,49.2941],[2.7336,49.2986],[2.7295,49.2986],[2.7278,49.2996],[2.7285,49.3019],[2.7317,49.3064],[2.7405,49.3076],[2.7402,49.3113],[2.7477,49.311],[2.7508,49.3093],[2.757,49.3112],[2.7578,49.3104],[2.7571,49.3078],[2.758,49.3064],[2.7575,49.3049],[2.7582,49.3044],[2.757,49.3025],[2.7558,49.2986],[2.7564,49.298],[2.7558,49.2981],[2.7552,49.2964],[2.7559,49.2963],[2.7533,49.2885]]]},"60601":{"type":"Polygon","coordinates":[[[2.3781,49.262],[2.3725,49.2652],[2.3717,49.2668],[2.3774,49.2679],[2.3846,49.2783],[2.3832,49.2782],[2.3842,49.2796],[2.3925,49.2833],[2.3908,49.2874],[2.3913,49.2881],[2.3896,49.2877],[2.3916,49.2902],[2.3974,49.2903],[2.3982,49.295],[2.3975,49.2958],[2.3989,49.2965],[2.401,49.2943],[2.408,49.2955],[2.4079,49.2961],[2.4087,49.2962],[2.411,49.2917],[2.4131,49.2915],[2.4128,49.2908],[2.4168,49.2893],[2.4159,49.2883],[2.4164,49.2879],[2.4232,49.2851],[2.4313,49.2846],[2.4309,49.2839],[2.4331,49.2839],[2.4356,49.282],[2.4347,49.28],[2.4298,49.2802],[2.429,49.2789],[2.4262,49.2792],[2.4242,49.279],[2.4243,49.2785],[2.4234,49.2799],[2.4214,49.2789],[2.4208,49.2798],[2.4186,49.2794],[2.4175,49.2806],[2.4142,49.2795],[2.4127,49.2774],[2.4129,49.2759],[2.4113,49.276],[2.4113,49.275],[2.4099,49.2745],[2.4096,49.2761],[2.4045,49.2754],[2.4051,49.2726],[2.4041,49.2728],[2.401,49.2704],[2.4,49.2679],[2.4031,49.267],[2.4027,49.2665],[2.4041,49.2649],[2.4079,49.2633],[2.4072,49.2616],[2.4082,49.2592],[2.4055,49.261],[2.4034,49.2596],[2.4031,49.258],[2.3978,49.2603],[2.3933,49.2589],[2.3888,49.2599],[2.3821,49.2602],[2.3806,49.2612],[2.3806,49.2624],[2.3781,49.262]]]},"60602":{"type":"Polygon","coordinates":[[[1.7148,49.7138],[1.7143,49.7206],[1.7133,49.7221],[1.7119,49.7311],[1.7131,49.7342],[1.7196,49.7306],[1.7232,49.7302],[1.7295,49.7333],[1.7357,49.735],[1.7348,49.7377],[1.7357,49.7378],[1.7366,49.736],[1.7394,49.7367],[1.7407,49.7383],[1.7429,49.7384],[1.7427,49.7346],[1.7448,49.733],[1.7433,49.7323],[1.7486,49.7284],[1.7466,49.7273],[1.7479,49.7257],[1.7417,49.7226],[1.7416,49.7216],[1.7345,49.7162],[1.7349,49.7151],[1.7285,49.7118],[1.7277,49.713],[1.7264,49.7129],[1.7263,49.7142],[1.7224,49.7158],[1.7148,49.7138]]]},"60603":{"type":"Polygon","coordinates":[[[3.0288,49.6054],[3.0344,49.6069],[3.037,49.6033],[3.0414,49.604],[3.0431,49.6017],[3.049,49.6034],[3.0437,49.6062],[3.0446,49.6067],[3.0484,49.6048],[3.051,49.605],[3.0522,49.6024],[3.0516,49.6012],[3.0522,49.5998],[3.0549,49.5957],[3.0587,49.5926],[3.0611,49.5866],[3.0625,49.5866],[3.0629,49.5843],[3.0643,49.5844],[3.0654,49.5808],[3.0664,49.581],[3.0667,49.5796],[3.0681,49.58],[3.0716,49.5756],[3.0704,49.5743],[3.0711,49.5725],[3.0675,49.5725],[3.067,49.5719],[3.0685,49.5704],[3.0652,49.5704],[3.0645,49.5698],[3.065,49.5689],[3.0627,49.5677],[3.0617,49.5697],[3.0606,49.5701],[3.0552,49.5691],[3.0529,49.5704],[3.0551,49.5714],[3.0547,49.5733],[3.0526,49.5721],[3.0518,49.5731],[3.0506,49.5732],[3.0501,49.5724],[3.0484,49.5735],[3.0502,49.5742],[3.0529,49.5772],[3.0517,49.5797],[3.0461,49.5781],[3.0394,49.5789],[3.0334,49.5781],[3.033,49.5789],[3.0341,49.5791],[3.0325,49.5834],[3.0293,49.5856],[3.026,49.584],[3.025,49.5843],[3.0224,49.5869],[3.0204,49.5873],[3.0241,49.5909],[3.0245,49.5932],[3.0272,49.5948],[3.0272,49.5958],[3.0245,49.5966],[3.0308,49.6026],[3.0288,49.6054]]]},"60604":{"type":"Polygon","coordinates":[[[1.8934,49.6613],[1.8918,49.661],[1.8909,49.6626],[1.8776,49.6605],[1.8721,49.6692],[1.8683,49.668],[1.8615,49.6746],[1.8613,49.6734],[1.8596,49.6741],[1.8585,49.6732],[1.8568,49.6736],[1.8566,49.6764],[1.8541,49.6771],[1.8532,49.6752],[1.8496,49.676],[1.8466,49.6718],[1.8476,49.6718],[1.8426,49.6687],[1.841,49.6712],[1.8432,49.672],[1.8424,49.6739],[1.841,49.6732],[1.8402,49.6746],[1.854,49.68],[1.8351,49.681],[1.8267,49.6804],[1.8266,49.6819],[1.8254,49.6832],[1.8324,49.6836],[1.8503,49.6823],[1.864,49.6832],[1.86,49.6908],[1.8491,49.7017],[1.8576,49.7041],[1.868,49.7042],[1.875,49.699],[1.8765,49.6999],[1.8788,49.6981],[1.881,49.6977],[1.8881,49.6915],[1.8919,49.6912],[1.9019,49.6874],[1.9035,49.6846],[1.9003,49.6835],[1.8999,49.6796],[1.9051,49.6726],[1.909,49.6707],[1.9118,49.6679],[1.9023,49.6634],[1.8934,49.6613]]]},"60605":{"type":"Polygon","coordinates":[[[1.9035,49.6846],[1.9076,49.6869],[1.9102,49.6859],[1.9214,49.6865],[1.936,49.6914],[1.9365,49.6897],[1.9376,49.6912],[1.9438,49.6872],[1.9455,49.6842],[1.9467,49.6854],[1.9487,49.6842],[1.9519,49.684],[1.953,49.6824],[1.9425,49.6775],[1.9376,49.6764],[1.9376,49.6746],[1.9356,49.6746],[1.9356,49.6729],[1.9149,49.6687],[1.9128,49.6713],[1.9095,49.6702],[1.9051,49.6726],[1.8999,49.6796],[1.9003,49.6835],[1.9035,49.6846]]]},"60608":{"type":"Polygon","coordinates":[[[2.143,49.6172],[2.1421,49.6174],[2.1425,49.6181],[2.1344,49.6171],[2.1349,49.6195],[2.1291,49.6215],[2.1259,49.6202],[2.121,49.626],[2.1246,49.6277],[2.1218,49.6302],[2.1175,49.6291],[2.1185,49.6334],[2.1208,49.6334],[2.1247,49.6355],[2.1256,49.6352],[2.1277,49.6437],[2.1309,49.6462],[2.1337,49.6458],[2.1339,49.644],[2.1424,49.6437],[2.1436,49.6405],[2.146,49.6398],[2.1474,49.6402],[2.1478,49.6383],[2.15,49.6375],[2.15,49.6366],[2.1517,49.6351],[2.1495,49.6315],[2.1506,49.6283],[2.1498,49.6282],[2.1495,49.627],[2.1505,49.6238],[2.1463,49.6224],[2.1472,49.6218],[2.143,49.6172]]]},"60609":{"type":"Polygon","coordinates":[[[1.992,49.4587],[1.9855,49.4562],[1.9859,49.4558],[1.984,49.4537],[1.9831,49.4544],[1.9776,49.4525],[1.977,49.4538],[1.9719,49.4524],[1.9703,49.4527],[1.9686,49.4541],[1.9653,49.4523],[1.9626,49.4487],[1.9593,49.4468],[1.9522,49.4473],[1.9513,49.4491],[1.9482,49.4502],[1.9436,49.4508],[1.9403,49.4496],[1.9404,49.4512],[1.9389,49.4521],[1.9404,49.4523],[1.9407,49.4531],[1.9383,49.4544],[1.9363,49.4537],[1.9363,49.4528],[1.9338,49.4529],[1.9338,49.455],[1.9363,49.4561],[1.9372,49.4576],[1.9363,49.4586],[1.9363,49.4615],[1.9354,49.4629],[1.9303,49.4637],[1.9326,49.4686],[1.93,49.4691],[1.9257,49.4721],[1.9295,49.4722],[1.9303,49.4739],[1.932,49.4745],[1.9317,49.4752],[1.9375,49.478],[1.938,49.4757],[1.94,49.4732],[1.9389,49.4728],[1.9401,49.4714],[1.9459,49.474],[1.9467,49.4753],[1.9511,49.4742],[1.9532,49.4748],[1.9574,49.478],[1.9591,49.4774],[1.9623,49.4784],[1.963,49.4771],[1.9641,49.4776],[1.9684,49.4747],[1.9704,49.4747],[1.9768,49.4696],[1.978,49.4699],[1.9815,49.4663],[1.9832,49.4668],[1.9842,49.4649],[1.9868,49.4651],[1.991,49.4611],[1.992,49.4587]]]},"60610":{"type":"Polygon","coordinates":[[[2.9916,49.5493],[2.9912,49.5506],[2.9829,49.5529],[2.9822,49.5526],[2.984,49.5512],[2.983,49.5507],[2.9835,49.5489],[2.9815,49.5482],[2.9826,49.5498],[2.9809,49.5506],[2.9804,49.548],[2.9796,49.5479],[2.9773,49.5502],[2.9772,49.5538],[2.98,49.5562],[2.9832,49.5574],[2.9845,49.5596],[2.9875,49.5612],[2.9883,49.5634],[2.9957,49.564],[3.0043,49.5634],[3.0036,49.5605],[3.0072,49.5597],[3.0087,49.5579],[3.0126,49.5558],[3.0164,49.5554],[3.0171,49.5539],[3.0157,49.5523],[3.0175,49.5513],[3.018,49.5528],[3.0202,49.5525],[3.0204,49.5513],[3.0186,49.5508],[3.0222,49.5485],[3.0244,49.548],[3.0238,49.549],[3.0257,49.5509],[3.0274,49.5495],[3.0261,49.5487],[3.0256,49.5468],[3.0235,49.5466],[3.0172,49.5433],[3.0114,49.5445],[3.0098,49.5441],[3.0023,49.5469],[3.0003,49.5449],[3.0007,49.5434],[2.9993,49.5411],[2.9939,49.5411],[2.9934,49.5438],[2.9986,49.5461],[3.0001,49.548],[2.9999,49.5489],[2.9916,49.5493]]]},"60611":{"type":"Polygon","coordinates":[[[1.8218,49.4491],[1.799,49.4541],[1.8013,49.4616],[1.8027,49.461],[1.8037,49.4619],[1.7993,49.4625],[1.7982,49.4656],[1.8093,49.4684],[1.8107,49.4757],[1.809,49.477],[1.8131,49.4835],[1.8141,49.4903],[1.8124,49.4924],[1.8126,49.4953],[1.8163,49.495],[1.8195,49.4971],[1.8235,49.4977],[1.8233,49.5011],[1.8262,49.505],[1.8323,49.5069],[1.833,49.5091],[1.8358,49.5119],[1.8356,49.5145],[1.838,49.5145],[1.8479,49.5117],[1.8586,49.513],[1.86,49.512],[1.864,49.5116],[1.8645,49.5108],[1.8684,49.5121],[1.8689,49.511],[1.8667,49.5062],[1.8684,49.5059],[1.8676,49.5033],[1.8682,49.5025],[1.8671,49.5016],[1.8687,49.5007],[1.8685,49.4996],[1.8631,49.4995],[1.8619,49.4963],[1.861,49.4964],[1.8575,49.4895],[1.8558,49.4892],[1.8575,49.4885],[1.8562,49.4855],[1.854,49.4845],[1.8592,49.4788],[1.8582,49.4787],[1.8586,49.4781],[1.8502,49.4718],[1.8499,49.4698],[1.8489,49.4698],[1.8485,49.467],[1.8465,49.4676],[1.8427,49.4649],[1.84,49.4646],[1.8378,49.4611],[1.8355,49.4597],[1.8271,49.4501],[1.8225,49.4512],[1.8218,49.4491]]]},"60612":{"type":"Polygon","coordinates":[[[2.5655,49.2581],[2.5828,49.2459],[2.612,49.2458],[2.5951,49.2384],[2.5872,49.2308],[2.596,49.2157],[2.5957,49.2148],[2.5986,49.2155],[2.6027,49.2142],[2.601,49.2122],[2.606,49.2135],[2.6092,49.2094],[2.6336,49.2119],[2.6315,49.2093],[2.6297,49.2098],[2.6282,49.2086],[2.6268,49.209],[2.6195,49.2013],[2.6129,49.1984],[2.6172,49.1978],[2.6167,49.1963],[2.6157,49.1966],[2.6149,49.1957],[2.6144,49.1942],[2.6176,49.194],[2.6169,49.1919],[2.6179,49.1894],[2.616,49.1891],[2.6159,49.1856],[2.6118,49.1846],[2.6058,49.1814],[2.6054,49.1785],[2.6046,49.1781],[2.5848,49.1731],[2.5795,49.18],[2.5826,49.1845],[2.5743,49.1861],[2.5753,49.1868],[2.5739,49.1875],[2.5657,49.1885],[2.5619,49.1877],[2.5603,49.1885],[2.5644,49.1919],[2.5617,49.1919],[2.5613,49.1932],[2.56,49.1928],[2.5613,49.1953],[2.5593,49.1957],[2.5585,49.1984],[2.5567,49.1981],[2.5564,49.1988],[2.5617,49.1997],[2.5625,49.2008],[2.5616,49.2036],[2.5651,49.2088],[2.5578,49.2109],[2.563,49.2158],[2.5681,49.2224],[2.5745,49.2259],[2.5666,49.2304],[2.571,49.2346],[2.5638,49.2366],[2.5676,49.2427],[2.5588,49.2427],[2.5591,49.2447],[2.5538,49.2445],[2.5487,49.2505],[2.5538,49.2528],[2.5549,49.2524],[2.5565,49.2541],[2.5655,49.2581]]]},"60613":{"type":"Polygon","coordinates":[[[1.9817,49.2682],[1.9843,49.2696],[1.98,49.2717],[1.981,49.2727],[1.9817,49.2725],[1.9822,49.2743],[1.9842,49.2726],[1.9878,49.2724],[1.9904,49.2773],[1.9957,49.2766],[2.0034,49.2738],[1.9984,49.2691],[1.9993,49.2687],[1.9987,49.2678],[2.0082,49.2662],[2.0085,49.2654],[2.0112,49.2657],[2.0125,49.2648],[2.0164,49.2652],[2.0213,49.2631],[2.0202,49.2609],[2.0208,49.2605],[2.0256,49.2634],[2.0294,49.2625],[2.0368,49.2647],[2.0455,49.2646],[2.0462,49.261],[2.0438,49.2608],[2.044,49.2567],[2.0376,49.2539],[2.0378,49.251],[2.034,49.2523],[2.0331,49.2547],[2.0301,49.2495],[2.0246,49.2495],[2.024,49.2477],[2.0193,49.2486],[2.015,49.2483],[2.0131,49.2491],[2.0105,49.2478],[2.0105,49.2493],[2.0084,49.2491],[2.0092,49.2502],[2.0076,49.2512],[2.0034,49.2512],[2.0029,49.2533],[2.0056,49.2617],[1.9981,49.2638],[1.996,49.2616],[1.9946,49.2622],[1.9917,49.2607],[1.9883,49.2623],[1.9891,49.2628],[1.9817,49.2682]]]},"60614":{"type":"Polygon","coordinates":[[[1.8318,49.2169],[1.8346,49.2177],[1.8411,49.2163],[1.8405,49.2197],[1.8504,49.2136],[1.8449,49.2086],[1.8441,49.2091],[1.8404,49.2066],[1.8396,49.207],[1.8384,49.2035],[1.8365,49.202],[1.8349,49.2022],[1.8337,49.2008],[1.8344,49.2003],[1.8328,49.1991],[1.8284,49.2019],[1.8239,49.1985],[1.8258,49.1988],[1.8314,49.1932],[1.832,49.1917],[1.8329,49.1923],[1.8379,49.1913],[1.8392,49.1899],[1.8385,49.1882],[1.8397,49.1881],[1.8408,49.1848],[1.8434,49.1828],[1.8399,49.1806],[1.8444,49.1786],[1.846,49.1767],[1.8481,49.178],[1.8491,49.1771],[1.8467,49.1755],[1.849,49.1724],[1.8479,49.172],[1.8489,49.1706],[1.8452,49.17],[1.8447,49.1707],[1.8387,49.1668],[1.8364,49.1645],[1.8343,49.1652],[1.8352,49.1661],[1.836,49.1701],[1.8374,49.1717],[1.8372,49.1731],[1.8347,49.1745],[1.8358,49.1764],[1.8349,49.1769],[1.8342,49.1759],[1.8325,49.176],[1.8319,49.1773],[1.8292,49.1777],[1.8268,49.1797],[1.8195,49.1769],[1.8192,49.1759],[1.8156,49.1749],[1.816,49.1739],[1.8118,49.174],[1.8113,49.1749],[1.8145,49.1761],[1.8131,49.1783],[1.8074,49.1799],[1.8036,49.18],[1.8036,49.181],[1.8003,49.1804],[1.8,49.1823],[1.8033,49.1818],[1.8031,49.1851],[1.797,49.1852],[1.7977,49.187],[1.8028,49.1868],[1.8035,49.1905],[1.8071,49.191],[1.8077,49.1925],[1.8061,49.1934],[1.8083,49.1966],[1.8101,49.1976],[1.8134,49.1945],[1.8147,49.1951],[1.8196,49.1945],[1.8194,49.196],[1.8142,49.1977],[1.8146,49.1996],[1.8209,49.1995],[1.8243,49.2019],[1.8239,49.2046],[1.8265,49.2065],[1.8241,49.2077],[1.824,49.2091],[1.8252,49.2101],[1.8244,49.2104],[1.8258,49.2123],[1.8323,49.2165],[1.8318,49.2169]]]},"60615":{"type":"Polygon","coordinates":[[[2.4494,49.6472],[2.4503,49.6473],[2.4526,49.641],[2.4427,49.6373],[2.4432,49.6352],[2.4423,49.6339],[2.4433,49.6337],[2.4381,49.6311],[2.4386,49.63],[2.4322,49.6284],[2.4322,49.6256],[2.4346,49.6206],[2.4368,49.6184],[2.4291,49.6172],[2.4297,49.6193],[2.4249,49.623],[2.4262,49.6254],[2.4255,49.6275],[2.4275,49.6282],[2.4264,49.6294],[2.4237,49.6289],[2.4219,49.6319],[2.4223,49.6327],[2.4202,49.6327],[2.4238,49.6351],[2.4272,49.6404],[2.4278,49.6434],[2.4287,49.6439],[2.4281,49.6446],[2.4389,49.646],[2.4406,49.6438],[2.4494,49.6472]]]},"60616":{"type":"Polygon","coordinates":[[[1.758,49.357],[1.7588,49.3572],[1.7586,49.3587],[1.7616,49.3611],[1.7599,49.3635],[1.761,49.3642],[1.7605,49.3651],[1.7613,49.3663],[1.7596,49.3665],[1.7587,49.3678],[1.7657,49.3706],[1.7698,49.3711],[1.7801,49.3769],[1.7884,49.3798],[1.791,49.3801],[1.7954,49.3773],[1.796,49.3803],[1.7983,49.3842],[1.7997,49.3846],[1.801,49.3865],[1.8042,49.3865],[1.8131,49.3934],[1.8167,49.3892],[1.8183,49.3884],[1.8332,49.3877],[1.8335,49.384],[1.8318,49.3799],[1.835,49.3766],[1.8305,49.3745],[1.8289,49.3702],[1.8232,49.3687],[1.8209,49.3637],[1.819,49.3625],[1.819,49.3601],[1.8176,49.3591],[1.8175,49.358],[1.8128,49.3564],[1.806,49.3569],[1.8049,49.3523],[1.8021,49.3463],[1.8015,49.3466],[1.7994,49.3451],[1.7945,49.3383],[1.7992,49.333],[1.7978,49.3304],[1.7915,49.33],[1.7717,49.3267],[1.7716,49.326],[1.7699,49.3263],[1.7702,49.3278],[1.772,49.3278],[1.7727,49.3292],[1.772,49.3295],[1.7722,49.3323],[1.7746,49.3346],[1.7744,49.3371],[1.7717,49.3388],[1.7706,49.3386],[1.768,49.3396],[1.7687,49.3415],[1.7657,49.3426],[1.7657,49.3441],[1.767,49.3447],[1.7655,49.3463],[1.7656,49.3471],[1.7643,49.3475],[1.7612,49.351],[1.7615,49.3516],[1.7597,49.3533],[1.7603,49.3554],[1.758,49.357]]]},"60617":{"type":"Polygon","coordinates":[[[2.9398,49.6052],[2.9477,49.6128],[2.9309,49.6229],[2.933,49.6223],[2.941,49.6281],[2.9417,49.6274],[2.944,49.6296],[2.9453,49.6292],[2.9461,49.6305],[2.9508,49.6265],[2.9536,49.6287],[2.9566,49.6292],[2.9597,49.6267],[2.9641,49.6254],[2.966,49.6223],[2.9671,49.6218],[2.9764,49.621],[2.9783,49.6216],[2.9841,49.6203],[2.9832,49.619],[2.981,49.6185],[2.9754,49.6197],[2.9633,49.6132],[2.9637,49.6127],[2.959,49.6094],[2.9603,49.6087],[2.9515,49.6022],[2.9491,49.5991],[2.9398,49.6052]]]},"60618":{"type":"Polygon","coordinates":[[[2.8388,49.2473],[2.8385,49.2482],[2.8395,49.2483],[2.8388,49.2502],[2.8381,49.2502],[2.8375,49.2544],[2.8384,49.2544],[2.8391,49.2577],[2.845,49.2577],[2.8478,49.2587],[2.8499,49.2619],[2.8515,49.2622],[2.8509,49.2634],[2.8488,49.2642],[2.849,49.2672],[2.8577,49.2677],[2.858,49.2722],[2.8819,49.2693],[2.8807,49.2625],[2.8794,49.2626],[2.8793,49.2533],[2.8656,49.2554],[2.8659,49.2527],[2.8675,49.2509],[2.8648,49.2484],[2.8603,49.2474],[2.8579,49.2439],[2.8526,49.2448],[2.8529,49.2453],[2.847,49.2453],[2.8469,49.2464],[2.842,49.2461],[2.8422,49.2474],[2.839,49.2468],[2.8388,49.2473]]]},"60619":{"type":"Polygon","coordinates":[[[2.7917,49.0903],[2.7839,49.0889],[2.7641,49.1028],[2.7679,49.1049],[2.7649,49.1078],[2.7624,49.1128],[2.7591,49.1141],[2.7626,49.1181],[2.762,49.1184],[2.7677,49.1238],[2.7674,49.1246],[2.7747,49.1241],[2.789,49.1247],[2.7987,49.1237],[2.8011,49.1229],[2.8034,49.1206],[2.8135,49.1136],[2.8154,49.1062],[2.8109,49.0982],[2.7917,49.0903]]]},"60620":{"type":"Polygon","coordinates":[[[2.1629,49.3346],[2.17,49.3349],[2.1729,49.3366],[2.1741,49.3358],[2.1751,49.3364],[2.1781,49.33],[2.1836,49.3249],[2.1674,49.3153],[2.1654,49.3125],[2.1626,49.3104],[2.1656,49.3046],[2.1689,49.3044],[2.1609,49.296],[2.1532,49.2945],[2.1466,49.2981],[2.1376,49.2996],[2.1369,49.305],[2.1396,49.306],[2.1394,49.3077],[2.1382,49.3091],[2.1393,49.3131],[2.1354,49.3132],[2.1337,49.3152],[2.1259,49.3158],[2.126,49.3165],[2.1226,49.3173],[2.1275,49.3198],[2.1225,49.3211],[2.1232,49.3214],[2.1224,49.3216],[2.1284,49.3262],[2.1353,49.328],[2.1337,49.3299],[2.141,49.3311],[2.1411,49.3318],[2.1428,49.3314],[2.1429,49.3326],[2.1498,49.3332],[2.1571,49.335],[2.1576,49.3341],[2.1629,49.3346]]]},"60621":{"type":"Polygon","coordinates":[[[2.8821,49.7138],[2.8835,49.7141],[2.8863,49.7109],[2.8856,49.7103],[2.8869,49.7106],[2.8866,49.7088],[2.8852,49.7089],[2.8865,49.7082],[2.8854,49.7078],[2.8855,49.7068],[2.8865,49.7068],[2.8868,49.7053],[2.8876,49.7055],[2.8871,49.7048],[2.8882,49.7033],[2.8909,49.7016],[2.8909,49.7007],[2.89,49.7004],[2.8924,49.7004],[2.892,49.6988],[2.8945,49.6957],[2.8921,49.695],[2.8923,49.6926],[2.8943,49.693],[2.8955,49.6899],[2.8945,49.6889],[2.8965,49.6878],[2.8972,49.6882],[2.8985,49.6864],[2.8963,49.6852],[2.8936,49.686],[2.8925,49.6854],[2.8916,49.6834],[2.8884,49.6822],[2.8877,49.6834],[2.8886,49.6865],[2.8869,49.6885],[2.8848,49.6894],[2.8829,49.689],[2.8811,49.6904],[2.8797,49.6902],[2.8767,49.693],[2.8773,49.6963],[2.8753,49.6957],[2.8742,49.6968],[2.8736,49.6964],[2.8719,49.6987],[2.8701,49.6981],[2.8693,49.6989],[2.87,49.6992],[2.8663,49.7026],[2.8678,49.7028],[2.8675,49.7035],[2.8705,49.7037],[2.8703,49.7047],[2.8712,49.7044],[2.8712,49.705],[2.878,49.7065],[2.878,49.7073],[2.8814,49.7081],[2.8819,49.7093],[2.885,49.7095],[2.8821,49.7138]]]},"60622":{"type":"Polygon","coordinates":[[[2.0404,49.6658],[2.0444,49.659],[2.0339,49.6598],[2.0307,49.6588],[2.0295,49.6599],[2.0261,49.6595],[2.0224,49.6606],[2.0163,49.6648],[2.0156,49.6645],[2.0144,49.6682],[2.0014,49.6659],[1.9912,49.6667],[1.9775,49.6667],[1.9768,49.6676],[1.9596,49.6662],[1.9561,49.6711],[1.9572,49.6713],[1.956,49.6731],[1.9567,49.6733],[1.9544,49.6766],[1.9569,49.6778],[1.9542,49.681],[1.9605,49.6833],[1.9682,49.6831],[1.9729,49.6848],[1.9773,49.6882],[1.9836,49.6839],[1.9856,49.6871],[1.9886,49.6889],[2.0037,49.6786],[2.0129,49.6774],[2.0271,49.6806],[2.026,49.6848],[2.0281,49.6847],[2.03,49.6881],[2.0359,49.6859],[2.0394,49.687],[2.0402,49.6891],[2.0422,49.6902],[2.0462,49.6893],[2.0509,49.6863],[2.0464,49.6828],[2.0486,49.678],[2.0346,49.6738],[2.037,49.6694],[2.0376,49.6695],[2.0404,49.6658]]]},"60623":{"type":"Polygon","coordinates":[[[1.8314,49.5487],[1.8297,49.5484],[1.8298,49.5492],[1.8314,49.5501],[1.8289,49.551],[1.8296,49.5558],[1.8278,49.5576],[1.8268,49.5598],[1.8239,49.5608],[1.8211,49.5625],[1.8188,49.5653],[1.817,49.5657],[1.8184,49.5672],[1.8178,49.5685],[1.8278,49.5732],[1.8276,49.5756],[1.8284,49.5762],[1.8291,49.5749],[1.8338,49.5767],[1.8402,49.5756],[1.8388,49.578],[1.8395,49.5786],[1.8389,49.5794],[1.8452,49.5805],[1.8439,49.5818],[1.8456,49.5828],[1.8462,49.5822],[1.8485,49.5831],[1.8533,49.5799],[1.8572,49.5811],[1.8599,49.5804],[1.8613,49.5824],[1.8645,49.5801],[1.8628,49.5794],[1.8677,49.576],[1.8668,49.5742],[1.8682,49.5727],[1.8706,49.5729],[1.8738,49.5718],[1.8777,49.5742],[1.8779,49.5736],[1.879,49.574],[1.8786,49.5747],[1.8793,49.575],[1.8823,49.5712],[1.8791,49.5689],[1.8818,49.5672],[1.8832,49.5677],[1.884,49.5665],[1.8841,49.5642],[1.881,49.5621],[1.8829,49.5602],[1.8701,49.5456],[1.8688,49.5461],[1.8635,49.5436],[1.8616,49.5437],[1.8597,49.5418],[1.8586,49.5427],[1.858,49.5415],[1.8466,49.5474],[1.838,49.5483],[1.838,49.5489],[1.8345,49.5495],[1.8314,49.5487]]]},"60624":{"type":"Polygon","coordinates":[[[1.7734,49.5456],[1.7644,49.5463],[1.7606,49.5487],[1.7536,49.5496],[1.7544,49.5503],[1.7534,49.5509],[1.7596,49.5543],[1.7653,49.5587],[1.7781,49.5633],[1.7775,49.5641],[1.7807,49.5652],[1.7803,49.5655],[1.7846,49.5691],[1.7818,49.5716],[1.7869,49.5748],[1.7913,49.5742],[1.8012,49.5689],[1.7982,49.5659],[1.7994,49.5615],[1.7913,49.5567],[1.7928,49.5562],[1.7917,49.5551],[1.7924,49.5545],[1.7897,49.5545],[1.7879,49.5538],[1.7881,49.553],[1.7871,49.5526],[1.7853,49.5519],[1.7844,49.5525],[1.7783,49.5494],[1.7773,49.5497],[1.7737,49.5485],[1.7736,49.5475],[1.7756,49.5477],[1.7734,49.5456]]]},"60625":{"type":"Polygon","coordinates":[[[2.9303,49.5731],[2.9269,49.5746],[2.9226,49.5787],[2.923,49.5824],[2.9241,49.5841],[2.9242,49.5852],[2.9235,49.5852],[2.9265,49.5882],[2.9278,49.5925],[2.9256,49.5944],[2.9236,49.5942],[2.9231,49.5968],[2.9246,49.5975],[2.9294,49.5982],[2.9344,49.5947],[2.9415,49.5933],[2.9437,49.5918],[2.9444,49.5901],[2.9495,49.5901],[2.9507,49.587],[2.9542,49.5853],[2.9594,49.5796],[2.9595,49.5789],[2.9554,49.5777],[2.9548,49.576],[2.9525,49.5744],[2.9555,49.5718],[2.9374,49.5708],[2.9303,49.5731]]]},"60626":{"type":"Polygon","coordinates":[[[1.7199,49.3955],[1.7232,49.3975],[1.7272,49.3975],[1.7299,49.401],[1.7339,49.4017],[1.7455,49.4091],[1.7524,49.4043],[1.7569,49.4055],[1.7709,49.399],[1.7703,49.3971],[1.768,49.3953],[1.7674,49.3903],[1.7646,49.3836],[1.7611,49.3788],[1.7615,49.3782],[1.7642,49.3771],[1.7682,49.3792],[1.771,49.3788],[1.776,49.3801],[1.7761,49.3794],[1.7801,49.3769],[1.7698,49.3711],[1.7579,49.3683],[1.7565,49.369],[1.7568,49.3706],[1.7507,49.3706],[1.7497,49.3716],[1.748,49.3716],[1.7479,49.3747],[1.7454,49.3761],[1.7466,49.3776],[1.7444,49.3808],[1.7431,49.3818],[1.7412,49.3812],[1.7363,49.3837],[1.7325,49.3885],[1.7301,49.3897],[1.7299,49.3909],[1.729,49.3908],[1.7286,49.3918],[1.7275,49.3915],[1.7212,49.3931],[1.7199,49.3955]]]},"60627":{"type":"Polygon","coordinates":[[[2.3569,49.6185],[2.3533,49.6201],[2.3533,49.6215],[2.3475,49.6246],[2.3421,49.6292],[2.3401,49.629],[2.3365,49.6378],[2.3502,49.6444],[2.3562,49.6454],[2.3579,49.6464],[2.3618,49.6466],[2.3625,49.6463],[2.3616,49.6459],[2.3612,49.6423],[2.3601,49.6417],[2.3607,49.6412],[2.3601,49.6406],[2.3618,49.6408],[2.3621,49.6401],[2.3669,49.6429],[2.3701,49.6423],[2.3744,49.6449],[2.3739,49.6453],[2.3777,49.6461],[2.3773,49.6474],[2.3781,49.6465],[2.38,49.6472],[2.3891,49.6432],[2.3962,49.6367],[2.3942,49.6354],[2.3906,49.6362],[2.3799,49.6314],[2.3768,49.633],[2.3769,49.6289],[2.3752,49.6296],[2.3752,49.6304],[2.3736,49.6306],[2.3737,49.6299],[2.368,49.6288],[2.3695,49.6264],[2.3643,49.6239],[2.3644,49.6224],[2.3631,49.6217],[2.3565,49.6214],[2.3569,49.6185]]]},"60628":{"type":"Polygon","coordinates":[[[2.14,49.4445],[2.1441,49.4455],[2.1464,49.4426],[2.1442,49.4414],[2.1469,49.439],[2.1493,49.4347],[2.1534,49.4351],[2.1537,49.4321],[2.1643,49.4321],[2.1643,49.4303],[2.1665,49.43],[2.1661,49.4292],[2.1706,49.4269],[2.1701,49.4265],[2.1736,49.4251],[2.1741,49.4257],[2.1795,49.4243],[2.1788,49.4233],[2.1833,49.4219],[2.1801,49.4171],[2.1785,49.4172],[2.1701,49.4068],[2.1683,49.4062],[2.1673,49.4073],[2.165,49.4057],[2.1679,49.4042],[2.1664,49.4031],[2.1634,49.4043],[2.1593,49.4022],[2.1564,49.4042],[2.1586,49.4057],[2.1506,49.41],[2.1434,49.4188],[2.1406,49.4194],[2.1413,49.4202],[2.1402,49.4208],[2.142,49.4214],[2.1414,49.4217],[2.136,49.4227],[2.1333,49.42],[2.1309,49.4203],[2.1297,49.4186],[2.1293,49.4199],[2.1257,49.4195],[2.126,49.4241],[2.1269,49.4239],[2.1277,49.427],[2.1255,49.4276],[2.1266,49.4307],[2.1276,49.4305],[2.1278,49.432],[2.1292,49.4322],[2.1288,49.434],[2.1339,49.4348],[2.1338,49.4361],[2.1322,49.4367],[2.1316,49.4367],[2.1317,49.4355],[2.1294,49.4357],[2.1299,49.4368],[2.1286,49.4369],[2.1284,49.4384],[2.1365,49.4383],[2.1378,49.4411],[2.1401,49.4407],[2.1412,49.4429],[2.14,49.4445]]]},"60629":{"type":"Polygon","coordinates":[[[1.8688,49.5945],[1.8718,49.6031],[1.8778,49.6087],[1.8789,49.6084],[1.8793,49.6125],[1.8828,49.6148],[1.8801,49.617],[1.8794,49.6204],[1.8808,49.6227],[1.8904,49.6262],[1.8978,49.6253],[1.9039,49.6225],[1.9041,49.6183],[1.9006,49.612],[1.9061,49.6086],[1.9065,49.6073],[1.9112,49.6068],[1.9113,49.6052],[1.9138,49.6052],[1.9167,49.6022],[1.9184,49.6027],[1.9209,49.6018],[1.9197,49.5998],[1.9219,49.5994],[1.9232,49.598],[1.9179,49.5957],[1.9143,49.5961],[1.9108,49.5977],[1.9082,49.5965],[1.907,49.5973],[1.9062,49.5946],[1.9067,49.5939],[1.9048,49.593],[1.9077,49.5909],[1.9059,49.59],[1.9083,49.5877],[1.9072,49.5856],[1.9046,49.5839],[1.9014,49.5849],[1.8915,49.5804],[1.8916,49.5815],[1.8903,49.5812],[1.8886,49.5824],[1.8878,49.5848],[1.8882,49.5861],[1.8873,49.5872],[1.8896,49.5931],[1.8815,49.593],[1.8778,49.594],[1.8759,49.5935],[1.8758,49.5956],[1.8701,49.5931],[1.8688,49.5945]]]},"60630":{"type":"Polygon","coordinates":[[[1.9107,49.3316],[1.9135,49.3287],[1.914,49.3232],[1.916,49.3211],[1.9177,49.3208],[1.9162,49.3158],[1.9166,49.3143],[1.9151,49.3118],[1.917,49.3111],[1.914,49.3021],[1.9128,49.3],[1.9113,49.3006],[1.9058,49.2963],[1.9013,49.2912],[1.8986,49.2923],[1.8977,49.2914],[1.895,49.292],[1.8922,49.2902],[1.8869,49.2956],[1.8842,49.295],[1.883,49.2982],[1.8883,49.2998],[1.8889,49.3028],[1.8882,49.303],[1.8894,49.3031],[1.8926,49.3092],[1.8897,49.3111],[1.8916,49.3159],[1.89,49.3164],[1.8914,49.3199],[1.8954,49.3185],[1.8948,49.3211],[1.8979,49.3206],[1.8991,49.3242],[1.9001,49.3238],[1.9107,49.3316]]]},"60631":{"type":"Polygon","coordinates":[[[2.6001,49.166],[2.6004,49.164],[2.5923,49.1608],[2.5936,49.1549],[2.5974,49.1524],[2.5883,49.1498],[2.5893,49.1457],[2.5909,49.1448],[2.586,49.1402],[2.5848,49.1417],[2.5621,49.1403],[2.5622,49.1443],[2.5591,49.145],[2.5597,49.1472],[2.5586,49.1476],[2.5599,49.1495],[2.5611,49.1492],[2.5629,49.1523],[2.5617,49.1532],[2.5626,49.1532],[2.5631,49.157],[2.5711,49.1677],[2.6001,49.166]]]},"60632":{"type":"Polygon","coordinates":[[[2.8764,49.5445],[2.8723,49.5422],[2.8666,49.5413],[2.8677,49.5404],[2.8633,49.5394],[2.8608,49.5378],[2.8539,49.5382],[2.8595,49.5433],[2.8539,49.5467],[2.8479,49.5457],[2.8446,49.5468],[2.8407,49.5466],[2.8408,49.5477],[2.8323,49.5514],[2.8299,49.5512],[2.8286,49.5533],[2.8235,49.5544],[2.8265,49.5574],[2.8371,49.5619],[2.8381,49.5618],[2.8384,49.5626],[2.8512,49.5678],[2.8531,49.5696],[2.8648,49.5717],[2.8644,49.5721],[2.866,49.5726],[2.8651,49.573],[2.867,49.5732],[2.8664,49.5736],[2.8673,49.5746],[2.8709,49.5736],[2.8783,49.5762],[2.882,49.5785],[2.8825,49.5778],[2.8885,49.5779],[2.8912,49.5754],[2.8954,49.5772],[2.9009,49.5715],[2.9015,49.5671],[2.9047,49.5657],[2.9048,49.5643],[2.8968,49.5617],[2.8922,49.5583],[2.8837,49.5551],[2.8846,49.5546],[2.8796,49.5506],[2.8795,49.5491],[2.8764,49.5445]]]},"60633":{"type":"Polygon","coordinates":[[[1.9621,49.6353],[1.9508,49.6281],[1.947,49.6301],[1.9401,49.625],[1.9387,49.625],[1.9398,49.6283],[1.9379,49.6289],[1.9381,49.6295],[1.9334,49.6293],[1.9293,49.6314],[1.9317,49.6335],[1.9348,49.6342],[1.9385,49.6367],[1.9394,49.6383],[1.9386,49.6424],[1.9452,49.6417],[1.9453,49.6411],[1.9582,49.6425],[1.9562,49.6441],[1.9575,49.6444],[1.9608,49.6404],[1.957,49.6391],[1.9621,49.6353]]]},"60634":{"type":"Polygon","coordinates":[[[2.3416,49.5503],[2.3399,49.548],[2.3365,49.5473],[2.3372,49.5459],[2.3362,49.5424],[2.3279,49.534],[2.3256,49.5352],[2.3227,49.5303],[2.3195,49.5298],[2.3077,49.5291],[2.2988,49.532],[2.2969,49.5315],[2.2934,49.5329],[2.2914,49.535],[2.2885,49.5364],[2.2899,49.5384],[2.2878,49.5391],[2.2854,49.5419],[2.2842,49.5437],[2.2846,49.5453],[2.2821,49.5462],[2.2834,49.5493],[2.2849,49.549],[2.2886,49.5596],[2.2956,49.5547],[2.2998,49.5575],[2.3043,49.5541],[2.3139,49.5577],[2.3251,49.5518],[2.326,49.5529],[2.3309,49.5513],[2.3321,49.5527],[2.3416,49.5503]]]},"60635":{"type":"Polygon","coordinates":[[[2.4167,49.2423],[2.4165,49.2491],[2.4179,49.2495],[2.4156,49.2501],[2.4158,49.2507],[2.4167,49.2507],[2.4169,49.2515],[2.4185,49.2508],[2.4239,49.2511],[2.4237,49.2519],[2.428,49.2527],[2.4338,49.2509],[2.433,49.2496],[2.4362,49.2468],[2.4416,49.2451],[2.4433,49.2402],[2.4391,49.2407],[2.4368,49.2375],[2.4241,49.2408],[2.4238,49.2403],[2.4168,49.2417],[2.4167,49.2423]]]},"60636":{"type":"Polygon","coordinates":[[[2.8613,49.4792],[2.8627,49.4819],[2.8642,49.482],[2.8722,49.4869],[2.8718,49.4877],[2.8734,49.4896],[2.8764,49.4889],[2.8811,49.4902],[2.8803,49.4896],[2.8808,49.4892],[2.8864,49.488],[2.8931,49.4891],[2.8963,49.4865],[2.8994,49.4853],[2.8976,49.479],[2.8947,49.4778],[2.8911,49.4739],[2.8895,49.4699],[2.8914,49.4683],[2.8901,49.4675],[2.8847,49.4681],[2.8852,49.4702],[2.8828,49.4721],[2.8849,49.4729],[2.8839,49.4739],[2.8825,49.4732],[2.8812,49.471],[2.8777,49.4715],[2.877,49.4707],[2.8776,49.4692],[2.8743,49.4682],[2.8743,49.4691],[2.8729,49.4703],[2.8703,49.4708],[2.8687,49.4741],[2.8656,49.4737],[2.866,49.4743],[2.8613,49.4792]]]},"60637":{"type":"Polygon","coordinates":[[[3.038,49.1691],[3.0481,49.1627],[3.0463,49.1591],[3.0457,49.1555],[3.0462,49.1538],[3.0477,49.153],[3.048,49.1516],[3.0533,49.1492],[3.0523,49.1471],[3.05,49.1449],[3.056,49.1438],[3.0556,49.143],[3.0575,49.1427],[3.0551,49.1401],[3.0558,49.14],[3.0552,49.1391],[3.0561,49.139],[3.0562,49.137],[3.0549,49.1363],[3.0555,49.1352],[3.0506,49.1327],[3.0496,49.1302],[3.0466,49.1321],[3.0417,49.1333],[3.0374,49.1359],[3.0291,49.1376],[3.0297,49.139],[3.0281,49.1396],[3.0222,49.1405],[3.0196,49.142],[3.0148,49.1412],[3.01,49.1419],[2.9997,49.1415],[2.9975,49.1431],[3.0047,49.1566],[3.0066,49.1565],[3.0086,49.16],[3.0108,49.1595],[3.0137,49.1645],[3.0122,49.1652],[3.0151,49.1692],[3.0142,49.1695],[3.0227,49.1709],[3.0229,49.1702],[3.0245,49.1699],[3.0303,49.1701],[3.031,49.1709],[3.0334,49.1697],[3.038,49.1691]]]},"60638":{"type":"Polygon","coordinates":[[[2.3082,49.3675],[2.3089,49.3674],[2.3083,49.3668],[2.3119,49.3659],[2.3142,49.3683],[2.316,49.3674],[2.3212,49.3703],[2.3194,49.372],[2.3248,49.3727],[2.3264,49.3699],[2.3312,49.3702],[2.3314,49.3689],[2.3338,49.367],[2.3421,49.3661],[2.3434,49.3653],[2.3377,49.362],[2.3383,49.3613],[2.3428,49.3644],[2.3474,49.3612],[2.3483,49.3614],[2.3483,49.3594],[2.3473,49.36],[2.3455,49.358],[2.3497,49.3537],[2.3457,49.3496],[2.3438,49.3462],[2.3418,49.3467],[2.3395,49.346],[2.3399,49.3487],[2.33,49.3465],[2.3284,49.3506],[2.3256,49.3497],[2.324,49.3526],[2.323,49.3522],[2.3222,49.3537],[2.3166,49.3533],[2.3132,49.3563],[2.3065,49.3592],[2.307,49.3595],[2.3056,49.3616],[2.306,49.3645],[2.3082,49.3675]]]},"60639":{"type":"Polygon","coordinates":[[[2.0843,49.4823],[2.0884,49.4906],[2.0911,49.4913],[2.0935,49.4904],[2.0967,49.4875],[2.1057,49.4863],[2.1055,49.4875],[2.1109,49.4877],[2.1111,49.4891],[2.1127,49.4904],[2.114,49.49],[2.1154,49.489],[2.1155,49.487],[2.112,49.4852],[2.1182,49.4803],[2.1205,49.4758],[2.1207,49.4739],[2.1232,49.4759],[2.126,49.4732],[2.1298,49.4753],[2.1313,49.4739],[2.1326,49.4747],[2.1372,49.47],[2.1313,49.47],[2.1351,49.4639],[2.1398,49.4658],[2.143,49.4659],[2.1449,49.4654],[2.1459,49.4629],[2.1557,49.4597],[2.1534,49.4524],[2.1566,49.4483],[2.1365,49.4437],[2.1345,49.4447],[2.1306,49.4439],[2.1287,49.4447],[2.1285,49.4457],[2.1185,49.4501],[2.1117,49.4425],[2.0999,49.4521],[2.0923,49.4566],[2.0993,49.4605],[2.0953,49.4626],[2.0971,49.4639],[2.0887,49.4692],[2.091,49.4708],[2.0903,49.4718],[2.093,49.4736],[2.0956,49.4742],[2.0922,49.4775],[2.0877,49.4789],[2.0865,49.4802],[2.0872,49.4814],[2.0843,49.4823]]]},"60640":{"type":"Polygon","coordinates":[[[1.9486,49.2089],[1.9449,49.2076],[1.9289,49.2132],[1.9324,49.2238],[1.9319,49.2242],[1.9326,49.2242],[1.9359,49.2327],[1.9419,49.2298],[1.9435,49.2313],[1.9548,49.2277],[1.9542,49.2257],[1.9587,49.2264],[1.9522,49.2252],[1.954,49.2243],[1.9528,49.222],[1.9508,49.2212],[1.9486,49.2089]]]},"60641":{"type":"Polygon","coordinates":[[[2.9919,49.493],[2.9915,49.4923],[2.9926,49.4917],[2.9935,49.4923],[2.9949,49.4909],[2.9939,49.4897],[2.9983,49.4876],[2.9996,49.4865],[2.9999,49.4851],[3.0028,49.4836],[3.0045,49.484],[3.0048,49.4833],[3.004,49.4825],[3.0054,49.4808],[3.0087,49.4807],[3.0112,49.4789],[3.0131,49.4823],[3.0245,49.4862],[3.0285,49.4842],[3.0371,49.4827],[3.0366,49.4788],[3.0377,49.4783],[3.0386,49.4749],[3.0402,49.4731],[3.0415,49.4735],[3.0421,49.4725],[3.0415,49.4724],[3.0432,49.4707],[3.0504,49.4679],[3.0515,49.4683],[3.0538,49.4668],[3.0523,49.4639],[3.0531,49.4636],[3.0507,49.4627],[3.0477,49.4597],[3.051,49.4539],[3.0494,49.4528],[3.0489,49.4512],[3.0415,49.4508],[3.0328,49.4471],[3.0307,49.4477],[3.0316,49.4499],[3.0278,49.4505],[3.0284,49.4538],[3.0262,49.4575],[3.0168,49.4547],[3.0129,49.461],[3.0091,49.465],[3.0075,49.465],[3.0068,49.4668],[2.9975,49.4678],[2.9874,49.4612],[2.9861,49.4624],[2.977,49.4574],[2.9877,49.4505],[2.9876,49.4488],[2.9415,49.4589],[2.9701,49.4702],[2.9762,49.4881],[2.976,49.4892],[2.983,49.4875],[2.988,49.4908],[2.9892,49.4908],[2.9904,49.4929],[2.9919,49.493]]]},"60642":{"type":"Polygon","coordinates":[[[3.0355,49.496],[3.0282,49.4919],[3.0337,49.4912],[3.0369,49.4866],[3.0367,49.4847],[3.0352,49.4831],[3.0285,49.4842],[3.0245,49.4862],[3.0131,49.4823],[3.0112,49.4789],[3.0087,49.4807],[3.0054,49.4808],[3.004,49.4825],[3.0048,49.4833],[3.0045,49.484],[3.0028,49.4836],[3.0006,49.4846],[2.9983,49.4876],[2.9939,49.4897],[2.9949,49.4909],[2.9935,49.4923],[2.9926,49.4917],[2.9915,49.4923],[2.9919,49.493],[2.9955,49.4936],[2.9946,49.4958],[2.9962,49.497],[3.0004,49.4975],[3.0033,49.501],[3.0048,49.5006],[3.0055,49.5012],[3.0108,49.4986],[3.0161,49.5017],[3.0174,49.4992],[3.0355,49.496]]]},"60643":{"type":"Polygon","coordinates":[[[2.6132,49.5586],[2.6039,49.5531],[2.6067,49.5524],[2.6052,49.5507],[2.6108,49.5492],[2.6072,49.5455],[2.6078,49.5453],[2.6065,49.5438],[2.6032,49.5436],[2.6029,49.5459],[2.5965,49.5441],[2.5945,49.5467],[2.5932,49.5469],[2.5899,49.5451],[2.5882,49.5481],[2.5846,49.5459],[2.5801,49.5484],[2.5798,49.5468],[2.5714,49.5488],[2.5695,49.5536],[2.568,49.5538],[2.5681,49.555],[2.567,49.5549],[2.5674,49.5563],[2.5662,49.5569],[2.5665,49.5581],[2.565,49.5584],[2.5617,49.5613],[2.5605,49.5616],[2.5539,49.5601],[2.5522,49.5627],[2.5609,49.5646],[2.5585,49.5665],[2.5566,49.5694],[2.5521,49.5684],[2.5518,49.5704],[2.5526,49.5703],[2.5604,49.5784],[2.5616,49.5775],[2.5721,49.5818],[2.5764,49.5793],[2.5783,49.5764],[2.5838,49.5787],[2.5836,49.5763],[2.5868,49.5773],[2.5889,49.5726],[2.5956,49.5746],[2.5944,49.5756],[2.5976,49.58],[2.5988,49.5789],[2.6003,49.582],[2.6059,49.5792],[2.6066,49.5799],[2.6105,49.5776],[2.6088,49.5759],[2.6081,49.5765],[2.6034,49.5719],[2.6092,49.5687],[2.6089,49.563],[2.6143,49.5592],[2.6132,49.5586]]]},"60644":{"type":"Polygon","coordinates":[[[1.8371,49.2652],[1.8226,49.2716],[1.813,49.2725],[1.8091,49.2741],[1.8007,49.2734],[1.7935,49.2743],[1.7947,49.2771],[1.7941,49.2774],[1.7975,49.2799],[1.794,49.2829],[1.7979,49.2853],[1.7976,49.2885],[1.7903,49.2885],[1.7847,49.2927],[1.7836,49.2948],[1.7993,49.2984],[1.8046,49.302],[1.8057,49.3061],[1.8036,49.3077],[1.8035,49.3107],[1.8014,49.318],[1.8026,49.3196],[1.8094,49.3244],[1.8106,49.3246],[1.8182,49.3218],[1.8193,49.3236],[1.8207,49.3239],[1.8238,49.3227],[1.8226,49.3209],[1.8238,49.3203],[1.8319,49.3197],[1.8331,49.3208],[1.835,49.3195],[1.833,49.3181],[1.8317,49.3158],[1.832,49.3139],[1.8307,49.3117],[1.8312,49.3098],[1.8292,49.3066],[1.8285,49.3024],[1.8292,49.2969],[1.8266,49.2901],[1.8265,49.2879],[1.8284,49.2874],[1.8273,49.2861],[1.8305,49.2843],[1.8311,49.285],[1.8319,49.2844],[1.8299,49.2825],[1.8294,49.2802],[1.8264,49.2782],[1.8266,49.2773],[1.8286,49.2765],[1.8356,49.2757],[1.836,49.274],[1.8429,49.2736],[1.8427,49.2722],[1.8371,49.2652]]]},"60645":{"type":"Polygon","coordinates":[[[1.8563,49.2921],[1.8626,49.2898],[1.8516,49.2808],[1.8534,49.2797],[1.8516,49.2758],[1.8482,49.2764],[1.8482,49.2769],[1.8477,49.2755],[1.8465,49.2758],[1.8429,49.2736],[1.838,49.2736],[1.836,49.274],[1.8356,49.2757],[1.8333,49.2756],[1.8328,49.2763],[1.8266,49.2773],[1.8265,49.2786],[1.8294,49.2802],[1.8299,49.2825],[1.8319,49.2846],[1.8286,49.2851],[1.8273,49.2861],[1.8284,49.2874],[1.8265,49.2879],[1.8266,49.2903],[1.8292,49.2969],[1.8288,49.2992],[1.8328,49.2979],[1.8334,49.2987],[1.8482,49.293],[1.8504,49.2928],[1.8524,49.2942],[1.8563,49.2921]]]},"60646":{"type":"Polygon","coordinates":[[[2.0843,49.4823],[2.0829,49.4784],[2.079,49.4727],[2.0781,49.4697],[2.0646,49.4605],[2.0624,49.4632],[2.0601,49.4626],[2.0499,49.4637],[2.0497,49.4653],[2.0478,49.4658],[2.048,49.4673],[2.0413,49.4692],[2.0414,49.4704],[2.0398,49.4714],[2.0392,49.4739],[2.0371,49.4751],[2.0319,49.4749],[2.0299,49.4757],[2.03,49.4763],[2.0276,49.4782],[2.0266,49.4783],[2.027,49.4775],[2.025,49.478],[2.0267,49.4791],[2.028,49.4784],[2.0311,49.4786],[2.0281,49.4813],[2.0259,49.4819],[2.0275,49.4834],[2.0269,49.4847],[2.0293,49.4861],[2.0316,49.4852],[2.0334,49.4865],[2.0317,49.4877],[2.0363,49.4915],[2.0371,49.4935],[2.0388,49.4942],[2.0399,49.4959],[2.0435,49.4965],[2.0436,49.4972],[2.0456,49.497],[2.0455,49.498],[2.0424,49.5015],[2.0432,49.5018],[2.0416,49.5047],[2.0418,49.509],[2.044,49.5092],[2.0523,49.5091],[2.0561,49.5082],[2.0582,49.5014],[2.0573,49.4999],[2.0599,49.4987],[2.0649,49.5008],[2.0722,49.5023],[2.0731,49.5011],[2.0815,49.4978],[2.0816,49.4909],[2.0809,49.4907],[2.0828,49.4893],[2.0805,49.4874],[2.0861,49.486],[2.0843,49.4823]]]},"60647":{"type":"Polygon","coordinates":[[[2.9694,49.3812],[2.9604,49.3854],[2.9474,49.3883],[2.9411,49.3917],[2.9349,49.3985],[2.9361,49.3988],[2.937,49.4008],[2.9404,49.404],[2.9451,49.4049],[2.9451,49.4066],[2.939,49.4077],[2.9294,49.412],[2.9301,49.4152],[2.937,49.4146],[2.9522,49.4109],[2.958,49.4107],[2.9621,49.4084],[2.9693,49.4111],[2.9737,49.4112],[2.979,49.4098],[2.9899,49.4122],[2.9942,49.4093],[2.9975,49.4089],[3.0016,49.407],[3.0004,49.4059],[3.0006,49.4038],[2.9993,49.4036],[2.9981,49.4007],[2.9934,49.3955],[2.9775,49.3883],[2.9778,49.3839],[2.9764,49.3829],[2.9694,49.3812]]]},"60648":{"type":"Polygon","coordinates":[[[2.2569,49.5954],[2.2502,49.5956],[2.2507,49.5947],[2.2487,49.5932],[2.2452,49.5918],[2.244,49.5932],[2.2429,49.5926],[2.2437,49.5909],[2.2431,49.5908],[2.2414,49.5907],[2.2412,49.5922],[2.2417,49.5923],[2.2402,49.5934],[2.2383,49.5924],[2.2348,49.5927],[2.2347,49.5945],[2.2324,49.5948],[2.2322,49.5964],[2.2354,49.598],[2.2322,49.5979],[2.2317,49.6021],[2.2279,49.6024],[2.2282,49.6048],[2.2259,49.6077],[2.2289,49.609],[2.2305,49.6078],[2.233,49.609],[2.2322,49.6096],[2.233,49.6102],[2.2415,49.6117],[2.2472,49.6091],[2.2487,49.6146],[2.2544,49.6156],[2.2542,49.6147],[2.2554,49.6147],[2.2609,49.6174],[2.2667,49.6116],[2.2689,49.6126],[2.2702,49.6112],[2.2653,49.6102],[2.2631,49.6085],[2.2706,49.6084],[2.2706,49.6075],[2.2718,49.6074],[2.2693,49.6042],[2.2685,49.6044],[2.2679,49.6033],[2.2662,49.6034],[2.2668,49.6029],[2.2651,49.6002],[2.2635,49.6002],[2.2569,49.5954]]]},"60650":{"type":"Polygon","coordinates":[[[2.7588,49.2253],[2.7553,49.2249],[2.7557,49.2338],[2.7496,49.2336],[2.7517,49.2452],[2.7544,49.2448],[2.7548,49.2476],[2.7589,49.2485],[2.7602,49.252],[2.7643,49.2522],[2.7655,49.2519],[2.7685,49.2485],[2.7713,49.249],[2.7738,49.2475],[2.7732,49.246],[2.7743,49.2458],[2.7737,49.2443],[2.7749,49.2442],[2.7751,49.245],[2.777,49.2448],[2.7809,49.2495],[2.7829,49.2489],[2.7832,49.2507],[2.7911,49.2518],[2.7916,49.2558],[2.8012,49.2563],[2.8054,49.255],[2.8149,49.2502],[2.8229,49.2478],[2.829,49.2437],[2.8282,49.2429],[2.8291,49.2427],[2.8275,49.241],[2.8244,49.2418],[2.8261,49.2388],[2.8244,49.2385],[2.8244,49.2374],[2.8224,49.2372],[2.8225,49.2358],[2.8088,49.2348],[2.8102,49.2316],[2.8041,49.2311],[2.8038,49.23],[2.8003,49.2301],[2.7998,49.2279],[2.7944,49.2279],[2.7941,49.2267],[2.78,49.2256],[2.7793,49.2264],[2.7673,49.2251],[2.7673,49.2258],[2.7588,49.2253]]]},"60651":{"type":"Polygon","coordinates":[[[2.3045,49.2615],[2.3022,49.2605],[2.3045,49.2581],[2.3004,49.2571],[2.297,49.2553],[2.2869,49.2543],[2.2723,49.2559],[2.2651,49.2507],[2.2606,49.2535],[2.256,49.2527],[2.2494,49.2542],[2.2442,49.2537],[2.2429,49.2546],[2.2409,49.254],[2.239,49.2522],[2.2364,49.2541],[2.2355,49.2588],[2.234,49.2603],[2.2369,49.2674],[2.2434,49.2656],[2.2452,49.2674],[2.2494,49.2657],[2.2535,49.269],[2.2592,49.2716],[2.2458,49.2783],[2.2575,49.2857],[2.2693,49.291],[2.2684,49.2917],[2.274,49.2957],[2.2714,49.3002],[2.2771,49.3042],[2.2813,49.3058],[2.2858,49.3025],[2.2956,49.2981],[2.3087,49.2904],[2.307,49.29],[2.3082,49.2851],[2.3032,49.2838],[2.306,49.2802],[2.3015,49.2799],[2.3013,49.2792],[2.2988,49.2782],[2.2996,49.2744],[2.301,49.2745],[2.3013,49.273],[2.3002,49.2706],[2.3009,49.2704],[2.2986,49.2689],[2.2994,49.2683],[2.2984,49.2677],[2.3012,49.2666],[2.3005,49.2661],[2.3017,49.2656],[2.3007,49.2646],[2.3045,49.2615]]]},"60652":{"type":"Polygon","coordinates":[[[2.0405,49.294],[2.0408,49.2947],[2.0385,49.2973],[2.0398,49.2998],[2.0383,49.3003],[2.0369,49.3024],[2.0353,49.3058],[2.0348,49.309],[2.028,49.3146],[2.0278,49.3152],[2.0341,49.3218],[2.0498,49.3165],[2.052,49.3177],[2.0553,49.3173],[2.0575,49.3209],[2.0614,49.3228],[2.0658,49.3231],[2.067,49.3226],[2.0639,49.3211],[2.061,49.3174],[2.0689,49.3151],[2.0756,49.3145],[2.0806,49.3151],[2.0819,49.3135],[2.0784,49.3077],[2.081,49.3077],[2.0786,49.3035],[2.0748,49.3019],[2.0712,49.2946],[2.0664,49.297],[2.0564,49.2914],[2.0545,49.2939],[2.0528,49.2939],[2.0499,49.29],[2.0479,49.2889],[2.0474,49.2866],[2.0436,49.2862],[2.0408,49.2893],[2.0398,49.2925],[2.0405,49.294]]]},"60653":{"type":"Polygon","coordinates":[[[2.4643,49.4913],[2.4687,49.4876],[2.4659,49.4807],[2.4659,49.4785],[2.4624,49.4755],[2.46,49.4754],[2.4607,49.4746],[2.4557,49.4721],[2.4503,49.4751],[2.4392,49.4787],[2.4209,49.4828],[2.4179,49.4827],[2.4187,49.485],[2.4162,49.4849],[2.4158,49.484],[2.4141,49.4844],[2.4141,49.4835],[2.4059,49.4854],[2.4073,49.4869],[2.4022,49.4887],[2.4006,49.4872],[2.3978,49.4887],[2.395,49.4866],[2.3941,49.4875],[2.3915,49.4826],[2.3821,49.4869],[2.3923,49.4897],[2.3958,49.4893],[2.4026,49.4918],[2.4038,49.4916],[2.4022,49.4901],[2.4072,49.4886],[2.4074,49.4892],[2.4149,49.489],[2.4158,49.4909],[2.4172,49.4908],[2.4175,49.4916],[2.4197,49.4918],[2.4194,49.4925],[2.4283,49.4952],[2.4298,49.4933],[2.4336,49.4932],[2.4332,49.4921],[2.4363,49.4922],[2.4361,49.4938],[2.4385,49.4935],[2.4399,49.4945],[2.441,49.4933],[2.4423,49.4943],[2.4487,49.4952],[2.4517,49.4972],[2.4507,49.4962],[2.4529,49.4943],[2.4507,49.4926],[2.4508,49.4908],[2.4543,49.4913],[2.456,49.4891],[2.4618,49.4911],[2.4643,49.4913]]]},"60654":{"type":"Polygon","coordinates":[[[2.7755,49.5096],[2.7742,49.5113],[2.7772,49.5114],[2.7762,49.5118],[2.7775,49.5162],[2.7865,49.5158],[2.7867,49.5168],[2.7895,49.5184],[2.7948,49.5178],[2.7964,49.5183],[2.7979,49.5172],[2.7984,49.518],[2.8081,49.5167],[2.8083,49.5157],[2.8139,49.5141],[2.8148,49.5129],[2.817,49.512],[2.8155,49.5088],[2.8125,49.5057],[2.808,49.5033],[2.8099,49.5016],[2.8084,49.5005],[2.802,49.4981],[2.799,49.4984],[2.7964,49.4973],[2.7956,49.4957],[2.7929,49.4953],[2.7914,49.4954],[2.7911,49.4976],[2.7894,49.4977],[2.7903,49.4992],[2.7886,49.4995],[2.7896,49.5014],[2.7877,49.5041],[2.7857,49.5037],[2.7812,49.5064],[2.7822,49.5072],[2.7812,49.508],[2.779,49.5069],[2.7755,49.5096]]]},"60655":{"type":"Polygon","coordinates":[[[3.0734,49.5381],[3.0702,49.5399],[3.0681,49.5469],[3.0658,49.5471],[3.0619,49.5505],[3.0615,49.5556],[3.06,49.5562],[3.0572,49.5552],[3.0561,49.5561],[3.0511,49.5569],[3.0506,49.5581],[3.0491,49.5588],[3.0498,49.5604],[3.0471,49.5605],[3.0484,49.5622],[3.0443,49.5655],[3.0461,49.566],[3.0484,49.5647],[3.0487,49.5661],[3.0499,49.5664],[3.0516,49.5652],[3.0517,49.5673],[3.0553,49.5687],[3.0608,49.567],[3.065,49.5689],[3.0645,49.5698],[3.0652,49.5704],[3.0685,49.5704],[3.067,49.5719],[3.0675,49.5725],[3.0708,49.5723],[3.0753,49.5711],[3.0772,49.5691],[3.0784,49.5708],[3.0809,49.5691],[3.0846,49.5695],[3.0909,49.5683],[3.0911,49.5675],[3.093,49.5668],[3.0923,49.5667],[3.0948,49.5658],[3.0938,49.5653],[3.0962,49.563],[3.0964,49.5625],[3.0952,49.5623],[3.0962,49.5598],[3.0997,49.5596],[3.1019,49.5574],[3.1093,49.5551],[3.1101,49.5536],[3.1097,49.5525],[3.1033,49.5515],[3.0908,49.5438],[3.0797,49.541],[3.0734,49.5381]]]},"60656":{"type":"Polygon","coordinates":[[[3.0562,49.1019],[3.0555,49.0965],[3.0568,49.0961],[3.0574,49.0939],[3.06,49.0919],[3.0594,49.091],[3.0635,49.0903],[3.0649,49.0872],[3.066,49.0868],[3.0661,49.0852],[3.0609,49.0868],[3.0585,49.0885],[3.0573,49.087],[3.0551,49.0883],[3.0541,49.0865],[3.0545,49.0858],[3.0508,49.085],[3.05,49.0861],[3.0476,49.086],[3.047,49.0867],[3.0401,49.0873],[3.0397,49.0864],[3.0342,49.0885],[3.0373,49.0925],[3.0389,49.099],[3.0369,49.1014],[3.0372,49.103],[3.0396,49.1023],[3.043,49.1033],[3.0432,49.1043],[3.046,49.1039],[3.0468,49.1049],[3.0519,49.1027],[3.0528,49.1033],[3.0562,49.1019]]]},"60657":{"type":"Polygon","coordinates":[[[2.9713,49.5781],[2.9686,49.5788],[2.9607,49.5789],[2.9542,49.5853],[2.9507,49.587],[2.9503,49.5889],[2.9591,49.5913],[2.9601,49.5899],[2.9635,49.5909],[2.9659,49.5906],[2.9718,49.5921],[2.9718,49.5928],[2.9748,49.592],[2.9766,49.5929],[2.9812,49.593],[2.9853,49.5905],[2.9853,49.5895],[2.9817,49.5887],[2.9779,49.5861],[2.9768,49.5851],[2.9776,49.5849],[2.9755,49.5831],[2.9726,49.5822],[2.9728,49.5815],[2.9712,49.5806],[2.9713,49.5781]]]},"60658":{"type":"MultiPolygon","coordinates":[[[[3.0018,49.2356],[3.0024,49.2374],[3.0017,49.2384],[3.0024,49.2389],[3.0114,49.2403],[3.0119,49.2398],[3.0306,49.2441],[3.0337,49.2438],[3.0339,49.2416],[3.0328,49.2387],[3.037,49.2363],[3.0357,49.2348],[3.0407,49.2323],[3.0399,49.2312],[3.0419,49.2304],[3.0393,49.2297],[3.0386,49.2276],[3.0398,49.2275],[3.0402,49.2266],[3.0377,49.2243],[3.037,49.2222],[3.0342,49.2225],[3.0331,49.2239],[3.0337,49.2261],[3.0318,49.2264],[3.0323,49.2248],[3.0303,49.2253],[3.0299,49.2243],[3.0312,49.2241],[3.0311,49.2221],[3.0334,49.2206],[3.0319,49.221],[3.0311,49.2204],[3.0264,49.2217],[3.0251,49.2201],[3.023,49.2202],[3.0246,49.2187],[3.0236,49.2166],[3.021,49.2162],[3.0185,49.2195],[3.0165,49.2182],[3.0158,49.2197],[3.0142,49.22],[3.0139,49.2209],[3.015,49.2211],[3.0141,49.2215],[3.0149,49.2232],[3.0095,49.2225],[3.0092,49.2219],[3.0057,49.222],[3.0056,49.221],[3.0038,49.2216],[3.0034,49.2242],[3.0063,49.2242],[3.0077,49.2261],[3.0128,49.2283],[3.0135,49.2296],[3.0164,49.2302],[3.0134,49.231],[3.0126,49.2315],[3.0129,49.2321],[3.0018,49.2356]]],[[[2.9817,49.2168],[2.9856,49.2187],[2.9896,49.2195],[2.9886,49.2223],[2.9927,49.2233],[2.9937,49.2227],[2.9979,49.2236],[3.0003,49.2228],[3.0038,49.2189],[2.9983,49.219],[2.9979,49.2177],[2.9985,49.2171],[2.998,49.2169],[2.9998,49.2162],[2.9996,49.2153],[2.9971,49.214],[2.9955,49.2113],[2.9933,49.2124],[2.9917,49.2109],[2.9902,49.2107],[2.9886,49.2115],[2.9871,49.211],[2.9885,49.2123],[2.9854,49.2131],[2.9864,49.2148],[2.9855,49.215],[2.9854,49.2163],[2.9817,49.2168]]],[[[3.0424,49.2284],[3.0471,49.2293],[3.0484,49.2276],[3.0439,49.2261],[3.0436,49.2277],[3.0425,49.2278],[3.0424,49.2284]]]]},"60659":{"type":"Polygon","coordinates":[[[1.7658,49.2164],[1.7647,49.2165],[1.7633,49.2193],[1.75,49.2182],[1.7513,49.2201],[1.7402,49.2215],[1.7404,49.2228],[1.7438,49.223],[1.7441,49.2244],[1.7458,49.2245],[1.7487,49.2303],[1.747,49.2329],[1.7497,49.2365],[1.7487,49.2368],[1.7514,49.2404],[1.762,49.2414],[1.7649,49.2429],[1.7697,49.2427],[1.7695,49.2421],[1.7671,49.2421],[1.7677,49.2405],[1.767,49.2396],[1.7712,49.2389],[1.7696,49.2369],[1.7698,49.2354],[1.7738,49.2318],[1.7737,49.2307],[1.7789,49.2298],[1.78,49.2276],[1.7819,49.2271],[1.7826,49.2267],[1.7819,49.2263],[1.7832,49.2257],[1.7823,49.2248],[1.7755,49.2256],[1.7756,49.2234],[1.7661,49.2213],[1.7652,49.2175],[1.7658,49.2164]]]},"60660":{"type":"Polygon","coordinates":[[[1.8892,49.3281],[1.8872,49.3296],[1.8859,49.3283],[1.8819,49.3299],[1.88,49.3288],[1.877,49.3316],[1.8723,49.3273],[1.8702,49.3279],[1.8697,49.3269],[1.8678,49.327],[1.8675,49.3234],[1.8667,49.322],[1.8649,49.322],[1.8653,49.3231],[1.8639,49.3239],[1.8644,49.3243],[1.8596,49.3249],[1.8606,49.327],[1.8568,49.3286],[1.8576,49.3298],[1.8588,49.3295],[1.8596,49.3306],[1.8561,49.3334],[1.8548,49.3329],[1.8512,49.3344],[1.8525,49.3383],[1.8499,49.3385],[1.8454,49.3374],[1.844,49.3383],[1.8425,49.3407],[1.8466,49.3451],[1.8472,49.3476],[1.8496,49.3518],[1.8556,49.359],[1.8543,49.3624],[1.8641,49.3663],[1.8662,49.3589],[1.8634,49.3544],[1.8821,49.349],[1.8871,49.3396],[1.8883,49.3397],[1.8873,49.3349],[1.8847,49.3335],[1.8904,49.3288],[1.8892,49.3281]]]},"60661":{"type":"Polygon","coordinates":[[[2.9644,49.2319],[2.9607,49.2316],[2.962,49.2364],[2.9674,49.2358],[2.9692,49.2394],[2.9741,49.24],[2.9739,49.2433],[2.9745,49.2448],[2.9756,49.2448],[2.9756,49.2454],[2.9747,49.2454],[2.9753,49.2465],[2.9789,49.2465],[2.979,49.2482],[2.9807,49.2485],[2.9803,49.2495],[2.9822,49.2507],[2.982,49.2527],[2.9845,49.2533],[2.9864,49.2526],[2.9883,49.2502],[2.9881,49.2488],[2.9899,49.2444],[2.9949,49.2424],[2.9966,49.2402],[3.0006,49.2393],[3.0024,49.2374],[3.0018,49.2356],[3.0009,49.2352],[2.9873,49.2351],[2.9753,49.232],[2.9691,49.2317],[2.967,49.232],[2.9672,49.2327],[2.9646,49.2327],[2.9644,49.2319]]]},"60662":{"type":"Polygon","coordinates":[[[1.9257,49.3619],[1.9225,49.3663],[1.922,49.37],[1.9142,49.3703],[1.9138,49.372],[1.9075,49.3749],[1.8975,49.3712],[1.8961,49.3696],[1.8853,49.3699],[1.8858,49.3811],[1.8875,49.3858],[1.8923,49.3846],[1.9001,49.3978],[1.9027,49.3976],[1.9066,49.3954],[1.919,49.3927],[1.9212,49.3953],[1.9278,49.3903],[1.9327,49.3938],[1.9352,49.3936],[1.9363,49.3898],[1.9359,49.3885],[1.9376,49.3874],[1.9396,49.3879],[1.9471,49.3847],[1.9441,49.3811],[1.9377,49.3776],[1.9401,49.3752],[1.9315,49.37],[1.933,49.3685],[1.9321,49.3681],[1.9331,49.3671],[1.9345,49.3682],[1.9356,49.3678],[1.9305,49.365],[1.9283,49.3627],[1.9257,49.3619]]]},"60663":{"type":"Polygon","coordinates":[[[2.187,49.4578],[2.1888,49.4654],[2.173,49.4664],[2.166,49.4684],[2.1664,49.4722],[2.1644,49.4724],[2.1653,49.4779],[2.1734,49.4813],[2.1946,49.4871],[2.1979,49.4837],[2.2051,49.4811],[2.2044,49.4803],[2.2074,49.4796],[2.2063,49.4781],[2.213,49.4777],[2.2124,49.4741],[2.2058,49.4751],[2.201,49.4735],[2.2046,49.462],[2.2028,49.4615],[2.2025,49.4606],[2.198,49.4609],[2.1979,49.4596],[2.1923,49.4596],[2.19,49.458],[2.1884,49.4589],[2.187,49.4578]]]},"60664":{"type":"Polygon","coordinates":[[[2.3034,49.5987],[2.2976,49.601],[2.2953,49.6007],[2.2927,49.6022],[2.2908,49.5997],[2.2905,49.5988],[2.2913,49.5981],[2.2898,49.5959],[2.2871,49.5969],[2.2846,49.596],[2.2851,49.5957],[2.2838,49.5945],[2.2826,49.5951],[2.2752,49.5914],[2.2695,49.5904],[2.2678,49.5881],[2.2644,49.5891],[2.2636,49.5905],[2.2627,49.5902],[2.2569,49.5954],[2.2635,49.6002],[2.2651,49.6002],[2.2668,49.6029],[2.2662,49.6034],[2.2679,49.6033],[2.2685,49.6044],[2.2693,49.6042],[2.2715,49.6065],[2.2718,49.6074],[2.2706,49.6075],[2.2706,49.6084],[2.2631,49.6085],[2.2653,49.6102],[2.2702,49.6112],[2.2689,49.6126],[2.2839,49.6196],[2.2904,49.6241],[2.2912,49.6253],[2.295,49.6248],[2.295,49.6257],[2.2977,49.6259],[2.2996,49.6245],[2.2994,49.6254],[2.3008,49.6259],[2.3091,49.6267],[2.31,49.6285],[2.3177,49.6269],[2.3258,49.624],[2.331,49.626],[2.3342,49.6221],[2.317,49.6138],[2.3122,49.609],[2.3137,49.607],[2.311,49.6068],[2.3113,49.6057],[2.3102,49.6059],[2.3101,49.6033],[2.3078,49.6017],[2.3053,49.6032],[2.3034,49.5987]]]},"60665":{"type":"Polygon","coordinates":[[[2.7537,49.411],[2.7537,49.4129],[2.7574,49.4155],[2.762,49.4207],[2.766,49.427],[2.7673,49.4313],[2.7734,49.4379],[2.7885,49.4307],[2.7916,49.4322],[2.8002,49.425],[2.8018,49.4255],[2.8044,49.4246],[2.8063,49.4237],[2.8059,49.4233],[2.807,49.4226],[2.8074,49.4209],[2.8108,49.4192],[2.8119,49.4196],[2.8121,49.4178],[2.8142,49.4156],[2.8076,49.4131],[2.7999,49.4118],[2.7951,49.4035],[2.7891,49.4057],[2.7869,49.4043],[2.7841,49.4065],[2.7823,49.4058],[2.7791,49.4079],[2.777,49.4069],[2.7731,49.4095],[2.7697,49.4087],[2.7682,49.4103],[2.7697,49.4127],[2.7647,49.4131],[2.7537,49.411]]]},"60666":{"type":"Polygon","coordinates":[[[2.7111,49.1096],[2.7109,49.1054],[2.7038,49.096],[2.7002,49.0945],[2.6888,49.0918],[2.6781,49.086],[2.6775,49.0882],[2.6731,49.0911],[2.6629,49.0936],[2.6613,49.0968],[2.6586,49.096],[2.6562,49.0986],[2.6552,49.0983],[2.6505,49.1009],[2.6411,49.0991],[2.6408,49.1011],[2.6354,49.102],[2.6365,49.1036],[2.6352,49.1047],[2.6365,49.1072],[2.6332,49.1086],[2.6336,49.1105],[2.6391,49.1154],[2.6388,49.1166],[2.6373,49.1169],[2.6409,49.1199],[2.6483,49.1167],[2.6575,49.1182],[2.6634,49.1181],[2.6646,49.1187],[2.6638,49.1217],[2.687,49.1185],[2.687,49.1172],[2.6922,49.115],[2.7111,49.1096]]]},"60667":{"type":"Polygon","coordinates":[[[2.7362,49.3309],[2.7409,49.3389],[2.7462,49.3433],[2.7565,49.3439],[2.7575,49.3427],[2.752,49.3397],[2.7485,49.3359],[2.7526,49.3329],[2.7542,49.3298],[2.7548,49.3272],[2.7525,49.3247],[2.7545,49.3227],[2.7617,49.3221],[2.7655,49.3228],[2.7722,49.3256],[2.7741,49.3204],[2.7734,49.3172],[2.7667,49.3136],[2.7656,49.3114],[2.7547,49.3127],[2.7568,49.3112],[2.7508,49.3093],[2.7477,49.311],[2.7416,49.3116],[2.7399,49.3112],[2.7405,49.3076],[2.7317,49.3064],[2.7285,49.3019],[2.7278,49.2996],[2.7295,49.2986],[2.7336,49.2986],[2.735,49.2941],[2.7369,49.293],[2.7424,49.286],[2.7398,49.2795],[2.7437,49.2796],[2.7428,49.2766],[2.7264,49.2747],[2.7183,49.2767],[2.7171,49.2709],[2.7066,49.2725],[2.7072,49.2764],[2.7057,49.2778],[2.7065,49.278],[2.7059,49.2786],[2.7065,49.2801],[2.7126,49.2848],[2.7131,49.2839],[2.7199,49.2883],[2.7215,49.2909],[2.7133,49.2892],[2.7093,49.2899],[2.7096,49.2915],[2.7077,49.2919],[2.709,49.2944],[2.7098,49.2945],[2.7103,49.3002],[2.705,49.303],[2.7034,49.3049],[2.705,49.3066],[2.7033,49.307],[2.7044,49.3086],[2.7046,49.3112],[2.7034,49.3127],[2.7037,49.3139],[2.7112,49.313],[2.7179,49.3107],[2.7242,49.3116],[2.7261,49.3134],[2.7274,49.317],[2.731,49.3209],[2.7329,49.3266],[2.7362,49.3309]]]},"60668":{"type":"Polygon","coordinates":[[[2.0535,49.5285],[2.0549,49.5293],[2.0566,49.5285],[2.0605,49.5309],[2.0618,49.5296],[2.0636,49.5308],[2.0628,49.5327],[2.0661,49.5349],[2.0665,49.534],[2.0709,49.537],[2.072,49.5355],[2.0668,49.5321],[2.0676,49.5284],[2.0759,49.5289],[2.0747,49.5284],[2.0736,49.526],[2.076,49.5251],[2.0734,49.5212],[2.0749,49.5205],[2.0735,49.5188],[2.0784,49.5176],[2.0751,49.5132],[2.0769,49.5124],[2.0752,49.5117],[2.0811,49.5078],[2.078,49.5059],[2.0825,49.5042],[2.0841,49.5084],[2.0881,49.5078],[2.0899,49.5113],[2.0916,49.5095],[2.095,49.5134],[2.0999,49.5112],[2.0992,49.5099],[2.102,49.5092],[2.1038,49.5124],[2.1161,49.5104],[2.1191,49.5093],[2.1177,49.5078],[2.1168,49.5035],[2.1178,49.5026],[2.1177,49.4984],[2.1163,49.4939],[2.1111,49.4891],[2.1109,49.4877],[2.1055,49.4875],[2.1057,49.4863],[2.0967,49.4875],[2.0935,49.4904],[2.0911,49.4913],[2.0884,49.4906],[2.0861,49.486],[2.0805,49.4874],[2.0828,49.4893],[2.0809,49.4907],[2.0816,49.4909],[2.0815,49.4978],[2.0731,49.5011],[2.0722,49.5023],[2.0649,49.5008],[2.0599,49.4987],[2.0573,49.4999],[2.0582,49.5014],[2.0561,49.5082],[2.0521,49.5091],[2.0421,49.509],[2.0419,49.5098],[2.0438,49.5125],[2.0467,49.5144],[2.0467,49.5177],[2.0499,49.5221],[2.0558,49.5272],[2.0535,49.5285]]]},"60669":{"type":"Polygon","coordinates":[[[2.4834,49.3185],[2.4758,49.3235],[2.4799,49.3263],[2.4813,49.3329],[2.4805,49.3334],[2.4848,49.3399],[2.4926,49.3356],[2.4929,49.3362],[2.4993,49.3347],[2.5041,49.3359],[2.5106,49.3303],[2.5134,49.3298],[2.4923,49.3205],[2.4918,49.3209],[2.4834,49.3185]]]},"60670":{"type":"Polygon","coordinates":[[[2.5106,49.2887],[2.5127,49.2925],[2.5154,49.2948],[2.5227,49.2985],[2.5395,49.3018],[2.548,49.3007],[2.5507,49.2933],[2.574,49.2772],[2.5608,49.2615],[2.5655,49.2581],[2.5565,49.2541],[2.5549,49.2524],[2.5538,49.2528],[2.5309,49.2427],[2.5316,49.2471],[2.5252,49.2483],[2.5194,49.254],[2.5152,49.2534],[2.5116,49.257],[2.506,49.2577],[2.4953,49.2655],[2.4985,49.2678],[2.4972,49.2694],[2.4988,49.2702],[2.4975,49.2712],[2.4979,49.274],[2.4956,49.2746],[2.5,49.2772],[2.5066,49.2788],[2.5101,49.281],[2.5106,49.2887]]]},"60671":{"type":"Polygon","coordinates":[[[2.8086,49.1875],[2.8188,49.1849],[2.8192,49.182],[2.8169,49.1791],[2.818,49.178],[2.824,49.1783],[2.8194,49.1677],[2.82,49.1656],[2.8222,49.1645],[2.8169,49.1586],[2.816,49.1589],[2.8136,49.1554],[2.8125,49.1592],[2.8022,49.1563],[2.8027,49.156],[2.8005,49.1543],[2.7966,49.1521],[2.7852,49.155],[2.7784,49.1475],[2.7763,49.1438],[2.7694,49.1396],[2.77,49.1391],[2.7633,49.1342],[2.7649,49.1337],[2.7606,49.1326],[2.7573,49.1353],[2.7598,49.1361],[2.7537,49.1401],[2.7476,49.1363],[2.7462,49.1447],[2.7526,49.1573],[2.7492,49.1603],[2.7504,49.1609],[2.7507,49.162],[2.7545,49.1635],[2.754,49.164],[2.7561,49.1674],[2.7625,49.1692],[2.7699,49.1686],[2.7733,49.1703],[2.7753,49.17],[2.7787,49.1713],[2.7899,49.173],[2.7969,49.1753],[2.8078,49.18],[2.8086,49.1875]]]},"60672":{"type":"Polygon","coordinates":[[[3.0275,49.2717],[3.0272,49.2679],[3.029,49.2667],[3.0311,49.2668],[3.0278,49.2646],[3.0257,49.2594],[3.0299,49.257],[3.0319,49.2545],[3.0325,49.2515],[3.0319,49.2504],[3.0337,49.2438],[3.0306,49.2441],[3.0119,49.2398],[3.0114,49.2403],[3.0019,49.2385],[2.9966,49.2402],[2.9949,49.2424],[2.9899,49.2444],[2.9881,49.2488],[2.9883,49.2502],[2.9864,49.2526],[2.9822,49.2539],[2.9797,49.2562],[2.9798,49.2574],[2.9874,49.2588],[2.9864,49.2611],[2.9911,49.2617],[2.9908,49.2637],[2.9922,49.2658],[3.0003,49.2745],[3.0017,49.274],[3.0039,49.2767],[3.0151,49.2764],[3.0275,49.2717]]]},"60673":{"type":"Polygon","coordinates":[[[2.1288,49.6211],[2.1349,49.6195],[2.1344,49.6171],[2.1425,49.6181],[2.1421,49.6174],[2.143,49.6172],[2.1428,49.6153],[2.1463,49.612],[2.1489,49.6118],[2.1495,49.6089],[2.1487,49.606],[2.1357,49.6066],[2.1365,49.5999],[2.1173,49.6024],[2.1174,49.6043],[2.1084,49.6044],[2.1095,49.6101],[2.1138,49.6102],[2.1136,49.6115],[2.1213,49.6143],[2.1186,49.6165],[2.1233,49.619],[2.1286,49.6205],[2.1288,49.6211]]]},"60674":{"type":"Polygon","coordinates":[[[2.9694,49.3812],[2.9705,49.3703],[2.9107,49.3684],[2.9097,49.3692],[2.9065,49.3683],[2.8924,49.3682],[2.8852,49.3901],[2.9006,49.3938],[2.9091,49.398],[2.9143,49.4019],[2.9155,49.4036],[2.9209,49.404],[2.9213,49.4077],[2.9201,49.4091],[2.9215,49.4118],[2.9237,49.4129],[2.9289,49.4115],[2.9294,49.4123],[2.939,49.4077],[2.9451,49.4066],[2.9451,49.4049],[2.9404,49.404],[2.937,49.4008],[2.9361,49.3988],[2.9349,49.3985],[2.9411,49.3917],[2.9474,49.3883],[2.9604,49.3854],[2.9694,49.3812]]]},"60675":{"type":"Polygon","coordinates":[[[2.7941,49.4955],[2.795,49.4928],[2.7922,49.4926],[2.7922,49.4911],[2.7857,49.4889],[2.781,49.486],[2.7826,49.4819],[2.782,49.4816],[2.784,49.4802],[2.7839,49.4792],[2.7744,49.4851],[2.7739,49.4837],[2.7677,49.4856],[2.7702,49.4883],[2.7695,49.4889],[2.7693,49.4932],[2.762,49.5035],[2.7594,49.5053],[2.7633,49.5085],[2.7661,49.5083],[2.7666,49.5072],[2.7672,49.5085],[2.7741,49.5085],[2.7755,49.5096],[2.779,49.5069],[2.7812,49.508],[2.7822,49.5072],[2.7812,49.5064],[2.7857,49.5037],[2.7874,49.5043],[2.7896,49.5014],[2.7886,49.4995],[2.7903,49.4992],[2.7894,49.4977],[2.7911,49.4976],[2.7914,49.4954],[2.7941,49.4955]]]},"60676":{"type":"Polygon","coordinates":[[[2.9233,49.542],[2.9208,49.5423],[2.9198,49.5411],[2.9148,49.5423],[2.915,49.548],[2.9157,49.5492],[2.9145,49.5497],[2.917,49.5543],[2.9215,49.5587],[2.9239,49.5627],[2.9291,49.5631],[2.9292,49.5642],[2.9281,49.5644],[2.926,49.5679],[2.9308,49.5688],[2.933,49.571],[2.9295,49.573],[2.9369,49.5709],[2.947,49.5708],[2.9528,49.5634],[2.9539,49.5591],[2.9529,49.5561],[2.9516,49.5559],[2.952,49.5555],[2.9484,49.5557],[2.9487,49.5545],[2.9476,49.554],[2.9481,49.5525],[2.9489,49.5528],[2.9467,49.5497],[2.9475,49.5493],[2.9431,49.5494],[2.9434,49.5486],[2.9395,49.5463],[2.9235,49.5432],[2.9233,49.542]]]},"60677":{"type":"Polygon","coordinates":[[[1.8853,49.4666],[1.8847,49.4661],[1.8796,49.4671],[1.8724,49.4692],[1.8718,49.4703],[1.8675,49.4697],[1.8677,49.4708],[1.8662,49.4721],[1.8659,49.4708],[1.8634,49.4712],[1.8612,49.4706],[1.8595,49.4718],[1.8622,49.4733],[1.856,49.4761],[1.8592,49.4791],[1.854,49.4845],[1.8562,49.4855],[1.8575,49.4885],[1.8558,49.4892],[1.8575,49.4895],[1.861,49.4964],[1.8619,49.4963],[1.8631,49.4995],[1.8651,49.4994],[1.8655,49.4978],[1.8706,49.499],[1.873,49.4988],[1.8725,49.4984],[1.8755,49.4966],[1.8767,49.4939],[1.8837,49.4935],[1.8878,49.4919],[1.8869,49.4914],[1.8883,49.4894],[1.8871,49.4885],[1.888,49.4877],[1.8875,49.485],[1.8912,49.4836],[1.8905,49.4831],[1.8919,49.4811],[1.8902,49.4797],[1.8882,49.476],[1.8881,49.4736],[1.8847,49.4673],[1.8853,49.4666]]]},"60678":{"type":"Polygon","coordinates":[[[2.0875,49.2336],[2.0771,49.2316],[2.0789,49.2289],[2.0809,49.2216],[2.0792,49.2204],[2.0768,49.2212],[2.0759,49.2195],[2.0739,49.2182],[2.0619,49.219],[2.0563,49.2209],[2.0569,49.223],[2.0556,49.2258],[2.0593,49.2259],[2.0601,49.2268],[2.0637,49.2256],[2.0685,49.2308],[2.0685,49.2326],[2.066,49.2328],[2.0678,49.2356],[2.0645,49.2362],[2.0637,49.2382],[2.0684,49.2411],[2.063,49.2438],[2.0665,49.2446],[2.0662,49.2458],[2.0709,49.246],[2.071,49.2469],[2.0777,49.2485],[2.0797,49.2475],[2.0806,49.2444],[2.0864,49.2454],[2.0887,49.2413],[2.0923,49.2393],[2.0912,49.237],[2.0875,49.2336]]]},"60679":{"type":"Polygon","coordinates":[[[3.0847,49.1593],[3.0894,49.1556],[3.0879,49.1566],[3.0862,49.1561],[3.0845,49.1576],[3.0826,49.1565],[3.0785,49.1559],[3.0787,49.1545],[3.0774,49.1537],[3.0725,49.1534],[3.0687,49.1515],[3.0657,49.1518],[3.0595,49.1507],[3.0571,49.1513],[3.0496,49.1509],[3.048,49.1516],[3.0477,49.153],[3.0462,49.1538],[3.0457,49.1555],[3.0463,49.1591],[3.0481,49.1627],[3.0387,49.1687],[3.0492,49.1729],[3.0567,49.1679],[3.0667,49.1662],[3.0742,49.1618],[3.0811,49.1609],[3.0837,49.1591],[3.0847,49.1593]]]},"60680":{"type":"Polygon","coordinates":[[[2.7021,49.2673],[2.6996,49.269],[2.6897,49.2675],[2.6884,49.2692],[2.6748,49.2651],[2.6654,49.2595],[2.6624,49.2612],[2.6625,49.2622],[2.6513,49.2672],[2.6501,49.2685],[2.6512,49.2717],[2.6393,49.2737],[2.6354,49.2781],[2.6668,49.2782],[2.6684,49.2824],[2.672,49.2812],[2.6722,49.2798],[2.6748,49.2793],[2.6752,49.2802],[2.6793,49.2802],[2.6803,49.2824],[2.6997,49.2785],[2.7009,49.2787],[2.6994,49.2835],[2.6974,49.2852],[2.6983,49.2882],[2.6975,49.291],[2.7007,49.2915],[2.7005,49.292],[2.7077,49.2919],[2.7096,49.2915],[2.7093,49.2899],[2.7133,49.2892],[2.7215,49.2909],[2.7199,49.2883],[2.7131,49.2839],[2.7126,49.2848],[2.7065,49.2801],[2.7059,49.2786],[2.7065,49.278],[2.7057,49.2778],[2.7072,49.2764],[2.7064,49.2712],[2.7021,49.2673]]]},"60681":{"type":"Polygon","coordinates":[[[1.9415,49.3871],[1.9396,49.3879],[1.9376,49.3874],[1.9359,49.3885],[1.9363,49.3898],[1.9352,49.3936],[1.9327,49.3938],[1.9278,49.3903],[1.9212,49.3953],[1.9252,49.3987],[1.926,49.4004],[1.9256,49.402],[1.9282,49.4041],[1.932,49.405],[1.9382,49.4102],[1.9403,49.4106],[1.9416,49.4126],[1.9502,49.417],[1.9515,49.4191],[1.9624,49.4149],[1.9677,49.4224],[1.971,49.4224],[1.9708,49.4216],[1.9724,49.4215],[1.9696,49.4169],[1.9721,49.4161],[1.9739,49.4174],[1.9764,49.4157],[1.9805,49.4156],[1.9784,49.4139],[1.9848,49.4078],[1.9796,49.4052],[1.9789,49.4028],[1.9758,49.3995],[1.9703,49.4],[1.9687,49.3968],[1.971,49.3919],[1.9681,49.3892],[1.9654,49.3888],[1.9606,49.3865],[1.9522,49.3898],[1.9468,49.3929],[1.9432,49.3898],[1.9415,49.3871]]]},"60682":{"type":"Polygon","coordinates":[[[2.6598,49.2325],[2.6578,49.2312],[2.6565,49.2315],[2.6567,49.2306],[2.6535,49.2316],[2.6506,49.2299],[2.6463,49.2304],[2.6378,49.2263],[2.6378,49.2275],[2.6357,49.2276],[2.635,49.2305],[2.6334,49.2321],[2.6288,49.2317],[2.6237,49.2351],[2.6243,49.2361],[2.6219,49.2374],[2.624,49.2397],[2.6224,49.2458],[2.612,49.2458],[2.6196,49.2566],[2.62,49.2589],[2.6167,49.2694],[2.6171,49.2704],[2.6072,49.2775],[2.6354,49.2781],[2.6393,49.2737],[2.6512,49.2717],[2.6501,49.2685],[2.6513,49.2672],[2.6625,49.2622],[2.6624,49.2612],[2.6654,49.2595],[2.6662,49.2574],[2.6608,49.2563],[2.6582,49.2534],[2.6603,49.2476],[2.6598,49.2474],[2.6609,49.2463],[2.6599,49.2458],[2.6604,49.245],[2.6593,49.2447],[2.6612,49.2402],[2.6599,49.2399],[2.6607,49.2387],[2.6595,49.2374],[2.6604,49.2367],[2.6582,49.2353],[2.6595,49.2346],[2.6598,49.2325]]]},"60683":{"type":"Polygon","coordinates":[[[2.8611,49.1358],[2.8636,49.1386],[2.8607,49.1388],[2.8586,49.1399],[2.8591,49.1416],[2.8656,49.1413],[2.8667,49.1422],[2.8725,49.1409],[2.8743,49.1423],[2.8763,49.1425],[2.8771,49.1444],[2.8816,49.1441],[2.8839,49.143],[2.8843,49.1506],[2.8895,49.153],[2.9043,49.1548],[2.907,49.1543],[2.9063,49.1529],[2.909,49.1521],[2.9166,49.1524],[2.9222,49.1499],[2.9243,49.15],[2.9278,49.1463],[2.9286,49.143],[2.933,49.1437],[2.9329,49.1429],[2.9357,49.1402],[2.9322,49.1379],[2.9228,49.1351],[2.9114,49.1268],[2.8923,49.1288],[2.8917,49.1303],[2.8864,49.1308],[2.8877,49.1319],[2.8856,49.1323],[2.8751,49.1324],[2.8747,49.1358],[2.8611,49.1358]]]},"60684":{"type":"Polygon","coordinates":[[[2.5106,49.2887],[2.5101,49.281],[2.5074,49.2791],[2.5,49.2772],[2.4959,49.2748],[2.4935,49.2759],[2.4926,49.2772],[2.4835,49.28],[2.479,49.2835],[2.4774,49.2832],[2.4733,49.2852],[2.4772,49.2853],[2.4766,49.2854],[2.4777,49.2876],[2.4757,49.2881],[2.4768,49.2894],[2.4786,49.2895],[2.4781,49.2898],[2.4791,49.2917],[2.4787,49.2921],[2.4822,49.2936],[2.4813,49.2951],[2.4836,49.296],[2.483,49.2979],[2.4852,49.2983],[2.4855,49.2997],[2.4962,49.3029],[2.4955,49.3023],[2.4995,49.2987],[2.5029,49.2976],[2.5017,49.2969],[2.5106,49.2887]]]},"60685":{"type":"Polygon","coordinates":[[[2.1815,49.3712],[2.1869,49.3736],[2.1882,49.3751],[2.1897,49.3745],[2.1961,49.3765],[2.1982,49.3746],[2.1992,49.3765],[2.1984,49.3791],[2.2008,49.3812],[2.2064,49.3829],[2.2061,49.3835],[2.2072,49.384],[2.2081,49.3831],[2.2122,49.3841],[2.2164,49.3801],[2.2193,49.3803],[2.2212,49.3788],[2.2194,49.3778],[2.2194,49.3769],[2.221,49.3772],[2.2229,49.3758],[2.2237,49.3763],[2.2246,49.3751],[2.2257,49.376],[2.2267,49.3756],[2.2265,49.3746],[2.2326,49.3718],[2.2312,49.3705],[2.2316,49.3698],[2.2351,49.3688],[2.237,49.3692],[2.2385,49.3662],[2.2366,49.3649],[2.2351,49.3651],[2.2344,49.3626],[2.2314,49.3636],[2.2315,49.3643],[2.2251,49.3631],[2.2256,49.361],[2.2233,49.3607],[2.2229,49.3591],[2.2129,49.3574],[2.2063,49.358],[2.2059,49.3574],[2.2067,49.3569],[2.2043,49.3565],[2.2043,49.3559],[2.1986,49.3563],[2.1985,49.3572],[2.1955,49.3579],[2.193,49.3614],[2.1881,49.3649],[2.1829,49.3664],[2.1815,49.3712]]]},"60686":{"type":"Polygon","coordinates":[[[2.3978,49.2046],[2.3866,49.2036],[2.386,49.205],[2.385,49.205],[2.385,49.2077],[2.3813,49.2106],[2.3832,49.2114],[2.3804,49.2137],[2.3779,49.2146],[2.3769,49.2157],[2.3779,49.2165],[2.3674,49.2235],[2.3622,49.2278],[2.3615,49.2286],[2.3622,49.2289],[2.3599,49.2309],[2.3645,49.2332],[2.3738,49.2292],[2.3785,49.2295],[2.3828,49.2259],[2.3867,49.2259],[2.3917,49.2239],[2.3952,49.2241],[2.3967,49.2201],[2.3994,49.2174],[2.4009,49.2182],[2.4027,49.2167],[2.4009,49.214],[2.4023,49.2125],[2.4009,49.2117],[2.4057,49.2064],[2.4001,49.2051],[2.4002,49.2046],[2.3978,49.2046]]]},"60687":{"type":"Polygon","coordinates":[[[1.789,49.4904],[1.8011,49.4941],[1.8057,49.4944],[1.8065,49.4913],[1.8141,49.4903],[1.8131,49.4835],[1.809,49.477],[1.8107,49.4757],[1.8093,49.4684],[1.7982,49.4656],[1.7993,49.4625],[1.8037,49.4619],[1.8027,49.461],[1.8013,49.4616],[1.7995,49.456],[1.7796,49.4626],[1.7799,49.4642],[1.7714,49.4645],[1.7682,49.4662],[1.766,49.466],[1.7712,49.4691],[1.7736,49.472],[1.7759,49.4714],[1.7766,49.4731],[1.776,49.476],[1.7739,49.4765],[1.7727,49.4781],[1.7733,49.48],[1.7751,49.4807],[1.7763,49.4827],[1.772,49.485],[1.7787,49.4895],[1.7791,49.4908],[1.7837,49.4909],[1.7875,49.4897],[1.789,49.4904]]]},"60688":{"type":"Polygon","coordinates":[[[1.9795,49.5299],[1.9752,49.5298],[1.9761,49.5284],[1.9731,49.5283],[1.9736,49.5275],[1.9723,49.527],[1.9728,49.5265],[1.9674,49.5236],[1.9667,49.525],[1.9547,49.5276],[1.9551,49.5291],[1.9541,49.5298],[1.9462,49.5309],[1.9428,49.5329],[1.9423,49.5419],[1.9432,49.5431],[1.946,49.5427],[1.9484,49.5435],[1.9544,49.5436],[1.9566,49.5435],[1.9581,49.5425],[1.9629,49.5432],[1.9708,49.5411],[1.9761,49.5366],[1.9792,49.5351],[1.9799,49.5325],[1.9795,49.5299]]]},"60689":{"type":"Polygon","coordinates":[[[2.826,49.4915],[2.8248,49.487],[2.8272,49.4836],[2.8273,49.4812],[2.8229,49.4808],[2.8228,49.4818],[2.8216,49.4823],[2.8146,49.4812],[2.8156,49.4781],[2.8097,49.4742],[2.8089,49.4727],[2.8018,49.4735],[2.8004,49.4716],[2.7912,49.4749],[2.7839,49.4792],[2.784,49.4802],[2.782,49.4816],[2.7826,49.4819],[2.781,49.486],[2.7857,49.4889],[2.7922,49.4911],[2.7922,49.4926],[2.795,49.4928],[2.7941,49.4955],[2.7956,49.4957],[2.7969,49.4976],[2.8052,49.499],[2.8101,49.5018],[2.8124,49.5016],[2.8113,49.4998],[2.8117,49.4986],[2.8139,49.4984],[2.8151,49.4967],[2.8166,49.4963],[2.8161,49.4946],[2.8168,49.4944],[2.8167,49.4953],[2.8174,49.4944],[2.8197,49.4942],[2.8202,49.4923],[2.8214,49.4924],[2.8218,49.4917],[2.826,49.4915]]]},"60691":{"type":"Polygon","coordinates":[[[1.6977,49.5723],[1.6944,49.575],[1.6965,49.5759],[1.6957,49.5766],[1.6963,49.5771],[1.7002,49.5783],[1.6998,49.5791],[1.7008,49.5797],[1.6996,49.5808],[1.6939,49.5791],[1.6913,49.5791],[1.6904,49.5799],[1.6975,49.5826],[1.6988,49.5814],[1.7015,49.5828],[1.7026,49.5814],[1.7053,49.5814],[1.7057,49.5799],[1.7072,49.5798],[1.7102,49.5799],[1.7143,49.5821],[1.7201,49.5817],[1.7196,49.5839],[1.7222,49.5891],[1.7241,49.5893],[1.7255,49.5882],[1.727,49.5887],[1.7273,49.588],[1.7304,49.5878],[1.7312,49.5855],[1.7323,49.5847],[1.7377,49.5853],[1.7438,49.5825],[1.7447,49.5802],[1.7475,49.5773],[1.7493,49.5768],[1.7514,49.5749],[1.7513,49.5741],[1.754,49.5723],[1.7528,49.5714],[1.7533,49.5711],[1.7507,49.57],[1.7504,49.5676],[1.7474,49.5654],[1.7464,49.5636],[1.7366,49.5571],[1.7344,49.5569],[1.7333,49.557],[1.7329,49.5594],[1.7255,49.5643],[1.7221,49.5677],[1.7142,49.5775],[1.7107,49.5766],[1.7106,49.5775],[1.7076,49.5775],[1.7044,49.5764],[1.7032,49.5778],[1.7011,49.5771],[1.7022,49.5755],[1.6977,49.5723]]]},"60692":{"type":"Polygon","coordinates":[[[2.2089,49.6342],[2.2092,49.6357],[2.212,49.6381],[2.2069,49.6401],[2.2084,49.6454],[2.2133,49.6436],[2.2138,49.6458],[2.2151,49.6453],[2.215,49.6464],[2.2197,49.6474],[2.2209,49.6487],[2.2201,49.6498],[2.2256,49.6506],[2.2348,49.6537],[2.2383,49.6518],[2.2395,49.6502],[2.244,49.6514],[2.2451,49.651],[2.2502,49.6482],[2.2482,49.6473],[2.251,49.6443],[2.2541,49.6439],[2.2481,49.6413],[2.2509,49.6393],[2.2485,49.637],[2.2491,49.6367],[2.2403,49.6351],[2.2415,49.6343],[2.2327,49.6325],[2.2319,49.6327],[2.2323,49.6333],[2.2211,49.6331],[2.2122,49.6349],[2.2118,49.6341],[2.2104,49.6339],[2.2087,49.6302],[2.2094,49.6335],[2.2087,49.6337],[2.2089,49.6342]]]},"60693":{"type":"Polygon","coordinates":[[[3.1086,49.6644],[3.0989,49.6843],[3.1069,49.6886],[3.0999,49.6987],[3.0955,49.6989],[3.0957,49.6997],[3.0929,49.6998],[3.0967,49.7058],[3.1006,49.7065],[3.1045,49.7054],[3.1098,49.7064],[3.1183,49.706],[3.1222,49.7018],[3.1238,49.6988],[3.1264,49.6967],[3.1249,49.6961],[3.1247,49.6936],[3.1226,49.6906],[3.122,49.6883],[3.116,49.6859],[3.116,49.6841],[3.1144,49.6837],[3.1155,49.6812],[3.1242,49.6769],[3.1251,49.6728],[3.1274,49.6696],[3.1265,49.6673],[3.1278,49.6618],[3.121,49.6602],[3.1173,49.6668],[3.1086,49.6644]]]},"60694":{"type":"Polygon","coordinates":[[[2.079,49.3327],[2.0799,49.3323],[2.0784,49.3307],[2.0745,49.3293],[2.0706,49.326],[2.0663,49.3267],[2.0624,49.3229],[2.0575,49.3209],[2.0553,49.3173],[2.052,49.3177],[2.0498,49.3165],[2.037,49.3207],[2.0234,49.3274],[2.0227,49.3348],[2.0097,49.3323],[2.006,49.3327],[2.0018,49.3314],[1.9999,49.3335],[1.9945,49.3362],[1.9931,49.3391],[1.998,49.3428],[2.0029,49.3449],[2.004,49.3465],[2.0042,49.3473],[1.9991,49.3514],[1.9973,49.3517],[1.9972,49.3548],[1.9964,49.355],[1.9972,49.358],[2.0,49.3603],[2.0056,49.3608],[2.0066,49.3604],[2.0065,49.3579],[2.0146,49.3585],[2.016,49.3579],[2.0156,49.3558],[2.0201,49.3565],[2.0203,49.3544],[2.0283,49.3517],[2.0278,49.3513],[2.0287,49.3508],[2.0279,49.3501],[2.0298,49.3483],[2.0321,49.349],[2.0342,49.3475],[2.0331,49.3443],[2.0348,49.3436],[2.037,49.3445],[2.0424,49.3447],[2.0435,49.3445],[2.0436,49.3433],[2.0479,49.3424],[2.0535,49.3451],[2.0557,49.3448],[2.0552,49.343],[2.0525,49.3416],[2.0551,49.3388],[2.0518,49.3376],[2.0511,49.3362],[2.0572,49.3355],[2.0573,49.3347],[2.0629,49.3321],[2.0631,49.3355],[2.0663,49.335],[2.0667,49.3359],[2.0689,49.3353],[2.0691,49.3336],[2.0721,49.3347],[2.079,49.3327]]]},"60695":{"type":"Polygon","coordinates":[[[2.501,49.1946],[2.4795,49.199],[2.4668,49.1978],[2.4673,49.1982],[2.4664,49.1993],[2.4725,49.2079],[2.4843,49.2147],[2.4847,49.216],[2.5262,49.2129],[2.5281,49.2105],[2.5255,49.2096],[2.5279,49.2094],[2.5283,49.2068],[2.527,49.2059],[2.5278,49.2053],[2.5267,49.2039],[2.5265,49.201],[2.53,49.2008],[2.5301,49.1997],[2.5287,49.1996],[2.529,49.197],[2.5194,49.1958],[2.5193,49.1964],[2.515,49.1971],[2.5085,49.1951],[2.5015,49.1958],[2.501,49.1946]]]},"60697":{"type":"Polygon","coordinates":[[[1.8747,49.522],[1.8726,49.5211],[1.8724,49.5231],[1.8751,49.5283],[1.8776,49.5306],[1.8746,49.5317],[1.8751,49.5322],[1.8743,49.5326],[1.8784,49.5367],[1.8781,49.5379],[1.8801,49.5402],[1.8829,49.5421],[1.8854,49.5421],[1.889,49.5471],[1.8945,49.5485],[1.8983,49.5505],[1.902,49.5467],[1.9069,49.5496],[1.9099,49.547],[1.9086,49.5458],[1.9115,49.5438],[1.9052,49.5401],[1.9038,49.5415],[1.8934,49.527],[1.8933,49.5255],[1.8922,49.5256],[1.8917,49.5242],[1.887,49.5259],[1.8865,49.5251],[1.8894,49.5243],[1.8878,49.5225],[1.8867,49.523],[1.8859,49.5219],[1.8841,49.5228],[1.8832,49.522],[1.8766,49.5229],[1.8755,49.5241],[1.8739,49.5232],[1.8747,49.522]]]},"60698":{"type":"Polygon","coordinates":[[[2.6246,49.5253],[2.6332,49.5236],[2.6367,49.5218],[2.6385,49.5197],[2.6489,49.519],[2.6483,49.5178],[2.6425,49.5129],[2.6368,49.5043],[2.6341,49.5056],[2.6305,49.5029],[2.6271,49.5018],[2.6254,49.4995],[2.6275,49.4987],[2.6266,49.4974],[2.6241,49.4962],[2.6187,49.497],[2.6137,49.4953],[2.6104,49.4912],[2.6027,49.4935],[2.6043,49.4957],[2.6014,49.4974],[2.6044,49.5013],[2.6032,49.5023],[2.6006,49.5023],[2.5996,49.5035],[2.5958,49.5023],[2.5986,49.5041],[2.5974,49.5045],[2.5982,49.5048],[2.5977,49.5055],[2.5946,49.5057],[2.5957,49.5076],[2.5979,49.5074],[2.5987,49.5095],[2.6014,49.5091],[2.6017,49.51],[2.6078,49.5105],[2.6081,49.5112],[2.6092,49.5112],[2.611,49.5091],[2.6136,49.5136],[2.6158,49.5142],[2.6159,49.5155],[2.6185,49.5153],[2.6172,49.5203],[2.6207,49.5205],[2.6218,49.5232],[2.6246,49.5253]]]},"60699":{"type":"Polygon","coordinates":[[[1.8204,49.5266],[1.8279,49.5279],[1.8303,49.5293],[1.8306,49.5287],[1.8346,49.5285],[1.846,49.531],[1.8492,49.5296],[1.8545,49.5294],[1.8562,49.5316],[1.8574,49.5314],[1.8608,49.5301],[1.86,49.5266],[1.8646,49.5219],[1.8636,49.5214],[1.8653,49.5204],[1.8663,49.5206],[1.8672,49.5193],[1.8645,49.5175],[1.8613,49.5189],[1.8605,49.5182],[1.8556,49.5179],[1.8553,49.5153],[1.8537,49.5126],[1.8479,49.5117],[1.838,49.5145],[1.8356,49.5145],[1.835,49.5172],[1.8307,49.5158],[1.8283,49.5162],[1.8212,49.5235],[1.8204,49.5266]]]},"60700":{"type":"Polygon","coordinates":[[[2.1928,49.3931],[2.1917,49.3923],[2.193,49.3916],[2.1938,49.3896],[2.1951,49.3896],[2.1948,49.3886],[2.1964,49.3876],[2.191,49.3856],[2.1889,49.3864],[2.1874,49.386],[2.1874,49.3847],[2.1866,49.3842],[2.1877,49.3837],[2.1836,49.3816],[2.1833,49.3779],[2.1818,49.3775],[2.1882,49.3751],[2.1869,49.3736],[2.1816,49.3712],[2.182,49.3722],[2.1761,49.3763],[2.1738,49.3768],[2.1724,49.3752],[2.1703,49.3759],[2.1699,49.3769],[2.1711,49.3781],[2.1702,49.3789],[2.1662,49.3766],[2.1654,49.3733],[2.162,49.3698],[2.162,49.3687],[2.1588,49.3689],[2.1556,49.3717],[2.1544,49.3715],[2.153,49.3732],[2.15,49.3726],[2.1495,49.374],[2.1473,49.3734],[2.1475,49.3739],[2.1431,49.375],[2.1366,49.3733],[2.1381,49.3723],[2.1315,49.367],[2.1292,49.3704],[2.1274,49.37],[2.1266,49.3708],[2.1372,49.3742],[2.1357,49.3776],[2.1361,49.378],[2.1336,49.3786],[2.1338,49.3796],[2.1355,49.3796],[2.1367,49.3808],[2.136,49.3808],[2.1358,49.3836],[2.1352,49.3839],[2.1358,49.3872],[2.1327,49.388],[2.1315,49.39],[2.1268,49.3881],[2.1264,49.3893],[2.1279,49.3895],[2.1276,49.3914],[2.1249,49.393],[2.124,49.3923],[2.1204,49.3923],[2.1215,49.3957],[2.1225,49.3963],[2.125,49.3947],[2.1282,49.3964],[2.1303,49.3957],[2.1377,49.3966],[2.14,49.4019],[2.1466,49.3999],[2.1526,49.4011],[2.1566,49.4008],[2.1634,49.4043],[2.1662,49.403],[2.1679,49.4042],[2.165,49.4057],[2.1673,49.4073],[2.1683,49.4062],[2.171,49.4064],[2.167,49.4033],[2.17,49.4012],[2.1669,49.3996],[2.168,49.3966],[2.1664,49.3945],[2.1717,49.3947],[2.1762,49.3938],[2.1788,49.3924],[2.1865,49.3938],[2.1895,49.3952],[2.1928,49.3931]]]},"60701":{"type":"Polygon","coordinates":[[[2.3619,49.5679],[2.3666,49.5672],[2.369,49.5681],[2.3744,49.5664],[2.3707,49.5626],[2.3779,49.5601],[2.3834,49.5567],[2.3784,49.5529],[2.3821,49.5509],[2.3827,49.5519],[2.3858,49.5502],[2.382,49.5442],[2.379,49.5427],[2.3851,49.5415],[2.3827,49.5373],[2.3813,49.538],[2.3764,49.5342],[2.3719,49.5369],[2.3614,49.5348],[2.3609,49.5356],[2.3558,49.5335],[2.3547,49.532],[2.3529,49.5329],[2.3475,49.53],[2.3465,49.5286],[2.3358,49.5324],[2.3342,49.5314],[2.3308,49.5319],[2.3309,49.5338],[2.3301,49.5328],[2.3279,49.534],[2.3362,49.5424],[2.3372,49.5459],[2.3365,49.5473],[2.3399,49.548],[2.3416,49.5503],[2.3432,49.5501],[2.345,49.5521],[2.346,49.5514],[2.3482,49.5525],[2.3493,49.5516],[2.3511,49.5522],[2.3499,49.5532],[2.3508,49.5537],[2.3503,49.554],[2.3553,49.5575],[2.3569,49.5606],[2.3558,49.5667],[2.3619,49.5679]]]},"60702":{"type":"Polygon","coordinates":[[[2.5033,49.6005],[2.5014,49.5964],[2.4987,49.5972],[2.4978,49.59],[2.4953,49.5889],[2.4972,49.5876],[2.4955,49.5869],[2.4843,49.589],[2.4837,49.5901],[2.4787,49.5927],[2.4756,49.5923],[2.475,49.5932],[2.4678,49.5945],[2.4584,49.5891],[2.451,49.5913],[2.4481,49.5907],[2.4418,49.5916],[2.4386,49.5905],[2.4392,49.5921],[2.4537,49.5952],[2.4497,49.6003],[2.448,49.5994],[2.4456,49.6026],[2.4422,49.5995],[2.4364,49.6004],[2.4384,49.6031],[2.4385,49.6066],[2.4441,49.6078],[2.4478,49.6029],[2.4572,49.6036],[2.4598,49.6046],[2.4639,49.6079],[2.4694,49.6139],[2.4715,49.618],[2.4778,49.6199],[2.4785,49.6203],[2.4779,49.6207],[2.4869,49.6262],[2.485,49.6268],[2.4876,49.6294],[2.4869,49.6297],[2.4884,49.6314],[2.4919,49.6317],[2.4963,49.6358],[2.5052,49.6396],[2.5046,49.6372],[2.5065,49.6361],[2.5047,49.6351],[2.5068,49.6347],[2.5107,49.6323],[2.5124,49.6329],[2.514,49.6321],[2.5159,49.6301],[2.5153,49.6296],[2.5159,49.6291],[2.5168,49.63],[2.5189,49.6292],[2.5215,49.6269],[2.511,49.623],[2.5051,49.6186],[2.4977,49.6153],[2.4945,49.6117],[2.4917,49.6101],[2.4942,49.6089],[2.4925,49.6078],[2.5049,49.6038],[2.5033,49.6005]]]},"60703":{"type":"Polygon","coordinates":[[[2.0164,49.4008],[2.0213,49.4087],[2.0241,49.4088],[2.0254,49.4097],[2.0257,49.4091],[2.026,49.4097],[2.0283,49.4092],[2.0277,49.4111],[2.0317,49.412],[2.0334,49.4144],[2.0371,49.4156],[2.0381,49.4185],[2.0394,49.4193],[2.0402,49.419],[2.0395,49.4186],[2.0441,49.4183],[2.0475,49.4193],[2.0473,49.42],[2.0491,49.4192],[2.0504,49.4209],[2.0535,49.4185],[2.0576,49.4212],[2.0592,49.4205],[2.0543,49.4178],[2.0563,49.4159],[2.0619,49.4194],[2.0663,49.418],[2.0643,49.4156],[2.0654,49.415],[2.0645,49.4141],[2.0661,49.4133],[2.0639,49.4106],[2.0618,49.4116],[2.0595,49.4097],[2.0579,49.4108],[2.0563,49.4094],[2.0581,49.4083],[2.053,49.4051],[2.0535,49.4047],[2.045,49.4],[2.0357,49.3918],[2.0306,49.3932],[2.0306,49.3947],[2.0276,49.3963],[2.0286,49.3971],[2.0278,49.3979],[2.0282,49.3986],[2.0263,49.3997],[2.0225,49.3977],[2.0164,49.4008]]]}};


/* ══ PROTECTION JS ══ */
document.addEventListener('contextmenu',e=>e.preventDefault());
document.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&['a','c','s','u','p'].includes(e.key.toLowerCase()))e.preventDefault();
});
document.addEventListener('dragstart',e=>e.preventDefault());
document.addEventListener('selectstart',e=>e.preventDefault());
// Couleur texte tooltip par nuance (si fill trop clair sur fond sombre)
const NUANCE_TEXT_COLORS={};
const NUANCE_COLORS={"BC-RN":"#0a1a5c","BC-LR":"#0f4c99","BC-DVD":"#2485e5","BC-DVC":"#42A5F5","BC-DSV":"#90CAF9","BC-REM":"#E65100","BC-UG":"#db4f4f","BC-UGE":"#d84848","BC-DVG":"#EF5350","BC-RDG":"#E57373","BC-SOC":"#e73381","BC-FI":"#e34a4a","BC-COM":"#a74de0","BC-ECO":"#36933a", "BC-FN":"#0a1a5c", "BC-UD":"#1864b8", "BC-UMP":"#0f4c99", "BC-FG":"#e34a4a", "BC-VEC":"#36933a", "FN":"#0a1a5c", "UD":"#1864b8", "UG":"#db4f4f", "UMP":"#0f4c99", "SOC":"#e73381", "VEC":"#36933a", "DVD":"#2485e5", "DVG":"#EF5350", "COM":"#a74de0", "FG":"#e34a4a", "RN":"#0a1a5c", "LR":"#0f4c99", "REC":"#3e1313", "EXG":"#8b0000", "EXD":"#000000", "ECO":"#36933a", "ENS":"#E65100", "LFI":"#e34a4a", "UDI":"#42A5F5"};
const NUANCE_LABELS={"BC-RN":"RN","BC-LR":"LR","BC-DVD":"Droite div.","BC-DVC":"Centre-droit","BC-DSV":"Div. droite","BC-REM":"Renaissance","BC-UG":"Union Gauche","BC-UGE":"UG-Éco","BC-DVG":"Gauche div.","BC-SOC":"PS","BC-FI":"LFI","BC-COM":"PCF","BC-RDG":"Rassemblement Gche","BC-ECO":"Écologistes", "BC-FN":"FN", "BC-UD":"Union Droite", "BC-UMP":"UMP", "BC-FG":"Front de Gauche", "BC-VEC":"EELV", "RN":"RN", "LR":"LR", "REC":"Reconquête", "EXG":"Extrême Gauche", "EXD":"Extrême Droite", "ECO":"Écologistes", "ENS":"Ensemble", "LFI":"LFI", "UDI":"UDI", "UG":"NFP/Union Gauche"};
const NUANCE_BLOC={
  "BC-RN":"RN", "BC-FN":"RN", "FN":"RN", "BC-EXD":"RN", "RN":"RN", "REC":"RN", "EXD":"RN",
  "BC-LR":"Droite", "BC-DVD":"Droite", "BC-DSV":"Droite", "BC-UD":"Droite", "BC-UMP":"Droite", "UD":"Droite", "UMP":"Droite", "DVD":"Droite", "LR":"Droite",
  "BC-UGE":"Gauche", "BC-UG":"Gauche", "BC-DVG":"Gauche", "BC-SOC":"Gauche", "BC-FI":"Gauche", "BC-COM":"Gauche", "BC-RDG":"Gauche", "BC-ECO":"Gauche", "BC-FG":"Gauche", "BC-VEC":"Gauche", "UG":"Gauche", "SOC":"Gauche", "VEC":"Gauche", "DVG":"Gauche", "COM":"Gauche", "FG":"Gauche", "EXG":"Gauche", "ECO":"Gauche", "LFI":"Gauche",
  "BC-DVC":"Centre", "BC-REM":"Centre", "BC-MDM":"Centre", "BC-UC":"Centre", "ENS":"Centre", "UDI":"Centre"
};

/* ══════════════════════════════════════════════════
   DONNÉES ÉLECTORALES — import dynamique T1 / T2
══════════════════════════════════════════════════ */
const BV_DATA_T1={};
const BV_DATA_T2={};

let elecDataT1 = window.elecDataT1 || {};
let elecDataT2 = window.elecDataT2 || {};
let elec15DataT1 = window.elec15DataT1 || {};
let elec15DataT2 = window.elec15DataT2 || {};
window.elecDataT1 = elecDataT1;
window.elecDataT2 = elecDataT2;
window.elec15DataT1 = elec15DataT1;
window.elec15DataT2 = elec15DataT2;

function _parseElecRows(rows, is2015=false, tour=1, isLegis=false){
  const tmp={};
  
  if (is2015 && tour === 2) {
    // Format T2 2015 (long format)
    // 0:NUMTOUR 1:CODDPT 2:CODSUBCOM 3:LIBSUBCOM 4:CODBURVOT 5:CODCAN 6:LIBCAN 7:NBRINS 8:NBRVOT 9:NBREXP 10:NUMDEPCAND 11:LIBLISEXT 12:CODNUA 13:NBRVOIX
    let si = 0;
    for(let i=0;i<Math.min(8,rows.length);i++){
      const text = (rows[i] || []).join(' ').toLowerCase();
      if(text.includes('numtour') || text.includes('coddpt') || text.includes('codsubcom')) { si=i+1; break; }
    }
    const seenBV = new Set();
    
    for(let ri=si; ri<rows.length; ri++){
      const row = rows[ri]; if(!row || !row[1]) continue;
      const deptStr = String(row[1]).replace(/\D/g, '').trim();
      const dept = parseInt(deptStr, 10).toString();
      const comm = String(row[2]).replace(/\D/g, '').trim();
      const bv = String(row[4]).trim();
      if(!dept || !comm || isNaN(dept)) continue;
      const code = dept.padStart(2, '0') + comm.padStart(3, '0');
      if(!code.startsWith('60')) continue;
      
      if(!tmp[code]) tmp[code] = {ins:0, abs:0, vot:0, exp:0, v:{}, b:{}};
      const c = tmp[code];
      
      const bvKey = code + '_' + bv;
      if (!seenBV.has(bvKey)) {
        seenBV.add(bvKey);
        const ins = parseFloat(row[7]) || 0;
        const vot = parseFloat(row[8]) || 0;
        const exp = parseFloat(row[9]) || 0;
        const abs = ins - vot;
        c.ins += ins; c.abs += abs; c.vot += vot; c.exp += exp;
      }
      
      const nuance = String(row[12] || '').trim();
      const binome = String(row[11] || '').trim();
      const voix = parseFloat(row[13]) || 0;
      if (nuance) {
        c.v[nuance] = (c.v[nuance] || 0) + voix;
        if (!c.b[nuance] && binome) c.b[nuance] = binome;
      }
    }
  } else if (is2015 && tour === 1) {
    // Format T1 2015 (wide format)
    // 0:Date 1:Dept 2:LibDept 3:CodCan 4:LibCan 5:CodCom 6:LibCom 7:Ins 8:Abs 10:Vot 18:Exp
    // 21:Panneau 22:Nuance 23:Binome 24:Voix
    let si = 0;
    for(let i=0;i<Math.min(8,rows.length);i++){
      const text = (rows[i] || []).join(' ').toLowerCase();
      if(text.includes('date') || text.includes('panneau') || text.includes('code de la commune')) { si=i+1; break; }
    }
    for(let ri=si; ri<rows.length; ri++){
      const row = rows[ri]; if(!row || !row[1]) continue;
      const deptStr = String(row[1]).replace(/\D/g, '').trim();
      const dept = parseInt(deptStr, 10).toString();
      const comm = String(row[5]).replace(/\D/g, '').trim();
      if(!dept || !comm || isNaN(dept)) continue;
      const code = dept.padStart(2, '0') + comm.padStart(3, '0');
      if(!code.startsWith('60')) continue;
      
      if(!tmp[code]) tmp[code] = {ins:0, abs:0, vot:0, exp:0, v:{}, b:{}};
      const c = tmp[code];
      const ins = parseFloat(row[7]) || 0, abs = parseFloat(row[8]) || 0;
      const vot = parseFloat(row[10]) || 0, exp = parseFloat(row[18]) || 0;
      c.ins += ins; c.abs += abs; c.vot += vot; c.exp += exp;
      
      for(let n=0; n<12; n++){
        const base = 21 + n * 6; if(base + 3 >= row.length) break;
        const nuance = String(row[base + 1] || '').trim(); // Nuance is col 22
        const binome = String(row[base + 2] || '').trim(); // Binome is col 23
        const voix = parseFloat(row[base + 3]) || 0;       // Voix is col 24
        if(!nuance) break;
        c.v[nuance] = (c.v[nuance] || 0) + voix;
        if(!c.b[nuance] && binome) c.b[nuance] = binome;
      }
    }
  } else if (isLegis) {
    let si = 0;
    let hdrs = [];
    for(let i=0;i<Math.min(8,rows.length);i++){
      const text = (rows[i] || []).join(' ').toLowerCase();
      if(text.includes('code') || text.includes('libellé') || text.includes('département')) { 
         si=i+1; 
         hdrs = (rows[i] || []).map(h=>String(h).toLowerCase().trim());
         break; 
      }
    }
    
    const codeCommuneIdx = hdrs.findIndex(h => h === 'code commune' || h === 'code de la commune' || h === 'commune');
    const candOffset = hdrs.findIndex(h => h.includes('panneau'));
    const idx = {
       ins: hdrs.findIndex(x => x === 'inscrits'),
       vot: hdrs.findIndex(x => x === 'votants'),
       abs: hdrs.findIndex(x => x === 'abstentions'),
       exp: hdrs.findIndex(x => x === 'exprimés' || x === 'exprimes')
    };

    const iComm = codeCommuneIdx > -1 ? codeCommuneIdx : 2;
    const iIns = idx.ins > -1 ? idx.ins : 5;
    const iVot = idx.vot > -1 ? idx.vot : 6;
    const iAbs = idx.abs > -1 ? idx.abs : 8;
    const iExp = idx.exp > -1 ? idx.exp : 10;
    const iCand = candOffset > -1 ? candOffset : 19;

    for(let ri=si; ri<rows.length; ri++){
      const row = rows[ri]; if(!row || !row[0]) continue;
      const deptStr = String(row[0]).replace(/\D/g, '');
      const dept = parseInt(deptStr, 10).toString();
      let comm = String(row[iComm]).trim();
      // Le code commune dans le doc commence souvent par le département "60001"
      if (comm.startsWith(deptStr) && comm.length > 3) {
         comm = comm.substring(deptStr.length);
      }
      comm = comm.replace(/\D/g, '');
      if(!dept || !comm || isNaN(dept)) continue;
      const code = dept.padStart(2, '0') + comm.padStart(3, '0');
      if(!code.startsWith('60')) continue;
      
      const ins = parseFloat(String(row[iIns]||'0').replace(/\s/g,'').replace(',','.')) || 0;
      const abs = parseFloat(String(row[iAbs]||'0').replace(/\s/g,'').replace(',','.')) || 0;
      const vot = parseFloat(String(row[iVot]||'0').replace(/\s/g,'').replace(',','.')) || 0;
      const exp = parseFloat(String(row[iExp]||'0').replace(/\s/g,'').replace(',','.')) || 0;
      if(!tmp[code]) tmp[code] = {ins:0, abs:0, vot:0, exp:0, v:{}, b:{}};
      const c = tmp[code];

      c.ins += ins; c.abs += abs; c.vot += vot; c.exp += exp;
      for(let n=0; n<20; n++){
        const base = iCand + n * 9; if(base + 5 >= row.length) break;
        let nuance = String(row[base + 1] || '').trim();
        if (!nuance && row[base]) nuance = 'Cdt ' + row[base];
        let voix = parseFloat(String(row[base + 5]||'0').replace(/\s/g,'').replace(',', '.')) || 0;
        let binome = String(row[base + 2] || '').trim();
        if (!nuance) continue;
        c.v[nuance] = (c.v[nuance] || 0) + voix;
        if(!c.b[nuance] && binome) c.b[nuance] = binome;
      }
    }
  } else {
    // Default format 2021 (wide format)
    let si = 0;
    for(let i=0;i<Math.min(8,rows.length);i++){
      const text = (rows[i] || []).join(' ').toLowerCase();
      if(text.includes('code') || text.includes('libellé') || text.includes('département')) { si=i+1; break; }
    }
    for(let ri=si; ri<rows.length; ri++){
      const row = rows[ri]; if(!row || !row[0]) continue;
      const deptStr = String(row[0]).replace(/\D/g, '');
      const dept = parseInt(deptStr, 10).toString();
      const comm = String(row[4]).replace(/\D/g, '');
      const bv = String(row[5] || '001').padStart(3, '0'); // Assuming BV code is col 5 for 2021 wide
      if(!dept || !comm || isNaN(dept)) continue;
      const code = dept.padStart(2, '0') + comm.padStart(3, '0');
      if(!code.startsWith('60')) continue;
      
      const ins = parseFloat(row[7]) || 0, abs = parseFloat(row[8]) || 0;
      const vot = parseFloat(row[10]) || 0, exp = parseFloat(row[18]) || 0;
      if(!tmp[code]) tmp[code] = {ins:0, abs:0, vot:0, exp:0, v:{}, b:{}};
      const c = tmp[code];

      // BV Local Storage
      const bvKey = code + '_' + bv;
      const bvStore = tour === 1 ? BV_DATA_T1 : BV_DATA_T2;
      if(!bvStore[bvKey]) bvStore[bvKey] = {ins:0, abs:0, vot:0, exp:0, v:{}, b:{}, maxN:'', maxPCT:0};
      const bvi = bvStore[bvKey];
      bvi.ins += ins; bvi.abs += abs; bvi.vot += vot; bvi.exp += exp;

      c.ins += ins; c.abs += abs; c.vot += vot; c.exp += exp;
      for(let n=0; n<12; n++){
        const base = 21 + n * 6; if(base + 3 >= row.length) break;
        const nuance = String(row[base + 2] || '').trim();
        const voix = parseFloat(row[base + 3]) || 0;
        const binome = String(row[base + 1] || '').trim();
        if(!nuance) break;
        c.v[nuance] = (c.v[nuance] || 0) + voix;
        if(!c.b[nuance] && binome) c.b[nuance] = binome;
        bvi.v[nuance] = (bvi.v[nuance] || 0) + voix;
        if(!bvi.b[nuance] && binome) bvi.b[nuance] = binome;
      }
      
      let maxVoix = -1;
      for(const bvn in bvi.v) {
        if(bvi.v[bvn] > maxVoix) {
          maxVoix = bvi.v[bvn];
          bvi.maxN = bvn;
        }
      }
      bvi.maxPCT = bvi.exp > 0 ? (maxVoix / bvi.exp) * 100 : 0;
    }
  }
  
  const result={};
  for(const[code,c]of Object.entries(tmp)){
    const sorted=Object.entries(c.v).sort((a,b)=>b[1]-a[1]);
    result[code]={
      ins:c.ins,abs:c.abs,vot:c.vot,exp:c.exp,
      pctAbs:c.ins>0?Math.round(c.abs/c.ins*1000)/10:0,
      pctPart:c.ins>0?Math.round(c.vot/c.ins*1000)/10:0,
      n1:sorted[0]?.[0]||'',
      b1:c.b[sorted[0]?.[0]]||'',
      pct1:c.exp>0?Math.round((sorted[0]?.[1]||0)/c.exp*1000)/10:0,
      v:Object.fromEntries(sorted),
      b:c.b,
      cands: sorted.map(s => ({
        nu: s[0],
        bi: c.b[s[0]] || '',
        p: c.exp > 0 ? (s[1] / c.exp * 100) : 0,
        bl: (typeof NUANCE_BLOC !== 'undefined' ? NUANCE_BLOC[s[0]] : null) || ''
      }))
    };
  }

  // Also assign directly to window just in case
  if (isLegis) {
      window.LEGIS2024T1 = window.LEGIS2024T1 || {};
      window.LEGIS2024T2 = window.LEGIS2024T2 || {};
      if (tour === 1) Object.assign(window.LEGIS2024T1, result);
      else Object.assign(window.LEGIS2024T2, result);
  } else if (is2015) {
      if (tour === 1) Object.assign(window.elec15DataT1, result);
      else Object.assign(window.elec15DataT2, result);
  } else {
      if (tour === 1) Object.assign(window.elecDataT1, result);
      else Object.assign(window.elecDataT2, result);
  }

  return result;
}

function _applyElecRowsData(rows, tour, typeParam, stId, isZipContext) {
  let type = 'elec21';
  if (typeParam === true || typeParam === 'elec15') type = 'elec15';
  else if (typeParam === 'legis24') type = 'legis24';
  const is2015 = (type === 'elec15');
  const isLegis = (type === 'legis24');
  const st=document.getElementById(stId);

  try{
    const result=_parseElecRows(rows, is2015, tour, isLegis);
    const n=Object.keys(result).length;
    if(isLegis){
      window.LEGIS2024T1 = window.LEGIS2024T1 || {};
      window.LEGIS2024T2 = window.LEGIS2024T2 || {};
      if(tour===1) Object.assign(window.LEGIS2024T1, result);
      else Object.assign(window.LEGIS2024T2, result);
    }else if(is2015){
      if(tour===1){Object.assign(elec15DataT1, result); Object.assign(window.elec15DataT1, result);}else{Object.assign(elec15DataT2, result); Object.assign(window.elec15DataT2, result);}
    }else{
      if(tour===1){Object.assign(elecDataT1, result); Object.assign(window.elecDataT1, result);}else{Object.assign(elecDataT2, result); Object.assign(window.elecDataT2, result);}
    }
    /* ── Données BV par bureau de vote ── */
    let stBV='';
    if(!is2015){
        const bvResult=_parseElecBV(rows, isLegis);
        const nbBV=Object.keys(bvResult).length;
        if(isLegis){
           if(tour===1) window.LEGIS2024T1 = Object.assign(window.LEGIS2024T1 || {}, bvResult);
           else window.LEGIS2024T2 = Object.assign(window.LEGIS2024T2 || {}, bvResult);
        } else {
           if(tour===1){window._BV_T1=bvResult;}else{window._BV_T2=bvResult;}
        }
        if(typeof window._bvRefreshIfActive==='function') window._bvRefreshIfActive();
        /* Invalider le cache GeoJSON BV pour forcer un re-rendu avec nouvelles données */
        if(window._bvState)window._bvState.geo=null;
        stBV=nbBV>0?` · ${nbBV} BV`:'';
    }
    if(st)st.textContent=n>0?`✅ ${n} communes chargées${stBV}`:'⚠️ Aucune commune trouvée';
    if(typeof _clearQtCache!=='undefined')_clearQtCache();
    if(typeof refreshMobMapMarkers!=='undefined'&&typeof mobMapDone!=='undefined'&&mobMapDone)if(typeof _hidePopCard==='function')_hidePopCard();
    refreshMobMapMarkers();
    if(typeof updateMapMarkers!=='undefined'&&typeof mapInstance!=='undefined'&&mapInstance)if(typeof _hidePopCard==='function')_hidePopCard();
    updateMapMarkers();
    if(typeof buildCantonOverlay!=='undefined')buildCantonOverlay();
    if(typeof selectedCode!=='undefined'&&selectedCode)openDetail(selectedCode);
    if(typeof renderAnalyseHome === 'function' && currentTab === 'analyse') renderAnalyseHome();
  }catch(err){if(st)st.textContent='⚠️ '+err.message;}
}

function handleElecImport(event, tour, typeParam, importedRows = null) {
  let type = 'elec21';
  if (typeParam === true || typeParam === 'elec15') type = 'elec15';
  else if (typeParam === 'legis24') type = 'legis24';

  const is2015 = (type === 'elec15');
  const isLegis = (type === 'legis24');

  const file = event.target ? event.target.files[0] : null;
  const isZipContext = event.target ? !event.target.id : false;
  let stId = 'zipStatus';
  if (isLegis) stId = tour === 1 ? 'legis24T1Status' : 'legis24T2Status';
  else if (is2015) stId = tour === 1 ? 'elec15T1Status' : 'elec15T2Status';
  else stId = tour === 1 ? 'elecT1Status' : 'elecT2Status';

  const st=document.getElementById(stId);if(st && !isZipContext)st.textContent='⏳ Lecture…';
  
  if (importedRows) {
    // If rows are already available, avoid reading file again
    setTimeout(() => _applyElecRowsData(importedRows, tour, typeParam, stId, isZipContext), 10);
    return;
  }
  
  if(!file)return;
  const r=new FileReader();
  r.onload=ev=>{
    try{
      const wb=XLSX.read(new Uint8Array(ev.target.result),{type:'array'});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const rows=XLSX.utils.sheet_to_json(ws,{header:1, defval:'', blankrows:false});
      _applyElecRowsData(rows, tour, typeParam, stId, isZipContext);
    }catch(err){if(st)st.textContent='⚠️ '+err.message;}
    if(event.target) event.target.value='';
  };
  r.readAsArrayBuffer(file);
}



/* ══ _parseElecBV v2 — données complètes par bureau de vote ════════════════
   Retourne { 'DDDCC_BBBB': { n,b,v,bl,ins,abs,pctAbs,vot,pctPart,bla,nul,exp, cands:[...] } }
   ══════════════════════════════════════════════════════════════════════════ */
function _parseElecBV(rows, isLegis=false){
  var BLOC={
    'BC-FI':'Gauche','BC-LFI':'Gauche','BC-EXG':'Gauche',
    'BC-UG':'Gauche','BC-SOC':'Gauche','BC-DVG':'Gauche',
    'BC-VEC':'Gauche','BC-ECO':'Gauche','BC-UGE':'Gauche',
    'BC-ENS':'Centre','BC-REN':'Centre','BC-MDM':'Centre',
    'BC-UDI':'Centre','BC-LREM':'Centre','BC-REM':'Centre','BC-DVC':'Centre',
    'BC-LR':'Droite','BC-UCD':'Droite','BC-DVD':'Droite',
    'BC-RN':'Extrême droite','BC-EXD':'Extrême droite','BC-PFN':'Extrême droite',
    'BC-DIV':'Divers','BC-DSV':'Divers','BC-REG':'Divers','BC-COM':'Divers'
  };
  var si=0;
  var hdrs = [];
  for(var i=0;i<Math.min(8,rows.length);i++){
    if(String(rows[i]?.[0]||'').toLowerCase().includes('code')){
       si=i+1;
       hdrs = (rows[i] || []).map(function(h){ return String(h).toLowerCase().trim(); });
       break;
    }
  }
  var result={};
  
  var isLegisBvValid = true;
  var legIdx = {};
  if (isLegis) {
     legIdx.comm = hdrs.findIndex(function(h){ return h === 'code commune' || h === 'code de la commune' || h === 'commune'; });
     legIdx.bv = hdrs.findIndex(function(h){ return h.includes('code') && h.includes('bv') || h.includes('b.v'); });
     if (legIdx.bv === -1 && hdrs.includes('code bureau de vote')) legIdx.bv = hdrs.indexOf('code bureau de vote');
     legIdx.ins = hdrs.findIndex(function(x){ return x === 'inscrits'; });
     legIdx.abs = hdrs.findIndex(function(x){ return x === 'abstentions'; });
     legIdx.vot = hdrs.findIndex(function(x){ return x === 'votants'; });
     legIdx.exp = hdrs.findIndex(function(x){ return x === 'exprimés' || x === 'exprimes'; });
     legIdx.bla = hdrs.findIndex(function(x){ return x === 'blancs'; });
     legIdx.nul = hdrs.findIndex(function(x){ return x === 'nuls'; });
     legIdx.pctAbs = hdrs.findIndex(function(x){ return x === '% abstentions'; });
     legIdx.pctVot = hdrs.findIndex(function(x){ return x === '% votants'; });
     legIdx.cand = hdrs.findIndex(function(h){ return h.includes('panneau'); });
     
     // If this is a commune level file, it doesn't have Code BV
     if (legIdx.bv === -1) {
         isLegisBvValid = false;
     }
  }

  if (isLegis && !isLegisBvValid && hdrs.length > 0) return result; // Return empty, nothing to do for BV on commune file
  
  for(var ri=si;ri<rows.length;ri++){
    var row=rows[ri]; if(!row||!row[0])continue;
    var deptStr=String(row[0]).replace(/\D/g,'');
    var dept=parseInt(deptStr, 10).toString();
    
    // Default indices for 2021
    var codeCommuneIdx = 4;
    var codeBvIdx = 6;
    var insIdx = 7, absIdx = 8, pctAbsIdx = 9, votIdx = 10, pctPartIdx = 11;
    var blaIdx = 12, nulIdx = 15, expIdx = 18;
    var baseCand = 21;
    
    if (isLegis) {
      codeCommuneIdx = legIdx.comm > -1 ? legIdx.comm : 2;
      codeBvIdx = legIdx.bv > -1 ? legIdx.bv : 4;
      insIdx = legIdx.ins > -1 ? legIdx.ins : 5;
      votIdx = legIdx.vot > -1 ? legIdx.vot : 6;
      pctPartIdx = legIdx.pctVot > -1 ? legIdx.pctVot : 7;
      absIdx = legIdx.abs > -1 ? legIdx.abs : 8;
      pctAbsIdx = legIdx.pctAbs > -1 ? legIdx.pctAbs : 9;
      expIdx = legIdx.exp > -1 ? legIdx.exp : 10;
      blaIdx = legIdx.bla > -1 ? legIdx.bla : 13;
      nulIdx = legIdx.nul > -1 ? legIdx.nul : 16;
      baseCand = legIdx.cand > -1 ? legIdx.cand : 19;
    }

    var commStr=String(row[codeCommuneIdx]||'');
    if (isLegis && commStr.startsWith(deptStr) && commStr.length > 3) {
       commStr = commStr.substring(deptStr.length);
    }
    var comm = commStr.replace(/\D/g,'');
    if(!dept||!comm||isNaN(dept))continue;
    var code=dept.padStart(2,'0')+comm.padStart(3,'0');
    if(!code.startsWith('60'))continue;
    
    var bvNum=String(row[codeBvIdx]).replace(/\D/g,'').padStart(4,'0');
    if(!bvNum||bvNum==='0000')continue;
    var key=code+bvNum;
    
    var ins=parseFloat(String(row[insIdx]||0).replace(',','.'))||0;
    var abs=parseFloat(String(row[absIdx]||0).replace(',','.'))||0;
    var pctAbs=parseFloat(String(row[pctAbsIdx]||0).replace('%','').replace(',','.'))||0;
    var vot=parseFloat(String(row[votIdx]||0).replace(',','.'))||0;
    var pctPart=parseFloat(String(row[pctPartIdx]||0).replace('%','').replace(',','.'))||0;
    var bla=parseFloat(String(row[blaIdx]||0).replace(',','.'))||0;
    var nul=parseFloat(String(row[nulIdx]||0).replace(',','.'))||0;
    var exp=parseFloat(String(row[expIdx]||0).replace(',','.'))||0;
    
    /* Candidats */
    var cands=[];
    var loopMax = isLegis ? 20 : 12;
    for(var n=0;n<loopMax;n++){
      var base = isLegis ? (baseCand + n*9) : (21 + n*6);
      if(base+ (isLegis?5:3) >= row.length) break;
      
      var nuanceIdx = isLegis ? base+1 : base+2;
      var binomeIdx = isLegis ? base+2 : base+1;
      var voixIdx = isLegis ? base+5 : base+3;
      var piIdx = isLegis ? base+6 : base+4;
      var peIdx = isLegis ? base+7 : base+5;
      
      var pNum = row[base];
      var nuance=String(row[nuanceIdx]||'').trim();
      if((!nuance||nuance==='undefined') && pNum !== undefined && pNum !== '') nuance = 'Cdt ' + pNum;
      if(!nuance||nuance==='undefined')break;
      var voix=parseFloat(String(row[voixIdx]||0).replace(',','.'))||0;
      var binome=String(row[binomeIdx]||'').trim();
      var pi=parseFloat(String(row[piIdx]||0).replace('%','').replace(',','.'))||0;
      var pe=parseFloat(String(row[peIdx]||0).replace('%','').replace(',','.'))||0;
      cands.push({nu:nuance,bi:binome,vo:voix,pi:pi,pe:pe});
    }
    cands.sort(function(a,b){return b.vo-a.vo;});
    var winner=cands[0]||{nu:'',bi:'',vo:0};
    var pctWinner = exp>0 ? Math.round(winner.vo/exp*1000)/10 : 0;
    result[key]={
      n:winner.nu, b:winner.bi, v:winner.vo,
      p:pctWinner,
      bl:BLOC[winner.nu]||'Divers',
      ins:ins, i:ins, abs:abs, pctAbs:pctAbs,
      vot:vot, pctPart:pctPart,
      bla:bla, nul:nul, exp:exp,
      cands:cands
    };
  }
  
  return result;
}


/* ── Helpers couleur élec ── */
function _elecData(code,tour,mode){
  const is2015=mode.includes('15');
  const isLegis=mode.includes('legis');
  if(isLegis) return tour===1?window.LEGIS2024T1?.[code]:window.LEGIS2024T2?.[code];
  return tour===1?(is2015?elec15DataT1[code]:elecDataT1[code]):(is2015?elec15DataT2[code]:elecDataT2[code]);
}

function getElecValue(code,mode){
  const tour=mode.endsWith('-t2')?2:1;
  const d=_elecData(code,tour,mode);if(!d)return null;
  const base=mode.replace(/-t[12]$/,'').replace('15','').replace('legis','');
  if(base==='elec-abs')   return d.pctAbs;
  if(base==='elec-part')  return d.pctPart;
  if(base==='elec-rn')    return d.exp>0?((d.v['BC-RN']||0)+(d.v['BC-FN']||0)+(d.v['FN']||0)+(d.v['RN']||0)+(d.v['EXD']||0)+(d.v['REC']||0)+(d.v['UXD']||0))/d.exp*100:null;
  if(base==='elec-dvd')   return d.exp>0?((d.v['BC-DVD']||0)+(d.v['BC-DVC']||0)+(d.v['BC-DSV']||0)+(d.v['BC-LR']||0)+(d.v['BC-UD']||0)+(d.v['BC-UMP']||0)+(d.v['UD']||0)+(d.v['DVD']||0)+(d.v['LR']||0)+(d.v['ENS']||0)+(d.v['HOR']||0)+(d.v['DVC']||0)+(d.v['UDI']||0))/d.exp*100:null;
  if(base==='elec-ug')    return d.exp>0?((d.v['BC-UG']||0)+(d.v['BC-UGE']||0)+(d.v['BC-DVG']||0)+(d.v['BC-SOC']||0)+(d.v['BC-FI']||0)+(d.v['BC-COM']||0)+(d.v['BC-RDG']||0)+(d.v['BC-FG']||0)+(d.v['BC-VEC']||0)+(d.v['UG']||0)+(d.v['SOC']||0)+(d.v['DVG']||0)+(d.v['FG']||0)+(d.v['COM']||0)+(d.v['LFI']||0)+(d.v['ECO']||0)+(d.v['EXG']||0))/d.exp*100:null;
  return null;
}
window._getNuanceColor = function(nuance) {
  if (!nuance) return '#aaa';
  if (NUANCE_COLORS[nuance]) return NUANCE_COLORS[nuance];
  let hash = 0;
  for (let i = 0; i < nuance.length; i++) hash = nuance.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360}, 65%, 55%)`;
};

function getElecColor(code,mode){
  const tour=mode.endsWith('-t2')?2:1;
  const d=_elecData(code,tour,mode);if(!d)return null;
  if(mode.startsWith('elec-winner') || mode.startsWith('elec15-winner') || mode.startsWith('eleclegis-winner')) return window._getNuanceColor(d.n1);
  const val=getElecValue(code,mode);if(val===null)return null;
  const def=MAP_LAYER_DEFS[mode];if(!def?.col)return null;
  const pal=LAYER_COLORS_5[mode]||LAYER_COLORS_5[mode.replace(/-t[12]$/,'')];
  if(pal){
    const th=computeQuantileTh(mode);if(!th)return pal[2];
    let cls=th.length;for(let i=0;i<th.length;i++){if(val<=th[i]){cls=i;break;}}
    return pal[cls];
  }
  const t2=Math.min(val/(def.maxPct||40),1);
  return rgbToHex(lerpColor([235,235,235],hexToRgb(def.col),t2));
}

/* ── Section détail T1 + T2 ── */
function _elecSectionHtml(d,tourLabel,borderCol){
  if(!d)return'';
  let h=`<div style="border-left:3px solid ${borderCol};padding-left:8px;margin-bottom:10px">`;
  h+=`<div style="font-size:10px;font-weight:700;text-transform:uppercase;color:${borderCol};margin-bottom:6px">${tourLabel}</div>`;
  if(d.b1){
    h+=`<div style="background:rgba(255,255,255,.07);border-radius:5px;padding:6px 8px;margin-bottom:8px;font-size:11px"><span style="opacity:.6">🥇 Tête de liste/Binôme :</span> <strong style="color:var(--gold)">${d.b1}</strong> <span style="opacity:.5;font-size:10px">(${NUANCE_LABELS[d.n1]||d.n1||'Inconnu'} — ${d.pct1}%)</span></div>`;
  } else if (d.n1) {
    h+=`<div style="background:rgba(255,255,255,.07);border-radius:5px;padding:6px 8px;margin-bottom:8px;font-size:11px"><span style="opacity:.6">🥇 En tête :</span> <strong style="color:var(--gold)">${NUANCE_LABELS[d.n1]||d.n1}</strong> <span style="opacity:.5;font-size:10px">(${d.pct1}%)</span></div>`;
  } else {
      const gNuance = d.cands && d.cands.length > 0 ? (d.cands[0].nu || 'Inconnu') : 'Inconnu';
      const gPct = d.cands && d.cands.length > 0 ? d.cands[0].p : 0;
      h+=`<div style="background:rgba(255,255,255,.07);border-radius:5px;padding:6px 8px;margin-bottom:8px;font-size:11px"><span style="opacity:.6">🥇 En tête :</span> <strong style="color:var(--gold)">${NUANCE_LABELS[gNuance]||gNuance}</strong> <span style="opacity:.5;font-size:10px">(${gPct.toFixed(1)}%)</span></div>`;
  }
  h+=`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
    <div style="flex:1;min-width:80px;background:var(--bg);border-radius:5px;padding:6px;text-align:center">
      <div style="font-size:16px;font-weight:700;color:var(--gold)">${typeof d.pctPart === 'number' ? d.pctPart.toFixed(1) : d.pctPart}%</div>
      <div style="font-size:9px;color:var(--txt-muted)">Participation</div>
    </div>
    <div style="flex:1;min-width:80px;background:var(--bg);border-radius:5px;padding:6px;text-align:center">
      <div style="font-size:16px;font-weight:700;color:var(--txt-muted)">${typeof d.pctAbs === 'number' ? d.pctAbs.toFixed(1) : d.pctAbs}%</div>
      <div style="font-size:9px;color:var(--txt-muted)">Abstention</div>
    </div>
    <div style="flex:1;min-width:80px;background:var(--bg);border-radius:5px;padding:6px;text-align:center">
      <div style="font-size:16px;font-weight:700;color:var(--txt)">${d.ins ? d.ins.toLocaleString('fr-FR') : '—'}</div>
      <div style="font-size:9px;color:var(--txt-muted)">Inscrits</div>
    </div>
  </div>`;
  const sorted=Object.entries(d.v).sort((a,b)=>b[1]-a[1]);
  const total=d.exp||1;
  sorted.forEach(([nuance,voix])=>{
    const pct=(voix/total*100).toFixed(1);
    const col=window._getNuanceColor(nuance);
    const lbl=NUANCE_LABELS[nuance]||nuance;
    const binom=d.b?.[nuance]||'';
    const lblFull=binom?`<span title="${binom}">${lbl}</span>`:lbl;
    h+=`<div class="age-row" style="margin-bottom:4px">
      <span class="age-label" style="width:120px" title="${binom}">${lbl}</span>
      <div class="age-bar-wrap"><div class="age-bar-fill" style="width:${pct}%;background:${col}"></div></div>
      <span class="age-pct"><span>${pct}%</span><span style="font-size:9px;opacity:.65">${Math.round(voix).toLocaleString('fr-FR')}</span></span>
    </div>`;
  });
  return h+'</div>';
}
function renderElecSection(code){
  let h='';
  const d1_15=elec15DataT1[code],d2_15=elec15DataT2[code];
  if(d1_15||d2_15) {
     h+='<div class="detail-section"><div class="detail-section-title" style="margin-top:10px">🗳️ Élections Départementales 2015</div>';
     h+=_elecSectionHtml(d1_15,'Tour 1','#1a5c8f');
     h+=_elecSectionHtml(d2_15,'Tour 2','#5b3a8f');
     h+='</div>';
  }
  
  const d1=elecDataT1[code],d2=elecDataT2[code];
  if(d1||d2) {
    h+='<div class="detail-section"><div class="detail-section-title">🗳️ Élections Départementales 2021</div>';
    h+=_elecSectionHtml(d1,'Tour 1','#1a5c8f');
    h+=_elecSectionHtml(d2,'Tour 2','#5b3a8f');
    h+='</div>';
  }
  
  const d1_leg = window.LEGIS2024T1 ? window.LEGIS2024T1[code] : null;
  const d2_leg = window.LEGIS2024T2 ? window.LEGIS2024T2[code] : null;
  if(d1_leg||d2_leg) {
    h+='<div class="detail-section"><div class="detail-section-title">🗳️ Élections Législatives 2024</div>';
    h+=_elecSectionHtml(d1_leg,'Tour 1','#1a5c8f');
    h+=_elecSectionHtml(d2_leg,'Tour 2','#5b3a8f');
    h+='</div>';
  }
  
  return h;
}

LAYER_COLORS_5['elec-abs-t1']=['#f7f7f7','#cccccc','#969696','#525252','#252525'];
LAYER_COLORS_5['elec-abs-t2']=['#f7f7f7','#cccccc','#969696','#525252','#252525'];
LAYER_COLORS_5['elec-part-t1']=['#edf8e9','#bae4b3','#74c476','#31a354','#006d2c'];
LAYER_COLORS_5['elec-rn-t1']=['#E8EAF6','#9FA8DA','#5C6BC0','#283593','#0a1a5c'];
LAYER_COLORS_5['elec-dvd-t1']=['#E3F2FD','#90CAF9','#42A5F5','#1976D2','#0D47A1'];
LAYER_COLORS_5['elec-ug-t1']=['#FFEBEE','#EF9A9A','#E53935','#C62828','#7f0000'];
LAYER_COLORS_5['elec-part-t2']=['#edf8e9','#bae4b3','#74c476','#31a354','#006d2c'];
LAYER_COLORS_5['elec-rn-t2']=['#E8EAF6','#9FA8DA','#5C6BC0','#283593','#0a1a5c'];
LAYER_COLORS_5['elec-dvd-t2']=['#E3F2FD','#90CAF9','#42A5F5','#1976D2','#0D47A1'];
LAYER_COLORS_5['elec-ug-t2']=['#FFEBEE','#EF9A9A','#E53935','#C62828','#7f0000'];

['abs-t1', 'abs-t2', 'part-t1', 'part-t2', 'rn-t1', 'rn-t2', 'dvd-t1', 'dvd-t2', 'ug-t1', 'ug-t2'].forEach(s => {
  LAYER_COLORS_5['elec15-' + s] = LAYER_COLORS_5['elec-' + s];
  LAYER_COLORS_5['eleclegis-' + s] = LAYER_COLORS_5['elec-' + s];
});


/* ══ CALQUE CANTONS (overlay élec) ══ */


function triggerFileInput(id,e){
  if(e){e.stopPropagation();e.preventDefault();}
  var el=document.getElementById(id);
  if(!el)return;
  el.value='';
  el.click();
}

/* ══ CALQUE CANTONS ══ */

/* ══════════════════════════════════════════════════
   OVERLAYS CANTONS & ARRONDISSEMENTS — données pré-calculées
══════════════════════════════════════════════════ */

/* ══ ZIP IMPORT ══ */
async function handleZipImport(event){
  const file=event.target.files[0];
  if(!file)return;
  const st=document.getElementById('zipStatus');
  if(st){st.style.color='var(--txt-muted)';st.textContent='⏳ Extraction du ZIP…';}
  try{
    if(typeof JSZip==='undefined')throw new Error('JSZip non chargé');
    const zip=await JSZip.loadAsync(file);
    const files=Object.values(zip.files).filter(f=>!f.dir && !f.name.includes('__MACOSX') && !f.name.split('/').pop().startsWith('._'));
    let ok=0,skip=0;
    for(const zf of files){
      const name=zf.name.split('/').pop();
      const ext=name.split('.').pop().toLowerCase();
      if(ext==='geojson'){
        const text=await zf.async('string');
        try{
          const geo=JSON.parse(text);
          window._S = window._S || {};
          window._S.geo = geo;
          console.log('[BV] GeoJSON injecté via ZIP');
          ok++;
        }catch(e){console.error('GeoJSON parse error',e);skip++;}
        continue;
      }
      if(!['csv','xlsx','xls'].includes(ext)){skip++;continue;}
      const blob=await zf.async('blob');
      const f=new File([blob],name,{type:blob.type});
      autoDetectFile(f);
      ok++;
    }
    if(st){st.style.color='#22c55e';
      st.textContent=ok+' fichier'+(ok>1?'s':'')+' importé'+(ok>1?'s':''+(skip?' ('+skip+' ignoré'+(skip>1?'s':'')+')':''));}
  }catch(err){
    if(st){st.style.color='#ef4444';st.textContent='❌ '+err.message;}
    console.error('ZIP import error:',err);
  }
  event.target.value='';
}



// ══════════════════════════════════════════════════
// CALQUES SUPERPOSABLES (cantons, arrondissements)
// ══════════════════════════════════════════════════
let _overlayLayers = { cantons: null, arr: null, epci: null };
let _overlayActive = { cantons: false, arr: false, epci: false };

window._calqueColors = {
  canton: '#1a1a1a',
  arr: '#FF0000',
  circo: '#8E44AD',
  epci: '#1a3a6e'
};

function _getMapInstance() {
  if (typeof mobMapObj !== 'undefined' && mobMapObj) return mobMapObj;
  if (typeof mapInstance !== 'undefined' && mapInstance) return mapInstance;
  return null;
}

// Construit un GeoJSON MultiPolygon pour chaque canton/arrondissement
// en fusionnant les contours des communes via un algorithme de bordure partagée
function _buildBoundaryGeoJSON(groupKey) {
  const groups = {};
  allCommunes.forEach(function(c) {
    const key = groupKey === 'cantons' ? c.codeCanton : c.codeArr;
    const label = groupKey === 'cantons' ? c.nomCanton : c.nomArr;
    if (!key || !c.contour) return;
    if (!groups[key]) groups[key] = { label: label, coords: [] };
    const geom = c.contour;
    if (geom.type === 'Polygon') groups[key].coords.push(geom.coordinates);
    else if (geom.type === 'MultiPolygon') geom.coordinates.forEach(function(p){ groups[key].coords.push(p); });
  });

  const features = Object.entries(groups).map(function(entry) {
    const key = entry[0], g = entry[1];
    return {
      type: 'Feature',
      properties: { code: key, label: g.label },
      geometry: { type: 'MultiPolygon', coordinates: g.coords }
    };
  });
  return { type: 'FeatureCollection', features: features };
}

function toggleOverlayLayer(layerKey) {
  const map = _getMapInstance();
  if (!map) return;
  _overlayActive[layerKey] = !_overlayActive[layerKey];

  // Supprimer le calque existant
  if (layerKey === 'epci') {
    window._clearEpciOverlay && window._clearEpciOverlay();
    if (_overlayActive[layerKey]) { window._drawEpciOverlay(map); }
    return;
  }
  if (layerKey === 'cantons') {
    cantonOverlayActive = _overlayActive[layerKey];
    if (_overlayActive[layerKey]) drawCantonOverlay(); else clearCantonOverlay();
    return;
  }
  if (layerKey === 'arr') {
    window.arrOverlayActive = _overlayActive[layerKey];
    if (_overlayActive[layerKey]) window.drawArrOverlay(); else window.clearArrOverlay();
    return;
  }
  if (_overlayLayers[layerKey]) {
    map.removeLayer(_overlayLayers[layerKey]);
    _overlayLayers[layerKey] = null;
  }

  if (_overlayActive[layerKey]) {
  }
}

function toggleOverlayPanel() {
  const panel = document.getElementById('overlayPanel');
  if (!panel) return;
  const isOpen = panel.style.display !== 'none' && panel.style.display !== '';
  panel.style.display = isOpen ? 'none' : 'block';
  // Repositionner sous mapTopBar si visible
  if (!isOpen) {
    const tb = document.getElementById('mapTopBar');
    const tbH = tb ? (tb.getBoundingClientRect().bottom || 54) : 54;
    panel.style.top = (tbH + 4) + 'px';
    panel.style.position = 'fixed';
  }
}

function showOverlayBtn() {
  const btn = document.getElementById('overlayToggleBtn');
  if (btn) btn.style.display = 'block';
  const panel = document.getElementById('overlayPanel');
  if (panel) panel.style.display = 'none';
  if(typeof _mobPg!=='undefined'&&_mobPg==='carte'){
    const mmb=document.getElementById('mapMenuBtn');if(mmb)mmb.style.display='block';
  }
}

// Remettre à jour les calques si la carte est rechargée
function refreshOverlayLayers() {
  const map = _getMapInstance();
  if (!map) return;
  ['cantons','arr','epci'].forEach(function(k) {
    if (_overlayActive[k] && _overlayLayers[k]) {
      if (k === 'epci') {
        window._clearEpciOverlay && window._clearEpciOverlay();
        _overlayActive[k] = false;
        const cb = document.getElementById('overlayEPCI');
        if (cb) cb.checked = false;
        return;
      }
      map.removeLayer(_overlayLayers[k]);
      _overlayLayers[k] = null;
      _overlayActive[k] = false;
      const cb = document.getElementById(k === 'cantons' ? 'overlayCantons' : 'overlayArr');
      if (cb) cb.checked = false;
    }
  });
}




// ══ handleXlsxImport : détection auto XLSX dans ZIP ══
function handleXlsxImport(event) {
  var file = event.target.files[0];
  if (!file) return;
  var name = file.name.toLowerCase();
  
  var fakeEv = { target: { files: [file] } };
  
  const normalizedName = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  let isLegis = normalizedName.includes('legislative') || normalizedName.includes('legis') || name.includes('gisla');
  const is2015 = (name.includes('2015') || name.includes('15')) && !isLegis;
  
  if (/maire|elu|pol|conseil|municipal/.test(name)) { handlePolImport(fakeEv); return; }
  
  var r = new FileReader();
  r.onload = function(e) {
    try {
      var wb = XLSX.read(new Uint8Array(e.target.result), {type:'array'});
      var ws = wb.Sheets[wb.SheetNames[0]];
      var rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:'', blankrows:false});
      var hdrs = (rows[0]||[]).map(function(h){ return String(h).toLowerCase(); });
      var allH = rows.slice(0,6).reduce(function(a,r){ return a.concat(r); },[]).map(function(h){ return String(h).toLowerCase(); }).join(' ');
      
      const normH = allH.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (normH.includes('legislative') || normH.includes('legis') || allH.includes('gisla')) {
          isLegis = true;
      }
      const fileTypeParam = isLegis ? 'legis24' : (is2015 ? 'elec15' : 'elec21');
      
      var fakeEv2 = { target: { files: [file] } };
      if (hdrs.some(function(h){ return /nuance|binome|candidat|voix/.test(h); })) {
        if (/t2|tour.?2|2.?me.?tour|2nd.?tour/.test(name) || /t2|tour 2/.test(allH)) handleElecImport(fakeEv2, 2, fileTypeParam, rows);
        else handleElecImport(fakeEv2, 1, fileTypeParam, rows);
      } else if (hdrs.some(function(h){ return /nom|prenom|mandat|fonction/.test(h); })) {
        handlePolImport(fakeEv2);
      } else {
        if (/t2|tour.?2|2.?me.?tour|2nd.?tour/.test(name) || /t2|tour 2/.test(allH)) handleElecImport(fakeEv2, 2, fileTypeParam, rows);
        else handleElecImport(fakeEv2, 1, fileTypeParam, rows);
      }
    } catch(err) { console.warn('handleXlsxImport error', err); }
  };
  r.readAsArrayBuffer(file);
}

// ══ handleMunicipalesImport : CSV listes municipales 2026 ══
function handleMunicipalesImport(fileOrEvent) {
  var file = (fileOrEvent && fileOrEvent.target) ? fileOrEvent.target.files[0] : fileOrEvent;
  if (!file) return;
  var st = document.getElementById('municipalesStatus');
  if (st) { st.style.color = 'var(--txt-muted)'; st.textContent = '⏳ Lecture...'; }
  var r = new FileReader();
  r.onload = function(e) {
    try {
      var text = e.target.result.replace(/^﻿/,'');
      var sep = text.includes(';') ? ';' : ',';
      var lines = text.trim().split('\n');
      var headers = lines[0].split(sep).map(function(h){ return h.trim().replace(/"/g,''); });
      // Recherche robuste : exact d'abord, sinon partielle
      function colExact(k) {
        var kl=k.toLowerCase();
        var i=headers.findIndex(function(h){return h.toLowerCase()===kl;});
        if (i!==-1) return i;
        return headers.findIndex(function(h){return h.toLowerCase().includes(kl);});
      }
      var iCode     = colExact('Code INSEE');
      var iListe    = colExact('Nom de la liste');
      var iNuance   = colExact('Nuance');
      var iVoix     = colExact('Voix');
      var iPct      = colExact('% Exprimés');
      var iStatut   = colExact('Statut');
      var iTete     = colExact('Tête de liste');
      if (iTete===-1) iTete = colExact('Tete de liste');
      var iNom      = colExact('Nom');
      var iPrenom   = colExact('Prénom');
      if (iPrenom===-1) iPrenom = colExact('Prenom');
      var iInscrits = colExact('Inscrits');
      var iPartic   = colExact('Participation %');
      if (iPartic===-1) iPartic = colExact('Participation');
      if (iCode===-1||iListe===-1) throw new Error('Colonnes introuvables (Code INSEE / Nom de la liste). Headers: '+headers.slice(0,6).join(', '));
      var byCommune={}, listeMap={};
      lines.slice(1).forEach(function(line) {
        if (!line.trim()) return;
        var c=line.split(sep).map(function(x){ return x.trim().replace(/"/g,''); });
        var code=c[iCode];
        if (!code||!code.startsWith('60')) return;
        if (!byCommune[code]) { byCommune[code]={inscrits:c[iInscrits]||'',participation:c[iPartic]||'',listes:[]}; listeMap[code]={}; }
        var nomListe=c[iListe]||'';
        var estTete=iTete!==-1&&c[iTete]&&c[iTete].toUpperCase()==='OUI';
        var nom=(iNom!==-1?c[iNom]||'':'').trim();
        var prenom=(iPrenom!==-1?c[iPrenom]||'':'').trim();
        if (estTete) {
          var lo={nom:nomListe, nuance:(iNuance!==-1?c[iNuance]||'':''),
            voix:(iVoix!==-1?parseInt(c[iVoix])||0:0),
            pct:(iPct!==-1?c[iPct]||'':''),
            statut:(iStatut!==-1?c[iStatut]||'':''),
            tete:(prenom+' '+nom).trim(),
            membres:[]};
          byCommune[code].listes.push(lo); listeMap[code][nomListe]=lo;
        }
        if (nomListe) {
          if (!listeMap[code][nomListe]) {
            var ph={nom:nomListe, nuance:(iNuance!==-1?c[iNuance]||'':''),
              voix:(iVoix!==-1?parseInt(c[iVoix])||0:0),
              pct:(iPct!==-1?c[iPct]||'':''),
              statut:(iStatut!==-1?c[iStatut]||'':''),
              tete:'', membres:[]};
            byCommune[code].listes.push(ph); listeMap[code][nomListe]=ph;
          }
          // Rang = position dans le CSV (ordre naturel)
          var rang=listeMap[code][nomListe].membres.length;
          listeMap[code][nomListe].membres.push({prenom:prenom,nom:nom,tete:estTete,rang:rang});
        }
      });
      Object.keys(byCommune).forEach(function(code) {
        if (!enrichedData[code]) enrichedData[code]={};
        enrichedData[code].municipales2026=byCommune[code];
      });
      var nb=Object.keys(byCommune).length;
      if (st){st.style.color='#22c55e';st.textContent='✅ '+nb+' communes chargées';}
      if (typeof renderMobileList==='function') renderMobileList();
    } catch(err) {
      if (st){st.style.color='#ef4444';st.textContent='❌ '+err.message;}
      console.error('handleMunicipalesImport',err);
    }
  };
  r.readAsText(file,'iso-8859-1');
}

function findCommuneByLabel(label) {
  let norm = label.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\-/g," ").replace(/\'/g," ").trim();
  if (norm === "BEAUVAIS NORD" || norm === "BEAUVAIS SUD" || norm === "BEAUVAIS" || norm === "BEAUVAIS 1" || norm === "BEAUVAIS 2") norm = "BEAUVAIS";
  if (norm === "COMPIEGNE NORD" || norm === "COMPIEGNE SUD" || norm === "COMPIEGNE" || norm === "COMPIEGNE 1" || norm === "COMPIEGNE 2") norm = "COMPIEGNE";
  if (norm === "LE MONT SAINT ADRIEN") norm = "MONT SAINT ADRIEN";

  for (let i=0; i<allCommunes.length; i++) {
      let c = allCommunes[i];
      if (!c.nom) continue;
      let cNorm = c.nom.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\-/g," ").replace(/\'/g," ").trim();
      let matchName = norm.replace(/\-/g," ");
      if (cNorm === matchName || cNorm === norm) return c;
  }
  return null;
}

function handlePassPermisImport(event) {
    const file = event.target ? event.target.files[0] : null;
    if (!file) return;
    const st = document.getElementById('passPermisStatus');
    if (st) st.textContent = '⏳ Lecture…';
    
    const r = new FileReader();
    r.onload = e => {
       try {
           const lines = e.target.result.split(/\r?\n/).filter(l => l.trim());
           for (let i = 0; i < lines.length; i++) {
               const parts = lines[i].split(';');
               if (parts.length < 18) continue;
               
               let communeName = parts[1].trim();
               if (!communeName || communeName.startsWith("Total")) continue;
               
               let commune = findCommuneByLabel(communeName);
               if (commune) {
                   const code = commune.code;
                   if (!enrichedData[code]) enrichedData[code] = {};
                   if (!enrichedData[code].passPermis) enrichedData[code].passPermis = { acceptes: 0, payes: 0, total: 0 };
                   
                   enrichedData[code].passPermis.acceptes += parseInt(parts[4]) || 0;
                   enrichedData[code].passPermis.payes += parseInt(parts[13]) || 0;
                   enrichedData[code].passPermis.total += parseInt(parts[18]) || 0;
               }
           }
           if (st) st.textContent = `✅ Bilan Pass Permis chargé`;
           window.analyseShowPassPermis = true; 
           if (typeof renderAnalyseHome === 'function') renderAnalyseHome(); if (document.getElementById('oiseSummaryContent') && document.getElementById('oiseSummaryContent').style.display === 'block') { document.getElementById('oiseSummaryContent').style.display = 'none'; toggleOiseSummary(); } if (document.getElementById('cantonSummary') && document.getElementById('cantonSummary').classList.contains('visible') && typeof window.currentCantonCode !== 'undefined' && window.currentCantonCode) { showCantonSummary(window.currentCantonCode); }
           const oc = document.querySelector('.detail-panel.open')?.dataset?.code; if(oc) openDetail(oc);
       } catch(err) {
           if (st) st.textContent = '⚠️ ' + err.message;
       }
       if(event.target) event.target.value='';
    };
    r.readAsText(file, 'windows-1252');
}

function handlePassAvenirImport(event) {
    const file = event.target ? event.target.files[0] : null;
    if (!file) return;
    const st = document.getElementById('passAvenirStatus');
    if (st) st.textContent = '⏳ Lecture…';
    
    const r = new FileReader();
    r.onload = e => {
       try {
           const lines = e.target.result.split(/\r?\n/).filter(l => l.trim());
           for (let i = 0; i < lines.length; i++) {
               const parts = lines[i].split(';');
               if (parts.length < 3) continue;
               let communeName = parts[1].trim();
               if (!communeName || communeName.startsWith("CANTON") || communeName.startsWith("Total") || parts[0].startsWith("PASS AVENIR")) continue;
               
               let commune = findCommuneByLabel(communeName);
               if (commune) {
                   const code = commune.code;
                   if (!enrichedData[code]) enrichedData[code] = {};
                   if (!enrichedData[code].passAvenir) enrichedData[code].passAvenir = { enregistrements: 0, acceptes: 0 };
                   
                   enrichedData[code].passAvenir.enregistrements += parseInt(parts[2]) || 0;
                   enrichedData[code].passAvenir.acceptes += parseInt(parts[3]) || 0;
               }
           }
           if (st) st.textContent = `✅ Bilan Pass Avenir chargé`;
           window.analyseShowPassAvenir = true;
           if (typeof renderAnalyseHome === 'function') renderAnalyseHome(); if (document.getElementById('oiseSummaryContent') && document.getElementById('oiseSummaryContent').style.display === 'block') { document.getElementById('oiseSummaryContent').style.display = 'none'; toggleOiseSummary(); } if (document.getElementById('cantonSummary') && document.getElementById('cantonSummary').classList.contains('visible') && typeof window.currentCantonCode !== 'undefined' && window.currentCantonCode) { showCantonSummary(window.currentCantonCode); }
           const oc = document.querySelector('.detail-panel.open')?.dataset?.code; if (oc) openDetail(oc);
       } catch(err) {
           if (st) st.textContent = '⚠️ ' + err.message;
       }
       if(event.target) event.target.value='';
    };
    r.readAsText(file, 'windows-1252');
}

function autoDetectFile(file) {
  if (!file) return;
  var ext = file.name.split('.').pop().toLowerCase();
  var fname = file.name.toLowerCase();
  var fakeEvent = { target: { files: [file] } };

  let normFname = fname.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (normFname.includes('bilan') && (normFname.includes('beneficiaire') || normFname.includes('citoyen') || normFname.includes('avenir') || fname.includes('fic') || fname.includes('bnficiaires') || fname.includes('bénéf') || normFname.includes('benef') || normFname.includes('ficiaire'))) {
    handlePassAvenirImport(fakeEvent);
    return;
  }
  if (normFname.includes('bilan') && (normFname.includes('permis') || fname.includes('permis'))) {
    handlePassPermisImport(fakeEvent);
    return;
  }
  // Also fallback if just bilan is present but we can't figure it out, prefer permis or check columns later?
  // Let's just assume we caught it. If 'bilan' is alone, we can check 'permis' to be safe.
  if (normFname.includes('bilan') && !normFname.includes('ficiaire') && !normFname.includes('benef')) {
    handlePassPermisImport(fakeEvent);
    return;
  }

  if (ext === 'geojson') {
    var reader = new FileReader();
    reader.onload = function(e){
      try {
        var geo = JSON.parse(e.target.result);
        window._S = window._S || {};
        window._S.geo = geo;
        var st=document.getElementById('zipStatus');
        if(st){st.style.color='#22c55e';st.textContent='✅ BV GeoJSON chargé';}
        console.log('[BV] GeoJSON injecté via autoDetectFile');
      } catch(ex){console.error('BV GeoJSON invalid', ex);}
    };
    reader.readAsText(file);
    return;
  }
  if (ext === 'zip') {
    handleZipImport(fakeEvent);
  } else if (ext === 'csv' || ext === 'txt') {
    if (/municipal|liste.?gagnante|liste.?munic/.test(fname)) {
      handleMunicipalesImport(file);
    } else if (/t1|t2|tour|resultats|élection|election|legis|gisla/.test(fname)) {
      handleXlsxImport(fakeEvent);
    } else {
      handleFileImport(fakeEvent);
    }
  } else if (ext === 'xlsx' || ext === 'xls') {
    handleXlsxImport(fakeEvent);
  }
}





// Gestion orientation paysage — actif seulement sur la carte





function closeLandscapeToHome() {
  mobGoHome();
}


// ── PANNEAU CALQUES ───────────────────────────────────
var cantonOverlayLayers = [];
var cantonOverlayActive = false;

function clearCantonOverlay() {
  var _m = _getMapInstance();
  cantonOverlayLayers.forEach(function(l){try{if(_m)_m.removeLayer(l);}catch(e){}});
  cantonOverlayLayers = [];
}

var cantonGeoJSONCache = null;

function drawCantonOverlay() {
  if (!_getMapInstance()) return;
  clearCantonOverlay();
  if (cantonGeoJSONCache) {
    _renderCantonOverlay(cantonGeoJSONCache);
  } else {
    if (typeof CACHE_CANTON_GEO !== 'undefined') {
      cantonGeoJSONCache = CACHE_CANTON_GEO;
      if (cantonOverlayActive) _renderCantonOverlay(CACHE_CANTON_GEO);
    } else {
      console.warn('Fetch cantons échoué, fallback communes');
      if (cantonOverlayActive) _renderCantonFallback();
    }
  }
}

function _renderCantonOverlay(gj) {
  var _m = _getMapInstance();
  if (!_m) return;
  clearCantonOverlay();
  var strokeCol = window._calqueColors.canton;
  gj.features.forEach(function(feature) {
    var geoCode = feature.properties.code; // ex: "60001"
    var atlasCode = geoCode[0] + geoCode.slice(2); // "6001"
    var col = cantonColor(atlasCode);
    var name = CANTON_NAMES[atlasCode] || feature.properties.nom || atlasCode;
    var lyr = L.geoJSON(feature, {
      style: {color: strokeCol, weight: 3, fill: false, opacity: 0.85}
    });
    lyr.bindTooltip('<strong>' + name + '</strong>', {sticky: true, className: 'epci-tip'});
    lyr.addTo(_m);
    cantonOverlayLayers.push(lyr);
  });
}

function toggleCalque(type, active) {
  if (type === 'canton') {
    cantonOverlayActive = active;
    if (active) drawCantonOverlay(); else clearCantonOverlay();
  }
  if (type === 'cheflieu') {
    chefLieuActive = active;
    if (active) drawChefLieu(); else clearChefLieu();
  }
  if (type === 'circo') { window.circoOverlayActive = active; if (active) window.drawCircoOverlay(); else window.clearCircoOverlay(); }
  if (type === 'epci') {
    if (typeof _overlayActive !== 'undefined') _overlayActive['epci'] = active;
    if (active) window._drawEpciOverlay(_getMapInstance());
    else window._clearEpciOverlay && window._clearEpciOverlay();
  }
}

function initCalquesControl() {
  if (document.getElementById('pcCalquesBtn')) return;
  var wrap = document.querySelector('.pc-map-wrap');
  if (!wrap) return;
  var div = document.createElement('div');
  div.className = 'pc-calques-wrap';
  div.id = 'pcCalquesWrap';
  div.innerHTML =
    '<button class="pc-calques-btn" id="pcCalquesBtn">🗂 Calques</button>' +
    '<div class="pc-calques-panel" id="pcCalquesPanel">' +
      '<div class="pc-calques-title">Calques</div>' +
      '<div class="pc-calques-row">' +
        '<div class="pc-calques-lbl">Communautés de communes</div>' +
        '<div style="display:flex;align-items:center;gap:6px">' +
          '<input type="color" id="colorEpci" value="' + window._calqueColors.epci + '" class="pc-color-input">' +
          '<label class="pc-toggle"><input type="checkbox" id="toggleEpci"><span class="pc-toggle-slider"></span></label>' +
        '</div>' +
      '</div>' +
      '<div class="pc-calques-row">' +
        '<div class="pc-calques-lbl">Contours Cantons</div>' +
        '<div style="display:flex;align-items:center;gap:6px">' +
          '<input type="color" id="colorCanton" value="' + window._calqueColors.canton + '" class="pc-color-input">' +
          '<label class="pc-toggle"><input type="checkbox" id="toggleCanton"><span class="pc-toggle-slider"></span></label>' +
        '</div>' +
      '</div>' +
      '<div class="pc-calques-row">' +
        '<div class="pc-calques-lbl">Circonscriptions législatives</div>' +
        '<div style="display:flex;align-items:center;gap:6px">' +
          '<input type="color" id="colorCirco" value="' + window._calqueColors.circo + '" class="pc-color-input">' +
          '<label class="pc-toggle"><input type="checkbox" id="toggleCirco"><span class="pc-toggle-slider"></span></label>' +
        '</div>' +
      '</div>' +
      '<div class="pc-calques-row">' +
        '<div class="pc-calques-lbl">Communes principales</div>' +
        '<label class="pc-toggle"><input type="checkbox" id="toggleChefLieu"><span class="pc-toggle-slider"></span></label>' +
      '</div>' +
    '</div>';
  wrap.appendChild(div);
  div.querySelector('#pcCalquesBtn').addEventListener('click', function(e) {
    e.stopPropagation();
    document.getElementById('pcCalquesPanel').classList.toggle('open');
  });
  div.querySelector('#toggleCanton').addEventListener('change', function() {
    toggleCalque('canton', this.checked);
  });
  div.querySelector('#toggleChefLieu').addEventListener('change', function() {
    toggleCalque('cheflieu', this.checked);
  });
  div.querySelector('#toggleCirco').addEventListener('change', function() {
    toggleCalque('circo', this.checked);
  });
  div.querySelector('#toggleEpci').addEventListener('change', function() {
    toggleCalque('epci', this.checked);
  });
  document.addEventListener('click', function(e) {
    if (!e.target.closest('#pcCalquesWrap')) {
      var p = document.getElementById('pcCalquesPanel');
      if (p) p.classList.remove('open');
    }
  });

  // Color listeners
  div.querySelector('#colorCanton').addEventListener('input', function() {
    window._calqueColors.canton = this.value;
    if (typeof cantonOverlayActive !== 'undefined' && cantonOverlayActive) drawCantonOverlay();
  });
  div.querySelector('#colorCirco').addEventListener('input', function() {
    window._calqueColors.circo = this.value;
    if (window.circoOverlayActive) window.drawCircoOverlay();
  });
  div.querySelector('#colorEpci').addEventListener('input', function() {
    window._calqueColors.epci = this.value;
    if (typeof _overlayActive !== 'undefined' && _overlayActive['epci']) window._drawEpciOverlay(_getMapInstance());
  });
  // Slider opacité dans le panneau calques PC
  var opRow = document.createElement('div');
  opRow.className = 'pc-opacity-row';
  opRow.innerHTML =
    '<div class="pc-opacity-row-label">◐ Opacité des polygones</div>' +
    '<div style="display:flex;align-items:center;gap:8px">' +
      '<input type="range" id="pcOpacitySlider" min="5" max="100" value="82">' +
      '<span id="pcOpacityVal" style="font-size:11px;color:var(--gold,#d4a843);font-weight:700;min-width:32px;text-align:right">82%</span>' +
    '</div>';
  document.getElementById('pcCalquesPanel').appendChild(opRow);
  document.getElementById('pcOpacitySlider').addEventListener('input', function() {
    var val = parseInt(this.value);
    var grad = 'linear-gradient(to right,#d4a843 ' + val + '%,rgba(255,255,255,.15) ' + val + '%)';
    this.style.background = grad;
    document.getElementById('pcOpacityVal').textContent = val + '%';
    setPolygonOpacity(val / 100);
    var mob = document.getElementById('mobOpacitySlider');
    if (mob) { mob.value = val; mob.style.background = grad; }
    var lbl = document.getElementById('mobOpacityVal');
    if (lbl) lbl.textContent = val + '%';
  });
}
// ─────────────────────────────────────────────────────

function _renderCantonFallback() {
  if (!mapInstance) return;
  clearCantonOverlay();
  var groups = {};
  allCommunes.forEach(function(c) {
    if (!c.contour || !c.codeCanton) return;
    if (!groups[c.codeCanton]) groups[c.codeCanton] = [];
    groups[c.codeCanton].push({type:'Feature',geometry:c.contour,properties:{}});
  });
  Object.keys(groups).forEach(function(canton) {
    var col = cantonColor(canton);
    var lyr = L.geoJSON({type:'FeatureCollection',features:groups[canton]},{
      style:{color:window._calqueColors.canton,weight:3,fill:false,opacity:0.85}
    });
    lyr.bindTooltip('<strong>'+(CANTON_NAMES[canton]||canton)+'</strong>',{sticky:true,className:'epci-tip'});
    lyr.addTo(mapInstance);
    cantonOverlayLayers.push(lyr);
  });
}

// ── COMMUNES PRINCIPALES PAR CANTON ───────────────────
var chefLieuMarkers = [];
var chefLieuActive = false;

function clearChefLieu() {
  chefLieuMarkers.forEach(function(m){ try{ mapInstance.removeLayer(m); }catch(e){} });
  chefLieuMarkers = [];
}

function drawChefLieu() {
  if (!mapInstance) return;
  clearChefLieu();
  // Trouver la commune dont le nom correspond au nom du canton
  var byCantonChef = {};
  allCommunes.forEach(function(c) {
    if (!c.codeCanton) return;
    var cantonNom = CANTON_NAMES[c.codeCanton] || '';
    // Correspondance exacte ou le nom de la commune est contenu dans le nom du canton
    var nomNorm = c.nom.toLowerCase().replace(/-/g,' ');
    var cantonNorm = cantonNom.toLowerCase().replace(/-/g,' ');
    if (cantonNorm.indexOf(nomNorm) !== -1 || nomNorm.indexOf(cantonNorm) !== -1) {
      // Priorité à la correspondance la plus proche (la plus courte)
      if (!byCantonChef[c.codeCanton] || c.nom.length < byCantonChef[c.codeCanton].nom.length) {
        byCantonChef[c.codeCanton] = c;
      }
    }
  });
  // Fallback : si aucune correspondance, prendre la plus peuplée
  allCommunes.forEach(function(c) {
    if (!c.codeCanton || byCantonChef[c.codeCanton]) return;
    if (!byCantonChef[c.codeCanton] || c.population > byCantonChef[c.codeCanton].population) {
      byCantonChef[c.codeCanton] = c;
    }
  });
  Object.keys(byCantonChef).forEach(function(canton) {
    var c = byCantonChef[canton];
    var lat, lng;
    // Priorité : centre de la commune
    if (c.centre && c.centre.coordinates) {
      lng = c.centre.coordinates[0];
      lat = c.centre.coordinates[1];
    } else if (c.contour) {
      // Calculer le centroïde approximatif depuis le contour
      var coords = [];
      function collectCoords(geom) {
        if (!geom) return;
        if (geom.type === 'Polygon') coords = coords.concat(geom.coordinates[0]);
        else if (geom.type === 'MultiPolygon') geom.coordinates.forEach(function(p){ coords = coords.concat(p[0]); });
      }
      collectCoords(c.contour);
      if (coords.length) {
        var sumLng = 0, sumLat = 0;
        coords.forEach(function(pt){ sumLng += pt[0]; sumLat += pt[1]; });
        lng = sumLng / coords.length;
        lat = sumLat / coords.length;
      }
    }
    if (!lat || !lng) return;
    var icon = L.divIcon({
      className: '',
      html: '<div class="chef-lieu-marker"><span class="chef-lieu-pin">📍</span><span class="chef-lieu-name">' + c.nom + '</span></div>',
      iconAnchor: [10, 28]
    });
    var mk = L.marker([lat, lng], {icon: icon});
    mk.addTo(mapInstance);
    chefLieuMarkers.push(mk);
  });
}
function togglePcLayerBar() {
  const content = document.getElementById("pcLayerBarContent");
  const toggle = document.getElementById("pcLayerToggle");
  if(content.style.display === "none") {
    content.style.display = "block";
    toggle.innerHTML = '<span style="color:#D4A843; font-weight:bold; font-size:16px; line-height:1;">−</span>';
  } else {
    content.style.display = "none";
    toggle.innerHTML = '<span style="color:#D4A843; font-weight:bold; font-size:16px; line-height:1;">+</span>';
  }
}

function toggleMobLayerBar() {
  const content = document.getElementById("mobLayerBarContent");
  const toggle = document.getElementById("mobLayerToggle");
  if(content.style.display === "none") {
    content.style.display = "block";
    toggle.innerHTML = '<span style="color:#D4A843; font-weight:bold; font-size:16px; line-height:1;">−</span>';
  } else {
    content.style.display = "none";
    toggle.innerHTML = '<span style="color:#D4A843; font-weight:bold; font-size:16px; line-height:1;">+</span>';
  }
}

// ─────────────────────────────────────────────────────
// START
init();

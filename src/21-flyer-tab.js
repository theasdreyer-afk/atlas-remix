
(function() {
  // Styles for the Flyer Generator
  const styles = `
    .flyer-tab-content {
      max-width: 1200px;
      margin: 0 auto;
    }
    .flyer-step-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 24px;
      transition: all 0.3s ease;
      position: relative;
    }
    .flyer-step-card:hover {
      border-color: rgba(212, 168, 67, 0.4);
      transform: translateY(-2px);
    }
    .flyer-step-card::before {
      position: absolute;
      top: 0;
      right: 0;
      background: var(--gold);
      color: #ffffff;
      font-size: 10px;
      font-weight: 900;
      padding: 4px 12px;
      border-bottom-left-radius: 8px;
      border-top-right-radius: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .flyer-step-1::before { content: 'Étape 1'; }
    .flyer-step-2::before { content: 'Étape 2'; }
    .flyer-step-3::before { content: 'Étape 3'; }
    .flyer-selection-card {
      background: linear-gradient(145deg, var(--surface) 0%, rgba(212, 168, 67, 0.05) 100%);
      border-left: 4px solid var(--gold);
    }
    .flyer-step-title {
      font-size: 1.2rem;
      font-weight: bold;
      color: var(--gold);
      margin-bottom: 15px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .flyer-mapping-list {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      gap: 10px;
      margin-top: 15px;
    }
    .flyer-mapping-item {
      background: var(--bg);
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 0.85rem;
      border: 1px solid var(--border);
      border-left: 3px solid var(--gold);
    }
    .flyer-commune-selector {
      display: flex;
      flex-direction: column;
      gap: 15px;
    }
    .flyer-commune-list {
      max-height: 300px;
      overflow-y: auto;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--bg);
    }
    .flyer-commune-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--border);
      cursor: pointer;
    }
    .flyer-commune-item:hover {
      background: var(--border);
    }
    .flyer-preview-area {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 20px;
    }
    #flyerSvgPreview {
      max-width: 100%;
      height: auto;
      border: 1px solid var(--border);
      background: #fff; /* SVG background should be visible */
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
      border-radius: 4px;
      overflow: hidden;
    }
    #flyerSvgPreview svg {
      width: 100%;
      height: auto;
      display: block;
      max-height: 80vh;
    }
    .flyer-nav {
      display: flex;
      gap: 10px;
      align-items: center;
    }
    .flyer-exports {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      justify-content: center;
      margin-top: 20px;
    }
    .flyer-search-bar {
      display: flex;
      gap: 10px;
    }
    .flyer-search-input {
      flex: 1;
      padding: 10px;
      border-radius: 6px;
      background: var(--bg);
      border: 1px solid var(--border);
      color: var(--txt);
    }
    .flyer-filter-select {
      padding: 10px;
      border-radius: 6px;
      background: var(--bg);
      border: 1px solid var(--border);
      color: var(--txt);
    }
    #flyerLoadingOverlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.8);
      z-index: 10000;
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: var(--txt);
    }
    .flyer-spinner {
      border: 4px solid var(--border);
      border-top-color: var(--gold);
      border-radius: 50%;
      width: 40px; height: 40px;
      animation: flyer-spin 1s linear infinite;
      margin-bottom: 15px;
    }
    @keyframes flyer-spin {
      to { transform: rotate(360deg); }
    }
  `;

  // Inject styles
  const styleEl = document.createElement('style');
  styleEl.textContent = styles;
  document.head.appendChild(styleEl);

  let currentSvgTemplate = "";
  let detectedTags = [];
  let tagOffsets = {}; 
  let selectedCommunes = new Set();
  let flyerCommunesData = {}; 
  let currentPreviewIndex = 0;

  const MAPPING_DEFAULTS = {
    NOM_COMMUNE: "nom",
    CANTON: "canton",
    POPULATION: "population",
    PARTICIPATION_2021: "participation_t1_2021",
    SCORE_GAUCHE: "score_gauche_t1_2021",
    SCORE_DROITE: "score_droite_t1_2021",
    CSP_OUVRIERS: "csp_ouvriers",
    REVENU_MEDIAN: "revenu_median",
    DATE_GENERATION: null
  };

  /**
   * Smarter tag resolver that can handle variations like "participation 2021 t1" or "participation t2 2024"
   */
  function resolveDynamicTag(tag, commune) {
    const t = tag.toUpperCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    
    // Explicit mapping overrides
    if (MAPPING_DEFAULTS[tag] && commune[MAPPING_DEFAULTS[tag]] !== undefined) {
      return formatValue(commune[MAPPING_DEFAULTS[tag]], MAPPING_DEFAULTS[tag]);
    }

    // Special: Date
    if (t === 'DATE GENERATION' || t === 'DATE_GENERATION' || t === 'DATE') {
      return new Date().toLocaleDateString('fr-FR');
    }

    // Basic Commune Info
    if (t.match(/\bNOM\b|\bCOMMUNE\b/)) return commune.nom;
    if (t.match(/\bCANTON\b/)) return commune.canton || commune.nomCanton;
    if (t.match(/\bPOPULATION\b/)) return formatValue(commune.population, 'population');
    if (t.match(/\bCODE\b/)) return commune.code || "";

    // Election Results
    const yearMatch = t.match(/2015|2021|2024/);
    const turnMatch = t.match(/T1|T2|TOUR 2|2EME TOUR|SECOND TOUR|DEUXIEME TOUR/);
    
    let year = yearMatch ? yearMatch[0] : "2021"; // Default to 2021 if not specified
    let turn = "t1";
    if (turnMatch) {
       const tm = turnMatch[0];
       if (tm.includes("2") || tm.includes("SECOND") || tm.includes("2EME") || tm.includes("DEUXIEME")) turn = "t2";
    }

    const elecKey = `elec${year}${turn}`;
    const d = commune[elecKey];

    if (t.includes("PARTICIPATION")) {
      return d ? formatValue(d.pctPart, 'participation') : "-";
    }
    if (t.includes("ABSTENTION")) {
      return d ? formatValue(d.pctAbs, 'participation') : "-";
    }

    // Score / Voix
    if (t.includes("SCORE") || t.includes("VOIX") || t.includes("PCT") || t.includes("PERCENT") || t.includes("RN") || t.includes("GAUCHE") || t.includes("DROITE")) {
      if (!d) return "-";
      let val = null;
      if (t.match(/RN|NATIONAL|EXD|LE PEN|BARDELLA|UXD/)) {
        val = ((d.v?.['BC-RN']||0)+(d.v?.['BC-FN']||0)+(d.v?.['FN']||0)+(d.v?.['RN']||0)+(d.v?.['EXD']||0)+(d.v?.['REC']||0)+(d.v?.['UXD']||0))/d.exp*100;
      } else if (t.match(/GAUCHE|NFP|UG|UGE|FI|MELENCHON|SOCIALISTE|DVG|SOC|EXG/)) {
        val = ((d.v?.['BC-UG']||0)+(d.v?.['BC-UGE']||0)+(d.v?.['BC-DVG']||0)+(d.v?.['BC-SOC']||0)+(d.v?.['BC-FI']||0)+(d.v?.['BC-COM']||0)+(d.v?.['BC-RDG']||0)+(d.v?.['BC-FG']||0)+(d.v?.['BC-VEC']||0)+(d.v?.['UG']||0)+(d.v?.['SOC']||0)+(d.v?.['DVG']||0)+(d.v?.['FG']||0)+(d.v?.['COM']||0)+(d.v?.['LFI']||0)+(d.v?.['ECO']||0)+(d.v?.['EXG']||0))/d.exp*100;
      } else if (t.match(/DROITE|LR|UMP|DVD|UD|DVC|CENTRE|ENS|MACRON|HOR/)) {
        val = ((d.v?.['BC-DVD']||0)+(d.v?.['BC-DVC']||0)+(d.v?.['BC-DSV']||0)+(d.v?.['BC-LR']||0)+(d.v?.['BC-UD']||0)+(d.v?.['BC-UMP']||0)+(d.v?.['UD']||0)+(d.v?.['DVD']||0)+(d.v?.['LR']||0)+(d.v?.['ENS']||0)+(d.v?.['HOR']||0)+(d.v?.['DVC']||0)+(d.v?.['UDI']||0))/d.exp*100;
      }
      return val !== null && !isNaN(val) ? formatValue(val, 'score') : "-";
    }

    // CSP
    if (t.includes("CSP") || t.includes("OUVRIER") || t.includes("CADRE") || t.includes("AGRI") || t.includes("ARTISAN") || t.includes("EMPLOYE")) {
       const emp = commune.emploi;
       if (!emp) return "-";
       const total = Object.values(emp).reduce((a,b)=>a+b, 0);
       if (total === 0) return "0 %";

       let count = 0;
       if (t.includes("OUVRIER")) count = emp['Ouvriers'];
       else if (t.includes("EMPLOYE")) count = emp['Employés'];
       else if (t.includes("CADRE")) count = emp['Cadres'];
       else if (t.includes("AGRI")) count = emp['Agriculteurs'];
       else if (t.includes("ARTISAN")) count = emp['Artisans/Comm.'];
       else if (t.includes("INTERM")) count = emp['Prof. interm.'];

       return formatValue((count || 0) / total * 100, 'csp');
    }

    // Direct property or IRIS
    if (commune[tag] !== undefined) return formatValue(commune[tag], tag);
    if (commune[tag.toLowerCase()] !== undefined) return formatValue(commune[tag.toLowerCase()], tag);
    
    // Check IRIS DISP_ headers if any (for income)
    const irisKey = Object.keys(commune).find(k => k.includes(tag) || tag.includes(k));
    if (irisKey && typeof commune[irisKey] === 'number') return formatValue(commune[irisKey], irisKey);

    return null;
  }

  function interpretTag(tag) {
    const t = tag.toUpperCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    if (t === 'DATE GENERATION' || t === 'DATE') return "Date du jour";
    if (t.match(/\bNOM\b|\bCOMMUNE\b/)) return "Nom de la commune";
    if (t.match(/\bCANTON\b/)) return "Canton";
    if (t.match(/\bPOPULATION\b/)) return "Population (Insee)";

    const yearMatch = t.match(/2015|2021|2024/);
    const turnMatch = t.match(/T1|T2|TOUR 1|TOUR 2|1ER TOUR|2EME TOUR|SECOND TOUR|DEUXIEME TOUR/);
    let year = yearMatch ? yearMatch[0] : "2021";
    let turn = turnMatch && (turnMatch[0].includes("2") || turnMatch[0].includes("SECOND") || turnMatch[0].includes("DEUXIEME")) ? "Tour 2" : "Tour 1";

    if (t.includes("PARTICIPATION")) return `Participation ${year} (${turn})`;
    if (t.includes("ABSTENTION")) return `Abstention ${year} (${turn})`;
    if (t.includes("RN") || t.match(/NATIONAL|LE PEN|BARDELLA/)) return `Score RN ${year} (${turn})`;
    if (t.includes("GAUCHE") || t.match(/NFP|MELENCHON/)) return `Score Gauche/NFP ${year} (${turn})`;
    if (t.includes("DROITE") || t.match(/LR|MACRON|ENS/)) return `Score Droite/Centre ${year} (${turn})`;

    if (t.match(/OUVRIER|CADRE|AGRI|EMPLOYE|ARTISAN/)) return `Données CSP (${t})`;

    return MAPPING_DEFAULTS[tag] ? `Défaut: ${MAPPING_DEFAULTS[tag]}` : "Inconnu (ou direct)";
  }

  window.initFlyerGenerator = function(communesData) {
    flyerCommunesData = communesData;
    
    // Don't re-render whole layout if already there
    const container = document.getElementById('flyerContent');
    if (container && container.innerHTML.trim() !== "") {
      updateCommuneList();
      return;
    }
    
    renderFlyerLayout();
  };

  function renderFlyerLayout() {
    const container = document.getElementById('flyerContent');
    if (!container) return;

    // Use current search/filter if they exist (though innerHTML will wipe them)
    // Actually innerHTML wipes them, but we want to avoid wipes if possible.
    // The initFlyerGenerator check above handles this now.

    container.innerHTML = `
      <div class="flyer-tab-content">
        <!-- STEP 1 -->
        <div class="flyer-step-card flyer-step-1">
          <div class="flyer-step-title"><span>1.</span> Chargement du template SVG</div>
          <div style="display:flex; flex-direction:column; gap:10px;">
            <p style="font-size:0.9rem; opacity:0.8;">Sélectionnez un fichier SVG contenant des balises de type {{NOM_VARIABLE}}.</p>
            <div id="illustratorHelp" style="background:rgba(212,168,67,0.1); border-left: 3px solid var(--gold); padding:10px; font-size:0.8rem; margin-bottom:10px;">
              <strong>Conseil Adobe Illustrator :</strong> Lors de l'export, assurez-vous que le texte n'est pas "vectorisé" (choisissez SVG dans Type de police) et que les balises ne sont pas coupées.
            </div>
            <input type="file" id="flyerSvgInput" accept=".svg" class="btn btn-outline" style="padding:10px;">
          </div>
        </div>

        <!-- STEP 2 -->
        <div class="flyer-step-card flyer-selection-card flyer-step-2">
          <div class="flyer-step-title"><span>2.</span> Sélection des communes</div>
          <div class="flyer-commune-selector">
            <div class="flyer-search-bar">
              <input type="text" id="flyerSearch" class="flyer-search-input" placeholder="🔍 Rechercher une commune...">
              <select id="flyerCantonFilter" class="flyer-filter-select">
                <option value="">Tous les cantons</option>
              </select>
            </div>
            <div style="display:flex; gap:10px;">
              <button class="btn btn-sm" onclick="FlyerTab.selectAll()">Tout sélectionner</button>
              <button class="btn btn-sm btn-outline" onclick="FlyerTab.deselectAll()">Désélectionner tout</button>
            </div>
            <div class="flyer-commune-list" id="flyerCommuneList"></div>
            <div style="font-size:0.85rem; opacity:0.7;" id="flyerSelectionCount">0 commune sélectionnée</div>
          </div>
        </div>

        <!-- STEP 3 -->
        <div class="flyer-step-card flyer-step-3">
          <div class="flyer-step-title"><span>3.</span> Prévisualisation et export</div>
          
          <div id="flyerTagStatus" style="display:none; margin-bottom:20px; background:var(--surface); padding:16px; border-radius:8px; border:1px solid rgba(212,168,67,0.2);">
            <div style="font-weight:bold; margin-bottom:12px; color:var(--gold); display:flex; align-items:center; gap:8px; font-size:0.95rem;">
              <span>🎯 Ajustement fin des positions</span>
              <span style="flex:1"></span>
              <button class="btn btn-xs btn-outline" onclick="FlyerTab.resetAllOffsets()" style="font-size:10px; height:22px;">Tout réinitialiser</button>
            </div>
            <div class="flyer-mapping-list" id="flyerMappedTags"></div>
          </div>

          <div class="flyer-preview-area">
            <div class="flyer-nav">
              <button class="btn btn-sm btn-circle" onclick="FlyerTab.prevPreview()">❮</button>
              <span id="flyerCurrentPreviewName" style="font-weight:bold; min-width:200px; text-align:center;">-</span>
              <button class="btn btn-sm btn-circle" onclick="FlyerTab.nextPreview()">❯</button>
            </div>
            <div id="flyerPreviewContainer" style="width:100%; display:flex; justify-content:center;">
              <div id="flyerPreviewEmpty" style="padding:40px; background:var(--bg); border-radius:8px; border:2px dashed var(--border); text-align:center;">
                Attente d'un template et de communes sélectionnées...
              </div>
              <div id="flyerSvgPreview" style="display:none;"></div>
            </div>

            <div class="flyer-exports">
              <select id="flyerExportRes" class="search-input" style="width:auto; padding: 6px 10px; border-radius: 4px; background: var(--bg); color: var(--txt); border: 1px solid var(--border);">
                <option value="fhd">Format Full HD (1080x1920)</option>
                <option value="a4">Format A4 Print (300dpi)</option>
                <option value="square">Format Carré Insta (1080x1080)</option>
                <option value="4k">Format 4K (2160x3840)</option>
                <option value="native">Format Natif du SVG</option>
              </select>
              <button class="btn btn-gold" onclick="FlyerTab.downloadSVG()">⬇ SVG</button>
              <button class="btn btn-gold" onclick="FlyerTab.downloadPNG()">🖼 PNG</button>
              <button class="btn btn-gold" style="background:#7c3aed" onclick="FlyerTab.downloadZIP()">📦 ZIP (SVG)</button>
              <button class="btn btn-gold" style="background:#4f46e5" onclick="FlyerTab.downloadZIPPNG()">📦 ZIP (PNG)</button>
            </div>
          </div>
        </div>
      </div>

      <div id="flyerLoadingOverlay">
        <div class="flyer-spinner"></div>
        <div id="flyerLoadingMsg">Traitement en cours...</div>
      </div>
    `;

    // Bind events
    document.getElementById('flyerSvgInput').onchange = handleSvgLoad;
    document.getElementById('flyerSearch').oninput = updateCommuneList;
    document.getElementById('flyerCantonFilter').onchange = updateCommuneList;

    // Fill cantons
    const cantonSelect = document.getElementById('flyerCantonFilter');
    const cantons = [...new Set(Object.values(flyerCommunesData).map(c => c.canton))].sort();
    cantons.forEach(ct => {
      const opt = document.createElement('option');
      opt.value = ct; opt.textContent = ct;
      cantonSelect.appendChild(opt);
    });

    updateCommuneList();
  }

  function handleSvgLoad(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(ev) {
      currentSvgTemplate = ev.target.result;
      detectTags(currentSvgTemplate);
      updatePreview();
    };
    reader.readAsText(file);
  }

  function detectTags(svgText) {
    // Regex that can match {{TAG}} even if there are XML tags inside
    // Example: {{NOM_<tspan>VAR</tspan>}}
    // Added a-z and case-insensitive check
    const regex = /\{\{\s*(?:[a-zA-Z_0-9\s]|<[^>]*>)+\s*\}\}/g;
    const matches = svgText.match(regex) || [];
    
    // Clean each match to get the actual tag name
    detectedTags = [...new Set(matches.map(m => {
        return m.replace(/<[^>]*>/g, '').replace(/\{\{|\}\}/g, '').trim().toUpperCase();
    }))];

    // Initialize offsets
    detectedTags.forEach(tag => {
      if (!tagOffsets[tag]) tagOffsets[tag] = { dx: 0, dy: 0 };
    });

    const statusDiv = document.getElementById('flyerTagStatus');
    const mappedDiv = document.getElementById('flyerMappedTags');
    
    if (detectedTags.length > 0) {
      statusDiv.style.display = 'block';
      renderTagControls();
    } else {
      statusDiv.style.display = 'block';
      mappedDiv.innerHTML = `<div style="color:#ff6b6b; padding:10px; grid-column: 1 / -1; border: 1px solid #ff6b6b; border-radius:4px; background:rgba(255,107,107,0.1);">
        <strong>⚠️ Aucune balise détectée.</strong><br>
        Vérifiez que votre fichier contient bien des textes au format {{BALISE}} et qu'ils ne sont pas vectorisés dans votre logiciel d'édition.
      </div>`;
    }
  }

  function renderTagControls() {
    const mappedDiv = document.getElementById('flyerMappedTags');
    if (!mappedDiv) return;
    mappedDiv.innerHTML = detectedTags.map(tag => {
        const interpretation = interpretTag(tag);
        const off = tagOffsets[tag] || { dx: 0, dy: 0 };
        return `
          <div class="flyer-mapping-item" style="display:flex; flex-direction:column; gap:6px; background:var(--surface); border:1px solid var(--border); padding:10px; border-radius:6px;">
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border); padding-bottom:6px; margin-bottom:4px;">
              <strong style="color:var(--gold); font-size:11px;">{{${tag}}}</strong>
              <div style="display:flex; gap:5px;">
                <button class="btn btn-xs ${tagOffsets[tag]?.forceCenter ? 'btn-gold' : 'btn-outline'}" 
                  style="font-size:8px; padding:0 6px; height:18px; ${tagOffsets[tag]?.forceCenter ? 'color:#000;' : ''}" 
                  onclick="FlyerTab.centerOnPage('${tag}')">Centrer (50%)</button>
                <button class="btn btn-xs btn-outline" style="font-size:8px; padding:0 4px; height:18px;" onclick="FlyerTab.resetOffset('${tag}')" title="Réinitialiser">Ø</button>
              </div>
            </div>
            <div style="display:grid; grid-template-columns: 20px 1fr 30px; align-items:center; gap:8px;">
              <span style="font-size:10px; opacity:0.5; font-weight:bold;">X</span>
              <input type="range" min="-400" max="400" value="${off.dx}" id="off-slider-${tag}-dx"
                oninput="FlyerTab.updateOffset('${tag}', 'dx', this.value)" 
                style="width:100%; height:4px; accent-color:var(--gold); cursor:pointer;">
              <span id="off-val-${tag}-dx" style="font-size:10px; text-align:right; font-family:monospace;">${off.dx}</span>

              <span style="font-size:10px; opacity:0.5; font-weight:bold;">Y</span>
              <input type="range" min="-400" max="400" value="${off.dy}" id="off-slider-${tag}-dy"
                oninput="FlyerTab.updateOffset('${tag}', 'dy', this.value)" 
                style="width:100%; height:4px; accent-color:var(--gold); cursor:pointer;">
              <span id="off-val-${tag}-dy" style="font-size:10px; text-align:right; font-family:monospace;">${off.dy}</span>
            </div>
          </div>
        `;
    }).join('');
  }

  function updateCommuneList() {
    const search = document.getElementById('flyerSearch').value.toLowerCase();
    const canton = document.getElementById('flyerCantonFilter').value;
    const listDiv = document.getElementById('flyerCommuneList');

    const codes = Object.keys(flyerCommunesData).filter(code => {
      const c = flyerCommunesData[code];
      const matchSearch = c.nom.toLowerCase().includes(search);
      const matchCanton = !canton || c.canton === canton;
      return matchSearch && matchCanton;
    }).sort((a,b) => flyerCommunesData[a].nom.localeCompare(flyerCommunesData[b].nom));

    listDiv.innerHTML = codes.map(code => {
      const c = flyerCommunesData[code];
      const checked = selectedCommunes.has(code) ? 'checked' : '';
      return `
        <div class="flyer-commune-item" onclick="FlyerTab.toggleCommune('${code}')">
          <input type="checkbox" ${checked} onclick="event.stopPropagation();FlyerTab.toggleCommune('${code}')">
          <span style="font-size:0.9rem">${c.nom} (${code})</span>
        </div>
      `;
    }).join('');

    updateSelectionCount();
  }

  function updateSelectionCount() {
    const count = selectedCommunes.size;
    document.getElementById('flyerSelectionCount').textContent = `${count} commune${count > 1 ? 's' : ''} sélectionnée${count > 1 ? 's' : ''}`;
    updatePreview();
  }

  function updatePreview() {
    const codes = Array.from(selectedCommunes);
    const container = document.getElementById('flyerPreviewContainer');
    const emptyDiv = document.getElementById('flyerPreviewEmpty');
    const previewDiv = document.getElementById('flyerSvgPreview');
    const nameSpan = document.getElementById('flyerCurrentPreviewName');

    if (codes.length === 0 || !currentSvgTemplate) {
      emptyDiv.style.display = 'block';
      previewDiv.style.display = 'none';
      nameSpan.textContent = "-";
      return;
    }

    if (currentPreviewIndex >= codes.length) currentPreviewIndex = 0;
    if (currentPreviewIndex < 0) currentPreviewIndex = codes.length - 1;

    const code = codes[currentPreviewIndex];
    const commune = flyerCommunesData[code];
    nameSpan.textContent = `${commune.nom} (${code})`;

    const rendered = renderFlyer(currentSvgTemplate, code);
    emptyDiv.style.display = 'none';
    previewDiv.style.display = 'block';
    
    // Clean SVG string for preview (remove XML header and doctype)
    let cleanSvg = rendered.replace(/^<\?xml[\s\S]*?\?>/i, '')
                           .replace(/^<!DOCTYPE[\s\S]*?>/i, '').replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                           .trim();
    
    // Ensure the SVG is responsive in the preview
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(cleanSvg, "image/svg+xml");
      const errNode = doc.querySelector("parsererror");
      if (!errNode) {
        const svgEl = doc.querySelector("svg");
        if (svgEl) {
          if (!svgEl.getAttribute("viewBox") && svgEl.getAttribute("width") && svgEl.getAttribute("height")) {
             // Extract numeric values from width/height (could contain 'px')
             const w = parseFloat(svgEl.getAttribute("width"));
             const h = parseFloat(svgEl.getAttribute("height"));
             if (!isNaN(w) && !isNaN(h)) {
               svgEl.setAttribute("viewBox", `0 0 ${w} ${h}`);
             }
          }
          svgEl.removeAttribute("width");
          svgEl.removeAttribute("height");
          cleanSvg = svgEl.outerHTML;
        }
      }
    } catch (e) {
      console.warn("Could not parse SVG for preview fixing", e);
    }

    previewDiv.innerHTML = cleanSvg;
  }

  function renderFlyer(template, code) {
    const commune = flyerCommunesData[code] || {};
    
    // Use DOMParser for safer and more powerful SVG manipulation
    const parser = new DOMParser();
    const doc = parser.parseFromString(template, "image/svg+xml");
    const tagRegex = /\{\{\s*(?:[a-zA-Z_0-9\s]|<[^>]*>)+\s*\}\}/g;

    const svgEl = doc.documentElement;
    let viewWidth = 1080;
    const viewBox = svgEl.getAttribute('viewBox');
    if (viewBox) {
      const parts = viewBox.split(/[\s,]+/).map(Number);
      if (parts.length === 4) viewWidth = parts[2];
    } else if (svgEl.width?.baseVal) {
      viewWidth = svgEl.width.baseVal.value;
    }

    // Find all text and tspan elements
    const textElements = doc.querySelectorAll('text, tspan');
    
    textElements.forEach(el => {
      // Use innerHTML to catch tags that might be split by nested tspans (e.g., from Illustrator)
      let content = el.innerHTML;
      const matches = content.match(tagRegex);
      if (matches) {
        const firstTag = matches[0].replace(/<[^>]*>/g, '').replace(/\{\{|\}\}/g, '').trim().toUpperCase();
        
        // Force centering on the element and its parent text element
        const setCenter = (target, tag) => {
          target.setAttribute('text-anchor', 'middle');
          target.style.setProperty('text-anchor', 'middle', 'important');
          target.style.textAlign = 'center';
          
          const xAttr = target.getAttribute('x');
          const yAttr = target.getAttribute('y');
          
          // Logic: if forceCenter is true, or if it's a standalone tag and user hasn't moved the slider manually
          if (tagOffsets[tag]?.forceCenter || (content.trim() === matches[0] && !tagOffsets[tag]?.manualX)) {
             target.setAttribute('x', '50%');
             // CRITICAL: illustrator often adds dx/dy for fine-tuning. We must strip them for clean centering.
             target.removeAttribute('dx');
             target.removeAttribute('dy');
          } else if (xAttr) {
            const xCoords = xAttr.trim().split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
            if (xCoords.length > 1) {
              const minX = Math.min(...xCoords);
              const maxX = Math.max(...xCoords);
              target.setAttribute('x', (minX + maxX) / 2);
            }
          }
          
          if (yAttr) {
            const yCoords = yAttr.trim().split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
            if (yCoords.length > 1) {
              const minY = Math.min(...yCoords);
              const maxY = Math.max(...yCoords);
              target.setAttribute('y', (minY + maxY) / 2);
              target.setAttribute('dominant-baseline', 'middle');
            }
          }
        };

        setCenter(el, firstTag);
        if (el.tagName.toLowerCase() === 'tspan' && el.parentElement && el.parentElement.tagName.toLowerCase() === 'text') {
           setCenter(el.parentElement, firstTag);
        }
        
        el.innerHTML = content.replace(tagRegex, (match) => {
           const tagName = match.replace(/<[^>]*>/g, '').replace(/\{\{|\}\}/g, '').trim().toUpperCase();
           
           // Apply offsets if defined for this tag
           const offset = tagOffsets[tagName];
           if (offset) {
              if (offset.dx !== 0) el.setAttribute('dx', offset.dx);
              if (offset.dy !== 0) el.setAttribute('dy', offset.dy);
           }
           
           const value = resolveDynamicTag(tagName, commune);
           return value !== null ? value : match;
        });
      }
    });

    return doc.documentElement.outerHTML;
  }

  function formatValue(val, field) {
    if (val === null || val === undefined) return "";
    if (typeof val === 'number') {
      if (field.includes('participation') || field.includes('score') || field.includes('csp')) {
        return val.toLocaleString('fr-FR') + " %";
      }
      if (field.includes('revenu')) {
        return val.toLocaleString('fr-FR') + " €";
      }
      return val.toLocaleString('fr-FR');
    }
    return val;
  }

  function showLoading(msg) {
    document.getElementById('flyerLoadingOverlay').style.display = 'flex';
    document.getElementById('flyerLoadingMsg').textContent = msg || "Traitement...";
  }

  function hideLoading() {
    document.getElementById('flyerLoadingOverlay').style.display = 'none';
  }

  // EXPORTS
  function downloadSVG() {
    const codes = Array.from(selectedCommunes);
    if (!currentSvgTemplate || codes.length === 0) return alert("Veuillez charger un template et sélectionner au moins une commune.");
    
    const code = codes[currentPreviewIndex];
    const commune = flyerCommunesData[code];
    const rendered = renderFlyer(currentSvgTemplate, code);
    
    const blob = new Blob([rendered], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `flyer-${code}-${commune.nom.replace(/\s+/g, '_')}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  async function downloadPNG() {
    const codes = Array.from(selectedCommunes);
    if (!currentSvgTemplate || codes.length === 0) return alert("Veuillez charger un template et sélectionner au moins une commune.");
    
    showLoading("Génération du PNG...");
    const code = codes[currentPreviewIndex];
    const commune = flyerCommunesData[code];
    const svgString = renderFlyer(currentSvgTemplate, code);
    
    try {
      const blob = await svgToPng(svgString);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `flyer-${code}-${commune.nom.replace(/\s+/g, '_')}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error(err);
      alert("Erreur lors de la génération du PNG.");
    } finally {
      hideLoading();
    }
  }

  function svgToPng(svgString) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      
      img.onload = function() {
        const canvas = document.createElement('canvas');
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgString, "image/svg+xml");
        const svgEl = doc.querySelector("svg");
        
        let nativeWidth = 800, nativeHeight = 1200;
        if (svgEl.viewBox && svgEl.viewBox.baseVal && svgEl.viewBox.baseVal.width > 0) {
          nativeWidth = svgEl.viewBox.baseVal.width;
          nativeHeight = svgEl.viewBox.baseVal.height;
        } else if (svgEl.width && svgEl.width.baseVal && svgEl.width.baseVal.value > 0) {
          nativeWidth = svgEl.width.baseVal.value;
          nativeHeight = svgEl.height.baseVal.value;
        }

        const isLandscape = nativeWidth > nativeHeight;

        let width = nativeWidth;
        let height = nativeHeight;

        const resSelect = document.getElementById('flyerExportRes');
        const resType = resSelect ? resSelect.value : 'fhd';

        if (resType !== 'native') {
          // Format dimensions
          if (resType === 'fhd') {
            width = isLandscape ? 1920 : 1080;
            height = isLandscape ? 1080 : 1920;
          } else if (resType === '4k') {
            width = isLandscape ? 3840 : 2160;
            height = isLandscape ? 2160 : 3840;
          } else if (resType === 'a4') {
            width = isLandscape ? 3508 : 2480;
            height = isLandscape ? 2480 : 3508;
          } else if (resType === 'square') {
            width = 1080;
            height = 1080;
          } else {
            // Keep exactly as is (native)
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = "white"; 
        ctx.fillRect(0,0,width,height);
        ctx.drawImage(img, 0, 0, width, height);
        
        URL.revokeObjectURL(url);
        canvas.toBlob(blob => resolve(blob), 'image/png');
      };
      img.onerror = () => reject("Image load error");
      img.src = url;
    });
  }

  async function downloadZIP() {
    const codes = Array.from(selectedCommunes);
    if (!currentSvgTemplate || codes.length === 0) return alert("Veuillez charger un template et sélectionner au moins une commune.");

    if (typeof JSZip === 'undefined') {
      showLoading("Chargement de JSZip...");
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
    }

    showLoading(`Génération du lot (${codes.length} fichiers)...`);
    const zip = new JSZip();
    
    for (const code of codes) {
      const commune = flyerCommunesData[code];
      const rendered = renderFlyer(currentSvgTemplate, code);
      const safeName = commune.nom.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, '_');
      zip.file(`flyer_${code}_${safeName}.svg`, rendered);
    }

    const content = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = `flyers_oise_${new Date().toISOString().slice(0,10)}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    hideLoading();
  }

  async function downloadZIPPNG() {
    const codes = Array.from(selectedCommunes);
    if (!currentSvgTemplate || codes.length === 0) return alert("Veuillez charger un template et sélectionner au moins une commune.");

    if (typeof JSZip === 'undefined') {
      showLoading("Chargement de JSZip...");
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
    }

    showLoading(`Génération du lot PNG (${codes.length} fichiers)...`);
    const zip = new JSZip();
    
    // Process one by one to avoid memory exhaustion
    for (let i = 0; i < codes.length; i++) {
        const code = codes[i];
        document.getElementById('flyerLoadingMsg').textContent = `Génération du PNG ${i+1}/${codes.length}...`;
        const commune = flyerCommunesData[code];
        const rendered = renderFlyer(currentSvgTemplate, code);
        const safeName = commune.nom.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, '_');
        
        try {
            const blob = await svgToPng(rendered);
            zip.file(`flyer_${code}_${safeName}.png`, blob);
        } catch (e) {
            console.error(`Error generating PNG for ${code}`, e);
        }
    }

    document.getElementById('flyerLoadingMsg').textContent = `Compression ZIP en cours...`;
    const content = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = `flyers_oise_png_${new Date().toISOString().slice(0,10)}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    hideLoading();
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  // PUBLIC API
  window.FlyerTab = {
    toggleCommune: (code) => {
      if (selectedCommunes.has(code)) selectedCommunes.delete(code);
      else selectedCommunes.add(code);
      updateCommuneList();
    },
    selectAll: () => {
      const search = document.getElementById('flyerSearch').value.toLowerCase();
      const canton = document.getElementById('flyerCantonFilter').value;
      Object.keys(flyerCommunesData).forEach(code => {
        const c = flyerCommunesData[code];
        if (c.nom.toLowerCase().includes(search) && (!canton || c.canton === canton)) {
          selectedCommunes.add(code);
        }
      });
      updateCommuneList();
    },
    deselectAll: () => {
      const search = document.getElementById('flyerSearch').value.toLowerCase();
      const canton = document.getElementById('flyerCantonFilter').value;
      Object.keys(flyerCommunesData).forEach(code => {
        const c = flyerCommunesData[code];
        if (c.nom.toLowerCase().includes(search) && (!canton || c.canton === canton)) {
          selectedCommunes.delete(code);
        }
      });
      updateCommuneList();
    },
    prevPreview: () => { currentPreviewIndex--; updatePreview(); },
    nextPreview: () => { currentPreviewIndex++; updatePreview(); },
    updateOffset: (tag, type, val) => {
      if (!tagOffsets[tag]) tagOffsets[tag] = { dx: 0, dy: 0 };
      tagOffsets[tag][type] = parseFloat(val);
      if (type === 'dx') tagOffsets[tag].manualX = true; // User touched the slider
      const valDisplay = document.getElementById(`off-val-${tag}-${type}`);
      if (valDisplay) valDisplay.textContent = val;
      updatePreview();
    },
    resetOffset: (tag) => {
      tagOffsets[tag] = { dx: 0, dy: 0, forceCenter: false, manualX: true }; // Force reset to original SVG state
      renderTagControls();
      updatePreview();
    },
    resetAllOffsets: () => {
      detectedTags.forEach(tag => tagOffsets[tag] = { dx: 0, dy: 0, forceCenter: false, manualX: false });
      renderTagControls();
      updatePreview();
    },
    centerOnPage: (tag) => {
      if (!tagOffsets[tag]) tagOffsets[tag] = { dx: 0, dy: 0 };
      tagOffsets[tag].forceCenter = true;
      tagOffsets[tag].manualX = false;
      tagOffsets[tag].dx = 0;
      renderTagControls();
      updatePreview();
    },
    downloadSVG,
    downloadPNG,
    downloadZIP,
    downloadZIPPNG
  };

})();

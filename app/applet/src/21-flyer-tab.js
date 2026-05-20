<script>
(function() {
  // Styles for the Flyer Generator
  const styles = `
    .flyer-tab-content {
      max-width: 1200px;
      margin: 0 auto;
      color: #fff;
    }
    .flyer-step-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 20px;
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
      background: rgba(255,255,255,0.05);
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 0.85rem;
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
      background: rgba(255,255,255,0.05);
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
      color: #fff;
    }
    .flyer-filter-select {
      padding: 10px;
      border-radius: 6px;
      background: var(--bg);
      border: 1px solid var(--border);
      color: #fff;
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
      color: #fff;
    }
    .flyer-spinner {
      border: 4px solid rgba(255,255,255,0.1);
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

  window.initFlyerGenerator = function(communesData) {
    flyerCommunesData = communesData;
    renderFlyerLayout();
  };

  function renderFlyerLayout() {
    const container = document.getElementById('flyerContent');
    if (!container) return;

    container.innerHTML = `
      <div class="flyer-tab-content">
        <!-- STEP 1 -->
        <div class="flyer-step-card">
          <div class="flyer-step-title"><span>1.</span> Chargement du template SVG</div>
          <div style="display:flex; flex-direction:column; gap:10px;">
            <p style="font-size:0.9rem; opacity:0.8;">Sélectionnez un fichier SVG contenant des balises de type {{NOM_VARIABLE}}.</p>
            <input type="file" id="flyerSvgInput" accept=".svg" class="btn btn-outline" style="padding:10px;">
            <div id="flyerTagStatus" style="display:none; margin-top:15px;">
              <div style="font-weight:bold; margin-bottom:10px;">Balises détectées :</div>
              <div class="flyer-mapping-list" id="flyerMappedTags"></div>
            </div>
          </div>
        </div>

        <!-- STEP 2 -->
        <div class="flyer-step-card">
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
        <div class="flyer-step-card">
          <div class="flyer-step-title"><span>3.</span> Prévisualisation et export</div>
          <div class="flyer-preview-area">
            <div class="flyer-nav">
              <button class="btn btn-sm btn-circle" onclick="FlyerTab.prevPreview()">❮</button>
              <span id="flyerCurrentPreviewName" style="font-weight:bold; min-width:200px; text-align:center;">-</span>
              <button class="btn btn-sm btn-circle" onclick="FlyerTab.nextPreview()">❯</button>
            </div>
            <div id="flyerPreviewContainer" style="width:100%; display:flex; justify-content:center;">
              <div id="flyerPreviewEmpty" style="padding:40px; background:rgba(255,255,255,0.05); border-radius:8px; border:2px dashed var(--border); text-align:center;">
                Attente d'un template et de communes sélectionnées...
              </div>
              <div id="flyerSvgPreview" style="display:none;"></div>
            </div>

            <div class="flyer-exports">
              <button class="btn btn-gold" onclick="FlyerTab.downloadSVG()">⬇ Télécharger SVG</button>
              <button class="btn btn-gold" onclick="FlyerTab.downloadPNG()">🖼 Télécharger PNG</button>
              <button class="btn btn-gold" style="background:#7c3aed" onclick="FlyerTab.downloadZIP()">📦 Générer le lot (ZIP)</button>
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
    const regex = /\{\{([A-Z_0-9]+)\}\}/g;
    const matches = svgText.matchAll(regex);
    detectedTags = [...new Set(Array.from(matches).map(m => m[1]))];

    const statusDiv = document.getElementById('flyerTagStatus');
    const mappedDiv = document.getElementById('flyerMappedTags');
    
    if (detectedTags.length > 0) {
      statusDiv.style.display = 'block';
      mappedDiv.innerHTML = detectedTags.map(tag => {
        const field = MAPPING_DEFAULTS[tag] || "Non associé";
        return `<div class="flyer-mapping-item"><strong>{{${tag}}}</strong> &rarr; ${field}</div>`;
      }).join('');
    } else {
      statusDiv.style.display = 'none';
      alert("Aucune balise {{...}} détectée dans le SVG.");
    }
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
    previewDiv.innerHTML = rendered;
  }

  function renderFlyer(template, code) {
    const commune = flyerCommunesData[code] || {};
    let output = template;

    detectedTags.forEach(tag => {
      const field = MAPPING_DEFAULTS[tag];
      let value = "";

      if (tag === 'DATE_GENERATION') {
        value = new Date().toLocaleDateString('fr-FR');
      } else if (field && commune[field] !== undefined) {
        value = formatValue(commune[field], field);
      }

      output = output.split(`{{${tag}}}`).join(value);
    });

    return output;
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
        
        let width = 800, height = 1200;
        if (svgEl.viewBox && svgEl.viewBox.baseVal) {
          width = svgEl.viewBox.baseVal.width;
          height = svgEl.viewBox.baseVal.height;
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
    downloadSVG,
    downloadPNG,
    downloadZIP
  };

})();
</script>

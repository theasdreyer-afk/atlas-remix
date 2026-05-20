const fs = require('fs');

const inseeCode = fs.readFileSync('data/insee-cache.js', 'utf8');
eval(inseeCode.replace(/const /g, 'var '));

const geoCode = fs.readFileSync('data/geo-cache.js', 'utf8');
eval(geoCode.replace(/const /g, 'var '));

const turf = require('@turf/turf');

const circoMap = {};

CACHE_INSEE_COMMUNES_DATA.forEach(com => {
    if(!com.centre) return;
    
    const pt = com.centre;
    
    let found = null;
    for(const feature of CACHE_CIRCO_GEO.features) {
        if(turf.booleanPointInPolygon(pt, feature)) {
            found = feature.properties.codeCirconscription || feature.properties.nomCirconscription;
            break;
        }
    }
    circoMap[com.code] = found;
});

console.log(JSON.stringify(circoMap, null, 2));

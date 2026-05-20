const https = require('https');
const fs = require('fs');

const url = 'https://static.data.gouv.fr/resources/contours-geographiques-des-circonscriptions-legislatives/20240613-191506/circonscriptions-legislatives-p20.geojson';

https.get(url, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const geojson = JSON.parse(data);
    const oise = geojson.features.filter(f => f.properties.codeDepartement === '60');
    geojson.features = oise;
    fs.writeFileSync('data/geo-cache.js', '\nconst CACHE_CIRCO_GEO = ' + JSON.stringify(geojson) + ';\n', {flag: 'a'});
    console.log('Saved CACHE_CIRCO_GEO to data/geo-cache.js with ' + oise.length + ' circonscriptions.');
  });
});

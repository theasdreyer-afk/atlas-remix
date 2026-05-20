const https = require('https');
const fs = require('fs');

https.get('https://france-geojson.gregoiredavid.fr/repo/departements/60/circonscriptions-legislatives.geojson', (res) => {
  if (res.statusCode !== 200) {
    console.error('Failed to download from france-geojson');
    process.exit(1);
  }
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    fs.writeFileSync('data/circo-cache.js', 'const CACHE_CIRCO_GEO = ' + data + ';\n');
    console.log('Success');
  });
});

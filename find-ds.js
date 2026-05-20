const https = require('https');

https.get('https://www.data.gouv.fr/api/1/datasets/?q=contours+circonscriptions+legislatives', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const json = JSON.parse(data);
    const dataset = json.data.find(d => d.title.toLowerCase().includes('circonscription'));
    if (dataset) {
      console.log('Found dataset:', dataset.id);
      dataset.resources.forEach(r => console.log(r.title, r.url));
    } else {
      console.log('Not found');
    }
  });
});

const express = require('express');
const path = require('path');
const app = express();
const port = 3000;

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'atlas.hugo.dreyer.html'));
});

app.get('/telecharger-html', (req, res) => {
  const file = path.join(__dirname, 'atlas.hugo.dreyer.html');
  res.download(file, 'atlas.hugo.dreyer.html');
});

app.use(express.static(__dirname));

app.listen(port, () => console.log('Listening on ' + port));

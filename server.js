'use strict';

// Starts the SKY888 site: opens the database, makes sure the sample spaces and a
// first admin exist, then serves the public site, the admin app and the API.
const { openDb, seedSampleSpaces } = require('./src/db');
const { bootstrapAdmin } = require('./src/auth');
const { createApp } = require('./src/app');

const db = openDb();
seedSampleSpaces(db);
bootstrapAdmin(db);

const port = Number(process.env.PORT) || 3000;
createApp(db).listen(port, () => {
  console.log(`SKY888 is running at http://localhost:${port}`);
  console.log(`Admin area: http://localhost:${port}/admin/`);
});

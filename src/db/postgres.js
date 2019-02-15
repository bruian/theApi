const { Pool } = require('pg');
const config = require('../config');

const { logger: log } = require('../log');

const pool = new Pool(config.postgres);

// eslint-disable-next-line
pool.on('error', (err, client) => {
  log.error(`⚙️  Postgres database error: ${err.message}`);
});

pool.query(
  'select * from pg_stat_database WHERE datname = $1',
  [config.postgres.database],
  (err, res) => {
    if (err) {
      log.error(`⚙️  Postgres database error: ${err.message}`);
      throw err;
    }

    log.info(
      `⚙️  Connected to Postgres database! Base have ${
        res.rows[0].numbackends
      } connections`,
    );
  },
);

module.exports.pool = pool;

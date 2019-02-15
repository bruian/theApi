const path = require('path');
const cP = require('./src/config.js');

const BASE_PATH = './src/db';

module.exports = {
  test: {
    client: 'postgresql',
    connection: {
      database: cP.postgres.baseTest,
      user: cP.postgres.user,
      password: cP.postgres.password,
      host: cP.postgres.host,
      port: cP.postgres.port,
    },
    migrations: {
      directory: path.join(BASE_PATH, 'migrations'),
    },
    seeds: {
      directory: path.join(BASE_PATH, 'seeds'),
    },
  },
  development: {
    client: 'pg',
    connection: `postgres://${cP.postgres.user}:${cP.postgres.password}@${
      cP.postgres.host
    }:${cP.postgres.port}/${cP.postgres.base}`,
    migrations: {
      directory: path.join(BASE_PATH, 'migrations'),
    },
    seeds: {
      directory: path.join(BASE_PATH, 'seeds'),
    },
  },
  production: {
    client: 'pg',
    connection: `postgres://${cP.postgres.user}:${cP.postgres.password}@${
      cP.postgres.host
    }:${cP.postgres.port}/${cP.postgres.base}`,
    migrations: {
      directory: path.join(BASE_PATH, 'migrations'),
    },
    seeds: {
      directory: path.join(BASE_PATH, 'seeds'),
    },
  },
};

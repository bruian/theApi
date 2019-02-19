const rc = require('rc');

module.exports = rc('API', {
  host: '127.0.0.1',
  port: process.env.API_PORT || 3000,
  debug: !(process.env.NODE_ENV === 'production'),
  author: 'bruianio@gmail.com',
  companyEmail: 'hello@inTask.me',
  logFile: process.env.API_LOG,
  version: '0.0.2',
  postgres: {
    database: process.env.API_BASE,
    user: process.env.PG_USER,
    password: process.env.POSTGRES_PASSWORD,
    port: process.env.PG_PORT,
    host: process.env.PG_HOST,
    // ssl: true,
    max: 20, // set pool max size to 20
    min: 4, // set min pool size to 4
  },
  tokenSecret: process.env.TOKEN_SECRET,
});

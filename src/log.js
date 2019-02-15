const Winston = require('winston');
const config = require('./config');

const isProd = process.env.NODE_ENV === 'production';
const level = isProd ? 'info' : 'debug';

Winston.format.combine(Winston.format.colorize(), Winston.format.json());

const winston = Winston.createLogger({
  transports: [
    new Winston.transports.File({ filename: config.logFile, level }),
    new Winston.transports.Console({ level }),
  ],
  exitOnError: false,
});

module.exports.logger = winston;

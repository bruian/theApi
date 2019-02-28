const fs = require('fs');
const Winston = require('winston');
const config = require('./config');

const isProd = process.env.NODE_ENV === 'production';
const level = isProd ? 'info' : 'debug';

Winston.format.combine(Winston.format.colorize(), Winston.format.json());

if (!fs.existsSync(config.logFile)) {
  fs.writeFileSync(config.logFile, '', { flag: 'wx' });
}

const winston = Winston.createLogger({
  transports: [
    new Winston.transports.File({ filename: config.logFile, level }),
    new Winston.transports.Console({ level }),
  ],
  exitOnError: false,
});

module.exports.logger = winston;

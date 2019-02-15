/*!
 * theApi - main.js
 * Copyright(c) 2019 bruian <bruianio@gmail.com>
 * Apache-2.0 Licensed
 */

/*
 * Используется async фреймворк koa: https://koajs.com
 * Роутинг обеспечивает стандартный middleware koa-router: https://www.npmjs.com/package/koa-router
 * JWT декодируется и помещается в state.user посредством koa-jwt: https://github.com/koajs/jwt
 * Отображение HTML шаблонов в ответах сервера koa-ejs: https://github.com/koajs/ejs
 * Выдача статичных данных сервером koa-static: https://github.com/koajs/static
 * Парсер post body у HTTP запроса koa-bodyparser: https://github.com/koajs/bodyparser
 */
const Koa = require('koa');
const Router = require('koa-router');
const render = require('koa-ejs');
const serve = require('koa-static');
const bodyParser = require('koa-bodyparser');
const path = require('path');
const cors = require('@koa/cors');
require('dotenv').config({ path: './dev.env' });
require('./db/postgres');

/* Конфигурация приложения */
const config = require('./config');

const apiModule = require('./apis/api');

function createApp() {
  const app = new Koa();
  const router = new Router();

  /* Настройка рендера шаблонов для отображения */
  render(app, {
    root: './src/views',
    layout: 'template',
    viewExt: 'html',
    cache: false,
    debug: false,
  });

  /* В koa middleware представлены layers и выполняются в порядке их подключения методом app.use */

  /* Декодирование JWT, который должен приходить в HTTP Header Authorization */
  // router.use(
  //   jwtMiddleware({secret: config.tokenSecret}),
  // );

  /* Обработка роутов api */
  router.use('/api', apiModule.routes());

  /* Обработка защищенных роутов */
  app.use(cors());

  /* Константы для шаблонизатора должны быть помещены в state */
  app.use(async (ctx, next) => {
    ctx.state = ctx.state || {};
    ctx.state.version = config.version;
    ctx.state.secret = config.tokenSecret;
    return next();
  });

  app.use(serve(path.join(__dirname, '../static')));
  app.use(router.allowedMethods());
  app.use(bodyParser());

  /* routes() отдает свернутые compose функцией layers, где они подключаются к KOA */
  app.use(router.routes());

  return app;
}

if (!module.parent || config.debug) {
  createApp().listen(config.port);
  /* eslint-disable no-console */
  console.log(
    `✅  theApi server v.${
      config.version
    } started ${new Date()} *********************`,
  );
  console.log(`💻  Server listen to ${config.host}:${config.port}`);
}

module.exports = createApp;

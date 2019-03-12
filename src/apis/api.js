const Router = require('koa-router');
const jwtMiddleware = require('koa-jwt');

const UserController = require('../controllers/users');
const GroupController = require('../controllers/groups');
const ContextController = require('../controllers/contexts');
const TaskController = require('../controllers/tasks');
const ActivityController = require('../controllers/activity');
const SheetController = require('../controllers/sheets');
const { logger: log } = require('../log');

const router = new Router();

/*
 * @func getCondition
 * @param {Object} ctx
 * @returns {Object} condition
 * @description Compose auth + query + body in one object
 */
function getCondition(ctx) {
  let condition = Object.assign(
    { mainUser_id: ctx.state.user.user_id },
    ctx.state.user,
  );
  condition = Object.assign(condition, ctx.query);
  condition = Object.assign(condition, ctx.request.body);

  return condition;
}

/*
 * @func logRequest
 * @param {date} timeStart - start reques
 * @param {Object} ctx
 * @param {Object} condition
 * @param {Array} data
 * @description Format request datas and log it
 */
function logRequest(timeStart, ctx, condition, data) {
  const headString = `${ctx.request.method} ${ctx.request.url}`;
  let dataString = '';
  let condString = '';

  Object.keys(condition).forEach(key => {
    if (
      key !== 'user_id' &&
      key !== 'client_id' &&
      key !== 'role' &&
      key !== 'email' &&
      key !== 'iat' &&
      key !== 'exp'
    ) {
      condString = `${condString} | ${key}:${condition[key]}`;
    }
  });

  if (Array.isArray(data)) {
    let ids = [];
    ids = data.map(el => el.id).toString();

    dataString = `| elements: [${ids}]`;
  }

  const info = `${headString} ${Date.now() -
    timeStart}ms |->${condString} ${dataString}`;

  log.verbose(info);
}

/* Обработка корневого роута, с отправкой справочной информации */
router.get('/', async ctx => {
  await ctx.render('intro');
});

/* ------------------------------------------USERS API------------------------------------------ */

/*
 * @func router.get('/main-user')
 * @param {String} path - http path from METHOD
 * @param {function(ctx): Callback} response - to client
 * @returns {Response: Object}
 * @description http METHOD. Call api function "getUser" and responce data: JSON
 */
router.get('/main-user', jwtMiddleware(), async ctx => {
  const timeStart = Date.now();
  const condition = getCondition(ctx);

  try {
    const data = await UserController.getOrCreateUser(condition);
    logRequest(timeStart, ctx, condition, data);
    ctx.body = { data, packet: condition.packet };
  } catch (error) {
    log.warn(
      `/main-user get|-> status:${error.jse_info.status} | message:${
        error.message
      }`,
    );

    ctx.status = error.jse_info.status;
    ctx.body = { message: error.message };
  }
});

/*
 * @func router.get('/users')
 * @param {String} path - http path from METHOD
 * @param {function(ctx): Callback} response - to client
 * @returns {Response: Object}
 * @description Get users information and responce data: JSON
 */
router.get('/users', jwtMiddleware(), async ctx => {
  const timeStart = Date.now();
  const condition = getCondition(ctx);

  try {
    const data = await UserController.getUsers(condition);
    logRequest(timeStart, ctx, condition, data);
    ctx.body = { data };
  } catch (error) {
    log.warn(
      `/users get|-> status:${error.jse_info.status} | message:${
        error.message
      }`,
    );

    ctx.status = error.jse_info.status;
    ctx.body = { message: error.message };
  }
});

/* -----------------------------------------GROUPS API------------------------------------------ */

/*
 * @func router.get('/groups')
 * @param {String} path - http path from METHOD
 * @param {function(ctx): Callback} response - to client
 * @returns {Response: Object}
 * @description Get groups information and responce data: JSON
 */
router.get('/groups', jwtMiddleware(), async ctx => {
  const timeStart = Date.now();
  const condition = getCondition(ctx);

  try {
    const data = await GroupController.getGroups(condition);
    logRequest(timeStart, ctx, condition, data);
    ctx.body = { action: 'getGroups', data, packet: condition.packet };
  } catch (error) {
    log.warn(
      `/groups get|-> status:${error.jse_info.status} | message:${
        error.message
      }`,
    );

    ctx.status = error.jse_info.status;
    ctx.body = { message: error.message };
  }
});

/*
 * @func router.post('/groups')
 * @param {String} path - http path from METHOD
 * @param {function(ctx): Callback} response - to client
 * @returns {Response: Object}
 * @description Create new group
 */
router.post('/groups', jwtMiddleware(), async ctx => {
  const timeStart = Date.now();
  const condition = getCondition(ctx);

  try {
    const data = await GroupController.createGroup(condition);
    logRequest(timeStart, ctx, condition, data);
    ctx.body = { action: 'createGroup', data };
  } catch (error) {
    log.warn(
      `/groups post |-> status:${error.jse_info.status} | message:${
        error.message
      }`,
    );

    ctx.status = error.jse_info.status;
    ctx.body = { message: error.message };
  }
});

/*
 * @func router.del('/groups')
 * @param {String} path - http path from METHOD
 * @param {function(ctx): Callback} response - to client
 * @returns {Response: Object}
 * @description Delete exists group
 */
router.del('/groups', jwtMiddleware(), async ctx => {
  const timeStart = Date.now();
  const condition = getCondition(ctx);

  try {
    const data = await GroupController.removeGroup(condition);
    logRequest(timeStart, ctx, condition, data);
    ctx.body = { action: 'removeGroup', data };
  } catch (error) {
    log.warn(
      `/groups delete |-> status:${error.jse_info.status} | message:${
        error.message
      }`,
    );

    ctx.status = error.jse_info.status;
    ctx.body = { message: error.message };
  }
});

/**
 * @func router.put('/groups')
 * @param {String} path - http path from METHOD
 * @param {function(...args): Callback} response - to client
 * @returns { Response: Object }
 * @description Http METHOD. Call api function "updateGroup" and responce data: JSON
 */
router.put('/groups', jwtMiddleware(), async ctx => {
  const timeStart = Date.now();
  const condition = getCondition(ctx);

  try {
    const data = await GroupController.updateGroup(condition);
    logRequest(timeStart, ctx, condition, data);
    ctx.body = { action: 'updateGroup', data };
  } catch (error) {
    log.warn(
      `/groups put |-> status:${error.jse_info.status} | message:${
        error.message
      }`,
    );

    ctx.status = error.jse_info.status;
    ctx.body = { message: error.message };
  }
});

/**
 * @func router.put('/groups/order')
 * @param {String} path - http path from METHOD
 * @param {function(...args): Callback} response - to client
 * @returns { Response: Object }
 * @description Http METHOD. Call api function "updatePosition" and responce data: JSON
 */
router.put('/groups/order', jwtMiddleware(), async ctx => {
  const timeStart = Date.now();
  const condition = getCondition(ctx);

  try {
    const data = await GroupController.updatePosition(condition);
    logRequest(timeStart, ctx, condition, data);

    ctx.body = { action: 'updatePosition', data };
  } catch (error) {
    log.warn(
      `/groups/order put |-> status:${error.jse_info.status} | message:${
        error.message
      }`,
    );

    ctx.status = error.jse_info.status;
    ctx.body = { message: error.message };
  }
});

/* ----------------------------------------CONTEXTS API----------------------------------------- */

/*
 * @func router.get('/contexts')
 * @param {String} path - http path from METHOD
 * @param {function(ctx): Callback} response - to client
 * @returns {Response: Object}
 * @description Get contexts information and responce data: JSON
 */
router.get('/contexts', jwtMiddleware(), async ctx => {
  const timeStart = Date.now();
  const condition = getCondition(ctx);

  try {
    const data = await ContextController.getContexts(condition);
    logRequest(timeStart, ctx, condition, data);
    ctx.body = { data, packet: condition.packet };
  } catch (error) {
    log.warn(
      `/contexts get |-> status:${error.jse_info.status} | message:${
        error.message
      }`,
    );

    ctx.status = error.jse_info.status;
    ctx.body = { message: error.message };
  }
});

/*
 * @func router.post('/contexts')
 * @param {String} path - http path from METHOD
 * @param {function(ctx): Callback} response - to client
 * @returns {Response: Object}
 * @description Add context to element
 */
router.post('/contexts', jwtMiddleware(), async ctx => {
  const timeStart = Date.now();
  const condition = getCondition(ctx);

  try {
    const data = await ContextController.addContext(condition);
    logRequest(timeStart, ctx, condition, data);
    ctx.body = { data };
  } catch (error) {
    log.warn(
      `/contexts post |-> status:${error.jse_info.status} | message:${
        error.message
      }`,
    );

    ctx.status = error.jse_info.status;
    ctx.body = { message: error.message };
  }
});

/*
 * @func router.del('/contexts')
 * @param {String} path - http path from METHOD
 * @param {function(ctx): Callback} response - to client
 * @returns {Response: Object}
 * @description Delete context from element
 */
router.del('/contexts', jwtMiddleware(), async ctx => {
  const timeStart = Date.now();
  const condition = getCondition(ctx);

  try {
    const data = await ContextController.deleteContext(condition);
    logRequest(timeStart, ctx, condition, data);
    ctx.body = { data };
  } catch (error) {
    log.warn(
      `/contexts delete |-> status:${error.jse_info.status} | message:${
        error.message
      }`,
    );

    ctx.status = error.jse_info.status;
    ctx.body = { message: error.message };
  }
});

/* ------------------------------------------TASKS API------------------------------------------ */

/**
 * @func router.get("/tasks")
 * @param {String} path - http path from METHOD
 * @param {function(ctx): Callback} response - to client
 * @returns { Response: Object }
 * @description Http METHOD. Call api function "getTasks" and responce data: JSON
 */
router.get('/tasks', jwtMiddleware(), async ctx => {
  const timeStart = Date.now();
  const condition = getCondition(ctx);

  try {
    const tasks_data = await TaskController.getTasks(condition);
    logRequest(timeStart, ctx, condition, tasks_data);
    ctx.body = { tasks_data, packet: condition.packet };
  } catch (error) {
    log.warn(
      `/tasks get |-> status:${error.jse_info.status} | message:${
        error.message
      }`,
    );

    ctx.status = error.jse_info.status;
    ctx.body = { message: error.message };
  }
});

/**
 * @func router.post('/tasks')
 * @param {String} path - http path from METHOD
 * @param {function(ctx): Callback} response - to client
 * @returns { Response: Object }
 * @description Http METHOD. Call api function "createTask"->"createActivity" and responce data: JSON
 */
router.post('/tasks', jwtMiddleware(), async ctx => {
  const timeStart = Date.now();
  const condition = getCondition(ctx);

  try {
    const tasks_data = await TaskController.createTask(condition);
    logRequest(timeStart, ctx, condition, tasks_data);

    condition.status = 0;
    condition.type_el = 2;
    condition.task_id = tasks_data[0].id;
    condition.group_id = tasks_data[0].group_id;

    const data = await ActivityController.createActivity(condition);
    logRequest(timeStart, ctx, condition, data.activity_data);

    ctx.body = { tasks_data, activity_data: data.activity_data };
  } catch (error) {
    log.warn(
      `/tasks post |-> status:${error.jse_info.status} | message:${
        error.message
      }`,
    );

    ctx.status = error.jse_info.status;
    ctx.body = { message: error.message };
  }
});

/**
 * @func router.del('/tasks')
 * @param {String} path - http path from METHOD
 * @param {function(ctx): Callback} response - to client
 * @returns { Response: Object }
 * @description Http METHOD. Call api function "deleteTask" and responce data: JSON
 */
router.del('/tasks', jwtMiddleware(), async ctx => {
  const timeStart = Date.now();
  const condition = getCondition(ctx);

  try {
    const data = await TaskController.deleteTask(condition);
    logRequest(timeStart, ctx, condition, data);
    ctx.body = { ...data };
  } catch (error) {
    log.warn(
      `/tasks delete |-> status:${error.jse_info.status} | message:${
        error.message
      }`,
    );

    ctx.status = error.jse_info.status;
    ctx.body = { message: error.message };
  }
});

/**
 * @func router.put('/tasks')
 * @param {String} path - http path from METHOD
 * @param {function(...args): Callback} response - to client
 * @returns { Response: Object }
 * @description Http METHOD. Call api function "updateTask" and responce data: JSON
 */
router.put('/tasks', jwtMiddleware(), async ctx => {
  const timeStart = Date.now();
  const condition = getCondition(ctx);

  try {
    const data = await TaskController.updateTask(condition);
    logRequest(timeStart, ctx, condition, data);
    ctx.body = { ...data };
  } catch (error) {
    log.warn(
      `/tasks put |-> status:${error.jse_info.status} | message:${
        error.message
      }`,
    );

    ctx.status = error.jse_info.status;
    ctx.body = { message: error.message };
  }
});

/**
 * @func router.put('/tasks/order')
 * @param {String} path - http path from METHOD
 * @param {function(...args): Callback} response - to client
 * @returns { Response: Object }
 * @description Http METHOD. Call api function "updatePosition" and responce data: JSON
 */
router.put('/tasks/order', jwtMiddleware(), async ctx => {
  const timeStart = Date.now();
  const condition = getCondition(ctx);

  try {
    const taskData = await TaskController.updatePosition(condition);
    logRequest(timeStart, ctx, condition, taskData);

    condition.status = 0;
    condition.type_el = 2;
    condition.task_id = condition.id;
    condition.group_id = condition.group_id;

    if (!taskData.groupChanged) {
      ctx.body = { data: taskData.data, activity_data: null };
      return;
    }

    const activity_data = await ActivityController.createActivity(condition);
    logRequest(timeStart, ctx, condition, activity_data);

    ctx.body = { tasks_data: taskData.data, activity_data };
  } catch (error) {
    log.warn(
      `/tasks/order put |-> status:${error.jse_info.status} | message:${
        error.message
      }`,
    );

    ctx.status = error.jse_info.status;
    ctx.body = { message: error.message };
  }
});

/* -----------------------------------------ACTIVITY API---------------------------------------- */

/**
 * @func router.get('/activity')
 * @param {String} path - http path from METHOD
 * @param {function(...args): Callback} response - to client
 * @returns { Response: Object }
 * @description Http METHOD. Call api function "getActivity" and responce data: JSON
 */
router.get('/activity', jwtMiddleware(), async ctx => {
  const timeStart = Date.now();
  const condition = getCondition(ctx);
  condition.type = 'last_element';

  try {
    const activity_data = await ActivityController.getActivity(condition);
    const restrictions_data = await ActivityController.getRestrictions(
      condition,
    );
    logRequest(timeStart, ctx, condition, activity_data);

    ctx.body = { activity_data, restrictions_data };
  } catch (error) {
    log.warn(
      `/activity get |-> status:${error.jse_info.status} | message:${
        error.message
      }`,
    );

    ctx.status = error.jse_info.status;
    ctx.body = { message: error.message };
  }
});

/**
 * @func router.post('/activity')
 * @param {String} path - http path from METHOD
 * @param {function(...args): Callback} response - to client
 * @returns { Response: Object }
 * @description Http METHOD. Call api function "createActivity" and responce data: JSON
 */
router.post('/activity', jwtMiddleware(), async ctx => {
  const timeStart = Date.now();
  const condition = getCondition(ctx);
  condition.type = 'last_element';

  try {
    const data = await ActivityController.createActivity(condition);
    const restrictions_data = await ActivityController.getRestrictions(
      condition,
    );

    logRequest(timeStart, ctx, condition, data);

    ctx.body = { ...data, restrictions_data };
  } catch (error) {
    log.warn(
      `/activity post |-> status:${error.jse_info.status} | message:${
        error.message
      }`,
    );

    ctx.status = error.jse_info.status;
    ctx.body = { message: error.message };
  }
});

/**
 * @func router.put('/activity')
 * @param {String} path - http path from METHOD
 * @param {function(...args): Callback} response - to client
 * @returns { Response: Object }
 * @description Http METHOD. Call api function "updateActivity" and responce data: JSON
 */
router.put('/activity', jwtMiddleware(), async ctx => {
  const timeStart = Date.now();
  const condition = getCondition(ctx);

  try {
    const activity_data = await ActivityController.updateActivity(condition);
    logRequest(timeStart, ctx, condition, activity_data);
    ctx.body = { activity_data };
  } catch (error) {
    log.warn(
      `/activity put |-> status:${error.jse_info.status} | message:${
        error.message
      }`,
    );

    ctx.status = error.jse_info.status;
    ctx.body = { message: error.message };
  }
});

/**
 * @func router.del('/activity')
 * @param {String} path - http path from METHOD
 * @param {function(ctx): Callback} response - to client
 * @returns { Response: Object }
 * @description Http METHOD. Call api function "deleteActivity" and responce data: JSON
 */
router.del('/activity', jwtMiddleware(), async ctx => {
  const timeStart = Date.now();
  const condition = getCondition(ctx);
  condition.type = 'last_element';

  try {
    const data = await ActivityController.deleteActivity(condition);
    const restrictions_data = await ActivityController.getRestrictions(
      condition,
    );
    logRequest(timeStart, ctx, condition, data);
    ctx.body = { ...data, restrictions_data };
  } catch (error) {
    log.warn(
      `/activity delete |-> status:${error.jse_info.status} | message:${
        error.message
      }`,
    );

    ctx.status = error.jse_info.status;
    ctx.body = { message: error.message };
  }
});

/**
 * @func router.get('/activity/restrictions')
 * @param {String} path - http path from METHOD
 * @param {function(...args): Callback} response - to client
 * @returns { Response: Object }
 * @description Http METHOD. Call api function "getRestrictions" and responce data: JSON
 */
router.get('/activity/restrictions', jwtMiddleware(), async ctx => {
  const timeStart = Date.now();
  const condition = getCondition(ctx);

  try {
    const restrictions_data = await ActivityController.getRestrictions(
      condition,
    );
    logRequest(timeStart, ctx, condition, restrictions_data);
    ctx.body = { restrictions_data };
  } catch (error) {
    log.warn(
      `/activity/restrictions get |-> status:${
        error.jse_info.status
      } | message:${error.message}`,
    );
  }
});

/**
 * @func router.put('/activity/order')
 * @param {String} path - http path from METHOD
 * @param {function(...args): Callback} response - to client
 * @returns { Response: Object }
 * @description Http METHOD. Call api function "updatePosition" and responce data: JSON
 */
router.put('/activity/order', jwtMiddleware(), async ctx => {
  const timeStart = Date.now();
  const condition = getCondition(ctx);
  condition.type = 'last_element';

  try {
    const activity_data = await ActivityController.updatePosition(condition);
    const restrictions_data = await ActivityController.getRestrictions(
      condition,
    );
    logRequest(timeStart, ctx, condition, activity_data);

    ctx.body = { activity_data, restrictions_data };
  } catch (error) {
    log.warn(
      `/activity/order put |-> status:${error.jse_info.status} | message:${
        error.message
      }`,
    );

    ctx.status = error.jse_info.status;
    ctx.body = { message: error.message };
  }
});

/* -----------------------------------------SHEETS API------------------------------------------ */

/**
 * @func router.get('/sheets')
 * @param {String} path - http path from METHOD
 * @param {function(...args): Callback} response - to client
 * @returns { Response: Object }
 * @description Http METHOD. Call api function "getSheets" and responce data: JSON
 */
router.get('/sheets', jwtMiddleware(), async ctx => {
  const timeStart = Date.now();
  const condition = getCondition(ctx);

  try {
    const data = await SheetController.getSheets(condition);
    logRequest(timeStart, ctx, condition, data);
    ctx.body = { data, packet: condition.packet };
  } catch (error) {
    log.warn(
      `/sheets get |-> status:${error.jse_info.status} | message:${
        error.message
      }`,
    );

    ctx.status = error.jse_info.status;
    ctx.body = { message: error.message };
  }
});

/**
 * @func router.post('/sheets')
 * @param {String} path - http path from METHOD
 * @param {function(...args): Callback} response - to client
 * @returns { Response: Object }
 * @description Http METHOD. Call api function "createSheet" and responce data: JSON
 */
router.post('/sheets', jwtMiddleware(), async ctx => {
  const timeStart = Date.now();
  const condition = getCondition(ctx);

  try {
    const data = await SheetController.createSheet(condition);
    logRequest(timeStart, ctx, condition, data);
    ctx.body = { data };
  } catch (error) {
    log.warn(
      `/sheets post |-> status:${error.jse_info.status} | message:${
        error.message
      }`,
    );

    ctx.status = error.jse_info.status;
    ctx.body = { message: error.message };
  }
});

/**
 * @func router.put('/sheets')
 * @param {String} path - http path from METHOD
 * @param {function(...args): Callback} response - to client
 * @returns { Response: Object }
 * @description Http METHOD. Call api function "updateSheet" and responce data: JSON
 */
router.put('/sheets', jwtMiddleware(), async ctx => {
  const timeStart = Date.now();
  const condition = getCondition(ctx);

  try {
    const data = await SheetController.updateSheet(condition);
    logRequest(timeStart, ctx, condition, data);
    ctx.body = { data };
  } catch (error) {
    log.warn(
      `/sheets put |-> status:${error.jse_info.status} | message:${
        error.message
      }`,
    );

    ctx.status = error.jse_info.status;
    ctx.body = { message: error.message };
  }
});

/**
 * @func router.delete('/sheets')
 * @param {String} path - http path from METHOD
 * @param {function(...args): Callback} response - to client
 * @returns { Response: Object }
 * @description Http METHOD. Call api function "deleteSheet" and responce data: JSON
 */
router.del('/sheets', jwtMiddleware(), async ctx => {
  const timeStart = Date.now();
  const condition = getCondition(ctx);

  try {
    const data = await SheetController.deleteSheet(condition);
    logRequest(timeStart, ctx, condition, data);
    ctx.body = { data };
  } catch (error) {
    log.warn(
      `/sheets delete |-> status:${error.jse_info.status} | message:${
        error.message
      }`,
    );

    ctx.status = error.jse_info.status;
    ctx.body = { message: error.message };
  }
});

module.exports = router;

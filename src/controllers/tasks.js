const VError = require('verror');
const { conditionMustBeSet, conditionMustSet } = require('../utils');
const pg = require('../db/postgres');

/* mainUser_id - идентификатор пользователя, который аутентифицирован в системе	относительно
  этого пользователя происходит запрос данных у базы, с ним же связаны все права доступа.
  - Находится в свойстве user_id объекта koa.ctx.state.user, помещается туда сервером	авторизации
  - Ожидается number */

/* parent_id - идентификатор родителя элемента, может быть 0 если элемент верхнего уровня
	- по умолчанию считается как null
	- может приходить от клиента в api запросе express.router.request.query
	- ожидается char(8) */

/* task_id - идентификатор элемента, при наличии этого параметра отбор будет	производиться
  только по	нему
  - может приходить от клиента в api запросе express.router.request.query
  - ожидается char(8) */

/* position - id элемента в списке задач, на который будет помещаться перемещаемый элемент
  - должен приходить от клиента в api запросе express.router.request.query
  - ожидается number */

/* group_id - идентификатор группы относительно, которой будут извлекаться активности
	- может приходить от клиента в api запросе express.router.request.query
	- ожидается char(8) */

/* userId - параметр по которому фильтруются значения элементов
	- mainUser_id фильтрует по правам доступа, а userId фильтрует уже из доступного списка
	- может приходить от клиента в api запросе express.router.request.query
	- ожидается number */

/* like - параметр по которому фильтруются значения элементов в	полях name и note
	- может приходить от клиента в api запросе express.router.request.query
	- ожидается string */

/* limit - параметр который задает предел записей, что выдаст DB
	- обязательный параметр для запроса массива данных
	- должен приходить от клиента в api запросе express.router.request.header
	- ожидается number не больше 40 */

/* offset - параметр который задает сдвиг относительно которого будет считываться текущая
порция данных
- обязательный параметр для запроса массива данных
- должен приходить от клиента в api запросе express.router.request.header
- ожидается number */

/* isStart - параметр указывающий куда поместить создаваемый элемент,	в начало или конец списка
	- необязательный параметр, отсутсвие которого полагает начало списка
  - ожидается boolean */

/* isBefore - параметр указывающий куда поместить элемент, в начало или конец списка
  - необязательный параметр, отсутсвие которого полагает конец списка
  - ожидается boolean */

/**
 * @func getTasks
 * @param {Object} - conditions
 * @returns {Promise}
 * @description Get tasks from database. If task_id is given, then get one task, else get tasks arr
 * conditions object = { mainUser_id: Number, group_id: char(8), type_el: Number, limit: Number, offset: Number,
 *  like: String, userId: Number, id: char(8) }
 */
async function getTasks(conditions) {
  let limit = 'null';
  let offset = 'null';
  let selectTask = false;
  let pgСonditions = '';
  let pgUserGroups = '';
  let pgGroups = 'main_visible_groups'; // tasks visible only for main user
  let pgParentCondition = ' AND tsk.parent is null'; // select Top level tasks
  let pgParentCondition2 = 'parent is null';
  let pgTaskCondition = '';
  let pgGroupCondition = '';
  let pgSearchText = '';
  let pgLimit = '';

  const params = [];

  try {
    conditionMustBeSet(conditions, 'mainUser_id');
    params.push(conditions.mainUser_id);

    if (conditionMustSet(conditions, 'parent_id')) {
      pgParentCondition = ` AND tsk.parent = \$${params.length + 1}`;
      pgParentCondition2 = `parent = \$${params.length + 1}`;
      params.push(conditions.parent_id);
      selectTask = true;
    }

    if (conditionMustSet(conditions, 'id')) {
      pgTaskCondition = ` AND tsk.id = \$${params.length + 1}`;
      params.push(conditions.task_id);
      selectTask = true;
    }

    if (conditionMustSet(conditions, 'group_id')) {
      pgGroupCondition = ` AND tl.group_id = \$${params.length + 1}`;
      params.push(conditions.group_id);
    }

    if (conditionMustSet(conditions, 'userId')) {
      pgUserGroups = `, user_groups AS (
				SELECT gl.group_id FROM groups_list AS gl
					WHERE (gl.group_id IN (SELECT * FROM main_visible_groups))
						AND (gl.user_id = \$${params.length + 1}))`;
      pgGroups = 'user_groups';

      params.push(conditions.userId);
    }

    if (conditionMustSet(conditions, 'like')) {
      pgSearchText = ` AND tsk.name ILIKE '%\$${params.length + 1}%'`;
      params.push(conditions.like);
    }

    if (!selectTask) {
      conditionMustBeSet(conditions, 'limit');
      conditionMustBeSet(conditions, 'offset');
      limit = parseInt(conditions.limit, 10);
      offset = parseInt(conditions.offset, 10);

      if (limit < 1 || limit > 100) {
        /* Bad request */
        throw new VError(
          {
            info: { parameter: 'limit', value: conditions.limit, status: 400 },
          },
          '<limit> header parameter must contain number <= 40',
        );
      }

      if (offset < 0) {
        /* Bad request */
        throw new VError(
          {
            info: { parameter: 'limit', value: conditions.offset, status: 400 },
          },
          '<offset> header parameter must contain number >= 0',
        );
      }

      if (limit !== null && offset !== null) {
        pgLimit = `LIMIT \$${params.length + 1} OFFSET \$${params.length + 2}`;
        params.push(limit);
        params.push(offset);
      }
    }
  } catch (error) {
    throw error;
  }

  pgСonditions =
    pgParentCondition + pgTaskCondition + pgGroupCondition + pgSearchText;

  // SELECT mainUser-groups, filter on: mainUser_id or [public groups (group_id = 0)]
  // if condition.whose = 'user' SELECT user-groups from [mainUser-groups] filter on: user_id
  //	SELECT tasks IN [mainUser-groups] OR [user-groups if condition.whose = 'user'] filter on:
  //		tasks.parent = task_id

  /* $1 = mainUser_id */
  const queryText = `WITH RECURSIVE main_visible_groups AS (
		SELECT group_id FROM groups_list AS gl
			LEFT JOIN groups AS grp ON gl.group_id = grp.id
			WHERE grp.reading >= gl.user_type AND (gl.user_id = 0 OR gl.user_id = $1)
		) ${pgUserGroups}, descendants(id, parent, depth, path) AS (
			SELECT id, parent, 1 depth, ARRAY[id]::varchar[] FROM tasks WHERE ${pgParentCondition2}
		UNION
			SELECT t.id, t.parent, d.depth + 1, path::varchar[] || t.id::varchar FROM tasks t
			JOIN descendants d ON t.parent = d.id
		), acts(duration, task_id) AS (
			SELECT SUM(extract(EPOCH from act.ends) - extract(EPOCH from act.start)) as duration,
				act.task_id FROM activity_list AS al
			JOIN activity AS act ON (act.id = al.id)
			WHERE (al.user_id = $1)
				AND (al.group_id IN (SELECT * FROM main_visible_groups))
				AND (act.status = 1 OR act.status = 5)
			GROUP BY act.task_id
		)
		SELECT tsk.id, tl.group_id, tl.p, tl.q,
			tsk.tid, tsk.name, tsk.owner AS tskowner,
			act.status, tsk.note, tsk.parent,
			(SELECT COUNT(*) FROM tasks WHERE parent = tsk.id) AS havechild,
			(SELECT duration FROM acts WHERE acts.task_id = tl.task_id) * 1000 AS duration,
			dsc.depth, act.start
		FROM tasks_list AS tl
		RIGHT JOIN tasks AS tsk ON tl.task_id = tsk.id
		JOIN activity_list AS al ON (al.group_id = tl.group_id) AND (al.user_id = $1)
		JOIN activity AS act ON (act.task_id = tl.task_id) AND (act.ends IS NULL) AND (act.id = al.id)
		JOIN (SELECT max(depth) AS depth, descendants.path[1] AS parent_id
					FROM descendants GROUP BY descendants.path[1]) AS dsc ON tl.task_id = dsc.parent_id
		WHERE tl.group_id IN (SELECT * FROM ${pgGroups}) ${pgСonditions}
		ORDER BY tl.group_id, (tl.p::float8/tl.q) ${pgLimit};`;

  const client = await pg.pool.connect();

  try {
    const { rows: tasks } = await client.query(queryText, params);

    tasks.forEach(el => {
      el.havechild = parseInt(el.havechild, 10); // eslint-disable-line
      if (el.havechild) el.children = []; // eslint-disable-line
    });

    return Promise.resolve(tasks);
  } catch (error) {
    throw new VError(
      {
        cause: error,
        info: { status: 400 },
      },
      'DatabaseError',
    );
  } finally {
    client.release();
  }
}

/**
 * @func createTask
 * @param {Object} conditions
 * @returns {Promise}
 * @description Create new <Task> in database and set new position in tasks_list
 * conditions object = { mainUser_id: Number,	group_id: char(8), parent_id: char(8), start: ISO-DateTime string,
 * 	isStart: boolean }
 */
async function createTask(conditions) {
  let isStart = true;

  try {
    conditionMustBeSet(conditions, 'mainUser_id');
    conditionMustBeSet(conditions, 'parent_id');
    conditionMustBeSet(conditions, 'group_id');

    if (conditionMustSet(conditions, 'isStart')) {
      isStart =
        typeof conditions.isStart === 'boolean'
          ? conditions.isStart
          : conditions.isStart === 'true';
    }
  } catch (error) {
    throw error;
  }

  const client = await pg.pool.connect();

  try {
    await client.query('BEGIN');

    let queryText = `SELECT add_task($1, $2, $3, $4);`;
    let params = [
      conditions.mainUser_id,
      conditions.group_id,
      conditions.parent_id,
      isStart,
    ];
    const { rows: newElements } = await client.query(queryText, params);

    const elementId = newElements[0].add_task;

    queryText = `SELECT tsk.id, tl.group_id, tl.p, tl.q,
			tsk.tid, tsk.name, tsk.owner AS tskowner, tsk.note, tsk.parent,
			0 AS status, 0 as duration, 0 AS havechild,	1 as depth
		FROM tasks_list AS tl
		RIGHT JOIN tasks AS tsk ON tl.task_id = tsk.id
		WHERE tl.task_id = $1 AND tl.group_id = $2`;
    params = [elementId, conditions.group_id];

    const { rows: tasks } = await client.query(queryText, params);

    await client.query('commit');

    return Promise.resolve(tasks);
  } catch (error) {
    await client.query('ROLLBACK');

    throw new VError(
      {
        cause: error,
        info: { status: 400 },
      },
      'DatabaseError',
    );
  } finally {
    client.release();
  }
}

/**
 * @func updateTask
 * @param {Object} condition - Get from api
 * @returns { function(...args): Promise }
 * @description Update exists <Task> in database
 * conditions object = { mainUser_id: Number,	id: char(8) }
 */
async function updateTask(conditions) {
  let attributes = '';
  const params = [];

  try {
    conditionMustBeSet(conditions, 'mainUser_id');
    conditionMustBeSet(conditions, 'id');

    params.push(conditions.mainUser_id);
    params.push(conditions.id);
  } catch (error) {
    throw error;
  }

  /* Соберем запрос из значений, которые можно изменить
		- изменение group_id и parent у задачи разрешено вызовом метода updatePosition
    - изменение tid, owner запрещено */
  Object.keys(conditions).forEach(prop => {
    switch (prop) {
      case 'name':
        attributes = `${attributes} name = \$${params.length + 1}`;
        params.push(conditions[prop]);
        break;
      case 'note':
        attributes = `${attributes} note = \$${params.length + 1}`;
        params.push(conditions[prop]);
        break;
      default:
        break;
    }
  });

  /* Если ничего не передано для изменения, то нет смысла делать запрос к базе */
  if (attributes.length === 0) {
    throw new VError(
      {
        info: { status: 400 /* Bad request */ },
      },
      'WrongBody',
    );
  }

  /* Обновляем только те элементы задач, которые состоят в доступных пользователю группах */
  const queryText = `WITH main_visible_task AS (
		SELECT tl.task_id FROM groups_list AS gl
			LEFT JOIN groups AS grp ON gl.group_id = grp.id
			RIGHT JOIN tasks_list AS tl ON (gl.group_id = tl.group_id) AND (tl.task_id = $2)
			WHERE (grp.reading >= gl.user_type)
				AND (grp.el_updating >= gl.user_type)
				AND (gl.user_id = 0 OR gl.user_id = $1)
		)
		UPDATE tasks SET ${attributes} WHERE id IN (SELECT * FROM main_visible_task)
		RETURNING id;`;

  const client = await pg.pool.connect();

  try {
    await client.query('BEGIN');

    const { rows: elements } = await client.query(queryText, params);

    await client.query('commit');

    return Promise.resolve(elements);
  } catch (error) {
    await client.query('ROLLBACK');

    throw new VError(
      {
        cause: error,
        info: { status: 400 },
      },
      'DatabaseError',
    );
  } finally {
    client.release();
  }
}

/**
 * @func deleteTask
 * @param {Object} condition - Get from api
 * @returns { function(...args): Promise }
 * @description Update exists <Task> in database
 * conditions object = { mainUser_id: Number,	id: char(8), group_id: char(8) }
 */
async function deleteTask(conditions) {
  let onlyFromList = true; //eslint-disable-line

  try {
    conditionMustBeSet(conditions, 'mainUser_id');
    conditionMustBeSet(conditions, 'id');
    conditionMustBeSet(conditions, 'group_id');
  } catch (error) {
    throw error;
  }

  const client = await pg.pool.connect();

  try {
    await client.query('BEGIN');

    const queryText = `SELECT delete_task($1, $2, $3, $4);`;
    const params = [
      conditions.mainUser_id,
      conditions.id,
      conditions.group_id,
      onlyFromList,
    ];

    const { rows } = await client.query(queryText, params);

    await client.query('commit');

    return Promise.resolve({ task_id: rows[0].delete_task });
  } catch (error) {
    await client.query('ROLLBACK');

    throw new VError(
      {
        cause: error,
        info: { status: 400 },
      },
      'DatabaseError',
    );
  } finally {
    client.release();
  }
}

/**
 * @func updatePosition
 * @param {Object} condition - Get from api
 * @returns { function(...args): Promise }
 * @description Set new position in tasks_list OR change group for task
 * conditions object - { mainUser_id: Number,	group_id: char(8), id: char(8),
 *  parent_id: char(8), position: char(8), isBefore: Boolean }
 */
async function updatePosition(conditions) {
  let isBefore = false;
  let parent_id = null;
  let position = null;

  try {
    conditionMustBeSet(conditions, 'mainUser_id');
    conditionMustBeSet(conditions, 'group_id');
    conditionMustBeSet(conditions, 'id');

    if (
      conditionMustSet(conditions, 'position') &&
      conditions.position.length > 0
    ) {
      position = conditions.position; // eslint-disable-line
    }

    if (conditionMustSet(conditions, 'parent_id')) {
      parent_id = conditions.parent_id; // eslint-disable-line
    }

    if (conditionMustSet(conditions, 'isBefore')) {
      isBefore =
        typeof conditions.isBefore === 'boolean'
          ? conditions.isBefore
          : conditions.isBefore === 'true';
    }
  } catch (error) {
    throw error;
  }

  const client = await pg.pool.connect();

  const returnObject = { id: conditions.id, groupChanged: false };

  try {
    await client.query('begin');

    const queryText = `SELECT reorder_task($1, $2, $3, $4, $5, $6);`;
    const params = [
      conditions.mainUser_id,
      conditions.group_id,
      conditions.id,
      position,
      isBefore,
      parent_id,
    ];

    const { rows } = await client.query(queryText, params);

    /* значение 2 говорит о том, что сменилась группа, а значит необходимо сказать об этом
			функции create_activity для создания новой активности, в обработчике api */
    if (rows[0].reorder_task === 2) {
      returnObject.groupChanged = true;
    }

    await client.query('commit');

    return Promise.resolve(returnObject);
  } catch (error) {
    await client.query('ROLLBACK');

    throw new VError(
      {
        cause: error,
        info: { status: 400 },
      },
      'DatabaseError',
    );
  } finally {
    client.release();
  }
}

module.exports = {
  getTasks,
  createTask,
  updateTask,
  deleteTask,
  updatePosition,
};

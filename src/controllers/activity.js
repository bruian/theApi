const VError = require('verror');
const { conditionMustBeSet, conditionMustSet } = require('../utils');
const pg = require('../db/postgres');

/* mainUser_id - идентификатор пользователя, который аутентифицирован в системе	относительно
  этого пользователя происходит запрос данных у базы, с ним же связаны все права доступа.
  - Ожидается number */

/* type_el - битовый идентификатор типа элемента, в текущем случае это activity = 2
  - ожидается number */

/* group_id - идентификатор группы относительно, которой будут извлекаться активности
  - ожидается char(8) */

/* id - идентификатор элемента, при наличии этого параметра отбор будет
  производиться только по нему
  - ожидается char(8) */

/* task_id - параметр по которому фильтруются значения элементов
  - ожидается char(8) */

/* userId - параметр по которому фильтруются значения элементов
  - mainUser_id фильтрует по правам доступа, а userId фильтрует уже из доступного списка
  - ожидается number */

/* like - параметр по которому фильтруются значения элементов в	полях name и note
  - ожидается string */

/* limit - параметр который задает предел записей, что выдаст DB
  - ожидается number не больше 40 */

/* offset - параметр который задает сдвиг относительно которого будет
  считываться текущая порция данных
  - ожидается number */

/* start - параметр указывающий начало статуса элемента активности
  - ожидается string со значением ISO DateTime */

/* status - параметр статуса активности, передаётся когда у задачи меняется статус
  и автоматически создает несколько активностей алгоритм описан в модуле клиента
  actions.CREATE_ACTIVITY
  - необязательный параметр, передаётся только когда меняется статус у задачи
  должен совместно идти с "task_id" и "start"
  - ожидается number
*/

/* isStart - параметр указывающий куда поместить создаваемый элемент,
  в начало или конец списка
  - необязательный параметр, отсутсвие которого полагает начало списка
  - ожидается boolean */

/**
 * @func getActivity
 * @param {Object} - conditions
 * @returns {function(...args): Promise}
 * @description Get activity from database. if id is given, then get one activity, else get list activity
 * conditions object - { mainUser_id: Number, group_id: char(8), type_el: Number, id: char(8)
 * 	limit: Number, offset: Number, like: String, userId: Number, task_id: char(8) }
 */
async function getActivity(conditions) {
  let limit = 'null';
  let offset = 'null';
  let pgСonditions = '';
  let pgUserGroups = '';
  let pgGroups = 'main_visible_groups'; // activity visible only for main user
  let pgTypeCondition = '';
  let pgIdCondition = '';
  let pgTaskCondition = '';
  let pgGroupCondition = '';
  let pgSearchText = '';
  let pgLimit = '';

  const params = [];

  try {
    conditionMustBeSet(conditions, 'mainUser_id');
    params.push(conditions.mainUser_id);

    conditionMustBeSet(conditions, 'limit');
    limit = parseInt(conditions.limit, 10);

    if (limit < 1 || limit > 100) {
      throw new VError(
        {
          name: '',
          info: {
            parameter: 'limit',
            value: conditions.limit,
            status: 400 /* Bad request */,
          },
        },
        'WrongParameterLimit',
      );
    }

    conditionMustBeSet(conditions, 'offset');
    offset = parseInt(conditions.offset, 10);

    if (offset < 0) {
      throw new VError(
        {
          info: {
            parameter: 'offset',
            value: conditions.offset,
            status: 400 /* Bad request */,
          },
        },
        'WrongParameterOffset',
      );
    }

    if (limit !== null && offset !== null) {
      pgLimit = `LIMIT \$${params.length + 1} OFFSET \$${params.length + 2}`;
      params.push(limit);
      params.push(offset);
    }

    if (conditionMustSet(conditions, 'type_el') && conditions.type_el.length) {
      pgTypeCondition = ` AND (al.type_el & \$${params.length + 1} > 0)`;
      params.push(Number(conditions.type_el));
    }

    if (
      conditionMustSet(conditions, 'group_id') &&
      conditions.group_id.length
    ) {
      pgGroupCondition = ` AND al.group_id = \$${params.length + 1}`;
      params.push(conditions.group_id);
    }

    if (conditionMustSet(conditions, 'id') && conditions.id.length) {
      pgIdCondition = ` AND al.id = \$${params.length + 1}`;
      params.push(conditions.id);
    }

    if (conditionMustSet(conditions, 'task_id') && conditions.task_id.length) {
      // pgTaskCondition = ` AND act.task_id = \$${params.length + 1}`;
      // params.push(conditions.task_id);

      pgTaskCondition = ` AND act.task_id IN (SELECT * FROM UNNEST(\$${params.length +
        1}::varchar[]))`;
      if (Array.isArray(conditions.task_id)) {
        params.push(conditions.task_id);
      } else {
        params.push([conditions.task_id]);
      }
    }

    if (conditionMustSet(conditions, 'userId') && conditions.userId.length) {
      pgUserGroups = `, user_groups AS (
        SELECT gl.group_id FROM groups_list AS gl
          WHERE gl.group_id IN (SELECT * FROM main_visible_groups) AND gl.user_id = \$${params.length +
            1}
      )`;
      pgGroups = 'user_groups';

      params.push(conditions.user_id);
    }

    if (conditionMustSet(conditions, 'like') && conditions.like.length) {
      pgSearchText = ` AND act.name ILIKE '%\$${params.length + 1}%'`;
      params.push(conditions.like);
    }
  } catch (error) {
    throw error;
  }

  pgСonditions =
    pgIdCondition +
    pgTypeCondition +
    pgTaskCondition +
    pgGroupCondition +
    pgSearchText;

  /* $1 = mainUser_id */
  const queryText = `WITH RECURSIVE main_visible_groups AS (
		SELECT group_id FROM groups_list AS gl
		LEFT JOIN groups AS grp ON gl.group_id = grp.id
		WHERE (grp.reading >= gl.user_type)
			AND (grp.el_reading >= gl.user_type)
			AND (gl.user_id = 0 OR gl.user_id = $1)
		)	${pgUserGroups} SELECT al.id, al.group_id, al.user_id, act.task_id, al.type_el,
			tsk.name, tsk.singular, act.note, act.productive, uf.url as avatar,
			act.part, act.status, act.owner, act.start, act.ends
    FROM activity_list AS al
		LEFT JOIN activity AS act ON al.id = act.id
    LEFT JOIN users_photo AS uf ON (al.user_id = uf.user_id) AND (uf.isavatar = true)
    LEFT JOIN tasks AS tsk ON (act.task_id = tsk.id)
    WHERE al.group_id IN (SELECT * FROM ${pgGroups}) ${pgСonditions}
    ORDER BY ((act.status = 1 or act.status = 5) and act.ends is null) DESC, act.start DESC ${pgLimit};`;

  // ORDER BY act.start DESC ${pgLimit};`;
  // ORDER BY al.group_id, (al.p::float8/al.q) ${pgLimit};`

  const client = await pg.pool.connect();

  try {
    const { rows: elements } = await client.query(queryText, params);

    return Promise.resolve(elements);
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
 * @func createActivity
 * @param {Object} conditions - Get from api
 * @returns { function(...args): Promise }
 * @description Create new <Activity> in database
 * And set new position in activity_list and linked to the task if it exists
 * conditions object - { mainUser_id: Number,	group_id: char(8), type_el: Number, task_id: char(8),
 *  start: ISO-DateTime string, status: Number, isStart: boolean }
 */
async function createActivity(conditions) {
  let task_id = null;
  let start = null;
  let status = null;
  let nextTail = false;

  let queryText = '';
  let params = [];

  try {
    conditionMustBeSet(conditions, 'mainUser_id');
    conditionMustBeSet(conditions, 'group_id');
    conditionMustBeSet(conditions, 'type_el');
    conditionMustBeSet(conditions, 'start');

    const valid = /^(-?(?:[1-9][0-9]*)?[0-9]{4})-(1[0-2]|0[1-9])-(3[01]|0[1-9]|[12][0-9])T(2[0-3]|[01][0-9]):([0-5][0-9]):([0-5][0-9]).([0-9]+)?(Z)?$/.test(
      conditions.start,
    );

    if (!valid) {
      throw new VError(
        {
          info: {
            parameter: 'start',
            value: conditions.start,
            status: 400 /* Bad request */,
          },
        },
        'WrongParameterStart',
      );
    }

    start = conditions.start; // eslint-disable-line

    if (Number(conditions.type_el) === 2) {
      conditionMustBeSet(conditions, 'task_id');
      task_id = conditions.task_id; // eslint-disable-line
    }

    if (conditionMustSet(conditions, 'status')) {
      status = Number(conditions.status); // eslint-disable-line
    }

    if (
      conditionMustSet(conditions, 'next_tail') &&
      conditions.next_tail.length
    ) {
      nextTail = conditions.next_tail; // eslint-disable-line
    }
  } catch (error) {
    throw error;
  }

  /* Добавление элемента activity происходит в 4 этапа
		1) Создание в таблице activity элемента со значениями default:
			task_id = null, name = '', note = '', part = 0, status = 0, owner = mainUser_id,
			productive = false, start = null, ends = null
		2) Добавление id созданного элемента в таблицу activity_list со значениями default:
			group_id = group_id, user_id = mainUser_id, type_el = type_el
		3) Если присутствует параметр start, то обновляется это значение в таблице activity
		4) Если присутствует параметр task_id, то обновляется это значение в таблице activity,
			значение activity.name обновляется на task.name	значение productuve обновляется на true
		5) Если присутствует status отличный от 0, тогда обновляется значение предыдущего
		элемента со статусами "Начато" или "Продолжено", назначается "ends" создается новая
		активность со статусом "Приостановлено" и назначением "start".
	*/

  const client = await pg.pool.connect();

  try {
    // Начало транзакции
    await client.query('BEGIN');

    params = [
      conditions.mainUser_id,
      task_id,
      conditions.group_id,
      Number(conditions.type_el),
      status,
      start,
      nextTail,
    ];

    const { rows: newElements } = await client.query(
      'SELECT create_activity($1, $2, $3, $4, $5, $6, $7)',
      params,
    );
    const changedActivityArr = newElements[0].create_activity;

    // Фиксация транзакции
    await client.query('commit');

    // Получение данных по измененным элементам
    queryText = `SELECT al.id, al.group_id, al.user_id, al.type_el,
      act.task_id, t.name, t.singular, act.note, act.productive, act.part,
      act.status, act.owner, act.start, act.ends, uf.url as avatar
    FROM activity_list AS al
    LEFT JOIN activity AS act ON al.id = act.id
    LEFT JOIN tasks AS t ON act.task_id = t.id
    LEFT JOIN users_photo AS uf ON (al.user_id = uf.user_id) AND (uf.isavatar = true)
    WHERE act.id IN (SELECT * FROM UNNEST($1::varchar[]))
    ORDER BY act.start DESC;`;
    params = [changedActivityArr];
    const { rows: activity_data } = await client.query(queryText, params);

    queryText = `WITH acts(duration, task_id) AS (
      SELECT SUM(extract(EPOCH from act.ends) - extract(EPOCH from act.start)) as duration,
        act.task_id FROM activity_list AS al
      JOIN activity AS act ON (act.id = al.id)
      WHERE (act.task_id IN (SELECT * FROM UNNEST($2::varchar[])))
        AND (act.status = 1 OR act.status = 5)
      GROUP BY act.task_id
    )	SELECT t.id, t.singular, act.status, (SELECT duration FROM acts WHERE acts.task_id = tl.task_id) * 1000 AS duration, act.start
      FROM tasks_list AS tl
      RIGHT JOIN tasks AS t ON tl.task_id = t.id
      JOIN activity_list AS al ON (al.group_id = tl.group_id) AND (al.user_id = $1)
      JOIN activity AS act ON (act.task_id = tl.task_id) 
        AND (act.ends IS NULL OR act.status = 2 OR act.status = 4 OR act.status = 6) 
        AND (act.id = al.id)
      WHERE tl.task_id IN (SELECT * FROM UNNEST($2::varchar[]));`;
    params = [conditions.mainUser_id, activity_data.map(el => el.task_id)];
    const { rows: tasks_data } = await client.query(queryText, params);

    return Promise.resolve({ activity_data, tasks_data });
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
 * @func updateActivity
 * @param {Object} condition - Get from api
 * @returns { function(...args): Promise }
 * @description Update exists <Activity> in database
 * conditions object - { mainUser_id: Number,	id: char(8) }
 */
async function updateActivity(conditions) {
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
		- назначение для активности "task_id", должно изменить значение флага "productive" на true
		- назначить для активности "task_id", разрешено только когда "status" = 0
		- снятие у активности "task_id" - запрещено, а значит и изменение "productive" на false у
		активности с назначенным "task_id" тоже запрещено
		- изменение группы у активности разрешено вызовом метода updatePosition
		- изменение "owner" и "user_id" запрещено
		- изменение "status" у активности запрещено, статус назначается вызовом метода createActivity,
		при этом создается новая активность с указанием нового статуса, активность должна иметь
		ссылку на "task_id" т.к. статусы меняются у задач, а активности поэтапно логируют эти изме-
		нения.
	*/
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

  /* Обновляем только те активности, которые состоят в доступных пользователю группах */
  const queryText = `WITH main_visible_activity AS (
		SELECT al.id FROM groups_list AS gl
			LEFT JOIN groups AS grp ON gl.group_id = grp.id
			RIGHT JOIN activity_list AS al ON (gl.group_id = al.group_id) AND (al.id = $2)
			WHERE (grp.reading >= gl.user_type)
				AND (grp.el_updating >= gl.user_type)
				AND (gl.user_id = 0 OR gl.user_id = $1)
		)
		UPDATE activity SET ${attributes} WHERE id IN (SELECT * FROM main_visible_activity)
		RETURNING id, note;`;

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
 * @func deleteActivity
 * @param {Object} conditions - Get from api
 * @returns {function(...args): Promise}
 * @description Delete exists <Activity> from database
 * conditions object = { mainUser_id: Number,	id: char(8) }
 */
async function deleteActivity(conditions) {
  /* Проверка удаления самой первой активности, по-умолчанию всегда должна существовать и 
		может удаляться только когда удаляется задача к этой активности */
  let checkOne = true;

  try {
    conditionMustBeSet(conditions, 'mainUser_id');
    conditionMustBeSet(conditions, 'id');

    if (conditionMustSet(conditions, 'checkOne') && conditions.checkOne) {
      checkOne = conditions.checkOne; // eslint-disable-line
    }
  } catch (error) {
    throw error;
  }

  let queryText = `SELECT delete_activity($1, $2, $3);`;
  let params = [conditions.mainUser_id, conditions.id, checkOne];

  const client = await pg.pool.connect();

  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      'SELECT task_id FROM activity WHERE id = $1',
      [conditions.id],
    );

    const { rows: delRows } = await client.query(queryText, params);

    await client.query('COMMIT');

    queryText = `WITH acts(duration, task_id) AS (
      SELECT SUM(extract(EPOCH from act.ends) - extract(EPOCH from act.start)) as duration,
        act.task_id FROM activity_list AS al
      JOIN activity AS act ON (act.id = al.id)
      WHERE (act.task_id IN (SELECT * FROM UNNEST($2::varchar[])))
        AND (act.status = 1 OR act.status = 5)
      GROUP BY act.task_id
    )	SELECT t.id, act.status, al.group_id,
        (SELECT duration FROM acts WHERE acts.task_id = tl.task_id) * 1000 AS duration, act.start
      FROM tasks_list AS tl
      RIGHT JOIN tasks AS t ON tl.task_id = t.id
      JOIN activity_list AS al ON (al.group_id = tl.group_id) AND (al.user_id = $1)
      JOIN activity AS act ON (act.task_id = tl.task_id) AND (act.ends IS NULL) AND (act.id = al.id)
      WHERE tl.task_id IN (SELECT * FROM UNNEST($2::varchar[]));`;
    params = [conditions.mainUser_id, rows.map(el => el.task_id)];
    const { rows: tasks_data } = await client.query(queryText, params);

    return Promise.resolve({
      deleted_activity: [{ id: conditions.id }],
      activity_data: [{ id: delRows[0].delete_activity, ends: null }],
      tasks_data,
    });
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
 * @func getRestrictions
 * @param {Object} condition - Get from api
 * @returns { function(...args): Promise }
 * @description Get element <Activity> restrictions
 * conditions object - { mainUser_id: Number,	id: char(8), type: string }
 */
async function getRestrictions(conditions) {
  let queryText = '';
  const params = [];

  try {
    conditionMustBeSet(conditions, 'mainUser_id');
    params.push(conditions.mainUser_id);

    conditionMustBeSet(conditions, 'type');

    if (conditions.type === 'move') {
      conditionMustBeSet(conditions, 'id');
      params.push(conditions.id);
    }
  } catch (error) {
    throw error;
  }

  /* Если ничего не передано для изменения, то нет смысла делать запрос к базе */
  if (conditions.type === 'move') {
    queryText = `WITH act AS (
        SELECT id, task_id, start, ends FROM activity WHERE id = $2
      ), last_activity AS (
        select true as isLast, activity.id from activity, activity_list
        WHERE activity_list.id = activity.id AND activity_list.user_id = $1 ORDER BY start DESC LIMIT 1
      )	SELECT la.isLast, a.start, a.id FROM activity AS a
        LEFT JOIN act ON true
        LEFT JOIN last_activity AS la ON true
        LEFT JOIN tasks as t ON a.task_id = t.id
        RIGHT JOIN activity_list as al ON (al.id = a.id) AND (al.user_id = $1)
          WHERE (a.start <= act.start AND a.id <> act.id AND a.task_id = act.task_id) 
            OR ((a.start <= act.start) AND (a.id <> act.id) 
                AND (a.task_id = t.id AND t.singular = true) AND (a.status = 1 OR a.status = 5))
          ORDER BY a.start DESC
          LIMIT 1;`;
  } else if (conditions.type === 'last_element') {
    queryText = `select true as isLast, activity.start, activity.id from activity, activity_list
      WHERE activity_list.id = activity.id AND activity_list.user_id = $1 ORDER BY start DESC LIMIT 1`;
  } else {
    throw new VError(
      {
        info: { status: 400 /* Bad request */ },
      },
      'NeedTypeString',
    );
  }

  const client = await pg.pool.connect();

  try {
    const { rows: elements } = await client.query(queryText, params);

    // queryText = `SELECT sum(duration.productive_duration) as productive_duration, sum(duration.unproductive_duration) AS unproductive_duration FROM (
    //   SELECT COALESCE(SUM(extract(EPOCH from act.ends) - extract(EPOCH from act.start)), 0) as productive_duration,
    //     0::float as unproductive_duration
    //   FROM activity_list AS al
    //   JOIN activity AS act ON (act.id = al.id)
    //   LEFT JOIN tasks AS t ON (act.task_id = t.id)
    //   WHERE (al.user_id = $1)
    //     AND (t.productive = true)
    //     AND (act.status = 1 OR act.status = 5)
    //     AND (act.start between $2::date and $2::date + 1)
    //   UNION ALL
    //   SELECT 0::float as productive_duration,
    //     COALESCE(SUM(extract(EPOCH from act.ends) - extract(EPOCH from act.start)), 0) as unproductive_duration
    //   FROM activity_list AS al
    //   JOIN activity AS act ON (act.id = al.id)
    //   LEFT JOIN tasks AS t ON (act.task_id = t.id)
    //   WHERE (al.user_id = $1)
    //     AND (t.productive = false)
    //     AND (act.status = 1 OR act.status = 5)
    //     AND (act.start between $2::date and $2::date + 1)
    // ) AS duration;`;

    // const { rows: durations } = await client.query(queryText, [
    //   conditions.mainUser_id,
    //   elements[0].start,
    // ]);

    // return Promise.resolve([{ ...elements[0], ...durations[0] }]);
    return Promise.resolve(elements);
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
 * @func updatePosition
 * @param {Object} condition - Get from api
 * @returns { function(...args): Promise }
 * @description Reorder exists <Activity> in database
 * conditions object - { mainUser_id: Number,	id: char(8),
 *  start: ISO-DateTime string, ends: ISO-DateTime string }
 */
async function updatePosition(conditions) {
  let start = null;
  let ends = null;

  let params = [];

  try {
    conditionMustBeSet(conditions, 'mainUser_id');
    conditionMustBeSet(conditions, 'id');

    params.push(conditions.mainUser_id);
    params.push(conditions.id);
  } catch (error) {
    throw error;
  }

  if (conditionMustSet(conditions, 'start') && conditions.start) {
    start = conditions.start; // eslint-disable-line
  }

  if (conditionMustSet(conditions, 'ends') && conditions.ends) {
    ends = conditions.ends; // eslint-disable-line
  }

  /* Если ничего не передано для изменения, то нет смысла делать запрос к базе */
  if (!start && !ends) {
    throw new VError(
      {
        info: { status: 400 /* Bad request */ },
      },
      'NeedStartOrEnds',
    );
  }

  params.push(start);
  params.push(ends);

  /* Обновляем только те активности, которые состоят в доступных пользователю группах */
  let queryText = `SELECT reorder_activity($1, $2, $3, $4);`;

  const client = await pg.pool.connect();

  try {
    await client.query('BEGIN');
    const { rows } = await client.query(queryText, params);
    await client.query('COMMIT');

    const changedActivityArr = rows[0].reorder_activity;

    // Получение данных по измененным элементам
    queryText = `SELECT act.id, act.task_id, act.start, act.ends FROM activity AS act 
    WHERE act.id IN (SELECT * FROM UNNEST($1::varchar[]))
    ORDER BY act.start DESC;`;
    params = [changedActivityArr];

    const { rows: activity_data } = await client.query(queryText, params);

    queryText = `WITH acts(duration, task_id) AS (
      SELECT SUM(extract(EPOCH from act.ends) - extract(EPOCH from act.start)) as duration,
        act.task_id FROM activity_list AS al
      JOIN activity AS act ON (act.id = al.id)
      WHERE (act.task_id IN (SELECT * FROM UNNEST($2::varchar[])))
        AND (act.status = 1 OR act.status = 5)
      GROUP BY act.task_id
    )	SELECT t.id, (SELECT duration FROM acts WHERE acts.task_id = tl.task_id) * 1000 AS duration, act.start
      FROM tasks_list AS tl
      RIGHT JOIN tasks AS t ON tl.task_id = t.id
      JOIN activity_list AS al ON (al.group_id = tl.group_id) AND (al.user_id = $1)
      JOIN activity AS act ON (act.task_id = tl.task_id) 
        AND (act.ends IS NULL OR act.status = 2 OR act.status = 4 OR act.status = 6) 
        AND (act.id = al.id)
      WHERE tl.task_id IN (SELECT * FROM UNNEST($2::varchar[]));`;
    params = [conditions.mainUser_id, activity_data.map(el => el.task_id)];
    const { rows: tasks_data } = await client.query(queryText, params);

    return Promise.resolve({ activity_data, tasks_data });
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
  getActivity,
  createActivity,
  updateActivity,
  deleteActivity,
  getRestrictions,
  updatePosition,
};

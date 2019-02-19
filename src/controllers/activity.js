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

/* searchText - параметр по которому фильтруются значения элементов в	полях name и note
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
  actions.CREATE_ACTIVITY_ELEMENT
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
  let pgIdCondition = '';
  let pgTaskCondition = '';
  let pgGroupCondition = '';
  let pgSearchText = '';
  let pgLimit = '';

  const params = [];

  try {
    conditionMustBeSet(conditions, 'mainUser_id');
    conditionMustBeSet(conditions, 'type_el');

    params.push(conditions.mainUser_id);
    params.push(Number(conditions.type_el));

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

    if (conditionMustSet(conditions, 'group_id')) {
      pgGroupCondition = ` AND al.group_id = \$${params.length + 1}`;
      params.push(conditions.group_id);
    }

    if (conditionMustSet(conditions, 'id')) {
      pgIdCondition = ` AND al.id = \$${params.length + 1}`;
      params.push(conditions.id);
    }

    if (conditionMustSet(conditions, 'task_id')) {
      pgTaskCondition = ` AND act.task_id = \$${params.length + 1}`;
      params.push(conditions.task_id);
    }

    if (conditionMustSet(conditions, 'userId')) {
      pgUserGroups = `, user_groups AS (
        SELECT gl.group_id FROM groups_list AS gl
          WHERE gl.group_id IN (SELECT * FROM main_visible_groups) AND gl.user_id = \$${params.length +
            1}
      )`;
      pgGroups = 'user_groups';

      params.push(conditions.user_id);
    }

    if (conditionMustSet(conditions, 'like')) {
      pgSearchText = ` AND act.name ILIKE '%\$${params.length + 1}%'`;
      params.push(conditions.like);
    }
  } catch (error) {
    throw error;
  }

  pgСonditions =
    pgIdCondition + pgTaskCondition + pgGroupCondition + pgSearchText;

  /* $1 = mainUser_id */
  const queryText = `WITH RECURSIVE main_visible_groups AS (
		SELECT group_id FROM groups_list AS gl
		LEFT JOIN groups AS grp ON gl.group_id = grp.id
		WHERE (grp.reading >= gl.user_type)
			AND (grp.el_reading >= gl.user_type)
			AND (gl.user_id = 0 OR gl.user_id = $1)
		) ${pgUserGroups} SELECT al.id, al.group_id, al.user_id, act.task_id, al.type_el,
			act.name, act.note, act.productive, uf.url as avatar,
			act.part, act.status, act.owner, act.start, act.ends
		FROM activity_list AS al
		LEFT JOIN activity AS act ON al.id = act.id
		LEFT JOIN users_photo AS uf ON (al.user_id = uf.user_id) AND (uf.isavatar = true)
		WHERE al.group_id IN (SELECT * FROM ${pgGroups}) AND (al.type_el & $2 > 0) ${pgСonditions}
		ORDER BY act.start ${pgLimit};`;
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
  let isStart = false;

  let queryText = '';
  let params = [];
  const returnElements = [];

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

    if (conditionMustSet(conditions, 'task_id')) {
      task_id = conditions.task_id; // eslint-disable-line
    }

    if (conditionMustSet(conditions, 'status')) {
      status = conditions.status; // eslint-disable-line
    }

    if (conditionMustSet(conditions, 'isStart')) {
      isStart =
        typeof conditions.isStart === 'boolean'
          ? conditions.isStart
          : conditions.isStart === 'true';
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

    if (task_id) {
      // Проверка, есть ли права на task_id для текущего пользователя
      queryText = `SELECT tl.task_id FROM groups_list AS gl
				LEFT JOIN groups AS grp ON gl.group_id = grp.id
				RIGHT JOIN tasks_list AS tl ON (gl.group_id = tl.group_id) AND (tl.task_id = $2)
				WHERE (grp.reading >= gl.user_type)
					AND (grp.el_reading >= gl.user_type)
					AND (gl.user_id = 0 OR gl.user_id = $1)`;
      params = [conditions.mainUser_id, task_id];
      const { rowCount } = await client.query(queryText, params);

      // Если прав нет, то запрос вернет пустой результат и транзакция откатится
      if (rowCount === 0) {
        await client.query('ROLLBACK');

        throw new VError(
          {
            info: { status: 400 /* Bad request */ },
          },
          'PermissionDenied',
        );
      }
    }

    /* Обработка ситуации, когда меняется статус у задачи */
    if (status) {
      // Поиск активности со статусами "Started-1" или "Continued-5". Т.к. сперва
      // необходимо приостановить активности с действующим статусом у той задачи,
      // которая в данный момент выполняется и не равна задачи переданной пользователем
      queryText = `SELECT al.id, al.group_id, act.task_id
				FROM activity_list AS al
				RIGHT JOIN activity AS act ON al.id = act.id
				WHERE (al.user_id = $1)
					AND (act.task_id <> $2)
					AND (act.ends is null)
					AND (act.status = 1 OR act.status = 5);`;
      const { rows: existsElements } = await client.query(queryText, params);

      // Если есть такие активности, то запрос вернёт массив с результатом
      if (existsElements && existsElements.length) {
        // Обновление значения активности на переданное от пользователя
        queryText = 'UPDATE activity SET ends = $1 WHERE id = $2;';
        params = [start, existsElements[0].id];
        await client.query(queryText, params);

        // Создание активности для действующей задачи, установка ей статуса  "Suspended-3"
        queryText = `SELECT add_activity($1, $2, $3, $4);`;
        params = [
          conditions.mainUser_id,
          existsElements[0].group_id,
          conditions.type_el,
          isStart,
        ];
        const { rows } = await client.query(queryText, params);

        // Обновление атрибутов задачи
        queryText = `UPDATE activity
					SET (start, task_id, status, productive, part) =
						($1, $2, $3, $4, (SELECT count(id) FROM activity WHERE task_id = $2))
					WHERE id = $5;`;
        params = [
          start,
          existsElements[0].task_id,
          3,
          true,
          rows[0].add_activity,
        ];
        await client.query(queryText, params);

        returnElements.push(existsElements[0].task_id);
      }
    }

    // Поиск активности у той задачи, которая в данный момент принадлежит
    // переданной пользователем задаче и имеет атрибут "ends" == null
    queryText = `SELECT al.id, al.group_id
			FROM activity_list AS al
			RIGHT JOIN activity AS act ON al.id = act.id
			WHERE (al.user_id = $1)
				AND (act.task_id = $2)
				AND (act.ends is null);`;
    params = [conditions.mainUser_id, task_id];
    const { rows } = await client.query(queryText, params);

    // Если есть такая активность, то запрос вернёт массив с результатом
    if (rows && rows.length) {
      // Обновление значения активности на переданное от пользователя
      queryText = 'UPDATE activity SET ends = $1 WHERE id = $2;';
      params = [start, rows[0].id];
      await client.query(queryText, params);
    }

    // Создание в таблице activity элемента и добавление в activity_list
    queryText = `SELECT add_activity($1, $2, $3, $4);`;
    params = [
      conditions.mainUser_id,
      conditions.group_id,
      conditions.type_el,
      isStart,
    ];
    const { rows: newElements } = await client.query(queryText, params);

    const elementId = newElements[0].add_activity;

    // Обновление значения start в таблице activity
    if (start) {
      queryText = 'UPDATE activity SET start = $1 WHERE id = $2;';
      params = [start, elementId];
      await client.query(queryText, params);
    }

    returnElements.push(task_id);

    // Обновление значения task_id в таблице activity
    if (task_id) {
      // Если есть права на задачу, то она слинкуется с элементом активности
      if (status) {
        queryText = `UPDATE activity
					SET (task_id, productive, status, start, part)
						= ($1, $2, $3, $4, (SELECT count(id) FROM activity WHERE task_id = $1))
					WHERE id = $5;`;
        params = [task_id, true, status, start, elementId];
      } else {
        queryText =
          'UPDATE activity SET (task_id, productive) = ($1, $2) WHERE id = $3;';
        params = [task_id, true, elementId];
      }
      await client.query(queryText, params);
    }

    // Фиксация транзакции
    await client.query('commit');

    // Получение данных по добавленному элементу
    if (task_id) {
      // Получение всех активностей по task_id
      queryText = `SELECT al.id, al.group_id, al.user_id, al.type_el,
				act.task_id, act.name, act.note, act.productive, act.part,
				act.status, act.owner, act.start, act.ends, uf.url as avatar
			FROM activity_list AS al
			LEFT JOIN activity AS act ON al.id = act.id
			LEFT JOIN users_photo AS uf ON (al.user_id = uf.user_id) AND (uf.isavatar = true)
			WHERE act.task_id IN (SELECT * FROM UNNEST($1::varchar[]))
      ORDER BY act.start;`;
      // WHERE act.task_id IN (SELECT * FROM UNNEST ($1::integer[]))
      // ORDER BY act.task_id, (al.p::float8/al.q);`
      params = [returnElements];
    } else {
      // Получение одной активности по activity id
      queryText = `SELECT al.id, al.group_id, al.user_id, al.type_el,
				act.task_id, act.name, act.note, act.productive, act.part,
				act.status, act.owner, act.start, act.ends, uf.url as avatar
			FROM activity_list AS al
			LEFT JOIN activity AS act ON al.id = act.id
			LEFT JOIN users_photo AS uf ON (al.user_id = uf.user_id) AND (uf.isavatar = true)
			WHERE al.id = $1;`;
      params = [elementId];
    }
    const { rows: elements } = await client.query(queryText, params);

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
 * @func deleteActivity
 * @param {Object} conditions - Get from api
 * @returns {function(...args): Promise}
 * @description Delete exists <Activity> from database
 * conditions object = { mainUser_id: Number,	id: char, group_id: char(8) }
 */
async function deleteActivity(conditions) {
  const onlyFromList = true;

  try {
    conditionMustBeSet(conditions, 'mainUser_id');
    conditionMustBeSet(conditions, 'group_id');
    conditionMustBeSet(conditions, 'id');
  } catch (error) {
    throw error;
  }

  const queryText = `SELECT delete_activity($1, $2, $3, $4);`;
  const params = [
    conditions.mainUser_id,
    conditions.id,
    conditions.group_id,
    onlyFromList,
  ];

  const client = await pg.pool.connect();

  try {
    await client.query('BEGIN');

    const { rows } = await client.query(queryText, params);

    await client.query('commit');

    return Promise.resolve({ id: rows[0].delete_activity });
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
};

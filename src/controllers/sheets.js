const VError = require('verror');
const { conditionMustBeSet } = require('../utils');
const pg = require('../db/postgres');

/* mainUser_id - идентификатор пользователя, который аутентифицирован в системе	относительно
	этого пользователя происходит запрос данных у базы, с ним же связаны все права доступа.
	- Ожидается number */

/* id - идентификатор элемента, атрибуты которого будут меняться
	- ожидается char(8) */

/* type_el - битовый идентификатор типа элементов в списке
	- ожидается number */

/* name - название списка
	- ожидается string */

/* service - не видимый пользователем sheet, используется для отображения служебной или временной 
  информации. К примеру показ sheet по элементу, который выбрал пользователь в связном sheet
	- ожидается boolean */

/**
 * @func getSheets
 * @param {Object} - conditions
 * @returns { function(...args): Promise }
 * @description Get sheets from database
 * conditions object = { mainUser_id: Number }
 */
async function getSheets(conditions) {
  const params = [];

  try {
    conditionMustBeSet(conditions, 'mainUser_id');

    params.push(conditions.mainUser_id);
  } catch (error) {
    throw error;
  }

  /* $1 = mainUser_id */
  const queryText = `
	SELECT *,
		(SELECT ARRAY(
			SELECT condition::integer
			FROM sheets_conditions
			WHERE sheet_id=sh.id
		)) AS conditions,
		(SELECT ARRAY(
			SELECT value::TEXT
			FROM sheets_conditions
			WHERE sheet_id=sh.id
    )) AS conditionValues,
    (SELECT ARRAY(
			SELECT vision::integer
			FROM sheets_visions
			WHERE sheet_id=sh.id
		)) AS visions,
		(SELECT ARRAY(
			SELECT value::TEXT
			FROM sheets_visions
			WHERE sheet_id=sh.id
		)) AS visionValues
	FROM sheets AS sh WHERE user_id = $1;`;

  const client = await pg.pool.connect();

  try {
    const { rows: data } = await client.query(queryText, params);

    return Promise.resolve(data);
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
 * @func updateSheet
 * @param {Object} conditions - Get from api
 * @param { values: Object } - values that need to be changed
 * @returns { function(...args): Promise }
 * @description Update exists <Sheet> in database
 * conditions object = { mainUser_id: Number,	id: char(8) }
 */
async function updateSheet(conditions) {
  let attributes = '';
  let returning = ' RETURNING id';

  const params = [];

  let haveCondition = false;
  let haveVision = false;

  try {
    conditionMustBeSet(conditions, 'mainUser_id');
    conditionMustBeSet(conditions, 'id');

    params.push(conditions.mainUser_id);
    params.push(conditions.id);
  } catch (error) {
    throw error;
  }

  /* Соберем запрос из значений, которые можно изменить
		- изменение owner запрещено */
  Object.keys(conditions).forEach(prop => {
    switch (prop) {
      case 'name':
        // eslint-disable-next-line
        attributes = `${attributes} name = \$${params.length + 1},`;
        returning = `${returning}, name`;
        params.push(conditions[prop]);
        break;
      case 'condition':
        haveCondition = true;
        break;
      case 'vision':
        haveVision = true;
        break;
      default:
        break;
    }
  });

  /* Если ничего не передано для изменения, то нет смысла делать запрос к базе */
  if (
    attributes.length === 0 &&
    haveCondition === false &&
    haveVision === false
  ) {
    throw new VError(
      {
        name: 'WrongBody',
        info: { status: 400 /* Bad request */ },
      },
      'WrongBody',
    );
  }

  if (attributes.length > 0) {
    attributes = attributes.substring(0, attributes.length - 1);
  }

  /* Обновляем только те элементы задач, которые состоят в доступных пользователю группах */
  const queryText = `
		UPDATE sheets SET ${attributes} WHERE (user_id = $1) AND (id = $2)
		${returning};`;

  const client = await pg.pool.connect();

  try {
    await client.query('BEGIN');

    let result;
    let elements = {
      id: conditions.id,
    };

    if (attributes.length > 0) {
      result = await client.query(queryText, params);
      elements = Object.assign(elements, result.rows[0]);
    }

    if (haveCondition) {
      elements = Object.assign(elements, {
        conditions: [],
        conditionvalues: [],
      });

      for (let i = 0; i < conditions.condition.length; i++) {
        // Первый элемент по индексу в параметрах состояний, будет id sheet, который меняется
        const conditionsParams = [conditions.id];
        let cond = '';

        /* Обработка условий для отображения sheet элементов */
        /* eslint-disable no-loop-func */
        Object.keys(conditions.condition[i]).forEach(key => {
          switch (key) {
            case 'group_id':
              cond = `${cond} ($1, 1, \$${conditionsParams.length + 1}),`;
              break;
            case 'userId':
              cond = `${cond} ($1, 2, \$${conditionsParams.length + 1}),`;
              break;
            case 'parent_id':
              cond = `${cond} ($1, 3, \$${conditionsParams.length + 1}),`;
              break;
            case 'task_id':
              cond = `${cond} ($1, 4, \$${conditionsParams.length + 1}),`;
              break;
            default:
              break;
          }

          if (conditions.condition[i][key] === '') {
            conditionsParams.push(null);
          } else {
            conditionsParams.push(JSON.stringify(conditions.condition[i][key]));
          }
        });
        /* eslint-enable no-loop-func */

        cond = cond.substring(0, cond.length - 1);

        const querySheetsConditions = `
          INSERT INTO sheets_conditions (sheet_id, condition, value) VALUES ${cond}
          ON CONFLICT (sheet_id, condition) DO UPDATE SET value = EXCLUDED.value
          RETURNING condition, value;`;

        // eslint-disable-next-line
        result = await client.query(querySheetsConditions, conditionsParams);
        elements.conditions.push(result.rows[0].condition);
        elements.conditionvalues.push(result.rows[0].value);
      }
    }

    if (haveVision) {
      elements = Object.assign(elements, {
        visions: [],
        visionvalues: [],
      });

      for (let i = 0; i < conditions.vision.length; i++) {
        // Первый элемент по индексу в параметрах состояний, будет id sheet, который меняется
        const visionsParams = [conditions.id];
        let visi = '';

        /* Обработка условий для отображения sheet элементов */
        /* eslint-disable no-loop-func */
        Object.keys(conditions.vision[i]).forEach(key => {
          switch (key) {
            case 'activityStatus':
              visi = `${visi} ($1, 1, \$${visionsParams.length + 1}),`;
              break;
            default:
              break;
          }

          if (conditions.vision[i][key] === '') {
            visionsParams.push(null);
          } else {
            visionsParams.push(JSON.stringify(conditions.vision[i][key]));
          }
        });
        /* eslint-enable no-loop-func */

        visi = visi.substring(0, visi.length - 1);

        const querySheetsVisions = `
        INSERT INTO sheets_visions (sheet_id, vision, value) VALUES ${visi}
        ON CONFLICT (sheet_id, vision) DO UPDATE SET value = EXCLUDED.value
        RETURNING vision, value;`;

        // eslint-disable-next-line
        result = await client.query(querySheetsVisions, visionsParams);
        elements.visions.push(result.rows[0].vision);
        elements.visionvalues.push(result.rows[0].value);
      }
    }

    await client.query('COMMIT');

    return Promise.resolve([elements]);
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
 * @func createSheet
 * @param {Object} conditions
 * @returns { function(...args): Promise }
 * @description Create new <Sheet> in database
 * conditions object = { mainUser_id: Number, type_el: Number, name: String }
 */
async function createSheet(conditions) {
  let queryValues = '';
  let queryFields = '';

  const params = [];

  try {
    conditionMustBeSet(conditions, 'mainUser_id');
    conditionMustBeSet(conditions, 'type_el');
    conditionMustBeSet(conditions, 'name');

    queryFields = `${queryFields} user_id, owner_id`;
    queryValues = `${queryValues} \$${params.length + 1}, \$${params.length +
      1}`;
    params.push(conditions.mainUser_id);

    queryFields = `${queryFields}, type_el`;
    queryValues = `${queryValues}, \$${params.length + 1}`;
    params.push(Number(conditions.type_el));

    queryFields = `${queryFields}, name`;
    queryValues = `${queryValues}, \$${params.length + 1}`;
    params.push(conditions.name);
  } catch (error) {
    throw error;
  }

  const client = await pg.pool.connect();

  try {
    // Начало транзакции
    await client.query('BEGIN');

    // Получение одной активности по activity id
    const queryText = `INSERT INTO sheets (${queryFields}) VALUES (${queryValues})	RETURNING *;`;

    const { rows: elements } = await client.query(queryText, params);

    for (let i = 0; i < elements.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(elements[i], 'conditions')) {
        elements[i].conditions = [];
        elements[i].values = [];
      }

      if (!Object.prototype.hasOwnProperty.call(elements[i], 'visions')) {
        elements[i].visions = [];
        elements[i].visionValues = [];
      }
    }

    // Фиксация транзакции
    await client.query('COMMIT');

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
 * @func deleteSheet
 * @param {Object} conditions
 * @returns { function(...args): Promise }
 * @description Delete exist <Sheet> in database
 * conditions object = { mainUser_id: Number, id: char(8) }
 */
async function deleteSheet(conditions) {
  try {
    conditionMustBeSet(conditions, 'mainUser_id');
    conditionMustBeSet(conditions, 'id');
  } catch (error) {
    throw error;
  }

  const client = await pg.pool.connect();

  try {
    await client.query('BEGIN');
    const queryText = `DELETE FROM sheets WHERE (owner_id = $1) AND (id = $2) AND (service = false) AND (defaults = false);`;
    const params = [conditions.mainUser_id, conditions.id];
    await client.query(queryText, params);

    await client.query('COMMIT');

    return Promise.resolve({ id: conditions.id });
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
  getSheets,
  updateSheet,
  createSheet,
  deleteSheet,
};

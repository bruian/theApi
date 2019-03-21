const VError = require('verror');
const { conditionMustBeSet, conditionMustSet } = require('../utils');
const pg = require('../db/postgres');

/* mainUser_id - идентификатор пользователя, который аутентифицирован в системе	относительно
	этого пользователя происходит запрос данных у базы, с ним же связаны все права доступа.
	- Ожидается number */

/* id - идентификатор элемента, атрибуты которого будут меняться
	- ожидается number */

/* type_el - битовый идентификатор типа элементов в списке
	- ожидается number */

/* sheet_id - элемент sheet который присутствует в layout
	- ожидается string */

/* layout - идентификатор раскладки в котором находится sheet
	- ожидается number */

/**
 * @func getLayouts
 * @param {Object} - conditions
 * @returns { function(...args): Promise }
 * @description Get layouts from database
 * conditions object = { mainUser_id: Number }
 */
async function getLayouts(conditions) {
  const params = [];

  try {
    conditionMustBeSet(conditions, 'mainUser_id');

    params.push(conditions.mainUser_id);
  } catch (error) {
    throw error;
  }

  /* $1 = mainUser_id */
  const queryText = `
	SELECT id, type_el,	sheet_id,	position, type_layout, element_id
	FROM layouts WHERE user_id = $1;`;

  const client = await pg.pool.connect();

  try {
    const { rows: data } = await client.query(queryText, params);

    return Promise.resolve({
      generalLayouts: data.filter(el => el.position === 1),
      additionalLayouts: data.filter(el => el.position === 2),
    });
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
 * @func updateLayout
 * @param {Object} conditions - Get from api
 * @param { values: Object } - values that need to be changed
 * @returns { function(...args): Promise }
 * @description Update exists <Layout> in database
 * conditions object = { mainUser_id: Number,	id: number }
 */
async function updateLayout(conditions) {
  let attributes = '';
  let returning = ' RETURNING id, position';

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
		- изменение owner запрещено */
  Object.keys(conditions).forEach(prop => {
    switch (prop) {
      case 'type_el':
        attributes = `${attributes} type_el = \$${params.length + 1},`;
        returning = `${returning}, type_el`;
        params.push(Number(conditions[prop]));
        break;
      case 'sheet_id':
        attributes = `${attributes} sheet_id = \$${params.length + 1},`;
        returning = `${returning}, sheet_id`;
        params.push(conditions[prop]);
        break;
      case 'position':
        attributes = `${attributes} position = \$${params.length + 1},`;
        params.push(Number(conditions[prop]));
        break;
      case 'type_layout':
        attributes = `${attributes} type_layout = \$${params.length + 1},`;
        params.push(Number(conditions[prop]));
        break;
      case 'element_id':
        attributes = `${attributes} element_id = \$${params.length + 1},`;
        params.push(conditions[prop]);
        break;
      default:
        break;
    }
  });

  /* Если ничего не передано для изменения, то нет смысла делать запрос к базе */
  if (attributes.length === 0) {
    throw new VError(
      /* Bad request */
      {
        name: 'WrongBody',
        info: { status: 400 },
      },
      'WrongBody',
    );
  }

  if (attributes.length > 0) {
    attributes = attributes.substring(0, attributes.length - 1);
  }

  const queryText = `
		UPDATE layouts SET ${attributes} WHERE (user_id = $1) AND (id = $2)
		${returning};`;

  const client = await pg.pool.connect();

  try {
    await client.query('BEGIN');
    const { rows: data } = await client.query(queryText, params);
    await client.query('COMMIT');

    return Promise.resolve({
      generalLayouts: data.filter(el => el.position === 1),
      additionalLayouts: data.filter(el => el.position === 2),
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
 * @func createLayout
 * @param {Object} conditions
 * @returns { function(...args): Promise }
 * @description Create new <layout> in database
 * conditions object = { mainUser_id: Number, id: Number, position: Number,
 * 	type_el: Number, sheet_id: char(8) }
 */
async function createLayout(conditions) {
  let params = [];
  let element_id = '';
  let sheet_id = '';

  try {
    conditionMustBeSet(conditions, 'mainUser_id');
    conditionMustBeSet(conditions, 'id');
    conditionMustBeSet(conditions, 'position');
    conditionMustBeSet(conditions, 'type_el');
    conditionMustBeSet(conditions, 'type_layout');

    if (conditionMustSet(conditions, 'element_id')) {
      element_id = conditions.element_id; // eslint-disable-line
    }

    if (conditionMustSet(conditions, 'sheet_id')) {
      sheet_id = conditions.sheet_id; // eslint-disable-line
    }

    params = [
      conditions.mainUser_id,
      conditions.id,
      conditions.position,
      conditions.type_el,
      sheet_id,
      conditions.type_layout,
      element_id,
    ];
  } catch (error) {
    throw error;
  }

  const queryText = `INSERT INTO layouts (user_id, id, position, type_el, sheet_id, type_layout, element_id) 
  VALUES ($1, $2, $3, $4, $5, $6, $7)	RETURNING id, position, type_el, sheet_id, type_layout, element_id;`;

  const client = await pg.pool.connect();

  try {
    await client.query('BEGIN');
    const { rows: data } = await client.query(queryText, params);
    await client.query('COMMIT');

    return Promise.resolve({
      generalLayouts: data.filter(el => el.position === 1),
      additionalLayouts: data.filter(el => el.position === 2),
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
 * @func deleteLayout
 * @param {Object} conditions
 * @returns { function(...args): Promise }
 * @description Delete exist <layout> in database
 * conditions object = { mainUser_id: Number, id: Number }
 */
async function deleteLayout(conditions) {
  try {
    conditionMustBeSet(conditions, 'mainUser_id');
    conditionMustBeSet(conditions, 'id');
  } catch (error) {
    throw error;
  }

  const client = await pg.pool.connect();
  const params = [conditions.mainUser_id, conditions.id];
  const queryText = `DELETE FROM layouts WHERE (user_id = $1) AND (id = $2);`;

  try {
    await client.query('BEGIN');
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
  getLayouts,
  updateLayout,
  createLayout,
  deleteLayout,
};

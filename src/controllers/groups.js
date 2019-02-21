const VError = require('verror');
const { conditionMustBeSet, conditionMustSet } = require('../utils');
const pg = require('../db/postgres');

// function constructHierarchy(rows, parentId) {
//   const hRows = [];

//   for (let i = 0; i < rows.length; i++) {
//     const record = Object.assign({}, rows[i]);
//     if (
//       (parentId === null && record.parent === null) ||
//       record.parent === parentId
//     ) {
//       const innerRows = constructHierarchy(rows, record.id);
//       if (innerRows.length > 0) {
//         record.children = innerRows;
//         record.havechild = 1;
//       } else {
//         record.havechild = 0;
//       }

//       hRows.push(record);
//     }
//   }

//   return hRows;
// }

/**
 * @func getGroups
 * @param {Object} - conditions
 * @returns {Promise}
 * @description Get groups from database. If group_id is given, then get one group, else get groups arr
 * conditions object = { mainUser_id: Number, group_id: char(8), limit: Number, offset: Number,
 *  like: String, userId: Number, parent_id: char(8) }
 */
async function getGroups(conditions) {
  let limit = 30;
  let offset = 0;
  let selectGroup = false;
  let pgСonditions = '';
  let pgUserGroups = '';
  let pgGroups = 'main_visible_groups'; // groups visible only for main user
  let pgParentCondition = ' AND g.parent is null'; // select Top level groups
  let pgParentCondition2 = 'parent is null';
  let pgGroupCondition = '';
  let pgSearchText = '';
  let pgLimit = '';

  const params = [];

  try {
    conditionMustBeSet(conditions, 'mainUser_id');
    params.push(conditions.mainUser_id);

    if (conditionMustSet(conditions, 'parent_id')) {
      pgParentCondition = ` AND g.parent = \$${params.length + 1}`;
      pgParentCondition2 = `parent = \$${params.length + 1}`;
      params.push(conditions.parent_id);
      selectGroup = true;
    }

    if (conditionMustSet(conditions, 'group_id')) {
      pgGroupCondition = ` AND g.id = \$${params.length + 1}`;
      params.push(conditions.group_id);
      selectGroup = true;
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
      pgSearchText = ` AND g.name ILIKE '%\$${params.length + 1}%'`;
      params.push(conditions.like);
    }

    if (!selectGroup) {
      if (conditionMustSet(conditions, 'limit')) {
        limit = Number(conditions.limit);
      }

      if (conditionMustSet(conditions, 'offset')) {
        offset = Number(conditions.offset);
      }

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

  pgСonditions = pgParentCondition + pgGroupCondition + pgSearchText;

  /* $1 = mainUser_id */
  const queryText = `WITH RECURSIVE main_visible_groups AS (
		  SELECT group_id FROM groups_list AS gl
			LEFT JOIN groups AS grp ON gl.group_id = grp.id
			WHERE grp.reading >= gl.user_type AND (gl.user_id = 0 OR gl.user_id = $1)
		) ${pgUserGroups}, descendants(id, parent, depth, path) AS (
			SELECT id, parent, 1 depth, ARRAY[id]::varchar[] FROM groups WHERE ${pgParentCondition2}
		UNION
			SELECT g.id, g.parent, d.depth + 1, path::varchar[] || g.id::varchar FROM groups g
			JOIN descendants d ON g.parent = d.id
		)
    SELECT g.id, g.parent, g.name, g.group_type, g.owner, 
      g.creating, g.reading, g.updating, g.deleting, 
      g.el_reading, g.el_creating, g.el_updating, g.el_deleting,
      gl.user_id, gl.user_type, gl.p, gl.q, dsc.depth,
			(SELECT COUNT(*) FROM groups WHERE parent = g.id) AS havechild
		FROM groups_list AS gl
		LEFT JOIN groups AS g ON gl.group_id = g.id
		JOIN (SELECT max(depth) AS depth, descendants.path[1] AS parent_id
			    FROM descendants GROUP BY descendants.path[1]) AS dsc ON gl.group_id = dsc.parent_id
		WHERE gl.group_id IN (SELECT * FROM ${pgGroups}) ${pgСonditions}
		ORDER BY (gl.p::float8/gl.q) ${pgLimit};`;

  const client = await pg.pool.connect();

  try {
    const { rows: groups } = await client.query(queryText, params);

    groups.forEach(el => {
      el.havechild = parseInt(el.havechild, 10); // eslint-disable-line
      if (el.havechild) el.children = []; // eslint-disable-line
    });

    return Promise.resolve(groups);
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
 * @func createGroup
 * @param {Object} - conditions
 * @returns {function(...args): Promise}
 * @description Create new group
 * conditions object = { mainUser_id: Number, name: Number, parent: char(8) }
 */
async function createGroup(conditions) {
  let isStart = true;

  try {
    conditionMustBeSet(conditions, 'mainUser_id');
    conditionMustBeSet(conditions, 'parent_id');

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

    let queryText = `SELECT add_group($1, $2, $3, $4)`;
    let params = [conditions.mainUser_id, conditions.parent_id, 2, isStart];

    const { rows: newElements } = await client.query(queryText, params);

    const elementId = newElements[0].add_group;

    queryText = `SELECT g.id, g.parent, g.name, g.group_type, g.creating, g.reading,
      g.updating, g.deleting, g.el_creating, g.el_reading, g.el_updating, g.el_deleting,
      g.owner, g.owner AS user_id, 1 AS user_type, 0 as havechild
    FROM groups AS g
    WHERE g.id = $1`;
    params = [elementId];

    const { rows: groups } = await client.query(queryText, params);

    await client.query('COMMIT');

    return Promise.resolve(groups);
  } catch (error) {
    await client.query('ROLLBACK');

    throw new VError(
      {
        cause: error,
        info: { status: 500 },
      },
      'DatabaseError',
    );
  } finally {
    client.release();
  }
}

/**
 * @func updateGroup
 * @param {Object} condition - Get from api
 * @returns { function(...args): Promise }
 * @description Update exists <Group> in database
 * conditions object = { mainUser_id: Number,	group_id: char(8) }
 */
async function updateGroup(conditions) {
  let attributes = '';
  const params = [];

  try {
    conditionMustBeSet(conditions, 'mainUser_id');
    conditionMustBeSet(conditions, 'group_id');

    params.push(conditions.group_id);
  } catch (error) {
    throw error;
  }

  /* Соберем запрос из значений, которые можно изменить */
  Object.keys(conditions).forEach(prop => {
    switch (prop) {
      case 'name':
        attributes = `${attributes} name = \$${params.length + 1}`;
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

  const client = await pg.pool.connect();

  try {
    await client.query('BEGIN');

    /* Обновляем только те элементы, которые состоят в доступных пользователю группах */
    let queryText = `SELECT user_type, reading, updating FROM groups_list AS gl
      LEFT JOIN groups AS gr ON (gl.group_id = gr.id)
      WHERE (gl.user_id = $1) AND (gl.group_id = $2);`;
    const selectParams = [conditions.mainUser_id, conditions.group_id];
    const { rows } = await client.query(queryText, selectParams);
    let result;

    if (rows.length > 0) {
      if (
        rows[0].reading <= rows[0].user_type &&
        rows[0].updating <= rows[0].user_type
      ) {
        queryText = `UPDATE groups SET ${attributes} WHERE id = $1 RETURNING id;`;
        result = await client.query(queryText, params);
      } else {
        return Promise.reject(
          new VError({ info: { status: 400 } }, 'NoUpdateRights'),
        );
      }
    } else {
      return Promise.reject(new VError({ info: { status: 400 } }, 'NoRecords'));
    }

    await client.query('commit');

    return Promise.resolve(result.rows);
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
 * @func removeGroup
 * @param {Object} - conditions
 * @returns { function(...args): Promise }
 * @description Delete exists group
 * conditions object = { mainUser_id: Number, group_id: char(8) }
 */
async function removeGroup(conditions) {
  let onlyFromList = true; //eslint-disable-line

  try {
    conditionMustBeSet(conditions, 'mainUser_id');
    conditionMustBeSet(conditions, 'group_id');
  } catch (error) {
    throw error;
  }

  const client = await pg.pool.connect();

  try {
    await client.query('BEGIN');

    const queryText = `SELECT delete_group($1, $2, $3);`;
    const params = [conditions.mainUser_id, conditions.group_id, onlyFromList];
    const { rows } = await client.query(queryText, params);

    await client.query('COMMIT');

    return Promise.resolve({ group_id: rows[0].delete_group });
  } catch (error) {
    await client.query('ROLLBACK');

    throw new VError(
      {
        cause: error,
        info: { status: 500 },
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
 * @description Set new position in groups_list
 * conditions object - { mainUser_id: Number,	group_id: char(8), parent_id: char(8),
 *  position: char(8), isBefore: Boolean }
 */
async function updatePosition(conditions) {
  let isBefore = false;
  let parent_id = null;
  let position = null;

  try {
    conditionMustBeSet(conditions, 'mainUser_id');
    conditionMustBeSet(conditions, 'group_id');

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

  try {
    await client.query('begin');

    const queryText = `SELECT reorder_group($1, $2, $3, $4, $5);`;
    const params = [
      conditions.mainUser_id,
      conditions.group_id,
      position,
      isBefore,
      parent_id,
    ];

    await client.query(queryText, params);

    await client.query('commit');

    return Promise.resolve({ group_id: conditions.group_id });
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
  getGroups,
  createGroup,
  updateGroup,
  removeGroup,
  updatePosition,
};

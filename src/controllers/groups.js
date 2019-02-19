const VError = require('verror');
const { conditionMustBeSet, conditionMustSet } = require('../utils');
const pg = require('../db/postgres');

function constructHierarchy(rows, parentId) {
  const hRows = [];

  for (let i = 0; i < rows.length; i++) {
    const record = Object.assign({}, rows[i]);
    if (
      (parentId === null && record.parent === null) ||
      record.parent === parentId
    ) {
      const innerRows = constructHierarchy(rows, record.id);
      if (innerRows.length > 0) {
        record.children = innerRows;
        record.havechild = 1;
      } else {
        record.havechild = 0;
      }

      hRows.push(record);
    }
  }

  return hRows;
}

/**
 * @func getGroups
 * @param {Object} - conditions
 * @returns {function(...args): Promise}
 * @description Get exists groups
 * conditions object = { mainUser_id: Number, userId: Number, group_id: char(8),
 * 	context_id: char(8), like: String, limit: Number, offset: Number }
 */
async function getGroups(conditions) {
  let selectGroup = false;
  let pgLikeCondition = '';
  // let pgUserTypeCondition = '';
  let pgPortions = '';
  let limit = 30;
  let offset = 0;
  let whose = '';
  let queryText = '';
  const params = [];

  try {
    conditionMustBeSet(conditions, 'mainUser_id');

    params.push(conditions.mainUser_id); // $1

    // По-умолчанию выборка по всем группам, где владелец не main_user
    // whose = ` AND grp.owner != $1`;

    if (conditionMustSet(conditions, 'group_id')) {
      selectGroup = true;
      whose = `gl_one.group_id = \$${params.length + 1}`;
      params.push(conditions.group_id);
    }

    // if (conditionMustSet(conditions, 'user_type')) {
    //   pgUserTypeCondition = '';
    // }

    if (conditionMustSet(conditions, 'userId')) {
      selectGroup = true;
      whose = `gl_one.user_id = \$${params.length + 1}`;
      params.push(conditions.userId);
    }

    if (conditionMustSet(conditions, 'like')) {
      pgLikeCondition = ` AND (grp.name ILIKE '%\$${params.length + 1}%')`;
      params.push(conditions.like);
    }

    if (conditionMustSet(conditions, 'limit')) {
      limit = Number(conditions.limit);
    }

    if (conditionMustSet(conditions, 'offset')) {
      offset = Number(conditions.offset);
    }
    pgPortions = `LIMIT \$${params.length + 1} OFFSET \$${params.length + 2}`;
    params.push(limit);
    params.push(offset);
  } catch (error) {
    throw error;
  }

  if (selectGroup) {
    queryText = `WITH RECURSIVE recursive_tree (id, parent, path, user_type, level) AS (
			SELECT g_one.id, g_one.parent, CAST (g_one.id AS VARCHAR (50)) AS path, gl_one.user_type, 1
				FROM groups_list AS gl_one
			RIGHT JOIN groups AS g_one ON (gl_one.group_id = g_one.id)
			WHERE g_one.parent IS NULL AND ${whose}
				UNION
			SELECT g_two.id, g_two.parent, CAST (recursive_tree.PATH ||'->'|| g_two.id AS VARCHAR(50)), gl_two.user_type, level + 1
				FROM groups_list AS gl_two
			RIGHT JOIN groups AS g_two ON (gl_two.group_id = g_two.id)
			INNER JOIN recursive_tree ON (recursive_tree.id = g_two.parent)
		)
		SELECT recursive_tree.id, recursive_tree.user_type, grp.name, recursive_tree.parent, recursive_tree.level, recursive_tree.path,
				grp.creating, grp.reading, grp.updating, grp.deleting, grp.el_creating,
				grp.el_reading, grp.el_updating, grp.el_deleting, grp.group_type FROM recursive_tree
		LEFT JOIN groups AS grp ON recursive_tree.id = grp.id
		ORDER BY path;`;
  } else {
    queryText = `SELECT group_id AS id, user_type, name, parent, creating, reading, updating, deleting,
				el_creating, el_reading, el_updating, el_deleting, group_type, 0 AS haveChild, owner FROM groups_list AS gl
			RIGHT JOIN groups AS grp ON gl.group_id = grp.id ${whose}
			WHERE (grp.parent IS null)
				AND (gl.group_id NOT IN (SELECT parent FROM groups WHERE parent IS NOT null GROUP BY parent))
				AND (grp.reading >= gl.user_type)
				AND (gl.user_id = 0 OR gl.user_id = $1)
				${pgLikeCondition}
		UNION
		SELECT group_id AS id, user_type, name, parent, creating, reading, updating, deleting,
				el_creating, el_reading, el_updating, el_deleting, group_type, 1 AS haveChild, owner FROM groups_list AS gl
			RIGHT JOIN groups AS grp ON gl.group_id = grp.id ${whose}
			WHERE (grp.parent IS null)
				AND (gl.group_id IN (SELECT parent FROM groups WHERE parent IS NOT null GROUP BY parent))
				AND (grp.reading >= gl.user_type)
				AND (gl.user_id = 0 OR gl.user_id = $1)
				${pgLikeCondition}
		${pgPortions};`;
  }

  const client = await pg.pool.connect();

  try {
    const { rows: groups } = await client.query(queryText, params);

    if (selectGroup) {
      let hierarchicalRows = [];

      hierarchicalRows = constructHierarchy(groups, null);

      return Promise.resolve(hierarchicalRows);
    }

    groups.forEach(el => {
      if (el.havechild) el.children = []; // eslint-disable-line
    });

    return Promise.resolve(groups);
  } catch (error) {
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
 * @func createGroup
 * @param {Object} - conditions
 * @returns {function(...args): Promise}
 * @description Create new group
 * conditions object = { mainUser_id: Number, name: Number, parent: char(8) }
 */
async function createGroup(conditions) {
  let params = [];
  let pgFields = 'owner';
  let pgValues = '$1';

  try {
    conditionMustBeSet(conditions, 'mainUser_id');
    params.push(conditions.mainUser_id); // $1

    conditionMustBeSet(conditions, 'name');
    pgFields = `${pgFields}, name`;
    pgValues = `${pgValues}, \$${params.length + 1}`;
    params.push(conditions.name);

    if (conditionMustSet(conditions, 'parent')) {
      pgFields = `${pgFields}, parent`;
      pgValues = `${pgValues}, \$${params.length + 1}`;
      params.push(conditions.parent);
    }
  } catch (error) {
    throw error;
  }

  const client = await pg.pool.connect();

  try {
    await client.query('BEGIN');

    let queryText = `
      INSERT INTO groups (${pgFields}) VALUES (${pgValues})
      RETURNING *, 1 as user_type, 0 as haveChild;`;
    const { rows: groups } = await client.query(queryText, params);

    queryText = `
      INSERT INTO groups_list (user_id, group_id) VALUES ($1, $2)`;
    params = [conditions.mainUser_id, groups[0].id];
    await client.query(queryText, params);

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
 * @func deleteGroup
 * @param {Object} - conditions
 * @returns { function(...args): Promise }
 * @description Get exists users
 * conditions object = { mainUser_id: Number, group_id: char(8) }
 */
async function deleteGroup(conditions) {
  let params = [];

  try {
    conditionMustBeSet(conditions, 'mainUser_id');
    conditionMustBeSet(conditions, 'group_id');
    params.push(conditions.group_id);
  } catch (error) {
    throw error;
  }

  const client = await pg.pool.connect();

  try {
    await client.query('BEGIN');

    let queryText = `
      SELECT task_id FROM tasks_list WHERE group_id = $1;`;
    const { rows } = await client.query(queryText, params);

    if (rows.length > 0) {
      throw new VError(
        {
          info: { status: 400 },
        },
        'GroupHasElements',
      );
    }

    queryText = `
      SELECT user_type FROM groups_list WHERE (group_id = $1 AND user_id = $2);`;
    params.push(conditions.mainUser_id);
    const { rows: userType } = await client.query(queryText, params);

    if (userType.length === 0) {
      throw new VError(
        {
          info: { status: 400 },
        },
        'NoRows',
      );
    } else if (userType[0].user_type > 1) {
      throw new VError(
        {
          info: { status: 400 },
        },
        'DeleteCanOwner',
      );
    }

    queryText = `
      DELETE FROM groups_list WHERE (group_id = $1);`;
    params = [conditions.group_id];
    await client.query(queryText, params);

    await client.query('COMMIT');

    return Promise.resolve({ group_id: conditions.group_id });
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

module.exports = {
  getGroups,
  createGroup,
  deleteGroup,
};

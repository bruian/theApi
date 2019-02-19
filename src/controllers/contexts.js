const VError = require('verror');
const { conditionMustBeSet, conditionMustSet } = require('../utils');
const pg = require('../db/postgres');

/**
 * @func getContexts
 * @param {Object} - conditions
 * @returns { function(...args): Promise }
 * @description Get exists context
 * conditions object = { mainUser_id: Number, context_id: char(8), task_id: char(8), like: String,
 * 	limit: Number, offset: Number }
 */
async function getContexts(conditions) {
  let pgPortions = '';
  let limit = 30;
  let offset = 0;
  let pgTaskCondition = '';
  let pgContextCondition = '';
  let pgLike = '';
  let queryText = '';
  const params = [];

  try {
    conditionMustBeSet(conditions, 'mainUser_id');
    params.push(conditions.mainUser_id);

    if (conditionMustSet(conditions, 'limit')) {
      limit = Number(conditions.limit);
    }

    if (conditionMustSet(conditions, 'offset')) {
      offset = Number(conditions.offset);
    }
    pgPortions = `LIMIT \$${params.length + 1} OFFSET \$${params.length + 2}`;
    params.push(limit);
    params.push(offset);

    if (conditionMustSet(conditions, 'context_id')) {
      pgContextCondition = ` AND cl.context_id = \$${params.length + 1}`;
      params.push(conditions.context_id);
    }

    if (conditionMustSet(conditions, 'task_id')) {
      pgTaskCondition = ` AND tl.task_id = \$${params.length + 1}`;
      params.push(conditions.task_id);
    }

    if (conditionMustSet(conditions, 'like')) {
      pgLike = ` AND c.value ILIKE '%\$${params.length}%'`;
      params.push(conditions.like);
    }
  } catch (error) {
    throw error;
  }

  queryText = `WITH main_visible_groups AS (
		SELECT group_id FROM groups_list AS gl
			LEFT JOIN groups AS grp ON gl.group_id = grp.id
			WHERE grp.reading >= gl.user_type AND (gl.user_id = 0 OR gl.user_id = $1)
		)
		SELECT tl.group_id, tl.task_id, cl.context_id, c.value,
			cs.user_id, cs.inherited_id, cs.active, cs.note, cs.activity_type FROM tasks_list AS tl
		RIGHT JOIN context_list AS cl ON cl.task_id = tl.task_id
		RIGHT JOIN context AS c ON cl.context_id = c.id
		RIGHT JOIN context_setting AS cs ON cs.context_id = cl.context_id AND cs.user_id = $1
		WHERE tl.group_id IN (SELECT * FROM main_visible_groups) 
			${pgTaskCondition} 
			${pgContextCondition}
			${pgLike}
		ORDER BY tl.group_id, tl.task_id 
		${pgPortions};`;

  const client = await pg.pool.connect();

  try {
    const { rows: contexts } = await client.query(queryText, params);

    return Promise.resolve(contexts);
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
 * @func addContext
 * @param {Object} - conditions
 * @returns { function(...args): Promise }
 * @description add context to task element
 * conditions object = { mainUser_id: Number, task_id: char(8), values: Object }
 */
async function addContext(conditions) {
  let queryText = '';

  try {
    conditionMustBeSet(conditions, 'mainUser_id');
    conditionMustBeSet(conditions, 'task_id');

    // conditionMustBeSet(conditions, 'values');
    conditionMustBeSet(conditions, 'context_value');
    // conditionMustBeSet(conditions, 'context_id');
  } catch (error) {
    throw error;
  }

  const { context_value = null, context_id = null } = conditions;

  const client = await pg.pool.connect();

  try {
    await client.query('BEGIN');

    queryText = `SELECT add_task_context($1, $2, $3, $4)`;
    const params = [
      conditions.mainUser_id,
      conditions.task_id,
      context_id,
      context_value,
    ];

    const { rows: result } = await client.query(queryText, params);

    queryText = `SELECT tl.group_id, tl.task_id, cl.context_id, c.value,
		cs.user_id, cs.inherited_id, cs.active, cs.note, cs.activity_type FROM tasks_list AS tl
		RIGHT JOIN context_list AS cl ON cl.task_id = tl.task_id
		RIGHT JOIN context AS c ON cl.context_id = c.id
		RIGHT JOIN context_setting AS cs ON cs.context_id = cl.context_id AND cs.user_id = $1
		WHERE cl.context_id = $2 AND tl.task_id = $3;`;

    const { rows: contexts } = await client.query(queryText, [
      conditions.mainUser_id,
      result[0].add_task_context,
      conditions.task_id,
    ]);

    await client.query('commit');

    return Promise.resolve(contexts);
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
 * @func deleteContext
 * @param {Object} - conditions
 * @returns { function(...args): Promise }
 * @description Remove context from task element
 * conditions object = { mainUser_id: Number, task_id: char(8), values: Object }
 */
async function deleteContext(conditions) {
  try {
    conditionMustBeSet(conditions, 'mainUser_id');
    conditionMustBeSet(conditions, 'task_id');

    conditionMustBeSet(conditions, 'context_id');
  } catch (error) {
    throw error;
  }

  const { context_id } = conditions;

  const client = await pg.pool.connect();

  try {
    await client.query('BEGIN');

    const queryText = `SELECT delete_task_context($1, $2, $3)`;
    const params = [conditions.mainUser_id, conditions.task_id, context_id];

    const { rows: result } = await client.query(queryText, params);

    await client.query('COMMIT');

    return Promise.resolve({ context_id: result[0].delete_task_context });
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
  getContexts,
  addContext,
  deleteContext,
};

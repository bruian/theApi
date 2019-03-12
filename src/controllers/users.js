const VError = require('verror');
const { conditionMustBeSet, conditionMustSet } = require('../utils');
const pg = require('../db/postgres');

/**
 * @func getOrCreateUser
 * @param {Object} - conditions
 * @returns { function(...args): Promise }
 * @description Creates a new user if this does not exist. This operation is called when
 * the main user requests
 * conditions object = { mainUser_id: Number, client_id: Number, email: String }
 * Сценарий выполнения:
 * 1) Проеверяются допустимые поля запроса -> 2
 * 2) Выполняется запрос данных по пользователю, если есть данные то они возвращаются как
 * data-array, если нет данных то -> 3
 * 3) Создаётся новый пользователь, а так же: client, дефолтная группа, дефолтный sheet. Как
 * результат возвращается data-array с новым пользователем
 */
async function getOrCreateUser(conditions) {
  let params = [];

  try {
    conditionMustBeSet(conditions, 'mainUser_id');
    params.push(conditions.mainUser_id); // $1
  } catch (error) {
    throw error;
  }

  const client = await pg.pool.connect();

  try {
    // 2) Get user data and returning it if it exists.
    let queryText = `
		SELECT id, username, email, name, dateofbirth, city, country, gender, phone,
			url as avatar FROM users AS mainUser
		LEFT JOIN users_personality AS usr_p ON mainUser.id = usr_p.user_id
		LEFT JOIN users_photo AS usr_ph ON mainUser.id = usr_ph.user_id AND usr_ph.isAvatar = true
		WHERE mainUser.id = $1;`;
    const { rows } = await client.query(queryText, params);

    if (rows.length > 0) {
      return Promise.resolve(rows);
    }

    // 3) Create new user
    const username = conditions.email.match(/^([^@]*)@/)[1];
    params.push(username); // $2
    params.push(conditions.email); // $3
    params.push(new Date()); // $4

    await client.query('BEGIN');

    /* Create user by token id */
    queryText = `
    INSERT INTO users (id, username, email, created) VALUES ($1, $2, $3, $4) 
    RETURNING id, username, email, null AS name, null AS dateofbirth, null AS city, null AS country, 
      null AS gender, null AS phone, null AS avatar;`;
    const { rows: users } = await client.query(queryText, params);

    /* Create default group: personal */
    params = [conditions.mainUser_id];
    queryText = `select add_group($1, null, 1, true);`;
    const { rows: groups } = await client.query(queryText, params);

    params = [groups[0].add_group];
    queryText = `UPDATE groups SET name = 'personal' WHERE (id = $1);`;
    await client.query(queryText, params);

    /* Create default sheet: My groups */
    params = [conditions.mainUser_id];
    queryText = `INSERT INTO sheets (type_el, user_id, owner_id, name, visible, layout) 
    VALUES (8, $1, $1, 'My groups', true, 1);`;
    await client.query(queryText, params);

    /* Create default sheet: My tasks */
    queryText = `INSERT INTO sheets (type_el, user_id, owner_id, name, visible, layout) 
    VALUES (4, $1, $1, 'My tasks', true, 2);`;
    await client.query(queryText, params);

    /* Create default sheet: My activity */
    queryText = `INSERT INTO sheets (type_el, user_id, owner_id, name, visible, layout) 
    VALUES (2, $1, $1, 'My activity', false, 2);`;
    await client.query(queryText, params);

    /* Create default sheet: My users */
    queryText = `INSERT INTO sheets (type_el, user_id, owner_id, name, visible, layout) 
    VALUES (16, $1, $1, 'My users', false, 2);`;
    await client.query(queryText, params);

    /* Create default sheet: All groups */
    /* Create default sheet: All users */

    await client.query('COMMIT');

    return Promise.resolve(users);
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
 * @func getUsers
 * @param {Object} - conditions
 * @returns { function(...args): Promise }
 * @description Get exists users
 * conditions object = { mainUser_id: Number, user_id: Number, limit: Number, offser: Number,
 * group_id: Number, like: String }
 */
async function getUsers(conditions) {
  let pgUserCondition = '';
  let pgGroupCondition = '';
  let queryTextGroup = '';
  // let pgContextCondition = '';
  let pgLikeCondition = '';
  let pgContactCondition = '';
  let queryText = '';

  const params = [];

  try {
    conditionMustBeSet(conditions, 'mainUser_id');
    conditionMustBeSet(conditions, 'limit');
    conditionMustBeSet(conditions, 'offset');

    params.push(conditions.mainUser_id); // $1
    params.push(conditions.limit); // $2
    params.push(conditions.offset); // $3

    /* eslint-disable no-useless-escape */
    if (conditionMustSet(conditions, 'userId')) {
      pgUserCondition = ` AND usr.id = \$${params.length + 1}`;
      params.push(conditions.user_id);
    }

    if (conditionMustSet(conditions, 'group_id')) {
      queryTextGroup = `
        WITH main_visible_groups AS (
          SELECT group_id FROM groups_list AS gl
          LEFT JOIN groups AS grp ON gl.group_id = grp.id
          WHERE (grp.reading >= gl.user_type)
            AND (gl.group_id = \$${params.length + 1})
            AND (gl.user_id = 0 OR gl.user_id = $1)
        ),
        users_in_groups AS (
          SELECT user_id FROM groups_list AS gl
          WHERE gl.group_id IN (SELECT * FROM main_visible_groups)
            AND (gl.user_id <> $1)
        )
      `;
      pgGroupCondition = ` AND usr.id IN (SELECT * FROM users_in_groups)`;
      params.push(conditions.group_id);
    }

    // if (conditionMustSet(conditions, 'context_id')) {
    //   pgContextCondition = '';
    //   params.push(conditions.context_id);
    // }

    if (conditionMustSet(conditions, 'like')) {
      pgLikeCondition = ` AND (usr.username ILIKE '%\$${params.length +
        1}%' OR usr_p.name ILIKE '%\$${params.length + 1}%')`;
      params.push(conditions.like);
    }

    if (conditionMustSet(conditions, 'contact_type')) {
      if (Array.isArray(conditions.contact_type)) {
        pgContactCondition = ` AND ul.contact_type = \$${params.length + 1}`;
        params.push(conditions.like);
      }
    }
    /* eslint-enable no-useless-escape */
  } catch (error) {
    throw error;
  }

  /* users.visible: 0 - not visible, 1 - only from user list, 2 - visible for all */
  /* users_list.contact_type: 0: inaccessible, 1: sent an invitation to contact, 2: received an 
    invitation to contact, 3: contact formed, 4: contact rejected, */
  /* Сценарий запроса следующий:
    1) Получение списка пользователей (если задан pgGroupCondition) список выборки ограничен 
      пользователями входящими в состав группы
    TODO: 2) Получение списка пользователей (если задан pgContextCondition) список выборки ограничен
      пользователями имеющими выбранный контекст. <Обдумать механизм такой выборки>
    3) Отбор списка выборки (если задан pgUserCondition) по выбранному пользователю
    4) Получение всех данных по пользователю при параметрах (users.visible = 1 AND 
      users_list.contact_type = 3) OR (users.visible = 2) - выдаётся вся информация по пользователю
    5) Во всех остальных случаях по пользователю доступны только поля из таблицы (users.*) + 
      (users_list.contact_type) + (users_photo.url is avatar)
  */

  // queryText = `
  // SELECT * FROM users;
  // SELECT * FROM users_list;
  // SELECT * FROM users_personality;
  // SELECT * FROM users_photo;
  // SELECT * FROM groups;
  // SELECT * FROM groups_list;
  // SELECT * FROM sheets;
  // `;

  queryText = `${queryTextGroup}
    SELECT id, username, email, visible, name, dateofbirth, city, country, gender, phone, 
      url as avatar, contact_type FROM users AS usr
    LEFT JOIN users_list AS ul ON (usr.id = ul.contact_id) AND (ul.contact_id = $1)
    LEFT JOIN users_personality AS usr_p ON (usr.id = usr_p.user_id) --AND ul.contact_type
    LEFT JOIN users_photo AS usr_ph ON (usr.id = usr_ph.user_id) AND (usr_ph.isAvatar = true)
    WHERE ((usr.visible = 2) OR (usr.visible = 1 AND ul.contact_type > 0))
      ${pgUserCondition}
      ${pgGroupCondition}
      ${pgLikeCondition}
      ${pgContactCondition}
      LIMIT $2 OFFSET $3;
  `;

  const client = await pg.pool.connect();

  try {
    const { rows } = await client.query(queryText, params);

    return Promise.resolve(rows);
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

module.exports = {
  getOrCreateUser,
  getUsers,
};

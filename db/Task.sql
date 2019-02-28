/* Create table - tasks */
CREATE TABLE tasks (
	id 			char(8) PRIMARY KEY,
	parent 	char(8),
	tid 		integer,
	name 		varchar(300),
	note		varchar(2000),
	owner 	integer,
	level		smallint NOT NULL DEFAULT 1,
	depth 	smallint NOT NULL DEFAULT 1,
	CONSTRAINT tsk_id UNIQUE(id)
);

CREATE TRIGGER trigger_tasks_genid BEFORE INSERT ON tasks FOR EACH ROW EXECUTE PROCEDURE unique_short_id();

/* Create table - tasks list */
CREATE TABLE tasks_list (
  group_id char(8) NOT NULL REFERENCES groups ON DELETE cascade,
  task_id char(8) NOT NULL REFERENCES tasks ON DELETE cascade,
  PRIMARY KEY (group_id, task_id),
  p INTEGER NOT NULL, q INTEGER NOT NULL
);

--CREATE UNIQUE INDEX ON tasks_list (group_id, (p::float8/q));

/* UPDATE task fields <for API>
	gl.user_id = <0> - constant for select at ALL users
	tl.task_id = <1> - need api value
	gl.user_id = <1> - need api value
*/
WITH main_visible_task AS (
	SELECT tl.task_id FROM groups_list AS gl
		LEFT JOIN groups AS grp ON gl.group_id = grp.id
		RIGHT JOIN tasks_list AS tl ON gl.group_id = tl.group_id AND tl.task_id = 1
	WHERE (grp.reading >= gl.user_type)
		AND (grp.el_reading >= gl.user_type)
		AND (grp.el_updating >= gl.user_type)
		AND (gl.user_id = 0 OR gl.user_id = 1)
)
UPDATE tasks SET name = 'Hello people' WHERE id IN (SELECT * FROM main_visible_task);

/* Выборка всех задач из списка с сортировкой по группам и пользовательскому порядку */
SELECT * FROM tasks_list ORDER BY group_id, (p::float8/q);
SELECT * FROM tasks;
SELECT * FROM groups_list;

/* Простейшая выборка всех доступных задач из списка с фильтром по пользователю */
SELECT * FROM tasks_list AS tl
	RIGHT JOIN groups_list AS gl ON (gl.group_id = tl.group_id)
	JOIN groups AS gr
		ON (gl.group_id = gr.id)
		AND (gl.user_id = 3)
		AND (gl.user_type <= gr.reading)
		AND (gl.user_type <= gr.el_reading);

/* Выборка всех задач пользователя
	1) Выбираются группы пользователя (относительно группы и её разрешений получаются задачи)
	2) По массиву групп формируется список задач (выбираются все задачи из tasks_list с фильтром по группам)
	3) Список задач присоединяет к себе смежные данные по задаче
	4) Сортировка списка по группам -> внутри группы в соответствии с пользовательским порядком
*/
WITH main_visible_groups AS (
	SELECT gl.group_id, gl.user_type, grp.reading, grp.el_reading, grp.owner FROM groups_list AS gl
		RIGHT JOIN groups AS grp ON gl.group_id = grp.id
	WHERE (grp.reading >= gl.user_type)
		AND (grp.el_reading >= gl.user_type)
		AND (gl.user_id = 0 OR gl.user_id = 1)
)
SELECT tl.task_id, tsk.tid, tsk.name, tsk.owner AS task_owner,
			tsk.status, tsk.duration, tsk.note, tsk.parent,
			mvg.group_id, mvg.owner AS group_owner FROM main_visible_groups AS mvg
	JOIN tasks_list AS tl ON mvg.group_id = tl.group_id
	LEFT JOIN tasks AS tsk ON tl.task_id = tsk.id
ORDER BY tl.group_id, (tl.p::float8/tl.q);

/* Вариант с фильтром по одной группе и с флагом наличия потомков */
WITH main_visible_groups AS (
SELECT group_id FROM groups_list AS gl
	RIGHT JOIN groups AS grp ON gl.group_id = grp.id
	WHERE (grp.reading >= gl.user_type)
		AND (grp.el_reading >= gl.user_type)
		AND (gl.user_id = 0 OR gl.user_id = 1)
),
SELECT tl.task_id, tl.group_id, tl.p, tl.q,
	tsk.tid, tsk.name, tsk.owner AS tskowner,
	tsk.status, tsk.duration, tsk.note, tsk.parent,
	(SELECT COUNT(*) FROM tasks WHERE parent = tsk.id) AS havechild
FROM tasks_list AS tl
RIGHT JOIN tasks AS tsk ON tl.task_id = tsk.id
WHERE tl.group_id IN (SELECT * FROM main_visible_groups) AND tsk.parent = 1
ORDER BY (tl.p::float8/tl.q);

/* Иерархическая выборка всех задач пользователя
	1) Выбираются группы пользователя (относительно группы и её разрешений получаются задачи)
	2) По массиву групп формируется рекурсивное дерево задач (помимо основных задач, выбираются связанные под задачи)
	3) К элементам дерева задач присоединяются смежные данные по задачам
	4) Список сортируется по группам -> внутри группы в соответствии с пользовательским порядком
*/
WITH RECURSIVE main_visible_groups AS (
	SELECT group_id FROM groups_list AS gl
	RIGHT JOIN groups AS grp ON gl.group_id = grp.id
	WHERE (grp.reading >= gl.user_type)
		AND (grp.el_reading >= gl.user_type)
		AND (gl.user_id = 0 OR gl.user_id = 1)
), recursive_tree (id, parent, path, group_id, p, q, level) AS (
	SELECT t_one.id, t_one.parent, CAST (t_one.id AS VARCHAR (50)) AS path,
		tl_one.group_id, tl_one.p, tl_one.q, 1 FROM tasks_list AS tl_one
		RIGHT JOIN tasks AS t_one ON (tl_one.task_id = t_one.id)
		WHERE t_one.parent = 0 AND tl_one.group_id IN (SELECT group_id FROM main_visible_groups)
	UNION
	SELECT t_two.id, t_two.parent, CAST (recursive_tree.PATH ||'->'|| t_two.id AS VARCHAR(50)), tl_two.group_id, tl_two.p, tl_two.q, level + 1
    FROM tasks_list AS tl_two
		RIGHT JOIN tasks AS t_two ON (tl_two.task_id = t_two.id)
		INNER JOIN recursive_tree ON (recursive_tree.id = t_two.parent)
)
SELECT tsk.id AS task_id, tsk.tid, tsk.name, tsk.owner AS tskowner,
			tsk.status, tsk.duration, tsk.note, recursive_tree.group_id,
			recursive_tree.p, recursive_tree.q, recursive_tree.parent FROM recursive_tree
	LEFT JOIN tasks AS tsk ON recursive_tree.id = tsk.id
ORDER BY recursive_tree.group_id, (recursive_tree.p::float8/recursive_tree.q);

/* 
	выбираем все группы которые видимы main пользователю и
  помещаем в таблицу main_visible_groups,
  затем строим иерархию задач по родителю для определения глубины иерархии
  А в Целевой выборке мы получаем все задачи входящие в main_visible_groups
  в соответствии с заданной пользователем последовательностью хранения
  задач (сортировка по полям tl.p/tl.q по принципу дробления числа)
*/

/*main_user, to_group_id, task_id, to_task_id, isBefore, to_parent */
SELECT reorder_task(1, 1, 4, null, FALSE, 0);

/* tasks by parent id getTasks */
CREATE TEMP TABLE temp_task ON COMMIT DROP AS WITH RECURSIVE main_visible_groups AS (
SELECT group_id FROM groups_list AS gl
	LEFT JOIN groups AS grp ON gl.group_id = grp.id
	WHERE grp.reading >= gl.user_type AND (gl.user_id = 0 OR gl.user_id = 1)
), descendants(id, parent, depth, path) AS (
  SELECT id, parent, 1 depth, ARRAY[id] FROM tasks --WHERE parent is null
	UNION
	SELECT t.id, t.parent, d.depth + 1, path || t.id FROM tasks t
	JOIN descendants d ON t.parent = d.id
)
SELECT tl.task_id, tl.group_id, tl.p, tl.q,
	tsk.tid, tsk.name, tsk.owner AS tskowner,
	tsk.status, tsk.duration, tsk.note, tsk.parent,
	(SELECT COUNT(*) FROM tasks WHERE parent = tsk.id) AS havechild,
	dsc.depth
FROM tasks_list AS tl
RIGHT JOIN tasks AS tsk ON tl.task_id = tsk.id
JOIN (SELECT max(depth) AS depth, descendants.path[1] AS parent_id FROM descendants GROUP BY descendants.path[1]) AS dsc ON tl.task_id = dsc.parent_id
WHERE tl.group_id IN (SELECT * FROM main_visible_groups) --AND tsk.parent is null
ORDER BY tl.group_id, (tl.p::float8/tl.q);

SELECT * FROM temp_task;

SELECT cl.task_id, cl.context_id, c.value, cs.inherited_id, cs.active, cs.note, cs.activity_type FROM context_list AS cl
LEFT JOIN context AS c ON c.id = cl.context_id
LEFT JOIN context_setting AS cs ON cs.context_id = cl.context_id AND cs.user_id = 1
WHERE cl.task_id in (select task_id from temp_task);

/* Рабочая выборка списка задач из модуля tasks.js version 1 */
WITH RECURSIVE main_visible_groups AS (
	SELECT group_id FROM groups_list AS gl
		LEFT JOIN groups AS grp ON gl.group_id = grp.id
		WHERE (grp.reading >= gl.user_type) AND (gl.user_id = 0 OR gl.user_id = 1)
	), descendants(id, parent, depth, path) AS (
		SELECT id, parent, 1 depth, ARRAY[id] FROM tasks WHERE parent = 0
		UNION
		SELECT t.id, t.parent, d.depth + 1, path || t.id FROM tasks t
		JOIN descendants d ON t.parent = d.id
	), acts(duration, task_id) AS (
		SELECT SUM(act.ends - act.start) as duration, act.task_id FROM activity_list AS al
		JOIN activity AS act ON (act.id = al.id)
		WHERE (al.user_id = 1) AND (al.group_id IN (SELECT * FROM main_visible_groups))
		GROUP BY act.task_id
	)
	SELECT tl.task_id, tl.group_id, tl.p, tl.q,
		tsk.tid, tsk.name, tsk.owner AS tskowner,
		act.status, tsk.note, tsk.parent,
		(SELECT COUNT(*) FROM tasks WHERE parent = tsk.id) AS havechild,
		extract(EPOCH from (SELECT duration FROM acts WHERE acts.task_id = tl.task_id))*1000 AS duration,
		dsc.depth, act.start
	FROM tasks_list AS tl
	RIGHT JOIN tasks AS tsk ON tl.task_id = tsk.id
	JOIN activity_list AS al ON (al.group_id = tl.group_id) AND (al.user_id = 1)
	JOIN activity AS act ON (act.task_id = tl.task_id) AND (act.ends IS NULL) AND (act.id = al.id)
	JOIN (SELECT max(depth) AS depth, descendants.path[1] AS parent_id
				FROM descendants GROUP BY descendants.path[1]) AS dsc ON tl.task_id = dsc.parent_id
	WHERE tl.group_id IN (SELECT * FROM main_visible_groups)
	ORDER BY tl.group_id, (tl.p::float8/tl.q);

/* Рабочая выборка списка задач из модуля tasks.js version 2 */
WITH RECURSIVE main_visible_groups AS (
	SELECT group_id FROM groups_list AS gl
		LEFT JOIN groups AS grp ON gl.group_id = grp.id
		WHERE grp.reading >= gl.user_type AND (gl.user_id = 0 OR gl.user_id = 1)
	) , descendants(id, parent, depth, path) AS (
		SELECT id, parent, 1 depth, ARRAY[id]::varchar[] FROM tasks WHERE parent is null
	UNION
		SELECT t.id, t.parent, d.depth + 1, path::varchar[] || t.id::varchar[] FROM tasks t
		JOIN descendants d ON t.parent = d.id
	), acts(duration, task_id) AS (
		SELECT SUM(extract(EPOCH from act.ends) - extract(EPOCH from act.start)) as duration,
			act.task_id FROM activity_list AS al
		JOIN activity AS act ON (act.id = al.id)
		WHERE (al.user_id = 1)
			AND (al.group_id IN (SELECT * FROM main_visible_groups))
			AND (act.status = 1 OR act.status = 5)
		GROUP BY act.task_id
	)
	SELECT tl.task_id, tl.group_id, tl.p, tl.q,	t.tid, t.name, t.owner, t.note, t.parent,
		(SELECT COUNT(*) FROM tasks WHERE parent = t.id) AS havechild,
		(SELECT duration FROM acts WHERE acts.task_id = tl.task_id) * 1000 AS duration,
		dsc.depth, act.start, act.status
	FROM tasks_list AS tl
	RIGHT JOIN tasks AS t ON tl.task_id = t.id
	JOIN activity_list AS al ON (al.group_id = tl.group_id) AND (al.user_id = 1)
	JOIN activity AS act ON (act.task_id = tl.task_id) AND (act.ends IS NULL) AND (act.id = al.id)
	JOIN (SELECT max(depth) AS depth, descendants.path[1] AS parent_id
				FROM descendants GROUP BY descendants.path[1]) AS dsc ON tl.task_id = dsc.parent_id
	WHERE tl.group_id IN (SELECT * FROM main_visible_groups)  AND t.parent is Null
	ORDER BY tl.group_id, (tl.p::float8/tl.q) LIMIT 10 OFFSET 0

/* Рабочая выборка списка задач из модуля tasks.js version 3 (work) */
WITH RECURSIVE 
main_visible_groups AS (
	SELECT group_id FROM groups_list AS gl
	LEFT JOIN groups AS grp ON gl.group_id = grp.id
	WHERE grp.reading >= gl.user_type AND (gl.user_id = 0 OR gl.user_id = 1)
), 
acts(duration, task_id) AS (
	SELECT SUM(extract(EPOCH from act.ends) - extract(EPOCH from act.start)) as duration,
		act.task_id FROM activity_list AS al
	JOIN activity AS act ON (act.id = al.id)
	WHERE (al.user_id = 1)
		AND (al.group_id IN (SELECT * FROM main_visible_groups))
		AND (act.status = 1 OR act.status = 5)
	GROUP BY act.task_id
) select * from acts
SELECT tl.id, tl.group_id, tl.p, tl.q,	t.tid, t.name, t.owner, t.note, t.parent,
	(SELECT duration FROM acts WHERE acts.task_id = tl.task_id) * 1000 AS duration,
	t.depth, t.level, act.start, act.status
FROM tasks_list AS tl
RIGHT JOIN tasks AS t ON tl.task_id = t.id
JOIN activity_list AS al ON (al.group_id = tl.group_id) AND (al.user_id = 1)
JOIN activity AS act ON (act.task_id = tl.task_id) AND (act.ends IS NULL) AND (act.id = al.id)
WHERE tl.group_id IN (SELECT * FROM main_visible_groups)  AND t.parent is Null
ORDER BY tl.group_id, (tl.p::float8/tl.q) LIMIT 10 OFFSET 0;

/* Вариант выборки списка задач, с преформированием активностей в отдельном запросе */
WITH RECURSIVE main_visible_groups AS (
	SELECT group_id FROM groups_list AS gl
		LEFT JOIN groups AS grp ON gl.group_id = grp.id
		WHERE grp.reading >= gl.user_type AND (gl.user_id = 0 OR gl.user_id = 1)
	) , main_activity AS (
		SELECT start, status, task_id, group_id FROM activity_list AS al
		RIGHT JOIN activity AS a ON (a.ends IS NULL) AND (a.id = al.id)
		WHERE al.user_id = 1
	)	, acts(duration, task_id) AS (
		SELECT SUM(extract(EPOCH from act.ends) - extract(EPOCH from act.start)) as duration,
			act.task_id FROM activity_list AS al
		JOIN activity AS act ON (act.id = al.id)
		WHERE (al.user_id = 1)
			AND (al.group_id IN (SELECT * FROM main_visible_groups))
			AND (act.status = 1 OR act.status = 5)
		GROUP BY act.task_id
	)	SELECT t.id, tl.group_id, tl.p, tl.q,	t.tid, t.name, t.owner,	t.note, t.parent,
		(SELECT COUNT(*) FROM tasks WHERE parent = t.id) AS havechild,
		(SELECT duration FROM acts WHERE acts.task_id = tl.task_id) * 1000 AS duration,
		t.depth, act.start, act.status
	FROM tasks_list AS tl
	RIGHT JOIN tasks AS t ON tl.task_id = t.id
	LEFT JOIN (SELECT * FROM main_activity) AS act ON (act.group_id = tl.group_id) AND (act.task_id = t.id)
	WHERE tl.group_id IN (SELECT * FROM main_visible_groups)  AND t.parent is null
	ORDER BY tl.group_id, (tl.p::float8/tl.q);

SELECT add_activity(1, '0ZfgI7KW', 2::smallint, false);
UPDATE activity	SET (start, task_id, status, productive, part) =
	('2019-02-20T13:22:24.330Z', 'bxh-0ReU', 0, true, (SELECT count(id) FROM activity WHERE task_id = 'bxh-0ReU'))
	WHERE id = '901Olgfn';

SELECT t.id, tl.group_id, tl.p, tl.q,	t.tid, t.name, t.owner,	t.note, t.parent, t.depth, t.level
FROM tasks_list AS tl
RIGHT JOIN tasks AS t ON tl.task_id = t.id
WHERE tl.task_id IN (SELECT * FROM UNNEST(ARRAY['Ukn-9_6H']::char[8]))
ORDER BY tl.group_id, (tl.p::float8/tl.q);

/* TEST OPERATIONS for add_task */
SELECT add_task(1, '0ZfgI7KW', null, TRUE);
--select reorder_task(1, 'Jv7jbOq7', 'Ukn-9_6H', null, true, null);

SELECT * from groups;
SELECT * from tasks;
SELECT * from tasks_list ORDER BY (p::float8/q);
SELECT * from activity;
SELECT * from activity_list;

WITH RECURSIVE descendants AS (
    SELECT id, parent, 1 depth
    FROM tasks
    WHERE id = '0VRdtbMR'
UNION
    SELECT t.id, t.parent, d.depth + 1
    FROM tasks t
    INNER JOIN descendants d
    ON t.parent = d.id
)
SELECT MAX(depth)
FROM descendants d

DELETE FROM tasks;
DELETE FROM tasks_list;
DELETE FROM activity;
DELETE FROM activity_list;

/* Create new task in tasks table, and add it in tasks_list table
	 0 - Group for main user not found
  -1 - No rights to read the group
  -2 - No rights to read the el by the ID
  -3 - No rights to create the el in the group
*/
CREATE OR REPLACE FUNCTION add_task (
	main_user_id integer,
	_group_id 	 char(8),
	_parent_id 	 char(8),
	_isStart 		 boolean
)
RETURNS text LANGUAGE plpgsql VOLATILE CALLED ON NULL INPUT AS $body$
DECLARE
	main_group_reading integer;
	main_el_creating 	 integer;
	main_el_reading 	 integer;
	main_user_type 		 integer;
	taskId 					   char(8);
	newParent 				 char(8);
	tid 							 integer;
	newLevel					 smallint;
	descLevel					 smallint;
	depthParent				 char(8);
BEGIN
	SELECT gl.user_type, g.reading, g.el_creating, g.el_reading
	  INTO main_user_type, main_group_reading, main_el_creating, main_el_reading FROM groups_list AS gl
	LEFT JOIN groups AS g ON gl.group_id = g.id
	WHERE (gl.user_id = main_user_id OR gl.user_id = 0) AND (gl.group_id = _group_id);

	IF NOT FOUND THEN
 		/* if SELECT return nothing */
		RAISE EXCEPTION 'Group for main user not found';
	END IF;

	/* SELECT return rows */
	IF main_group_reading < main_user_type THEN
		RAISE EXCEPTION 'No rights to read the group';
	END IF;

	IF main_el_reading < main_user_type THEN
 		RAISE EXCEPTION 'No rights to read the task by the ID';
	END IF;

	IF main_el_creating < main_user_type THEN
	  RAISE EXCEPTION 'No rights to create the task in the group';
	END IF;

	SELECT count(id) INTO tid FROM tasks WHERE (owner = main_user_id);
	tid := tid + 1;

	newParent := _parent_id;
	IF _parent_id = '0' THEN
		newParent := null;
	END IF;

	/* Вычисление уровеня элемента */
	IF newParent is null THEN
		newLevel := 1;
	ELSE
		SELECT level INTO descLevel FROM tasks AS t WHERE t.id = newParent;
		newLevel := descLevel + 1;
	END IF;

	/* Пересчёт глубины вложенных элементов, глубина нужна для вычисления пределов
	перемещения элементов на клиенте без загрузки всей иерархии с сервера */
	IF newLevel = 3 THEN
		UPDATE tasks SET depth = 2 WHERE (id = newParent) AND (depth < 2);
		SELECT parent INTO depthParent FROM tasks WHERE (id = newParent);
		UPDATE tasks SET depth = 3 WHERE (id = depthParent) AND (depth < 3);
	ELSIF newLevel = 2 THEN
		UPDATE tasks SET depth = 2 WHERE (id = newParent) AND (depth < 2);
	END IF;

	INSERT INTO tasks (tid, name, owner, note, parent, level, depth)
		VALUES (tid, '', main_user_id, '', newParent, newLevel, 1)
		RETURNING id INTO taskId;

	PERFORM task_place_list(_group_id, taskId, newParent, NOT _isStart);

	RETURN taskId;
END;
$body$;

/* 
	Delete task in tasks table, and add it in tasks_list table
	 0 - Group for main user not found
  -1 - No rights to read the group
  -2 - No rights to read the task by the ID
  -3 - No rights to delete the task in the group
  -4 - Can not delete. Task have subelement
*/
CREATE OR REPLACE FUNCTION delete_task (
	main_user_id 		integer,
	_task_id 				char(8),
	_group_id 			char(8),
	_isOnlyFromList boolean
)
RETURNS text LANGUAGE plpgsql VOLATILE CALLED ON NULL INPUT AS $f$
DECLARE
	main_user_type 		 integer;
	main_group_reading integer;
	main_el_deleting 	 integer;
	main_el_reading 	 integer;
	countchild 				 integer;
	el_parent					 char(8);
	el_level					 smallint;
	el_depth			 		 smallint;
BEGIN
	SELECT gl.user_type, g.reading, g.el_deleting, g.el_reading
	  INTO main_user_type, main_group_reading, main_el_deleting, main_el_reading FROM groups_list AS gl
	LEFT JOIN groups AS g ON gl.group_id = g.id
	WHERE (gl.user_id = main_user_id OR gl.user_id = 0) AND (gl.group_id = _group_id);

	IF NOT FOUND THEN
	  RAISE EXCEPTION 'Group for main user not found';
	END IF;

	IF main_group_reading < main_user_type THEN
	  RAISE EXCEPTION 'No rights to read the group';
	END IF;

	IF main_el_reading < main_user_type THEN
	  RAISE EXCEPTION 'No rights to read the task by the ID';
	END IF;

	IF main_el_deleting < main_user_type THEN
	  RAISE EXCEPTION 'No rights to delete the task from the group';
	END IF;

	SELECT count(id) INTO countchild FROM tasks WHERE parent = _task_id;
	IF countchild > 0 THEN
	  RAISE EXCEPTION 'Can not delete. Task have subelement';
	END IF;

	SELECT parent, level INTO el_parent, el_level FROM tasks WHERE id = _task_id;

	IF _isOnlyFromList = TRUE THEN
	  DELETE FROM tasks_list WHERE (task_id = _task_id) AND (group_id = _group_id);
	  UPDATE tasks SET parent = null WHERE (id = _task_id);
	ELSE
	  DELETE FROM tasks_list WHERE (task_id = _task_id);
	  DELETE FROM tasks WHERE (id = _task_id);
	  DELETE FROM context_list WHERE (task_id = _task_id);
	END IF;

	IF el_parent IS NOT NULL THEN
		/* Если есть родитель у удаляемого элемента, значит необходимо пересчитать 
			его глубину с учетом удаленного элемента */

		/* Рекурсивный пересчёт новой глубины у родителя */
		WITH RECURSIVE descendants AS (
			SELECT id, parent, 1 depth FROM tasks	WHERE id = el_parent
		UNION
			SELECT t.id, t.parent, d.depth + 1 FROM tasks t	INNER JOIN descendants d
			ON t.parent = d.id
		)
		SELECT MAX(depth) INTO el_depth FROM descendants d;

		UPDATE tasks SET depth = el_depth WHERE id = el_parent;
	END IF;

	UPDATE tasks SET (depth, level) = (1, 1) WHERE id = _task_id;

	RETURN _task_id;
END;
$f$;

/**
 * @func reorder_task
 * @param {integer} mainUser_id - идентификатор текущего пользователя
 * @param {char(8)} _group_id - идентификатор группы, куда перемещается елемент задачи
 * @param {char(8)} _task_id - идентификатор элемента перемещаемой задачи
 * @param {char(8)} _relation_id - идентификатор элемента на который перемещается задача
 * @param {boolean} _is_before - признак помещения элемента в начало(true) или конец(false) списка
 * @param {char(8)} _parent - идентификатор родителя если такой меняется, null если не меняется
 * @return {integer} Признак завершения операции. 1 - перемещение удачно, 2 - сменилась группа
 * @description Обновляет положение элемента в списке задач, пересчитывает значения p и q,
 * если меняется группа, то меняет значения группы у элемента
 * Список ошибок, что выплевывает функция:
 * 0 - moving a record to its own position is a no-op
 * 1 - user is not assigned this group or this group no public
 * 2 - user does not have permissions to read this group
 * 3 - user does not have permissions to updating this group
*/
CREATE OR REPLACE FUNCTION reorder_task (
	main_user_id integer,
	_group_id 	 char(8),
  _task_id 		 char(8),
  _relation_id char(8),
  _is_before 	 boolean,
	_parent 		 char(8)
) RETURNS integer LANGUAGE plpgsql VOLATILE CALLED ON NULL INPUT AS $f$
DECLARE
	before_level				smallint;
	before_depth				smallint;
	before_parent_depth smallint;
	before_group_id 		char(8);
	before_parent_id 		char(8);
	main_group_id 			char(8);
	main_group_reading 	integer;
	main_el_updating 		integer;
	main_user_type 			integer;
	rel_group_id 				char(8);
	parent_level				smallint;
BEGIN
	/* Выборка доступной пользователю группы для проверки прав на операции с ней,
		где user_id = 0 это группы общие для всех пользователей */
	SELECT group_id, grp.reading, grp.el_updating, gl.user_type
	  INTO main_group_id, main_group_reading, main_el_updating, main_user_type
	FROM groups_list gl
	LEFT JOIN groups grp ON gl.group_id = grp.id
  WHERE gl.group_id = _group_id AND (gl.user_id is null OR gl.user_id = main_user_id);

	/* Нет результатов выборки, а значит и группа не доступна пользователю */
	IF NOT FOUND THEN
		RAISE EXCEPTION 'User is not assigned this group or this group no public';
	END IF;

	IF main_group_id IS NULL THEN
		RAISE EXCEPTION 'User is not assigned this group or this group no public';
	END IF;

	/* Проверка прав доступа на чтение группы. Анализ прав происходит по следующему принципу
		из groups_list извлекается тип пользователя user_type, который может иметь 3 значения:
			1 - owner (владелец)
			2 - curator (куратор группы)
			3 - member (член группы)
			4 - all (все остальные)
		значения этого типа сравниваются с "атрибутами доступа" извлеченными из groups, это
		groups.reading и groups.el_updating
		сравнение происходит по принципу, атрибуты доступа совпадающие с user_type - это разрешающие
		например: groups.reading = 1 значит, что доступ есть только у пользователя с user_type = 1
	*/
	IF main_group_reading < main_user_type THEN
	  RAISE EXCEPTION 'User does not have permissions to read this group';
	END IF;

	IF main_el_updating < main_user_type THEN
		RAISE EXCEPTION 'User does not have permissions to updating this group';
	END IF;

	IF _parent = '0' THEN
		_parent := null;
	END IF;

  -- moving a record to its own position is a no-op
  --IF _relation_id=_task_id THEN RETURN 0; END IF;

	/* Получение предыдущих значений группы, уровня, глубины и родителя у задачи */
	SELECT tl.group_id, t.parent, t.level, t.depth 
		INTO strict before_group_id, before_parent_id, before_level, before_depth
	FROM tasks_list AS tl
	LEFT JOIN tasks AS t ON t.id = tl.task_id
	WHERE tl.task_id = _task_id
  GROUP BY tl.group_id, t.parent, t.level, t.depth;

	parent_level := 0;

	/* Сравнение родителей у старой и новой позиции, если поменялись, то необходимо обновить */
	IF COALESCE(_parent, '0') <> COALESCE(before_parent_id, '0') THEN
		/* Смена родителя, что может означать и смену уровня элемента. Поэтому необходимо
			проверить допустимостимость такого перемещения, что бы не выйти за ограничение 
			вложенности в 3 уровня */
		IF _parent IS NOT NULL THEN
			SELECT level INTO parent_level FROM tasks WHERE id = _parent;
		END IF;

		IF (parent_level + before_depth) > 3 THEN
			RAISE EXCEPTION 'Out of level';
		END IF;

		/* Обновление родителя */
		UPDATE tasks SET parent = _parent WHERE id = _task_id;

		/* Ну и конечно же, раз изменился состав элементов у предыдущего родителя, то ему необходимо
			пересчитать depth */
		IF before_parent_id IS NOT NULL THEN
			WITH RECURSIVE descendants AS (
				SELECT id, parent, 1 depth FROM tasks	WHERE id = before_parent_id
			UNION
				SELECT t.id, t.parent, d.depth + 1 FROM tasks t	INNER JOIN descendants d
				ON t.parent = d.id
			)
			SELECT MAX(depth) INTO before_parent_depth FROM descendants d;

			UPDATE tasks SET depth = before_parent_depth WHERE id = before_parent_id;
		END IF;
	END IF;

	/* Обработка перемещения элемента в списке tasks_list, тут важно организовать правильное
		положение элемента в списке (то что задал пользователь), для этого используется частное
		от деления полей p/q, где получается дробное число и сортировка происходит в порядке
		дробных значений. Алгоритм: Дерево Штерна-Брока.
		_relation_id - входящий параметр, означает элемент на который помещается "перемещаемый
		элемент", может иметь значение null это значит что "перемещаемый элемент" помещается в
		начало или конец списка (регулируется параметром _is_before)
	*/
	IF _relation_id IS NULL THEN
		perform task_place_list(_group_id, _task_id, _relation_id, _is_before);
	ELSE
		/* Получение группы для задачи на которую помещается "перемещаемый элемент", это делается
			для сравнения групп. Если группы не совпадают, т.е. у "перемещаемого элемента" группа
			иная, то "перемещаемый элемент помещается в начало списка группы назначения. В противном
			случае происходит стандартное перемещение */
		SELECT tl.group_id INTO strict rel_group_id
		FROM tasks_list AS tl
		WHERE tl.task_id = _relation_id;

		IF _group_id <> COALESCE(rel_group_id, '0') THEN
			perform task_place_list(_group_id, _task_id, null, FALSE);
		ELSE
			perform task_place_list(_group_id, _task_id, _relation_id, _is_before);
		END IF;
	END IF;

	-- lock the tasks_list
	--perform 1 FROM tasks_list tl WHERE tl.task_id=before_group_id FOR UPDATE;

	/* Пересчет level и depth у родителя, если он есть. Так же и у самого элемента. Т.к. иерархия 
		ограничена 3 уровнями, то нет необходимости мудрить конструкции с циклами */
	IF COALESCE(_parent, '0') <> COALESCE(before_parent_id, '0') THEN
		/* Отталкиваясь от уровня нового родителя можно вычислить уровень для текущего элемента */
		UPDATE tasks SET level = parent_level + 1 WHERE id = _task_id;

		/* И его потомков */
		UPDATE tasks SET level = parent_level + 2 WHERE parent = _task_id;
		
		/* Рекурсивный пересчёт новой глубины у родителя */
		WITH RECURSIVE descendants AS (
			SELECT id, parent, 1 depth FROM tasks	WHERE id = _parent
		UNION
			SELECT t.id, t.parent, d.depth + 1 FROM tasks t	INNER JOIN descendants d
			ON t.parent = d.id
		)
		SELECT MAX(depth) INTO before_depth FROM descendants d;

		/* Тут прост используется свободная переменная before_depth для передачи значения */
		UPDATE tasks SET depth = before_depth WHERE id = _parent;
	END IF;

	/* Если сменилась, группа, то функция task_place_list автоматически создаст новую запись в
		списке tasks_list. Значит необходимо удалить предыдущую запись. Что и делается ниже */
	IF before_group_id <> main_group_id THEN
		DELETE FROM tasks_list WHERE (group_id = before_group_id) AND (task_id = _task_id);

		/* Возвращается двоечка, как признак, что сменилась группа. Это нужно, что-бы api знало
			о необходимости выполнения ряда действий при смене группы. Например обновления активностей */
		return 2;
	ELSE
		/* Возвращается единичка, как признак, что все нормально поменялось */
		return 1;
 	END IF;
END;
$f$;

-- insert or move item TSK_ID in group GRP_ID next to REL_ID,
-- before it if IS_BEFORE is true, otherwise after. REL_ID may
-- be null to indicate a position off the end of the list.

-- вставить или переместить запись TSK_ID в группе GRP_ID,
-- после REL_ID если IS_BEFORE=true, в противном случае до REL_ID.
-- REL_ID может иметь значени NULL, что указывает позицию конца списка
CREATE OR REPLACE FUNCTION task_place_list (
	grp_id char(8),
  tsk_id char(8),
  rel_id char(8),
  is_before boolean
) RETURNS void LANGUAGE plpgsql volatile called ON NULL INPUT AS $f$
DECLARE
  p1 INTEGER; q1 INTEGER;   -- fraction below insert position | дробь позже вставляемой позиции
  p2 INTEGER; q2 INTEGER;   -- fraction above insert position | дробь раньше вставляемой позиции
  r_rel DOUBLE PRECISION;   -- p/q of the rel_id row					| p/q значение rel_id строки
  np INTEGER; nq INTEGER;   -- new insert position fraction
BEGIN
	-- perform выполняет select без возврата результата
	-- lock the groups
	perform 1 FROM groups g WHERE g.id=grp_id FOR UPDATE;

	-- moving a record to its own position is a no-op
	IF rel_id=tsk_id THEN RETURN; END IF;

	-- if we're positioning next to a specified row, it must exist
	IF rel_id IS NOT NULL THEN
		SELECT tl.p, tl.q INTO strict p1, q1
			FROM tasks_list tl
			WHERE tl.group_id=grp_id AND tl.task_id=rel_id;
		r_rel := p1::float8 / q1;
	END IF;

	-- find the next adjacent row in the desired direction
	-- (might not exist).
	IF is_before THEN
		p2 := p1; q2 := q1;
		SELECT tl2.p, tl2.q INTO p1, q1
			FROM tasks_list tl2
			WHERE tl2.group_id=grp_id AND tl2.task_id <> tsk_id
				AND (p::float8/q) < COALESCE(r_rel, 'infinity')
			ORDER BY (p::float8/q) DESC LIMIT 1;
	ELSE
		SELECT tl2.p, tl2.q INTO p2, q2
			FROM tasks_list tl2
			WHERE tl2.group_id=grp_id AND tl2.task_id <> tsk_id
				AND (p::float8/q) > COALESCE(r_rel, 0)
			ORDER BY (p::float8/q) ASC LIMIT 1;
	END IF;

	-- compute insert fraction
	SELECT * INTO np, nq FROM find_intermediate(COALESCE(p1, 0), COALESCE(q1, 1),
																							COALESCE(p2, 1), COALESCE(q2, 0));

	-- move or insert the specified row
	UPDATE tasks_list
		SET (p,q) = (np,nq) WHERE group_id=grp_id AND task_id=tsk_id;
	IF NOT found THEN
		INSERT INTO tasks_list VALUES (grp_id, tsk_id, np, nq);
	END IF;

	-- want to renormalize both to avoid possibility of integer overflow
	-- and to ensure that distinct fraction values map to distinct float8
	-- values. Bounding to 10 million gives us reasonable headroom while
	-- not requiring frequent normalization.

	IF (np > 10000000) OR (nq > 10000000) THEN
		perform tsk_renormalize(grp_id);
	END IF;
END;
$f$;

-- Renormalize the fractions of items in GRP_ID, preserving the
-- existing order. The new fractions are not strictly optimal, but
-- doing better would require much more complex calculations.
--
-- the purpose of the complex update is as follows: we want to assign
-- a new series of values 1/2, 3/2, 5/2, ... to the existing rows,
-- maintaining the existing order, but because the unique expression
-- index is not deferrable, we want to avoid assigning any new value
-- that collides with an existing one.
--
-- We do this by calculating, for each existing row with an x/2 value,
-- which position in the new sequence it would appear at. This is done
-- by adjusting the value of p downwards according to the number of
-- earlier values in sequence. To see why, consider:
--
--   existing values:    3, 9,13,15,23
--   new simple values:  1, 3, 5, 7, 9,11,13,15,17,19,21
--                          *     *  *        *
--   adjusted values:    1, 5, 7,11,17,19,21,25,27,29,31
--
--   points of adjustment: 3, 7 (9-2), 9 (13-4, 15-6), 15 (23-8)
--
-- The * mark the places where an adjustment has to be applied.
--
-- Having calculated the adjustment points, the adjusted value is
-- simply the simple value adjusted upwards according to the number of
-- points passed (counting multiplicity).
CREATE OR REPLACE FUNCTION tsk_renormalize(grp_id char(8))
  RETURNS void
  LANGUAGE plpgsql
  volatile strict
AS $f$
  BEGIN
    perform 1 FROM tasks_list tl WHERE tl.group_id=grp_id FOR UPDATE;

    UPDATE tasks_list tl SET p=s2.new_rnum, q=2
      FROM (SELECT task_id,
                   is_existing = 0 AS is_new,
                   -- increase the current value according to the
                   -- number of adjustment points passed
                   rnum + 2*(SUM(is_existing) OVER (ORDER BY rnum)) AS new_rnum
              FROM (
                    -- assign the initial simple values to every item
		    -- in order
                    SELECT task_id,
                           2*(ROW_NUMBER() OVER (ORDER BY p::float8/q)) - 1
                             AS rnum,
                           0 AS is_existing
                      FROM tasks_list tl2
                     WHERE tl2.group_id=grp_id
                    UNION ALL
                    -- and merge in the adjustment points required to
                    -- skip over existing x/2 values
                    SELECT task_id,
                           p + 2 - 2*(COUNT(*) OVER (ORDER BY p))
                             AS rnum,
                           1 AS is_existing
                      FROM tasks_list tl3
                     WHERE tl3.group_id=grp_id
                       AND tl3.q=2
                   ) s1
           ) s2
     WHERE s2.task_id=tl.task_id
       AND s2.is_new
       AND tl.group_id=grp_id;
  END;
$f$;
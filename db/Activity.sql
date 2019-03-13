/* Create table - activity */
CREATE TABLE IF NOT EXISTS activity (
	id 					char(8) PRIMARY KEY,
	task_id 		char(8) REFERENCES tasks ON DELETE cascade, /* TODO change to char(8) ids */
	name				varchar(300),
	note				varchar(2000),
	productive	boolean DEFAULT false,
	part				integer,
	status			smallint,
	owner				integer, /* TODO change to char(8) ids */
	start				timestamp with time zone,
	ends				timestamp with time zone,
	CONSTRAINT ident UNIQUE(id)
);

--CREATE UNIQUE INDEX ON activity (id);

/* We name the trigger "trigger_activity_genid" so that we can remove or replace it later.
	If an INSERT contains multiple RECORDs, each one will call unique_short_id individually. */
CREATE TRIGGER trigger_activity_genid BEFORE INSERT ON activity FOR EACH ROW EXECUTE PROCEDURE unique_short_id();

/* Create table - activity sheet */
CREATE TABLE activity_list (
	id			 char(8),
  group_id char(8) NOT NULL REFERENCES groups ON DELETE cascade,
  user_id  integer NOT NULL,
	type_el	 smallint,
	-- p INTEGER NOT NULL, q INTEGER NOT NULL,
  PRIMARY KEY (id, user_id, group_id)
);

CREATE UNIQUE INDEX ON activity_list (user_id, group_id, (p::float8/q));

/* Order new activity
	1) create activity and place to activity_list
	2) if exist task_id then UPDATE activity element and set task_id field
	3) assignment part number for activities with associated tasks
*/

/* Create new activity in activity table, and add it in activity_list table
	 0 - Group for main user not found
  -1 - No rights to read the group
  -2 - No rights to read the elements in group
  -3 - No rights to create the element in the group
	type_el: (aka widget max 16 widgets 2^15)
		1  - divider		0000001
		2  - activity		0000010
		4  - task				0000100
		8  - groups			0001000
		16 - users			0010000
		32 - post-notes	0100000
		64 - images			1000000
*/
CREATE OR REPLACE FUNCTION add_activity (
	main_user_id integer,
	_group_id 	 char,
	_type_el 		 smallint,
	_isStart 		 BOOL
)
RETURNS text LANGUAGE plpgsql VOLATILE CALLED ON NULL INPUT AS $f$
DECLARE
	main_user_type smallint;
	group_reading  smallint;
	el_reading 		 smallint;
	el_creating 	 smallint;
	activity_id 	 char(8);
	part 					 integer;
BEGIN
	/* Getting a GROUP to determine the rights to the operation */
	SELECT gl.user_type, g.reading, g.el_creating, g.el_reading
		INTO main_user_type, group_reading, el_creating, el_reading FROM groups_list AS gl
	LEFT JOIN groups AS g ON gl.group_id = g.id
	WHERE (gl.user_id = main_user_id OR gl.user_id = 0) AND (gl.group_id = _group_id);

	IF NOT FOUND THEN
		/* if SELECT return nothing */
		RAISE EXCEPTION 'Group for main user not found';
	END IF;

	/* SELECT return rows */
	IF group_reading < main_user_type THEN
		RAISE EXCEPTION 'No rights to read the group';
	END IF;

	IF el_reading < main_user_type THEN
		RAISE EXCEPTION 'No rights to read the elements in group';
	END IF;

	IF el_creating < main_user_type THEN
	  RAISE EXCEPTION 'No rights to create the element in the group';
	END IF;

	/* created new activity row */
	INSERT INTO activity (task_id, name, note, part, status, owner)
		VALUES (null, '', '', 0, 0, main_user_id)	RETURNING id INTO activity_id;

	PERFORM activity_place_list(main_user_id, _group_id, activity_id, null, _type_el, NOT _isStart);

	RETURN activity_id;
END;
$f$;

/* activity_place_list
	insert or move item _activity_id in group GRP_ID next to _relation_id,
	before it if IS_BEFORE is true, otherwise after. _relation_id may
	be null to indicate a position off the end of the list.

	вставить или переместить запись _activity_id в группе _group_id,
	после _relation_id если _isBefore = true, в противном случае до _relation_id.
	_relation_id может иметь значение NULL, что указывает позицию конеца списка.
*/
CREATE OR REPLACE FUNCTION activity_place_list(
	main_user_id integer,
	_group_id 	 char(8),
  _activity_id char(8),
  _relation_id char(8),
	_type_el 		 smallint,
  _is_before	 BOOL
)
RETURNS void LANGUAGE plpgsql volatile called ON NULL INPUT AS $f$
DECLARE
	p1 integer; q1 integer;   -- fraction below insert position | дробь позже вставляемой позиции
	p2 integer; q2 integer;   -- fraction above insert position | дробь раньше вставляемой позиции
	r_rel double precision;   -- p/q of the _relation_id row		| p/q значение _relation_id строки
	np integer; nq integer;   -- new insert position fraction
BEGIN
	-- perform выполняет select без возврата результата
	-- lock the groups
	PERFORM 1 FROM groups g WHERE g.id = _group_id FOR UPDATE;

	-- moving a record to its own position is a no-op
	IF _relation_id = _activity_id THEN RETURN; END IF;

	-- if we're positioning next to a specified row, it must exist
	IF _relation_id IS NOT NULL THEN
		SELECT al.p, al.q INTO strict p1, q1
		FROM activity_list al
		WHERE al.group_id = _group_id AND al.id = _relation_id;

		r_rel := p1::float8 / q1;
	END IF;

	-- find the next adjacent row in the desired direction (might not exist).
	IF _is_before THEN
		p2 := p1; q2 := q1;

		SELECT al2.p, al2.q INTO p1, q1
		FROM activity_list al2
		WHERE al2.group_id = _group_id AND al2.id <> _activity_id
			AND (p::float8/q) < COALESCE(r_rel, 'infinity')
		ORDER BY (p::float8/q) DESC LIMIT 1;
	ELSE
		SELECT al2.p, al2.q INTO p2, q2
		FROM activity_list al2
		WHERE al2.group_id = _group_id AND al2.id <> _activity_id
			AND (p::float8/q) > COALESCE(r_rel, 0)
		ORDER BY (p::float8/q) ASC LIMIT 1;
	END IF;

	-- compute insert fraction
	SELECT * INTO np, nq FROM find_intermediate(COALESCE(p1, 0), COALESCE(q1, 1),
																							COALESCE(p2, 1), COALESCE(q2, 0));

	-- move or insert the specified row
	UPDATE activity_list
		SET (p,q) = (np,nq) WHERE (group_id = _group_id) AND (id = _activity_id);
	IF NOT found THEN
		INSERT INTO activity_list VALUES (_activity_id, _group_id, main_user_id, _type_el, np, nq);
	END IF;

	-- want to renormalize both to avoid possibility of integer overflow
	-- and to ensure that distinct fraction values map to distinct float8
	-- values. Bounding to 10 million gives us reasonable headroom while
	-- not requiring frequent normalization.
	IF (np > 10000000) OR (nq > 10000000) THEN
		perform activity_renormalize(_group_id);
	END IF;
END;
$f$;

/* Renormalize the fractions of items in GRP_ID, preserving the existing order. The new
	fractions are not strictly optimal, but doing better would require much more complex
	calculations.

	The purpose of the complex update is as follows: we want to assign a new series of values
	1/2, 3/2, 5/2, ... to the existing rows, maintaining the existing order, but because the
	unique expression index is not deferrable, we want to avoid assigning any new value that
	collides with an existing one.

	We do this by calculating, for each existing row with an x/2 value, which position in the
	new sequence it would appear at. This is done by adjusting the value of p downwards
	according to the number of earlier values in sequence.
	To see why, consider:

  existing values:    3, 9,13,15,23
  new simple values:  1, 3, 5, 7, 9,11,13,15,17,19,21
                         *     *  *        *
  adjusted values:    1, 5, 7,11,17,19,21,25,27,29,31

  points of adjustment: 3, 7 (9-2), 9 (13-4, 15-6), 15 (23-8)

	The * mark the places where an adjustment has to be applied.

	Having calculated the adjustment points, the adjusted value is simply the simple value
	adjusted upwards according to the number of points passed (counting multiplicity).
*/
CREATE OR REPLACE FUNCTION activity_renormalize (
	_group_id char(8)
)
RETURNS void LANGUAGE plpgsql volatile strict AS $f$
BEGIN
  perform 1 FROM activity_list al WHERE al.group_id = _group_id FOR UPDATE;

	UPDATE activity_list al SET p = s2.new_rnum, q = 2
	FROM (
		SELECT id, is_existing = 0 AS is_new,
			-- increase the current value according to the
			-- number of adjustment points passed
			rnum + 2 * (SUM(is_existing) OVER (ORDER BY rnum)) AS new_rnum
		FROM (
			-- assign the initial simple values to every item in order
			SELECT id, 2 * (ROW_NUMBER() OVER (ORDER BY p::float8/q)) - 1	AS rnum, 0 AS is_existing
			FROM activity_list al2
			WHERE al2.group_id = _group_id
				UNION ALL
			-- and merge in the adjustment points required to
			-- skip over existing x/2 values
			SELECT id, p + 2 - 2 * (COUNT(*) OVER (ORDER BY p)) AS rnum, 1 AS is_existing
			FROM activity_list al3
			WHERE (al3.group_id = _group_id) AND (al3.q = 2)
		) s1
	) s2
	WHERE (s2.id = al.id)
		AND (s2.is_new)
		AND (al.group_id = _group_id);
END;
$f$;

/* Запрос активностей */
WITH RECURSIVE main_visible_groups AS (
	SELECT group_id FROM groups_list AS gl
	LEFT JOIN groups AS grp ON gl.group_id = grp.id
	WHERE (grp.reading >= gl.user_type)
		AND (grp.el_reading >= gl.user_type)
		AND (gl.user_id = 0 OR gl.user_id = 1)
	) SELECT al.id, al.group_id, al.user_id, act.task_id, al.type_el,
		tsk.name, act.note, act.productive, uf.url as avatar,
		act.part, act.status, act.owner, act.start, act.ends, tsk.singular,
		(SELECT a.start FROM activity AS a, tasks as t
			WHERE (a.task_id = t.id)
			AND (a.start < act.start AND a.task_id = act.task_id) 
			OR (a.start < act.start AND t.singular = true)) as beforeLimit
	FROM activity_list AS al
	LEFT JOIN activity AS act ON al.id = act.id
	LEFT JOIN users_photo AS uf ON (al.user_id = uf.user_id) AND (uf.isavatar = true)
	LEFT JOIN tasks AS tsk ON (act.task_id = tsk.id)
	WHERE al.group_id IN (SELECT * FROM main_visible_groups) 
	ORDER BY ((act.status = 1 or act.status = 5) and act.ends is null) DESC, act.start DESC;

WITH RECURSIVE main_visible_groups AS (
	SELECT group_id FROM groups_list AS gl
	LEFT JOIN groups AS grp ON gl.group_id = grp.id
	WHERE (grp.reading >= gl.user_type)
		AND (grp.el_reading >= gl.user_type)
		AND (gl.user_id = 0 OR gl.user_id = 1)
	), last_activity AS (
		select true as isLast, id from activity ORDER BY start DESC LIMIT 1
	)	SELECT al.id, al.group_id, al.user_id, act.task_id, al.type_el,
		tsk.name, act.note, act.productive, uf.url as avatar,
		act.part, act.status, act.owner, act.start, act.ends, tsk.singular,
		la.isLast
	FROM activity_list AS al
	LEFT JOIN last_activity AS la ON al.id = la.id
	LEFT JOIN activity AS act ON al.id = act.id
	LEFT JOIN users_photo AS uf ON (al.user_id = uf.user_id) AND (uf.isavatar = true)
	LEFT JOIN tasks AS tsk ON (act.task_id = tsk.id)
	WHERE al.group_id IN (SELECT * FROM main_visible_groups) 
	ORDER BY ((act.status = 1 or act.status = 5) and act.ends is null) DESC, act.start DESC;
	
	--la.isLast, a.start, a.id 

	WITH act AS (
    SELECT id, task_id, start, ends FROM activity WHERE id = 'ecuVmXd6'
  ), last_activity AS (
    select true as isLast, activity.id from activity, activity_list
    WHERE activity_list.id = activity.id AND activity_list.user_id = 1 ORDER BY start DESC LIMIT 1
  )	SELECT la.isLast, a.start, a.id  FROM activity AS a
		LEFT JOIN act ON true
		LEFT JOIN last_activity AS la ON true
		LEFT JOIN tasks as t ON a.task_id = t.id
		RIGHT JOIN activity_list as al ON (al.id = a.id) AND (al.user_id = 1)
      WHERE (a.start <= act.start AND a.id <> act.id AND a.task_id = act.task_id) 
        OR ((a.start <= act.start) AND (a.id <> act.id) 
            AND (a.task_id = t.id AND t.singular = true) AND (a.status = 1 OR a.status = 5))
      ORDER BY a.start DESC
      LIMIT 1;

/* Поиск активности со статусами "Started-1" или "Continued-5" */
SELECT al.id, act.status, act.start, act.ends
FROM activity_list AS al
RIGHT JOIN activity as act ON al.id = act.id
WHERE (al.user_id = 1)
	AND (act.task_id = 22)
	AND (act.ends is null)
	AND (act.status = 1 OR act.status = 5);

--SELECT add_activity(1, 1, 1::smallint, false);
UPDATE activity_list SET group_id = 1 WHERE id = 'NJPTN9KW';
UPDATE tasks_list SET group_id = 1 WHERE task_id = 42;

select * from activity;
select * from activity_list;
select * from tasks_list;
select * from tasks;

select * from groups;

-- openedActivity char(8)[]; /* del */

CREATE OR REPLACE FUNCTION create_activity (
	main_userId integer,
	_task_id 	 	 char(8),
	_group_id 	 char(8),
	_type_el 		 smallint,
	_status			 smallint,
	_start 			 timestamp with time zone,
	_nextTail		 boolean
)
RETURNS char(8)[] LANGUAGE plpgsql VOLATILE CALLED ON NULL INPUT AS $body$
DECLARE
	isSingularTask boolean;
	in_activity_id char(8);
	up_activity_id char(8);
	group_reading  smallint;
	main_user_type smallint;
	el_updating		 smallint;
	el_reading 		 smallint;
	el_creating 	 smallint;
	prevId				 char(8);
	prevStart			 timestamp with time zone;
	prevEnds			 timestamp with time zone;
	newEnds				 timestamp with time zone;
	openedActivity char(8)[];
BEGIN
	/* Getting a Task to determine the rights to the operation */
	SELECT t.singular INTO isSingularTask FROM groups_list AS gl
	LEFT JOIN groups AS grp ON gl.group_id = grp.id
	RIGHT JOIN tasks_list AS tl ON (gl.group_id = tl.group_id) AND (tl.task_id = _task_id)
	RIGHT JOIN tasks AS t ON (tl.task_id = t.id)
	WHERE (grp.reading >= gl.user_type)
		AND (grp.el_reading >= gl.user_type)
		AND (gl.user_id = 0 OR gl.user_id = main_userId);

	IF NOT FOUND THEN
		/* if SELECT return nothing */
		RAISE EXCEPTION 'Task for main user not found or user does not have rights';
	END IF;

	/* Getting a GROUP to determine the rights to the operation */
	SELECT gl.user_type, g.reading, g.el_creating, g.el_updating, g.el_reading
		INTO main_user_type, group_reading, el_creating, el_updating, el_reading FROM groups_list AS gl
	LEFT JOIN groups AS g ON gl.group_id = g.id
	WHERE (gl.user_id = main_userId OR gl.user_id = 0) AND (gl.group_id = _group_id);

	IF NOT FOUND THEN
		/* if SELECT return nothing */
		RAISE EXCEPTION 'Group for main user not found';
	END IF;

	/* SELECT return rows */
	IF group_reading < main_user_type THEN
		RAISE EXCEPTION 'No rights to read the group';
	END IF;

	IF el_reading < main_user_type THEN
		RAISE EXCEPTION 'No rights to read the elements in group';
	END IF;

	IF el_updating < main_user_type THEN
		RAISE EXCEPTION 'No rights to update the elements in group';
	END IF;

	IF el_creating < main_user_type THEN
	  RAISE EXCEPTION 'No rights to create the element in the group';
	END IF;

	IF _nextTail = true THEN
		_start := prevStart + interval '10 millisecond';
	END IF;

	prevEnds := null;
	/* Проверка на попадание в допустимый диапазон */
  SELECT activity.id, activity.start from activity, activity_list INTO prevId, prevStart, prevEnds
    WHERE (activity_list.id = activity.id)
			AND (activity_list.user_id = main_userId)
			AND (activity.task_id = _task_id) 
		ORDER BY start DESC LIMIT 1;

	IF FOUND AND prevStart > _start THEN
		RAISE EXCEPTION 'The start property of a new activity should be later than other activities for the same task';
	END IF;
	
	/* Если запускается singular задача, то все открытые активности со статусом 1 или 5 должны быть приостановлены */
	IF (isSingularTask = true) AND (COALESCE(_status, 0) = 1 OR COALESCE(_status, 0) = 5) THEN
		/* Need close all opened activity */
		WITH update_activity AS (
			UPDATE activity SET ends = _start FROM activity_list
			WHERE activity.id = activity_list.id
				AND (activity_list.user_id = main_userId)
				AND (activity.task_id <> _task_id)
				AND (activity.ends is null)
				AND (activity.status = 1 OR activity.status = 5)
			RETURNING activity.id, task_id
		), insert_activity AS (
			INSERT INTO activity (task_id, productive, status, owner, start, ends)
			SELECT ua.task_id, true, _status, main_userId, _start + interval '5 millisecond', null FROM update_activity AS ua
			RETURNING id
		), insert_activity_list AS (
			INSERT INTO activity_list (id, group_id, user_id, type_el)
			SELECT a.id, _group_id, main_userId, _type_el FROM insert_activity AS a
		) SELECT ARRAY(SELECT id FROM insert_activity UNION SELECT id FROM update_activity) INTO openedActivity;
	ELSE
		/* Закрытие и приостановка singular активности, если запускается любая другая активность */
		WITH update_activity AS (
			UPDATE activity SET ends = _start FROM activity_list, tasks
			WHERE activity.id = activity_list.id
				AND (tasks.id = activity.task_id)
				AND (activity_list.user_id = main_userId)
				AND (activity.task_id <> _task_id)
				AND (activity.ends is null)
				AND (activity.status = 1 OR activity.status = 5)
				AND (tasks.singular = true)
			RETURNING activity.id, task_id
		), insert_activity AS (
			INSERT INTO activity (task_id, productive, status, owner, start, ends)
			SELECT ua.task_id, true, _status, main_userId, _start + interval '5 millisecond', null FROM update_activity AS ua
			RETURNING id
		), insert_activity_list AS(
			INSERT INTO activity_list (id, group_id, user_id, type_el)
			SELECT a.id, _group_id, main_userId, _type_el FROM insert_activity AS a
		) SELECT ARRAY(SELECT id FROM insert_activity UNION SELECT id FROM update_activity) INTO openedActivity;
	END IF;

	/* Закрытие открытой активности по текущей задаче и пользователю, если такая существует */
	up_activity_id := null;
	UPDATE activity SET ends = _start + interval '50 millisecond' FROM activity_list
	WHERE activity.id = activity_list.id
		AND (activity_list.user_id = main_userId)
		AND (activity.task_id = _task_id)
		AND (activity.ends is null)
	RETURNING activity.id INTO up_activity_id;

	IF up_activity_id IS NOT NULL THEN
		openedActivity := array_append(openedActivity, up_activity_id);
	END IF;

	/* Создание новой активности */
	IF (_status = 2) OR (_status = 4) OR (_status = 6) THEN
		newEnds := _start + interval '100 millisecond';
	ELSE
		newEnds := null;
	END IF;

	WITH insert_activity AS (
		INSERT INTO activity (task_id, productive, status, owner, start, ends)
		VALUES (_task_id, true, _status, main_userId, _start + interval '100 millisecond', newEnds)
		RETURNING id
	)	INSERT INTO activity_list (id, group_id, user_id, type_el)
		SELECT a.id, _group_id, main_userId, _type_el FROM insert_activity AS a
	RETURNING id INTO in_activity_id;

	openedActivity := array_append(openedActivity, in_activity_id);

	RETURN openedActivity;
	-- RETURN array_to_string(openedActivity,',');
	-- RETURN activity_id;
END;
$body$;

CREATE OR REPLACE FUNCTION reorder_activity (
	main_userId 	integer,
	_activity_id 	char(8),
	_start 				timestamp with time zone,
	_ends 				timestamp with time zone
) RETURNS char(8)[] LANGUAGE plpgsql VOLATILE CALLED ON NULL INPUT AS $body$
DECLARE
	changedActivity char(8)[];
	aIsLast   boolean;
	prevStart timestamp with time zone;
	prevEnds	timestamp with time zone;
	prevStatus smallint;
	prevId		char(8);
	tempId		char(8);
	currStatus smallint;
BEGIN
	/* Проверка на права для редактирования текущей активности, только пользователь
		создавший активность может её переместить */
	SELECT id, status into tempId, currStatus FROM activity	WHERE (activity.owner = main_userId and activity.id = _activity_id);

	IF NOT FOUND THEN
		/* if SELECT return nothing */
		RAISE EXCEPTION 'Activity for main user not found';
	END IF;

	/* Изменение времени допускается у самой последней активности и до начала следующего статуса,
		поэтому надо убедиться, что меняется последняя активность и получить значения начала предыдущей активности
		в разрезе общей задачи или до активности принадлежащей задаче, которая имеет свойство singular */

	prevId := null;

	WITH act AS (
    SELECT id, task_id, start, ends FROM activity WHERE id = _activity_id
  ), last_activity AS (
    select true as isLast, activity.id from activity, activity_list
    WHERE activity_list.id = activity.id AND activity_list.user_id = main_userId ORDER BY start DESC LIMIT 1
  )	SELECT la.isLast, a.start, a.ends, a.id, a.status 
			INTO aIsLast, prevStart, prevEnds, prevId, prevStatus FROM activity AS a
		LEFT JOIN act ON true
		LEFT JOIN last_activity AS la ON true
		LEFT JOIN tasks as t ON a.task_id = t.id
		RIGHT JOIN activity_list as al ON (al.id = a.id) AND (al.user_id = main_userId)
      WHERE (a.start <= act.start AND a.id <> act.id AND a.task_id = act.task_id) 
        OR ((a.start <= act.start) AND (a.id <> act.id) 
            AND (a.task_id = t.id AND t.singular = true) AND (a.status = 1 OR a.status = 5))
      ORDER BY a.start DESC
      LIMIT 1;

	IF aIsLast = false THEN
		RAISE EXCEPTION 'Not is last activity';
	END IF;

	/* Если меняется свойство начала активности */
	IF _start IS NOT NULL THEN
		IF _start <= prevStart THEN
			RAISE EXCEPTION 'You can not position the current activity before the previous';
		END IF;

		IF currStatus = 2 OR currStatus = 4 OR currStatus = 6 THEN
			UPDATE activity SET start = _start + interval '50 millisecond', ends = _start + interval '50 millisecond' WHERE id = _activity_id;
		ELSE
			UPDATE activity SET start = _start + interval '50 millisecond' WHERE id = _activity_id;
		END IF;
		
		changedActivity := array_append(changedActivity, _activity_id);

		IF prevId IS NOT NULL THEN
			IF (_start < prevEnds) OR (prevStatus = 1 OR prevStatus = 5) THEN
				UPDATE activity SET ends = _start WHERE id = prevId;
				changedActivity := array_append(changedActivity, prevId);
			END IF;
		END IF;
	END IF;

	IF _ends IS NOT NULL THEN
		UPDATE activity SET ends = _ends WHERE id = _activity_id;
		changedActivity := array_append(changedActivity, _activity_id);
	END IF;

	return changedActivity;
END;
$body$;

CREATE OR REPLACE FUNCTION delete_activity (
	main_userId integer,
	_activity_id char(8),
	_check_one boolean
) RETURNS text LANGUAGE plpgsql VOLATILE CALLED ON NULL INPUT AS $body$
DECLARE
	taskId char(8);
	prevId char(8);
	prevGroupId char(8);
	curStatus smallint;
	curGroupId char(8);
	numActivity integer;
BEGIN
	/* Проверка на права для удаления текущей активности, только пользователь
		создавший активность может её удалить */
	SELECT a.task_id, a.status, al.group_id 
		INTO taskId, curStatus, curGroupId FROM activity AS a
	LEFT JOIN activity_list AS al ON (al.id = a.id) AND (al.user_id = main_userId)
	WHERE (a.owner = main_userId and a.id = _activity_id);

	IF NOT FOUND THEN
		/* if SELECT return nothing */
		RAISE EXCEPTION 'Activity for main user not found';
	END IF;

	/* Проверка удаления самой первой активности, по-умолчанию всегда должна существовать и 
		может удаляться только когда удаляется задача к этой активности */
	IF _check_one = true THEN
		select COUNT(id) into numActivity FROM activity WHERE (activity.task_id = taskId);

		IF (numActivity = 1) THEN
			RAISE EXCEPTION 'You can not delete the very first activity';
		END IF;
	END IF;

	prevId := null;

	WITH act AS (
    SELECT id, task_id, start, ends FROM activity WHERE id = _activity_id
  ) SELECT a.id, al.group_id INTO prevId, prevGroupId FROM activity AS a
		LEFT JOIN act ON true
		LEFT JOIN tasks AS t ON (a.task_id = t.id)
		RIGHT JOIN activity_list AS al ON (al.id = a.id) AND (al.user_id = main_userId)
      WHERE (a.start <= act.start AND a.id <> act.id AND a.task_id = act.task_id)
    ORDER BY a.start DESC LIMIT 1;

	IF prevId IS NOT NULL THEN
		UPDATE activity SET ends = null WHERE id = prevId;
	END IF;

	DELETE FROM activity WHERE (id = _activity_id);
	DELETE FROM activity_list WHERE (id = _activity_id AND user_id = main_userId);

	IF curStatus = 0 AND numActivity > 1 THEN
		/* Удалена активность смены группы задачи, значит необходимо вернуть задачу к предыдущей группе */
		perform task_place_list(prevGroupId, taskId, null, FALSE);
		DELETE FROM tasks_list WHERE (group_id = curGroupId) AND (task_id = taskId);
	END IF;

	return prevId;
END;
$body$;

SELECT create_activity(1, 'G0QSWHDs', 'xs0j5NnD', 2::smallint, 2::smallint, '2019-03-07T16:40:24.330Z');
--RAISE EXCEPTION 'WHAAAT %', prevStart;
-- RAISE EXCEPTION 'WHAAAT % and %', _start, prevStart;

SELECT ARRAY(SELECT al.id
	FROM activity_list AS al
	RIGHT JOIN activity AS act ON al.id = act.id
	WHERE (al.user_id = 1)
		AND (act.task_id <> 'Of7QWhYb')
		AND (act.ends is null)
		AND (act.status = 1 OR act.status = 5))::char(8)[];

WITH update_activity AS (
	UPDATE activity SET ends = now() FROM activity_list
	WHERE activity.id = activity_list.id
		AND (activity_list.user_id = 1)
		AND (activity.task_id <> 'Of7QWhYb')
		AND (activity.ends is null)
		AND (activity.status = 1 OR activity.status = 5)
	RETURNING task_id
), insert_activity AS (
	INSERT INTO activity (task_id, productive, status, owner, start, ends)
	SELECT ua.task_id, true, 3, 1, now() + interval '1 millisecond', null FROM update_activity AS ua
	RETURNING *
)	INSERT INTO activity_list (id, group_id, user_id, type_el)
	SELECT a.id, 'xs0j5NnD', 1, 2 FROM insert_activity AS a
	RETURNING *;

SELECT * from tasks;
SELECT * from tasks_list;
SELECT * from activity;
SELECT * from activity_list;

select * from activity WHERE id = 'jkYol3V6';
select * from activity WHERE id = 'OI1VaKyz';

UPDATE activity SET ends = null WHERE id = 'bJy_rfrn';
UPDATE activity SET ends = null WHERE id = 'OI1VaKyz';

INSERT INTO activity_list (id, group_id, user_id, type_el) VALUES ('xajUpg70', 'ZNXkXEWt', 1, 2)

DELETE FROM tasks WHERE id = 'n4xTNZbR';

DELETE FROM activity WHERE id = 'uUnuGQ20';
DELETE FROM activity_list WHERE id = 'xajUpg70' and group_id = 'GrYI0yqb';

DELETE FROM activity;
DELETE FROM activity_list;
DELETE FROM tasks;
DELETE FROM tasks_list;

SELECT delete_activity(1, 'fbDFtXLP', true);

WITH RECURSIVE main_visible_groups AS (
	SELECT group_id FROM groups_list AS gl
	LEFT JOIN groups AS grp ON gl.group_id = grp.id
	WHERE (grp.reading >= gl.user_type)
		AND (grp.el_reading >= gl.user_type)
		AND (gl.user_id = 0 OR gl.user_id = 1)
	), last_activity AS (
		select true as isLast, id from activity ORDER BY start DESC LIMIT 1
	)	SELECT al.id, al.group_id, al.user_id, act.task_id, al.type_el,
		tsk.name, act.note, act.productive, uf.url as avatar,
		act.part, act.status, act.owner, act.start, act.ends, tsk.singular,
		la.isLast
	FROM activity_list AS al
	LEFT JOIN last_activity AS la ON al.id = la.id
	LEFT JOIN activity AS act ON al.id = act.id
	LEFT JOIN users_photo AS uf ON (al.user_id = uf.user_id) AND (uf.isavatar = true)
	LEFT JOIN tasks AS tsk ON (act.task_id = tsk.id)
	WHERE al.group_id IN (SELECT * FROM main_visible_groups) 
	ORDER BY ((act.status = 1 or act.status = 5) and act.ends is null) DESC, act.start DESC;

	WITH acts(duration, task_id) AS (
		SELECT SUM(extract(EPOCH from act.ends) - extract(EPOCH from act.start)) as duration,
			act.task_id FROM activity_list AS al
		JOIN activity AS act ON (act.id = al.id)
		WHERE (act.task_id = 'Ta63o7yX')
			AND (act.status = 1 OR act.status = 5)
		GROUP BY act.task_id
	)	SELECT t.id, act.status, (SELECT duration FROM acts WHERE acts.task_id = tl.task_id) * 1000 AS duration, act.start
		FROM tasks_list AS tl
		RIGHT JOIN tasks AS t ON tl.task_id = t.id
		JOIN activity_list AS al ON (al.group_id = tl.group_id) AND (al.user_id = 1)
		JOIN activity AS act ON (act.task_id = tl.task_id) AND (act.ends IS NULL) AND (act.id = al.id)
		WHERE tl.task_id = 'Ta63o7yX';

WITH RECURSIVE main_visible_groups AS (
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
	)
	SELECT t.id, tl.group_id, tl.p, tl.q,	t.tid, t.name, t.owner,	t.note, t.parent,
		(SELECT duration FROM acts WHERE acts.task_id = tl.task_id) * 1000 AS duration, 
		-- act.status, act.start, 
		t.depth, t.level, t.singular
	FROM tasks_list AS tl
	JOIN tasks AS t ON tl.task_id = t.id
	-- JOIN activity_list AS al ON (al.group_id = tl.group_id) AND (al.user_id = 1)
	-- JOIN activity AS act ON (act.task_id = tl.task_id) 
		-- AND (act.ends IS NULL OR act.status = 2 OR act.status = 4 OR act.status = 6) 
		-- AND (act.id = al.id)
	WHERE tl.group_id IN (SELECT * FROM main_visible_groups)  AND t.parent is null
	ORDER BY tl.group_id, (tl.p::float8/tl.q) LIMIT 10 OFFSET 0;
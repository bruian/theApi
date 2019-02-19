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
	p INTEGER NOT NULL, q INTEGER NOT NULL,
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
  perform 1 FROM groups g WHERE g.id = _group_id FOR UPDATE;

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

select * from users_photo

/* Запрос активностей */
WITH RECURSIVE main_visible_groups AS (
	SELECT group_id FROM groups_list AS gl
	LEFT JOIN groups AS grp ON gl.group_id = grp.id
	WHERE (grp.reading >= gl.user_type)
		AND (grp.el_reading >= gl.user_type)
		AND (gl.user_id = 0 OR gl.user_id = 1)
	)  SELECT al.id, al.group_id, al.user_id, act.task_id, al.type_el,
		act.name, act.note, act.productive, uf.url as avatar,
		act.part, act.status, act.owner, act.start, act.ends
	FROM activity_list AS al
	LEFT JOIN activity AS act ON al.id = act.id
	LEFT JOIN users_photo AS uf ON (al.user_id = uf.user_id) AND (uf.isavatar = true)
	WHERE al.group_id IN (SELECT * FROM main_visible_groups) AND (al.type_el & 2 > 0)
	ORDER BY al.group_id, (al.p::float8/al.q) LIMIT 10 OFFSET 0;


WITH RECURSIVE main_visible_groups AS (
	SELECT group_id FROM groups_list AS gl
	LEFT JOIN groups AS grp ON gl.group_id = grp.id
	WHERE (grp.reading >= gl.user_type)
		AND (grp.el_reading >= gl.user_type)
		AND (gl.user_id = 0 OR gl.user_id = 1) --$
) SELECT al.id, al.group_id, al.user_id, act.task_id,
		act.name, act.note, act.productive, uf.url as avatar,
		act.part, act.status, act.owner, act.start, act.ends
	FROM activity_list AS al
	LEFT JOIN activity AS act ON al.id = act.id
	LEFT JOIN users_photo AS uf ON (al.user_id = uf.user_id) AND (uf.isavatar = true)
	WHERE al.group_id IN (SELECT * FROM main_visible_groups) --${pgСonditions}
	ORDER BY al.group_id, (al.p::float8/al.q) --${pgLimit};

select * FROM activity;
SELECT * from activity_list;

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

delete from activity;
delete from activity_list;
delete from tasks;
delete from tasks_list;

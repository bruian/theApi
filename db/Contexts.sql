CREATE TABLE context (
  id char(8) PRIMARY KEY,
  value varchar(1024),
  CONSTRAINT cont_id UNIQUE(id, value)
);

CREATE TRIGGER trigger_context_genid BEFORE INSERT ON context FOR EACH ROW EXECUTE PROCEDURE unique_short_id();
CREATE UNIQUE INDEX ON context (value);

CREATE TABLE context_list (
  task_id char(8), 
  context_id char(8)
);
CREATE UNIQUE INDEX ON context_list (task_id, context_id);

CREATE TABLE context_setting (
  context_id char(8), 
  user_id integer, 
  id_inherited integer, 
  active boolean, 
  note varchar(2000), 
  activity_type smallint
);
CREATE UNIQUE INDEX ON context_setting (context_id, user_id);

/* Context by user */
WITH main_visible_groups AS (
SELECT group_id FROM groups_list AS gl
	LEFT JOIN groups AS grp ON gl.group_id = grp.id
	WHERE grp.reading >= gl.user_type AND (gl.user_id = 0 OR gl.user_id = 1)
)
SELECT tl.group_id, tl.task_id, cl.context_id, c.value,
	cs.user_id, cs.inherited_id, cs.active, cs.note, cs.activity_type FROM tasks_list AS tl
RIGHT JOIN context_list AS cl ON cl.task_id = tl.task_id
RIGHT JOIN context AS c ON cl.context_id = c.id
RIGHT JOIN context_setting AS cs ON cs.context_id = cl.context_id AND cs.user_id = 1
WHERE tl.group_id IN (SELECT * FROM main_visible_groups);

--SELECT add_task_context(1, 1, 3, '');
--SELECT delete_task_context(1, 1, 7);
--SELECT * FROM context;
--SELECT * FROM context_setting;
--SELECT * FROM context_list;

/* DELETE context from task */
CREATE OR REPLACE FUNCTION delete_task_context (
	main_user_id integer,
	_task_id char(8),
	_context_id char(8)
)
RETURNS text LANGUAGE plpgsql VOLATILE CALLED ON NULL INPUT AS $f$
DECLARE
  main_group_id char(8);
	main_user_type integer;
	main_group_reading integer;
	main_el_reading integer;
	main_el_updating integer;
	inner_context_id char(8);
BEGIN
	SELECT tl.group_id, gl.user_type, g.reading, g.el_reading, g.el_updating
	  INTO main_group_id, main_user_type, main_group_reading, main_el_reading, main_el_updating FROM tasks_list AS tl
	RIGHT JOIN groups_list AS gl ON gl.group_id = tl.group_id AND (gl.user_id = main_user_id OR gl.user_id = 0)
	RIGHT JOIN groups AS g ON gl.group_id = g.id
	WHERE tl.task_id = _task_id;

	IF NOT FOUND THEN
	  RAISE EXCEPTION 'There is no group or task that matches the specified <task-id> or main user token';
	END IF;

  IF main_group_id IS NULL THEN
    RAISE EXCEPTION 'There is no group or task that matches the specified <task-id> or main user token';
  END IF;

	IF main_group_reading < main_user_type THEN
	  RAISE EXCEPTION 'No rights to read the group containing the task';
	END IF;

	IF main_el_reading < main_user_type THEN
	  RAISE EXCEPTION 'No rights to read the task by the ID';
	END IF;

	IF main_el_updating < main_user_type THEN
	  RAISE EXCEPTION 'No rights to update the task by the ID';
	END IF;

	IF _context_id is null THEN
		RAISE EXCEPTION 'Values must contain either the name of the context or its id';
	END IF;

	SELECT id INTO inner_context_id FROM context WHERE id = _context_id;
	IF NOT FOUND THEN
		RAISE EXCEPTION 'There is no context with such an id and the name of the context for its creation is not specified';
	END IF;

	DELETE FROM context_list AS cl WHERE (cl.context_id = inner_context_id AND cl.task_id = _task_id);

	RETURN inner_context_id;
  END;
$f$;

select * from context;
select * from tasks;
DELETE FROM context;
SELECT add_task_context(1, 'zQB6Bmz_', null, 'Home');
INSERT INTO context (value) VALUES ('Home') ON CONFLICT(value) DO NOTHING RETURNING (id) ;

/* ADD context to task */
CREATE OR REPLACE FUNCTION add_task_context (
	main_user_id integer,
	_task_id char(8),
	_context_id char(8),
	_context_value TEXT
)
RETURNS text LANGUAGE plpgsql VOLATILE CALLED ON NULL INPUT AS $f$
DECLARE
  main_group_id char(8);
  main_user_type integer;
	main_group_reading integer;
	main_el_reading integer;
	main_el_updating integer;
	inner_context_id char(8);
	tmp_id char(8);
BEGIN
	SELECT tl.group_id, gl.user_type, g.reading, g.el_reading, g.el_updating
	  INTO main_group_id, main_user_type, main_group_reading, main_el_reading, main_el_updating FROM tasks_list AS tl
	RIGHT JOIN groups_list AS gl ON gl.group_id = tl.group_id AND (gl.user_id = main_user_id OR gl.user_id = 0)
	RIGHT JOIN groups AS g ON gl.group_id = g.id
	WHERE tl.task_id = _task_id;

	IF NOT FOUND THEN
	  RAISE EXCEPTION 'There is no group or task that matches the specified <task-id> or main user token';
	END IF;

  IF main_group_id IS NULL THEN
	  RAISE EXCEPTION 'There is no group or task that matches the specified <task-id> or main user token';
  END IF;

	IF main_group_reading < main_user_type THEN
	  RAISE EXCEPTION 'No rights to read the group containing the task';
	END IF;

	IF main_el_reading < main_user_type THEN
	  RAISE EXCEPTION 'No rights to read the task by the ID';
	END IF;

	IF main_el_updating < main_user_type THEN
	  RAISE EXCEPTION 'No rights to update the task by the ID';
	END IF;

	IF _context_value = '' THEN
		IF _context_id is null THEN
			RAISE EXCEPTION 'Values must contain either the name of the context or its id';
		END IF;

		SELECT id INTO inner_context_id FROM context WHERE id = _context_id;
		IF NOT FOUND THEN
			RAISE EXCEPTION 'There is no context with such an id and the name of the context for its creation is not specified';
		END IF;
	ELSE
		INSERT INTO context (value) VALUES (_context_value) ON CONFLICT(value) DO NOTHING RETURNING (id) INTO inner_context_id;
		IF inner_context_id IS NULL THEN
		  IF _context_id IS NULL THEN
			SELECT id INTO inner_context_id FROM context WHERE value = _context_value;
		  ELSE
			inner_context_id := _context_id;
		  END IF;
		END IF;
	END IF;

	SELECT cl.task_id INTO tmp_id FROM context_list AS cl WHERE cl.task_id = _task_id AND cl.context_id = inner_context_id;
	IF NOT FOUND THEN
	  INSERT INTO context_list (task_id, context_id) VALUES (_task_id, inner_context_id);
	END IF;

	SELECT cs.context_id INTO tmp_id FROM context_setting AS cs WHERE cs.context_id = inner_context_id AND cs.user_id = main_user_id;
	IF NOT FOUND THEN
	  INSERT INTO context_setting (context_id, user_id) VALUES (inner_context_id, main_user_id);
	END IF;

	RETURN inner_context_id;
END;
$f$;

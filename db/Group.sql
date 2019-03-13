/* Create table - groups */
CREATE TABLE groups (
	id 			char(8) PRIMARY KEY,
	parent 	char(8),
	name 		varchar(100),
	group_type smallint DEFAULT 1,
	creating 	 smallint DEFAULT 1, 
	reading 	 smallint DEFAULT 1,
	updating 	 smallint DEFAULT 1,
	deleting 	 smallint DEFAULT 1,
	el_creating smallint DEFAULT 1,
	el_reading  smallint DEFAULT 1,
	el_updating smallint DEFAULT 1,
	el_deleting smallint DEFAULT 1,
	owner integer,
	level smallint NOT NULL DEFAULT 1,
	depth smallint NOT NULL DEFAULT 1;
	CONSTRAINT gr_id UNIQUE(id)
);

CREATE TRIGGER trigger_groups_genid BEFORE INSERT ON groups FOR EACH ROW EXECUTE PROCEDURE unique_short_id();

/* Change table columns */
--ALTER TABLE groups RENAME COLUMN task_deleting TO el_deleting;
--ALTER TABLE groups ADD COLUMN type smallint;
--ALTER TABLE groups DROP COLUMN curator;

/* Create groups list table */
CREATE TABLE groups_list (
	user_id int, 
	group_id char(8),
	p INTEGER NOT NULL, q INTEGER NOT NULL,
	user_type smallint DEFAULT 1
);

CREATE INDEX ON groups_list (user_id, group_id);

DELETE FROM activity;
DELETE FROM activity_list;
DELETE FROM groups;
DELETE FROM groups_list;
DELETE FROM tasks;
DELETE FROM tasks_list;
DELETE FROM users;
DELETE FROM users_list;
DELETE FROM sheets;
DELETE FROM sheets_conditions;
DELETE FROM clients;

select add_group(1, '0ZfgI7KW', 2, true);

DELETE FROM groups WHERE id = 'nKH6ok6z';
UPDATE groups SET depth = 1 WHERE (id = 'EvUnHsjl');
select * from groups;
select * from groups_list;

/* Create new group in groups table, and add it in groups_list table 
	group_type = {
		primary = 1, - it's default groups (user can't delete its) 
		secondary = 2, - it's user created groups
		shared = 3, - it's shared groups
	}
*/
CREATE OR REPLACE FUNCTION add_group (
	main_user_id integer,
	_parent_id 	 char(8),
	_group_type  integer,
	_isStart 		 boolean
)
RETURNS text LANGUAGE plpgsql VOLATILE CALLED ON NULL INPUT AS $f$
DECLARE
	group_id 		char(8);
	newParent 	char(8);
	newLevel 		smallint;
	descLevel 	smallint;
	depthParent char(8);
BEGIN
	newParent := _parent_id;
	IF newParent = '0' THEN
		newParent := null;
	END IF;

	/* Вычисление уровеня элемента */
	IF newParent is null THEN
		newLevel := 1;
	ELSE
		SELECT level INTO descLevel FROM groups AS g WHERE g.id = newParent;
		newLevel := descLevel + 1;
	END IF;

	/* Пересчёт глубины вложенных элементов, глубина нужна для вычисления пределов
	перемещения элементов на клиенте без загрузки всей иерархии с сервера */
	IF newLevel = 3 THEN
		UPDATE groups SET depth = 2 WHERE (id = newParent) AND (depth < 2);
		SELECT parent INTO depthParent FROM groups WHERE (id = newParent);
		UPDATE groups SET depth = 3 WHERE (id = depthParent) AND (depth < 3);
	ELSIF newLevel = 2 THEN
		UPDATE groups SET depth = 2 WHERE (id = newParent) AND (depth < 2);
	END IF;	

	INSERT INTO groups (parent, name, group_type, owner, level, depth)
		VALUES (newParent, '', _group_type, main_user_id, newLevel, 1)
		RETURNING id INTO group_id;

	PERFORM group_place_list(main_user_id, group_id, newParent, NOT _isStart);

	RETURN group_id;
END;
$f$;

/* Delete group in groups table, and add it in groups_list table */
CREATE OR REPLACE FUNCTION delete_group (
	main_user_id 		integer,
	_group_id 			char(8),
	_isOnlyFromList boolean
)
RETURNS text LANGUAGE plpgsql VOLATILE CALLED ON NULL INPUT AS $f$
DECLARE
	main_user_type 		  integer;
	main_group_reading  integer;
	main_group_deleting integer;
	countchild 				  integer;
	group_type          integer;
	el_parent					  char(8);
	el_level						smallint;
	el_depth						smallint;
BEGIN
	SELECT gl.user_type, g.reading, g.deleting, g.group_type
		INTO main_user_type, main_group_reading, main_group_deleting, group_type FROM groups_list AS gl
	LEFT JOIN groups AS g ON gl.group_id = g.id
	WHERE (gl.user_id = main_user_id OR gl.user_id is null) AND (gl.group_id = _group_id);

	IF NOT FOUND THEN
	  RAISE EXCEPTION 'Group for main user not found';
	END IF;

	IF main_group_reading < main_user_type THEN
	  RAISE EXCEPTION 'No rights to read the group';
	END IF;

	IF main_group_deleting < main_user_type THEN
	  RAISE EXCEPTION 'No rights to delete the group';
	END IF;

	IF group_type = 1 THEN
		RAISE EXCEPTION 'Can not delete default group';
	END IF;

	SELECT count(id) INTO countchild FROM groups WHERE parent = _group_id;
	IF countchild > 0 THEN
	  RAISE EXCEPTION 'Can not delete. Group have subelement';
	END IF;

	SELECT parent, level INTO el_parent, el_level FROM groups WHERE id = _group_id;

	IF _isOnlyFromList = TRUE THEN
	  DELETE FROM groups_list WHERE (group_id = _group_id) AND (user_id = main_user_id);
	  UPDATE groups SET parent = null WHERE (id = _group_id);
	ELSE
	  DELETE FROM groups_list WHERE (group_id = _group_id);
	  DELETE FROM groups WHERE (id = _group_id);
	END IF;

	IF el_parent IS NOT NULL THEN
		/* Если есть родитель у удаляемого элемента, значит необходимо пересчитать 
			его глубину с учетом удаленного элемента */

		/* Рекурсивный пересчёт новой глубины у родителя */
		WITH RECURSIVE descendants AS (
			SELECT id, parent, 1 depth FROM groups WHERE id = el_parent
		UNION
			SELECT g.id, g.parent, d.depth + 1 FROM groups g INNER JOIN descendants d
			ON g.parent = d.id
		)
		SELECT MAX(depth) INTO el_depth FROM descendants d;

		UPDATE groups SET depth = el_depth WHERE id = el_parent;
	END IF;

	UPDATE groups SET (depth, level) = (1, 1) WHERE id = _group_id;

	RETURN _group_id;
END;
$f$;

/**
 * @func reorder_group
 * @param {integer} mainUser_id - идентификатор текущего пользователя
 * @param {char(8)} _group_id - идентификатор элемента перемещаемой группы
 * @param {char(8)} _relation_id - идентификатор элемента на который перемещается группа
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
CREATE OR REPLACE FUNCTION reorder_group (
	main_user_id integer,
	_group_id 	 char(8),
  _relation_id char(8),
  _is_before 	 boolean,
	_parent 		 char(8)
) RETURNS integer LANGUAGE plpgsql VOLATILE CALLED ON NULL INPUT AS $f$
DECLARE
	before_level				smallint;
	before_depth				smallint;
	before_parent_depth smallint;
	before_parent_id 		char(8);
	main_group_id 			char(8);
	main_group_reading 	integer;
	main_group_updating	integer;
	main_user_type 			integer;
	rel_group_id 				char(8);
	parent_level				smallint;
BEGIN
	/* Выборка доступной пользователю группы для проверки прав на операции с ней,
		где user_id is null это группы общие для всех пользователей */
	SELECT group_id, grp.reading, grp.updating, gl.user_type
	  INTO main_group_id, main_group_reading, main_group_updating, main_user_type
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

	IF _parent = '0' THEN
		_parent := null;
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

	IF main_group_updating < main_user_type THEN
		RAISE EXCEPTION 'User does not have permissions to updating this group';
	END IF;

	IF _parent = '0' THEN
		_parent := null;
	END IF;

	/* Получение предыдущих значений группы и родителя */
	SELECT g.parent, g.level, g.depth
		INTO strict before_parent_id, before_level, before_depth
	FROM groups_list AS gl
	LEFT JOIN groups AS g ON g.id = gl.group_id
	WHERE (gl.group_id = _group_id) AND (gl.user_id = main_user_id)
	GROUP BY gl.group_id, g.parent, g.level, g.depth;

	parent_level := 0;

	/* Сравнение родителей у старой и новой позиции, если поменялись, то необходимо обновить */
	IF COALESCE(_parent, '0') <> COALESCE(before_parent_id, '0') THEN
		/* Смена родителя, что может означать и смену уровня элемента. Поэтому необходимо
			проверить допустимостимость такого перемещения, что бы не выйти за ограничение 
			вложенности в 3 уровня */
		IF _parent IS NOT NULL THEN
			SELECT level INTO parent_level FROM groups WHERE id = _parent;
		END IF;

		IF (parent_level + before_depth) > 3 THEN
			RAISE EXCEPTION 'Out of level';
		END IF;

		/* Обновление родителя */
		UPDATE groups SET parent = _parent WHERE id = _group_id;

		/* Ну и конечно же, раз изменился состав элементов у предыдущего родителя, то ему необходимо
			пересчитать depth */
		IF before_parent_id IS NOT NULL THEN
			WITH RECURSIVE descendants AS (
				SELECT id, parent, 1 depth FROM groups WHERE id = before_parent_id
			UNION
				SELECT g.id, g.parent, d.depth + 1 FROM groups g INNER JOIN descendants d
				ON g.parent = d.id
			)
			SELECT MAX(depth) INTO before_parent_depth FROM descendants d;

			UPDATE groups SET depth = before_parent_depth WHERE id = before_parent_id;
		END IF;
	END IF;

	/* Обработка перемещения элемента в списке groups_list, тут важно организовать правильное
		положение элемента в списке (то что задал пользователь), для этого используется частное
		от деления полей p/q, где получается дробное число и сортировка происходит в порядке
		дробных значений. Алгоритм: Дерево Штерна-Брока.
		_relation_id - входящий параметр, означает элемент на который помещается "перемещаемый
		элемент", может иметь значение null это значит что "перемещаемый элемент" помещается в
		начало или конец списка (регулируется параметром _is_before)
	*/
	perform group_place_list(main_user_id, _group_id, _relation_id, _is_before);

	/* Пересчет level и depth у родителя, если он есть. Так же и у самого элемента. Т.к. иерархия 
		ограничена 3 уровнями, то нет необходимости мудрить конструкции с циклами */
	IF COALESCE(_parent, '0') <> COALESCE(before_parent_id, '0') THEN
		/* Отталкиваясь от уровня нового родителя можно вычислить уровень для текущего элемента */
		UPDATE groups SET level = parent_level + 1 WHERE id = _group_id;

		/* И его потомков */
		UPDATE groups SET level = parent_level + 2 WHERE parent = _group_id;
		
		/* Рекурсивный пересчёт новой глубины у родителя */
		WITH RECURSIVE descendants AS (
			SELECT id, parent, 1 depth FROM groups	WHERE id = _parent
		UNION
			SELECT g.id, g.parent, d.depth + 1 FROM groups g	INNER JOIN descendants d
			ON g.parent = d.id
		)
		SELECT MAX(depth) INTO before_depth FROM descendants d;

		/* Тут прост используется свободная переменная before_depth для передачи значения */
		UPDATE groups SET depth = before_depth WHERE id = _parent;
	END IF;

	/* Возвращается единичка, как признак, что все нормально поменялось */
	return 1;
END;
$f$;

-- вставить или переместить запись GRP_ID
-- после REL_ID если IS_BEFORE=true, в противном случае до REL_ID.
-- REL_ID может иметь значени NULL, что указывает позицию конца списка.
CREATE OR REPLACE FUNCTION group_place_list (
	usr_id integer,
	grp_id char(8),
  rel_id char(8),
  is_before boolean
) RETURNS void LANGUAGE plpgsql volatile called ON NULL INPUT AS $f$
DECLARE
  p1 INTEGER; q1 INTEGER;   -- fraction below insert position | дробь позже вставляемой позиции
  p2 INTEGER; q2 INTEGER;   -- fraction above insert position | дробь раньше вставляемой позиции
  r_rel DOUBLE PRECISION;   -- p/q of the rel_id row			| p/q значение rel_id строки
  np INTEGER; nq INTEGER;   -- new insert position fraction
BEGIN
	-- perform выполняет select без возврата результата
	-- lock the groups
	perform 1 FROM groups g WHERE g.id=grp_id FOR UPDATE;

	-- moving a record to its own position is a no-op
	IF rel_id=grp_id THEN RETURN; END IF;

	-- if we're positioning next to a specified row, it must exist
	IF rel_id IS NOT NULL THEN
		SELECT gl.p, gl.q INTO strict p1, q1
			FROM groups_list gl
			WHERE gl.user_id=usr_id AND gl.group_id=rel_id;
		r_rel := p1::float8 / q1;
	END IF;

	-- find the next adjacent row in the desired direction
	-- (might not exist).
	IF is_before THEN
		p2 := p1; q2 := q1;
		SELECT gl2.p, gl2.q INTO p1, q1
			FROM groups_list gl2
			WHERE gl2.user_id=usr_id AND gl2.group_id <> grp_id
				AND (p::float8/q) < COALESCE(r_rel, 'infinity')
			ORDER BY (p::float8/q) DESC LIMIT 1;
	ELSE
		SELECT gl2.p, gl2.q INTO p2, q2
			FROM groups_list gl2
			WHERE gl2.user_id=usr_id AND gl2.group_id <> grp_id
				AND (p::float8/q) > COALESCE(r_rel, 0)
			ORDER BY (p::float8/q) ASC LIMIT 1;
	END IF;

	-- compute insert fraction
	SELECT * INTO np, nq FROM find_intermediate(COALESCE(p1, 0), COALESCE(q1, 1),
																							COALESCE(p2, 1), COALESCE(q2, 0));

	-- move or insert the specified row
	UPDATE groups_list
		SET (p,q) = (np,nq) WHERE user_id=usr_id AND group_id=grp_id;
	IF NOT found THEN
		INSERT INTO groups_list VALUES (usr_id, grp_id, np, nq);
	END IF;

	-- want to renormalize both to avoid possibility of integer overflow
	-- and to ensure that distinct fraction values map to distinct float8
	-- values. Bounding to 10 million gives us reasonable headroom while
	-- not requiring frequent normalization.

	IF (np > 10000000) OR (nq > 10000000) THEN
		perform grp_renormalize(grp_id);
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
CREATE OR REPLACE FUNCTION grp_renormalize(usr_id integer)
RETURNS void LANGUAGE plpgsql volatile strict AS $f$
BEGIN
	perform 1 FROM groups_list gl WHERE gl.user_id=usr_id FOR UPDATE;

	UPDATE groups_list gl SET p=s2.new_rnum, q=2
		FROM (SELECT group_id,
									is_existing = 0 AS is_new,
									-- increase the current value according to the
									-- number of adjustment points passed
									rnum + 2*(SUM(is_existing) OVER (ORDER BY rnum)) AS new_rnum
						FROM (
									-- assign the initial simple values to every item
									-- in order
									SELECT group_id,
													2*(ROW_NUMBER() OVER (ORDER BY p::float8/q)) - 1
														AS rnum,
													0 AS is_existing
										FROM groups_list gl2
										WHERE gl2.user_id=usr_id
									UNION ALL
									-- and merge in the adjustment points required to
									-- skip over existing x/2 values
									SELECT group_id,
													p + 2 - 2*(COUNT(*) OVER (ORDER BY p))
														AS rnum,
													1 AS is_existing
										FROM groups_list gl3
										WHERE gl3.user_id=usr_id
											AND gl3.q=2
									) s1
					) s2
		WHERE s2.group_id=gl.group_id
			AND s2.is_new
			AND gl.user_id=usr_id;
END;
$f$;
/* Select user groups
SELECT * FROM groups_list, groups 
WHERE (groups_list.group_id = groups.id) 
	AND (groups_list.user_id = 3) 
	AND (groups_list.user_type >= groups.reading);
*/

/* Запрос всей иерархии группы */
WITH RECURSIVE recursive_tree (id, parent, path, user_type, level) AS (
	SELECT T1g.id, T1g.parent, CAST (T1g.id AS VARCHAR (50)) AS path, T1gl.user_type, 1
    FROM groups_list AS T1gl
	RIGHT JOIN groups AS T1g ON (T1gl.group_id = T1g.id)
	WHERE T1g.parent IS NULL AND T1gl.group_id = 50
		UNION
	SELECT T2g.id, T2g.parent, CAST (recursive_tree.PATH ||'->'|| T2g.id AS VARCHAR(50)), T2gl.user_type, level + 1
    FROM groups_list AS T2gl
	RIGHT JOIN groups AS T2g ON (T2gl.group_id = T2g.id)
	INNER JOIN recursive_tree ON (recursive_tree.id = T2g.parent)
)
SELECT recursive_tree.id, recursive_tree.user_type, grp.name, recursive_tree.parent, recursive_tree.level, recursive_tree.path,
	   grp.creating, grp.reading, grp.updating, grp.deleting, grp.el_creating,
	   grp.el_reading, grp.el_updating, grp.el_deleting, grp.group_type FROM recursive_tree
LEFT JOIN groups AS grp ON recursive_tree.id = grp.id
ORDER BY path;


/* Запрос всех групп первого уровня не принадлежащие main user. Ограничение по: видимости main user */
/* AND grp.reading >= gl.user_type ограничение видимости группы по типу пользователя
 user_type: 1-owner, 2-curator, 3-member, 4-all (все группы с таким типом имеют id = 0)
 reading->enum_reading: 0-not readable, 1-owner reading, 2-curator reading, 3-member reading, 4-reading by all */
/* AND grp.owner != 1 отбор по владельцу группы, что бы не main user */
/* выборка групп, которые не имеют потомков
SELECT group_id, user_type, name, parent, creating, reading, updating, deleting, el_creating, el_reading, el_updating, el_deleting, group_type, 0 AS haveChild FROM groups_list AS gl
	RIGHT JOIN groups AS grp ON gl.group_id = grp.id AND grp.owner != 1
	WHERE grp.parent IS null AND gl.group_id NOT IN (SELECT parent FROM groups WHERE parent IS NOT null GROUP BY parent) AND grp.reading >= gl.user_type AND (gl.user_id = 0 OR gl.user_id = 1)
UNION /* выборка групп, которые имеют потомков И ОБЪЕДИНЕНИЕ с той, что не имеют потомков. Индикатор haveChild*/
SELECT group_id, user_type, name, parent, creating, reading, updating, deleting, el_creating, el_reading, el_updating, el_deleting, group_type, 1 AS haveChild FROM groups_list AS gl
	RIGHT JOIN groups AS grp ON gl.group_id = grp.id AND grp.owner != 1
	WHERE grp.parent IS null AND gl.group_id IN (SELECT parent FROM groups WHERE parent IS NOT null GROUP BY parent) AND grp.reading >= gl.user_type AND (gl.user_id = 0 OR gl.user_id = 1)
LIMIT 10 OFFSET 0
*/

/* Main groups tree */
WITH RECURSIVE recursive_tree (id, parent, path, user_type, level) AS (
	SELECT T1g.id, T1g.parent, CAST (T1g.id AS VARCHAR (50)) AS path, T1gl.user_type, 1
    FROM groups_list AS T1gl
	RIGHT JOIN groups AS T1g ON (T1gl.group_id = T1g.id)
	WHERE T1g.parent IS NULL AND T1gl.user_id = 1
		UNION
	SELECT T2g.id, T2g.parent, CAST (recursive_tree.PATH ||'->'|| T2g.id AS VARCHAR(50)), T2gl.user_type, recursive_tree.level + 1
    FROM groups_list AS T2gl
	RIGHT JOIN groups AS T2g ON (T2gl.group_id = T2g.id)
	INNER JOIN recursive_tree ON (recursive_tree.id = T2g.parent)
) SELECT recursive_tree.id, recursive_tree.user_type, grp.name, recursive_tree.parent, recursive_tree.level, recursive_tree.path,
	   grp.creating, grp.reading, grp.updating, grp.deleting, grp.el_creating,
	   grp.el_reading, grp.el_updating, grp.el_deleting, grp.group_type FROM recursive_tree
LEFT JOIN groups AS grp ON recursive_tree.id = grp.id
ORDER BY path;

WITH RECURSIVE recursive_tree (id, parent, path, user_type, level) AS (
      SELECT T1g.id, T1g.parent, CAST (T1g.id AS VARCHAR (50)) AS path, T1gl.user_type, 1
        FROM groups_list AS T1gl
      RIGHT JOIN groups AS T1g ON (T1gl.group_id = T1g.id)
      WHERE T1g.parent IS NULL AND T1gl.user_id = 1
        UNION
      SELECT T2g.id, T2g.parent, CAST (recursive_tree.PATH ||'->'|| T2g.id AS VARCHAR(50)), T2gl.user_type, recursive_tree.level + 1
        FROM groups_list AS T2gl
      RIGHT JOIN groups AS T2g ON (T2gl.group_id = T2g.id)
      INNER JOIN recursive_tree ON (recursive_tree.id = T2g.parent)
    ) SELECT recursive_tree.id, recursive_tree.parent, grp.name, grp.group_type, grp.owner,
        grp.creating, grp.reading, grp.updating, grp.deleting,
        grp.el_reading, grp.el_creating, grp.el_updating, grp.el_deleting,
        gl.user_id, recursive_tree.user_type, gl.p, gl.q, grp.depth, recursive_tree.level
    FROM recursive_tree
    LEFT JOIN groups AS grp ON recursive_tree.id = grp.id
    LEFT JOIN groups_list AS gl ON (recursive_tree.id = gl.group_id) AND (gl.user_id = 1)
    ORDER BY (gl.p::float8/gl.q);

/****************
SELECT user_id, group_id, owner, user_type, name, parent, creating, reading, updating, deleting, el_creating, el_reading, el_updating, el_deleting, group_type FROM groups_list AS gl
	RIGHT JOIN groups AS grp ON gl.group_id = grp.id
*/

/****************
SELECT * FROM groups_list, groups WHERE
		(groups_list.group_id = groups.id)
	AND (groups_list.user_id = 3)
	AND (groups_list.user_type >= groups.reading);
*/

/* AND grp.reading >= gl.user_type ограничение видимости группы по типу пользователя
 user_type: 1-owner, 2-curator, 3-member, 4-all (все группы с таким типом имеют id = 0)
 reading->enum_reading: 0-not readable, 1-owner reading, 2-curator reading, 3-member reading, 4-reading by all
CREATE VIEW main_visible_groups AS
SELECT group_id, user_type, name, parent, creating, reading, updating, deleting, el_creating, el_reading, el_updating, el_deleting, group_type, owner FROM groups_list AS gl
	RIGHT JOIN groups AS grp ON gl.group_id = grp.id
	WHERE grp.reading >= gl.user_type AND (gl.user_id = 0 OR gl.user_id = 1);
*/

/* Test: data manipulations for UPDATE task_fields
select * from groups_list;
DELETE FROM groups_list WHERE (group_id = 1) AND (user_id = 1);
INSERT INTO groups_list (group_id, user_id, user_type) VALUES (1,1,1);
*/

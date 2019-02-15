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
	user_type smallint DEFAULT 1
);

/* Select user groups
SELECT * FROM groups_list, groups 
WHERE (groups_list.group_id = groups.id) 
	AND (groups_list.user_id = 3) 
	AND (groups_list.user_type >= groups.reading);
*/

/* Запрос всей иерархии группы
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
*/

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

/* Main groups tree
WITH RECURSIVE recursive_tree (id, parent, path, user_type, level) AS (
	SELECT T1g.id, T1g.parent, CAST (T1g.id AS VARCHAR (50)) AS path, T1gl.user_type, 1
    FROM groups_list AS T1gl
	RIGHT JOIN groups AS T1g ON (T1gl.group_id = T1g.id)
	WHERE T1g.parent IS NULL AND T1gl.user_id = 1
		UNION
	SELECT T2g.id, T2g.parent, CAST (recursive_tree.PATH ||'->'|| T2g.id AS VARCHAR(50)), T2gl.user_type, level + 1
    FROM groups_list AS T2gl
	RIGHT JOIN groups AS T2g ON (T2gl.group_id = T2g.id)
	INNER JOIN recursive_tree ON (recursive_tree.id = T2g.parent)
) select * from recursive_tree
SELECT recursive_tree.id, recursive_tree.user_type, grp.name, recursive_tree.parent, recursive_tree.level, recursive_tree.path,
	   grp.creating, grp.reading, grp.updating, grp.deleting, grp.el_creating,
	   grp.el_reading, grp.el_updating, grp.el_deleting, grp.group_type FROM recursive_tree
LEFT JOIN groups AS grp ON recursive_tree.id = grp.id
ORDER BY path;
*/

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

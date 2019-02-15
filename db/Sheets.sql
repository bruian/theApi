/* Create table - Sheets
 	type_el: (aka widget max 16 widgets 2^15)
		1  - divider		0000001
		2  - activity		0000010
		4  - task				0000100
		8  - groups			0001000
		16 - users			0010000
		32 - post-notes	0100000
		64 - images			1000000
*/
CREATE TABLE IF NOT EXISTS sheets (
	id 					char(8) PRIMARY KEY,
	type_el			integer,
	user_id			integer,
	owner_id		integer,
	name				varchar(300),
	visible			boolean DEFAULT true,
	layout			smallint,
	defaults		boolean DEFAULT false
	CONSTRAINT sheets_pkey UNIQUE(id)
);
--ALTER TABLE sheets ADD COLUMN defaults boolean DEFAULT false;
/* We name the trigger "trigger_sheets_genid" so that we can remove or replace it later.
	If an INSERT contains multiple RECORDs, each one will call unique_short_id individually. */
CREATE TRIGGER trigger_sheets_genid BEFORE INSERT ON sheets FOR EACH ROW EXECUTE PROCEDURE unique_short_id();

/* Create table sheets_conditions
	condition:
		1 - group_id
		2 - user_id
		3 - parent_id
		4 - task_id
		... others
*/
CREATE TABLE IF NOT EXISTS sheets_conditions (
	sheet_id	char(8) REFERENCES sheets ON DELETE cascade,
	condition smallint,
	value 		varchar(10),
	PRIMARY KEY (sheet_id, condition)
)

INSERT INTO sheets (type_el, user_id, owner_id, name, visible, layout)
	VALUES (4, 1, 1, 'My personal tasks', true, 2)
	RETURNING *;

INSERT INTO sheets_conditions (sheet_id, condition, value)
	VALUES ('ZZg02kCG', 1, '1'), ('ZZg02kCG', 2, ''), ('ZZg02kCG', 3, '')
	RETURNING *;

SELECT *,
	(SELECT ARRAY(
		SELECT condition::integer
		FROM sheets_conditions
		WHERE sheet_id=sh.id
	)) AS conditions,
	(SELECT ARRAY(
		SELECT value::TEXT
		FROM sheets_conditions
		WHERE sheet_id=sh.id
	)) AS values
FROM sheets AS sh WHERE user_id = 1

SELECT * FROM sheets;
SELECT * FROM sheets_conditions;

DELETE FROM sheets WHERE defaults = false;

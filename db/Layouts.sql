/* Create table - Layouts
 	type_el: (aka widget max 16 widgets 2^15)
		1  - divider		0000001
		2  - activity		0000010
		4  - task				0000100
		8  - groups			0001000
		16 - users			0010000
		32 - post-notes	0100000
		64 - images			1000000
*/
CREATE TABLE IF NOT EXISTS layouts (
	id 				numeric,
	user_id		char(8),
	sheet_id	varchar(20),
	type_el		integer,
	layout		smallint,
	PRIMARY KEY (id, user_id)
);

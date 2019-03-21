/* Create table - Layouts
 	type_el: (aka widget max 16 widgets 2^15)
		1  - divider		0000001
		2  - activity		0000010
		4  - task				0000100
		8  - groups			0001000
		16 - users			0010000
		32 - post-notes	0100000
		64 - images			1000000
	type_layout: 
		1 - manage-sheet,
		2 - property-sheet
		3 - list-sheet
*/
CREATE TABLE IF NOT EXISTS layouts (
	id 				numeric,
	user_id		char(8),
	sheet_id	char(8),
	element_id char(8),
	type_layout integer,
	type_el		integer,
	position	smallint,
	PRIMARY KEY (id, user_id)
);

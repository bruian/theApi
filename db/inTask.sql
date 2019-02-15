/* Create enumeration tables with set initial values
CREATE TABLE enum_creating(id smallint, name varchar(25));
INSERT INTO  enum_creating(id, name) VALUES (0, 'not created'), (1, 'creation by owner'), (2, 'creation by curator'), (3, 'creation by member'), (4, 'creation by all');
CREATE TABLE enum_reading(id smallint, name varchar(25));
INSERT INTO  enum_reading(id, name) VALUES (0, 'not readable'), (1, 'owner reading'), (2, 'curator reading'), (3, 'members reading'), (4, 'reading by all');
CREATE TABLE enum_updating(id smallint, name varchar(25));
INSERT INTO  enum_updating(id, name) VALUES (0, 'not updated'), (1, 'updated by the owner'), (2, 'updated by the curator'), (3, 'updated by the member'), (4, 'updated by all');
CREATE TABLE enum_deleting(id smallint, name varchar(25));
INSERT INTO  enum_deleting(id, name) VALUES (0, 'not deleted'), (1, 'deleting by owner'), (2, 'deleting by curator'), (3, 'deleting by member'), (4, 'deleting by all');
*/
/* Create group type table
CREATE TABLE group_type (id serial, name varchar(20));
INSERT INTO group_type (name) VALUES ('primary'), ('secondary'), ('shared');
*/
/* Create user type table
CREATE TABLE user_type (id serial, name varchar(15));
INSERT INTO user_type (name) VALUES ('owner'), ('curator'), ('member')
*/

/* Create users personality datas
CREATE TABLE users_personality (user_id int, name varchar(150), dateofbirth date, city varchar(150), country varchar(150), phone varchar(40))
*/
/* Create users photo table
CREATE TABLE users_photo (photo_id serial, user_id int, isavatar bool);
*/
/* Create users list
CREATE TABLE users_list (user_id int, friend_id int, visble smallint);
*/

/* Запрос полной информаци по пользователю id = 1, относительно пользователя user_id = 2
   Request complete information on user id = 1, relative to user id = 2
WITH users_table AS (
SELECT id, username, name, email, verified, loged, dateofbirth, city, country, gender, phone, url as avatar, 0 as friend FROM users AS usr
	RIGHT JOIN users_personality AS usr_p ON usr.id = usr_p.user_id
	RIGHT JOIN users_photo AS usr_ph ON usr.id = usr_ph.user_id AND usr_ph.isAvatar = true
	WHERE usr.visible = 2 --AND usr.id = 39
UNION
SELECT id, username, name, email, verified, loged, dateofbirth, city, country, gender, phone, url as avatar, 1 as friend FROM users_list AS ul
	RIGHT JOIN users AS usr ON ul.friend_id = usr.id AND usr.visible > 0
	RIGHT JOIN users_personality AS usr_p ON ul.friend_id = usr_p.user_id
	RIGHT JOIN users_photo AS usr_ph ON ul.friend_id = usr_ph.user_id AND usr_ph.isAvatar = true
	WHERE ul.visible > 0 AND ul.user_id = 1 --AND ul.friend_id = 39

)
SELECT id, username, name, email, verified, loged, dateofbirth, city, country, gender, phone, avatar, sum(friend) FROM users_table
GROUP BY id, username, name, email, verified, loged, dateofbirth, city, country, gender, phone, avatar
LIMIT 5 OFFSET 0;
*/

/**************** Выборка друзей моего друга
WITH main_ul AS (
	SELECT * FROM users_list AS ul
	WHERE ul.user_id = 1 AND ul.friend_id = 2 AND ul.visible = 2
)
SELECT id, username, name, email, verified, loged, dateofbirth, city, country, gender, phone, url as avatar FROM users_list AS ul
	RIGHT JOIN users AS usr ON ul.friend_id = usr.id AND usr.visible = 1
	RIGHT JOIN users_personality AS usr_p ON ul.friend_id = usr_p.user_id
	RIGHT JOIN users_photo AS usr_ph ON ul.friend_id = usr_ph.user_id AND usr_ph.isAvatar = true
	WHERE ul.visible > 0 AND ul.user_id = 2 AND (SELECT COUNT(user_id) FROM main_ul) > 0;
*/

--INSERT INTO users_list (user_id, friend_id, visible) VALUES (2, 4, 2)
--UPDATE users SET visible = 1 WHERE id = 1
--CREATE TABLE refresh_tokens (value varchar(1024), user_id int, client_id int, scope varchar(10), expiration timestamp)

/****************
INSERT INTO users_personality (user_id, name, dateofbirth, city, country, phone)
	VALUES (1, 'Dergach Виктор', '1984-03-29', 'Krasnoyarsk', 'Russia', '+7 (905) 976-54-53');

INSERT INTO users_photo (user_id, isavatar, url)
	VALUES (1, true, 'https://s3.amazonaws.com/uifaces/faces/twitter/fabbianz/128.jpg');
*/

/****************
DELETE FROM clients;
DELETE FROM users;
DELETE FROM groups;
DELETE FROM groups_list;
SELECT * FROM users;
SELECT * FROM clients;
SELECT * FROM groups;
SELECT * FROM groups_list order by group_id;
SELECT * FROM users_list;
SELECT * FROM users_personality;
SELECT * FROM users_photo ORDER BY user_id;
*/

--UPDATE users_photo SET user_id = 2 WHERE photo_id = 2;


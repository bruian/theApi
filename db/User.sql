	SELECT id, username, name, email, verified, loged, dateofbirth, city, country, gender, phone,
		url as avatar FROM users AS mainUser
	LEFT JOIN users_personality AS usr_p ON mainUser.id = usr_p.user_id
	LEFT JOIN users_photo AS usr_ph ON mainUser.id = usr_ph.user_id AND usr_ph.isAvatar = true
	WHERE mainUser.id = 1;

	SELECT mainUser.id, mainUser.username, usr_p.* FROM users AS mainUser
	JOIN users_personality AS usr_p ON mainUser.id = usr_p.user_id
	WHERE id=1;

	DELETE FROM users_photo WHERE user_id = 1;
	INSERT INTO users_photo VALUES(1, 1, true, 'https://s3.amazonaws.com/uifaces/faces/twitter/fabbianz/128.jpg');
	SELECT * FROM users_photo;

WITH users_table AS (
			SELECT id, username, name, email, verified, loged, dateofbirth, city, country, gender, phone, url as avatar, 0 as friend FROM users AS usr
				RIGHT JOIN users_personality AS usr_p ON usr.id = usr_p.user_id
				RIGHT JOIN users_photo AS usr_ph ON usr.id = usr_ph.user_id AND usr_ph.isAvatar = true
				WHERE usr.visible = 2
			UNION
			SELECT id, username, name, email, verified, loged, dateofbirth, city, country, gender, phone, url as avatar, 1 as friend FROM users_list AS ul
				RIGHT JOIN users AS usr ON ul.friend_id = usr.id AND usr.visible > 0
				RIGHT JOIN users_personality AS usr_p ON ul.friend_id = usr_p.user_id
				RIGHT JOIN users_photo AS usr_ph ON ul.friend_id = usr_ph.user_id AND usr_ph.isAvatar = true
				WHERE ul.visible > 0)
			SELECT id, username, name, email, verified, loged, dateofbirth, city, country, gender, phone, avatar, sum(friend) as friend FROM users_table
			GROUP BY id, username, name, email, verified, loged, dateofbirth, city, country, gender, phone, avatar
			LIMIT 10 OFFSET 0;

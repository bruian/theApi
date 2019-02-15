CREATE EXTENSION IF NOT EXISTS "pgcrypto";

/* Create a trigger function that takes no arguments.
  Trigger functions automatically have OLD, NEW records
	and TG_TABLE_NAME as well as others */
CREATE OR REPLACE FUNCTION unique_short_id()
RETURNS TRIGGER AS $$
DECLARE
	key TEXT;
	qry TEXT;
	found TEXT;
BEGIN
	/* Generate the first part of a query as a string with safely
		escaped table name, using || to concat the parts
		quote_ident() - for proper formatting of identifiers
		TG_TABLE_NAME - the name of the table in which the trigger is started */
	qry := 'SELECT id FROM ' || quote_ident(TG_TABLE_NAME) || ' WHERE id=';

	/* This loop will probably only run once per call untill we've
		generated millions of ids */
	LOOP
		/* Generate our string bytes and re-encode as a base64 string */
		key := encode(gen_random_bytes(6), 'base64');

		/* Base64 encoding contains 2 URL unsafe characters by default
			The url-safe version has these replacements */
		key := replace(key, '/', '_');
		key := replace(key, '+', '-');

		/* Concat the generated key (safely quoted) with the generated query and run it
			SELECT id FROM "test" WHERE id='venividivici' INTO found
			Now found will be the duplicated id or NULL */
		EXECUTE qry || quote_literal(key) INTO found;

		/* Check to see if found is NULL. If we checked to see if found = NULL it would
			always be FALSE because (NULL = NULL) is always FALSE */
		IF found IS NULL THEN
			/* If we didn't find a collision then leave the LOOP */
			EXIT;
		END IF;

		/* We haven't EXITed yet, so return to the top of the LOOP and try again. */
	END LOOP;

	/* NEW and OLD are available in TRIGGER PROCEDURES.
		NEW is the mutated row that will actually be INSERTed.
		We're replacing id, regardless of what it was before with our key variable */
	NEW.id = key;

	/* The RECORD returned here is what will actually be INSERTed,
		or what the next trigger will get if there is one */
	RETURN NEW;
END;
$$ language 'plpgsql';

/*
-- find an intermediate fraction between p1/q1 and p2/q2.
--
-- The fraction chosen is the highest fraction in the Stern-Brocot
-- tree which falls strictly between the specified values. This is
-- intended to avoid going deeper in the tree unnecessarily when the
-- list is already sparse due to deletion or moving of items, but in
-- fact the case when the two items are already adjacent in the tree
-- is common so we shortcut it. As a bonus, this method always
-- generates fractions in lowest terms, so there is no need for GCD
-- calculations anywhere.
--
-- Inputs must not be null (caller's responsibility), but the value
-- p2=1 q2=0 is allowed for the upper bound without causing any
-- division by zero errors.
*/
CREATE OR REPLACE FUNCTION find_intermediate(p1 INTEGER, q1 INTEGER,
                                             p2 INTEGER, q2 INTEGER,
                                             OUT p INTEGER, OUT q INTEGER)
  LANGUAGE plpgsql immutable strict
AS $f$
  DECLARE
    pl INTEGER := 0;
    ql INTEGER := 1;
    ph INTEGER := 1;
    qh INTEGER := 0;
  BEGIN
    IF (p1::BIGINT*q2 + 1) <> (p2::BIGINT*q1) THEN
      loop
        p := pl + ph;
        q := ql + qh;
        IF (p::BIGINT*q1 <= q::BIGINT*p1) THEN
          pl := p; ql := q;
        elsif (p2::BIGINT*q <= q2::BIGINT*p) THEN
          ph := p; qh := q;
        ELSE
          exit;
        END IF;
      END loop;
    ELSE
      p := p1 + p2;
      q := q1 + q2;
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
CREATE OR REPLACE FUNCTION grp_renormalize(grp_id char(8))
  RETURNS void
  LANGUAGE plpgsql
  volatile strict
AS $f$
  BEGIN
    perform 1 FROM groups g WHERE g.id=grp_id FOR UPDATE;

    UPDATE tasks_list tl SET p=s2.new_rnum, q=2
      FROM (SELECT task_id,
                   is_existing = 0 AS is_new,
                   -- increase the current value according to the
                   -- number of adjustment points passed
                   rnum + 2*(SUM(is_existing) OVER (ORDER BY rnum)) AS new_rnum
              FROM (
                    -- assign the initial simple values to every item
		    -- in order
                    SELECT task_id,
                           2*(ROW_NUMBER() OVER (ORDER BY p::float8/q)) - 1
                             AS rnum,
                           0 AS is_existing
                      FROM tasks_list tl2
                     WHERE tl2.group_id=grp_id
                    UNION ALL
                    -- and merge in the adjustment points required to
                    -- skip over existing x/2 values
                    SELECT task_id,
                           p + 2 - 2*(COUNT(*) OVER (ORDER BY p))
                             AS rnum,
                           1 AS is_existing
                      FROM tasks_list tl3
                     WHERE tl3.group_id=grp_id
                       AND tl3.q=2
                   ) s1
           ) s2
     WHERE s2.task_id=tl.task_id
       AND s2.is_new
       AND tl.group_id=grp_id;
  END;
$f$;

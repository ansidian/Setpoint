-- Align standalone FTS rowids with ea_email_index rowids so point updates can
-- replace search rows by rowid instead of scanning the FTS table by uid.
DELETE FROM ea_email_fts;

INSERT INTO ea_email_fts (rowid, uid, from_name, from_address, subject, body_snippet, body_text)
SELECT rowid, uid, from_name, from_address, subject, body_snippet, body_text
FROM ea_email_index;

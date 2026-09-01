-- Canonicalize the pre-deployment Bill Pay settings schema. Runtime parsing accepts v2 only.
UPDATE ea_settings
SET bill_pay_mappings_json = CASE
  WHEN json_valid(bill_pay_mappings_json)
    AND json_type(bill_pay_mappings_json) = 'object'
    AND json_extract(bill_pay_mappings_json, '$.version') IN (1, 2)
    AND json_type(bill_pay_mappings_json, '$.profiles') = 'array'
    THEN (
      SELECT json_object(
        'version', 2,
        'profiles', json(COALESCE(json_group_array(json(profile_json)), '[]'))
      )
      FROM (
        SELECT json_object(
          'id', json_extract(profile.value, '$.id'),
          'name', json_extract(profile.value, '$.name'),
          'enabled', json(CASE json_type(profile.value, '$.enabled')
            WHEN 'true' THEN 'true'
            WHEN 'false' THEN 'false'
            ELSE 'null'
          END),
          'identity', json(CASE
            WHEN json_type(profile.value, '$.identity') = 'object'
              THEN json_extract(profile.value, '$.identity')
            ELSE '{}'
          END),
          'behaviors', json(COALESCE((
            SELECT json_group_array(json(behavior_json))
            FROM (
              SELECT json_object(
                'id', json_extract(behavior.value, '$.id'),
                'name', json_extract(behavior.value, '$.name'),
                'enabled', json(CASE json_type(behavior.value, '$.enabled')
                  WHEN 'true' THEN 'true'
                  WHEN 'false' THEN 'false'
                  ELSE 'null'
                END),
                'type', json_extract(behavior.value, '$.type'),
                'targets', json(CASE
                  WHEN json_type(behavior.value, '$.targets') = 'object'
                    THEN json_extract(behavior.value, '$.targets')
                  ELSE '{}'
                END)
              ) AS behavior_json
              FROM json_each(profile.value, '$.behaviors') AS behavior
              WHERE json_type(behavior.value) = 'object'
              ORDER BY CAST(behavior.key AS INTEGER)
            )
          ), '[]'))
        ) AS profile_json
        FROM json_each(bill_pay_mappings_json, '$.profiles') AS profile
        WHERE json_type(profile.value) = 'object'
        ORDER BY CAST(profile.key AS INTEGER)
      )
    )
  ELSE json_object('version', 2, 'profiles', json('[]'))
END
WHERE bill_pay_mappings_json IS NOT NULL;

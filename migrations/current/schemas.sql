
-- Get all table schemas with columns and their details
-- FILTER BY SPECIFIC TABLES: Add this line before running:
-- WHERE t.table_name IN ('startups', 'startup_integrations', 'startup_metrics')
  SELECT
      t.table_schema,
      t.table_name,
      json_agg(
          json_build_object(
              'column_name', c.column_name,
              'data_type', c.data_type,
              'is_nullable', c.is_nullable,
              'column_default', c.column_default,
              'character_maximum_length', c.character_maximum_length
          ) ORDER BY c.ordinal_position
      ) AS columns
  FROM information_schema.tables t
  LEFT JOIN information_schema.columns c
      ON t.table_schema = c.table_schema
      AND t.table_name = c.table_name
  WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema')
      AND t.table_type = 'BASE TABLE'
      -- UNCOMMENT AND MODIFY THIS LINE TO FILTER SPECIFIC TABLES:
      -- AND t.table_name IN ('startups', 'startup_integrations', 'startup_metrics')
  GROUP BY t.table_schema, t.table_name
  ORDER BY t.table_schema, t.table_name;

-- One PostgreSQL server for the local test environment, with separate
-- databases and users so Studio never shares a schema with BaSyx.
-- Test-only credentials; never reuse them outside this compose setup.

CREATE ROLE studio LOGIN PASSWORD 'studio';
CREATE DATABASE studio OWNER studio;

CREATE ROLE basyx LOGIN PASSWORD 'basyx';
CREATE DATABASE basyx_open OWNER basyx;
CREATE DATABASE basyx_secured OWNER basyx;

-- BaSyx Go's schema needs these extensions; create them as superuser.
\connect basyx_open
CREATE EXTENSION IF NOT EXISTS ltree;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

\connect basyx_secured
CREATE EXTENSION IF NOT EXISTS ltree;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

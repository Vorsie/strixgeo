-- Dry run for migration a4b5c6d7e8f9 (geo-label twin merge, debt #278 R3).
--
-- READ-ONLY preview of what the migration WOULD do to the CURRENT dev DB.
-- It writes nothing (a READ ONLY transaction it always rolls back), so it is
-- safe to run against the live dev database. This is the artifact to review
-- BEFORE approving the destructive migration run.
--
-- Run it against the dev DB (from the repo root):
--
--   docker exec -i strix-db-1 psql -U groundmodel -d groundmodel \
--     < scripts/dry_run_twins_migration.sql
--
-- or, in PowerShell:
--
--   Get-Content scripts/dry_run_twins_migration.sql | `
--     docker exec -i strix-db-1 psql -U groundmodel -d groundmodel
--
-- A "geo-label twin" group is the set of geotech-minted formations
-- (source_litho_formation_id IS NOT NULL) sharing a project + NAD class + litho
-- parent. The single window PARTITION BY (app_project_id, nad_class,
-- source_litho_formation_id) is the migration's exact grouping key: classified
-- rows (nad_class set) group by class, skeleton rows (nad_class NULL) group by
-- litho parent alone (SQL partitions all NULLs together). The predicted
-- survivor is the oldest created_at (tie-break lowest id).

BEGIN;
SET TRANSACTION READ ONLY;

\echo '=== 1. Twin groups: members, created_at, and the predicted survivor ==='
WITH tw AS (
    SELECT gf.id,
           gf.app_project_id,
           gf.nad_class,
           gf.source_litho_formation_id,
           gf.name,
           gf.created_at,
           -- group_size is a PARTITION total (no ORDER BY) — an ordered window
           -- would make count(*) a running total and drop the survivor row.
           count(*) OVER (
               PARTITION BY gf.app_project_id, gf.nad_class, gf.source_litho_formation_id
           ) AS group_size,
           first_value(gf.id) OVER (
               PARTITION BY gf.app_project_id, gf.nad_class, gf.source_litho_formation_id
               ORDER BY gf.created_at ASC, gf.id ASC
           ) AS survivor_id
    FROM geological_formation gf
    WHERE gf.source_litho_formation_id IS NOT NULL
)
SELECT app_project_id,
       nad_class,
       source_litho_formation_id AS litho_parent,
       id AS member_id,
       name,
       created_at,
       (id = survivor_id) AS is_survivor
FROM tw
WHERE group_size > 1
ORDER BY app_project_id, nad_class NULLS FIRST, source_litho_formation_id, created_at, id;

\echo '=== 2. Group summary (classified vs skeleton, total losers) ==='
WITH grp AS (
    SELECT app_project_id, nad_class, source_litho_formation_id, count(*) AS n
    FROM geological_formation
    WHERE source_litho_formation_id IS NOT NULL
    GROUP BY app_project_id, nad_class, source_litho_formation_id
    HAVING count(*) > 1
)
SELECT count(*) AS twin_groups,
       count(*) FILTER (WHERE nad_class IS NOT NULL) AS classified_groups,
       count(*) FILTER (WHERE nad_class IS NULL) AS skeleton_groups,
       coalesce(sum(n - 1), 0) AS total_losers
FROM grp;

\echo '=== 3. Formation-row count: before -> after ==='
WITH tw AS (
    SELECT gf.id,
           first_value(gf.id) OVER (
               PARTITION BY gf.app_project_id, gf.nad_class, gf.source_litho_formation_id
               ORDER BY gf.created_at ASC, gf.id ASC
           ) AS survivor_id
    FROM geological_formation gf
    WHERE gf.source_litho_formation_id IS NOT NULL
)
SELECT (SELECT count(*) FROM geological_formation) AS formations_before,
       (SELECT count(*) FROM tw WHERE id <> survivor_id) AS losers_deleted,
       (SELECT count(*) FROM geological_formation)
       - (SELECT count(*) FROM tw WHERE id <> survivor_id) AS formations_after;

\echo '=== 4. Body-ordinal collisions the renumber will resolve ==='
-- After re-pointing every affected body to its survivor, count how many bodies
-- would share a (model, survivor_formation, body_ordinal) with another — those
-- are the ones the two-step renumber re-ranks. Zero here means the renumber is
-- a no-op; non-zero is the collision count the migration must dodge.
WITH tw AS (
    SELECT gf.id AS loser_id,
           first_value(gf.id) OVER (
               PARTITION BY gf.app_project_id, gf.nad_class, gf.source_litho_formation_id
               ORDER BY gf.created_at ASC, gf.id ASC
           ) AS survivor_id
    FROM geological_formation gf
    WHERE gf.source_litho_formation_id IS NOT NULL
),
merged AS (SELECT DISTINCT survivor_id FROM tw WHERE loser_id <> survivor_id),
per_survivor AS (
    SELECT b.model_id,
           m.survivor_id,
           count(*) AS bodies,
           count(DISTINCT b.body_ordinal) AS distinct_ordinals
    FROM body b
    JOIN tw m ON m.loser_id = b.formation_id
    JOIN merged mm ON mm.survivor_id = m.survivor_id
    GROUP BY b.model_id, m.survivor_id
)
SELECT count(*) AS survivor_formations_with_bodies,
       coalesce(sum(bodies), 0) AS total_bodies_under_survivors,
       coalesce(sum(bodies - distinct_ordinals), 0) AS ordinal_collisions_to_renumber
FROM per_survivor;

\echo '=== 5. Loser child-row counts that will re-point onto the survivor ==='
-- Every CASCADE child of a loser formation is re-pointed before the loser is
-- deleted (nothing is cascade-destroyed). This shows how much data moves.
WITH tw AS (
    SELECT gf.id AS loser_id,
           first_value(gf.id) OVER (
               PARTITION BY gf.app_project_id, gf.nad_class, gf.source_litho_formation_id
               ORDER BY gf.created_at ASC, gf.id ASC
           ) AS survivor_id
    FROM geological_formation gf
    WHERE gf.source_litho_formation_id IS NOT NULL
),
losers AS (SELECT loser_id FROM tw WHERE loser_id <> survivor_id)
SELECT (SELECT count(*) FROM litho_layer WHERE formation_id IN (SELECT loser_id FROM losers))
           AS litho_layers,
       (SELECT count(*) FROM formation_contact WHERE formation_id IN (SELECT loser_id FROM losers))
           AS formation_contacts,
       (SELECT count(*) FROM body WHERE formation_id IN (SELECT loser_id FROM losers))
           AS bodies,
       (SELECT count(*) FROM formation_absence WHERE formation_id IN (SELECT loser_id FROM losers))
           AS formation_absences,
       (SELECT count(*) FROM formation_surface WHERE formation_id IN (SELECT loser_id FROM losers))
           AS formation_surfaces,
       (SELECT count(*) FROM litho_body_solid WHERE formation_id IN (SELECT loser_id FROM losers))
           AS litho_body_solids;

ROLLBACK;

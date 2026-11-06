"""Every SQL statement the listings store runs, in one place. All values are bound parameters."""

from __future__ import annotations

SCHEMA_VERSION = "2"

SCHEMA = (
    """
    CREATE TABLE IF NOT EXISTS places (
        place_id         VARCHAR NOT NULL,
        name             VARCHAR NOT NULL,
        name_norm        VARCHAR NOT NULL,
        category         VARCHAR,
        basic_category   VARCHAR,
        hierarchy        VARCHAR[],
        confidence       DOUBLE,
        operating_status VARCHAR,
        websites         VARCHAR[],
        emails           VARCHAR[],
        phones           VARCHAR[],
        socials          VARCHAR[],
        street           VARCHAR,
        locality         VARCHAR,
        region           VARCHAR,
        postcode         VARCHAR,
        country          VARCHAR,
        lat              DOUBLE NOT NULL,
        lon              DOUBLE NOT NULL,
        brand            VARCHAR,
        brand_wikidata   VARCHAR,
        brand_norm       VARCHAR,
        chain_count      INTEGER NOT NULL DEFAULT 1,
        excluded         BOOLEAN,
        source_dataset   VARCHAR,
        source_updated   VARCHAR,
        release          VARCHAR NOT NULL,
        loaded_at        TIMESTAMP NOT NULL
    )
    """,
    # Match keys computed in Python once per place (keys.place_keys): duplicate keys of its
    # websites, the forms a do-not-contact domain is compared with, and phone digits.
    "ALTER TABLE places ADD COLUMN IF NOT EXISTS site_keys VARCHAR[]",
    "ALTER TABLE places ADD COLUMN IF NOT EXISTS web_keys VARCHAR[]",
    "ALTER TABLE places ADD COLUMN IF NOT EXISTS phone_keys VARCHAR[]",
    "ALTER TABLE places ADD COLUMN IF NOT EXISTS cat_path VARCHAR",
    # An early build created this index; DuckDB never used it for lookups, and while it exists
    # updates of list columns crawl, so it is removed.
    "DROP INDEX IF EXISTS places_place_id_idx",
    """
    CREATE TABLE IF NOT EXISTS areas (
        name      VARCHAR NOT NULL,
        xmin      DOUBLE NOT NULL,
        ymin      DOUBLE NOT NULL,
        xmax      DOUBLE NOT NULL,
        ymax      DOUBLE NOT NULL,
        release   VARCHAR NOT NULL,
        loaded_at TIMESTAMP NOT NULL,
        row_count BIGINT NOT NULL
    )
    """,
    # Bounding boxes of every row group of a release's place files, so a load reads only the
    # files that overlap its area (Overture files are immutable once released).
    """
    CREATE TABLE IF NOT EXISTS overture_row_groups (
        release   VARCHAR NOT NULL,
        file      VARCHAR NOT NULL,
        row_group BIGINT NOT NULL,
        xmin      DOUBLE,
        xmax      DOUBLE,
        ymin      DOUBLE,
        ymax      DOUBLE,
        row_count BIGINT
    )
    """,
    "CREATE TABLE IF NOT EXISTS store_meta (key VARCHAR NOT NULL, value VARCHAR)",
    # Lowercase ASCII words: accents stripped, '&' -> 'and', apostrophes and periods dropped.
    r"""
    CREATE OR REPLACE MACRO nn_fold(s) AS
        trim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
            lower(strip_accents(coalesce(s, ''))),
            '[''\x{2019}`.]', '', 'g'),
            '&', ' and ', 'g'),
            '[^a-z0-9]+', ' ', 'g'),
            '\s+', ' ', 'g'))
    """,
    # Business name for chain counts and duplicate checks: location tails (" - Arlington",
    # " | Dentist") and legal words (LLC, Inc, The, Co) removed.
    r"""
    CREATE OR REPLACE MACRO nn_norm_name(s) AS
        coalesce(nullif(trim(regexp_replace(regexp_replace(
            nn_fold(regexp_replace(coalesce(s, ''), '\s+[-|:@\x{2013}\x{2014}]\s+.*$', '')),
            '\b(the|llc|inc|incorporated|pllc|pc|ltd|corp|corporation|co|company)\b', ' ', 'g'),
            '\s+', ' ', 'g')), ''), nn_fold(s))
    """,
    """
    CREATE OR REPLACE MACRO nn_haversine_mi(lat1, lon1, lat2, lon2) AS
        2 * 3958.7613 * asin(least(1.0, sqrt(
            pow(sin(radians(lat2 - lat1) / 2), 2)
            + cos(radians(lat1)) * cos(radians(lat2)) * pow(sin(radians(lon2 - lon1) / 2), 2))))
    """,
    """
    CREATE OR REPLACE MACRO nn_category_key(c, b, h) AS
        concat_ws('|', coalesce(c, ''), coalesce(b, ''),
                  array_to_string(coalesce(h, []::VARCHAR[]), '>'))
    """,
    # '>general_dentistry>dental_clinic>health_care>...>': every key a category search matches.
    """
    CREATE OR REPLACE MACRO nn_cat_path(c, b, h) AS
        '>' || concat_ws('>', coalesce(c, ''), coalesce(b, ''),
                         array_to_string(coalesce(h, []::VARCHAR[]), '>')) || '>'
    """,
    "UPDATE places SET cat_path = nn_cat_path(category, basic_category, hierarchy) WHERE cat_path IS NULL",
)

GET_META = "SELECT value FROM store_meta WHERE key = ?"
DELETE_META = "DELETE FROM store_meta WHERE key = ?"
INSERT_META = "INSERT INTO store_meta (key, value) VALUES (?, ?)"

# Remote reads of the public Overture bucket (anonymous; no credentials involved).
LOAD_HTTPFS = "LOAD httpfs"
INSTALL_HTTPFS = "INSTALL httpfs"
REMOTE_SETTINGS = ("SET s3_region = 'us-west-2'", "SET enable_progress_bar = false")

BEGIN = "BEGIN TRANSACTION"
COMMIT = "COMMIT"
ROLLBACK = "ROLLBACK"
CHECKPOINT = "CHECKPOINT"

# ------------------------------------------------------------------ staging

# Columns shared by both ways of filling _staging (Overture files and insert_listings).
STAGING_COLUMNS = (
    "place_id", "name", "category", "basic_category", "hierarchy", "confidence",
    "operating_status", "websites", "emails", "phones", "socials", "street", "locality", "region",
    "postcode", "country", "lat", "lon", "brand", "brand_wikidata", "source_dataset",
    "source_updated", "release",
)

CREATE_EMPTY_STAGING = """
    CREATE OR REPLACE TEMP TABLE _staging (
        place_id VARCHAR, name VARCHAR, category VARCHAR, basic_category VARCHAR,
        hierarchy VARCHAR[], confidence DOUBLE, operating_status VARCHAR, websites VARCHAR[],
        emails VARCHAR[], phones VARCHAR[], socials VARCHAR[], street VARCHAR, locality VARCHAR,
        region VARCHAR, postcode VARCHAR, country VARCHAR, lat DOUBLE, lon DOUBLE, brand VARCHAR,
        brand_wikidata VARCHAR, source_dataset VARCHAR, source_updated VARCHAR, release VARCHAR
    )
"""

INSERT_STAGING_ROW = (
    "INSERT INTO _staging VALUES (" + ", ".join("?" for _ in STAGING_COLUMNS) + ")"
)

# Overture Places -> _staging for one bounding box. Parameters, in order: file list, xmin,
# xmax, ymin, ymax, release. The bbox comparisons let DuckDB skip row groups outside the area.
# sources[1] is the record's own source; later entries are per-property signals (confidence,
# operating status), so the first entry with an empty property is preferred.
STAGE_FROM_OVERTURE = r"""
    CREATE OR REPLACE TEMP TABLE _staging AS
    WITH raw AS (
        SELECT
            id AS place_id,
            trim(names."primary") AS name,
            taxonomy."primary" AS category,
            basic_category,
            taxonomy.hierarchy AS hierarchy,
            confidence,
            operating_status,
            list_filter(websites, lambda w: w IS NOT NULL AND trim(w) <> '') AS websites,
            list_filter(emails, lambda e: e IS NOT NULL AND trim(e) <> '') AS emails,
            list_filter(phones, lambda p: p IS NOT NULL AND trim(p) <> '') AS phones,
            list_filter(socials, lambda s: s IS NOT NULL AND trim(s) <> '') AS socials,
            addresses[1].freeform AS street,
            addresses[1].locality AS locality,
            addresses[1].region AS region,
            addresses[1].postcode AS postcode,
            addresses[1].country AS country,
            (bbox.ymin + bbox.ymax) / 2 AS lat,
            (bbox.xmin + bbox.xmax) / 2 AS lon,
            brand.names."primary" AS brand,
            brand.wikidata AS brand_wikidata,
            coalesce(list_filter(sources, lambda s: coalesce(s.property, '') = '')[1], sources[1])
                AS src
        FROM read_parquet(?, hive_partitioning = false)
        WHERE bbox.xmin >= ? AND bbox.xmax <= ? AND bbox.ymin >= ? AND bbox.ymax <= ?
          AND names."primary" IS NOT NULL AND trim(names."primary") <> ''
          AND coalesce(addresses[1].country, 'US') IN ('US', 'PR', 'VI', 'GU', 'AS', 'MP')
    )
    SELECT
        place_id, name, category, basic_category, hierarchy, confidence, operating_status,
        websites, emails, phones, socials, street, locality, region, postcode, country, lat, lon,
        brand, brand_wikidata,
        src.dataset AS source_dataset,
        CASE WHEN regexp_matches(coalesce(src.update_time, ''), '^\d{4}-\d{2}-\d{2}')
             THEN left(src.update_time, 10) END AS source_updated,
        ?::VARCHAR AS release
    FROM raw
"""

COUNT_STAGING = "SELECT count(*) FROM _staging"
DROP_STAGING = "DROP TABLE IF EXISTS _staging"

# Upsert by place_id (delete + insert keeps DuckDB free of index edge cases).
DELETE_STAGED_PLACES = "DELETE FROM places WHERE place_id IN (SELECT place_id FROM _staging)"

# Rows inside a reloaded box that the new release no longer has (closed, merged or removed).
# Parameters: ymin, ymax, xmin, xmax, release.
DELETE_STALE_IN_BOX = """
    DELETE FROM places
    WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?
      AND release <> ?
      AND place_id NOT IN (SELECT place_id FROM _staging)
"""

STAGED_CONTACTS = "SELECT place_id, websites, phones FROM _staging"
UNKEYED_CONTACTS = "SELECT place_id, websites, phones FROM places WHERE site_keys IS NULL"
# Parameters: place ids, dedupe keys, do-not-contact keys, phone keys (parallel lists).
CREATE_KEYS = """
    CREATE OR REPLACE TEMP TABLE _keys AS
    SELECT unnest(?::VARCHAR[]) AS place_id, unnest(?::VARCHAR[][]) AS site_keys,
           unnest(?::VARCHAR[][]) AS web_keys, unnest(?::VARCHAR[][]) AS phone_keys
"""
APPLY_KEYS = """
    UPDATE places
    SET site_keys = k.site_keys, web_keys = k.web_keys, phone_keys = k.phone_keys
    FROM _keys k WHERE places.place_id = k.place_id
"""
RESET_KEYS = "UPDATE places SET site_keys = NULL, web_keys = NULL, phone_keys = NULL"
DROP_KEYS = "DROP TABLE IF EXISTS _keys"

# Parameter: loaded_at. Sorted by latitude so DuckDB's zone maps prune the box prefilters.
INSERT_FROM_STAGING = """
    INSERT INTO places (
        place_id, name, name_norm, category, basic_category, hierarchy, confidence,
        operating_status, websites, emails, phones, socials, street, locality, region, postcode,
        country, lat, lon, brand, brand_wikidata, brand_norm, chain_count, excluded,
        source_dataset, source_updated, release, loaded_at, site_keys, web_keys, phone_keys,
        cat_path
    )
    SELECT
        s.place_id, s.name, nn_norm_name(s.name), s.category, s.basic_category,
        coalesce(s.hierarchy, []::VARCHAR[]), s.confidence, s.operating_status,
        coalesce(s.websites, []::VARCHAR[]), coalesce(s.emails, []::VARCHAR[]),
        coalesce(s.phones, []::VARCHAR[]), coalesce(s.socials, []::VARCHAR[]),
        s.street, s.locality, s.region, s.postcode, s.country, s.lat, s.lon,
        s.brand, s.brand_wikidata,
        CASE WHEN s.brand IS NULL OR trim(s.brand) = '' THEN NULL ELSE nn_norm_name(s.brand) END,
        1, NULL, s.source_dataset, s.source_updated, s.release, ?,
        k.site_keys, k.web_keys, k.phone_keys,
        nn_cat_path(s.category, s.basic_category, s.hierarchy)
    FROM (SELECT DISTINCT ON (place_id) * FROM _staging) s
    LEFT JOIN (
        SELECT place_id, any_value(site_keys) AS site_keys, any_value(web_keys) AS web_keys,
               any_value(phone_keys) AS phone_keys
        FROM _keys GROUP BY place_id
    ) k ON k.place_id = s.place_id
    ORDER BY s.lat, s.lon
"""

# ------------------------------------------------------------------ derived columns

# chain_count = places in the store sharing the normalized name, or the brand if larger. A name with no
# Latin letters or digits normalizes to '' and can't be compared, so it counts as its own place.
CHAIN_RULES = "2"  # bump when the chain count rules change, so stores recompute it when opened
COMPUTE_CHAIN_COUNTS = """
    CREATE OR REPLACE TEMP TABLE _chain AS
    SELECT place_id,
           greatest(
               CASE WHEN name_norm = '' THEN 1 ELSE count(*) OVER (PARTITION BY name_norm) END,
               CASE WHEN brand_norm IS NULL OR brand_norm = '' THEN 0
                    ELSE count(*) OVER (PARTITION BY brand_norm) END
           )::INTEGER AS n
    FROM places
"""
APPLY_CHAIN_COUNTS = """
    UPDATE places SET chain_count = _chain.n
    FROM _chain
    WHERE places.place_id = _chain.place_id AND places.chain_count <> _chain.n
"""
DROP_CHAIN = "DROP TABLE IF EXISTS _chain"

PENDING_CATEGORY_KEYS = """
    SELECT DISTINCT category, basic_category, hierarchy
    FROM places WHERE excluded IS NULL
"""
# Parameter: list of excluded nn_category_key values.
APPLY_EXCLUDED = """
    UPDATE places
    SET excluded = list_contains(?::VARCHAR[], nn_category_key(category, basic_category, hierarchy))
    WHERE excluded IS NULL
"""
RESET_EXCLUDED = "UPDATE places SET excluded = NULL"

# ------------------------------------------------------------------ areas

DELETE_AREA = "DELETE FROM areas WHERE name = ?"
INSERT_AREA = """
    INSERT INTO areas (name, xmin, ymin, xmax, ymax, release, loaded_at, row_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
"""
# Parameters: xmin, ymin, xmax, ymax of the search circle's box.
COVERS = """
    SELECT count(*) FROM areas
    WHERE xmin <= ? AND ymin <= ? AND xmax >= ? AND ymax >= ?
"""
LIST_AREAS = """
    SELECT name, xmin, ymin, xmax, ymax, release, loaded_at, row_count
    FROM areas ORDER BY loaded_at, name
"""
COUNT_PLACES = "SELECT count(*) FROM places"
NEWEST_PLACE_RELEASE = "SELECT max(release) FROM places"

# ------------------------------------------------------------------ Overture row groups

COUNT_ROW_GROUPS = "SELECT count(*) FROM overture_row_groups WHERE release = ?"
DELETE_ROW_GROUPS = "DELETE FROM overture_row_groups WHERE release = ?"
# Parameters: release, file list. Reads only the files' footers.
STAGE_ROW_GROUPS = """
    CREATE OR REPLACE TEMP TABLE _row_groups AS
    SELECT
        ?::VARCHAR AS release,
        file_name,
        row_group_id,
        min(CASE WHEN replace(path_in_schema, '.', ', ') = 'bbox, xmin'
                 THEN TRY_CAST(stats_min AS DOUBLE) END) AS xmin,
        max(CASE WHEN replace(path_in_schema, '.', ', ') = 'bbox, xmax'
                 THEN TRY_CAST(stats_max AS DOUBLE) END) AS xmax,
        min(CASE WHEN replace(path_in_schema, '.', ', ') = 'bbox, ymin'
                 THEN TRY_CAST(stats_min AS DOUBLE) END) AS ymin,
        max(CASE WHEN replace(path_in_schema, '.', ', ') = 'bbox, ymax'
                 THEN TRY_CAST(stats_max AS DOUBLE) END) AS ymax,
        any_value(row_group_num_rows) AS row_count
    FROM parquet_metadata(?)
    WHERE replace(path_in_schema, '.', ', ') IN ('bbox, xmin', 'bbox, xmax', 'bbox, ymin', 'bbox, ymax')
    GROUP BY file_name, row_group_id
"""
COUNT_STAGED_ROW_GROUPS = "SELECT count(*) FROM _row_groups"
SAVE_ROW_GROUPS = "INSERT INTO overture_row_groups SELECT * FROM _row_groups"
DROP_ROW_GROUPS = "DROP TABLE IF EXISTS _row_groups"
# Parameters: release, xmax, xmin, ymax, ymin of the area. Missing stats count as overlapping.
FILES_FOR_BOX = """
    SELECT file, count(*) AS row_groups, sum(row_count) AS rows_scanned
    FROM overture_row_groups
    WHERE release = ?
      AND coalesce(xmin <= ?, true) AND coalesce(xmax >= ?, true)
      AND coalesce(ymin <= ?, true) AND coalesce(ymax >= ?, true)
    GROUP BY file ORDER BY file
"""

# ------------------------------------------------------------------ reads

LISTING_COLUMNS = (
    "place_id", "name", "category", "basic_category", "hierarchy", "confidence",
    "operating_status", "websites", "emails", "phones", "socials", "street", "locality", "region",
    "postcode", "country", "lat", "lon", "brand", "brand_wikidata", "chain_count",
    "source_dataset", "source_updated", "release",
)
_SELECT_LISTING = ", ".join(LISTING_COLUMNS)

GET_PLACE = f"SELECT {_SELECT_LISTING} FROM places WHERE place_id = ? LIMIT 1"

_OPEN = "coalesce(operating_status, '') NOT IN ('closed', 'temporarily_closed', 'permanently_closed')"

# LD2 in one query, in the PRD's order:
#  1. category: the key is the place's taxonomy primary, its basic category or any element of
#     its hierarchy (cat_path is '>primary>basic>h1>h2>...>'; pattern is '>(key1|key2)>');
#  2. distance: box prefilter, then haversine <= radius;
#  3. open (or unknown) status; confidence >= 0.6 (unknown only with a website); not an
#     excluded category; not a chain (5+ places with the name or brand, or a Wikidata brand);
#  4. duplicates: rank everything by confidence (places the caller excludes by id or website
#     rank first, so their duplicates go too), then drop any place that shares a website key
#     with a better one; of the rest, any that shares phone digits with a better one; of the
#     rest, any within dup_mi of a better one with the same normalized name;
#  5. sort by has a website, confidence to two decimals, distance; limit.
# Named parameters: lat, lon, radius, xmin, ymin, xmax, ymax, pattern, min_confidence,
# chain_min, skip_ids, blocked, dup_mi, limit.
FIND_CANDIDATES = f"""
    WITH elig AS MATERIALIZED (
        SELECT {_SELECT_LISTING}, len(websites) > 0 AS has_site, distance_mi, name_norm,
               coalesce(site_keys, []::VARCHAR[]) AS site_keys,
               coalesce(phone_keys, []::VARCHAR[]) AS phone_keys,
               coalesce(place_id IN (SELECT unnest($skip_ids::VARCHAR[]))
                        OR list_has_any(coalesce(web_keys, []::VARCHAR[]), $blocked::VARCHAR[]),
                        false) AS blocked
        FROM (
            SELECT *, nn_haversine_mi($lat, $lon, lat, lon) AS distance_mi
            FROM places
            WHERE lat BETWEEN $ymin AND $ymax AND lon BETWEEN $xmin AND $xmax
              AND regexp_matches(cat_path, $pattern)
        ) AS nearby
        WHERE distance_mi <= $radius
          AND {_OPEN}
          AND (confidence >= $min_confidence OR (confidence IS NULL AND len(websites) > 0))
          AND NOT coalesce(excluded, false)
          AND chain_count < $chain_min
          AND brand_wikidata IS NULL
    ),
    ranked AS MATERIALIZED (
        SELECT place_id, row_number() OVER (
                   ORDER BY blocked DESC, coalesce(confidence, -1.0) DESC, has_site DESC,
                            distance_mi, place_id) AS rn
        FROM (SELECT place_id, blocked, confidence, has_site, distance_mi FROM elig) AS narrow
    ),
    site_pairs AS (
        SELECT r.rn, unnest(e.site_keys) AS k FROM elig e JOIN ranked r ON r.place_id = e.place_id
    ),
    site_dupes AS (
        SELECT DISTINCT p.rn FROM site_pairs p
        JOIN (SELECT k, min(rn) AS best FROM site_pairs GROUP BY k) b ON p.k = b.k
        WHERE p.rn > b.best
    ),
    after_sites AS MATERIALIZED (
        SELECT r.rn, e.phone_keys, e.name_norm, e.lat, e.lon
        FROM elig e JOIN ranked r ON r.place_id = e.place_id
        WHERE r.rn NOT IN (SELECT rn FROM site_dupes)
    ),
    phone_pairs AS (SELECT rn, unnest(phone_keys) AS k FROM after_sites),
    phone_dupes AS (
        SELECT DISTINCT p.rn FROM phone_pairs p
        JOIN (SELECT k, min(rn) AS best FROM phone_pairs GROUP BY k) b ON p.k = b.k
        WHERE p.rn > b.best
    ),
    after_phones AS MATERIALIZED (
        SELECT rn, name_norm, lat, lon FROM after_sites
        WHERE rn NOT IN (SELECT rn FROM phone_dupes)
    ),
    name_dupes AS (
        SELECT DISTINCT b.rn FROM after_phones a
        JOIN after_phones b ON a.name_norm = b.name_norm AND a.rn < b.rn
        WHERE a.name_norm <> '' AND nn_haversine_mi(a.lat, a.lon, b.lat, b.lon) <= $dup_mi
    ),
    kept AS (
        SELECT rn FROM after_phones WHERE rn NOT IN (SELECT rn FROM name_dupes)
    )
    SELECT {", ".join("e." + c for c in LISTING_COLUMNS)}, e.distance_mi
    FROM elig e JOIN ranked r ON r.place_id = e.place_id
    WHERE NOT e.blocked AND r.rn IN (SELECT rn FROM kept)
    ORDER BY e.has_site DESC, round(coalesce(e.confidence, -1.0), 2) DESC, e.distance_mi,
             e.place_id
    LIMIT $limit
"""

# Named parameters: lat, lon, radius, xmin, ymin, xmax, ymax.
CATEGORY_COUNTS = f"""
    SELECT coalesce(category, basic_category) AS key, count(*) AS n
    FROM places
    WHERE lat BETWEEN $ymin AND $ymax AND lon BETWEEN $xmin AND $xmax
      AND nn_haversine_mi($lat, $lon, lat, lon) <= $radius
      AND {_OPEN}
      AND NOT coalesce(excluded, false)
      AND coalesce(category, basic_category) IS NOT NULL
    GROUP BY 1
    ORDER BY n DESC, key
"""

# Parameter: limit.
ALL_CATEGORIES = f"""
    SELECT coalesce(category, basic_category) AS key, count(*) AS n
    FROM places
    WHERE {_OPEN}
      AND NOT coalesce(excluded, false)
      AND coalesce(category, basic_category) IS NOT NULL
    GROUP BY 1
    ORDER BY n DESC, key
    LIMIT ?
"""

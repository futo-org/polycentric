    -- Add unique constraint on (category_id, name) to boards table
    ALTER TABLE boards
    ADD CONSTRAINT boards_category_id_name_unique UNIQUE (category_id, name);
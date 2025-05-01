-- Add order column to categories
ALTER TABLE categories
ADD COLUMN "order" INTEGER NOT NULL DEFAULT 0;

-- Add order column to boards
ALTER TABLE boards
ADD COLUMN "order" INTEGER NOT NULL DEFAULT 0;

-- Optional: Create indexes for ordering
CREATE INDEX idx_categories_order ON categories ("order");
CREATE INDEX idx_boards_order ON boards ("order");

-- Optional but Recommended: Update existing rows to have a default order
-- This sets order based on creation time initially. Adjust if needed.
WITH ordered_categories AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) as rn
    FROM categories
)
UPDATE categories
SET "order" = ordered_categories.rn - 1
FROM ordered_categories
WHERE categories.id = ordered_categories.id;

-- Do the same for boards within each category
WITH ordered_boards AS (
    SELECT id, category_id, ROW_NUMBER() OVER (PARTITION BY category_id ORDER BY created_at ASC) as rn
    FROM boards
)
UPDATE boards
SET "order" = ordered_boards.rn - 1
FROM ordered_boards
WHERE boards.id = ordered_boards.id;

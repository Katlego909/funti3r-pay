-- Years of birth the sanctions list records for each entry, so screening can tell a namesake from the listed person
-- when the applicant gives a date of birth. Empty for entries that carry none (and for rows stored before this column).
ALTER TABLE sanctions_entries ADD COLUMN IF NOT EXISTS birth_years INTEGER[] NOT NULL DEFAULT '{}';

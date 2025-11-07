-- Migration: Fix CityMapping.originalCity collation to preserve diacritics
-- Issue: utf8mb4_unicode_ci is accent-insensitive, causing "Düsseldorf" = "Dusseldorf"
-- Solution: Change to utf8mb4_bin (binary/accent-sensitive)

ALTER TABLE `CityMapping` 
  MODIFY COLUMN `originalCity` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

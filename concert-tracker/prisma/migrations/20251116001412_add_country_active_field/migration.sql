-- AlterTable
ALTER TABLE `Country` ADD COLUMN `active` BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX `Country_active_idx` ON `Country`(`active`);

/*
  Warnings:

  - You are about to drop the column `normalizedCity` on the `CityMapping` table. All the data in the column will be lost.
  - You are about to drop the column `city` on the `Concert` table. All the data in the column will be lost.
  - You are about to drop the column `normalizedCity` on the `Concert` table. All the data in the column will be lost.
  - Made the column `cityNormalizedId` on table `CityMapping` required. This step will fail if there are existing NULL values in that column.
  - Made the column `cityMappingId` on table `Concert` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE `CityMapping` DROP FOREIGN KEY `CityMapping_cityNormalizedId_fkey`;

-- DropForeignKey
ALTER TABLE `Concert` DROP FOREIGN KEY `Concert_cityMappingId_fkey`;

-- DropIndex
DROP INDEX `CityMapping_normalizedCity_countryId_idx` ON `CityMapping`;

-- DropIndex
DROP INDEX `Concert_city_idx` ON `Concert`;

-- DropIndex
DROP INDEX `Concert_normalizedCity_idx` ON `Concert`;

-- AlterTable
ALTER TABLE `CityMapping` DROP COLUMN `normalizedCity`,
    MODIFY `cityNormalizedId` INTEGER NOT NULL;

-- AlterTable
ALTER TABLE `Concert` DROP COLUMN `city`,
    DROP COLUMN `normalizedCity`,
    MODIFY `cityMappingId` INTEGER NOT NULL;

-- AddForeignKey
ALTER TABLE `CityMapping` ADD CONSTRAINT `CityMapping_cityNormalizedId_fkey` FOREIGN KEY (`cityNormalizedId`) REFERENCES `CityNormalized`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Concert` ADD CONSTRAINT `Concert_cityMappingId_fkey` FOREIGN KEY (`cityMappingId`) REFERENCES `CityMapping`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

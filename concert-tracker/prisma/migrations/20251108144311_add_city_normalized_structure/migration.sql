-- AlterTable
ALTER TABLE `CityMapping` ADD COLUMN `cityNormalizedId` INTEGER NULL;

-- AlterTable
ALTER TABLE `Concert` ADD COLUMN `cityMappingId` INTEGER NULL;

-- CreateTable
CREATE TABLE `CityNormalized` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `normalizedCity` VARCHAR(255) NOT NULL,
    `countryId` INTEGER NOT NULL,
    `createdAt` INTEGER NOT NULL,
    `updatedAt` INTEGER NOT NULL,

    INDEX `CityNormalized_countryId_idx`(`countryId`),
    UNIQUE INDEX `CityNormalized_normalizedCity_countryId_key`(`normalizedCity`, `countryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `CityMapping_cityNormalizedId_idx` ON `CityMapping`(`cityNormalizedId`);

-- CreateIndex
CREATE INDEX `Concert_cityMappingId_idx` ON `Concert`(`cityMappingId`);

-- AddForeignKey
ALTER TABLE `CityNormalized` ADD CONSTRAINT `CityNormalized_countryId_fkey` FOREIGN KEY (`countryId`) REFERENCES `Country`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CityMapping` ADD CONSTRAINT `CityMapping_cityNormalizedId_fkey` FOREIGN KEY (`cityNormalizedId`) REFERENCES `CityNormalized`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Concert` ADD CONSTRAINT `Concert_cityMappingId_fkey` FOREIGN KEY (`cityMappingId`) REFERENCES `CityMapping`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- DropForeignKey
ALTER TABLE `SettingAuditLog` DROP FOREIGN KEY `SettingAuditLog_userId_fkey`;

-- DropForeignKey
ALTER TABLE `UserActiveCountry` DROP FOREIGN KEY `UserActiveCountry_userId_fkey`;

-- DropForeignKey
ALTER TABLE `UserArtist` DROP FOREIGN KEY `UserArtist_userId_fkey`;

-- DropForeignKey
ALTER TABLE `UserConcert` DROP FOREIGN KEY `UserConcert_userId_fkey`;

-- DropForeignKey
ALTER TABLE `UserSetting` DROP FOREIGN KEY `UserSetting_userId_fkey`;

-- CreateIndex
CREATE INDEX `Concert_countryId_dateStart_idx` ON `Concert`(`countryId`, `dateStart`);

-- CreateIndex
CREATE INDEX `UserConcert_interested_idx` ON `UserConcert`(`interested`);

-- CreateIndex
CREATE INDEX `UserConcert_userId_interested_idx` ON `UserConcert`(`userId`, `interested`);

-- AddForeignKey
ALTER TABLE `UserSetting` ADD CONSTRAINT `UserSetting_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserConcert` ADD CONSTRAINT `UserConcert_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserArtist` ADD CONSTRAINT `UserArtist_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserActiveCountry` ADD CONSTRAINT `UserActiveCountry_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SettingAuditLog` ADD CONSTRAINT `SettingAuditLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

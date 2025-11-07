-- CreateTable
CREATE TABLE `Artist` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(255) NOT NULL,
    `mbid` VARCHAR(255) NULL,
    `imageUrl` VARCHAR(500) NULL,
    `createdAt` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `Artist_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Country` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `code` VARCHAR(10) NOT NULL,
    `createdAt` INTEGER NOT NULL,
    `updatedAt` INTEGER NOT NULL,

    UNIQUE INDEX `Country_name_key`(`name`),
    UNIQUE INDEX `Country_code_key`(`code`),
    INDEX `Country_code_idx`(`code`),
    INDEX `Country_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CityMapping` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `originalCity` VARCHAR(255) NOT NULL,
    `countryId` INTEGER NOT NULL,
    `normalizedCity` VARCHAR(255) NOT NULL,
    `latitude` VARCHAR(50) NULL,
    `longitude` VARCHAR(50) NULL,
    `source` VARCHAR(50) NOT NULL,
    `createdAt` INTEGER NOT NULL,
    `updatedAt` INTEGER NOT NULL,

    INDEX `CityMapping_normalizedCity_countryId_idx`(`normalizedCity`, `countryId`),
    INDEX `CityMapping_countryId_idx`(`countryId`),
    UNIQUE INDEX `CityMapping_originalCity_countryId_key`(`originalCity`, `countryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Concert` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `eventName` VARCHAR(500) NOT NULL,
    `eventUrl` VARCHAR(500) NOT NULL,
    `dateStart` INTEGER NOT NULL,
    `dateEnd` INTEGER NOT NULL,
    `venue` VARCHAR(500) NOT NULL,
    `city` VARCHAR(255) NOT NULL,
    `normalizedCity` VARCHAR(255) NOT NULL,
    `countryId` INTEGER NOT NULL,
    `postalCode` VARCHAR(20) NULL,
    `performers` TEXT NOT NULL,
    `imageUrl` VARCHAR(500) NULL,
    `organizer` VARCHAR(255) NULL,
    `organizerUrl` VARCHAR(500) NULL,
    `ticketLinks` TEXT NOT NULL,
    `createdAt` INTEGER NOT NULL,
    `updatedAt` INTEGER NOT NULL,

    UNIQUE INDEX `Concert_eventUrl_key`(`eventUrl`),
    INDEX `Concert_city_idx`(`city`),
    INDEX `Concert_normalizedCity_idx`(`normalizedCity`),
    INDEX `Concert_countryId_idx`(`countryId`),
    INDEX `Concert_dateStart_idx`(`dateStart`),
    INDEX `Concert_eventUrl_idx`(`eventUrl`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Setting` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(100) NOT NULL,
    `value` TEXT NOT NULL,
    `valueType` VARCHAR(20) NOT NULL,
    `description` TEXT NULL,
    `createdAt` INTEGER NOT NULL,
    `updatedAt` INTEGER NOT NULL,

    UNIQUE INDEX `Setting_key_key`(`key`),
    INDEX `Setting_key_idx`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `User` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(100) NOT NULL,
    `hashedPassword` VARCHAR(255) NOT NULL,
    `role` ENUM('USER', 'ADMIN') NOT NULL DEFAULT 'USER',
    `createdAt` INTEGER NOT NULL,
    `updatedAt` INTEGER NOT NULL,

    UNIQUE INDEX `User_username_key`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserSetting` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `key` VARCHAR(100) NOT NULL,
    `value` TEXT NOT NULL,
    `valueType` VARCHAR(20) NOT NULL,
    `createdAt` INTEGER NOT NULL,
    `updatedAt` INTEGER NOT NULL,

    INDEX `UserSetting_userId_idx`(`userId`),
    UNIQUE INDEX `UserSetting_userId_key_key`(`userId`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserConcert` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `concertId` INTEGER NOT NULL,
    `interested` BOOLEAN NOT NULL DEFAULT false,
    `notes` TEXT NULL,
    `isPrivate` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` INTEGER NOT NULL,
    `updatedAt` INTEGER NOT NULL,

    INDEX `UserConcert_userId_idx`(`userId`),
    INDEX `UserConcert_concertId_idx`(`concertId`),
    INDEX `UserConcert_isPrivate_idx`(`isPrivate`),
    UNIQUE INDEX `UserConcert_userId_concertId_key`(`userId`, `concertId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserArtist` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `artistId` INTEGER NOT NULL,
    `playcount` INTEGER NOT NULL DEFAULT 0,
    `playcount12month` INTEGER NOT NULL DEFAULT 0,
    `recent` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` INTEGER NOT NULL,
    `updatedAt` INTEGER NOT NULL,

    INDEX `UserArtist_userId_idx`(`userId`),
    INDEX `UserArtist_artistId_idx`(`artistId`),
    UNIQUE INDEX `UserArtist_userId_artistId_key`(`userId`, `artistId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserActiveCountry` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `countryId` INTEGER NOT NULL,
    `createdAt` INTEGER NOT NULL,

    INDEX `UserActiveCountry_userId_idx`(`userId`),
    INDEX `UserActiveCountry_countryId_idx`(`countryId`),
    UNIQUE INDEX `UserActiveCountry_userId_countryId_key`(`userId`, `countryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SettingAuditLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `key` VARCHAR(100) NOT NULL,
    `oldValue` TEXT NULL,
    `newValue` TEXT NOT NULL,
    `createdAt` INTEGER NOT NULL,

    INDEX `SettingAuditLog_key_idx`(`key`),
    INDEX `SettingAuditLog_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Friendship` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `friendId` INTEGER NOT NULL,
    `status` VARCHAR(20) NOT NULL,
    `createdAt` INTEGER NOT NULL,
    `updatedAt` INTEGER NOT NULL,

    INDEX `Friendship_userId_idx`(`userId`),
    INDEX `Friendship_friendId_idx`(`friendId`),
    INDEX `Friendship_status_idx`(`status`),
    UNIQUE INDEX `Friendship_userId_friendId_key`(`userId`, `friendId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Notification` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `type` VARCHAR(50) NOT NULL,
    `fromUserId` INTEGER NULL,
    `message` TEXT NOT NULL,
    `read` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` INTEGER NOT NULL,

    INDEX `Notification_userId_read_idx`(`userId`, `read`),
    INDEX `Notification_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ArtistConcert` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `artistId` INTEGER NOT NULL,
    `concertId` INTEGER NOT NULL,
    `isPrimary` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` INTEGER NOT NULL,

    INDEX `ArtistConcert_artistId_idx`(`artistId`),
    INDEX `ArtistConcert_concertId_idx`(`concertId`),
    INDEX `ArtistConcert_isPrimary_idx`(`isPrimary`),
    UNIQUE INDEX `ArtistConcert_artistId_concertId_key`(`artistId`, `concertId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CityMapping` ADD CONSTRAINT `CityMapping_countryId_fkey` FOREIGN KEY (`countryId`) REFERENCES `Country`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Concert` ADD CONSTRAINT `Concert_countryId_fkey` FOREIGN KEY (`countryId`) REFERENCES `Country`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserSetting` ADD CONSTRAINT `UserSetting_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserConcert` ADD CONSTRAINT `UserConcert_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserConcert` ADD CONSTRAINT `UserConcert_concertId_fkey` FOREIGN KEY (`concertId`) REFERENCES `Concert`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserArtist` ADD CONSTRAINT `UserArtist_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserArtist` ADD CONSTRAINT `UserArtist_artistId_fkey` FOREIGN KEY (`artistId`) REFERENCES `Artist`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserActiveCountry` ADD CONSTRAINT `UserActiveCountry_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserActiveCountry` ADD CONSTRAINT `UserActiveCountry_countryId_fkey` FOREIGN KEY (`countryId`) REFERENCES `Country`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SettingAuditLog` ADD CONSTRAINT `SettingAuditLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Friendship` ADD CONSTRAINT `Friendship_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Friendship` ADD CONSTRAINT `Friendship_friendId_fkey` FOREIGN KEY (`friendId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_fromUserId_fkey` FOREIGN KEY (`fromUserId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ArtistConcert` ADD CONSTRAINT `ArtistConcert_artistId_fkey` FOREIGN KEY (`artistId`) REFERENCES `Artist`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ArtistConcert` ADD CONSTRAINT `ArtistConcert_concertId_fkey` FOREIGN KEY (`concertId`) REFERENCES `Concert`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


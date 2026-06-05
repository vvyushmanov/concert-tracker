-- CreateTable
CREATE TABLE `IngestBatch` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `batchId` VARCHAR(255) NOT NULL,
    `status` ENUM('PENDING', 'PROCESSING', 'DONE', 'ERROR') NOT NULL DEFAULT 'PENDING',
    `received` INTEGER NOT NULL DEFAULT 0,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `source` VARCHAR(255) NULL,
    `payload` LONGTEXT NOT NULL,
    `result` TEXT NULL,
    `error` TEXT NULL,
    `createdAt` INTEGER NOT NULL,
    `startedAt` INTEGER NULL,
    `finishedAt` INTEGER NULL,

    UNIQUE INDEX `IngestBatch_batchId_key`(`batchId`),
    INDEX `IngestBatch_status_idx`(`status`),
    INDEX `IngestBatch_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

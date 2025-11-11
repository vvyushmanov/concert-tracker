/*
  Warnings:

  - You are about to alter the column `latitude` on the `CityMapping` table. The data in that column could be lost. The data in that column will be cast from `VarChar(50)` to `Double`.
  - You are about to alter the column `longitude` on the `CityMapping` table. The data in that column could be lost. The data in that column will be cast from `VarChar(50)` to `Double`.

*/
-- AlterTable
ALTER TABLE `CityMapping` MODIFY `latitude` DOUBLE NULL,
    MODIFY `longitude` DOUBLE NULL;

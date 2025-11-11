/*
  Warnings:

  - You are about to alter the column `status` on the `Friendship` table. The data in that column could be lost. The data in that column will be cast from `VarChar(20)` to `Enum(EnumId(1))`.
  - You are about to alter the column `type` on the `Notification` table. The data in that column could be lost. The data in that column will be cast from `VarChar(50)` to `Enum(EnumId(2))`.

*/
-- AlterTable
ALTER TABLE `Friendship` MODIFY `status` ENUM('PENDING', 'ACCEPTED', 'DECLINED') NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE `Notification` MODIFY `type` ENUM('FRIEND_REQUEST', 'FRIEND_ACCEPTED') NOT NULL;

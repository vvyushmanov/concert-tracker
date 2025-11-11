-- CreateIndex
CREATE INDEX `Friendship_userId_status_idx` ON `Friendship`(`userId`, `status`);

-- CreateIndex
CREATE INDEX `Friendship_friendId_status_idx` ON `Friendship`(`friendId`, `status`);

-- CreateIndex
CREATE INDEX `UserArtist_userId_playcount_idx` ON `UserArtist`(`userId`, `playcount`);

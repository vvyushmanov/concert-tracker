-- Payloads of already-ingested batches are never read again (the worker now
-- clears them on DONE); drop the backlog. ERROR rows keep theirs for replay.
UPDATE `IngestBatch` SET `payload` = '' WHERE `status` = 'DONE';

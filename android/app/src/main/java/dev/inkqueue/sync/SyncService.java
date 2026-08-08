package dev.inkqueue.sync;

import android.content.Context;
import android.content.SharedPreferences;
import android.preference.PreferenceManager;
import android.util.Log;
import dev.inkqueue.data.PendingOperation;
import dev.inkqueue.data.TaskRepository;
import dev.inkqueue.util.DateUtils;
import java.util.List;

/**
 * Cloud sync orchestrator.
 *
 * v0.8.2:
 *  - single-flight lock (no concurrent performSync races)
 *  - shared TaskRepository (no per-sync SQLite helper)
 *  - one snapshot retry on transient network failure
 *  - richer SyncResult accounting + last_sync_error persistence
 *  - honest user messages for upload / snapshot / partial success
 */
public class SyncService {
    public static final String KEY_API_BASE_URL = "api_base_url";
    public static final String KEY_AUTH = "token";
    public static final String KEY_DEVICE_ID = "device_id";
    public static final String DEFAULT_API_BASE_URL = "";
    public static final String DEFAULT_AUTH = "dev-token";
    public static final String DEFAULT_DEVICE_ID = "kindle-pw3";
    /** Drop pending ops after this many failed upload attempts. */
    public static final int MAX_OP_RETRY = 10;
    private static final String TAG = "InkQueueSyncService";

    private static final Object SYNC_LOCK = new Object();
    private static volatile boolean syncInFlight = false;

    private final TaskRepository repository;
    private SyncClient client;
    private final String deviceId;
    private final SharedPreferences prefs;

    public SyncService(Context context) {
        Context appContext = context.getApplicationContext();
        this.prefs = PreferenceManager.getDefaultSharedPreferences(appContext);
        this.repository = TaskRepository.getInstance(appContext);
        this.deviceId = prefs.getString(KEY_DEVICE_ID, DEFAULT_DEVICE_ID);
        rebuildClient();
    }

    private void rebuildClient() {
        this.client = new SyncClient(
                prefs.getString(KEY_API_BASE_URL, DEFAULT_API_BASE_URL),
                prefs.getString(KEY_AUTH, DEFAULT_AUTH));
    }

    public void updateBaseUrl(String host, int port) {
        String url = "http://" + host + ":" + port;
        prefs.edit().putString(KEY_API_BASE_URL, url).apply();
        rebuildClient();
        Log.i(TAG, "discovered server: " + url);
    }

    public String getBaseUrl() {
        return prefs.getString(KEY_API_BASE_URL, DEFAULT_API_BASE_URL);
    }

    public static boolean isSyncInFlight() {
        return syncInFlight;
    }

    public SyncResult performSync() {
        synchronized (SYNC_LOCK) {
            if (syncInFlight) {
                Log.i(TAG, "performSync skipped — already in flight");
                return SyncResult.busy();
            }
            syncInFlight = true;
        }
        try {
            return doPerformSync();
        } finally {
            synchronized (SYNC_LOCK) {
                syncInFlight = false;
            }
        }
    }

    private SyncResult doPerformSync() {
        repository.setLastSyncAttempt(DateUtils.isoNow());

        if (DateUtils.isEmpty(client.getBaseUrl())) {
            SyncResult r = SyncResult.fail("尚未配置同步地址。正在发现…", "");
            repository.setLastSyncError(r.userMessage);
            return r;
        }

        // Drop dead-letter pending ops so they cannot block the queue forever.
                int dropped = repository.dropDeadPendingOperations(MAX_OP_RETRY);
                if (dropped > 0) {
                    Log.w(TAG, "dropped " + dropped + " dead pending ops (retry>=" + MAX_OP_RETRY + " or corrupt)");
                    repository.setLastSyncError("有 " + dropped + " 条死信已清理");
                }

        int opsAttempted = 0;
        int opsAccepted = 0;
        int opsIgnored = 0;
        int opsFailed = 0;
        int prunedByServer = 0;

        List<PendingOperation> pending = repository.getPendingOperations(MAX_OP_RETRY);
        if (!pending.isEmpty()) {
            opsAttempted = pending.size();
            SyncResult posted = client.postOperations(deviceId, pending);
            if (!posted.success) {
                Log.w(TAG, "operation upload failed: " + posted.technicalMessage);
                for (PendingOperation op : pending) {
                    String reason = posted.userMessage != null ? posted.userMessage : "上传失败";
                    repository.recordOperationError(op.id, reason);
                }
                opsFailed = opsAttempted;
                SyncResult fail;
                if (posted.httpStatus == 401) {
                    fail = SyncResult.fail("同步被拒绝，请检查 Token。", posted.technicalMessage);
                } else {
                    // Upload failed → whole sync failed (never reached snapshot).
                    fail = SyncResult.fail("同步失败，显示本地内容", posted.technicalMessage);
                }
                fail.opsAttempted = opsAttempted;
                fail.opsFailed = opsFailed;
                fail.pendingRemaining = repository.countPendingOperations(MAX_OP_RETRY);
                fail.httpStatus = posted.httpStatus;
                repository.setLastSyncError(fail.userMessage);
                return fail;
            }
            prunedByServer = posted.prunedServer;
            for (String id : posted.accepted) {
                repository.removePendingOperation(id);
                opsAccepted++;
            }
            for (String id : posted.ignored) {
                repository.removePendingOperation(id);
                opsIgnored++;
            }
            for (String error : posted.errors) {
                int separator = error.indexOf('\t');
                if (separator > 0) {
                    String id = error.substring(0, separator);
                    String msg = error.substring(separator + 1);
                    repository.recordOperationError(id, msg);
                    opsFailed++;
                    PendingOperation op = repository.getPendingOperation(id);
                    if (op != null && op.retryCount >= MAX_OP_RETRY) {
                        Log.w(TAG, "giving up on op " + id + " after " + op.retryCount + " retries: " + msg);
                        repository.removePendingOperation(id);
                    }
                }
            }
            Log.i(TAG, "ops uploaded accepted=" + opsAccepted
                    + " ignored=" + opsIgnored + " failed=" + opsFailed);
        }

        SyncResult snapshot = client.fetchSnapshot(deviceId);
        if (!snapshot.success) {
            // One quiet retry for transient network blips (Kindle Wi-Fi is flaky).
            Log.w(TAG, "snapshot failed once: " + snapshot.technicalMessage + " — retrying");
            try {
                Thread.sleep(400);
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
            }
            snapshot = client.fetchSnapshot(deviceId);
        }
        if (!snapshot.success) {
            // Ops may already be on the server. Be honest about partial success.
            SyncResult fail;
            if (opsAccepted > 0 || opsIgnored > 0) {
                fail = SyncResult.fail("操作已上传，刷新失败", snapshot.technicalMessage);
            } else if (snapshot.httpStatus == 401) {
                fail = SyncResult.fail("同步被拒绝，请检查 Token。", snapshot.technicalMessage);
            } else {
                fail = SyncResult.fail(
                        snapshot.userMessage != null ? snapshot.userMessage : "同步失败，显示本地内容",
                        snapshot.technicalMessage);
            }
            fail.opsAttempted = opsAttempted;
            fail.opsAccepted = opsAccepted;
            fail.opsIgnored = opsIgnored;
            fail.opsFailed = opsFailed;
            fail.pendingRemaining = repository.countPendingOperations(MAX_OP_RETRY);
            fail.httpStatus = snapshot.httpStatus;
            fail.snapshotFetched = false;
            repository.setLastSyncError(fail.userMessage);
            return fail;
        }

        repository.replaceTasksWithSnapshot(snapshot.tasks);
        String syncTime = DateUtils.isEmpty(snapshot.serverTime) ? DateUtils.isoNow() : snapshot.serverTime;
        repository.setLastSyncTime(syncTime);
        repository.clearLastSyncError();

        int remaining = repository.countPendingOperations(MAX_OP_RETRY);
        String base = DateUtils.displayLastSync(syncTime);
        if (opsAccepted > 0) {
            base = base + " · 上传 " + opsAccepted + " 条";
        }
        if (opsIgnored > 0) {
            base = base + " · 忽略 " + opsIgnored + " 条";
        }
        // v0.9.4: server-side dead-op housekeeping (TTL/max prune on operations log).
        if (prunedByServer > 0) {
            base = base + " · 服务端清理 " + prunedByServer + " 条";
            Log.i(TAG, "server pruned " + prunedByServer + " expired operations during this sync");
        }
        if (remaining > 0) {
            // Should be rare after a clean snapshot; surface residual failed ops.
            base = base + " · 待同步 " + remaining + " 条";
        }

        snapshot.userMessage = base;
        snapshot.opsAttempted = opsAttempted;
        snapshot.opsAccepted = opsAccepted;
        snapshot.opsIgnored = opsIgnored;
        snapshot.opsFailed = opsFailed;
        snapshot.pendingRemaining = remaining;
        snapshot.snapshotFetched = true;
        return snapshot;
    }
}

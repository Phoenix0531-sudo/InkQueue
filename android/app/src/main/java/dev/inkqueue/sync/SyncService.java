package dev.inkqueue.sync;

import android.content.Context;
import android.content.SharedPreferences;
import android.preference.PreferenceManager;
import android.util.Log;
import dev.inkqueue.data.PendingOperation;
import dev.inkqueue.data.UsageProvider;
import dev.inkqueue.data.TaskRepository;
import dev.inkqueue.util.DateUtils;
import java.util.ArrayList;
import java.util.List;

public class SyncService {
    public static final String KEY_API_BASE_URL = "api_base_url";
    public static final String KEY_TOKEN = "token";
    public static final String KEY_DEVICE_ID = "device_id";
    public static final String DEFAULT_API_BASE_URL = "";
    public static final String DEFAULT_TOKEN = "dev-token";
    public static final String DEFAULT_DEVICE_ID = "kindle-pw3";
    /** Drop pending ops after this many failed upload attempts. */
    public static final int MAX_OP_RETRY = 10;
    private static final String TAG = "InkQueueSyncService";

    private final TaskRepository repository;
    private SyncClient client;
    private final String deviceId;
    private final SharedPreferences prefs;
    private final Context appContext;

    public SyncService(Context context) {
        this.appContext = context.getApplicationContext();
        this.prefs = PreferenceManager.getDefaultSharedPreferences(appContext);
        this.repository = new TaskRepository(appContext);
        this.deviceId = prefs.getString(KEY_DEVICE_ID, DEFAULT_DEVICE_ID);
        rebuildClient();
    }

    private void rebuildClient() {
        this.client = new SyncClient(
                prefs.getString(KEY_API_BASE_URL, DEFAULT_API_BASE_URL),
                prefs.getString(KEY_TOKEN, DEFAULT_TOKEN));
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

    public List<UsageProvider> fetchUsage() {
        if (DateUtils.isEmpty(client.getBaseUrl())) return new ArrayList<UsageProvider>();
        return client.fetchUsage();
    }

    public SyncResult performSync() {
        if (DateUtils.isEmpty(client.getBaseUrl())) {
            return SyncResult.fail("no server configured. discovering...", "");
        }

        // Drop ops that already hit the retry ceiling so they cannot block the queue forever.
        int dropped = repository.dropPendingOverRetryLimit(MAX_OP_RETRY);
        if (dropped > 0) {
            Log.w(TAG, "dropped " + dropped + " pending ops over retry limit " + MAX_OP_RETRY);
        }

        List<PendingOperation> pending = repository.getPendingOperations(MAX_OP_RETRY);
        if (!pending.isEmpty()) {
            SyncResult posted = client.postOperations(deviceId, pending);
            if (!posted.success) {
                Log.w(TAG, "operation upload failed: " + posted.technicalMessage);
                // Count a network / auth failure against every op we tried to send.
                for (PendingOperation op : pending) {
                    String reason = posted.userMessage != null ? posted.userMessage : "upload failed";
                    repository.recordOperationError(op.id, reason);
                }
                // Token rejection: keep local data, surface clear message.
                if (posted.httpStatus == 401) {
                    return SyncResult.fail("token rejected. check settings.", posted.technicalMessage);
                }
                return posted;
            }
            for (String id : posted.accepted) repository.removePendingOperation(id);
            for (String id : posted.ignored) repository.removePendingOperation(id);
            for (String error : posted.errors) {
                int separator = error.indexOf('\t');
                if (separator > 0) {
                    String id = error.substring(0, separator);
                    String msg = error.substring(separator + 1);
                    repository.recordOperationError(id, msg);
                    PendingOperation op = repository.getPendingOperation(id);
                    if (op != null && op.retryCount >= MAX_OP_RETRY) {
                        Log.w(TAG, "giving up on op " + id + " after " + op.retryCount + " retries: " + msg);
                        repository.removePendingOperation(id);
                    }
                }
            }
        }

        SyncResult snapshot = client.fetchSnapshot();
        if (!snapshot.success) return snapshot;
        repository.replaceTasksWithSnapshot(snapshot.tasks);
        String syncTime = DateUtils.isEmpty(snapshot.serverTime) ? DateUtils.isoNow() : snapshot.serverTime;
        repository.setLastSyncTime(syncTime);
        snapshot.userMessage = DateUtils.displayLastSync(syncTime);
        return snapshot;
    }
}

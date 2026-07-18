package dev.inkqueue.sync;

import android.content.Context;
import android.content.SharedPreferences;
import android.preference.PreferenceManager;
import android.util.Log;
import dev.inkqueue.data.PendingOperation;
import dev.inkqueue.data.UsageProvider;
import dev.inkqueue.data.TaskRepository;
import dev.inkqueue.util.DateUtils;
import java.util.List;

public class SyncService {
    public static final String KEY_API_BASE_URL = "api_base_url";
    public static final String KEY_TOKEN = "token";
    public static final String KEY_DEVICE_ID = "device_id";
    public static final String DEFAULT_API_BASE_URL = "";
    public static final String DEFAULT_TOKEN = "dev-token";
    public static final String DEFAULT_DEVICE_ID = "kindle-pw3";
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
        if (DateUtils.isEmpty(client.getBaseUrl())) return new java.util.ArrayList<UsageProvider>();
        return client.fetchUsage();
    }

    public SyncResult performSync() {
        if (DateUtils.isEmpty(client.getBaseUrl())) {
            return SyncResult.fail("no server configured. discovering...", "");
        }
        List<PendingOperation> pending = repository.getPendingOperations();
        if (!pending.isEmpty()) {
            SyncResult posted = client.postOperations(deviceId, pending);
            if (!posted.success) {
                Log.w(TAG, "operation upload failed: " + posted.technicalMessage);
                return posted;
            }
            for (String id : posted.accepted) repository.removePendingOperation(id);
            for (String id : posted.ignored) repository.removePendingOperation(id);
            for (String error : posted.errors) {
                int separator = error.indexOf('\t');
                if (separator > 0) {
                    repository.recordOperationError(error.substring(0, separator), error.substring(separator + 1));
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

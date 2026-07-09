package dev.inkqueue.sync;

import android.content.Context;
import android.content.SharedPreferences;
import android.preference.PreferenceManager;
import android.util.Log;
import dev.inkqueue.data.PendingOperation;
import dev.inkqueue.data.TaskRepository;
import dev.inkqueue.util.DateUtils;
import java.util.List;

public class SyncService {
    public static final String KEY_API_BASE_URL = "api_base_url";
    public static final String KEY_TOKEN = "token";
    public static final String KEY_DEVICE_ID = "device_id";
    public static final String DEFAULT_API_BASE_URL = "http://10.0.2.2:8787";
    public static final String DEFAULT_TOKEN = "dev-token";
    public static final String DEFAULT_DEVICE_ID = "kindle-pw3";
    private static final String TAG = "InkQueueSyncService";

    private final TaskRepository repository;
    private final SyncClient client;
    private final String deviceId;

    public SyncService(Context context) {
        Context app = context.getApplicationContext();
        SharedPreferences prefs = PreferenceManager.getDefaultSharedPreferences(app);
        this.repository = new TaskRepository(app);
        this.client = new SyncClient(
                prefs.getString(KEY_API_BASE_URL, DEFAULT_API_BASE_URL),
                prefs.getString(KEY_TOKEN, DEFAULT_TOKEN));
        this.deviceId = prefs.getString(KEY_DEVICE_ID, DEFAULT_DEVICE_ID);
    }

    public SyncResult performSync() {
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

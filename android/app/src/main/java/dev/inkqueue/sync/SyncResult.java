package dev.inkqueue.sync;

import dev.inkqueue.data.Task;
import java.util.ArrayList;
import java.util.List;

public class SyncResult {
    public boolean success;
    public int httpStatus;
    public String serverTime;
    public String userMessage;
    public String technicalMessage;
    public List<Task> tasks = new ArrayList<Task>();
    public List<String> accepted = new ArrayList<String>();
    public List<String> ignored = new ArrayList<String>();
    public List<String> errors = new ArrayList<String>();

    /** v0.8.2 — richer sync accounting for UI / logs. */
    public int opsAttempted;
    public int opsAccepted;
    public int opsIgnored;
    public int opsFailed;
    public int pendingRemaining;
    public boolean snapshotFetched;
    public boolean skippedBusy;
    public boolean offline;

    public static SyncResult ok(String message) {
        SyncResult result = new SyncResult();
        result.success = true;
        result.userMessage = message;
        return result;
    }

    public static SyncResult fail(String userMessage, String technicalMessage) {
        SyncResult result = new SyncResult();
        result.success = false;
        result.userMessage = userMessage;
        result.technicalMessage = technicalMessage;
        return result;
    }

    public static SyncResult busy() {
        SyncResult result = fail("正在同步…", "sync already in progress");
        result.skippedBusy = true;
        return result;
    }
}

package dev.inkqueue.data;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import dev.inkqueue.util.DateUtils;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Local task + pending-op store. Uses the process-wide {@link InkQueueDatabase}
 * singleton so concurrent SyncService / Activity paths share one connection pool.
 */
public class TaskRepository {
    private static final String LAST_SYNC_KEY = "last_sync_time";
    private static final String LAST_SYNC_ERROR_KEY = "last_sync_error";
    private static final String LAST_SYNC_ATTEMPT_KEY = "last_sync_attempt";

    private static final Object LOCK = new Object();
    private static TaskRepository instance;

    private final InkQueueDatabase helper;

    public static TaskRepository getInstance(Context context) {
        if (instance == null) {
            synchronized (LOCK) {
                if (instance == null) {
                    instance = new TaskRepository(context.getApplicationContext());
                }
            }
        }
        return instance;
    }

    /** Prefer {@link #getInstance(Context)}. Kept for call-site compatibility. */
    public TaskRepository(Context context) {
        this.helper = InkQueueDatabase.getInstance(context);
    }

    /** Test-only: drop singleton so the next getInstance rebuilds against a clean helper. */
    public static void resetInstanceForTests() {
        synchronized (LOCK) {
            instance = null;
            InkQueueDatabase.resetInstanceForTests();
        }
    }

    public List<Task> getAllOpenTasks() {
        SQLiteDatabase db = helper.getReadableDatabase();
        Cursor cursor = db.query(
                "tasks", null,
                "status NOT IN (?, ?)",
                new String[]{Task.STATUS_DONE, Task.STATUS_ARCHIVED},
                null, null,
                "due_date IS NULL, due_date ASC, due_time IS NULL, due_time ASC, title ASC");
        try {
            List<Task> out = new ArrayList<Task>();
            while (cursor.moveToNext()) out.add(taskFromCursor(cursor));
            return out;
        } finally {
            cursor.close();
        }
    }

    /**
     * Tasks completed on product day {@code todayDate} (Asia/Shanghai date string).
     * Matches completed_at prefix YYYY-MM-DD or due_date == today with status done.
     */
    public List<Task> getCompletedToday(String todayDate) {
        if (todayDate == null || todayDate.length() == 0) {
            return new ArrayList<Task>();
        }
        SQLiteDatabase db = helper.getReadableDatabase();
        // completed_at is ISO8601 with offset; date prefix is first 10 chars.
        Cursor cursor = db.query(
                "tasks", null,
                "status = ? AND (completed_at LIKE ? OR (due_date = ? AND completed_at IS NOT NULL))",
                new String[]{Task.STATUS_DONE, todayDate + "%", todayDate},
                null, null,
                "completed_at DESC, title ASC");
        try {
            List<Task> out = new ArrayList<Task>();
            while (cursor.moveToNext()) out.add(taskFromCursor(cursor));
            return out;
        } finally {
            cursor.close();
        }
    }

    public Task getTaskById(String id) {
        SQLiteDatabase db = helper.getReadableDatabase();
        Cursor cursor = db.query("tasks", null, "id=?", new String[]{id}, null, null, null);
        try {
            return cursor.moveToFirst() ? taskFromCursor(cursor) : null;
        } finally {
            cursor.close();
        }
    }

    public void upsertTasks(List<Task> tasks) {
        SQLiteDatabase db = helper.getWritableDatabase();
        db.beginTransaction();
        try {
            for (Task task : tasks) {
                db.insertWithOnConflict("tasks", null, valuesForTask(task), SQLiteDatabase.CONFLICT_REPLACE);
            }
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    /**
     * Merge云端 snapshot 进本地，保护尚未上传的 pending operations。
     *
     * 冲突策略 v2（conflict_policy = agent_text_device_lifecycle）：
     *   - 没有 pending op 的 task：直接用 snapshot 覆盖（delete + insert）。
     *   - 有 pending op 的 task：snapshot 的 title/note/project/priority/source/created_at/raw_json
     *     采用云端值；本地 status/due_date/due_time/completed_at/updated_at 保留
     *     （设备刚做完但 server 还没收到）。
     *
     * 这避免 Agent 改标题时把设备刚完成的 status 冲掉。
     */
    public void replaceTasksWithSnapshot(List<Task> tasks) {
        Set<String> pendingTaskIds = new HashSet<String>();
        for (PendingOperation op : getPendingOperations()) {
            if (op.taskId != null) pendingTaskIds.add(op.taskId);
        }

        SQLiteDatabase db = helper.getWritableDatabase();
        db.beginTransaction();
        try {
            // Collect local lifecycle fields for tasks with pending ops before wipe.
            Map<String, String[]> localLifecycle = new HashMap<String, String[]>();
            if (!pendingTaskIds.isEmpty()) {
                StringBuilder placeholders = new StringBuilder();
                boolean first = true;
                for (String id : pendingTaskIds) {
                    if (!first) placeholders.append(',');
                    placeholders.append('?');
                    first = false;
                }
                Cursor c = db.query(
                        "tasks",
                        new String[]{"id", "status", "due_date", "due_time", "completed_at", "updated_at"},
                        "id IN (" + placeholders.toString() + ")",
                        pendingTaskIds.toArray(new String[0]),
                        null, null, null);
                try {
                    while (c.moveToNext()) {
                        localLifecycle.put(c.getString(0), new String[]{
                                c.getString(1), c.getString(2), c.getString(3),
                                c.getString(4), c.getString(5)});
                    }
                } finally {
                    c.close();
                }
            }

            db.delete("tasks", null, null);
            for (Task task : tasks) {
                String[] local = localLifecycle.get(task.id);
                ContentValues v = valuesForTask(task);
                if (local != null) {
                    // pending op: protect device lifecycle fields
                    v.put("status", local[0] != null ? local[0] : task.status);
                    v.put("due_date", local[1] != null ? local[1] : task.dueDate);
                    v.put("due_time", local[2] != null ? local[2] : task.dueTime);
                    v.put("completed_at", local[3] != null ? local[3] : task.completedAt);
                    v.put("updated_at", local[4] != null ? local[4] : task.updatedAt);
                }
                db.insertWithOnConflict("tasks", null, v, SQLiteDatabase.CONFLICT_REPLACE);
            }
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    public void markDone(String taskId, String completedAt) {
        ContentValues values = new ContentValues();
        values.put("status", Task.STATUS_DONE);
        values.put("completed_at", completedAt);
        values.put("updated_at", completedAt);
        helper.getWritableDatabase().update("tasks", values, "id=?", new String[]{taskId});
    }

    public void postpone(String taskId, String targetDate) {
        ContentValues values = new ContentValues();
        values.put("due_date", targetDate);
        values.put("updated_at", DateUtils.isoNow());
        helper.getWritableDatabase().update("tasks", values, "id=?", new String[]{taskId});
    }

    public void addPendingOperation(PendingOperation op) {
        addPendingOperation(helper.getWritableDatabase(), op);
    }

    public void markDoneAndQueueOperation(String taskId, String completedAt, PendingOperation op) {
        SQLiteDatabase db = helper.getWritableDatabase();
        db.beginTransaction();
        try {
            ContentValues values = new ContentValues();
            values.put("status", Task.STATUS_DONE);
            values.put("completed_at", completedAt);
            values.put("updated_at", completedAt);
            db.update("tasks", values, "id=?", new String[]{taskId});
            addPendingOperation(db, op);
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    public void postponeAndQueueOperation(String taskId, String targetDate, PendingOperation op) {
        SQLiteDatabase db = helper.getWritableDatabase();
        db.beginTransaction();
        try {
            ContentValues values = new ContentValues();
            values.put("due_date", targetDate);
            values.put("updated_at", DateUtils.isoNow());
            db.update("tasks", values, "id=?", new String[]{taskId});
            addPendingOperation(db, op);
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    private static void addPendingOperation(SQLiteDatabase db, PendingOperation op) {
        ContentValues values = new ContentValues();
        values.put("id", op.id);
        values.put("type", op.type);
        values.put("task_id", op.taskId);
        values.put("payload", op.payload);
        values.put("created_at", op.createdAt);
        values.put("retry_count", op.retryCount);
        values.put("last_error", op.lastError);
        db.insertWithOnConflict("pending_operations", null, values, SQLiteDatabase.CONFLICT_REPLACE);
    }

    public List<PendingOperation> getPendingOperations() {
        return getPendingOperations(Integer.MAX_VALUE);
    }

    /** Pending ops with retry_count &lt; maxRetry (ops that still may be uploaded). */
    public List<PendingOperation> getPendingOperations(int maxRetry) {
        SQLiteDatabase db = helper.getReadableDatabase();
        Cursor cursor = db.query(
                "pending_operations",
                null,
                "retry_count < ?",
                new String[]{String.valueOf(maxRetry)},
                null, null,
                "created_at ASC");
        try {
            List<PendingOperation> out = new ArrayList<PendingOperation>();
            while (cursor.moveToNext()) out.add(operationFromCursor(cursor));
            return out;
        } finally {
            cursor.close();
        }
    }

    /** Cheap count for masthead "待同步 N 条". */
    public int countPendingOperations() {
        return countPendingOperations(Integer.MAX_VALUE);
    }

    public int countPendingOperations(int maxRetry) {
        SQLiteDatabase db = helper.getReadableDatabase();
        Cursor cursor = db.rawQuery(
                "SELECT COUNT(*) FROM pending_operations WHERE retry_count < ?",
                new String[]{String.valueOf(maxRetry)});
        try {
            if (cursor.moveToFirst()) return cursor.getInt(0);
            return 0;
        } finally {
            cursor.close();
        }
    }

    public PendingOperation getPendingOperation(String id) {
        SQLiteDatabase db = helper.getReadableDatabase();
        Cursor cursor = db.query("pending_operations", null, "id=?", new String[]{id}, null, null, null);
        try {
            return cursor.moveToFirst() ? operationFromCursor(cursor) : null;
        } finally {
            cursor.close();
        }
    }

    public void removePendingOperation(String id) {
        helper.getWritableDatabase().delete("pending_operations", "id=?", new String[]{id});
    }

    /** Remove ops that already reached/exceeded maxRetry. Returns how many were dropped. */
    public int dropPendingOverRetryLimit(int maxRetry) {
        return helper.getWritableDatabase().delete(
                "pending_operations",
                "retry_count >= ?",
                new String[]{String.valueOf(maxRetry)});
    }

    public void recordOperationError(String id, String error) {
        helper.getWritableDatabase().execSQL(
                "UPDATE pending_operations SET retry_count = retry_count + 1, last_error = ? WHERE id = ?",
                new Object[]{error, id});
    }

    public String getLastSyncTime() {
        return getSyncState(LAST_SYNC_KEY);
    }

    public void setLastSyncTime(String time) {
        putSyncState(LAST_SYNC_KEY, time);
    }

    public String getLastSyncError() {
        return getSyncState(LAST_SYNC_ERROR_KEY);
    }

    public void setLastSyncError(String error) {
        putSyncState(LAST_SYNC_ERROR_KEY, error == null ? "" : error);
    }

    public void clearLastSyncError() {
        putSyncState(LAST_SYNC_ERROR_KEY, "");
    }

    public String getLastSyncAttempt() {
        return getSyncState(LAST_SYNC_ATTEMPT_KEY);
    }

    public void setLastSyncAttempt(String isoTime) {
        putSyncState(LAST_SYNC_ATTEMPT_KEY, isoTime);
    }

    private String getSyncState(String key) {
        SQLiteDatabase db = helper.getReadableDatabase();
        Cursor cursor = db.query("sync_state", new String[]{"value"}, "key=?", new String[]{key}, null, null, null);
        try {
            return cursor.moveToFirst() ? cursor.getString(0) : null;
        } finally {
            cursor.close();
        }
    }

    private void putSyncState(String key, String value) {
        ContentValues values = new ContentValues();
        values.put("key", key);
        values.put("value", value);
        helper.getWritableDatabase().insertWithOnConflict("sync_state", null, values, SQLiteDatabase.CONFLICT_REPLACE);
    }

    private static ContentValues valuesForTask(Task task) {
        ContentValues values = new ContentValues();
        values.put("id", task.id);
        values.put("title", task.title);
        values.put("note", task.note);
        values.put("status", task.status);
        values.put("due_date", task.dueDate);
        values.put("due_time", task.dueTime);
        values.put("project", task.project);
        values.put("priority", task.priority);
        values.put("created_at", task.createdAt);
        values.put("updated_at", task.updatedAt);
        values.put("completed_at", task.completedAt);
        values.put("source", task.source);
        values.put("force_today", task.forceToday ? 1 : 0);
        values.put("raw_json", task.rawJson);
        return values;
    }

    private static Task taskFromCursor(Cursor cursor) {
        Task task = new Task();
        task.id = cursor.getString(cursor.getColumnIndexOrThrow("id"));
        task.title = cursor.getString(cursor.getColumnIndexOrThrow("title"));
        task.note = cursor.getString(cursor.getColumnIndexOrThrow("note"));
        task.status = cursor.getString(cursor.getColumnIndexOrThrow("status"));
        task.dueDate = cursor.getString(cursor.getColumnIndexOrThrow("due_date"));
        task.dueTime = cursor.getString(cursor.getColumnIndexOrThrow("due_time"));
        task.project = cursor.getString(cursor.getColumnIndexOrThrow("project"));
        task.priority = cursor.getString(cursor.getColumnIndexOrThrow("priority"));
        task.createdAt = cursor.getString(cursor.getColumnIndexOrThrow("created_at"));
        task.updatedAt = cursor.getString(cursor.getColumnIndexOrThrow("updated_at"));
        task.completedAt = cursor.getString(cursor.getColumnIndexOrThrow("completed_at"));
        task.source = cursor.getString(cursor.getColumnIndexOrThrow("source"));
        task.forceToday = cursor.getInt(cursor.getColumnIndexOrThrow("force_today")) == 1;
        task.rawJson = cursor.getString(cursor.getColumnIndexOrThrow("raw_json"));
        return task;
    }

    private static PendingOperation operationFromCursor(Cursor cursor) {
        PendingOperation op = new PendingOperation();
        op.id = cursor.getString(cursor.getColumnIndexOrThrow("id"));
        op.type = cursor.getString(cursor.getColumnIndexOrThrow("type"));
        op.taskId = cursor.getString(cursor.getColumnIndexOrThrow("task_id"));
        op.payload = cursor.getString(cursor.getColumnIndexOrThrow("payload"));
        op.createdAt = cursor.getString(cursor.getColumnIndexOrThrow("created_at"));
        op.retryCount = cursor.getInt(cursor.getColumnIndexOrThrow("retry_count"));
        op.lastError = cursor.getString(cursor.getColumnIndexOrThrow("last_error"));
        return op;
    }
}

package dev.inkqueue.data;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import dev.inkqueue.util.DateUtils;
import java.util.ArrayList;
import java.util.List;

public class TaskRepository {
    private static final String LAST_SYNC_KEY = "last_sync_time";
    private final InkQueueDatabase helper;

    public TaskRepository(Context context) {
        this.helper = new InkQueueDatabase(context.getApplicationContext());
    }

    public List<Task> getAllOpenTasks() {
        SQLiteDatabase db = helper.getReadableDatabase();
        Cursor cursor = db.query("tasks", null, "status NOT IN (?, ?)", new String[]{Task.STATUS_DONE, Task.STATUS_ARCHIVED}, null, null, "due_date IS NULL, due_date ASC, due_time IS NULL, due_time ASC, title ASC");
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
            for (Task task : tasks) db.insertWithOnConflict("tasks", null, valuesForTask(task), SQLiteDatabase.CONFLICT_REPLACE);
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    public void replaceTasksWithSnapshot(List<Task> tasks) {
        SQLiteDatabase db = helper.getWritableDatabase();
        db.beginTransaction();
        try {
            db.delete("tasks", null, null);
            for (Task task : tasks) db.insertWithOnConflict("tasks", null, valuesForTask(task), SQLiteDatabase.CONFLICT_REPLACE);
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
        SQLiteDatabase db = helper.getReadableDatabase();
        Cursor cursor = db.query("sync_state", new String[]{"value"}, "key=?", new String[]{LAST_SYNC_KEY}, null, null, null);
        try {
            return cursor.moveToFirst() ? cursor.getString(0) : null;
        } finally {
            cursor.close();
        }
    }

    public void setLastSyncTime(String time) {
        ContentValues values = new ContentValues();
        values.put("key", LAST_SYNC_KEY);
        values.put("value", time);
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

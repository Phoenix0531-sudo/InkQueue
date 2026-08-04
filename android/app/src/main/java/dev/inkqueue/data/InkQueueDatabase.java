package dev.inkqueue.data;

import android.content.Context;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

/**
 * Single SQLiteOpenHelper for the whole process.
 *
 * Android 4.4 logs "SQLiteConnection … was leaked" when multiple helpers for the
 * same file are abandoned without close(). MainActivity, TaskDetailActivity and
 * every SyncService used to each construct a fresh helper → pool leak on every
 * sync. Keep one instance keyed on application context.
 */
public class InkQueueDatabase extends SQLiteOpenHelper {
    public static final String DB_NAME = "inkqueue.db";
    public static final int DB_VERSION = 3;

    private static final Object LOCK = new Object();
    private static InkQueueDatabase instance;

    public static InkQueueDatabase getInstance(Context context) {
        if (instance == null) {
            synchronized (LOCK) {
                if (instance == null) {
                    instance = new InkQueueDatabase(context.getApplicationContext());
                }
            }
        }
        return instance;
    }

    /** Visible for unit tests that need an isolated helper. */
    public static void resetInstanceForTests() {
        synchronized (LOCK) {
            if (instance != null) {
                try {
                    instance.close();
                } catch (Throwable ignored) {
                }
                instance = null;
            }
        }
    }

    private InkQueueDatabase(Context context) {
        super(context, DB_NAME, null, DB_VERSION);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE tasks (" +
                "id TEXT PRIMARY KEY," +
                "title TEXT NOT NULL," +
                "note TEXT," +
                "status TEXT NOT NULL," +
                "due_date TEXT," +
                "due_time TEXT," +
                "project TEXT," +
                "priority TEXT," +
                "created_at TEXT," +
                "updated_at TEXT," +
                "completed_at TEXT," +
                "source TEXT," +
                "force_today INTEGER NOT NULL DEFAULT 0," +
                "raw_json TEXT" +
                ")");
        db.execSQL("CREATE INDEX idx_tasks_status_due ON tasks(status, due_date)");
        db.execSQL("CREATE TABLE pending_operations (" +
                "id TEXT PRIMARY KEY," +
                "type TEXT NOT NULL," +
                "task_id TEXT NOT NULL," +
                "payload TEXT NOT NULL," +
                "created_at TEXT NOT NULL," +
                "retry_count INTEGER NOT NULL DEFAULT 0," +
                "last_error TEXT" +
                ")");
        db.execSQL("CREATE INDEX idx_pending_created ON pending_operations(created_at)");
        db.execSQL("CREATE TABLE sync_state (" +
                "key TEXT PRIMARY KEY," +
                "value TEXT" +
                ")");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        db.execSQL("DROP TABLE IF EXISTS tasks");
        db.execSQL("DROP TABLE IF EXISTS pending_operations");
        db.execSQL("DROP TABLE IF EXISTS sync_state");
        onCreate(db);
    }

    @Override
    public void onConfigure(SQLiteDatabase db) {
        // Keep foreign-key-ish integrity optional; enable WAL only if API supports and
        // device is happy — skip on KitKat for maximum compatibility.
        super.onConfigure(db);
    }
}

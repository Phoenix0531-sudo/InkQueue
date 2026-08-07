package dev.inkqueue.sync;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.SystemClock;
import android.preference.PreferenceManager;
import android.util.Log;

/**
 * Schedules background syncs via AlarmManager.ELAPSED_REALTIME_WAKEUP.
 *
 * Target device is Kindle Paperwhite 3 (Android 4.4.2, 512MB RAM, e-ink).
 * We deliberately use AlarmManager with inexact repeating — never setRepeating
 * (it existed since API 19 but RTC_WAKEUPExact is power-heavy and triggers
 * KitKat's "alarm pile" coalescer). The wake-up is inexact: the system can
 * delay by up to one interval, which is fine for a task list whose live
 * freshness lag of a few minutes is acceptable on this device.
 *
 * Interval 0 disables background scheduling entirely (the "off" choice).
 * Default interval is 5 minutes (only meaningful while the user is likely
 * to want the Kindle to know about agent pushes without reopening the app).
 */
public final class SyncScheduler {
    public static final String KEY_SYNC_INTERVAL_SECONDS = "sync_interval_seconds";
    /** Default 5 minutes. Values clamped to {0, 60, 300, 900, 1800}. */
    public static final int DEFAULT_INTERVAL_SECONDS = 300;

    /** Allowed discrete choices (seconds). 0 = off. */
    public static final int[] ALLOWED_INTERVALS = {0, 60, 300, 900, 1800};

    /**
     * Labels shown in SettingsActivity. Order must match ALLOWED_INTERVALS.
     */
    public static final String[] INTERVAL_LABELS = {
        "关闭", "1 分钟", "5 分钟", "15 分钟", "30 分钟"
    };

    private static final String TAG = "InkQueueSyncScheduler";
    private static final int REQUEST_CODE = 0x494e; // "IN"
    public static final String ACTION_SYNC_TICK = "dev.inkqueue.action.SYNC_TICK";

    private SyncScheduler() {}

    public static int readIntervalSeconds(SharedPreferences prefs) {
        int v = prefs.getInt(KEY_SYNC_INTERVAL_SECONDS, DEFAULT_INTERVAL_SECONDS);
        return nearestInterval(v);
    }

    /** Snap arbitrary input to nearest allowed value; unknown -> default. */
    public static int nearestInterval(int v) {
        if (v <= 0) return 0;
        int best = ALLOWED_INTERVALS[0];
        int bestDist = Math.abs(v - best);
        for (int i = 1; i < ALLOWED_INTERVALS.length; i++) {
            int d = Math.abs(v - ALLOWED_INTERVALS[i]);
            if (d < bestDist) { best = ALLOWED_INTERVALS[i]; bestDist = d; }
        }
        return best;
    }

    public static int labelIndex(int seconds) {
        for (int i = 0; i < ALLOWED_INTERVALS.length; i++) {
            if (ALLOWED_INTERVALS[i] == seconds) return i;
        }
        return 2; // fall back to "5 分钟"
    }

    /**
     * Reschedule the background alarm based on current prefs. Idempotent:
     * cancels any prior alarm before setting a new one. Interval=0 cancels
     * without re-arming.
     */
    public static void reschedule(Context context) {
        SharedPreferences prefs = PreferenceManager.getDefaultSharedPreferences(context);
        reschedule(context,prefs);
    }

    public static void reschedule(Context context, SharedPreferences prefs) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        Intent intent = new Intent(context.getApplicationContext(), SyncTickReceiver.class);
        intent.setAction(ACTION_SYNC_TICK);
        PendingIntent pi = PendingIntent.getBroadcast(
                context.getApplicationContext(),
                REQUEST_CODE,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT);

        // Always cancel first.
        if (am != null) am.cancel(pi);

        int seconds = readIntervalSeconds(prefs);
        if (seconds <= 0) {
            Log.i(TAG, "background sync disabled (interval=0)");
            return;
        }

        long intervalMs = seconds * 1000L;
        long triggerAt = SystemClock.elapsedRealtime() + intervalMs;

        if (am != null) {
            // Inexact + wakeup: coalesce-friendly, saves battery on e-ink.
            am.setInexactRepeating(
                AlarmManager.ELAPSED_REALTIME_WAKEUP,
                triggerAt,
                intervalMs,
                pi);
        }
        Log.i(TAG, "background sync scheduled every " + seconds + "s");
    }

    public static void cancel(Context context) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        Intent intent = new Intent(context.getApplicationContext(), SyncTickReceiver.class);
        intent.setAction(ACTION_SYNC_TICK);
        PendingIntent pi = PendingIntent.getBroadcast(
                context.getApplicationContext(),
                REQUEST_CODE,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT);
        if (am != null) am.cancel(pi);
        Log.i(TAG, "background sync alarm cancelled");
    }
}

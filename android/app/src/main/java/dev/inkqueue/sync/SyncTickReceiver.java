package dev.inkqueue.sync;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.PowerManager;
import android.util.Log;

/**
 * Receives periodic SYNC_TICK alarms fired by SyncScheduler and kicks a
 * background SyncService run on a worker thread. Holds a partial wake-lock
 * only for the duration of the sync so that an idle Kindle (screen off, e-ink
 * refreshed) does not lose Wi-Fi mid-sync — KitKat+ can suspend the radio
 * when the device sleeps.
 *
 * SyncService.performSync() is single-flight (a second alarm landing while a
 * sync is running just returns SyncResult.busy()), so firing them in a tight
 * pattern is harmless. If no API base URL is configured this is a no-op.
 */
public class SyncTickReceiver extends BroadcastReceiver {
    private static final String TAG = "InkQueueSyncTick";
    private static final String WAKE_LOCK_TAG = "InkQueue:sync-tick";
    /** Hard ceiling on wake-lock duration for a single tick (milliseconds). */
    private static final long WAKE_LOCK_TIMEOUT_MS = 20_000L;

    @Override
    public void onReceive(final Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (!SyncScheduler.ACTION_SYNC_TICK.equals(action)) return;

        final Context app = context.getApplicationContext();
        // Defer to a thread so onReceive returns within ANR budget (~10s).
        new Thread(new Runnable() {
            @Override
            public void run() {
                PowerManager pm = (PowerManager) app.getSystemService(Context.POWER_SERVICE);
                PowerManager.WakeLock wl = null;
                if (pm != null) {
                    try {
                        wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG);
                        wl.setReferenceCounted(false);
                        wl.acquire(WAKE_LOCK_TIMEOUT_MS);
                    } catch (Exception e) {
                        Log.w(TAG, "wake-lock acquire failed: " + e);
                        wl = null;
                    }
                }
                try {
                    SyncService svc = new SyncService(app);
                    // No API URL configured? Bail silently — no point spamming logs.
                    if (svc.getBaseUrl() == null || svc.getBaseUrl().trim().isEmpty()) {
                        Log.i(TAG, "tick skipped — no API base URL configured");
                        return;
                    }
                    if (SyncService.isSyncInFlight()) {
                        Log.i(TAG, "tick skipped — sync already in flight");
                        return;
                    }
                    SyncResult r = svc.performSync();
                    if (r != null && r.success) {
                        Log.i(TAG, "background sync OK: " + r.userMessage);
                    } else if (r != null) {
                        Log.w(TAG, "background sync failed: " + r.userMessage
                                + " (" + r.technicalMessage + ")");
                    }
                } catch (Exception e) {
                    Log.e(TAG, "background sync crash: " + e);
                } finally {
                    if (wl != null && wl.isHeld()) {
                        try { wl.release(); } catch (Exception ignored) {}
                    }
                }
            }
        }, "InkQueue-sync-tick").start();
    }
}

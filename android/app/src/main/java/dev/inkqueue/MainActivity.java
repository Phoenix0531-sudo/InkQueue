package dev.inkqueue;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.os.AsyncTask;
import android.os.Bundle;
import android.os.PowerManager;
import android.view.Window;
import android.view.WindowManager;
import android.widget.Toast;
import dev.inkqueue.data.AgentNotice;
import dev.inkqueue.data.Task;
import dev.inkqueue.data.TaskRepository;
import dev.inkqueue.data.OperationQueue;
import dev.inkqueue.sync.SyncClient;
import dev.inkqueue.sync.SyncResult;
import dev.inkqueue.sync.SyncScheduler;
import dev.inkqueue.sync.SyncService;
import dev.inkqueue.ui.InkMainView;
import dev.inkqueue.ui.SectionedTaskList;
import dev.inkqueue.util.DateUtils;
import java.util.List;

/**
 * Main task-list screen for InkQueue.
 *
 * v0.9:
 *  - shared TaskRepository (no per-Activity SQLite helper)
 *  - sync phases visible in masthead ("正在上传 N 条…" / "正在拉取…")
 *  - single-flight aware (ignore busy SyncResult without clobbering status)
 *  - offline still refreshes pending count
 */
public class MainActivity extends Activity implements InkMainView.Listener {
    private static final int REQUEST_DETAIL = 10;
    private static final int REQUEST_SETTINGS = 11;
    private static final String PREFS = "inkqueue";
    private static final String KEY_ALWAYS_ON = "always_on";

    private TaskRepository repository;
    private InkMainView mainView;
    private int currentPage = SectionedTaskList.PAGE_TODAY;
    private boolean shouldAutoNavToOverdue = true;
    private String pendingMessage;
    private AsyncTask<?, ?, ?> activeSyncTask;
    private SectionedTaskList lastGrouped;
    private PowerManager.WakeLock wakeLock;
    private boolean syncUiActive;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,
                             WindowManager.LayoutParams.FLAG_FULLSCREEN);
        repository = TaskRepository.getInstance(this);

        mainView = new InkMainView(this);
        mainView.setListener(this);
        setContentView(mainView);

        applyAlwaysOnMode();
        renderLocal();
        // (Re)arm the periodic background sync alarm from current prefs.
        // On Android 4.4 the alarm survives boot only if a BroadcastReceiver
        // catches BOOT_COMPLETED; we don't ship that yet — MainActivity launch
        // is the practical "the device woke up" hook, so re-arm here.
        SyncScheduler.reschedule(this);
        syncInBackground(false);
    }

    private void applyAlwaysOnMode() {
        boolean alwaysOn = getSharedPreferences(PREFS, 0).getBoolean(KEY_ALWAYS_ON, true);
        if (alwaysOn) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            try {
                WindowManager.LayoutParams lp = getWindow().getAttributes();
                lp.screenBrightness = 0.25f;
                getWindow().setAttributes(lp);
            } catch (Throwable t) { android.util.Log.w("InkQueue", "dim failed: " + t); }
            try {
                PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
                if (pm != null) {
                    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "InkQueue:desk");
                    wakeLock.setReferenceCounted(false);
                    wakeLock.acquire(60 * 60 * 1000L);
                }
            } catch (Throwable t) { android.util.Log.w("InkQueue", "wakeLock failed: " + t); }
            android.util.Log.i("InkQueue", "always-on mode on");
        } else {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            try {
                WindowManager.LayoutParams lp = getWindow().getAttributes();
                lp.screenBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE;
                getWindow().setAttributes(lp);
            } catch (Throwable t) {}
            if (wakeLock != null && wakeLock.isHeld()) { wakeLock.release(); wakeLock = null; }
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        applyAlwaysOnMode();
        if (repository != null) renderLocal();
    }

    @Override
    protected void onPause() {
        if (wakeLock != null && wakeLock.isHeld()) { wakeLock.release(); }
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        cancelAsyncWork();
        if (wakeLock != null && wakeLock.isHeld()) { wakeLock.release(); }
        super.onDestroy();
    }

    @Override public void onTabSelected(int page) {
        currentPage = page;
        renderLocal();
    }

    @Override public void onTaskClicked(String taskId) { openTask(taskId); }

    @Override public void onTaskLongPressed(String taskId) {
        if (currentPage == SectionedTaskList.PAGE_DONE) return; // archive: no postpone
        Task task = repository.getTaskById(taskId);
        if (task != null) showPostponeDialog(task);
    }

    @Override public void onTaskCompleteClicked(String taskId) {
        if (currentPage == SectionedTaskList.PAGE_DONE) {
            openTask(taskId); // archive page: tap box opens detail, no re-complete
            return;
        }
        completeTaskFromList(taskId);
    }

    @Override public void onBulkAction(int actionCode) { bulkPostponeOverdue(actionCode); }

    @Override public void onSyncClicked() { syncInBackground(true); }

    @Override public void onSettingsClicked() { openSettings(); }

    private void cancelAsyncWork() {
        if (activeSyncTask != null) {
            activeSyncTask.cancel(true);
            activeSyncTask = null;
        }
    }

    private boolean isActivityAlive() { return !isFinishing(); }

    private boolean isOnline() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        if (cm == null) return false;
        NetworkInfo info = cm.getActiveNetworkInfo();
        return info != null && info.isConnected();
    }

    private void renderLocal() {
        renderLocal(-1, null);
    }

    /**
     * @param partialFromRow if >=0, only dirty from that row band downward (e-ink).
     * @param flashTaskId optional task id to fill checkbox briefly before reflow.
     */
    private void renderLocal(int partialFromRow, String flashTaskId) {
        List<Task> tasks = repository.getAllOpenTasks();
        String today = DateUtils.today();
        List<Task> doneToday = repository.getCompletedToday(today);
        lastGrouped = SectionedTaskList.group(tasks, today, doneToday);

        if (shouldAutoNavToOverdue && !lastGrouped.overdue.isEmpty()) {
            currentPage = SectionedTaskList.PAGE_OVERDUE;
            shouldAutoNavToOverdue = false;
        }

        java.util.List<SectionedTaskList.Row> pageRows = lastGrouped.pageRows(currentPage, today);
        if (flashTaskId != null) {
            mainView.flashCheckboxFilled(flashTaskId);
        }
        if (partialFromRow >= 0) {
            mainView.setPagePartial(currentPage, pageRows, partialFromRow);
        } else {
            mainView.setPage(currentPage, pageRows);
        }

        int pendingN = repository.countPendingOperations();
        mainView.setPendingCount(pendingN);

        if (syncUiActive) {
            // Keep the in-flight phase string; do not clobber with last-sync.
            return;
        }

        if (pendingMessage != null) {
            mainView.setStatusText(pendingMessage);
            pendingMessage = null;
        } else {
            String last = DateUtils.displayLastSync(repository.getLastSyncTime());
            String err = repository.getLastSyncError();
            if (pendingN > 0) {
                if (last == null || last.length() == 0) {
                    last = "未同步";
                }
            } else if (err != null && err.length() > 0 && (last == null || last.length() == 0)) {
                last = err;
            }
            mainView.setStatusText(last);
        }
    }

    /** Index of task row in current page touch list, or -1. */
    private int findRowIndexForTask(String taskId) {
        if (taskId == null || lastGrouped == null) return -1;
        String today = DateUtils.today();
        java.util.List<SectionedTaskList.Row> pageRows = lastGrouped.pageRows(currentPage, today);
        int touch = 0;
        for (int i = 0; i < pageRows.size(); i++) {
            SectionedTaskList.Row r = pageRows.get(i);
            if (r.type == SectionedTaskList.Row.TYPE_TASK) {
                if (r.task != null && taskId.equals(r.task.id)) return touch;
                touch++;
            }
        }
        return -1;
    }

    private void syncInBackground(final boolean manual) {
        android.util.Log.i("InkQueueSync", "syncInBackground(manual=" + manual + ")");
        if (!isOnline()) {
            android.util.Log.w("InkQueueSync", "isOnline=false, skip");
            if (manual) {
                String msg = "离线模式，显示本地内容";
                mainView.setStatusText(msg);
                Toast.makeText(this, msg, Toast.LENGTH_SHORT).show();
            }
            renderLocal();
            return;
        }
        if (SyncService.isSyncInFlight() || activeSyncTask != null) {
            android.util.Log.i("InkQueueSync", "sync already running — skip new request");
            if (manual) {
                mainView.setStatusText("正在同步…");
                Toast.makeText(this, "正在同步…", Toast.LENGTH_SHORT).show();
            }
            return;
        }

        final SyncService svc = new SyncService(this);
        final int pendingBefore = repository.countPendingOperations();
        final String phase = pendingBefore > 0
                ? ("正在上传 " + pendingBefore + " 条…")
                : "正在拉取…";
        syncUiActive = true;
        mainView.setStatusText(phase);
        if (manual) {
            // toast only on manual to avoid noise on every open
        }

        activeSyncTask = new AsyncTask<Void, Void, SyncResult>() {
            @Override protected SyncResult doInBackground(Void... v) {
                android.util.Log.i("InkQueueSync", "doInBackground calling performSync()");
                SyncResult r = svc.performSync();
                android.util.Log.i("InkQueueSync", "performSync result: "
                        + (r == null ? "null" : ("success=" + r.success
                        + " msg=" + r.userMessage
                        + " accepted=" + r.opsAccepted
                        + " remaining=" + r.pendingRemaining)));
                return r;
            }
            @Override protected void onPostExecute(SyncResult result) {
                activeSyncTask = null;
                syncUiActive = false;
                if (!isActivityAlive() || isCancelled()) return;
                if (result != null && result.skippedBusy) {
                    // Another path finished first; just re-render.
                    renderLocal();
                    return;
                }
                renderLocal();
                if (result != null && result.userMessage != null) {
                    mainView.setStatusText(result.userMessage);
                    if (manual) {
                        Toast.makeText(MainActivity.this, result.userMessage, Toast.LENGTH_SHORT).show();
                    }
                }
                // H2 reverse-notify: if the server pushed notices addressed to
                // this device, surface them as a small stacked AlertDialog chain.
                // Each "知道了" tap fires dismissNotice() in the background; the
                // server then drops the notice from the next snapshot.
                if (result != null && result.success && result.notices != null && !result.notices.isEmpty()) {
                    showAgentNotices(result.notices, 0);
                }
            }
        }.execute();
    }

    /** H2: show notices one after another in a minimal AlertDialog. Tapping
     *  "知道了" pre-emptively removes the notice from the device's UI and
     *  POSTs /v1/notices/:id/dismiss so it stops relaying on future syncs. */
    private void showAgentNotices(final java.util.List<AgentNotice> notices, final int index) {
        if (index >= notices.size()) return;
        if (isFinishing()) return;
        final AgentNotice n = notices.get(index);
        String kind = n.kind;
        if (DateUtils.isEmpty(kind)) kind = "info";
        String titleTag;
        if ("warn".equals(kind))       titleTag = "提醒 · 警告";
        else if ("remind".equals(kind)) titleTag = "提醒 · 待办";
        else                            titleTag = "来自 Agent";

        StringBuilder body = new StringBuilder();
        body.append(n.title == null ? "" : n.title);
        if (!DateUtils.isEmpty(n.body)) {
            body.append("\n\n").append(n.body);
        }
        if (!DateUtils.isEmpty(n.createdAt)) {
            // createdAt is ISO8601 with TZ; trim to YYYY-MM-DD HH:MM for legibility.
            String shortTs = n.createdAt.length() >= 16 ? n.createdAt.substring(0, 16).replace('T', ' ') : n.createdAt;
            body.append("\n\n— ").append(shortTs);
        }

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle(titleTag)
                .setMessage(body.toString())
                .setPositiveButton("知道了", new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface d, int which) {
                        // Pre-emptive local "seen" — there is no local notice
                        // persistence; the dismiss simply tells the server.
                        final String deviceId = prefDeviceId();
                        final String noticeId = n.id;
                        new AsyncTask<Void, Void, Void>() {
                            @Override protected Void doInBackground(Void... v) {
                                try {
                                    SyncClient client = new SyncClient(prefBaseUrl(), prefToken());
                                    client.dismissNotice(noticeId, deviceId);
                                } catch (Exception e) {
                                    android.util.Log.w("InkQueueNotice", "dismiss failed: " + e);
                                }
                                return null;
                            }
                        }.execute();
                        // Chain to next notice if any.
                        showAgentNotices(notices, index + 1);
                    }
                })
                .setCancelable(false)
                .create();
        dialog.show();
    }

    /** H2: pull base_url + token + device_id from the same prefs SettingsActivity uses.
     *  Renamed to avoid colliding with Context.getDeviceId() on recent SDKs. */
    private String prefBaseUrl() {
        return getSharedPreferences("inkqueue", MODE_PRIVATE)
                .getString("base_url", "http://192.168.1.100:8787");
    }
    private String prefToken() {
        return getSharedPreferences("inkqueue", MODE_PRIVATE)
                .getString("token", "dev-token");
    }
    private String prefDeviceId() {
        return getSharedPreferences("inkqueue", MODE_PRIVATE)
                .getString("device_id", "kindle-pw3");
    }

    private void completeTaskFromList(String taskId) {
        try {
            Task task = repository.getTaskById(taskId);
            if (task == null) return;
            int rowIdx = findRowIndexForTask(taskId);
            // Flash filled box while the row is still on screen (e-ink partial).
            if (rowIdx >= 0) mainView.flashCheckboxFilled(taskId);
            String now = DateUtils.isoNow();
            new OperationQueue(repository).complete(task, now);
            // Reflow from that row downward — avoid full-screen invalidate.
            renderLocal(rowIdx >= 0 ? rowIdx : 0, null);
            Toast.makeText(this, isOnline() ? "已完成" : "已完成。已保存，联网后同步", Toast.LENGTH_SHORT).show();
            syncInBackground(false);
        } catch (Exception e) {
            Toast.makeText(this, "操作失败", Toast.LENGTH_SHORT).show();
        }
    }

    private void bulkPostponeOverdue(int actionCode) {
        if (lastGrouped == null || lastGrouped.overdue.isEmpty()) return;
        String today = DateUtils.today();
        String targetDate, target, label;
        if (actionCode == SectionedTaskList.ACTION_POSTPONE_TO_TODAY) {
            targetDate = today; target = "today";
            label = "已将 " + lastGrouped.overdue.size() + " 个过期任务推迟到今天";
        } else if (actionCode == SectionedTaskList.ACTION_POSTPONE_TO_TOMORROW) {
            targetDate = DateUtils.postponeToTomorrow(today); target = "tomorrow";
            label = "已将 " + lastGrouped.overdue.size() + " 个过期任务推迟到明天";
        } else { return; }
        try {
            OperationQueue queue = new OperationQueue(repository);
            for (Task task : lastGrouped.overdue) queue.postpone(task, targetDate, target);
            renderLocal();
            Toast.makeText(this, isOnline() ? label : label + "。已保存，联网后同步", Toast.LENGTH_SHORT).show();
            syncInBackground(false);
        } catch (Exception e) {
            Toast.makeText(this, "操作失败", Toast.LENGTH_SHORT).show();
        }
    }

    private void postponeTaskFromList(String taskId, int target) {
        try {
            Task task = repository.getTaskById(taskId);
            if (task == null) return;
            String today = DateUtils.today();
            String newDate, label;
            switch (target) {
                case 0: newDate = DateUtils.postponeToTomorrow(today); label = "已推迟到明天"; break;
                case 1: newDate = DateUtils.postponeToWeekend(today);  label = "已推迟到周末"; break;
                case 2: newDate = DateUtils.postponeToNextWeek(today);  label = "已推迟到下周"; break;
                default: return;
            }
            String[] targets = {"tomorrow", "weekend", "next_week"};
            int rowIdx = findRowIndexForTask(taskId);
            new OperationQueue(repository).postpone(task, newDate, targets[target]);
            renderLocal(rowIdx >= 0 ? rowIdx : 0, null);
            Toast.makeText(this, isOnline() ? label : label + "。已保存，联网后同步", Toast.LENGTH_SHORT).show();
            syncInBackground(false);
        } catch (Exception e) {
            Toast.makeText(this, "操作失败", Toast.LENGTH_SHORT).show();
        }
    }

    private void showPostponeDialog(final Task task) {
        CharSequence[] items = {"推迟到明天", "推迟到周末", "推迟到下周"};
        AlertDialog.Builder builder = new AlertDialog.Builder(this);
        builder.setTitle(task.title);
        builder.setItems(items, new DialogInterface.OnClickListener() {
            @Override public void onClick(DialogInterface dialog, int which) { postponeTaskFromList(task.id, which); }
        });
        builder.setNegativeButton("取消", null);
        builder.create().show();
    }

    private void openTask(String taskId) {
        Intent intent = new Intent(this, TaskDetailActivity.class);
        intent.putExtra(TaskDetailActivity.EXTRA_TASK_ID, taskId);
        startActivityForResult(intent, REQUEST_DETAIL);
        overridePendingTransition(0, 0);
    }

    private void openSettings() {
        startActivityForResult(new Intent(this, SettingsActivity.class), REQUEST_SETTINGS);
        overridePendingTransition(0, 0);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (data != null) pendingMessage = data.getStringExtra("message");
        // Settings changed → force a fresh sync with new base URL / auth.
        if (requestCode == REQUEST_SETTINGS && resultCode == RESULT_OK) {
            syncInBackground(false);
        }
        renderLocal();
    }
}

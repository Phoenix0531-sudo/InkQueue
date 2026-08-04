package dev.inkqueue;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.os.AsyncTask;
import android.os.Bundle;
import android.view.Window;
import android.view.WindowManager;
import android.widget.Toast;
import dev.inkqueue.data.OperationQueue;
import dev.inkqueue.data.Task;
import dev.inkqueue.data.TaskRepository;
import dev.inkqueue.sync.SyncService;
import dev.inkqueue.ui.InkDetailView;
import dev.inkqueue.util.DateUtils;

/**
 * Task detail — single Canvas page via InkDetailView.
 * v0.8.2: shared TaskRepository singleton.
 */
public class TaskDetailActivity extends Activity implements InkDetailView.Listener {
    public static final String EXTRA_TASK_ID = "task_id";
    private TaskRepository repository;
    private Task task;
    private InkDetailView detailView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,
                             WindowManager.LayoutParams.FLAG_FULLSCREEN);
        repository = TaskRepository.getInstance(this);
        task = repository.getTaskById(getIntent().getStringExtra(EXTRA_TASK_ID));
        if (task == null) { finishWithMessage("找不到任务"); return; }

        detailView = new InkDetailView(this);
        detailView.setListener(this);
        detailView.setData(
                task.title,
                task.note,
                DateUtils.displayDue(task, DateUtils.today()),
                task.project,
                task.isHighPriority() ? "高" : "普通",
                "Agent " + DateUtils.displayShortUpdated(task.updatedAt)
        );
        setContentView(detailView);
    }

    @Override
    public void onAction(int code) {
        switch (code) {
            case 0: completeTask(); break;
            case 1: postpone("tomorrow"); break;
            case 2: postpone("weekend"); break;
            case 3: postpone("next_week"); break;
            case 4: finishWithMessage(null); break;
        }
    }

    private void completeTask() {
        try {
            String now = DateUtils.isoNow();
            new OperationQueue(repository).complete(task, now);
            triggerSync();
            finishWithMessage(isOffline() ? "已完成，联网后同步" : "已完成");
        } catch (Exception e) {
            Toast.makeText(this, "操作失败", Toast.LENGTH_SHORT).show();
        }
    }

    private void postpone(String target) {
        try {
            String today = DateUtils.today();
            String date, msg;
            if ("tomorrow".equals(target)) { date = DateUtils.postponeToTomorrow(today); msg = "已推迟到明天"; }
            else if ("weekend".equals(target)) { date = DateUtils.postponeToWeekend(today); msg = "已推迟到周末"; }
            else { date = DateUtils.postponeToNextWeek(today); msg = "已推迟到下周"; }
            new OperationQueue(repository).postpone(task, date, target);
            triggerSync();
            // v0.8.1 — preserve the postpone target in the offline toast.
            finishWithMessage(isOffline() ? msg + "，联网后同步" : msg);
        } catch (Exception e) {
            Toast.makeText(this, "操作失败", Toast.LENGTH_SHORT).show();
        }
    }

    private void triggerSync() {
        if (isOffline()) return;
        final Context app = getApplicationContext();
        new AsyncTask<Void, Void, Void>() {
            @Override protected Void doInBackground(Void... v) {
                new SyncService(app).performSync();
                return null;
            }
        }.execute();
    }

    private boolean isOffline() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        if (cm == null) return false;
        NetworkInfo info = cm.getActiveNetworkInfo();
        return info == null || !info.isConnected();
    }

    private void finishWithMessage(String msg) {
        if (msg != null) {
            Intent d = new Intent();
            d.putExtra("message", msg);
            setResult(RESULT_OK, d);
        }
        finish();
        overridePendingTransition(0, 0);
    }
}

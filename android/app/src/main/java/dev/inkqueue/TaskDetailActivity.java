package dev.inkqueue;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.os.AsyncTask;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import dev.inkqueue.data.OperationQueue;
import dev.inkqueue.data.Task;
import dev.inkqueue.data.TaskRepository;
import dev.inkqueue.sync.SyncService;
import dev.inkqueue.util.DateUtils;

public class TaskDetailActivity extends Activity {
    public static final String EXTRA_TASK_ID = "task_id";
    private TaskRepository repository;
    private Task task;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN);
        repository = new TaskRepository(this);
        task = repository.getTaskById(getIntent().getStringExtra(EXTRA_TASK_ID));
        if (task == null) {
            finishWithMessage("任务不存在");
            return;
        }
        setContentView(buildLayout());
    }

    private View buildLayout() {
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(Color.WHITE);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(18), dp(14), dp(18), dp(18));
        scroll.addView(root);

        TextView pageTitle = text("任务详情", 22, Color.BLACK, true);
        root.addView(pageTitle);
        addSpace(root, 20);
        root.addView(text(task.title, 21, Color.BLACK, true));
        if (!DateUtils.isEmpty(task.note)) {
            TextView note = text(task.note, 16, Color.BLACK, false);
            note.setPadding(0, dp(14), 0, dp(14));
            note.setLineSpacing(0, 1.18f);
            root.addView(note);
        } else {
            addSpace(root, 12);
        }
        root.addView(meta("时间", DateUtils.displayDue(task, DateUtils.today())));
        root.addView(meta("项目", task.project));
        root.addView(meta("优先级", task.isHighPriority() ? "高" : "普通"));
        addSection(root, "操作");
        root.addView(action("完成", new View.OnClickListener() { @Override public void onClick(View v) { completeTask(); }}));
        root.addView(action("推迟到明天", new View.OnClickListener() { @Override public void onClick(View v) { postpone("tomorrow"); }}));
        root.addView(action("推迟到周末", new View.OnClickListener() { @Override public void onClick(View v) { postpone("weekend"); }}));
        root.addView(action("推迟到下周", new View.OnClickListener() { @Override public void onClick(View v) { postpone("next_week"); }}));
        root.addView(action("返回", new View.OnClickListener() { @Override public void onClick(View v) { finishWithMessage(null); }}));
        return scroll;
    }

    private void completeTask() {
        try {
            String now = DateUtils.isoNow();
            new OperationQueue(repository).complete(task, now);
            triggerSync();
            finishWithMessage(isOffline() ? "已保存，联网后同步" : "已完成");
        } catch (Exception e) {
            Toast.makeText(this, "操作失败", Toast.LENGTH_SHORT).show();
        }
    }

    private void postpone(String target) {
        try {
            String today = DateUtils.today();
            String date;
            String message;
            if ("tomorrow".equals(target)) {
                date = DateUtils.postponeToTomorrow(today);
                message = "已推迟到明天";
            } else if ("weekend".equals(target)) {
                date = DateUtils.postponeToWeekend(today);
                message = "已推迟到周末";
            } else {
                date = DateUtils.postponeToNextWeek(today);
                message = "已推迟到下周";
            }
            new OperationQueue(repository).postpone(task, date, target);
            triggerSync();
            finishWithMessage(isOffline() ? "已保存，联网后同步" : message);
        } catch (Exception e) {
            Toast.makeText(this, "操作失败", Toast.LENGTH_SHORT).show();
        }
    }

    private void triggerSync() {
        final Context app = getApplicationContext();
        new AsyncTask<Void, Void, Void>() {
            @Override protected Void doInBackground(Void... params) {
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

    private void finishWithMessage(String message) {
        if (message != null) {
            Intent data = new Intent();
            data.putExtra("message", message);
            setResult(RESULT_OK, data);
        }
        finish();
        overridePendingTransition(0, 0);
    }

    private TextView meta(String key, String value) {
        TextView view = text(key + "：" + (DateUtils.isEmpty(value) ? "无" : value), 16, Color.BLACK, false);
        view.setPadding(0, dp(4), 0, dp(4));
        return view;
    }

    private void addSection(LinearLayout root, String title) {
        addSpace(root, 18);
        View line = new View(this);
        line.setBackgroundColor(Color.BLACK);
        root.addView(line, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(1)));
        TextView section = text(title, 18, Color.BLACK, true);
        section.setPadding(0, dp(10), 0, dp(8));
        root.addView(section);
    }

    private TextView action(String label, View.OnClickListener listener) {
        TextView view = text(label, 18, Color.BLACK, false);
        view.setGravity(Gravity.CENTER_VERTICAL);
        view.setMinHeight(dp(56));
        view.setOnClickListener(listener);
        return view;
    }

    private TextView text(String value, int sp, int color, boolean bold) {
        TextView text = new TextView(this);
        text.setText(value == null ? "" : value);
        text.setTextSize(sp);
        text.setTextColor(color);
        if (bold) text.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        return text;
    }

    private void addSpace(LinearLayout root, int dp) {
        TextView space = new TextView(this);
        root.addView(space, new LinearLayout.LayoutParams(1, dp(dp)));
    }

    private int dp(int value) {
        return (int) (value * getResources().getDisplayMetrics().density + 0.5f);
    }
}

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
import android.view.ViewGroup;
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
    private final int bg = 0xff000000;
    private final int fg = 0xffffffff;
    private final int dim = 0xffcccccc;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN);
        repository = new TaskRepository(this);
        task = repository.getTaskById(getIntent().getStringExtra(EXTRA_TASK_ID));
        if (task == null) { finishWithMessage("not found"); return; }
        setContentView(buildLayout());
    }

    private View buildLayout() {
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(bg);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(bg);
        root.setPadding(dp(16), dp(12), dp(16), dp(14));
        scroll.addView(root);

        LinearLayout top = new LinearLayout(this);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { finishWithMessage(null); } });
        TextView backLink = new TextView(this);
        backLink.setText("< TODOLIST");
        backLink.setTextColor(dim);
        backLink.setTextSize(11);
        top.addView(backLink);
        root.addView(top);
        addSpace(root, 14);

        TextView taskTitle = new TextView(this);
        taskTitle.setText(task.title == null ? "" : task.title);
        taskTitle.setTextColor(fg);
        taskTitle.setTextSize(18);
        root.addView(taskTitle);
        addSpace(root, 10);

        if (!DateUtils.isEmpty(task.note)) {
            TextView note = new TextView(this);
            note.setText(task.note);
            note.setTextColor(dim);
            note.setTextSize(14);
            note.setLineSpacing(0, 1.2f);
            root.addView(note);
            addSpace(root, 10);
        }

        View mr1 = new View(this); mr1.setBackgroundColor(0xff555555);
        root.addView(mr1, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)));
        root.addView(metaLine("due", DateUtils.displayDue(task, DateUtils.today())));
        root.addView(metaLine("priority", task.isHighPriority() ? "HIGH" : "normal"));
        View mr2 = new View(this); mr2.setBackgroundColor(0xff555555);
        root.addView(mr2, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)));
        addSpace(root, 14);

        View ar1 = new View(this); ar1.setBackgroundColor(0xff555555);
        root.addView(ar1, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)));
        TextView ah = new TextView(this);
        ah.setText("[ actions ]");
        ah.setTextColor(dim);
        ah.setTextSize(11);
        ah.setGravity(Gravity.CENTER);
        ah.setPadding(0, dp(6), 0, dp(6));
        root.addView(ah);
        View ar2 = new View(this); ar2.setBackgroundColor(0xff555555);
        root.addView(ar2, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)));

        root.addView(actionItem("  [x] complete", new View.OnClickListener() { @Override public void onClick(View v) { completeTask(); } }));
        root.addView(actionItem("  [>] tomorrow", new View.OnClickListener() { @Override public void onClick(View v) { postpone("tomorrow"); } }));
        root.addView(actionItem("  [>] weekend", new View.OnClickListener() { @Override public void onClick(View v) { postpone("weekend"); } }));
        root.addView(actionItem("  [>] next week", new View.OnClickListener() { @Override public void onClick(View v) { postpone("next_week"); } }));
        View ar3 = new View(this); ar3.setBackgroundColor(0xff555555);
        root.addView(ar3, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)));

        addSpace(root, 10);
        TextView backBtn = new TextView(this);
        backBtn.setText("< back");
        backBtn.setTextColor(dim);
        backBtn.setTextSize(13);
        backBtn.setGravity(Gravity.CENTER);
        backBtn.setMinHeight(dp(44));
        backBtn.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { finishWithMessage(null); } });
        root.addView(backBtn);

        return scroll;
    }

    private void completeTask() {
        try {
            String now = DateUtils.isoNow();
            new OperationQueue(repository).complete(task, now);
            triggerSync();
            finishWithMessage(isOffline() ? "saved. will sync when online." : "> done");
        } catch (Exception e) {
            Toast.makeText(this, "failed", Toast.LENGTH_SHORT).show();
        }
    }

    private void postpone(String target) {
        try {
            String today = DateUtils.today();
            String date, msg;
            if ("tomorrow".equals(target)) { date = DateUtils.postponeToTomorrow(today); msg = "> postponed to tomorrow"; }
            else if ("weekend".equals(target)) { date = DateUtils.postponeToWeekend(today); msg = "> postponed to weekend"; }
            else { date = DateUtils.postponeToNextWeek(today); msg = "> postponed to next week"; }
            new OperationQueue(repository).postpone(task, date, target);
            triggerSync();
            finishWithMessage(isOffline() ? "saved. will sync when online." : msg);
        } catch (Exception e) {
            Toast.makeText(this, "failed", Toast.LENGTH_SHORT).show();
        }
    }

    private void triggerSync() {
        final Context app = getApplicationContext();
        new AsyncTask<Void,Void,Void>() {
            protected Void doInBackground(Void...v) { new SyncService(app).performSync(); return null; }
        }.execute();
    }

    private boolean isOffline() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        if (cm == null) return false;
        NetworkInfo info = cm.getActiveNetworkInfo();
        return info == null || !info.isConnected();
    }

    private void finishWithMessage(String msg) {
        if (msg != null) { Intent d = new Intent(); d.putExtra("message", msg); setResult(RESULT_OK, d); }
        finish(); overridePendingTransition(0, 0);
    }

    private View metaLine(String key, String value) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setPadding(0, dp(6), 0, dp(6));
        TextView k = new TextView(this); k.setText(key); k.setTextColor(dim); k.setTextSize(12);
        k.setLayoutParams(new LinearLayout.LayoutParams(dp(54), ViewGroup.LayoutParams.WRAP_CONTENT));
        row.addView(k);
        TextView v = new TextView(this); v.setText(DateUtils.isEmpty(value) ? "-" : value); v.setTextColor(fg); v.setTextSize(12);
        row.addView(v);
        return row;
    }

    private View actionItem(String label, View.OnClickListener listener) {
        TextView v = new TextView(this); v.setText(label); v.setTextColor(fg); v.setTextSize(13);
        v.setGravity(Gravity.CENTER_VERTICAL); v.setMinHeight(dp(46)); v.setOnClickListener(listener);
        return v;
    }

    private void addSpace(LinearLayout root, int d) { View v = new View(this); root.addView(v, new LinearLayout.LayoutParams(1, dp(d))); }
    private int dp(int v) { return (int)(v * getResources().getDisplayMetrics().density + 0.5f); }
}

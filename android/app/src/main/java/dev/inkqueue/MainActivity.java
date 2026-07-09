package dev.inkqueue;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.AsyncTask;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.AdapterView;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.TextView;
import android.widget.Toast;
import dev.inkqueue.data.Task;
import dev.inkqueue.data.TaskRepository;
import dev.inkqueue.sync.SyncResult;
import dev.inkqueue.sync.SyncService;
import dev.inkqueue.ui.SectionedTaskList;
import dev.inkqueue.ui.TaskAdapter;
import dev.inkqueue.util.DateUtils;
import java.util.List;

public class MainActivity extends Activity {
    private static final int REQUEST_DETAIL = 10;
    private static final int REQUEST_SETTINGS = 11;
    private TaskRepository repository;
    private TaskAdapter adapter;
    private TextView statusText;
    private String pendingMessage;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN);
        repository = new TaskRepository(this);
        setContentView(buildLayout());
        renderLocal();
        syncInBackground(false);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (repository != null) renderLocal();
    }

    private View buildLayout() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.VERTICAL);
        header.setPadding(dp(18), dp(12), dp(18), dp(8));
        TextView title = new TextView(this);
        title.setText("任务");
        title.setTextColor(Color.BLACK);
        title.setTextSize(22);
        title.setOnLongClickListener(new View.OnLongClickListener() {
            @Override public boolean onLongClick(View v) { openSettings(); return true; }
        });
        header.addView(title);
        statusText = new TextView(this);
        statusText.setTextColor(0xff333333);
        statusText.setTextSize(13);
        statusText.setPadding(0, dp(4), 0, 0);
        header.addView(statusText);
        root.addView(header);

        adapter = new TaskAdapter(this);
        ListView list = new ListView(this);
        list.setAdapter(adapter);
        list.setCacheColorHint(Color.TRANSPARENT);
        list.setDivider(new ColorDrawable(Color.BLACK));
        list.setDividerHeight(1);
        list.setSelector(new ColorDrawable(0x11000000));
        list.setOnItemClickListener(new AdapterView.OnItemClickListener() {
            @Override public void onItemClick(AdapterView<?> parent, View view, int position, long id) {
                SectionedTaskList.Row row = adapter.getItem(position);
                if (row.task != null) openTask(row.task.id);
            }
        });
        root.addView(list, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        root.addView(actionRow("同步", new View.OnClickListener() {
            @Override public void onClick(View v) { syncInBackground(true); }
        }));
        root.addView(actionRow("设置", new View.OnClickListener() {
            @Override public void onClick(View v) { openSettings(); }
        }));
        return root;
    }

    private TextView actionRow(String text, View.OnClickListener listener) {
        TextView row = new TextView(this);
        row.setText(text);
        row.setTextColor(Color.BLACK);
        row.setTextSize(18);
        row.setGravity(android.view.Gravity.CENTER_VERTICAL);
        row.setPadding(dp(18), 0, dp(18), 0);
        row.setMinHeight(dp(56));
        row.setBackgroundColor(Color.WHITE);
        row.setOnClickListener(listener);
        return row;
    }

    private void renderLocal() {
        List<Task> tasks = repository.getAllOpenTasks();
        String today = DateUtils.today();
        adapter.setRows(SectionedTaskList.group(tasks, today).toRows(today));
        if (pendingMessage != null) {
            statusText.setText(pendingMessage);
            pendingMessage = null;
        } else {
            statusText.setText(DateUtils.displayLastSync(repository.getLastSyncTime()));
        }
    }

    private void syncInBackground(final boolean manual) {
        if (manual) statusText.setText("正在同步…");
        new AsyncTask<Void, Void, SyncResult>() {
            @Override protected SyncResult doInBackground(Void... params) {
                return new SyncService(MainActivity.this).performSync();
            }
            @Override protected void onPostExecute(SyncResult result) {
                if (result.success) {
                    renderLocal();
                    statusText.setText(result.userMessage);
                    if (manual) Toast.makeText(MainActivity.this, result.userMessage, Toast.LENGTH_SHORT).show();
                } else {
                    renderLocal();
                    statusText.setText(result.userMessage);
                    if (manual) Toast.makeText(MainActivity.this, result.userMessage, Toast.LENGTH_SHORT).show();
                }
            }
        }.execute();
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
        if (data != null) {
            pendingMessage = data.getStringExtra("message");
        }
        renderLocal();
    }

    private int dp(int value) {
        return (int) (value * getResources().getDisplayMetrics().density + 0.5f);
    }
}

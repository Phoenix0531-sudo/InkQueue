package dev.inkqueue;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.os.AsyncTask;
import android.os.Bundle;
import android.view.Gravity;
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
import dev.inkqueue.data.UsageProvider;
import dev.inkqueue.sync.SyncResult;
import dev.inkqueue.sync.SyncService;
import dev.inkqueue.sync.ServerDiscovery;
import dev.inkqueue.ui.SectionedTaskList;
import dev.inkqueue.ui.TaskAdapter;
import dev.inkqueue.util.DateUtils;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {
    private static final int REQUEST_DETAIL = 10;
    private static final int REQUEST_SETTINGS = 11;
    private TaskRepository repository;
    private TaskAdapter adapter;
    private TextView statusText;
    private String pendingMessage;
    private ServerDiscovery discovery;
    private LinearLayout usageView;

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

    @Override
    protected void onDestroy() {
        if (discovery != null) discovery.stop();
        super.onDestroy();
    }

    private boolean isOnline() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        if (cm == null) return false;
        NetworkInfo info = cm.getActiveNetworkInfo();
        return info != null && info.isConnected();
    }

    private View buildLayout() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.BLACK);
        root.setPadding(dp(16), dp(14), dp(16), dp(8));

        TextView title = new TextView(this);
        title.setText("TODOLIST");
        title.setTextColor(Color.WHITE);
        title.setTextSize(28);
        title.setOnLongClickListener(new View.OnLongClickListener() {
            @Override public boolean onLongClick(View v) { openSettings(); return true; }
        });
        root.addView(title);

        View sep = new View(this);
        sep.setBackgroundColor(0xff555555);
        root.addView(sep, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)));
        addSpace(root, 4);

        statusText = new TextView(this);
        statusText.setTextColor(0xffcccccc);
        statusText.setTextSize(10);
        root.addView(statusText);
        addSpace(root, 4);

        // Usage dashboard
        usageView = new LinearLayout(this);
        usageView.setOrientation(LinearLayout.VERTICAL);
        usageView.setBackgroundColor(Color.BLACK);
        root.addView(usageView);

        adapter = new TaskAdapter(this);
        ListView list = new ListView(this);
        list.setAdapter(adapter);
        list.setCacheColorHint(Color.TRANSPARENT);
        list.setDivider(new ColorDrawable(0));
        list.setDividerHeight(0);
        list.setSelector(new ColorDrawable(0x44ffffff));
        list.setBackgroundColor(Color.BLACK);
        list.setOnItemClickListener(new AdapterView.OnItemClickListener() {
            @Override public void onItemClick(AdapterView<?> parent, View view, int position, long id) {
                SectionedTaskList.Row row = adapter.getItem(position);
                if (row.task != null) openTask(row.task.id);
            }
        });
        root.addView(list, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        View footerLine = new View(this);
        footerLine.setBackgroundColor(0xff555555);
        root.addView(footerLine, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)));
        LinearLayout footer = new LinearLayout(this);
        footer.setOrientation(LinearLayout.HORIZONTAL);
        footer.setBackgroundColor(Color.BLACK);
        footer.addView(footerAction("SYNC", new View.OnClickListener() {
            @Override public void onClick(View v) { syncInBackground(true); }
        }));
        View fd = new View(this);
        fd.setBackgroundColor(0xff555555);
        footer.addView(fd, new LinearLayout.LayoutParams(dp(1), dp(34)));
        footer.addView(footerAction("SETTINGS", new View.OnClickListener() {
            @Override public void onClick(View v) { openSettings(); }
        }));
        root.addView(footer);
        return root;
    }

    private TextView footerAction(String text, View.OnClickListener listener) {
        TextView row = new TextView(this);
        row.setText(text);
        row.setTextColor(Color.WHITE);
        row.setTextSize(13);
        row.setGravity(Gravity.CENTER);
        row.setLayoutParams(new LinearLayout.LayoutParams(0, dp(44), 1));
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

    private void renderUsage(final List<UsageProvider> providers) {
        usageView.removeAllViews();
        if (providers == null || providers.isEmpty()) return;
        for (final UsageProvider p : providers) {
            // Provider name
            TextView name = new TextView(this);
            name.setText(p.getDisplayName());
            name.setTextColor(Color.WHITE);
            name.setTextSize(11);
            name.setTypeface(android.graphics.Typeface.MONOSPACE);
            usageView.addView(name);

            if (p.getStatusText() != null) {
                // Error state
                TextView err = new TextView(this);
                err.setText(p.getStatusText());
                err.setTextColor(0xff888888);
                err.setTextSize(10);
                err.setTypeface(android.graphics.Typeface.MONOSPACE);
                usageView.addView(err);
            } else {
                // Usage bar: 5-hour
                usageView.addView(barRow("  " + p.label5h, p.usagePercent5h));
                // Usage bar: weekly
                usageView.addView(barRow("  " + p.labelWeek, p.usagePercentWeek));
                // Usage bar: monthly
                usageView.addView(barRow("  " + p.labelMonth, p.usagePercentMonth));
                // Total cost line
                if (p.totalCost > 0 || p.lastSession != null) {
                    StringBuilder totalLine = new StringBuilder();
                    if (p.totalCost > 0) totalLine.append("  $" + String.format("%.2f", p.totalCost) + " total");
                    if (p.lastSession != null) {
                        String shortDate = p.lastSession.length() >= 10 ? p.lastSession.substring(0, 10) : p.lastSession;
                        totalLine.append(" · last " + shortDate);
                    }
                    TextView totalTv = new TextView(this);
                    totalTv.setText(totalLine.toString());
                    totalTv.setTextColor(0xff888888);
                    totalTv.setTextSize(9);
                    totalTv.setTypeface(android.graphics.Typeface.MONOSPACE);
                    totalTv.setPadding(dp(4), dp(1), dp(4), dp(3));
                    usageView.addView(totalTv);
                }
            }
        }
        View bottomLine = new View(this);
        bottomLine.setBackgroundColor(0xff555555);
        usageView.addView(bottomLine, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)));
        addSpace(usageView, 4);
    }

    private View barRow(String label, int percent) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setPadding(dp(4), dp(1), dp(4), dp(1));
        // Label
        TextView lbl = new TextView(this);
        lbl.setText(label);
        lbl.setTextColor(0xffaaaaaa);
        lbl.setTextSize(9);
        lbl.setTypeface(android.graphics.Typeface.MONOSPACE);
        lbl.setLayoutParams(new LinearLayout.LayoutParams(dp(64), ViewGroup.LayoutParams.WRAP_CONTENT));
        row.addView(lbl);
        // Bar background (filled)
        View filled = new View(this);
        int fillWidth = Math.max(percent * dp(2), dp(1));
        if (fillWidth > dp(80)) fillWidth = dp(80);
        filled.setLayoutParams(new LinearLayout.LayoutParams(fillWidth, dp(8)));
        filled.setBackgroundColor(percent > 70 ? 0xffcc6666 : 0xff888888);
        row.addView(filled);
        // Remaining (unfilled)
        int remainWidth = dp(80) - fillWidth;
        if (remainWidth > 0) {
            View empty = new View(this);
            empty.setLayoutParams(new LinearLayout.LayoutParams(remainWidth, dp(8)));
            empty.setBackgroundColor(0xff333333);
            row.addView(empty);
        }
        // Percentage text
        TextView pct = new TextView(this);
        pct.setText(" " + percent + "%");
        pct.setTextColor(0xffaaaaaa);
        pct.setTextSize(9);
        pct.setTypeface(android.graphics.Typeface.MONOSPACE);
        row.addView(pct);
        return row;
    }

    private void syncInBackground(final boolean manual) {
        if (!manual) {
            if (!isOnline()) return;
        }
        final SyncService svc = new SyncService(this);
        if (!manual && svc.getBaseUrl().length() == 0) {
            statusText.setText("> discovering server...");
            startDiscovery();
            return;
        }
        if (manual) statusText.setText("> syncing...");
        new AsyncTask<Void, Void, SyncResult>() {
            @Override protected SyncResult doInBackground(Void... v) {
                return svc.performSync();
            }
            @Override protected void onPostExecute(SyncResult result) {
                renderLocal();
                new AsyncTask<Void,Void,List<UsageProvider>>() {
                    protected List<UsageProvider> doInBackground(Void...x) { return svc.fetchUsage(); }
                    protected void onPostExecute(List<UsageProvider> u) { renderUsage(u); }
                }.execute();
                if (!result.success && manual && result.userMessage != null
                        && result.userMessage.contains("no server configured")) {
                    statusText.setText("> discovering server...");
                    startDiscovery();
                    return;
                }
                if (result.userMessage != null) {
                    statusText.setText(result.userMessage);
                    if (manual) Toast.makeText(MainActivity.this, result.userMessage, Toast.LENGTH_SHORT).show();
                }
            }
        }.execute();
    }

    private void startDiscovery() {
        if (discovery != null && discovery.isRunning()) return;
        discovery = new ServerDiscovery(new ServerDiscovery.DiscoveryCallback() {
            @Override public void onServerFound(final String host, final int port) {
                runOnUiThread(new Runnable() {
                    @Override public void run() {
                        final SyncService svc = new SyncService(MainActivity.this);
                        svc.updateBaseUrl(host, port);
                        statusText.setText("> discovered " + host + ":" + port);
                        new AsyncTask<Void,Void,SyncResult>() {
                            protected SyncResult doInBackground(Void...v) { return svc.performSync(); }
                            protected void onPostExecute(SyncResult r) {
                                renderLocal();
                                if (r.userMessage != null) statusText.setText(r.userMessage);
                                new AsyncTask<Void,Void,List<UsageProvider>>() {
                                    protected List<UsageProvider> doInBackground(Void...x) { return svc.fetchUsage(); }
                                    protected void onPostExecute(List<UsageProvider> u) { renderUsage(u); }
                                }.execute();
                            }
                        }.execute();
                    }
                });
            }
            @Override public void onDiscoveryFailed(final String reason) {
                runOnUiThread(new Runnable() {
                    @Override public void run() { statusText.setText("> discovery: " + reason); }
                });
            }
        });
        discovery.start();
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
        renderLocal();
    }

    private void addSpace(LinearLayout root, int dp) {
        View space = new View(this);
        root.addView(space, new LinearLayout.LayoutParams(1, dp(dp)));
    }

    private int dp(int value) {
        return (int) (value * getResources().getDisplayMetrics().density + 0.5f);
    }
}

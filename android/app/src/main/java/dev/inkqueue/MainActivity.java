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
    private AsyncTask<?, ?, ?> activeSyncTask;
    private AsyncTask<?, ?, ?> activeUsageTask;

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
        cancelAsyncWork();
        if (discovery != null) {
            discovery.stop();
            discovery = null;
        }
        super.onDestroy();
    }

    private void cancelAsyncWork() {
        if (activeSyncTask != null) {
            activeSyncTask.cancel(true);
            activeSyncTask = null;
        }
        if (activeUsageTask != null) {
            activeUsageTask.cancel(true);
            activeUsageTask = null;
        }
    }

    private boolean isActivityAlive() {
        return !isFinishing();
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
        if (!isActivityAlive() || usageView == null) return;
        usageView.removeAllViews();
        if (providers == null || providers.isEmpty()) return;

        UsageProvider cpa = null;
        for (int i = 0; i < providers.size(); i++) {
            UsageProvider p = providers.get(i);
            if (p.isPool || "cliproxyapi".equals(p.provider)) {
                cpa = p;
                break;
            }
        }
        if (cpa == null) return;

        // Card shell
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(10), dp(8), dp(10), dp(8));
        card.setBackgroundColor(Color.BLACK);
        // Outer border via nested frames: top/bottom lines only to keep e-ink clean.

        // Header row: title + status badge
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);

        TextView title = new TextView(this);
        title.setText("CPA");
        title.setTextColor(Color.WHITE);
        title.setTextSize(14);
        title.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        title.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        header.addView(title);

        TextView badge = new TextView(this);
        boolean ok = cpa.getStatusText() == null && cpa.error == null;
        badge.setText(ok ? " 正常 " : " 异常 ");
        badge.setTextColor(ok ? Color.BLACK : Color.WHITE);
        badge.setBackgroundColor(ok ? Color.WHITE : 0xff888888);
        badge.setTextSize(11);
        badge.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        badge.setPadding(dp(6), dp(2), dp(6), dp(2));
        header.addView(badge);
        card.addView(header);

        TextView sub = new TextView(this);
        if (cpa.latencyMs > 0) {
            sub.setText("延迟 " + formatLatency(cpa.latencyMs) + " · 模型 " + cpa.modelCount);
        } else {
            sub.setText("模型 " + cpa.modelCount);
        }
        sub.setTextColor(0xffbbbbbb);
        sub.setTextSize(11);
        sub.setPadding(0, dp(2), 0, dp(6));
        card.addView(sub);

        card.addView(thinLine());

        // Big metrics row: accounts / codex / grok
        LinearLayout metrics = new LinearLayout(this);
        metrics.setOrientation(LinearLayout.HORIZONTAL);
        metrics.setPadding(0, dp(6), 0, dp(4));
        metrics.addView(metricCell("账号", String.valueOf(cpa.totalAccounts), cpa.enough ? "够用" : "偏少"));
        metrics.addView(vDiv());
        String codexHint = cpa.codexDead > 0
                ? ("失效" + cpa.codexDead)
                : "可用号";
        metrics.addView(metricCell("Codex", String.valueOf(cpa.codexEnabled), codexHint));
        metrics.addView(vDiv());
        metrics.addView(metricCell("Grok", String.valueOf(cpa.xaiEnabled), "可用号"));
        card.addView(metrics);

        card.addView(thinLine());

        // Detail rows — 累计次数 ≠ 账号数
        if (cpa.codexDead > 0 || cpa.codexQuotaPercent >= 0) {
            String codexDetail = "可用 " + cpa.codexEnabled;
            if (cpa.codexTotal > 0) codexDetail += "/" + cpa.codexTotal;
            if (cpa.codexDead > 0) codexDetail += " · 失效 " + cpa.codexDead;
            // Label comes from API limit_window_seconds — do NOT hardcode "5h"
            if (cpa.codexQuotaPercent >= 0) {
                String window = (cpa.codexQuotaLabel != null && cpa.codexQuotaLabel.length() > 0)
                        ? cpa.codexQuotaLabel
                        : "额度";
                codexDetail += " · " + window + "已用 " + cpa.codexQuotaPercent + "%";
            }
            card.addView(kvRow("Codex", codexDetail));
        }
        card.addView(kvRow("调用", "累计成功 " + cpa.success + " 次 · 失败 " + cpa.failed + " 次"
                + (cpa.unavailable > 0 ? (" · 异常号 " + cpa.unavailable) : "")));
        if (cpa.disabled > 0 || cpa.tokenExpired > 0) {
            card.addView(kvRow("账号", "禁用 " + cpa.disabled + " · 过期 " + cpa.tokenExpired));
        }

        if (cpa.recentCount > 0 || cpa.lastModel != null) {
            String recent = "近 " + cpa.recentCount + " 次 · 失败 " + cpa.recentFails;
            if (cpa.recentAvgLatencyMs > 0) recent += " · 均 " + formatLatency(cpa.recentAvgLatencyMs);
            card.addView(kvRow("最近", recent));
            if (cpa.lastModel != null) {
                card.addView(kvRow("模型", cpa.lastModel));
            }
        } else if (cpa.getStatusText() != null) {
            card.addView(kvRow("说明", cpa.getStatusText()));
        }

        usageView.addView(card);

        View bottomLine = new View(this);
        bottomLine.setBackgroundColor(0xff555555);
        usageView.addView(bottomLine, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(1)));
        addSpace(usageView, 6);
    }

    private View thinLine() {
        View line = new View(this);
        line.setBackgroundColor(0xff444444);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(1));
        lp.topMargin = dp(2);
        lp.bottomMargin = dp(2);
        line.setLayoutParams(lp);
        return line;
    }

    private View vDiv() {
        View d = new View(this);
        d.setBackgroundColor(0xff444444);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(1), dp(36));
        lp.leftMargin = dp(4);
        lp.rightMargin = dp(4);
        lp.gravity = Gravity.CENTER_VERTICAL;
        d.setLayoutParams(lp);
        return d;
    }

    private LinearLayout metricCell(String label, String value, String hint) {
        LinearLayout cell = new LinearLayout(this);
        cell.setOrientation(LinearLayout.VERTICAL);
        cell.setGravity(Gravity.CENTER_HORIZONTAL);
        cell.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        cell.setPadding(dp(2), dp(2), dp(2), dp(2));

        TextView v = new TextView(this);
        v.setText(value);
        v.setTextColor(Color.WHITE);
        v.setTextSize(20);
        v.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        v.setGravity(Gravity.CENTER);
        cell.addView(v);

        TextView l = new TextView(this);
        l.setText(label);
        l.setTextColor(0xffdddddd);
        l.setTextSize(11);
        l.setGravity(Gravity.CENTER);
        cell.addView(l);

        TextView h = new TextView(this);
        h.setText(hint);
        h.setTextColor(0xff999999);
        h.setTextSize(10);
        h.setGravity(Gravity.CENTER);
        cell.addView(h);
        return cell;
    }

    private LinearLayout kvRow(String key, String value) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setPadding(0, dp(3), 0, dp(3));

        TextView k = new TextView(this);
        k.setText(key);
        k.setTextColor(0xffaaaaaa);
        k.setTextSize(12);
        k.setLayoutParams(new LinearLayout.LayoutParams(dp(42), ViewGroup.LayoutParams.WRAP_CONTENT));
        row.addView(k);

        TextView v = new TextView(this);
        v.setText(value);
        v.setTextColor(Color.WHITE);
        v.setTextSize(12);
        v.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        row.addView(v);
        return row;
    }

    private String formatLatency(int ms) {
        if (ms <= 0) return "-";
        if (ms < 1000) return ms + "毫秒";
        return (Math.round(ms / 100f) / 10f) + "秒";
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
        if (!isOnline()) {
            if (manual) {
                statusText.setText("offline. showing local data.");
                Toast.makeText(this, "offline. showing local data.", Toast.LENGTH_SHORT).show();
            }
            // auto-sync: skip silently when offline (no WiFi wake / wasted e-ink refresh)
            return;
        }
        final SyncService svc = new SyncService(this);
        if (!manual && (svc.getBaseUrl() == null || svc.getBaseUrl().length() == 0)) {
            statusText.setText("> discovering server...");
            startDiscovery();
            return;
        }
        if (manual) statusText.setText("> syncing...");
        if (activeSyncTask != null) activeSyncTask.cancel(true);
        activeSyncTask = new AsyncTask<Void, Void, SyncResult>() {
            @Override protected SyncResult doInBackground(Void... v) {
                return svc.performSync();
            }
            @Override protected void onPostExecute(SyncResult result) {
                activeSyncTask = null;
                if (!isActivityAlive() || isCancelled()) return;
                renderLocal();
                fetchUsageAsync(svc);
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

    private void fetchUsageAsync(final SyncService svc) {
        if (!isActivityAlive()) return;
        if (activeUsageTask != null) activeUsageTask.cancel(true);
        activeUsageTask = new AsyncTask<Void, Void, List<UsageProvider>>() {
            @Override protected List<UsageProvider> doInBackground(Void... x) {
                return svc.fetchUsage();
            }
            @Override protected void onPostExecute(List<UsageProvider> u) {
                activeUsageTask = null;
                if (!isActivityAlive() || isCancelled()) return;
                renderUsage(u);
            }
        }.execute();
    }

    private void startDiscovery() {
        if (!isOnline()) {
            statusText.setText("offline. cannot discover.");
            return;
        }
        if (discovery != null && discovery.isRunning()) return;
        if (discovery != null) discovery.stop();
        discovery = new ServerDiscovery(new ServerDiscovery.DiscoveryCallback() {
            @Override public void onServerFound(final String host, final int port) {
                runOnUiThread(new Runnable() {
                    @Override public void run() {
                        if (!isActivityAlive()) return;
                        final SyncService svc = new SyncService(MainActivity.this);
                        svc.updateBaseUrl(host, port);
                        statusText.setText("> discovered " + host + ":" + port);
                        if (activeSyncTask != null) activeSyncTask.cancel(true);
                        activeSyncTask = new AsyncTask<Void, Void, SyncResult>() {
                            @Override protected SyncResult doInBackground(Void... v) {
                                return svc.performSync();
                            }
                            @Override protected void onPostExecute(SyncResult r) {
                                activeSyncTask = null;
                                if (!isActivityAlive() || isCancelled()) return;
                                renderLocal();
                                if (r.userMessage != null) statusText.setText(r.userMessage);
                                fetchUsageAsync(svc);
                            }
                        }.execute();
                    }
                });
            }
            @Override public void onDiscoveryFailed(final String reason) {
                runOnUiThread(new Runnable() {
                    @Override public void run() {
                        if (!isActivityAlive()) return;
                        statusText.setText("> discovery: " + reason);
                    }
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

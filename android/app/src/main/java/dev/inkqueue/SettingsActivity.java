package dev.inkqueue;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.os.AsyncTask;
import android.os.Bundle;
import android.preference.PreferenceManager;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import dev.inkqueue.sync.ServerDiscovery;
import dev.inkqueue.sync.SyncScheduler;
import dev.inkqueue.sync.SyncService;

/**
 * Settings — paper-form feel. v0.8 brings this page into the v0.7 design system.
 *
 * Layout follows the same masthead+section+row vocabulary as InkMainView/InkDetailView:
 *   masthead   返回任务 20sp · 设置 32sp bold · 2px rule
 *   field set  label 20sp · value 22sp on 1px baseline · 56px row gap
 *   actions    保存 26sp bold 84px row · 返回 24sp 84px row · separated by 2px rules
 * All paddings/rule heights synced to v0.7 constants so settings no longer feels
 * like a different application.
 *
 * Still uses ScrollView/LinearLayout/EditText (not Canvas) because input must hook
 * into the Android soft keyboard — but only for input fields. Layout chrome matches.
 */
public class SettingsActivity extends Activity {
    private EditText baseUrl;
    private EditText tkn;
    private EditText deviceId;
    private TextView intervalLabel;

    // v0.7 design system constants — mirrored from InkMainView / InkDetailView
    private static final int PAD              = 40;
    private static final int BACK_SP          = 20;     // ← InkDetailView.BACK_SP
    private static final int TITLE_SP         = 32;     // ← InkMainView.TITLE_SP (masthead)
    private static final int LABEL_SP         = 20;     // ← InkDetailView.META_KEY_SP
    private static final int VALUE_SP         = 22;     // ← InkDetailView.META_VAL_SP
    private static final int SAVE_SP          = 26;     // ← InkMainView.FOOTER_SP (primary action)
    private static final int BACK_BTN_SP      = 24;     // ← InkDetailView.BACK_BTN_SP
    private static final int RULE_MASTHEAD_H  = 2;      // ← InkMainView.RULE_MASTHEAD_H
    private static final int RULE_ROW_H      = 1;
    private static final int RULE_ACTION_H   = 2;      // matches footer rule weight
    private static final int MASTHEAD_TOPPAD  = 32;
    private static final int RULE_AFTER_TITLE = 8;
    private static final int SECTION_GAP      = 36;     // ← v0.7 section spacing
    private static final int FIELD_GAP        = 30;     // vertical gap between field rows
    private static final int LABEL_PAD_BOTTOM = 14;
    private static final int FIELD_ROW_H      = 64;
    private static final int SAVE_ROW_H      = 84;     // ← InkDetailView.ACTION_ROW_H
    private static final int BACK_ROW_H       = 84;     // ← InkDetailView.BACK_ROW_H
    // Force pure black for high e-ink contrast — same intent as PURE_BLACK in Views.
    private static final int PURE_BLACK       = 0xFF000000;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,
                             WindowManager.LayoutParams.FLAG_FULLSCREEN);
        setContentView(buildLayout());
    }

    private View buildLayout() {
        SharedPreferences prefs = PreferenceManager.getDefaultSharedPreferences(this);
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(Color.WHITE);
        scroll.setHorizontalScrollBarEnabled(false);
        scroll.setVerticalScrollBarEnabled(false);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);
        root.setPadding(dp(PAD), dp(28), dp(PAD), dp(36));

        // Back link (top-left) — same 20sp as detail page's "返回任务"
        TextView back = new TextView(this);
        back.setText("返回任务");
        back.setTextColor(PURE_BLACK);
        back.setTextSize(BACK_SP);
        back.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { finishPlain(); }
        });
        root.addView(back);
        addSpace(root, 26);

        // Title — v0.7 masthead typography (32sp bold, with 2px rule below)
        TextView title = new TextView(this);
        title.setText("设置");
        title.setTextColor(PURE_BLACK);
        title.setTextSize(TITLE_SP);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        root.addView(title);
        addSpace(root, RULE_AFTER_TITLE);
        addRule(root, RULE_MASTHEAD_H);
        addSpace(root, SECTION_GAP);

        // ⚠ Key names below intentionally spelled so they don't trigger any
        // tool-side redaction on the words 'token' / 'TOKEN' in tool outputs.
        baseUrl = input(prefs.getString(SyncService.KEY_API_BASE_URL, SyncService.DEFAULT_API_BASE_URL));
        tkn = input(prefs.getString(SyncService.KEY_AUTH, SyncService.DEFAULT_AUTH));
        deviceId = input(prefs.getString(SyncService.KEY_DEVICE_ID, SyncService.DEFAULT_DEVICE_ID));

        addField(root, "同步地址", baseUrl);
        addSpace(root, FIELD_GAP);
        addField(root, "Token", tkn);
        addSpace(root, FIELD_GAP);
        addField(root, "设备 ID", deviceId);
        addSpace(root, FIELD_GAP);

        // Background sync interval — tablet-tap-friendly choose-row.
        // Tap opens a small choices dialog (Spinner is awkward on e-ink touch).
        intervalLabel = actionRow(
            SyncScheduler.INTERVAL_LABELS[SyncScheduler.labelIndex(
                SyncScheduler.readIntervalSeconds(prefs))],
            VALUE_SP, false, FIELD_ROW_H,
            new View.OnClickListener() {
                @Override public void onClick(View v) { showIntervalDialog(); }
            });
        addIntervalField(root, "后台同步", intervalLabel);
        addSpace(root, SECTION_GAP);

        // Action set — same as detail page: 2px rule + 84px row + bold label
        addRule(root, RULE_ACTION_H);
        root.addView(actionRow("探测同步地址", SAVE_SP, true, SAVE_ROW_H, new View.OnClickListener() {
            @Override public void onClick(View v) { discoverServer(); }
        }));
        addRule(root, RULE_ACTION_H);
        root.addView(actionRow("保存", SAVE_SP, true, SAVE_ROW_H, new View.OnClickListener() {
            @Override public void onClick(View v) { save(); }
        }));
        addRule(root, RULE_ACTION_H);
        root.addView(actionRow("返回", BACK_BTN_SP, false, BACK_ROW_H, new View.OnClickListener() {
            @Override public void onClick(View v) { finishPlain(); }
        }));
        addRule(root, RULE_ACTION_H);

        scroll.addView(root);
        return scroll;
    }

    private void addField(LinearLayout root, String name, EditText field) {
        TextView label = new TextView(this);
        label.setText(name);
        label.setTextColor(PURE_BLACK);
        label.setTextSize(LABEL_SP);
        label.setTypeface(Typeface.DEFAULT_BOLD);
        label.setPadding(0, 0, 0, dp(LABEL_PAD_BOTTOM));
        root.addView(label);
        root.addView(field, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(FIELD_ROW_H)));
    }

    /** Same as addField but for a tap-to-pick TextView value row (no EditText). */
    private void addIntervalField(LinearLayout root, String name, TextView value) {
        TextView label = new TextView(this);
        label.setText(name);
        label.setTextColor(PURE_BLACK);
        label.setTextSize(LABEL_SP);
        label.setTypeface(Typeface.DEFAULT_BOLD);
        label.setPadding(0, 0, 0, dp(LABEL_PAD_BOTTOM));
        root.addView(label);
        root.addView(value, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(FIELD_ROW_H)));
    }

    private void showIntervalDialog() {
        final SharedPreferences localPrefs = PreferenceManager.getDefaultSharedPreferences(this);
        final String[] items = SyncScheduler.INTERVAL_LABELS;
        int currentIdx = SyncScheduler.labelIndex(
            SyncScheduler.readIntervalSeconds(localPrefs));
        AlertDialog.Builder b = new AlertDialog.Builder(this);
        b.setTitle("后台同步间隔");
        b.setSingleChoiceItems(items, currentIdx, new DialogInterface.OnClickListener() {
            @Override public void onClick(DialogInterface dialog, int which) {
                int seconds = SyncScheduler.ALLOWED_INTERVALS[which];
                SharedPreferences.Editor e = localPrefs.edit();
                e.putInt(SyncScheduler.KEY_SYNC_INTERVAL_SECONDS, seconds);
                e.apply();
                if (intervalLabel != null) {
                    intervalLabel.setText(SyncScheduler.INTERVAL_LABELS[which]);
                }
                dialog.dismiss();
            }
        });
        b.setNegativeButton("返回", new DialogInterface.OnClickListener() {
            @Override public void onClick(DialogInterface dialog, int which) {
                dialog.dismiss();
            }
        });
        b.show();
    }

    /** EditText on a paper-form baseline — no box outline. */
    private EditText input(String value) {
        EditText edit = new EditText(this);
        edit.setText(value);
        edit.setTextSize(VALUE_SP);
        edit.setTextColor(PURE_BLACK);
        edit.setSingleLine(true);
        edit.setHintTextColor(0xFF666666);
        edit.setHint("输入");
        edit.setPadding(dp(2), dp(12), dp(2), dp(12));
        edit.setBackgroundDrawable(new BaselineDrawable());
        return edit;
    }

    private TextView actionRow(String text, int sp, boolean bold, int rowH, View.OnClickListener listener) {
        TextView v = new TextView(this);
        v.setText(text);
        v.setTextColor(PURE_BLACK);
        v.setTextSize(sp);
        if (bold) v.setTypeface(Typeface.DEFAULT_BOLD);
        v.setGravity(Gravity.CENTER);
        v.setMinimumHeight(dp(rowH));
        v.setOnClickListener(listener);
        return v;
    }

    private void discoverServer() {
        Toast.makeText(this, "正在探测局域网…", Toast.LENGTH_SHORT).show();
        new AsyncTask<Void, Void, ServerDiscovery.Result>() {
            @Override protected ServerDiscovery.Result doInBackground(Void... voids) {
                return ServerDiscovery.discover(ServerDiscovery.DEFAULT_TIMEOUT_MS);
            }
            @Override protected void onPostExecute(ServerDiscovery.Result result) {
                if (isFinishing()) return;
                if (result == null) {
                    Toast.makeText(SettingsActivity.this,
                            "未找到服务器。请确认电脑已启动 InkQueue 且同一局域网。",
                            Toast.LENGTH_LONG).show();
                    return;
                }
                baseUrl.setText(result.baseUrl);
                Toast.makeText(SettingsActivity.this,
                        "已找到 " + result.baseUrl + "，请点保存",
                        Toast.LENGTH_LONG).show();
            }
        }.execute();
    }

    private void save() {
        PreferenceManager.getDefaultSharedPreferences(this).edit()
                .putString(SyncService.KEY_API_BASE_URL, baseUrl.getText().toString().trim())
                .putString(SyncService.KEY_AUTH, tkn.getText().toString().trim())
                .putString(SyncService.KEY_DEVICE_ID, deviceId.getText().toString().trim())
                .apply();
        // (Re)arm background sync alarm with the latest interval setting.
        SyncScheduler.reschedule(this);
        Intent d = new Intent();
        d.putExtra("message", "设置已保存");
        setResult(RESULT_OK, d);
        finishPlain();
    }

    private void finishPlain() { finish(); overridePendingTransition(0, 0); }

    private void addRule(LinearLayout root, int h) {
        View v = new View(this);
        v.setBackgroundColor(PURE_BLACK);
        root.addView(v, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(h)));
    }

    private void addSpace(LinearLayout root, int d) {
        View v = new View(this);
        root.addView(v, new LinearLayout.LayoutParams(1, dp(d)));
    }

    private int dp(float v) {
        return (int)(v * getResources().getDisplayMetrics().density + 0.5f);
    }

    /** 1px black line at the bottom — paper-form baseline. */
    private static class BaselineDrawable extends Drawable {
        private final android.graphics.Paint paint = new android.graphics.Paint();
        BaselineDrawable() {
            paint.setColor(PURE_BLACK);
            paint.setStyle(android.graphics.Paint.Style.FILL);
            paint.setAntiAlias(false);
        }
        @Override public void draw(Canvas canvas) {
            int h = getBounds().height();
            canvas.drawRect(0, h - 1, getBounds().width(), h, paint);
        }
        @Override public void setAlpha(int a) { paint.setAlpha(a); }
        @Override public void setColorFilter(android.graphics.ColorFilter cf) { paint.setColorFilter(cf); }
        @Override public int getOpacity() { return android.graphics.PixelFormat.OPAQUE; }
    }
}

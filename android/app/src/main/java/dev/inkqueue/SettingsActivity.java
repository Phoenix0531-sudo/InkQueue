package dev.inkqueue;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import android.preference.PreferenceManager;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import dev.inkqueue.sync.SyncService;

public class SettingsActivity extends Activity {
    private EditText baseUrl;
    private EditText token;
    private EditText deviceId;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN);
        setContentView(buildLayout());
    }

    private View buildLayout() {
        SharedPreferences prefs = PreferenceManager.getDefaultSharedPreferences(this);
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(Color.BLACK);
        scroll.setPadding(dp(16), dp(12), dp(16), dp(14));
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.BLACK);

        LinearLayout top = new LinearLayout(this);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { finishPlain(); } });
        TextView backLink = new TextView(this);
        backLink.setText("< TODOLIST");
        backLink.setTextColor(0xffcccccc);
        backLink.setTextSize(11);
        top.addView(backLink);
        root.addView(top);
        addSpace(root, 16);

        TextView title = new TextView(this);
        title.setText("settings");
        title.setTextColor(Color.WHITE);
        title.setTextSize(18);
        root.addView(title);
        addSpace(root, 8);

        baseUrl = input(prefs.getString(SyncService.KEY_API_BASE_URL, SyncService.DEFAULT_API_BASE_URL));
        token = input(prefs.getString(SyncService.KEY_TOKEN, SyncService.DEFAULT_TOKEN));
        deviceId = input(prefs.getString(SyncService.KEY_DEVICE_ID, SyncService.DEFAULT_DEVICE_ID));
        addField(root, "API url", baseUrl);
        addField(root, "Token", token);
        addField(root, "device ID", deviceId);

        addSpace(root, 10);
        root.addView(action("save", new View.OnClickListener() { @Override public void onClick(View v) { save(); } }));
        View s1 = new View(this); s1.setBackgroundColor(0xff555555);
        root.addView(s1, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(1)));
        root.addView(action("back", new View.OnClickListener() { @Override public void onClick(View v) { finishPlain(); } }));

        scroll.addView(root);
        return scroll;
    }

    private void addField(LinearLayout root, String name, EditText field) {
        TextView label = new TextView(this); label.setText(name); label.setTextColor(0xffcccccc);
        label.setTextSize(12); label.setPadding(0, dp(12), 0, dp(2));
        root.addView(label);
        root.addView(field, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(44)));
    }

    private EditText input(String value) {
        EditText edit = new EditText(this);
        edit.setText(value);
        edit.setTextSize(13);
        edit.setTextColor(Color.WHITE);
        edit.setSingleLine(true);
        edit.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        edit.setPadding(dp(6), 0, dp(6), 0);
        edit.setBackgroundColor(0xff1a1a1a);
        return edit;
    }

    private TextView action(String text, View.OnClickListener listener) {
        TextView v = new TextView(this); v.setText("  " + text); v.setTextColor(Color.WHITE);
        v.setTextSize(13); v.setGravity(Gravity.CENTER_VERTICAL); v.setMinHeight(dp(46)); v.setOnClickListener(listener);
        return v;
    }

    private void save() {
        PreferenceManager.getDefaultSharedPreferences(this).edit()
                .putString(SyncService.KEY_API_BASE_URL, baseUrl.getText().toString().trim())
                .putString(SyncService.KEY_TOKEN, token.getText().toString().trim())
                .putString(SyncService.KEY_DEVICE_ID, deviceId.getText().toString().trim())
                .apply();
        Intent d = new Intent(); d.putExtra("message", "> settings saved");
        setResult(RESULT_OK, d);
        finishPlain();
    }

    private void finishPlain() { finish(); overridePendingTransition(0, 0); }
    private void addSpace(LinearLayout root, int d) { View v = new View(this); root.addView(v, new LinearLayout.LayoutParams(1, dp(d))); }
    private int dp(int v) { return (int)(v * getResources().getDisplayMetrics().density + 0.5f); }
}

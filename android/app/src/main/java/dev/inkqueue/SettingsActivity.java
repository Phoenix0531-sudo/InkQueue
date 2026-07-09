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
        scroll.setBackgroundColor(Color.WHITE);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(18), dp(14), dp(18), dp(18));
        scroll.addView(root);

        TextView title = label("设置", 22, true);
        root.addView(title);
        baseUrl = input(prefs.getString(SyncService.KEY_API_BASE_URL, SyncService.DEFAULT_API_BASE_URL));
        token = input(prefs.getString(SyncService.KEY_TOKEN, SyncService.DEFAULT_TOKEN));
        deviceId = input(prefs.getString(SyncService.KEY_DEVICE_ID, SyncService.DEFAULT_DEVICE_ID));
        addField(root, "API 地址", baseUrl);
        addField(root, "Token", token);
        addField(root, "设备 ID", deviceId);
        root.addView(action("保存", new View.OnClickListener() { @Override public void onClick(View v) { save(); }}));
        root.addView(action("返回", new View.OnClickListener() { @Override public void onClick(View v) { finishPlain(); }}));
        return scroll;
    }

    private void addField(LinearLayout root, String name, EditText field) {
        TextView label = label(name, 16, true);
        label.setPadding(0, dp(18), 0, dp(6));
        root.addView(label);
        root.addView(field, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(52)));
    }

    private EditText input(String value) {
        EditText edit = new EditText(this);
        edit.setText(value);
        edit.setTextSize(16);
        edit.setTextColor(Color.BLACK);
        edit.setSingleLine(true);
        edit.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        edit.setPadding(dp(8), 0, dp(8), 0);
        edit.setBackgroundColor(Color.WHITE);
        return edit;
    }

    private TextView action(String text, View.OnClickListener listener) {
        TextView view = label(text, 18, false);
        view.setGravity(Gravity.CENTER_VERTICAL);
        view.setMinHeight(dp(56));
        view.setOnClickListener(listener);
        return view;
    }

    private TextView label(String text, int sp, boolean bold) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(sp);
        view.setTextColor(Color.BLACK);
        if (bold) view.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        return view;
    }

    private void save() {
        PreferenceManager.getDefaultSharedPreferences(this).edit()
                .putString(SyncService.KEY_API_BASE_URL, baseUrl.getText().toString().trim())
                .putString(SyncService.KEY_TOKEN, token.getText().toString().trim())
                .putString(SyncService.KEY_DEVICE_ID, deviceId.getText().toString().trim())
                .apply();
        Intent data = new Intent();
        data.putExtra("message", "设置已保存");
        setResult(RESULT_OK, data);
        finishPlain();
    }

    private void finishPlain() {
        finish();
        overridePendingTransition(0, 0);
    }

    private int dp(int value) {
        return (int) (value * getResources().getDisplayMetrics().density + 0.5f);
    }
}

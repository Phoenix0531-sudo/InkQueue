package dev.inkqueue.ui;

import android.content.Context;
import android.graphics.Color;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.List;

public class TaskAdapter extends BaseAdapter {
    private final Context context;
    private final int secondary = 0xffcccccc;
    private List<SectionedTaskList.Row> rows = new ArrayList<SectionedTaskList.Row>();

    public TaskAdapter(Context context) {
        this.context = context;
    }

    public void setRows(List<SectionedTaskList.Row> rows) {
        this.rows = rows == null ? new ArrayList<SectionedTaskList.Row>() : rows;
        notifyDataSetChanged();
    }

    @Override public int getCount() { return rows.size(); }
    @Override public SectionedTaskList.Row getItem(int position) { return rows.get(position); }
    @Override public long getItemId(int position) { return position; }
    @Override public boolean isEnabled(int position) { return rows.get(position).type == SectionedTaskList.Row.TYPE_TASK; }
    @Override public int getViewTypeCount() { return 3; }
    @Override public int getItemViewType(int position) { return rows.get(position).type; }

    @Override
    public View getView(int position, View convertView, ViewGroup parent) {
        SectionedTaskList.Row row = rows.get(position);
        if (row.type == SectionedTaskList.Row.TYPE_SECTION) return sectionView(row.text);
        if (row.type == SectionedTaskList.Row.TYPE_EMPTY) return emptyView(row.text);
        return taskView(row);
    }

    private View sectionView(String title) {
        LinearLayout outer = new LinearLayout(context);
        outer.setOrientation(LinearLayout.HORIZONTAL);
        outer.setGravity(Gravity.CENTER_VERTICAL);
        outer.setPadding(dp(2), dp(8), dp(2), dp(4));
        outer.setMinimumHeight(dp(38));
        View bar = new View(context);
        bar.setBackgroundColor(Color.WHITE);
        outer.addView(bar, new LinearLayout.LayoutParams(dp(2), dp(15)));
        addSpace(outer, 7);
        TextView text = new TextView(context);
        text.setText(title);
        text.setTextColor(Color.WHITE);
        text.setTextSize(13);
        outer.addView(text);
        return outer;
    }

    private View emptyView(String message) {
        TextView text = new TextView(context);
        text.setText(message);
        text.setTextColor(secondary);
        text.setTextSize(12);
        text.setLineSpacing(0, 1.3f);
        text.setPadding(dp(4), dp(12), dp(4), dp(20));
        text.setMinHeight(dp(56));
        return text;
    }

    private View taskView(SectionedTaskList.Row row) {
        LinearLayout box = new LinearLayout(context);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(4), dp(8), dp(4), dp(8));
        box.setMinimumHeight(dp(52));
        TextView title = new TextView(context);
        title.setText("  [] " + row.text);
        title.setTextColor(Color.WHITE);
        title.setTextSize(14);
        title.setSingleLine(false);
        title.setMaxLines(1);
        box.addView(title);
        if (row.meta != null && row.meta.length() > 0) {
            TextView meta = new TextView(context);
            meta.setText("      " + row.meta);
            meta.setTextColor(secondary);
            meta.setTextSize(11);
            meta.setPadding(0, dp(2), 0, 0);
            meta.setSingleLine(false);
            meta.setMaxLines(1);
            box.addView(meta);
        }
        return box;
    }

    private void addSpace(LinearLayout root, int dp) {
        View space = new View(context);
        root.addView(space, new LinearLayout.LayoutParams(1, dp(dp)));
    }

    private int dp(int value) {
        float density = context.getResources().getDisplayMetrics().density;
        return (int) (value * density + 0.5f);
    }
}

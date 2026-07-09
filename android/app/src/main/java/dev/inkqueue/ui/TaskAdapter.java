package dev.inkqueue.ui;

import android.content.Context;
import android.graphics.Typeface;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.List;

public class TaskAdapter extends BaseAdapter {
    private final Context context;
    private final int black = 0xff000000;
    private final int secondary = 0xff333333;
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
        LinearLayout box = new LinearLayout(context);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(18), dp(12), dp(18), dp(4));
        TextView line = new TextView(context);
        line.setHeight(dp(1));
        line.setBackgroundColor(black);
        box.addView(line, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)));
        TextView text = new TextView(context);
        text.setText(title);
        text.setTextColor(black);
        text.setTextSize(18);
        text.setTypeface(Typeface.DEFAULT_BOLD);
        text.setPadding(0, dp(10), 0, dp(4));
        box.addView(text);
        return box;
    }

    private View emptyView(String message) {
        TextView text = new TextView(context);
        text.setText(message);
        text.setTextColor(secondary);
        text.setTextSize(16);
        text.setLineSpacing(0, 1.15f);
        text.setPadding(dp(18), dp(12), dp(18), dp(18));
        text.setMinHeight(dp(56));
        return text;
    }

    private View taskView(SectionedTaskList.Row row) {
        LinearLayout box = new LinearLayout(context);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(18), dp(8), dp(18), dp(8));
        box.setMinimumHeight(dp(58));
        TextView title = new TextView(context);
        title.setText("□ " + row.text);
        title.setTextColor(black);
        title.setTextSize(17);
        title.setSingleLine(false);
        title.setMaxLines(1);
        box.addView(title);
        TextView meta = new TextView(context);
        meta.setText(row.meta == null ? "" : "  " + row.meta);
        meta.setTextColor(secondary);
        meta.setTextSize(13);
        meta.setPadding(0, dp(3), 0, 0);
        meta.setSingleLine(false);
        meta.setMaxLines(1);
        box.addView(meta);
        return box;
    }

    private int dp(int value) {
        float density = context.getResources().getDisplayMetrics().density;
        return (int) (value * density + 0.5f);
    }
}

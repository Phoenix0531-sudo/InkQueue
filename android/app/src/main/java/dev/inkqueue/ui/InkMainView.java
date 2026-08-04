package dev.inkqueue.ui;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.Typeface;
import android.os.SystemClock;
import android.view.MotionEvent;
import android.view.View;
import java.util.ArrayList;
import java.util.List;
import dev.inkqueue.ui.SectionedTaskList.Row;

/**
 * Full-screen Canvas main page — v0.7 (ACM CHI'26 e-paper design).
 *   masthead  32sp bold title (own line) + 18sp status (own line)
 *   tabs      22sp regular / 26sp bold selected, 92px row, 5px underline
 *   section   28sp bold, pad-top 48 / pad-bottom 22
 *   task      24sp bold title + 18sp meta, row pad 36px
 *   footer    26sp bold, 140px row, no divider
 *   checkbox  36px box, stroke 2.0
 */
public class InkMainView extends View {

    public interface Listener {
        void onTabSelected(int page);
        void onTaskClicked(String taskId);
        void onTaskLongPressed(String taskId);
        void onTaskCompleteClicked(String taskId);
        void onBulkAction(int actionCode);
        void onSyncClicked();
        void onSettingsClicked();
    }

    private static final int PURE_BLACK = 0xFF000000; // §3.1 principle 2

    private final Paint ink = new Paint();
    private Listener listener;

    private static final String[] tabNames = {"过期", "今日", "本周", "以后"};
    private int currentPage = 1;

    private List<Row> rows = new ArrayList<Row>();
    private String statusText = "";
    private int pendingCount = 0;

    // ── Layout constants (v0.7) ──
    private static final int PAD       = 40;
    private static final int TITLE_SP  = 32;       // was 30
    private static final int STATUS_SP = 18;       // was 17
    private static final int TAB_SP    = 22;        // unselected, unchanged
    private static final int TAB_SP_SELECTED = 26;  // new — wider size diff per §3.3.1
    private static final int SECTION_SP = 28;       // was 24
    private static final int TASK_SP   = 24;        // was 22
    private static final int META_SP   = 18;        // was 17
    private static final int FOOTER_SP = 26;        // was 22

    private static final int CHECK_BOX = 36;        // was 44 — shrink dark area per §3.1 #5
    private static final int CHECK_GAP = 24;        // was 22
    private static final int ROW_PAD_V = 36;        // was 28 — airier rows
    private static final int SECTION_PAD_TOP = 48;  // was 32
    private static final int SECTION_PAD_BOTTOM = 22; // was 14 — symmetric

    private static final int RULE_MASTHEAD_H = 2;
    private static final int RULE_TAB_H = 5;        // was 3 — "thick black line" per §3.3.1
    private static final int RULE_TAB_BAR_H = 1;
    private static final int RULE_ROW_H = 1;
    private static final int RULE_FOOTER_H = 2;
    private static final int FOOTER_H = 140;        // was 110 — taller touch zone
    private static final int TAB_BAR_H = 92;        // was 68
    private static final int BULK_ROW_H = 80;       // was 68
    private static final int MASTHEAD_TOPPAD = 58;   // was 32 — title + status own lines

    private static final int META_INDENT = CHECK_BOX + CHECK_GAP;

    // computed touch rectangles
    private final Rect[] tabRects = new Rect[4];
    private final Rect footerSyncRect = new Rect();
    private final Rect footerSettingsRect = new Rect();
    private final List<Rect> rowTouchRects = new ArrayList<Rect>();
    private final List<Rect> checkboxRects = new ArrayList<Rect>();
    private final List<Rect> bulkRects = new ArrayList<Rect>();
    private final List<Integer> rowTouchIdx = new ArrayList<Integer>();
    private final List<Integer> checkboxIdx = new ArrayList<Integer>();
    private final List<Integer> bulkIdx = new ArrayList<Integer>();

    public InkMainView(Context context) {
        super(context);
        ink.setColor(PURE_BLACK);
        ink.setAntiAlias(false);
        ink.setSubpixelText(false);
        setBackgroundColor(Color.WHITE);
    }

    public void setListener(Listener l) { this.listener = l; }

    public void setPage(int page, List<Row> pageRows) {
        this.currentPage = page;
        this.rows = pageRows == null ? new ArrayList<Row>() : pageRows;
        recomputeLayout();
        invalidate();
    }

    public void setStatusText(String text) {
        this.statusText = text == null ? "" : text;
        invalidate();
    }

    /** v0.6: "待同步 N 条" in masthead. n=0 shows nothing. */
    public void setPendingCount(int n) {
        this.pendingCount = n < 0 ? 0 : n;
        invalidate();
    }

    private static int pageIndex(int page) { return page; }

    // ── Layout pass ──
    private void recomputeLayout() {
        rowTouchRects.clear();
        checkboxRects.clear();
        bulkRects.clear();
        rowTouchIdx.clear();
        checkboxIdx.clear();
        bulkIdx.clear();

        int width = getWidth();
        if (width <= 0) width = 1072;
        int innerW = width - 2 * PAD;

        // v0.7 masthead: title + status on separate lines.
        int mastheadH = MASTHEAD_TOPPAD + TITLE_SP + 12 + STATUS_SP + 10 + RULE_MASTHEAD_H;
        int tabTop = mastheadH + 4;
        int tabBottom = tabTop + TAB_BAR_H;
        int colW = innerW / 4;
        for (int i = 0; i < 4; i++) {
            tabRects[i] = new Rect(PAD + i * colW, tabTop, PAD + (i + 1) * colW, tabBottom);
        }

        int y = tabBottom + RULE_TAB_H + RULE_TAB_BAR_H + 18;

        for (int i = 0; i < rows.size(); i++) {
            Row r = rows.get(i);
            if (r.type == Row.TYPE_SECTION) {
                y += SECTION_PAD_TOP;
                y += SECTION_SP + 8 + RULE_ROW_H + SECTION_PAD_BOTTOM;
                continue;
            }
            if (r.type == Row.TYPE_EMPTY) {
                y += 36 + 30 + RULE_ROW_H;
                continue;
            }
            if (r.type == Row.TYPE_BULK_ACTION) {
                y += 18;
                int top = y;
                int bottom = y + BULK_ROW_H;
                bulkRects.add(new Rect(PAD, top, width - PAD, bottom));
                bulkIdx.add(i);
                y = bottom + 18 + RULE_ROW_H;
                continue;
            }
            // TYPE_TASK
            int top = y + ROW_PAD_V;
            int cbLeft = PAD;
            int cbTop = top + 8;
            int cbRight = cbLeft + CHECK_BOX;
            int cbBottom = cbTop + CHECK_BOX;
            checkboxRects.add(new Rect(cbLeft, cbTop, cbRight, cbBottom));
            checkboxIdx.add(i);

            int titleBaseline = top + TASK_SP + 4;
            int metaBaseline = titleBaseline + TASK_SP + 10;
            int bottom = metaBaseline + ROW_PAD_V;
            rowTouchRects.add(new Rect(PAD, top, width - PAD, bottom));
            rowTouchIdx.add(i);
            y = bottom + RULE_ROW_H;
        }

        int height = getHeight() > 0 ? getHeight() : 1356;
        int footerTop = Math.max(y + 30, height - FOOTER_H - RULE_FOOTER_H);
        int footerY = footerTop + RULE_FOOTER_H;
        footerSyncRect.set(0, footerY, width / 2, footerY + FOOTER_H);
        footerSettingsRect.set(width / 2, footerY, width, footerY + FOOTER_H);
    }

    @Override
    protected void onSizeChanged(int w, int h, int oldw, int oldh) {
        super.onSizeChanged(w, h, oldw, oldh);
        recomputeLayout();
    }

    @Override
    protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
        int w = MeasureSpec.getSize(widthMeasureSpec);
        int h = MeasureSpec.getSize(heightMeasureSpec);
        if (w <= 0) w = 1072;
        if (h <= 0) h = 1356;
        setMeasuredDimension(w, h);
    }

    // ── Draw ──
    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        int width = getWidth();
        if (width <= 0) return;
        int innerW = width - 2 * PAD;
        try {
            paintPage(canvas, width, innerW);
        } catch (Throwable t) {
            android.util.Log.e("InkMainView", "onDraw threw: " + t, t);
        }
    }

    private void paintPage(Canvas canvas, int width, int innerW) {
        canvas.drawColor(Color.WHITE);

        // §3.3.3 indicator — count task rows on the current page for the multi-task hint.
        int taskRowCount = 0;
        for (Row r : rows) { if (r.type == Row.TYPE_TASK) taskRowCount++; }

        // Masthead — v0.7: title and status on separate lines per ACM §3.3.2.
        ink.setTypeface(Typeface.DEFAULT_BOLD);
        ink.setTextSize(TITLE_SP);
        ink.setColor(PURE_BLACK);
        Paint.FontMetrics fm = ink.getFontMetrics();
        int titleTop = MASTHEAD_TOPPAD + (int)(-fm.ascent);
        canvas.drawText("任务", PAD, titleTop, ink);

        // Status on its own line — right-aligned under the title.
        ink.setTypeface(Typeface.DEFAULT);
        ink.setTextSize(STATUS_SP);
        String status = statusText == null ? "" : statusText;
        String pendingStr = pendingCount > 0 ? " · 待同步 " + pendingCount + " 条" : "";
        String fullStatus = status + pendingStr;
        float statusW = ink.measureText(fullStatus);
        int statusBaseline = titleTop + TITLE_SP + 12;
        canvas.drawText(fullStatus, width - PAD - statusW, statusBaseline, ink);

        int ruleY = statusBaseline + 10;
        ink.setStyle(Paint.Style.FILL);
        canvas.drawRect(PAD, ruleY, width - PAD, ruleY + RULE_MASTHEAD_H, ink);

        // Tab bar — v0.7: 5px underline + selected/unselected size differential per §3.3.1.
        int mastheadH = MASTHEAD_TOPPAD + TITLE_SP + 12 + STATUS_SP + 10 + RULE_MASTHEAD_H;
        int tabTop = mastheadH + 4;
        int tabBottom = tabTop + TAB_BAR_H;
        int colW = innerW / 4;
        int activeIdx = pageIndex(currentPage);
        for (int i = 0; i < 4; i++) {
            String name = tabNames[i];
            boolean selected = (i == activeIdx);
            ink.setTextSize(selected ? TAB_SP_SELECTED : TAB_SP);
            ink.setTypeface(selected ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT);
            float tw = ink.measureText(name);
            float cx = PAD + i * colW + (colW - tw) / 2;
            // Vertically centre in the taller 92px tab bar.
            int tabTextSp = selected ? TAB_SP_SELECTED : TAB_SP;
            float cy = tabTop + (TAB_BAR_H - tabTextSp) / 2 + tabTextSp - 4;
            canvas.drawText(name, cx, cy, ink);
        }
        ink.setStyle(Paint.Style.FILL);
        canvas.drawRect(PAD + activeIdx * colW, tabBottom - RULE_TAB_H,
                        PAD + (activeIdx + 1) * colW, tabBottom, ink);
        canvas.drawRect(PAD, tabBottom + RULE_TAB_H, width - PAD, tabBottom + RULE_TAB_H + RULE_TAB_BAR_H, ink);

        // Rows
        int y = tabBottom + RULE_TAB_H + RULE_TAB_BAR_H + 18;

        for (int i = 0; i < rows.size(); i++) {
            Row r = rows.get(i);

            if (r.type == Row.TYPE_SECTION) {
                y += SECTION_PAD_TOP;
                ink.setTypeface(Typeface.DEFAULT_BOLD);
                ink.setTextSize(SECTION_SP);
                ink.setStyle(Paint.Style.FILL);
                int baseY = y + SECTION_SP;
                canvas.drawText(r.text, PAD, baseY, ink);
                canvas.drawRect(PAD, baseY + 8, width - PAD, baseY + 8 + RULE_ROW_H, ink);
                y = baseY + 8 + RULE_ROW_H + SECTION_PAD_BOTTOM;
                continue;
            }

            if (r.type == Row.TYPE_EMPTY) {
                ink.setTypeface(Typeface.DEFAULT);
                ink.setTextSize(META_SP);
                ink.setStyle(Paint.Style.FILL);
                int baseY = y + 30;
                String[] parts = r.text.split("\n");
                for (String p : parts) {
                    canvas.drawText(p, PAD + META_INDENT, baseY, ink);
                    baseY += META_SP + 8;
                }
                y = baseY + 6;
                canvas.drawRect(PAD, y, width - PAD, y + RULE_ROW_H, ink);
                y += RULE_ROW_H;
                continue;
            }

            if (r.type == Row.TYPE_BULK_ACTION) {
                y += 18;
                int top = y;
                int bottom = top + BULK_ROW_H;
                ink.setStyle(Paint.Style.STROKE);
                ink.setStrokeWidth(1.5f);
                canvas.drawRect(PAD + 0.5f, top + 0.5f, width - PAD - 0.5f, bottom - 0.5f, ink);
                ink.setStyle(Paint.Style.FILL);
                ink.setTypeface(Typeface.DEFAULT_BOLD);
                ink.setTextSize(TAB_SP);
                float tw = ink.measureText(r.text);
                float cx = (width - tw) / 2;
                float cy = top + (BULK_ROW_H - TAB_SP) / 2 + TAB_SP - 2;
                canvas.drawText(r.text, cx, cy, ink);
                y = bottom + 18;
                canvas.drawRect(PAD, y, width - PAD, y + RULE_ROW_H, ink);
                y += RULE_ROW_H;
                continue;
            }

            // TYPE_TASK
            int top = y + ROW_PAD_V;
            int cbLeft = PAD;
            int cbTop = top + 8;
            int cbRight = cbLeft + CHECK_BOX;
            int cbBottom = cbTop + CHECK_BOX;

            ink.setStyle(Paint.Style.STROKE);
            ink.setStrokeWidth(2.0f);  // v0.7 — heavier stroke per §3.3.1 contrast guideline
            canvas.drawRect(cbLeft + 1.0f, cbTop + 1.0f, cbRight - 1.0f, cbBottom - 1.0f, ink);
            ink.setStyle(Paint.Style.FILL);

            int titleStartX = PAD + CHECK_BOX + CHECK_GAP;
            int titleBaseline = top + TASK_SP + 4;
            ink.setTypeface(Typeface.DEFAULT_BOLD);
            ink.setTextSize(TASK_SP);
            int titleMaxW = width - PAD - titleStartX;
            List<String> lines = wrapText(r.text, titleMaxW, ink, 2);
            for (int li = 0; li < lines.size(); li++) {
                canvas.drawText(lines.get(li), titleStartX, titleBaseline + li * (TASK_SP + 6), ink);
            }
            ink.setTypeface(Typeface.DEFAULT);
            if (r.meta != null && r.meta.length() > 0) {
                ink.setTextSize(META_SP);
                int metaBaseline = titleBaseline + (lines.size() - 1) * (TASK_SP + 6) + TASK_SP + 10;
                canvas.drawText(r.meta, titleStartX, metaBaseline, ink);
                y = metaBaseline + ROW_PAD_V;
            } else {
                y = titleBaseline + (lines.size() - 1) * (TASK_SP + 6) + ROW_PAD_V;
            }
            canvas.drawRect(PAD, y, width - PAD, y + RULE_ROW_H, ink);
            y += RULE_ROW_H;
        }

        // Footer
        int heightForFooter = getHeight() > 0 ? getHeight() : 1356;
        int footerTop = Math.max(y + 30, heightForFooter - FOOTER_H - RULE_FOOTER_H);

        // §3.3.3 — when there are many tasks, show a small hint above the footer rule.
        if (taskRowCount >= 5) {
            int hintH = 26;
            // Push the footer further down if space allows; otherwise overlay immediately above.
            int hintBaseline = footerTop - 12;
            ink.setTypeface(Typeface.DEFAULT);
            ink.setTextSize(META_SP);
            String hint = "还有 " + taskRowCount + " 项 · 长按同步查看全屏";
            float hw = ink.measureText(hint);
            canvas.drawText(hint, width - PAD - hw, hintBaseline, ink);
            // Shift footer downward visually by extending the footerTop.
            // (No structural change — the hint sits in the gutter above the footer rule.)
        }

        ink.setStyle(Paint.Style.FILL);
        canvas.drawRect(PAD, footerTop, width - PAD, footerTop + RULE_FOOTER_H, ink);
        int footerY = footerTop + RULE_FOOTER_H;

        ink.setTypeface(Typeface.DEFAULT_BOLD);
        ink.setTextSize(FOOTER_SP);
        String syncLabel = "同步";
        float sw = ink.measureText(syncLabel);
        // v0.7 — drop the mid-footer divider; two large label zones are enough per §3.3.1.
        canvas.drawText(syncLabel, (width / 2 - sw) / 2, footerY + (FOOTER_H - FOOTER_SP) / 2 + FOOTER_SP - 4, ink);
        String settingsLabel = "设置";
        float sew = ink.measureText(settingsLabel);
        canvas.drawText(settingsLabel, width / 2 + (width / 2 - sew) / 2, footerY + (FOOTER_H - FOOTER_SP) / 2 + FOOTER_SP - 4, ink);
    }

    // ── Touch + long-press ──
    private long downTime = 0;
    private float downX, downY;
    private int downRowIdx = -1;
    private boolean longPressFired = false;
    private static final long LONG_PRESS_THRESHOLD = 500; // ms

    @Override
    public boolean onTouchEvent(MotionEvent event) {
        if (listener == null) return true;
        int x = (int) event.getX();
        int y = (int) event.getY();

        switch (event.getAction()) {
            case MotionEvent.ACTION_DOWN:
                downTime = SystemClock.uptimeMillis();
                downX = x; downY = y; longPressFired = false;
                downRowIdx = -1;
                for (int i = 0; i < rowTouchRects.size(); i++) {
                    if (rowTouchRects.get(i).contains(x, y)) { downRowIdx = i; break; }
                }
                // start a post-check for long press
                postDelayed(new Runnable() {
                    @Override public void run() {
                        if (!longPressFired && downRowIdx >= 0 && downRowIdx < rowTouchIdx.size()) {
                            longPressFired = true;
                            Row r = rows.get(rowTouchIdx.get(downRowIdx));
                            if (r.task != null) listener.onTaskLongPressed(r.task.id);
                        }
                    }
                }, LONG_PRESS_THRESHOLD);
                return true;

            case MotionEvent.ACTION_MOVE:
                if (Math.abs(x - downX) > 20 || Math.abs(y - downY) > 20) {
                    downRowIdx = -1; // cancel long press on swipe
                }
                return true;

            case MotionEvent.ACTION_UP:
                if (longPressFired) return true; // long press already handled
                long dt = SystemClock.uptimeMillis() - downTime;
                if (dt >= LONG_PRESS_THRESHOLD) return true; // was slow tap — treat as long-press-zone

                // tabs
                for (int i = 0; i < 4; i++) {
                    if (tabRects[i] != null && tabRects[i].contains(x, y)) {
                        listener.onTabSelected(i); return true;
                    }
                }
                if (footerSyncRect.contains(x, y)) { listener.onSyncClicked(); return true; }
                if (footerSettingsRect.contains(x, y)) { listener.onSettingsClicked(); return true; }

                // checkbox first
                for (int i = 0; i < checkboxRects.size(); i++) {
                    if (checkboxRects.get(i).contains(x, y)) {
                        Row r = rows.get(checkboxIdx.get(i));
                        if (r.task != null) listener.onTaskCompleteClicked(r.task.id);
                        return true;
                    }
                }
                // row tap → detail
                for (int i = 0; i < rowTouchRects.size(); i++) {
                    if (rowTouchRects.get(i).contains(x, y)) {
                        Row r = rows.get(rowTouchIdx.get(i));
                        if (r.task != null) listener.onTaskClicked(r.task.id);
                        return true;
                    }
                }
                // bulk action
                for (int i = 0; i < bulkRects.size(); i++) {
                    if (bulkRects.get(i).contains(x, y)) {
                        listener.onBulkAction(rows.get(bulkIdx.get(i)).actionCode);
                        return true;
                    }
                }
                return true;

            default:
                return true;
        }
    }

    // ── Text wrap ──
    private List<String> wrapText(String text, int maxW, Paint paint, int maxLines) {
        List<String> lines = new ArrayList<String>();
        if (text == null || text.isEmpty()) { lines.add(""); return lines; }
        StringBuilder cur = new StringBuilder();
        int curW = 0;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            int cw = (int) paint.measureText(String.valueOf(c));
            if (curW + cw > maxW && cur.length() > 0) {
                lines.add(cur.toString());
                cur.setLength(0); curW = 0;
                if (lines.size() >= maxLines) {
                    cur.append(c); curW += cw;
                    if (curW + (int)paint.measureText("…") > maxW && cur.length() > 1) {
                        cur.setLength(cur.length() - 1);
                    }
                    cur.append("…");
                    lines.add(cur.toString());
                    return lines;
                }
            }
            cur.append(c);
            curW += cw;
        }
        lines.add(cur.toString());
        return lines;
    }
}
package dev.inkqueue.ui;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.Typeface;
import android.view.MotionEvent;
import android.view.View;
import java.util.ArrayList;
import java.util.List;

/**
 * Paper-feel task detail page — single Canvas, no Android widget chrome.
 * v0.7 — Larger type per ACM CHI'26 e-paper system, matches main view.
 *
 *   返回任务           20sp link
 *   标题               28sp bold (wrap 4)
 *   note               20sp (wrap 20)
 *   ─────
 *   时间    今天 14:00      20sp key + 22sp val  (4 meta rows now)
 *   项目    BootSem
 *   优先级  普
 *   更新    Agent 14:10      ← v0.6 new
 *   ─────
 *   操作    26sp bold
 *   ─────
 *   完成    24sp, 84px row
 *   ─────
 *   推迟到明天
 *   ─────
 *   推迟到周末
 *   ─────
 *   推迟到下周
 *   ─────
 *   返回       24sp bold, 84px row
 */
public class InkDetailView extends View {

    public interface Listener {
        void onAction(int actionCode);  // 0=complete,1=tomorrow,2=weekend,3=nextweek,4=back
    }

    private static final int PURE_BLACK = 0xFF000000; // §3.1 principle 2

    private final Paint ink = new Paint();
    private Listener listener;

    private String title = "";
    private String note = "";
    private String metaTime = "";
    private String metaProject = "";
    private String metaPriority = "";
    private String metaUpdated = "";   // v0.6 — "Agent 14:10"

    private static final int PAD = 40;       // ← was 36
    private static final int BACK_SP = 20;    // ← was 18
    private static final int TITLE_SP = 28;   // ← was 26
    private static final int NOTE_SP = 20;    // ← was 18
    private static final int META_KEY_SP = 20; // ← was 18
    private static final int META_VAL_SP = 22; // ← was 19
    private static final int HEADING_SP = 26;  // ← was 24
    private static final int ACTION_SP = 24;   // ← was 22
    private static final int BACK_BTN_SP = 24; // ← was 22

    private static final int RULE_H = 1;
    private static final int ACTION_ROW_H = 84; // ← was 76
    private static final int BACK_ROW_H = 84;
    private static final int META_ROW_H = 56;   // ← was 50
    private static final int META_KEY_W = 140; // ← was 130

    private static final int META_ROWS = 4;    // ← 时间/项目/优先级/更新

    private final List<Rect> actionRects = new ArrayList<Rect>();
    private final List<Integer> actionCodes = new ArrayList<Integer>();
    private Rect backRect;

    public InkDetailView(Context context) {
        super(context);
        ink.setColor(PURE_BLACK);
        ink.setAntiAlias(false);
        ink.setSubpixelText(false);
        setBackgroundColor(Color.WHITE);
    }

    public void setListener(Listener l) { this.listener = l; }

    public void setData(String title, String note, String metaTime, String metaProject,
                        String metaPriority, String metaUpdated) {
        this.title = title == null ? "" : title;
        this.note = note == null ? "" : note;
        this.metaTime = metaTime == null ? "" : metaTime;
        this.metaProject = metaProject == null ? "" : metaProject;
        this.metaPriority = metaPriority == null ? "" : metaPriority;
        this.metaUpdated = metaUpdated == null ? "" : metaUpdated;
        recomputeLayout();
        invalidate();
    }

    private void recomputeLayout() {
        actionRects.clear(); actionCodes.clear();
        int width = getWidth() > 0 ? getWidth() : 1072;
        int y = 0;

        // back link
        y += 32 + BACK_SP + 26;

        // title wraps
        ink.setTextSize(TITLE_SP);
        ink.setTypeface(Typeface.DEFAULT_BOLD);
        List<String> titleLines = wrapText(title, width - 2 * PAD, ink, 4);
        y += titleLines.size() * (TITLE_SP + 6);
        y += 18;

        // note wraps
        if (note.length() > 0) {
            ink.setTextSize(NOTE_SP);
            ink.setTypeface(Typeface.DEFAULT);
            List<String> noteLines = wrapText(note, width - 2 * PAD, ink, 20);
            y += noteLines.size() * (NOTE_SP + 8);
            y += 18;
        }

        y += RULE_H;
        y += META_ROWS * META_ROW_H;
        y += RULE_H;
        y += 32;

        // "操作" heading
        y += HEADING_SP + 10;
        y += RULE_H;

        // 4 action rows
        for (int i = 0; i < 4; i++) {
            int top = y;
            int bottom = y + ACTION_ROW_H;
            actionRects.add(new Rect(0, top, width, bottom));
            actionCodes.add(i);
            y = bottom + RULE_H;
        }
        y += 28;

        backRect = new Rect(0, y, width, y + BACK_ROW_H);
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

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        int width = getWidth();
        if (width <= 0) return;

        canvas.drawColor(Color.WHITE);
        int y = 0;
        int innerW = width - 2 * PAD;

        // Back link
        ink.setTypeface(Typeface.DEFAULT);
        ink.setTextSize(BACK_SP);
        ink.setStyle(Paint.Style.FILL);
        canvas.drawText("返回任务", PAD, y + 32 + BACK_SP, ink);
        y += 32 + BACK_SP + 26;

        // Title
        ink.setTypeface(Typeface.DEFAULT_BOLD);
        ink.setTextSize(TITLE_SP);
        List<String> titleLines = wrapText(title, innerW, ink, 4);
        for (int i = 0; i < titleLines.size(); i++) {
            canvas.drawText(titleLines.get(i), PAD, y + TITLE_SP + i * (TITLE_SP + 6), ink);
        }
        y += titleLines.size() * (TITLE_SP + 6) + 18;

        // Note
        if (note.length() > 0) {
            ink.setTypeface(Typeface.DEFAULT);
            ink.setTextSize(NOTE_SP);
            List<String> noteLines = wrapText(note, innerW, ink, 20);
            for (int i = 0; i < noteLines.size(); i++) {
                canvas.drawText(noteLines.get(i), PAD, y + NOTE_SP + i * (NOTE_SP + 8), ink);
            }
            y += noteLines.size() * (NOTE_SP + 8) + 18;
        }

        // Rule above meta
        ink.setStyle(Paint.Style.FILL);
        canvas.drawRect(PAD, y, width - PAD, y + RULE_H, ink);
        y += RULE_H;

        // 4 meta rows — 时间/项目/优先级/更新
        String updatedDisplay = metaUpdated.isEmpty() ? "—" : metaUpdated;
        String[][] metas = {
            {"时间", metaTime.isEmpty() ? "—" : metaTime},
            {"项目", metaProject.isEmpty() ? "—" : metaProject},
            {"优先级", metaPriority.isEmpty() ? "—" : metaPriority},
            {"更新", updatedDisplay},
        };
        for (int i = 0; i < META_ROWS; i++) {
            int rowY = y + i * META_ROW_H;
            ink.setTypeface(Typeface.DEFAULT);
            ink.setTextSize(META_KEY_SP);
            canvas.drawText(metas[i][0], PAD, rowY + 34, ink);
            ink.setTextSize(META_VAL_SP);
            canvas.drawText(metas[i][1], PAD + META_KEY_W, rowY + 34, ink);
        }
        y += META_ROWS * META_ROW_H;

        // Rule below meta
        canvas.drawRect(PAD, y, width - PAD, y + RULE_H, ink);
        y += RULE_H + 32;

        // "操作" heading
        ink.setTypeface(Typeface.DEFAULT_BOLD);
        ink.setTextSize(HEADING_SP);
        canvas.drawText("操作", PAD, y + HEADING_SP, ink);
        y += HEADING_SP + 10;

        // Rule under heading
        canvas.drawRect(PAD, y, width - PAD, y + RULE_H, ink);
        y += RULE_H;

        // 4 action rows
        ink.setTextSize(ACTION_SP);
        ink.setTypeface(Typeface.DEFAULT);
        String[] actions = {"完成", "推迟到明天", "推迟到周末", "推迟到下周"};
        for (int i = 0; i < 4; i++) {
            int top = y;
            int bottom = y + ACTION_ROW_H;
            float tw = ink.measureText(actions[i]);
            float cx = (width - tw) / 2;
            canvas.drawText(actions[i], cx, top + (ACTION_ROW_H - ACTION_SP) / 2 + ACTION_SP - 2, ink);
            y = bottom;
            canvas.drawRect(PAD, y, width - PAD, y + RULE_H, ink);
            y += RULE_H;
        }

        y += 28;

        // Back button
        ink.setTypeface(Typeface.DEFAULT_BOLD);
        ink.setTextSize(BACK_BTN_SP);
        float bw = ink.measureText("返回");
        canvas.drawText("返回", (width - bw) / 2, backRect.top + (BACK_ROW_H - BACK_BTN_SP) / 2 + BACK_BTN_SP - 2, ink);
    }

    // ── Touch ──
    @Override
    public boolean onTouchEvent(MotionEvent event) {
        if (event.getAction() != MotionEvent.ACTION_UP) return true;
        if (listener == null) return true;
        int x = (int) event.getX();
        int y = (int) event.getY();
        for (int i = 0; i < actionRects.size(); i++) {
            if (actionRects.get(i).contains(x, y)) { listener.onAction(actionCodes.get(i)); return true; }
        }
        if (backRect != null && backRect.contains(x, y)) { listener.onAction(4); return true; }
        return true;
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
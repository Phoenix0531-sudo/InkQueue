package dev.inkqueue.ui;

import dev.inkqueue.data.Task;
import dev.inkqueue.util.DateUtils;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

public final class SectionedTaskList {
    public final List<Task> overdue;
    public final List<Task> today;
    public final List<Task> week;
    public final List<Task> later;
    /** Completed today — shown on PAGE_DONE only; never mixed into open pages. */
    public final List<Task> doneToday;

    public SectionedTaskList(List<Task> overdue, List<Task> today, List<Task> week, List<Task> later) {
        this(overdue, today, week, later, new ArrayList<Task>());
    }

    public SectionedTaskList(List<Task> overdue, List<Task> today, List<Task> week, List<Task> later, List<Task> doneToday) {
        this.overdue = overdue;
        this.today = today;
        this.week = week;
        this.later = later;
        this.doneToday = doneToday == null ? new ArrayList<Task>() : doneToday;
    }

    public static SectionedTaskList group(List<Task> tasks, String todayDate) {
        return group(tasks, todayDate, null);
    }

    public static SectionedTaskList group(List<Task> tasks, String todayDate, List<Task> doneToday) {
        List<Task> overdue = new ArrayList<Task>();
        List<Task> today = new ArrayList<Task>();
        List<Task> week = new ArrayList<Task>();
        List<Task> later = new ArrayList<Task>();
        for (Task task : tasks) {
            if (task == null || !task.isOpen()) continue;
            if (task.forceToday) {
                today.add(task);
            } else if (DateUtils.isEmpty(task.dueDate)) {
                later.add(task);
            } else if (todayDate.equals(task.dueDate)) {
                today.add(task);
            } else if (DateUtils.isTodayOrOverdue(task.dueDate, todayDate)) {
                overdue.add(task);
            } else if (DateUtils.isAfterTodayWithinThisWeek(task.dueDate, todayDate)) {
                week.add(task);
            } else {
                later.add(task);
            }
        }
        sort(overdue, todayDate);
        sort(today, todayDate);
        sort(week, todayDate);
        sort(later, todayDate);
        List<Task> done = doneToday == null ? new ArrayList<Task>() : new ArrayList<Task>(doneToday);
        return new SectionedTaskList(overdue, today, week, later, done);
    }

    public List<Row> toRows(String todayDate) {
        // Kept for backward compatibility — emits a single scrolling list.
        List<Row> rows = new ArrayList<Row>();
        boolean allEmpty = overdue.isEmpty() && today.isEmpty() && week.isEmpty() && later.isEmpty();
        if (!overdue.isEmpty()) {
            appendSection(rows, "已过期", overdue, null, todayDate);
        }
        appendSection(rows, "今日", today, allEmpty ? "没有任务。\n由 Agent 同步到这里。" : todayEmptyMessage(), todayDate);
        appendSection(rows, "本周", week, null, todayDate);
        appendSection(rows, "以后", later, null, todayDate);
        return rows;
    }

        public List<Row> pageRows(int page, String todayDate) {
        List<Row> rows = new ArrayList<Row>();
        switch (page) {
            case PAGE_OVERDUE:
                rows.add(Row.section("已过期"));
                if (!overdue.isEmpty()) {
                    rows.add(Row.bulkAction("全部推迟到今天", ACTION_POSTPONE_TO_TODAY));
                    rows.add(Row.bulkAction("全部推迟到明天", ACTION_POSTPONE_TO_TOMORROW));
                } else {
                    rows.add(Row.empty("没有过期任务。"));
                }
                for (Task t : overdue) rows.add(Row.task(t, meta(t, todayDate)));
                return rows;
            case PAGE_TODAY: {
                boolean nothingPending = overdue.isEmpty() && today.isEmpty();
                String emptyMsg = nothingPending
                        ? (week.isEmpty() && later.isEmpty()
                            ? "没有任务。\n由 Agent 同步到这里。"
                            : todayDoneMessage())
                        : todayEmptyMessage();
                rows.add(Row.section("今日"));
                if (today.isEmpty()) rows.add(Row.empty(emptyMsg));
                else for (Task t : today) rows.add(Row.task(t, meta(t, todayDate)));
                return rows;
            }
            case PAGE_WEEK:
                rows.add(Row.section("本周"));
                if (week.isEmpty()) rows.add(Row.empty("本周没有任务。"));
                else for (Task t : week) rows.add(Row.task(t, meta(t, todayDate)));
                return rows;
            case PAGE_LATER:
                rows.add(Row.section("以后"));
                if (later.isEmpty()) rows.add(Row.empty("以后没有任务。"));
                else for (Task t : later) rows.add(Row.task(t, meta(t, todayDate)));
                return rows;
            case PAGE_DONE:
                rows.add(Row.section("今日已做"));
                if (doneToday == null || doneToday.isEmpty()) {
                    rows.add(Row.empty("今天还没有完成的任务。"));
                } else {
                    for (Task t : doneToday) rows.add(Row.task(t, doneMeta(t, todayDate)));
                }
                return rows;
        }
        return rows;
    }

    public static final int ACTION_POSTPONE_TO_TODAY = 1;
    public static final int ACTION_POSTPONE_TO_TOMORROW = 2;

    public static int pageCount() { return 5; }
    public static final int PAGE_OVERDUE = 0;
    public static final int PAGE_TODAY = 1;
    public static final int PAGE_WEEK = 2;
    public static final int PAGE_LATER = 3;
    /** Archive of tasks completed today — read-only feel on the list. */
    public static final int PAGE_DONE = 4;

    private String todayEmptyMessage() { return "今天没有任务。\n可让 Agent 安排下一步。"; }
    private String todayDoneMessage() { return "今天的事做完了。"; }

    private static void appendSection(List<Row> rows, String title, List<Task> tasks, String emptyMessage, String todayDate) {
        rows.add(Row.section(title));
        if (tasks.isEmpty()) {
            if (emptyMessage != null) rows.add(Row.empty(emptyMessage));
            return;
        }
        for (Task task : tasks) rows.add(Row.task(task, meta(task, todayDate)));
    }

    private static String meta(Task task, String todayDate) {
        StringBuilder meta = new StringBuilder();
        if (task.isHighPriority()) meta.append("高优先级");
        String due = DateUtils.displayDue(task, todayDate);
        if (!DateUtils.isEmpty(due)) {
            if (meta.length() > 0) meta.append(" \u00B7 ");
            meta.append(due);
        }
        return meta.toString();
    }

    private static String doneMeta(Task task, String todayDate) {
        StringBuilder meta = new StringBuilder();
        meta.append("已完成");
        if (task.completedAt != null && task.completedAt.length() >= 16) {
            meta.append(" \u00B7 ").append(task.completedAt.substring(11, 16));
        }
        if (task.project != null && task.project.length() > 0) {
            meta.append(" \u00B7 ").append(task.project);
        }
        return meta.toString();
    }

    private static void sort(List<Task> list, final String todayDate) {
        Collections.sort(list, new Comparator<Task>() {
            @Override
            public int compare(Task left, Task right) {
                int overdueLeft = isOverdue(left, todayDate) ? 0 : 1;
                int overdueRight = isOverdue(right, todayDate) ? 0 : 1;
                if (overdueLeft != overdueRight) return overdueLeft - overdueRight;
                int highLeft = left.isHighPriority() ? 0 : 1;
                int highRight = right.isHighPriority() ? 0 : 1;
                if (highLeft != highRight) return highLeft - highRight;
                int date = compareNullableDate(left.dueDate, right.dueDate);
                if (date != 0) return date;
                int time = compareNullable(left.dueTime, right.dueTime);
                if (time != 0) return time;
                return compareNullable(left.title, right.title);
            }
        });
    }

    private static boolean isOverdue(Task task, String todayDate) {
        return DateUtils.isTodayOrOverdue(task.dueDate, todayDate)
                && !DateUtils.isEmpty(task.dueDate)
                && !todayDate.equals(task.dueDate);
    }

    private static int compareNullableDate(String left, String right) {
        if (DateUtils.isEmpty(left) && DateUtils.isEmpty(right)) return 0;
        if (DateUtils.isEmpty(left)) return 1;
        if (DateUtils.isEmpty(right)) return -1;
        boolean validLeft = DateUtils.isValidDate(left);
        boolean validRight = DateUtils.isValidDate(right);
        if (validLeft != validRight) return validLeft ? -1 : 1;
        if (!validLeft) return left.compareTo(right);
        return DateUtils.compareDates(left, right);
    }

    private static int compareNullable(String left, String right) {
        if (left == null && right == null) return 0;
        if (left == null) return 1;
        if (right == null) return -1;
        return left.compareTo(right);
    }

    public static class Row {
        public static final int TYPE_SECTION = 0;
        public static final int TYPE_TASK = 1;
        public static final int TYPE_EMPTY = 2;
        public static final int TYPE_BULK_ACTION = 3;
        public final int type;
        public final String text;
        public final String meta;
        public final Task task;
        public final int actionCode;

        private Row(int type, String text, String meta, Task task) {
            this(type, text, meta, task, 0);
        }
        private Row(int type, String text, String meta, Task task, int actionCode) {
            this.type = type;
            this.text = text;
            this.meta = meta;
            this.task = task;
            this.actionCode = actionCode;
        }

        public static Row section(String title) { return new Row(TYPE_SECTION, title, null, null); }
        public static Row task(Task task, String meta) { return new Row(TYPE_TASK, task.title, meta, task); }
        public static Row empty(String message) { return new Row(TYPE_EMPTY, message, null, null); }
        public static Row bulkAction(String label, int actionCode) { return new Row(TYPE_BULK_ACTION, label, null, null, actionCode); }
    }
}

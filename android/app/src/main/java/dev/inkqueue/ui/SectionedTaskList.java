package dev.inkqueue.ui;

import dev.inkqueue.data.Task;
import dev.inkqueue.util.DateUtils;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

public final class SectionedTaskList {
    public final List<Task> today;
    public final List<Task> week;
    public final List<Task> later;

    public SectionedTaskList(List<Task> today, List<Task> week, List<Task> later) {
        this.today = today;
        this.week = week;
        this.later = later;
    }

    public static SectionedTaskList group(List<Task> tasks, String todayDate) {
        List<Task> today = new ArrayList<Task>();
        List<Task> week = new ArrayList<Task>();
        List<Task> later = new ArrayList<Task>();
        for (Task task : tasks) {
            if (task == null || !task.isOpen()) continue;
            if (task.forceToday || DateUtils.isTodayOrOverdue(task.dueDate, todayDate)) {
                today.add(task);
            } else if (DateUtils.isAfterTodayWithinThisWeek(task.dueDate, todayDate)) {
                week.add(task);
            } else {
                later.add(task);
            }
        }
        sort(today, todayDate);
        sort(week, todayDate);
        sort(later, todayDate);
        return new SectionedTaskList(today, week, later);
    }

    public List<Row> toRows(String todayDate) {
        List<Row> rows = new ArrayList<Row>();
        boolean allEmpty = today.isEmpty() && week.isEmpty() && later.isEmpty();
        appendSection(rows, "今日", today, allEmpty ? "没有任务。任务会由 Agent 同步到这里。" : "今天没有任务。\n可以让 Agent 帮你安排下一步。", todayDate);
        appendSection(rows, "本周", week, null, todayDate);
        appendSection(rows, "以后", later, null, todayDate);
        return rows;
    }

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
            if (meta.length() > 0) meta.append(" · ");
            meta.append(due);
        }
        if (!DateUtils.isEmpty(task.project)) {
            if (meta.length() > 0) meta.append(" · ");
            meta.append(task.project);
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
        public final int type;
        public final String text;
        public final String meta;
        public final Task task;

        private Row(int type, String text, String meta, Task task) {
            this.type = type;
            this.text = text;
            this.meta = meta;
            this.task = task;
        }

        public static Row section(String title) { return new Row(TYPE_SECTION, title, null, null); }
        public static Row task(Task task, String meta) { return new Row(TYPE_TASK, task.title, meta, task); }
        public static Row empty(String message) { return new Row(TYPE_EMPTY, message, null, null); }
    }
}

package dev.inkqueue.ui;

import dev.inkqueue.data.Task;
import java.util.ArrayList;
import java.util.List;
import org.junit.Test;
import static org.junit.Assert.*;

public class SectionedTaskListTest {
    @Test public void groupsOpenTasksIntoOverdueTodayWeekAndLater() {
        List<Task> tasks = new ArrayList<Task>();
        tasks.add(task("overdue", "\u8FC7\u671F", "todo", "2026-07-05", null, false));
        tasks.add(task("today", "\u4ECA\u5929", "todo", "2026-07-06", "14:00", false));
        tasks.add(task("force", "\u5F3A\u5236\u4ECA\u65E5", "todo", "2026-07-20", null, true));
        tasks.add(task("week", "\u672C\u5468", "todo", "2026-07-10", null, false));
        tasks.add(task("later", "\u4EE5\u540E", "todo", "2026-07-20", null, false));
        tasks.add(task("nodate", "\u65E0\u65E5\u671F", "todo", null, null, false));
        tasks.add(task("done", "\u5B8C\u6210", "done", "2026-07-06", null, false));

        SectionedTaskList grouped = SectionedTaskList.group(tasks, "2026-07-06");

        assertEquals(1, grouped.overdue.size());
        assertEquals("overdue", grouped.overdue.get(0).id);

        assertEquals(2, grouped.today.size());
        assertEquals("today", grouped.today.get(0).id);
        assertEquals("force", grouped.today.get(1).id);

        assertEquals(1, grouped.week.size());
        assertEquals("week", grouped.week.get(0).id);

        assertEquals(2, grouped.later.size());
        assertEquals("later", grouped.later.get(0).id);
        assertEquals("nodate", grouped.later.get(1).id);
    }

    @Test public void emptyTodayWithWeekTasksShowsDoneMessage() {
        List<Task> tasks = new ArrayList<Task>();
        tasks.add(task("week", "\u672C\u5468", "todo", "2026-07-10", null, false));
        List<SectionedTaskList.Row> rows = SectionedTaskList.group(tasks, "2026-07-06").pageRows(SectionedTaskList.PAGE_TODAY, "2026-07-06");
        assertEquals(SectionedTaskList.Row.TYPE_SECTION, rows.get(0).type);
        assertEquals("\u4ECA\u65E5", rows.get(0).text);
        assertEquals(SectionedTaskList.Row.TYPE_EMPTY, rows.get(1).type);
        assertTrue(rows.get(1).text.contains("\u4ECA\u5929\u7684\u4E8B\u505A\u5B8C\u4E86"));
    }

    @Test public void fullyEmptyShowsAgentMessage() {
        List<Task> tasks = new ArrayList<Task>();
        List<SectionedTaskList.Row> rows = SectionedTaskList.group(tasks, "2026-07-06").pageRows(SectionedTaskList.PAGE_TODAY, "2026-07-06");
        assertEquals(SectionedTaskList.Row.TYPE_EMPTY, rows.get(1).type);
        assertTrue(rows.get(1).text.contains("由 Agent"));
    }

    @Test public void overdueTasksGoToOverduePage() {
        List<Task> tasks = new ArrayList<Task>();
        tasks.add(task("overdue", "\u8FC7\u671F", "todo", "2026-07-05", null, false));
        SectionedTaskList grouped = SectionedTaskList.group(tasks, "2026-07-06");
        assertEquals(1, grouped.overdue.size());
        assertEquals(0, grouped.today.size());
    }

    @Test public void malformedDueDateFallsBackToLater() {
        List<Task> tasks = new ArrayList<Task>();
        tasks.add(task("bad", "坏日期", "todo", "2026-02-31", "14:00", false));
        tasks.add(task("later", "以后", "todo", null, null, false));

        SectionedTaskList grouped = SectionedTaskList.group(tasks, "2026-07-06");

        assertEquals(0, grouped.today.size());
        assertEquals(0, grouped.week.size());
        assertEquals("bad", grouped.later.get(0).id);
        assertEquals("later", grouped.later.get(1).id);
    }


    @Test public void doneTodayPageListsCompleted() {
        List<Task> open = new ArrayList<Task>();
        List<Task> done = new ArrayList<Task>();
        Task d = task("d1", "完成了", "done", "2026-07-06", null, false);
        d.completedAt = "2026-07-06T09:00:00+08:00";
        done.add(d);
        SectionedTaskList grouped = SectionedTaskList.group(open, "2026-07-06", done);
        assertEquals(1, grouped.doneToday.size());
        List<SectionedTaskList.Row> rows = grouped.pageRows(SectionedTaskList.PAGE_DONE, "2026-07-06");
        assertEquals(SectionedTaskList.Row.TYPE_SECTION, rows.get(0).type);
        assertEquals("今日已做", rows.get(0).text);
        assertEquals(SectionedTaskList.Row.TYPE_TASK, rows.get(1).type);
        assertTrue(rows.get(1).meta.contains("已完成"));
    }

    @Test public void pageCountIsFive() {
        assertEquals(5, SectionedTaskList.pageCount());
    }

    private static Task task(String id, String title, String status, String dueDate, String dueTime, boolean forceToday) {
        Task task = new Task();
        task.id = id;
        task.title = title;
        task.status = status;
        task.dueDate = dueDate;
        task.dueTime = dueTime;
        task.priority = "normal";
        task.source = "agent";
        task.forceToday = forceToday;
        return task;
    }
}

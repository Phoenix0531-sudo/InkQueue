package dev.inkqueue.ui;

import dev.inkqueue.data.Task;
import java.util.ArrayList;
import java.util.List;
import org.junit.Test;
import static org.junit.Assert.*;

public class SectionedTaskListTest {
    @Test public void groupsOpenTasksIntoTodayWeekAndLater() {
        List<Task> tasks = new ArrayList<Task>();
        tasks.add(task("overdue", "过期", "todo", "2026-07-05", null, false));
        tasks.add(task("today", "今天", "todo", "2026-07-06", "14:00", false));
        tasks.add(task("force", "强制今日", "todo", "2026-07-20", null, true));
        tasks.add(task("week", "本周", "todo", "2026-07-10", null, false));
        tasks.add(task("later", "以后", "todo", "2026-07-20", null, false));
        tasks.add(task("nodate", "无日期", "todo", null, null, false));
        tasks.add(task("done", "完成", "done", "2026-07-06", null, false));

        SectionedTaskList grouped = SectionedTaskList.group(tasks, "2026-07-06");

        assertEquals(3, grouped.today.size());
        assertEquals("overdue", grouped.today.get(0).id);
        assertEquals(1, grouped.week.size());
        assertEquals("week", grouped.week.get(0).id);
        assertEquals(2, grouped.later.size());
        assertEquals("later", grouped.later.get(0).id);
        assertEquals("nodate", grouped.later.get(1).id);
    }

    @Test public void emptyTodayAddsQuietEmptyRow() {
        List<Task> tasks = new ArrayList<Task>();
        tasks.add(task("week", "本周", "todo", "2026-07-10", null, false));
        List<SectionedTaskList.Row> rows = SectionedTaskList.group(tasks, "2026-07-06").toRows("2026-07-06");
        assertEquals(SectionedTaskList.Row.TYPE_SECTION, rows.get(0).type);
        assertEquals("// TODAY", rows.get(0).text);
        assertEquals(SectionedTaskList.Row.TYPE_EMPTY, rows.get(1).type);
        assertTrue(rows.get(1).text.contains("no tasks for today"));
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

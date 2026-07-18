package dev.inkqueue.util;

import dev.inkqueue.data.Task;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class JsonUtilsTest {
    @Test public void parsesSnapshotTasks() throws Exception {
        JSONObject taskJson = new JSONObject()
                .put("id", "task_001")
                .put("title", "整理 BootSem 文档")
                .put("note", JSONObject.NULL)
                .put("status", "todo")
                .put("due_date", "2026-07-06")
                .put("due_time", "14:00")
                .put("priority", "high")
                .put("created_at", "2026-07-06T08:00:00+08:00")
                .put("updated_at", "2026-07-06T08:10:00+08:00")
                .put("completed_at", JSONObject.NULL)
                .put("source", "agent");
        JSONObject root = new JSONObject()
                .put("server_time", "2026-07-06T08:12:00+08:00")
                .put("tasks", new JSONArray().put(taskJson));

        JsonUtils.Snapshot snapshot = JsonUtils.parseSnapshot(root.toString());

        assertEquals("2026-07-06T08:12:00+08:00", snapshot.serverTime);
        assertEquals(1, snapshot.tasks.size());
        Task task = snapshot.tasks.get(0);
        assertEquals("task_001", task.id);
        assertEquals("整理 BootSem 文档", task.title);
        assertNull(task.note);
        assertTrue(task.isHighPriority());
    }
}

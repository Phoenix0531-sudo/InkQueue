package dev.inkqueue.util;

import dev.inkqueue.data.AgentNotice;
import dev.inkqueue.data.Task;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public final class JsonUtils {
    private JsonUtils() {}

    public static Snapshot parseSnapshot(String body) throws JSONException {
        JSONObject root = new JSONObject(body);
        Snapshot snapshot = new Snapshot();
        snapshot.serverTime = root.optString("server_time", null);
        snapshot.tasks = new ArrayList<Task>();
        JSONArray array = root.optJSONArray("tasks");
        if (array != null) {
            for (int i = 0; i < array.length(); i++) {
                snapshot.tasks.add(Task.fromJson(array.getJSONObject(i)));
            }
        }
        // H2 reverse-notify: optional agent_notices array; absent on older
        // servers → treated as "no notices" and never shown.
        snapshot.notices = new ArrayList<AgentNotice>();
        JSONArray notices = root.optJSONArray("agent_notices");
        if (notices != null) {
            for (int i = 0; i < notices.length(); i++) {
                snapshot.notices.add(AgentNotice.fromJson(notices.getJSONObject(i)));
            }
        }
        return snapshot;
    }

    public static JSONArray tasksToJson(List<Task> tasks) throws JSONException {
        JSONArray array = new JSONArray();
        for (Task task : tasks) array.put(task.toJson());
        return array;
    }

    public static class Snapshot {
        public String serverTime;
        public List<Task> tasks;
        public List<AgentNotice> notices;
    }
}

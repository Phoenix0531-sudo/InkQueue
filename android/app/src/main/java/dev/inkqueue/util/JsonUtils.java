package dev.inkqueue.util;

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
    }
}

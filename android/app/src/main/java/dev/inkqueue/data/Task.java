package dev.inkqueue.data;

import dev.inkqueue.util.DateUtils;
import org.json.JSONException;
import org.json.JSONObject;

public class Task implements DateUtils.TaskLike {
    public static final String STATUS_TODO = "todo";
    public static final String STATUS_DONE = "done";
    public static final String STATUS_ARCHIVED = "archived";
    public static final String PRIORITY_NORMAL = "normal";
    public static final String PRIORITY_HIGH = "high";

    public String id;
    public String title;
    public String note;
    public String status;
    public String dueDate;
    public String dueTime;
    public String priority;
    public String createdAt;
    public String updatedAt;
    public String completedAt;
    public String source;
    public boolean forceToday;
    public String rawJson;

    public boolean isOpen() {
        return !STATUS_DONE.equals(status) && !STATUS_ARCHIVED.equals(status);
    }

    public boolean isHighPriority() {
        return PRIORITY_HIGH.equals(priority);
    }

    @Override
    public String getDueDate() {
        return dueDate;
    }

    @Override
    public String getDueTime() {
        return dueTime;
    }

    public static Task fromJson(JSONObject json) throws JSONException {
        Task task = new Task();
        task.id = requireString(json, "id");
        task.title = requireString(json, "title");
        task.note = nullableString(json, "note");
        task.status = nonEmpty(nullableString(json, "status"), STATUS_TODO);
        task.dueDate = nullableString(json, "due_date");
        task.dueTime = nullableString(json, "due_time");
        task.priority = nonEmpty(nullableString(json, "priority"), PRIORITY_NORMAL);
        task.createdAt = nullableString(json, "created_at");
        task.updatedAt = nullableString(json, "updated_at");
        task.completedAt = nullableString(json, "completed_at");
        task.source = nonEmpty(nullableString(json, "source"), "agent");
        task.forceToday = json.optBoolean("force_today", json.optBoolean("today", false));
        task.rawJson = json.toString();
        return task;
    }

    public JSONObject toJson() throws JSONException {
        JSONObject json = new JSONObject();
        put(json, "id", id);
        put(json, "title", title);
        put(json, "note", note);
        put(json, "status", status);
        put(json, "due_date", dueDate);
        put(json, "due_time", dueTime);
        put(json, "priority", priority);
        put(json, "created_at", createdAt);
        put(json, "updated_at", updatedAt);
        put(json, "completed_at", completedAt);
        put(json, "source", source);
        if (forceToday) json.put("force_today", true);
        return json;
    }

    private static String requireString(JSONObject json, String key) throws JSONException {
        String value = nullableString(json, key);
        if (DateUtils.isEmpty(value)) throw new JSONException(key + " required");
        return value;
    }

    private static String nullableString(JSONObject json, String key) {
        if (!json.has(key) || json.isNull(key)) return null;
        String value = json.optString(key, null);
        return DateUtils.isEmpty(value) ? null : value;
    }

    private static String nonEmpty(String value, String fallback) {
        return DateUtils.isEmpty(value) ? fallback : value;
    }

    private static void put(JSONObject json, String key, String value) throws JSONException {
        if (value == null) json.put(key, JSONObject.NULL);
        else json.put(key, value);
    }
}

package dev.inkqueue.data;

import dev.inkqueue.util.DateUtils;
import dev.inkqueue.util.IdUtils;
import org.json.JSONException;
import org.json.JSONObject;

public class PendingOperation {
    public static final String TYPE_COMPLETE = "complete";
    public static final String TYPE_POSTPONE = "postpone";

    public String id;
    public String type;
    public String taskId;
    public String payload;
    public String createdAt;
    public int retryCount;
    public String lastError;

    public static PendingOperation complete(String taskId, String completedAt) throws JSONException {
        JSONObject payload = new JSONObject();
        payload.put("completed_at", completedAt);
        PendingOperation op = new PendingOperation();
        op.id = IdUtils.newId("op");
        op.type = TYPE_COMPLETE;
        op.taskId = taskId;
        op.payload = payload.toString();
        op.createdAt = completedAt;
        op.retryCount = 0;
        return op;
    }

    public static PendingOperation postpone(String taskId, String targetDate, String dueTime, String postponeTarget) throws JSONException {
        JSONObject payload = postponePayload(targetDate, dueTime, postponeTarget);
        PendingOperation op = new PendingOperation();
        op.id = IdUtils.newId("op");
        op.type = TYPE_POSTPONE;
        op.taskId = taskId;
        op.payload = payload.toString();
        op.createdAt = DateUtils.isoNow();
        op.retryCount = 0;
        return op;
    }

    public static JSONObject postponePayload(String targetDate, String dueTime, String postponeTarget) throws JSONException {
        JSONObject payload = new JSONObject();
        payload.put("due_date", targetDate);
        if (!DateUtils.isEmpty(dueTime)) payload.put("due_time", dueTime);
        payload.put("postpone_target", postponeTarget);
        return payload;
    }

    public JSONObject toApiJson() throws JSONException {
        JSONObject json = new JSONObject();
        json.put("id", id);
        json.put("type", type);
        json.put("task_id", taskId);
        json.put("created_at", createdAt);
        json.put("payload", payload == null || payload.length() == 0 ? new JSONObject() : new JSONObject(payload));
        return json;
    }
}

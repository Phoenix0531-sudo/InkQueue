package dev.inkqueue.data;

import org.json.JSONObject;
import org.junit.Test;

import static org.junit.Assert.*;

public class PendingOperationTest {
    @Test public void completeOperationSendsIntentWithoutDeviceTimestamp() throws Exception {
        PendingOperation operation = PendingOperation.complete(
                "task_001", "2000-01-01T00:00:00+08:00");

        JSONObject api = operation.toApiJson();
        JSONObject payload = api.getJSONObject("payload");

        assertEquals(PendingOperation.TYPE_COMPLETE, api.getString("type"));
        assertEquals("task_001", api.getString("task_id"));
        assertFalse("device created_at must not be authoritative", api.has("created_at"));
        assertFalse("device completed_at must not be authoritative", payload.has("completed_at"));
        assertEquals(0, payload.length());
    }

    @Test public void postponeOperationSendsOnlyIntentFields() throws Exception {
        PendingOperation operation = PendingOperation.postpone(
                "task_002", "2026-08-08", "14:00", "weekend");

        JSONObject api = operation.toApiJson();
        JSONObject payload = api.getJSONObject("payload");

        assertFalse(api.has("created_at"));
        assertEquals("2026-08-08", payload.getString("due_date"));
        assertEquals("14:00", payload.getString("due_time"));
        assertEquals("weekend", payload.getString("postpone_target"));
    }

    @Test public void operationIdRemainsStableAcrossSerialization() throws Exception {
        PendingOperation operation = PendingOperation.complete("task_003", "now");
        String id = operation.id;

        assertEquals(id, operation.toApiJson().getString("id"));
        assertEquals(id, operation.toApiJson().getString("id"));
    }
}

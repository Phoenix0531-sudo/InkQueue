package dev.inkqueue.data;

import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

/** Extra coverage around postpone payload retention of due_time. */
public class PendingOperationPayloadTest {
    @Test
    public void postpone_keepsDueTime() throws Exception {
        PendingOperation op = PendingOperation.postpone("t1", "2026-08-05", "17:30", "tomorrow");
        assertEquals(PendingOperation.TYPE_POSTPONE, op.type);
        assertEquals("t1", op.taskId);
        JSONObject payload = new JSONObject(op.payload);
        assertEquals("2026-08-05", payload.getString("due_date"));
        assertEquals("17:30", payload.getString("due_time"));
        assertEquals("tomorrow", payload.getString("postpone_target"));
    }

    @Test
    public void postpone_omitsEmptyDueTime() throws Exception {
        PendingOperation op = PendingOperation.postpone("t2", "2026-08-06", null, "weekend");
        JSONObject payload = new JSONObject(op.payload);
        assertEquals("2026-08-06", payload.getString("due_date"));
        assertFalse(payload.has("due_time"));
        assertEquals("weekend", payload.getString("postpone_target"));
    }

    @Test
    public void complete_payloadIsEmptyObject() throws Exception {
        PendingOperation op = PendingOperation.complete("t3", "2026-08-04T10:00:00+08:00");
        assertEquals(PendingOperation.TYPE_COMPLETE, op.type);
        JSONObject payload = new JSONObject(op.payload);
        assertEquals(0, payload.length());
        JSONObject api = op.toApiJson();
        assertEquals("t3", api.getString("task_id"));
        assertFalse(api.has("created_at"));
    }
}

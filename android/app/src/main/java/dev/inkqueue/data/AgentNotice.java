package dev.inkqueue.data;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * H2 reverse-notify: a short message that the Agent pushed to the server for
 * the device (or broadcast to every device). Surfaced into the MainActivity
 * UI above the task list. Dismissed via SyncClient.dismissNotice() once the
 * user has read it so it stops re-appearing on the next sync.
 *
 * Notes on field shape — must match server side:
 *   id         String  server-generated, prefix `notice_`
 *   title      String  required, max 200
 *   body       String  optional, max 1024; null when not provided
 *   kind       String  'info' / 'remind' / 'warn' (default 'info')
 *   deviceId   String  null = broadcast to every device
 *   createdAt  String  ISO8601
 *   dismissedBy, dismissedAt — populated once dismissed; client treats
 *                              any presence of dismissedBy as "read".
 */
public class AgentNotice {
    public String id;
    public String title;
    public String body;
    public String kind;
    public String deviceId;
    public String createdAt;
    public String dismissedBy;
    public String dismissedAt;

    public boolean isDismissed() {
        return dismissedBy != null && !dismissedBy.isEmpty();
    }

    public static AgentNotice fromJson(JSONObject json) throws JSONException {
        AgentNotice n = new AgentNotice();
        n.id = requireString(json, "id");
        n.title = requireString(json, "title");
        n.body = nullableString(json, "body");
        n.kind = nullableString(json, "kind");
        if (n.kind == null) n.kind = "info";
        n.deviceId = nullableString(json, "device_id");
        n.createdAt = nullableString(json, "created_at");
        n.dismissedBy = nullableString(json, "dismissed_by");
        n.dismissedAt = nullableString(json, "dismissed_at");
        return n;
    }

    private static String requireString(JSONObject json, String key) throws JSONException {
        String v = nullableString(json, key);
        if (v == null) throw new JSONException(key + " required");
        return v;
    }

    private static String nullableString(JSONObject json, String key) {
        if (!json.has(key) || json.isNull(key)) return null;
        String v = json.optString(key, null);
        return (v == null || v.isEmpty()) ? null : v;
    }
}

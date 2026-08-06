package dev.inkqueue.sync;

import android.util.Log;
import dev.inkqueue.data.PendingOperation;
import dev.inkqueue.util.DateUtils;
import dev.inkqueue.util.JsonUtils;
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

public class SyncClient {
    private static final String TAG = "InkQueueSyncClient";
    private final String baseUrl;
    private final String token;
    private final int timeoutMs;

    public SyncClient(String baseUrl, String token) {
        this(baseUrl, token, 6000);
    }

    public SyncClient(String baseUrl, String token, int timeoutMs) {
        this.baseUrl = normalize(baseUrl);
        this.token = token;
        this.timeoutMs = timeoutMs;
    }

    public String getBaseUrl() {
        return baseUrl == null ? "" : baseUrl;
    }

    public SyncResult fetchSnapshot() {
        if (DateUtils.isEmpty(baseUrl)) return SyncResult.fail("尚未配置同步地址。", "missing base url");
        HttpURLConnection conn = null;
        try {
            Log.i(TAG, "GET " + baseUrl + "/v1/tasks/snapshot");
            conn = open("/v1/tasks/snapshot", "GET");
            int code = conn.getResponseCode();
            Log.i(TAG, "snapshot response code=" + code);
            String body = readResponse(conn, code);
            if (code == 401) return SyncResult.fail("同步被拒绝，请检查 Token。", body);
            if (code < 200 || code >= 300) return SyncResult.fail("服务器暂时不可用。", body);
            JsonUtils.Snapshot snapshot = JsonUtils.parseSnapshot(body);
            SyncResult result = SyncResult.ok("已同步");
            result.httpStatus = code;
            result.serverTime = snapshot.serverTime;
            result.tasks = snapshot.tasks;
            return result;
        } catch (Exception e) {
            Log.w(TAG, "fetch snapshot failed", e);
            return SyncResult.fail("同步失败，显示本地内容", e.toString());
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    public SyncResult postOperations(String deviceId, List<PendingOperation> operations) {
        if (operations == null || operations.isEmpty()) return SyncResult.ok("无待同步操作");
        if (DateUtils.isEmpty(baseUrl)) return SyncResult.fail("尚未配置同步地址。", "missing base url");
        HttpURLConnection conn = null;
        try {
            JSONObject root = new JSONObject();
            root.put("device_id", DateUtils.isEmpty(deviceId) ? "kindle-pw3" : deviceId);
            JSONArray array = new JSONArray();
            for (PendingOperation op : operations) array.put(op.toApiJson());
            root.put("operations", array);

            conn = open("/v1/tasks/operations", "POST");
            Log.i(TAG, "POST " + baseUrl + "/v1/tasks/operations ops=" + operations.size());
            BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(conn.getOutputStream(), "UTF-8"));
            writer.write(root.toString());
            writer.flush();
            writer.close();

            int code = conn.getResponseCode();
            Log.i(TAG, "operations response code=" + code);
            String body = readResponse(conn, code);
            if (code == 401) return SyncResult.fail("同步被拒绝，请检查 Token。", body);
            if (code < 200 || code >= 300) return SyncResult.fail("服务器暂时不可用。", body);

            JSONObject json = new JSONObject(body);
            SyncResult result = SyncResult.ok("已同步");
            result.httpStatus = code;
            result.serverTime = json.optString("server_time", null);
            readStringArray(json.optJSONArray("accepted"), result.accepted);
            readIdArray(json.optJSONArray("ignored"), result.ignored);
            // optional rich reasons for logs (v0.9.3+)
            JSONArray details = json.optJSONArray("ignored_details");
            if (details != null) {
                for (int i = 0; i < details.length(); i++) {
                    JSONObject d = details.optJSONObject(i);
                    if (d != null) {
                        Log.i(TAG, "ignored op " + d.optString("id", "?")
                                + " reason=" + d.optString("reason", "")
                                + " msg=" + d.optString("message", ""));
                    }
                }
            }
            JSONArray errors = json.optJSONArray("errors");
            // v0.9.4: server-side dead-op prune count (maintenance housekeeping).
            result.prunedServer = json.optInt("pruned", 0);
            if (result.prunedServer > 0) {
                Log.i(TAG, "server pruned " + result.prunedServer + " expired/dead operations");
            }
            if (errors != null) {
                for (int i = 0; i < errors.length(); i++) {
                    JSONObject error = errors.optJSONObject(i);
                    if (error == null) {
                        result.errors.add(errors.opt(i).toString());
                    } else {
                        result.errors.add(error.optString("id", "") + "\t" + error.optString("error", "操作失败"));
                    }
                }
            }
            return result;
        } catch (Exception e) {
            Log.w(TAG, "post operations failed", e);
            // Technical path for SyncService — user-facing copy is chosen there
            // (manual sync → "同步失败…"; detail-page offline toast is separate).
            return SyncResult.fail("同步失败，显示本地内容", e.toString());
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private HttpURLConnection open(String path, String method) throws IOException {
        URL url = new URL(baseUrl + path);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod(method);
        conn.setConnectTimeout(timeoutMs);
        conn.setReadTimeout(timeoutMs);
        conn.setRequestProperty("Accept", "application/json");
        conn.setRequestProperty("X-InkQueue-Token", token == null ? "" : token);
        if ("POST".equals(method) || "PATCH".equals(method)) {
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        }
        return conn;
    }

    private static String normalize(String url) {
        if (url == null) return null;
        String trimmed = url.trim();
        while (trimmed.endsWith("/")) trimmed = trimmed.substring(0, trimmed.length() - 1);
        return trimmed;
    }

    private static String readResponse(HttpURLConnection conn, int code) throws IOException {
        InputStream stream = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
        if (stream == null) return "";
        BufferedReader reader = new BufferedReader(new InputStreamReader(stream, "UTF-8"));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) sb.append(line).append('\n');
        reader.close();
        return sb.toString();
    }

    private static void readStringArray(JSONArray array, List<String> out) {
        if (array == null) return;
        for (int i = 0; i < array.length(); i++) out.add(array.optString(i));
    }

    /** Accept ignored as ["id"] or [{id,reason,message}]. Always emit string ids. */
    private static void readIdArray(JSONArray array, List<String> out) {
        if (array == null) return;
        for (int i = 0; i < array.length(); i++) {
            JSONObject obj = array.optJSONObject(i);
            if (obj != null) {
                String id = obj.optString("id", "");
                if (id != null && id.length() > 0) out.add(id);
            } else {
                String id = array.optString(i);
                if (id != null && id.length() > 0) out.add(id);
            }
        }
    }
}

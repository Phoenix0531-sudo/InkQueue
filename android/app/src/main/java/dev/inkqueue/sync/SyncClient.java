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

    public SyncResult fetchSnapshot() {
        if (DateUtils.isEmpty(baseUrl)) return SyncResult.fail("还没有配置同步地址。", "missing base url");
        HttpURLConnection conn = null;
        try {
            conn = open("/v1/tasks/snapshot", "GET");
            int code = conn.getResponseCode();
            String body = readResponse(conn, code);
            if (code == 401) return SyncResult.fail("同步被拒绝，请检查 Token。", body);
            if (code < 200 || code >= 300) return SyncResult.fail("服务器暂时不可用。", body);
            JsonUtils.Snapshot snapshot = JsonUtils.parseSnapshot(body);
            SyncResult result = SyncResult.ok("同步成功");
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
        if (operations == null || operations.isEmpty()) return SyncResult.ok("没有待同步操作");
        if (DateUtils.isEmpty(baseUrl)) return SyncResult.fail("还没有配置同步地址。", "missing base url");
        HttpURLConnection conn = null;
        try {
            JSONObject root = new JSONObject();
            root.put("device_id", DateUtils.isEmpty(deviceId) ? "kindle-pw3" : deviceId);
            JSONArray array = new JSONArray();
            for (PendingOperation op : operations) array.put(op.toApiJson());
            root.put("operations", array);

            conn = open("/v1/tasks/operations", "POST");
            BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(conn.getOutputStream(), "UTF-8"));
            writer.write(root.toString());
            writer.flush();
            writer.close();

            int code = conn.getResponseCode();
            String body = readResponse(conn, code);
            if (code == 401) return SyncResult.fail("同步被拒绝，请检查 Token。", body);
            if (code < 200 || code >= 300) return SyncResult.fail("服务器暂时不可用。", body);

            JSONObject json = new JSONObject(body);
            SyncResult result = SyncResult.ok("操作已同步");
            result.httpStatus = code;
            result.serverTime = json.optString("server_time", null);
            readStringArray(json.optJSONArray("accepted"), result.accepted);
            readStringArray(json.optJSONArray("ignored"), result.ignored);
            JSONArray errors = json.optJSONArray("errors");
            if (errors != null) {
                for (int i = 0; i < errors.length(); i++) {
                    JSONObject error = errors.optJSONObject(i);
                    if (error == null) {
                        result.errors.add(errors.opt(i).toString());
                    } else {
                        result.errors.add(error.optString("id", "") + "\t" + error.optString("error", "operation failed"));
                    }
                }
            }
            return result;
        } catch (Exception e) {
            Log.w(TAG, "post operations failed", e);
            return SyncResult.fail("已保存，联网后同步", e.toString());
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
}
